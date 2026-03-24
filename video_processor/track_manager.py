import numpy as np

from .detection import Box
from .track import (
    BoxCategory,
    Track,
    create_csrt_tracker,
    match_detections_to_tracks,
)


class TrackManager:
    def __init__(self, max_coast_cycles: int = 4, iou_threshold: float = 0.3):
        self._tracks: list[Track] = []
        self._next_id: int = 0
        self._max_coast_cycles = max_coast_cycles
        self._iou_threshold = iou_threshold

    def _new_track(
        self, frame: np.ndarray, box: Box, category: BoxCategory
    ) -> Track:
        track = Track(
            track_id=self._next_id,
            category=category,
            box=box,
            tracker=create_csrt_tracker(frame, box),
            max_coast_cycles=self._max_coast_cycles,
        )
        self._next_id += 1
        return track

    def update_detection(
        self,
        frame: np.ndarray,
        face_boxes: list[Box],
        plate_boxes: list[Box],
    ) -> None:
        new_tracks: list[Track] = []

        for category, det_boxes in [
            (BoxCategory.FACE, face_boxes),
            (BoxCategory.PLATE, plate_boxes),
        ]:
            cat_tracks = [t for t in self._tracks if t.category == category]
            matched, unmatched_dets, unmatched_trks = match_detections_to_tracks(
                det_boxes, cat_tracks, self._iou_threshold
            )

            for di, ti in matched:
                track = cat_tracks[ti]
                track.box = det_boxes[di]
                track.frames_since_detect = 0
                track.tracker = create_csrt_tracker(frame, track.box)
                new_tracks.append(track)

            for di in unmatched_dets:
                new_tracks.append(self._new_track(frame, det_boxes[di], category))

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
                x, y, w, h = rect
                track.box = (int(x), int(y), int(x + w), int(y + h))
                alive.append(track)
        self._tracks = alive

    def get_boxes(self) -> list[Box]:
        return [t.box for t in self._tracks]

    def get_debug_info(self, is_detect_frame: bool) -> list[tuple[Box, int, str, str]]:
        result = []
        for t in self._tracks:
            if t.is_coasting:
                mode = "COAST"
            elif is_detect_frame:
                mode = "DETECT"
            else:
                mode = "TRACK"
            result.append((t.box, t.track_id, t.category.value, mode))
        return result
