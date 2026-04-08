from __future__ import annotations

import itertools
from collections import deque
from dataclasses import dataclass

import numpy as np
from open_image_models import LicensePlateDetector
from ultralytics import YOLO

from .detection import Box, detect_boxes
from .frame_ops import apply_blur
from .track import TrackerAlgorithm, TrackMode, backward_track
from .track_manager import TrackManager


@dataclass
class StreamingState:
    """Per-session pipeline state shared across segment boundaries.

    Thread-safety contract: All mutating operations (push_frame,
    pop_oldest_entry, pop_oldest_blurred, flush_state, prime_buffer) must be
    called from a **single thread per session**. The buffers and track manager
    are not internally synchronised — concurrent access from multiple threads
    will corrupt state.
    """

    # Config — immutable after creation
    face_model: YOLO
    plate_model: LicensePlateDetector
    detection_interval: int
    blur_strength: int
    conf: float
    lookback_frames: int
    width: int
    height: int
    fps: float
    tracker_algorithm: TrackerAlgorithm

    # Mutable per-stream state
    track_mgr: TrackManager
    frame_buffer: deque[np.ndarray]
    boxes_buffer: deque[list[Box]]          # mutable lists — backward-track appends
    index_buffer: deque[int]
    detect_flag_buffer: deque[bool]
    debug_buffer: deque[list[tuple[Box, int, str, str]]]

    # Global frame counter — persists across segment boundaries
    frame_idx: int = 0
    has_audio: bool | None = None  # cached on first segment, reused thereafter


def create_session_state(
    face_model: YOLO,
    plate_model: LicensePlateDetector,
    *,
    detection_interval: int = 5,
    blur_strength: int = 51,
    conf: float = 0.25,
    lookback_frames: int = 30,
    width: int,
    height: int,
    fps: float,
    tracker_algorithm: TrackerAlgorithm = "kcf",
) -> StreamingState:
    """Construct a fresh streaming state. Call once per stream session."""
    return StreamingState(
        face_model=face_model,
        plate_model=plate_model,
        detection_interval=detection_interval,
        blur_strength=blur_strength,
        conf=conf,
        lookback_frames=lookback_frames,
        width=width,
        height=height,
        fps=fps,
        tracker_algorithm=tracker_algorithm,
        track_mgr=TrackManager(tracker_algorithm=tracker_algorithm),
        frame_buffer=deque(),
        boxes_buffer=deque(),
        index_buffer=deque(),
        detect_flag_buffer=deque(),
        debug_buffer=deque(),
    )


def push_frame(state: StreamingState, frame: np.ndarray) -> bool:
    """
    Accept one BGR frame. Run detect-or-track and update all buffers.

    Returns True when the buffer has reached lookback_frames depth — the
    caller must then call pop_oldest_blurred or pop_oldest_entry to drain
    one entry before the next push_frame call.

    Increments state.frame_idx on every call.
    """
    is_detect = (state.frame_idx % state.detection_interval == 0)

    if is_detect:
        face_detections, plate_detections = detect_boxes(
            state.face_model, state.plate_model,
            frame, state.conf, state.width, state.height,
        )
        state.track_mgr.update_detection(frame, face_detections, plate_detections)
    else:
        state.track_mgr.update_tracking(frame)

    boxes = state.track_mgr.get_boxes()
    debug_info = state.track_mgr.get_debug_info(is_detect)

    # Check capacity BEFORE appending — mirrors pipeline.py ordering.
    # Caller is responsible for popping when this returns True.
    needs_flush = len(state.frame_buffer) == state.lookback_frames

    # Atomic append: if an exception fires mid-way (e.g. OOM), trim all buffers
    # back to their pre-append length to preserve the co-index invariant.
    _pre_len = len(state.frame_buffer)
    try:
        state.frame_buffer.append(frame.copy())
        state.boxes_buffer.append(list(boxes))
        state.index_buffer.append(state.frame_idx)
        state.detect_flag_buffer.append(is_detect)
        state.debug_buffer.append(debug_info)
    except Exception:
        for buf in (
            state.frame_buffer, state.boxes_buffer, state.index_buffer,
            state.detect_flag_buffer, state.debug_buffer,
        ):
            while len(buf) > _pre_len:
                buf.pop()
        raise

    # Backward-track for any newly detected tracks.
    # Build preceding_reversed once by traversing the deque in reverse and
    # skipping the just-appended current frame — avoids per-index lookups.
    new_tracks = state.track_mgr.pop_new_tracks()
    if new_tracks and len(state.frame_buffer) > 1:
        preceding_reversed = list(itertools.islice(reversed(state.frame_buffer), 1, None))
        for det_box, category in new_tracks:
            lookback_boxes = backward_track(frame, det_box, preceding_reversed, state.tracker_algorithm)
            for i, lb_box in enumerate(lookback_boxes):
                buf_idx = len(state.frame_buffer) - 2 - i
                state.boxes_buffer[buf_idx].append(lb_box)
                state.debug_buffer[buf_idx].append(
                    (lb_box, -1, category.value, TrackMode.LOOKBACK)
                )

    state.frame_idx += 1
    return needs_flush


def pop_oldest_entry(
    state: StreamingState,
) -> tuple[np.ndarray, list[Box], int, bool, list]:
    """
    Pop the oldest entry from all buffers and return its raw data as
    (frame, boxes, frame_idx, is_detect, debug_info).

    Used by pipeline.py so it can apply blur and write debug output itself.
    """
    return (
        state.frame_buffer.popleft(),
        state.boxes_buffer.popleft(),
        state.index_buffer.popleft(),
        state.detect_flag_buffer.popleft(),
        state.debug_buffer.popleft(),
    )


def pop_oldest_blurred(state: StreamingState) -> np.ndarray:
    """Pop the oldest entry and return the blurred frame."""
    frame, boxes, _, _, _ = pop_oldest_entry(state)
    return apply_blur(frame, boxes, state.blur_strength)


def flush_state(state: StreamingState) -> list[np.ndarray]:
    """
    Drain all remaining buffered frames and return them blurred.
    The buffer is empty after this call.
    Does NOT reset frame_idx or track_mgr — session state persists for the
    next segment.
    """
    output: list[np.ndarray] = []
    while state.frame_buffer:
        output.append(pop_oldest_blurred(state))
    return output


def prime_buffer(state: StreamingState, frame: np.ndarray) -> None:
    """
    Insert a raw frame into the lookback buffer without running detection or
    tracking. Used after flush_state to re-seed the buffer with tail frames
    from the previous segment so that backward-tracking in the next segment
    can reach across the segment boundary.

    Does not increment frame_idx. Drops the oldest entry if the buffer is
    already at capacity.
    """
    if len(state.frame_buffer) == state.lookback_frames:
        state.frame_buffer.popleft()
        state.boxes_buffer.popleft()
        state.index_buffer.popleft()
        state.detect_flag_buffer.popleft()
        state.debug_buffer.popleft()
    state.frame_buffer.append(frame.copy())
    state.boxes_buffer.append([])
    state.index_buffer.append(state.frame_idx)
    state.detect_flag_buffer.append(False)
    state.debug_buffer.append([])
