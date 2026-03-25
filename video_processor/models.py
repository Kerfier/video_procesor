from pathlib import Path

from open_image_models import LicensePlateDetector
from ultralytics import YOLO


def load_models() -> tuple[YOLO, LicensePlateDetector]:
    """Load face and license plate detection models."""
    model_dir = Path(__file__).parent.parent
    face_model = YOLO(str(model_dir / "yolov12n-face.onnx"), task="detect")

    plate_model = LicensePlateDetector(
        detection_model="yolo-v9-t-384-license-plate-end2end",
    )
    return face_model, plate_model
