import argparse
import sys
from pathlib import Path

from .models import load_models
from .pipeline import process_video, VideoOpenError


def _odd_int(value: str) -> int:
    v = int(value)
    if v % 2 == 0:
        raise argparse.ArgumentTypeError(f"blur-strength must be an odd integer, got {v}")
    return v


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Blur faces and license plates in a video file."
    )
    parser.add_argument("input", type=str, help="Path to input .mp4 file.")
    parser.add_argument(
        "--detection-interval", type=int, default=10,
        help="Run YOLO detection every N frames (default: 10).",
    )
    parser.add_argument(
        "--blur-strength", type=_odd_int, default=51,
        help="Gaussian blur kernel size, must be odd (default: 51).",
    )
    parser.add_argument(
        "--conf", type=float, default=0.25,
        help="Detection confidence threshold (default: 0.25).",
    )
    parser.add_argument(
        "--lookback-frames", type=int, default=20,
        help="Number of frames to buffer for backward tracking when a new object is detected (default: 20).",
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Output file path or directory. Defaults to input directory with 'blurred_' prefix.",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Write an annotated debug video and CSV showing box positions and modes.",
    )
    parser.add_argument(
        "--tracker", choices=["kcf", "csrt"], default="kcf",
        help="Tracking algorithm to use between detection frames (default: kcf).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()

    if not input_path.exists():
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    if args.output is None:
        output_path = input_path.parent / f"blurred_{input_path.name}"
    else:
        out = Path(args.output)
        if out.is_dir():
            output_path = out / f"blurred_{input_path.name}"
        else:
            output_path = out

    print("Loading dependencies...")
    face_model, plate_model = load_models()

    try:
        output_path = process_video(
            input_path=input_path,
            output_path=output_path,
            detection_interval=args.detection_interval,
            blur_strength=args.blur_strength,
            conf=args.conf,
            face_model=face_model,
            plate_model=plate_model,
            debug=args.debug,
            lookback_frames=args.lookback_frames,
            tracker_algorithm=args.tracker,
        )
    except VideoOpenError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    print(f"Output saved: {output_path}")


if __name__ == "__main__":
    main()
