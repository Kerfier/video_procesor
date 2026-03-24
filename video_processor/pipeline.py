import sys
from pathlib import Path

import cv2
from tqdm import tqdm
from ultralytics import YOLO

from .audio import mux_audio
from .detection import detect_boxes
from .frame_ops import apply_blur, draw_debug_frame
from .track_manager import TrackManager


def process_video(
    input_path: Path,
    detection_interval: int,
    blur_strength: int,
    conf: float,
    face_model: YOLO,
    plate_model: YOLO,
    debug: bool = False,
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

    output_path = input_path.parent / f"blurred_{input_path.name}"
    temp_path = input_path.parent / f"_tmp_{input_path.stem}.mp4"

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(temp_path), fourcc, fps, (width, height))

    debug_writer = None
    debug_path = None
    csv_file = None
    if debug:
        debug_path = input_path.parent / f"debug_{input_path.name}"
        debug_writer = cv2.VideoWriter(str(debug_path), fourcc, fps, (width, height))
        csv_path = input_path.parent / f"debug_{input_path.stem}.csv"
        csv_file = open(csv_path, "w")
        csv_file.write("frame,mode,track_id,category,x1,y1,x2,y2\n")

    track_mgr = TrackManager()
    frame_idx = 0

    with tqdm(total=total_frames, unit="frame", desc=input_path.name) as pbar:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            is_detect = (frame_idx % detection_interval == 0)

            if is_detect:
                face_boxes, plate_boxes = detect_boxes(
                    face_model, plate_model, frame, conf, width, height
                )
                track_mgr.update_detection(frame, face_boxes, plate_boxes)
            else:
                track_mgr.update_tracking(frame)

            boxes = track_mgr.get_boxes()
            writer.write(apply_blur(frame, boxes, blur_strength))

            if debug_writer is not None:
                debug_info = track_mgr.get_debug_info(is_detect)
                debug_boxes = [d[0] for d in debug_info]
                mode = "DETECT" if is_detect else "TRACK"
                debug_writer.write(draw_debug_frame(frame, debug_boxes, frame_idx, mode))
                if csv_file is not None:
                    for box, track_id, category, box_mode in debug_info:
                        x1, y1, x2, y2 = box
                        csv_file.write(
                            f"{frame_idx},{box_mode},{track_id},{category},{x1},{y1},{x2},{y2}\n"
                        )

            frame_idx += 1
            pbar.update(1)

        pbar.n = pbar.total
        pbar.refresh()

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
