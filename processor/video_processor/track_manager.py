from typing import cast

import numpy as np

from .detection import Box, Detection
from .track import (
    BoxCategory,
    Track,
    TrackerAlgorithm,
    TrackMode,
    create_tracker,
    match_detections_to_tracks,
)

_SNAP_ALPHA = 0.7  # Weight toward YOLO position vs KCF on detection frames


def _blend_box(kcf_box: Box, yolo_box: Box, alpha: float = _SNAP_ALPHA) -> Box:
    return cast(Box, tuple(int(alpha * y + (1 - alpha) * c) for y, c in zip(yolo_box, kcf_box)))


class TrackManager:
    def __init__(
        self,
        max_coast_cycles: int = 4,
        iou_threshold: float = 0.3,
        max_fail_frames: int = 2,
        tracker_algorithm: TrackerAlgorithm = "kcf",
    ):
        self._tracks: list[Track] = []
        self._next_id: int = 0
        self._max_coast_cycles = max_coast_cycles
        self._iou_threshold = iou_threshold
        self._max_fail_frames = max_fail_frames
        self._tracker_algorithm = tracker_algorithm
        self._new_track_events: list[tuple[Box, BoxCategory, float, int]] = []

    def _new_track(
        self, frame: np.ndarray, detection: Detection, category: BoxCategory
    ) -> Track:
        track = Track(
            track_id=self._next_id,
            category=category,
            box=detection.box,
            tracker=create_tracker(frame, detection.box, self._tracker_algorithm),
            max_coast_cycles=self._max_coast_cycles,
            max_fail_frames=self._max_fail_frames,
            conf=detection.conf,
        )
        self._next_id += 1
        self._new_track_events.append((detection.box, category, detection.conf, self._next_id - 1))
        return track

    def pop_new_tracks(self) -> list[tuple[Box, BoxCategory, float, int]]:
        events = self._new_track_events
        self._new_track_events = []
        return events

    def update_detection(
        self,
        frame: np.ndarray,
        face_detections: list[Detection],
        plate_detections: list[Detection],
    ) -> None:
        new_tracks: list[Track] = []

        for category, detections in [
            (BoxCategory.FACE, face_detections),
            (BoxCategory.PLATE, plate_detections),
        ]:
            cat_tracks = [t for t in self._tracks if t.category == category]
            matched, unmatched_dets, unmatched_trks = match_detections_to_tracks(
                detections, cat_tracks, self._iou_threshold
            )

            for di, ti in matched:
                track = cat_tracks[ti]
                track.box = _blend_box(track.box, detections[di].box)
                track.frames_since_detect = 0
                track.frames_since_fail = 0
                track.conf = detections[di].conf
                track.tracker = create_tracker(frame, track.box, self._tracker_algorithm)
                new_tracks.append(track)

            for di in unmatched_dets:
                new_tracks.append(self._new_track(frame, detections[di], category))

            for ti in unmatched_trks:
                track = cat_tracks[ti]
                track.frames_since_detect += 1
                if not track.is_expired:
                    new_tracks.append(track)

        self._tracks = new_tracks

    def update_tracking(self, frame: np.ndarray) -> None:
        alive: list[Track] = []
        for track in self._tracks:
            success, rect = track.tracker.update(frame)
            if success:
                track.frames_since_fail = 0
                x, y, w, h = rect
                track.box = (int(x), int(y), int(x + w), int(y + h))
                alive.append(track)
            else:
                track.frames_since_fail += 1
                if track.frames_since_fail <= track.max_fail_frames:
                    alive.append(track)  # keep last known box position
        self._tracks = alive

    def get_boxes(self) -> list[Box]:
        return [t.box for t in self._tracks]

    def get_debug_info(self, is_detect_frame: bool) -> list[tuple[Box, int, str, str, float]]:
        result = []
        for t in self._tracks:
            if t.is_coasting:
                mode = TrackMode.COAST
            elif is_detect_frame:
                mode = TrackMode.DETECT
            else:
                mode = TrackMode.TRACK
            result.append((t.box, t.track_id, t.category.value, mode, t.conf))
        return result
