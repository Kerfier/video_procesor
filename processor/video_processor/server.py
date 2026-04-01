"""FastAPI service for HLS segment-level face/plate blurring.

Each streaming session maintains a persistent StreamingState so that
KCF tracker continuity is preserved across segment boundaries.

Run with:
    uvicorn video_processor.server:app --port 8000
"""

from __future__ import annotations

import asyncio
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, field_validator

from .models import load_models
from .streaming import (
    StreamingState,
    create_session_state,
    flush_state,
    pop_oldest_blurred,
    prime_buffer,
    push_frame,
)

# ---------------------------------------------------------------------------
# Session store
# ---------------------------------------------------------------------------

@dataclass
class _Session:
    state: StreamingState
    created_at: float
    last_used_at: float


_sessions: dict[str, _Session] = {}
_face_model = None
_plate_model = None

_SESSION_TTL_SECONDS = 600  # 10 minutes


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


app = FastAPI(title="video-processor streaming service", lifespan=_lifespan)


async def _idle_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        now = time.monotonic()
        expired = [
            sid for sid, sess in list(_sessions.items())
            if now - sess.last_used_at > _SESSION_TTL_SECONDS
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
    width:              int
    height:             int
    fps:                float

    @field_validator("blur_strength")
    @classmethod
    def _must_be_odd(cls, v: int) -> int:
        if v % 2 == 0:
            raise ValueError("blur_strength must be odd (Gaussian kernel requirement)")
        return v


class CreateSessionResponse(BaseModel):
    session_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/sessions", response_model=CreateSessionResponse, status_code=201)
def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    session_id = str(uuid.uuid4())
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
    now = time.monotonic()
    _sessions[session_id] = _Session(state=state, created_at=now, last_used_at=now)
    return CreateSessionResponse(session_id=session_id)


@app.post("/sessions/{session_id}/segment")
async def process_segment(
    session_id: str,
    segment: UploadFile = File(...),
) -> Response:
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    sess = _sessions[session_id]
    sess.last_used_at = time.monotonic()
    segment_bytes = await segment.read()

    loop = asyncio.get_event_loop()
    try:
        output_bytes = await loop.run_in_executor(
            None, _process_segment_sync, sess.state, segment_bytes
        )
    except _DecodeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except _EncodeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return Response(content=output_bytes, media_type="video/mp2t")


@app.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str) -> None:
    _sessions.pop(session_id, None)


# ---------------------------------------------------------------------------
# Synchronous segment processing (runs in a thread-pool executor)
# ---------------------------------------------------------------------------

class _DecodeError(Exception):
    pass


class _EncodeError(Exception):
    pass


def _process_segment_sync(state: StreamingState, segment_bytes: bytes) -> bytes:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_in = Path(tmpdir) / "in.ts"
        tmp_in.write_bytes(segment_bytes)

        frames = _decode_video_frames(tmp_in)
        if frames is None:
            raise _DecodeError("Failed to decode video frames from segment")

        if state.has_audio is None:
            state.has_audio = _check_has_audio(ffmpeg, tmp_in)
        audio_source = tmp_in if state.has_audio else None

        # Process frames through the stateful pipeline
        output_frames: list[np.ndarray] = []
        for frame in frames:
            if push_frame(state, frame):
                output_frames.append(pop_oldest_blurred(state))

        # Flush remaining frames for this segment
        output_frames.extend(flush_state(state))

        # Re-prime lookback buffer with tail of this segment's raw frames so
        # that backward-tracking in the next segment can reach across the boundary
        tail = frames[-state.lookback_frames:]
        for tf in tail:
            prime_buffer(state, tf)

        output_bytes = _encode_frames(
            ffmpeg, output_frames, state.width, state.height, state.fps, audio_source
        )
        if output_bytes is None:
            raise _EncodeError("Failed to re-encode processed frames")

        return output_bytes


# ---------------------------------------------------------------------------
# FFmpeg helpers
# ---------------------------------------------------------------------------

def _decode_video_frames(path: Path) -> list[np.ndarray] | None:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    frames: list[np.ndarray] = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
    cap.release()
    return frames if frames else None


def _check_has_audio(ffmpeg: str, path: Path) -> bool:
    result = subprocess.run(
        [ffmpeg, "-i", str(path)],
        capture_output=True, text=True,
    )
    return "Audio:" in result.stderr



def _encode_frames(
    ffmpeg: str,
    frames: list[np.ndarray],
    width: int,
    height: int,
    fps: float,
    audio_path: Path | None,
) -> bytes | None:
    if not frames:
        return b""

    raw_input = b"".join(f.tobytes() for f in frames)

    cmd = [
        ffmpeg, "-y",
        "-f", "rawvideo",
        "-s", f"{width}x{height}",
        "-r", str(fps),
        "-pix_fmt", "bgr24",
        "-i", "pipe:0",
    ]
    if audio_path is not None and audio_path.exists():
        cmd += ["-i", str(audio_path), "-c:a", "copy", "-map", "0:v:0", "-map", "1:a:0"]
    cmd += [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-f", "mpegts",
        "pipe:1",
    ]

    result = subprocess.run(cmd, input=raw_input, capture_output=True)
    if result.returncode != 0:
        return None
    return result.stdout
