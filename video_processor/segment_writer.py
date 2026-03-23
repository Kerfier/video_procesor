import cv2

from .detection import Box
from .frame_ops import apply_blur, draw_debug_frame, interpolate_boxes


def flush_segment(
    segment: list,
    boxes_start: list[Box],
    boxes_end: list[Box],
    writer: cv2.VideoWriter,
    blur_strength: int,
    frame_offset: int = 0,
    debug_writer: cv2.VideoWriter | None = None,
    csv_file=None,
) -> None:
    """Write a complete segment using interpolated boxes between two detection frames."""
    n = len(segment)
    if n == 0:
        return
    can_interpolate = len(boxes_start) == len(boxes_end)
    for i, entry in enumerate(segment):
        frame, tracked = entry
        alpha = i / (n - 1) if n > 1 else 0.0
        if can_interpolate and boxes_start:
            boxes = interpolate_boxes(boxes_start, boxes_end, alpha)
            mode = "DETECT" if i == 0 else "INTERPOLATE"
        else:
            boxes = [b for b in (tracked or []) if b is not None]
            mode = "DETECT" if i == 0 else "TRACK"
        writer.write(apply_blur(frame, boxes, blur_strength))
        abs_idx = frame_offset + i
        if debug_writer is not None:
            debug_writer.write(draw_debug_frame(frame, boxes, abs_idx, mode))
        if csv_file is not None:
            for bi, (x1, y1, x2, y2) in enumerate(boxes):
                csv_file.write(f"{abs_idx},{mode},{bi},{x1},{y1},{x2},{y2}\n")


def flush_final_segment(
    segment: list,
    boxes_start: list[Box],
    writer: cv2.VideoWriter,
    blur_strength: int,
    frame_offset: int = 0,
    debug_writer: cv2.VideoWriter | None = None,
    csv_file=None,
) -> None:
    """Write the trailing segment where no future detection is available."""
    for i, entry in enumerate(segment):
        frame, tracked = entry
        if i == 0:
            boxes = boxes_start
            mode = "DETECT"
        else:
            boxes = [b for b in (tracked or []) if b is not None]
            mode = "TRACK"
        writer.write(apply_blur(frame, boxes, blur_strength))
        abs_idx = frame_offset + i
        if debug_writer is not None:
            debug_writer.write(draw_debug_frame(frame, boxes, abs_idx, mode))
        if csv_file is not None:
            for bi, (x1, y1, x2, y2) in enumerate(boxes):
                csv_file.write(f"{abs_idx},{mode},{bi},{x1},{y1},{x2},{y2}\n")
