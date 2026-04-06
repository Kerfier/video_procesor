from dataclasses import dataclass
from enum import Enum

import cv2
import numpy as np
from scipy.optimize import linear_sum_assignment

from .detection import Box, Detection


class BoxCategory(str, Enum):
    FACE = "face"
    PLATE = "plate"


class TrackMode(str, Enum):
    DETECT   = "DETECT"
    TRACK    = "TRACK"
    COAST    = "COAST"
    LOOKBACK = "LOOKBACK"


@dataclass
class Track:
    track_id: int
    category: BoxCategory
    box: Box
    tracker: cv2.legacy.TrackerKCF
    frames_since_detect: int = 0
    frames_since_fail: int = 0
    max_coast_cycles: int = 2
    max_fail_frames: int = 2

    @property
    def is_coasting(self) -> bool:
        return self.frames_since_detect > 0

    @property
    def is_expired(self) -> bool:
        return self.frames_since_detect > self.max_coast_cycles


def create_kcf_tracker(frame: np.ndarray, box: Box) -> cv2.legacy.TrackerKCF:
    x1, y1, x2, y2 = box
    tracker = cv2.legacy.TrackerKCF_create()
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
    Returns boxes in the same order. Stops when the tracker loses the target.
    """
    tracker = create_kcf_tracker(detection_frame, detection_box)
    results: list[Box] = []
    for frame in preceding_frames_reversed:
        success, rect = tracker.update(frame)
        if not success:
            break
        x, y, w, h = rect
        results.append((int(x), int(y), int(x + w), int(y + h)))
    return results


def match_detections_to_tracks(
    detections: list[Detection],
    tracks: list[Track],
    iou_threshold: float = 0.3,
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Hungarian IoU matching weighted by detection confidence.

    Score = iou * conf; threshold enforced on raw IoU to preserve spatial constraint.
    Returns (matched_pairs, unmatched_det_indices, unmatched_track_indices).
    """
    if not detections or not tracks:
        return [], list(range(len(detections))), list(range(len(tracks)))

    n_det = len(detections)
    n_trk = len(tracks)

    # Build cost matrix: cost = 1 - (iou * conf)
    cost = np.ones((n_det, n_trk), dtype=np.float64)
    for di, det in enumerate(detections):
        for ti, trk in enumerate(tracks):
            cost[di, ti] = 1.0 - iou(det.box, trk.box) * det.conf

    row_ind, col_ind = linear_sum_assignment(cost)

    matched = []
    used_dets: set[int] = set()
    used_trks: set[int] = set()
    for di, ti in zip(row_ind, col_ind):
        # Enforce raw-IoU spatial threshold so low-conf detections can't steal tracks
        if iou(detections[di].box, tracks[ti].box) >= iou_threshold:
            matched.append((di, ti))
            used_dets.add(di)
            used_trks.add(ti)

    unmatched_dets = [i for i in range(n_det) if i not in used_dets]
    unmatched_trks = [i for i in range(n_trk) if i not in used_trks]
    return matched, unmatched_dets, unmatched_trks
