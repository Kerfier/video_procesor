from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple

import numpy as np
from open_image_models import LicensePlateDetector
from ultralytics import YOLO

Box = tuple[int, int, int, int]


class Detection(NamedTuple):
    box: Box
    conf: float


def _extract_boxes(result, frame_w: int, frame_h: int) -> list[Detection]:
    detections = []
    for box in result.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        x1 = max(0, min(x1, frame_w - 1))
        y1 = max(0, min(y1, frame_h - 1))
        x2 = max(0, min(x2, frame_w))
        y2 = max(0, min(y2, frame_h))
        if x2 > x1 and y2 > y1:
            detections.append(Detection(box=(x1, y1, x2, y2), conf=float(box.conf[0])))
    return detections


def _extract_plate_boxes(
    detections_raw, conf: float, frame_w: int, frame_h: int,
) -> list[Detection]:
    detections = []
    for det in detections_raw:
        if det.confidence < conf:
            continue
        bb = det.bounding_box
        x1 = max(0, min(int(bb.x1), frame_w - 1))
        y1 = max(0, min(int(bb.y1), frame_h - 1))
        x2 = max(0, min(int(bb.x2), frame_w))
        y2 = max(0, min(int(bb.y2), frame_h))
        if x2 > x1 and y2 > y1:
            detections.append(Detection(box=(x1, y1, x2, y2), conf=det.confidence))
    return detections


def detect_boxes(
    face_model: YOLO,
    plate_model: LicensePlateDetector,
    frame: np.ndarray,
    conf: float,
    frame_w: int,
    frame_h: int,
) -> tuple[list[Detection], list[Detection]]:
    """Run parallel YOLO inference. Returns (face_detections, plate_detections)."""
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_face = ex.submit(lambda: face_model(frame, verbose=False, conf=conf)[0])
        f_plate = ex.submit(lambda: plate_model.predict(frame))
        face_result = f_face.result()
        plate_detections = f_plate.result()

    return (
        _extract_boxes(face_result, frame_w, frame_h),
        _extract_plate_boxes(plate_detections, conf, frame_w, frame_h),
    )
