import contextlib
import json
from pathlib import Path

import cv2
from tqdm import tqdm
from open_image_models import LicensePlateDetector
from ultralytics import YOLO

from .audio import mux_audio
from .frame_ops import apply_blur, draw_debug_frame
from .streaming import create_session_state, push_frame, pop_oldest_entry
from .track import TrackMode


class VideoOpenError(RuntimeError):
    pass


class VideoWriterError(RuntimeError):
    pass


def _open_video(path: Path) -> tuple[cv2.VideoCapture, float, int, int, int]:
    """Open a video file. Returns (cap, fps, width, height, frame_count).

    Raises VideoOpenError if the file cannot be opened.
    """
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise VideoOpenError(f"Cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    return cap, fps, width, height, total_frames


def _make_video_writer(path: Path, fourcc, fps: float, size: tuple[int, int]) -> cv2.VideoWriter:
    """Create a VideoWriter. Raises VideoWriterError if it fails to open."""
    writer = cv2.VideoWriter(str(path), fourcc, fps, size)
    if not writer.isOpened():
        raise VideoWriterError(f"Cannot open video writer: {path}")
    return writer


class _DebugWriter:
    """Context manager for the annotated debug video."""

    def __init__(self, output_path: Path, input_path: Path, fourcc, fps: float, size: tuple[int, int]):
        self.debug_path = output_path.parent / f"debug_{input_path.name}"
        self._writer = cv2.VideoWriter(str(self.debug_path), fourcc, fps, size)

    def write_frame(self, frame, debug_entries, idx: int) -> None:
        self._writer.write(draw_debug_frame(frame, debug_entries, idx))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self._writer.release()


class _ReportWriter:
    """Context manager that writes the always-on detection report (CSV or NDJSON)."""

    def __init__(self, output_path: Path, report_format: str):
        self._format = report_format
        ext = "ndjson" if report_format == "ndjson" else "csv"
        self.report_path = output_path.parent / f"{output_path.stem}_report.{ext}"
        self._file = open(self.report_path, "w")
        if report_format == "csv":
            self._file.write("frame,type,track_id,x1,y1,x2,y2,conf,mode,detector\n")

    def write(self, idx: int, entries, tracker_algorithm: str) -> None:
        for box, track_id, category, mode, conf in entries:
            x1, y1, x2, y2 = box
            detector = "YOLO" if mode == TrackMode.DETECT else tracker_algorithm.upper()
            if self._format == "csv":
                self._file.write(
                    f"{idx},{category},{track_id},{x1},{y1},{x2},{y2},"
                    f"{conf:.4f},{mode},{detector}\n"
                )
            else:
                self._file.write(json.dumps({
                    "frame": idx,
                    "type": category,
                    "track_id": track_id,
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "conf": round(conf, 4),
                    "mode": mode,
                    "detector": detector,
                }) + "\n")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self._file.close()


def _flush_one(
    state,
    writer: "cv2.VideoWriter | None",
    blur_strength: int,
    debug_ctx: "_DebugWriter | None",
    report_ctx: _ReportWriter,
    tracker_algorithm: str,
) -> None:
    """Flush the oldest buffered frame to writer, report, and optionally debug_ctx."""
    frame, boxes, idx, is_det, dbg = pop_oldest_entry(state)
    if writer is not None:
        writer.write(apply_blur(frame, boxes, blur_strength))
    if debug_ctx is not None:
        debug_ctx.write_frame(frame, dbg, idx)
    report_ctx.write(idx, dbg, tracker_algorithm)


def process_video(
    input_path: Path,
    output_path: Path,
    detection_interval: int,
    blur_strength: int,
    conf: float,
    face_model: YOLO,
    plate_model: LicensePlateDetector,
    debug: bool = False,
    lookback_frames: int = 60,
    tracker_algorithm: str = "kcf",
    report_format: str = "csv",
    no_video_output: bool = False,
) -> Path:
    """Process a single video. Returns path to the output video, or the report file when
    no_video_output=True."""
    cap, fps, width, height, total_frames = _open_video(input_path)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")

    if no_video_output:
        temp_path = None
        writer = None
        report_base = input_path
    else:
        temp_path = output_path.parent / f"_tmp_{output_path.stem}.mp4"
        writer = _make_video_writer(temp_path, fourcc, fps, (width, height))
        report_base = output_path

    state = create_session_state(
        face_model, plate_model,
        detection_interval=detection_interval,
        blur_strength=blur_strength,
        conf=conf,
        lookback_frames=lookback_frames,
        width=width,
        height=height,
        fps=fps,
        tracker_algorithm=tracker_algorithm,
    )

    debug_mgr = (
        _DebugWriter(output_path, input_path, fourcc, fps, (width, height))
        if debug else contextlib.nullcontext()
    )

    try:
        with debug_mgr as debug_ctx, _ReportWriter(report_base, report_format) as report_ctx:
            with tqdm(total=total_frames, unit="frame", desc=input_path.name) as pbar:
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if push_frame(state, frame):
                        _flush_one(state, writer, blur_strength, debug_ctx, report_ctx, tracker_algorithm)
                    pbar.update(1)
                pbar.n = pbar.total
                pbar.refresh()

            while state.frame_buffer:
                _flush_one(state, writer, blur_strength, debug_ctx, report_ctx, tracker_algorithm)
    except Exception:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        raise
    finally:
        cap.release()
        if writer is not None:
            writer.release()

    if not no_video_output:
        success = mux_audio(input_path, temp_path, output_path)
        if not success:
            temp_path.rename(output_path)

    if debug and isinstance(debug_mgr, _DebugWriter):
        print(f"Debug video: {debug_mgr.debug_path}")
    print(f"Report: {report_ctx.report_path}")

    return report_ctx.report_path if no_video_output else output_path
