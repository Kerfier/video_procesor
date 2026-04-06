from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import NamedTuple

import numpy as np
from open_image_models import LicensePlateDetector
from ultralytics import YOLO

Box = tuple[int, int, int, int]

_DETECTION_TIMEOUT_SECONDS = 30


class DetectionTimeoutError(RuntimeError):
    pass


class Detection(NamedTuple):
    box: Box
    conf: float


def _clamp_box(x1: int, y1: int, x2: int, y2: int, w: int, h: int) -> "Box | None":
    """Clamp box coordinates to frame bounds. Returns None if the box is degenerate."""
    x1 = max(0, min(x1, w - 1))
    y1 = max(0, min(y1, h - 1))
    x2 = max(0, min(x2, w))
    y2 = max(0, min(y2, h))
    return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None


def _extract_boxes(result, frame_w: int, frame_h: int) -> list[Detection]:
    detections = []
    for box in result.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        clamped = _clamp_box(x1, y1, x2, y2, frame_w, frame_h)
        if clamped is not None:
            detections.append(Detection(box=clamped, conf=float(box.conf[0])))
    return detections


def _extract_plate_boxes(
    detections_raw, conf: float, frame_w: int, frame_h: int,
) -> list[Detection]:
    detections = []
    for det in detections_raw:
        if det.confidence < conf:
            continue
        bb = det.bounding_box
        clamped = _clamp_box(int(bb.x1), int(bb.y1), int(bb.x2), int(bb.y2), frame_w, frame_h)
        if clamped is not None:
            detections.append(Detection(box=clamped, conf=det.confidence))
    return detections


def detect_boxes(
    face_model: YOLO,
    plate_model: LicensePlateDetector,
    frame: np.ndarray,
    conf: float,
    frame_w: int,
    frame_h: int,
    max_workers: int = 2,
) -> tuple[list[Detection], list[Detection]]:
    """Run parallel YOLO inference. Returns (face_detections, plate_detections).

    Raises DetectionTimeoutError if either model hangs beyond _DETECTION_TIMEOUT_SECONDS.
    """
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        f_face = ex.submit(lambda: face_model(frame, verbose=False, conf=conf)[0])
        f_plate = ex.submit(lambda: plate_model.predict(frame))
        try:
            face_result = f_face.result(timeout=_DETECTION_TIMEOUT_SECONDS)
            plate_detections = f_plate.result(timeout=_DETECTION_TIMEOUT_SECONDS)
        except FuturesTimeoutError as exc:
            raise DetectionTimeoutError(
                f"Detection model timed out after {_DETECTION_TIMEOUT_SECONDS} s"
            ) from exc

    return (
        _extract_boxes(face_result, frame_w, frame_h),
        _extract_plate_boxes(plate_detections, conf, frame_w, frame_h),
    )
