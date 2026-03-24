import argparse
import sys
from pathlib import Path

from .models import load_models
from .pipeline import process_video


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Blur faces and license plates in a video file."
    )
    parser.add_argument("input", type=str, help="Path to input .mp4 file.")
    parser.add_argument(
        "--detection-interval", type=int, default=5,
        help="Run YOLO detection every N frames (default: 5).",
    )
    parser.add_argument(
        "--blur-strength", type=int, default=51,
        help="Gaussian blur kernel size, must be odd (default: 51).",
    )
    parser.add_argument(
        "--conf", type=float, default=0.25,
        help="Detection confidence threshold (default: 0.25).",
    )
    parser.add_argument(
        "--lookback-frames", type=int, default=60,
        help="Number of frames to buffer for backward tracking when a new object is detected (default: 60).",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Write an annotated debug video and CSV showing box positions and modes.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()

    if not input_path.exists():
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    print("Loading dependencies...")
    face_model, plate_model = load_models()

    output_path = process_video(
        input_path=input_path,
        detection_interval=args.detection_interval,
        blur_strength=args.blur_strength,
        conf=args.conf,
        face_model=face_model,
        plate_model=plate_model,
        debug=args.debug,
        lookback_frames=args.lookback_frames,
    )
    print(f"Output saved: {output_path}")


if __name__ == "__main__":
    main()
