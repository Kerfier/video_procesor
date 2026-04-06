"""FastAPI service for HLS segment-level face/plate blurring.

Each streaming session maintains a persistent StreamingState so that
KCF tracker continuity is preserved across segment boundaries.

Run with:
    uvicorn video_processor.server:app --port 8000

Two session modes:
- push: NestJS sends individual .ts segments via POST /sessions/{id}/segment
- pull: Python fetches HLS segments directly from a URL (hls_puller.py)
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import cv2
import imageio_ffmpeg
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, field_validator, model_validator
import logging
from logging.handlers import RotatingFileHandler

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        RotatingFileHandler("processor.log", maxBytes=10*1024*1024, backupCount=5),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("server")
from .audio import has_audio_stream
from .models import load_models
from .streaming import (
    StreamingState,
    create_session_state,
    flush_state,
    pop_oldest_blurred,
    push_frame,
)

# ---------------------------------------------------------------------------
# Session store
# ---------------------------------------------------------------------------

@dataclass
class _Session:
    state: StreamingState | None          # None until pull probe completes
    created_at: float
    last_used_at: float
    mode: Literal["push", "pull"]
    output_dir: Path | None               # only set for pull sessions
    segment_count: int                    # incremented by pull loop (GIL-safe int in CPython)
    status: Literal["starting", "processing", "done", "error"]
    error: str | None
    stop_event: threading.Event | None    # set by DELETE to stop the pull loop
    thread: threading.Thread | None       # background pull thread


_sessions: dict[str, _Session] = {}
_sessions_lock = threading.Lock()
_face_model = None
_plate_model = None

_SESSION_TTL_SECONDS = 600  # 10 minutes
MAX_SEGMENT_BYTES = 50 * 1024 * 1024  # 50 MB — guard against runaway uploads
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "50"))
_SEGMENT_TIMEOUT_SECONDS = float(os.environ.get("SEGMENT_TIMEOUT_SECONDS", "120"))

_cpu_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=int(os.environ.get("PROCESSOR_WORKERS", str(os.cpu_count() or 4))),
    thread_name_prefix="segment-processor",
)

# Base directory that output_dir values must reside within (path-traversal guard).
# Matches the OUTPUT_DIR env var consumed by the NestJS server.
_OUTPUT_BASE = Path(os.environ.get("OUTPUT_DIR", "/tmp/streams")).resolve()


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _lifespan(app: FastAPI):
    global _face_model, _plate_model
    try:
        _face_model, _plate_model = load_models()
    except Exception as exc:
        raise RuntimeError(f"Failed to load models at startup: {exc}") from exc

    cleanup_task = asyncio.create_task(_idle_cleanup_loop())
    yield
    cleanup_task.cancel()

    # Signal all active pull sessions to stop
    with _sessions_lock:
        sessions_snapshot = list(_sessions.values())

    for sess in sessions_snapshot:
        if sess.stop_event is not None:
            sess.stop_event.set()

    # Wait up to 10 s for pull threads to exit cleanly
    deadline = time.monotonic() + 10.0
    for sess in sessions_snapshot:
        if sess.thread is not None and sess.thread.is_alive():
            remaining = max(0.0, deadline - time.monotonic())
            sess.thread.join(timeout=remaining)

    _cpu_executor.shutdown(wait=False)


app = FastAPI(title="video-processor streaming service", lifespan=_lifespan)


@app.get("/health")
async def health_check() -> dict:
    return {"status": "ok"}


async def _idle_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        now = time.monotonic()
        # Only expire push sessions; pull sessions self-cleanup when their thread exits
        with _sessions_lock:
            expired = [
                sid for sid, sess in list(_sessions.items())
                if sess.mode == "push" and now - sess.last_used_at > _SESSION_TTL_SECONDS
            ]
            for sid in expired:
                _sessions.pop(sid, None)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    detection_interval: int   = 5
    blur_strength:      int   = 51
    conf:               float = 0.25
    lookback_frames:    int   = 30
    # Push mode: required
    width:              int | None = None
    height:             int | None = None
    fps:                float | None = None
    # Pull mode: required together
    url:                str | None = None
    output_dir:         str | None = None

    @field_validator("blur_strength")
    @classmethod
    def _must_be_odd(cls, v: int) -> int:
        if v % 2 == 0:
            raise ValueError("blur_strength must be odd (Gaussian kernel requirement)")
        return v

    @field_validator("output_dir")
    @classmethod
    def _must_be_within_output_base(cls, v: str | None) -> str | None:
        if v is None:
            return v
        try:
            Path(v).resolve().relative_to(_OUTPUT_BASE)
        except ValueError:
            raise ValueError(
                f"output_dir must be inside {_OUTPUT_BASE} (set OUTPUT_DIR env var to change the base)"
            )
        return v

    @model_validator(mode="after")
    def _check_mode(self) -> "CreateSessionRequest":
        if self.url is not None:
            if not self.output_dir:
                raise ValueError("output_dir is required when url is provided")
        else:
            if self.width is None or self.height is None or self.fps is None:
                raise ValueError("width, height, fps are required when url is not provided")
        return self


class CreateSessionResponse(BaseModel):
    session_id: str


class SessionStatusResponse(BaseModel):
    status: Literal["starting", "processing", "done", "error"]
    segment_count: int
    error: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/sessions", response_model=CreateSessionResponse, status_code=201)
def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    session_id = str(uuid.uuid4())
    now = time.monotonic()

    if req.url is not None:
        # Pull mode: create session immediately in "starting" state,
        # probe + process happens in a background thread.
        stop_event = threading.Event()
        session = _Session(
            state=None,
            created_at=now,
            last_used_at=now,
            mode="pull",
            output_dir=Path(req.output_dir),
            segment_count=0,
            status="starting",
            error=None,
            stop_event=stop_event,
            thread=None,
        )
        with _sessions_lock:
            if len(_sessions) >= MAX_SESSIONS:
                raise HTTPException(status_code=503, detail="Session limit reached; try again later")
            _sessions[session_id] = session

        thread = threading.Thread(
            target=_run_pull_session,
            args=(
                session_id,
                req.url,
                Path(req.output_dir),
                req.detection_interval,
                req.blur_strength,
                req.conf,
                req.lookback_frames,
                stop_event,
            ),
            daemon=True,
        )
        session.thread = thread
        thread.start()
    else:
        # Push mode: unchanged behaviour
        state = create_session_state(
            _face_model, _plate_model,
            detection_interval=req.detection_interval,
            blur_strength=req.blur_strength,
            conf=req.conf,
            lookback_frames=req.lookback_frames,
            width=req.width,
            height=req.height,
            fps=req.fps,
        )
        session = _Session(
            state=state,
            created_at=now,
            last_used_at=now,
            mode="push",
            output_dir=None,
            segment_count=0,
            status="processing",
            error=None,
            stop_event=None,
            thread=None,
        )
        with _sessions_lock:
            if len(_sessions) >= MAX_SESSIONS:
                raise HTTPException(status_code=503, detail="Session limit reached; try again later")
            _sessions[session_id] = session

    return CreateSessionResponse(session_id=session_id)


@app.get("/sessions/{session_id}/status", response_model=SessionStatusResponse)
def get_session_status(session_id: str) -> SessionStatusResponse:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    sess = _sessions[session_id]
    return SessionStatusResponse(
        status=sess.status,
        segment_count=sess.segment_count,
        error=sess.error,
    )


@app.post("/sessions/{session_id}/segment")
async def process_segment(
    session_id: str,
    segment: UploadFile = File(...),
) -> Response:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    sess = _sessions[session_id]
    if sess.mode != "push":
        raise HTTPException(status_code=400, detail="Session is in pull mode; segments are fetched by Python directly")

    sess.last_used_at = time.monotonic()
    segment_bytes = await segment.read(MAX_SEGMENT_BYTES + 1)
    if len(segment_bytes) > MAX_SEGMENT_BYTES:
        raise HTTPException(status_code=413, detail="Segment too large (limit 50 MB)")

    loop = asyncio.get_event_loop()
    try:
        output_bytes = await asyncio.wait_for(
            loop.run_in_executor(_cpu_executor, _process_segment_sync, sess.state, segment_bytes),
            timeout=_SEGMENT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.error(f"Segment processing timed out for session {session_id}")
        raise HTTPException(status_code=504, detail="Segment processing timed out")
    except _DecodeError as exc:
        logger.error(f"Decode error in segment for session {session_id}: {exc}")
        raise HTTPException(status_code=422, detail=str(exc))
    except _EncodeError as exc:
        logger.error(f"Encode error in segment for session {session_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        logger.exception(f"Unexpected error processing segment for session {session_id}")
        raise HTTPException(status_code=500, detail="Internal server error")

    return Response(content=output_bytes, media_type="video/mp2t")


@app.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str) -> None:
    with _sessions_lock:
        sess = _sessions.pop(session_id, None)
    if sess and sess.stop_event is not None:
        sess.stop_event.set()   # signal background pull thread to stop


# ---------------------------------------------------------------------------
# Pull mode background thread
# ---------------------------------------------------------------------------

def _update_session_status(
    session_id: str,
    status: str,
    error: "str | None" = None,
) -> None:
    """Atomically update status (and optionally error) on a session."""
    with _sessions_lock:
        sess = _sessions.get(session_id)
        if sess is not None:
            sess.status = status
            if error is not None:
                sess.error = error


def _probe_hls_url(url: str) -> tuple[int, int, float]:
    """Download the first segment of an HLS stream and extract width/height/fps.

    Returns (width, height, fps). Raises ValueError on failure.
    """
    import requests as _requests
    from .hls_puller import _resolve_media_url, _fetch_text, _fetch_bytes, HLSPlaylist

    try:
        with _requests.Session() as http:
            media_url = _resolve_media_url(url, http)
            playlist_text = _fetch_text(media_url, http)
            playlist = HLSPlaylist.parse(playlist_text, media_url)
            segments = playlist.segments
            if not segments:
                raise ValueError("Playlist has no segments")
            _, first_url, _ = segments[0]
            raw = _fetch_bytes(first_url, http)
    except Exception as exc:
        raise ValueError(f"Cannot probe HLS stream: {exc}") from exc

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir) / "probe.ts"
        tmp.write_bytes(raw)
        cap = cv2.VideoCapture(str(tmp))
        if not cap.isOpened():
            raise ValueError("OpenCV could not open probed segment")
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps    = cap.get(cv2.CAP_PROP_FPS) or 25.0
        cap.release()

    if width == 0 or height == 0:
        raise ValueError("Probed segment has zero dimensions")
    return width, height, fps


def _build_pull_state(
    url: str,
    detection_interval: int,
    blur_strength: int,
    conf: float,
    lookback_frames: int,
) -> StreamingState:
    """Probe *url* and create a StreamingState. Raises ValueError on probe failure."""
    width, height, fps = _probe_hls_url(url)
    return create_session_state(
        _face_model, _plate_model,
        detection_interval=detection_interval,
        blur_strength=blur_strength,
        conf=conf,
        lookback_frames=lookback_frames,
        width=width,
        height=height,
        fps=fps,
    )


def _run_pull_session(
    session_id: str,
    url: str,
    output_dir: Path,
    detection_interval: int,
    blur_strength: int,
    conf: float,
    lookback_frames: int,
    stop_event: threading.Event,
) -> None:
    from .hls_puller import pull_and_process

    with _sessions_lock:
        if _sessions.get(session_id) is None:
            return

    # Phase 1: probe stream and build state
    try:
        state = _build_pull_state(url, detection_interval, blur_strength, conf, lookback_frames)
    except Exception as exc:
        _update_session_status(session_id, "error", error=f"Probe failed: {exc}")
        return

    if stop_event.is_set():
        with _sessions_lock:
            _sessions.pop(session_id, None)
        return

    # Phase 2: attach state and transition to processing
    with _sessions_lock:
        sess = _sessions.get(session_id)
        if sess is None:
            return
        sess.state = state
    _update_session_status(session_id, "processing")

    def _on_segment_written(sequence: int) -> None:
        with _sessions_lock:
            sess.segment_count += 1
            sess.last_used_at = time.monotonic()

    # Phase 3: pull loop
    try:
        pull_and_process(
            url=url,
            output_dir=output_dir,
            state=state,
            process_fn=_process_segment_sync,
            stop_event=stop_event,
            on_segment_written=_on_segment_written,
        )
        _update_session_status(session_id, "done")
    except Exception as exc:
        logger.exception(f"pull session {session_id} error")
        _update_session_status(session_id, "error", error=str(exc))
    finally:
        with _sessions_lock:
            _sessions.pop(session_id, None)


# ---------------------------------------------------------------------------
# Synchronous segment processing (runs in a thread-pool executor)
# ---------------------------------------------------------------------------

class _DecodeError(Exception):
    pass


class _EncodeError(Exception):
    pass


def _build_ffmpeg_cmd(
    ffmpeg_exe: str,
    fps: float,
    width: int,
    height: int,
    out_path: Path,
    has_audio: bool,
    audio_src: "Path | None" = None,
) -> list[str]:
    """Build the FFmpeg command for re-encoding processed frames to MPEG-TS."""
    cmd = [
        ffmpeg_exe, "-y",
        "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-pix_fmt", "bgr24",
        "-i", "pipe:0",
    ]
    if has_audio and audio_src is not None:
        cmd += ["-i", str(audio_src), "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0"]
    cmd += [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-f", "mpegts",
        str(out_path),
    ]
    return cmd


def _pipe_frames_to_proc(
    cap: cv2.VideoCapture,
    state: StreamingState,
    proc: subprocess.Popen,
) -> None:
    """Read frames from cap, push through the state pipeline, write blurred frames to proc.stdin.

    Raises _EncodeError on failure. Does not release cap or kill proc — caller is responsible.
    """
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if push_frame(state, frame):
                out_frame = pop_oldest_blurred(state)
                proc.stdin.write(out_frame.tobytes())

        for out_frame in flush_state(state):
            proc.stdin.write(out_frame.tobytes())
    except Exception as exc:
        raise _EncodeError(f"Error processing segment frames: {exc}") from exc


def _process_segment_sync(state: StreamingState, segment_bytes: bytes) -> bytes:
    logger.debug(f"Starting segment processing, bytes={len(segment_bytes)}")
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_in = Path(tmpdir) / "in.ts"
        tmp_in.write_bytes(segment_bytes)

        if state.has_audio is None:
            state.has_audio = has_audio_stream(tmp_in)
            logger.debug(f"Audio detected dynamically: {state.has_audio}")

        tmp_out = Path(tmpdir) / "out.ts"
        cmd = _build_ffmpeg_cmd(
            ffmpeg_exe, state.fps, state.width, state.height, tmp_out,
            has_audio=state.has_audio,
            audio_src=tmp_in if state.has_audio else None,
        )

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        cap = cv2.VideoCapture(str(tmp_in))
        if not cap.isOpened():
            proc.kill()
            raise _DecodeError("Failed to decode video frames from segment")

        try:
            _pipe_frames_to_proc(cap, state, proc)
            logger.debug("Successfully piped all frames to ffmpeg.")
        except _EncodeError:
            logger.exception("Error processing segment frames during track/blur loop")
            proc.kill()
            raise
        finally:
            cap.release()

        # communicate() automatically flushes and closes stdin, and waits for EOF
        _, stderr_data = proc.communicate()

        if proc.returncode != 0:
            err_msg = stderr_data.decode("utf-8", errors="replace") if stderr_data else ""
            raise _EncodeError(f"Failed to re-encode processed frames: {err_msg}")

        return tmp_out.read_bytes()

