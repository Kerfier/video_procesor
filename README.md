# Video Processor

Blur faces and license plates in video files using YOLO detection and KCF tracking. Supports both a standalone CLI tool for file processing and a fullstack web application for real-time HLS streaming.

## Contents

- [CLI Tool](#cli-tool)
- [Fullstack Streaming Application](#fullstack-streaming-application)

---

## CLI Tool

A Python command-line tool for processing local video files. It detects and blurs faces and license plates in an MP4 file and writes the result to a new file with audio preserved. Use this when you have a file on disk and want a simple, one-command workflow with no server infrastructure.

### Prerequisites

- **Python 3.10+**
- **Git** (to clone the repository)
- No GPU required — all models run on CPU

### Setup

```bash
# Mac / Linux
cd processor
bash install.sh

# Windows
cd processor
install.bat
```

Both detection models and FFmpeg are downloaded automatically on first run and cached in `~/.cache/video_processor/` (macOS/Linux) or `%LOCALAPPDATA%\video_processor\` (Windows).

> The install script fixes an OpenCV conflict: `ultralytics` pulls in `opencv-python`, but the KCF tracker requires `opencv-contrib-python`. The script installs everything then swaps the OpenCV package.

### Models

| Target | Model | Source |
|--------|-------|--------|
| Faces | [YOLOv12n-face](https://github.com/YapaLab/yolo-face) (ONNX, ~6 MB) | Auto-downloaded from GitHub on first run |
| License plates | `yolo-v9-t-384-license-plate-end2end` | Bundled via [`open_image_models`](https://github.com/ankandrew/open-image-models) |

Both models run in parallel on every detection frame via `ThreadPoolExecutor`.

### Usage

```bash
video-processor <input.mp4> [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `input` | — | Path to input `.mp4` file |
| `--output PATH` | same dir, `blurred_` prefix | Output file path or directory |
| `--detection-interval N` | `10` | Run YOLO detection every N frames |
| `--blur-strength N` | `51` | Gaussian blur kernel size (must be odd) |
| `--conf F` | `0.25` | Detection confidence threshold |
| `--lookback-frames N` | `20` | Frame buffer size for backward tracking |
| `--tracker` | `kcf` | Tracking algorithm (`kcf` or `csrt`) |
| `--debug` | off | Write annotated debug video and CSV |

#### Examples

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

### How it works

**Detection** runs every `--detection-interval` frames. YOLOv12n-face and the license plate model run in parallel, and their results are matched to existing tracks via Hungarian IoU matching. New tracks are created for unmatched detections.

**Tracking** runs on every other frame using OpenCV's KCF tracker — fast and lightweight, no GPU required.

**Backward tracking**: when a new object is first detected, a KCF tracker rewinds through the last `--lookback-frames` frames to retroactively blur the object before it was first detected. Frames are held in a buffer until it's full so backward-tracked boxes can be applied before writing.

**Blur**: each box is expanded by 20% and Gaussian-blurred through a rounded-rectangle alpha mask (15% corner radius).

**Audio** is preserved automatically using the bundled FFmpeg, which re-muxes the original audio stream into the output without re-encoding.

### Debug mode

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

---

## Fullstack Streaming Application

A three-tier web application for real-time video anonymization over HLS. A React UI lets users either paste an HLS stream URL or upload a video file; NestJS orchestrates segmentation and status polling; Python performs frame-level YOLO detection and KCF blurring on each segment. Processed segments are served back as a playable HLS stream directly in the browser. Use this when you need to anonymize a live or on-demand stream, or want a browser-based workflow without touching the command line.

<img src="docs/video-processor.png" width="600" alt="Video Processor UI">

### Prerequisites

**Docker (recommended):** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac/Windows) or Docker Engine + Compose v2 (Linux). No local Python or Node.js installation required.

**Local (manual):** Python 3.10+, Node.js ≥ 24, pnpm ≥ 10.

### Quickstart — Docker

The easiest way to run the full stack with a single command.

```bash
# Mac / Linux
bash run.sh

# Windows
run.bat
```

On **first run** the processor downloads the YOLO models (~30 MB) into a named Docker volume. Subsequent starts are instant. Open **http://localhost:3000** once the script reports "Ready!".

#### Services

| Service | Internal address | Host port |
|---------|-----------------|-----------|
| NestJS server + React UI | `http://server:3000` | **3000** |
| Python processor (FastAPI) | `http://processor:8000` | not exposed |

#### Volumes

| Volume | Mount path | Purpose |
|--------|-----------|---------|
| `streams_data` | `/tmp/streams` (both services) | Processed HLS segments |
| `model_cache` | `/root/.cache/video_processor` (processor) | Downloaded YOLO weights, persisted across restarts |

#### Common commands

```bash
docker compose logs -f                # stream logs from all services
docker compose logs -f processor      # processor logs only
docker compose down                   # stop (volumes preserved)
docker compose down -v                # stop and delete all volumes
docker compose build && docker compose up -d  # rebuild after code changes
```

### Running locally (manual)

Start all three services in separate terminals:

```bash
# Terminal 1 — Python anonymization service
cd processor
bash install.sh                                              # first time only
.venv/bin/pip install -e ".[server]"                        # first time only
.venv/bin/uvicorn video_processor.server:app --reload --port 8000

# Terminal 2 — NestJS orchestration server
cd server && npm run start:dev

# Terminal 3 — React dev server
cd client && npm run dev   # → http://localhost:5173
```

### Input modes

| Mode | Description |
|------|-------------|
| **URL (pull)** | Paste an HLS `.m3u8` URL. Python fetches and processes segments directly; NestJS polls Python status every 500 ms and relays it to the client. |
| **File upload (push)** | Upload an MP4 file (up to 4 GB). NestJS segments via ffmpeg stream copy (2 s segments, no re-encoding) and sends each `.ts` to Python sequentially. |
| **File upload (raw)** | Upload without any processing — ffmpeg segments to HLS via stream copy but no blurring is applied. Useful for baseline comparison. No advanced settings. |

**Example public HLS stream:** `http://qthttp.apple.com.edgesuite.net/1010qwoeiuryfg/sl.m3u8`

The React client polls NestJS for status every 2 seconds. The HLS player (hls.js) appears automatically once **3 segments** are ready.

### Advanced settings

Available for URL and file upload (push) modes:

| Setting | Default | Description |
|---------|---------|-------------|
| Detection interval | `10` | Run YOLO every N frames |
| Blur strength | `51` | Gaussian kernel size (odd numbers only) |
| Confidence | `0.25` | YOLO detection confidence threshold |
| Lookback frames | `20` | Backward tracking depth |
| Tracker algorithm | `kcf` | KCF or CSRT tracker (`kcf` \| `csrt`) |

### API reference

- Python FastAPI service (port 8000): see [processor/README.md → Streaming API](processor/README.md#streaming-api)
- NestJS server (port 3000): see [server/README.md → API reference](server/README.md#api-reference)

### Environment variables

See [server/README.md → Environment variables](server/README.md#environment-variables) for the full list.

---

Detailed architecture docs: [processor/README.md](processor/README.md) · [server/README.md](server/README.md) · [client/README.md](client/README.md)
