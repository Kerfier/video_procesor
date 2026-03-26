import sys
from pathlib import Path

import cv2
from tqdm import tqdm
from open_image_models import LicensePlateDetector
from ultralytics import YOLO

from .audio import mux_audio
from .frame_ops import apply_blur, draw_debug_frame
from .streaming import create_session_state, push_frame, pop_oldest_entry


def process_video(
    input_path: Path,
    output_path: Path,
    detection_interval: int,
    blur_strength: int,
    conf: float,
    face_model: YOLO,
    plate_model: LicensePlateDetector,
    debug: bool = False,
    lookback_frames: int = 60,
) -> Path:
    """Process a single video. Returns path to the final output file."""
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        print(f"Error: cannot open video: {input_path}", file=sys.stderr)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    temp_path = output_path.parent / f"_tmp_{output_path.stem}.mp4"

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(temp_path), fourcc, fps, (width, height))

    debug_writer = None
    debug_path = None
    csv_file = None
    if debug:
        debug_path = output_path.parent / f"debug_{input_path.name}"
        debug_writer = cv2.VideoWriter(str(debug_path), fourcc, fps, (width, height))
        csv_path = output_path.parent / f"debug_{input_path.stem}.csv"
        csv_file = open(csv_path, "w")
        csv_file.write("frame,mode,track_id,category,x1,y1,x2,y2\n")

    state = create_session_state(
        face_model, plate_model,
        detection_interval=detection_interval,
        blur_strength=blur_strength,
        conf=conf,
        lookback_frames=lookback_frames,
        width=width,
        height=height,
        fps=fps,
    )

    def flush_oldest_to_writers() -> None:
        frame, boxes, idx, is_det, dbg = pop_oldest_entry(state)
        writer.write(apply_blur(frame, boxes, blur_strength))
        if debug_writer is not None:
            debug_boxes = [d[0] for d in dbg]
            mode = "DETECT" if is_det else "TRACK"
            debug_writer.write(draw_debug_frame(frame, debug_boxes, idx, mode))
            if csv_file is not None:
                for box, track_id, category, box_mode in dbg:
                    x1, y1, x2, y2 = box
                    csv_file.write(
                        f"{idx},{box_mode},{track_id},{category},{x1},{y1},{x2},{y2}\n"
                    )

    with tqdm(total=total_frames, unit="frame", desc=input_path.name) as pbar:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if push_frame(state, frame):
                flush_oldest_to_writers()
            pbar.update(1)

        pbar.n = pbar.total
        pbar.refresh()

    # Drain remaining buffer
    while state.frame_buffer:
        flush_oldest_to_writers()

    cap.release()
    writer.release()
    if debug_writer is not None:
        debug_writer.release()
    if csv_file is not None:
        csv_file.close()

    success = mux_audio(input_path, temp_path, output_path)
    if not success:
        temp_path.rename(output_path)

    if debug and debug_path is not None:
        print(f"Debug video: {debug_path}")

    return output_path
