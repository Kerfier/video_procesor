import cv2
import numpy as np

from .detection import Box

_BOX_EXPAND_FACTOR   = 1.2   # 20% padding around detected box
_CORNER_RADIUS_RATIO = 0.15  # Rounded-corner radius as fraction of shorter side

_CATEGORY_COLORS = {
    "face":  (0, 255, 0),    # green (BGR)
    "plate": (255, 0, 0),    # blue (BGR)
}


def draw_debug_frame(
    frame: np.ndarray,
    debug_entries: list[tuple[Box, int, str, str, float]],
    frame_idx: int,
) -> np.ndarray:
    """Annotate a frame with bounding boxes and per-frame metadata for debugging."""
    out = frame.copy()
    for (x1, y1, x2, y2), _track_id, category, _mode, _conf in debug_entries:
        color = _CATEGORY_COLORS.get(category, (200, 200, 200))
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        cv2.putText(out, category, (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    label = f"frame={frame_idx}  boxes={len(debug_entries)}"
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
        # Expand box by 20%
        bw = x2 - x1
        bh = y2 - y1
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        bw *= _BOX_EXPAND_FACTOR
        bh *= _BOX_EXPAND_FACTOR
        x1 = max(0, int(cx - bw / 2))
        y1 = max(0, int(cy - bh / 2))
        x2 = min(w, int(cx + bw / 2))
        y2 = min(h, int(cy + bh / 2))
        if x2 <= x1 or y2 <= y1:
            continue
        roi = out[y1:y2, x1:x2]
        blurred_roi = cv2.GaussianBlur(roi, (k, k), 0)
        # Create rounded rectangle mask
        mask = np.zeros((y2 - y1, x2 - x1), dtype=np.uint8)
        radius = int(min(bw, bh) * _CORNER_RADIUS_RATIO)
        cv2.rectangle(mask, (radius, 0), (x2 - x1 - radius, y2 - y1), 255, -1)
        cv2.rectangle(mask, (0, radius), (x2 - x1, y2 - y1 - radius), 255, -1)
        cv2.circle(mask, (radius, radius), radius, 255, -1)
        cv2.circle(mask, (x2 - x1 - radius, radius), radius, 255, -1)
        cv2.circle(mask, (radius, y2 - y1 - radius), radius, 255, -1)
        cv2.circle(mask, (x2 - x1 - radius, y2 - y1 - radius), radius, 255, -1)
        mask_3c = mask[:, :, np.newaxis] / 255.0
        out[y1:y2, x1:x2] = (blurred_roi * mask_3c + roi * (1 - mask_3c)).astype(np.uint8)
    return out
