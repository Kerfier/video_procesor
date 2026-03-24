from dataclasses import dataclass
from enum import Enum

import cv2
import numpy as np

from .detection import Box


class BoxCategory(str, Enum):
    FACE = "face"
    PLATE = "plate"


@dataclass
class Track:
    track_id: int
    category: BoxCategory
    box: Box
    tracker: cv2.legacy.TrackerCSRT
    frames_since_detect: int = 0
    max_coast_cycles: int = 2

    @property
    def is_coasting(self) -> bool:
        return self.frames_since_detect > 0

    @property
    def is_expired(self) -> bool:
        return self.frames_since_detect > self.max_coast_cycles


def create_csrt_tracker(frame: np.ndarray, box: Box) -> cv2.legacy.TrackerCSRT:
    x1, y1, x2, y2 = box
    tracker = cv2.legacy.TrackerCSRT_create()
    tracker.init(frame, (x1, y1, x2 - x1, y2 - y1))
    return tracker


def iou(a: Box, b: Box) -> float:
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def backward_track(
    detection_frame: np.ndarray,
    detection_box: Box,
    preceding_frames_reversed: list[np.ndarray],
) -> list[Box]:
    """Track backward from detection_frame through preceding frames.

    preceding_frames_reversed[0] is frame F-1, [1] is F-2, etc.
    Returns boxes in the same order. Stops when CSRT loses the target.
    """
    tracker = create_csrt_tracker(detection_frame, detection_box)
    results: list[Box] = []
    for frame in preceding_frames_reversed:
        success, rect = tracker.update(frame)
        if not success:
            break
        x, y, w, h = rect
        results.append((int(x), int(y), int(x + w), int(y + h)))
    return results


def match_detections_to_tracks(
    detections: list[Box],
    tracks: list[Track],
    iou_threshold: float = 0.3,
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Greedy IoU matching. Returns (matched_pairs, unmatched_det_indices, unmatched_track_indices)."""
    if not detections or not tracks:
        return [], list(range(len(detections))), list(range(len(tracks)))

    pairs = []
    for di, det in enumerate(detections):
        for ti, trk in enumerate(tracks):
            score = iou(det, trk.box)
            if score >= iou_threshold:
                pairs.append((score, di, ti))

    pairs.sort(reverse=True)

    matched = []
    used_dets: set[int] = set()
    used_trks: set[int] = set()
    for score, di, ti in pairs:
        if di not in used_dets and ti not in used_trks:
            matched.append((di, ti))
            used_dets.add(di)
            used_trks.add(ti)

    unmatched_dets = [i for i in range(len(detections)) if i not in used_dets]
    unmatched_trks = [i for i in range(len(tracks)) if i not in used_trks]
    return matched, unmatched_dets, unmatched_trks
