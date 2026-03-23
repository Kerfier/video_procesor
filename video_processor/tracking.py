import cv2
import numpy as np

from .detection import Box


def init_trackers(frame: np.ndarray, boxes: list[Box]) -> list:
    """Create and initialize one CSRT tracker per bounding box."""
    trackers = []
    for (x1, y1, x2, y2) in boxes:
        tracker = cv2.legacy.TrackerCSRT_create()
        tracker.init(frame, (x1, y1, x2 - x1, y2 - y1))
        trackers.append(tracker)
    return trackers


def update_trackers(frame: np.ndarray, trackers: list) -> list[Box | None]:
    """Update all trackers. Returns None for lost trackers."""
    results = []
    for tracker in trackers:
        success, rect = tracker.update(frame)
        if success:
            x, y, w, h = rect
            results.append((int(x), int(y), int(x + w), int(y + h)))
        else:
            results.append(None)
    return results
