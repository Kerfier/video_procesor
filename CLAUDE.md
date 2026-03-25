# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (use the script to fix the opencv-python/opencv-contrib-python conflict)
bash install.sh   # Windows: install.bat

# Run the processor
video-processor input.mp4

# Common options
video-processor input.mp4 --output /path/to/output.mp4 --detection-interval 5 --blur-strength 51 --conf 0.25 --lookback-frames 60 --debug

# Visualize debug CSV output
python scripts/visualize_csv.py debug_input.csv input.mp4
```

## Architecture

The pipeline uses **periodic YOLO detection + continuous KCF tracking** to blur faces and license plates in video files while preserving audio.

### Processing Flow

1. **Detection frames** (every `--detection-interval` frames): Run YOLOv12 face + plate models in parallel (ThreadPoolExecutor), match results to existing tracks via Hungarian IoU matching, create new tracks for unmatched detections.
2. **Tracking frames**: Advance each active KCF tracker one frame; drop tracks where the tracker fails.
3. **Backward tracking**: When a new track is created, a KCF tracker rewinds through the in-memory frame buffer (`deque` of size `lookback_frames`) to find earlier positions of the object, filling in boxes retroactively.
4. **Delayed write**: Frames are held in the buffer until it's full, so backward-tracked boxes can be applied before the frame is written.
5. **Blur & mux**: `frame_ops.apply_blur()` applies Gaussian blur with a rounded-rectangle alpha mask (20% expansion, 15% corner radius). After processing, bundled FFmpeg re-muxes the original audio into the output.

### Key modules

| File | Responsibility |
|---|---|
| `cli.py` | Argument parsing, output path resolution, model loading, pipeline entry point |
| `pipeline.py` | Main frame loop, buffer management, backward tracking orchestration |
| `detection.py` | Parallel YOLO inference, box extraction and validation |
| `models.py` | Model loading (face ONNX auto-downloaded from GitHub + plate via open_image_models) |
| `track_manager.py` | Track lifecycle: create, match (IoU ≥ 0.3), coast, expire |
| `track.py` | `Track` dataclass, KCF tracker creation, `backward_track()` |
| `frame_ops.py` | `apply_blur()` and `draw_debug_frame()` |
| `audio.py` | Bundled ffmpeg audio detection and mux via imageio-ffmpeg |

### Track lifecycle

Tracks coast up to `max_coast_cycles` (4) detection intervals without a matching detection before expiring. The `frames_since_detect` counter drives `is_coasting` and `is_expired` properties. See `docs/blur_box_scenarios.md` for detailed lifecycle scenarios.

### Debug output

With `--debug`, the pipeline writes `debug_<input>.mp4` (annotated frames) and `debug_<input>.csv` (per-frame box coordinates + mode). Use `scripts/visualize_csv.py` to overlay CSV annotations on the original video for analysis.
