# video_processor

Blur faces and license plates in video files using YOLOv12 detection and KCF tracking.

## Setup

```bash
# Mac / Linux
bash install.sh
source .venv/bin/activate

# Windows
install.bat
.venv\Scripts\activate
```

Both detection models and FFmpeg are downloaded automatically on first run.

> The install script runs `pip install .` and then fixes an OpenCV package conflict caused by `ultralytics` pulling in `opencv-python` over `opencv-contrib-python` (which is required for the KCF tracker).

## Usage

```bash
video-processor <input.mp4> [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `input` | — | Path to input `.mp4` file |
| `--output PATH` | same dir, `blurred_` prefix | Output file path or directory |
| `--detection-interval N` | `5` | Run YOLO detection every N frames |
| `--blur-strength N` | `51` | Gaussian blur kernel size (must be odd) |
| `--conf F` | `0.25` | Detection confidence threshold |
| `--lookback-frames N` | `60` | Frame buffer size for backward tracking |
| `--debug` | off | Write annotated debug video and CSV |

### Examples

```bash
# Basic usage — output saved as blurred_my_video.mp4 next to the input
video-processor my_video.mp4

# Write output to a specific directory
video-processor my_video.mp4 --output /tmp/

# Write output to a specific file
video-processor my_video.mp4 --output /tmp/result.mp4

# Detect more often, stronger blur
video-processor my_video.mp4 --detection-interval 3 --blur-strength 75

# Enable debug output
video-processor my_video.mp4 --debug
```

## How it works

Detection runs every `--detection-interval` frames using YOLOv12 (faces) and `open_image_models` (license plates) in parallel. Between detection frames, each tracked object is followed by a KCF tracker.

When a new object is detected, a KCF tracker rewinds through a buffer of the last `--lookback-frames` frames to retroactively fill in blur boxes before the object was first detected.

Audio is preserved automatically using the bundled FFmpeg.

## Debug mode

`--debug` produces two additional files alongside the output:

**`debug_<input>.mp4`** — annotated video with color-coded bounding boxes:

| Color | Mode | Meaning |
|-------|------|---------|
| Green | `DETECT` | Frame where YOLO ran |
| Blue-orange | `TRACK` | Frame using KCF tracker output |
| Cyan | `COAST` | Track kept alive without a fresh detection |
| Gray | `LOOKBACK` | Box filled in retroactively via backward tracking |

**`debug_<input>.csv`** — per-frame box data:

```
frame,mode,track_id,category,x1,y1,x2,y2
0,DETECT,0,face,120,45,210,180
1,TRACK,0,face,121,46,211,181
...
```
