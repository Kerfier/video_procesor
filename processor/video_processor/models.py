import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from open_image_models import LicensePlateDetector
from tqdm import tqdm
from ultralytics import YOLO

_FACE_MODEL_URL = "https://github.com/YapaLab/yolo-face/releases/download/1.0.0/yolov12n-face.onnx"
_FACE_MODEL_NAME = "yolov12n-face.onnx"


def _model_cache_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "video_processor"


def _ensure_face_model() -> Path:
    dest = _model_cache_dir() / _FACE_MODEL_NAME
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading face model to {dest} ...")
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    try:
        with urllib.request.urlopen(_FACE_MODEL_URL) as response:
            total = int(response.headers.get("Content-Length", 0))
            with tqdm(total=total or None, unit="B", unit_scale=True, desc=_FACE_MODEL_NAME) as bar:
                with open(tmp, "wb") as f:
                    while chunk := response.read(65536):
                        f.write(chunk)
                        bar.update(len(chunk))
    except urllib.error.URLError as exc:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f"Failed to download face model from {_FACE_MODEL_URL}: {exc}"
        ) from exc
    tmp.rename(dest)
    return dest


def load_models() -> tuple[YOLO, LicensePlateDetector]:
    """Load face and license plate detection models."""
    face_model = YOLO(str(_ensure_face_model()), task="detect")
    plate_model = LicensePlateDetector(
        detection_model="yolo-v9-t-384-license-plate-end2end",
        providers=["CPUExecutionProvider"],
    )
    return face_model, plate_model
