from concurrent.futures import ThreadPoolExecutor

import numpy as np
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


def detect_boxes(
    face_model: YOLO,
    plate_model: YOLO,
    frame: np.ndarray,
    conf: float,
    frame_w: int,
    frame_h: int,
) -> tuple[list[Box], list[Box]]:
    """Run parallel YOLO inference. Returns (face_boxes, plate_boxes)."""
    def run(model):
        return model(frame, verbose=False, conf=conf)[0]

    with ThreadPoolExecutor(max_workers=2) as ex:
        f_face = ex.submit(run, face_model)
        f_plate = ex.submit(run, plate_model)
        face_result = f_face.result()
        plate_result = f_plate.result()

    return (
        _extract_boxes(face_result, frame_w, frame_h),
        _extract_boxes(plate_result, frame_w, frame_h),
    )
