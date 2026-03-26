# Video Processor

Blur faces and license plates in video files using YOLO detection and KCF tracking. Supports both batch CLI processing and a streaming HTTP API for segment-by-segment HLS processing.

## Prerequisites

- **Python 3.10+**
- **Git** (to clone the repository)
- No GPU required — all models run on CPU

## Setup

```bash
# Mac / Linux
cd processor
bash install.sh
source .venv/bin/activate

# Windows
cd processor
install.bat
.venv\Scripts\activate
```

Both detection models and FFmpeg are downloaded automatically on first run and cached in `~/.cache/video_processor/` (macOS/Linux) or `%LOCALAPPDATA%\video_processor\` (Windows).

> The install script fixes an OpenCV conflict: `ultralytics` pulls in `opencv-python`, but the KCF tracker requires `opencv-contrib-python`. The script installs everything then swaps the OpenCV package.

To also run the **streaming HTTP server**, install the optional server dependencies:

```bash
# Mac / Linux
cd processor
.venv/bin/pip install -e ".[server]"

# Windows
cd processor
.venv\Scripts\pip install -e ".[server]"
```

## Models

| Target | Model | Source |
|--------|-------|--------|
| Faces | [YOLOv12n-face](https://github.com/YapaLab/yolo-face) (ONNX, ~6 MB) | Auto-downloaded from GitHub on first run |
| License plates | `yolo-v9-t-384-license-plate-end2end` | Bundled via [`open_image_models`](https://github.com/ankandrew/open-image-models) |

Both models run in parallel on every detection frame via `ThreadPoolExecutor`.

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

**Detection** runs every `--detection-interval` frames. YOLOv12n-face and the license plate model run in parallel, and their results are matched to existing tracks via Hungarian IoU matching. New tracks are created for unmatched detections.

**Tracking** runs on every other frame using OpenCV's KCF tracker — fast and lightweight, no GPU required.

**Backward tracking**: when a new object is first detected, a KCF tracker rewinds through the last `--lookback-frames` frames to retroactively blur the object before it was first detected. Frames are held in a buffer until it's full so backward-tracked boxes can be applied before writing.

**Blur**: each box is expanded by 20% and Gaussian-blurred through a rounded-rectangle alpha mask (15% corner radius).

**Audio** is preserved automatically using the bundled FFmpeg, which re-muxes the original audio stream into the output without re-encoding.

## Streaming API

The package also exposes a FastAPI service for HLS segment-based processing. Each session maintains tracker state across segments so blur continuity is preserved at boundaries.

### Start the server

```bash
cd processor
uvicorn video_processor.server:app --port 8000
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a new streaming session |
| `POST` | `/sessions/{id}/segment` | Process one `.ts` segment; returns blurred `.ts` |
| `DELETE` | `/sessions/{id}` | Release session and free tracker memory |

### Create a session

```bash
curl -X POST http://localhost:8000/sessions \
  -H "Content-Type: application/json" \
  -d '{"width": 1280, "height": 720, "fps": 30}'
# → {"session_id": "<uuid>"}
```

| Field | Default | Description |
|-------|---------|-------------|
| `width` | required | Frame width in pixels |
| `height` | required | Frame height in pixels |
| `fps` | required | Frames per second |
| `detection_interval` | `5` | Run YOLO every N frames |
| `blur_strength` | `51` | Gaussian kernel size (must be odd) |
| `conf` | `0.25` | Detection confidence threshold |
| `lookback_frames` | `30` | Lookback buffer depth for backward tracking |

### Process a segment

```bash
curl -X POST http://localhost:8000/sessions/<id>/segment \
  -F "segment=@input_seg.ts" \
  --output blurred_seg.ts
```

Sessions idle for more than 10 minutes are cleaned up automatically.

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
