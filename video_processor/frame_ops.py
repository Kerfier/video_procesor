import cv2
import numpy as np

from .detection import Box

_DEBUG_COLORS = {
    "DETECT": (0, 255, 0),
    "INTERPOLATE": (0, 255, 255),
    "TRACK": (255, 100, 0),
}


def interpolate_boxes(
    boxes_start: list[Box],
    boxes_end: list[Box],
    alpha: float,
) -> list[Box]:
    """Linearly interpolate between two equal-length sets of bounding boxes."""
    result = []
    for (s, e) in zip(boxes_start, boxes_end):
        interp = tuple(int(round(s[i] * (1 - alpha) + e[i] * alpha)) for i in range(4))
        result.append(interp)
    return result


def draw_debug_frame(
    frame: np.ndarray,
    boxes: list[Box],
    frame_idx: int,
    mode: str,
) -> np.ndarray:
    """Annotate a frame with bounding boxes and per-frame metadata for debugging."""
    out = frame.copy()
    color = _DEBUG_COLORS.get(mode, (200, 200, 200))
    for (x1, y1, x2, y2) in boxes:
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(out, f"({x1},{y1})-({x2},{y2})", (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    label = f"frame={frame_idx}  mode={mode}  boxes={len(boxes)}"
    cv2.putText(out, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)
    cv2.putText(out, label, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1)
    return out


def apply_blur(
    frame: np.ndarray,
    boxes: list[Box],
    blur_strength: int,
) -> np.ndarray:
    """Apply Gaussian blur to all bounding box regions. Returns modified frame."""
    k = blur_strength if blur_strength % 2 == 1 else blur_strength + 1
    out = frame.copy()
    h, w = out.shape[:2]
    for (x1, y1, x2, y2) in boxes:
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        roi = out[y1:y2, x1:x2]
        out[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (k, k), 0)
    return out
