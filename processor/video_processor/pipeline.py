import contextlib
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
    """Context manager bundling debug video writer + CSV file.

    Releases both resources in __exit__ so callers need no separate cleanup.
    """

    def __init__(self, output_path: Path, input_path: Path, fourcc, fps: float, size: tuple[int, int]):
        self.debug_path = output_path.parent / f"debug_{input_path.name}"
        self._writer = cv2.VideoWriter(str(self.debug_path), fourcc, fps, size)
        csv_path = output_path.parent / f"debug_{input_path.stem}.csv"
        self._csv = open(csv_path, "w")
        self._csv.write("frame,mode,track_id,category,x1,y1,x2,y2\n")

    def write_frame(self, frame, debug_boxes, idx: int, mode: str) -> None:
        self._writer.write(draw_debug_frame(frame, debug_boxes, idx, mode))

    def write_csv(self, idx: int, dbg) -> None:
        for box, track_id, category, box_mode in dbg:
            x1, y1, x2, y2 = box
            self._csv.write(f"{idx},{box_mode},{track_id},{category},{x1},{y1},{x2},{y2}\n")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self._writer.release()
        self._csv.close()


def _flush_one(
    state,
    writer: cv2.VideoWriter,
    blur_strength: int,
    debug_ctx: "_DebugWriter | None",
) -> None:
    """Flush the oldest buffered frame to writer (and optionally debug_ctx)."""
    frame, boxes, idx, is_det, dbg = pop_oldest_entry(state)
    writer.write(apply_blur(frame, boxes, blur_strength))
    if debug_ctx is not None:
        debug_boxes = [d[0] for d in dbg]
        mode = TrackMode.DETECT if is_det else TrackMode.TRACK
        debug_ctx.write_frame(frame, debug_boxes, idx, mode)
        debug_ctx.write_csv(idx, dbg)


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
) -> Path:
    """Process a single video. Returns path to the final output file."""
    cap, fps, width, height, total_frames = _open_video(input_path)

    temp_path = output_path.parent / f"_tmp_{output_path.stem}.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = _make_video_writer(temp_path, fourcc, fps, (width, height))

    state = create_session_state(
        face_model, plate_model,
        detection_interval=detection_interval,
        blur_strength=blur_strength,
        conf=conf,
        lookback_frames=lookback_frames,
        width=width,
        height=height,
        fps=fps,
    )

    debug_mgr = (
        _DebugWriter(output_path, input_path, fourcc, fps, (width, height))
        if debug else contextlib.nullcontext()
    )

    try:
        with debug_mgr as debug_ctx:
            with tqdm(total=total_frames, unit="frame", desc=input_path.name) as pbar:
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if push_frame(state, frame):
                        _flush_one(state, writer, blur_strength, debug_ctx)
                    pbar.update(1)
                pbar.n = pbar.total
                pbar.refresh()

            while state.frame_buffer:
                _flush_one(state, writer, blur_strength, debug_ctx)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    finally:
        cap.release()
        writer.release()

    success = mux_audio(input_path, temp_path, output_path)
    if not success:
        temp_path.rename(output_path)

    if debug and isinstance(debug_mgr, _DebugWriter):
        print(f"Debug video: {debug_mgr.debug_path}")

    return output_path
