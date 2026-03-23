from pathlib import Path

from huggingface_hub import hf_hub_download
from ultralytics import YOLO


def load_models() -> tuple[YOLO, YOLO]:
    """Load face and license plate YOLO models."""
    model_dir = Path(__file__).parent.parent
    face_model = YOLO(str(model_dir / "yolov11n-face.pt"))
    plate_model_path = hf_hub_download(
        repo_id="morsetechlab/yolov11-license-plate-detection",
        filename="license-plate-finetune-v1n.pt",
    )
    plate_model = YOLO(plate_model_path)
    return face_model, plate_model
