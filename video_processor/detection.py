from concurrent.futures import ThreadPoolExecutor

import numpy as np
from open_image_models import LicensePlateDetector
from ultralytics import YOLO

Box = tuple[int, int, int, int]


def _extract_boxes(result, frame_w: int, frame_h: int) -> list[Box]:
    boxes = []
    for box in result.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])
        x1 = max(0, min(x1, frame_w - 1))
        y1 = max(0, min(y1, frame_h - 1))
        x2 = max(0, min(x2, frame_w))
        y2 = max(0, min(y2, frame_h))
        if x2 > x1 and y2 > y1:
            boxes.append((x1, y1, x2, y2))
    return boxes


def _extract_plate_boxes(
    detections, conf: float, frame_w: int, frame_h: int,
) -> list[Box]:
    boxes = []
    for det in detections:
        if det.confidence < conf:
            continue
        bb = det.bounding_box
        x1 = max(0, min(int(bb.x1), frame_w - 1))
        y1 = max(0, min(int(bb.y1), frame_h - 1))
        x2 = max(0, min(int(bb.x2), frame_w))
        y2 = max(0, min(int(bb.y2), frame_h))
        if x2 > x1 and y2 > y1:
            boxes.append((x1, y1, x2, y2))
    return boxes


def detect_boxes(
    face_model: YOLO,
    plate_model: LicensePlateDetector,
    frame: np.ndarray,
    conf: float,
    frame_w: int,
    frame_h: int,
) -> tuple[list[Box], list[Box]]:
    """Run parallel YOLO inference. Returns (face_boxes, plate_boxes)."""
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_face = ex.submit(lambda: face_model(frame, verbose=False, conf=conf)[0])
        f_plate = ex.submit(lambda: plate_model.predict(frame))
        face_result = f_face.result()
        plate_detections = f_plate.result()

    return (
        _extract_boxes(face_result, frame_w, frame_h),
        _extract_plate_boxes(plate_detections, conf, frame_w, frame_h),
    )
