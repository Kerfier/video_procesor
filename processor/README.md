# Video Processor

Python service that detects and blurs faces and license plates in video files. Works as a standalone CLI tool for processing a single file, and as a FastAPI streaming service used by the NestJS server.

For CLI quickstart and the fullstack Docker setup, see the [main README](../README.md).

## Contents

- [Setup](#setup)
- [CLI usage](#cli-usage)
- [How blurring works](#how-blurring-works)
- [Streaming API](#streaming-api)
- [Debug mode](#debug-mode)
- [Module reference](#module-reference)

---

## Setup

**Requirements:** Python 3.10+

```bash
# Mac / Linux
bash install.sh

# Windows
install.bat
```

The script creates a `.venv`, installs all dependencies, then removes any conflicting OpenCV packages and reinstalls only `opencv-contrib-python` (required for the KCF tracker). Models and FFmpeg are downloaded automatically on first run and cached in `~/.cache/video_processor/` (macOS/Linux) or `%LOCALAPPDATA%\video_processor\` (Windows).

To also install the streaming server extras:

```bash
.venv/bin/pip install -e ".[server]"
```

---

## CLI usage

```bash
video-processor <input.mp4> [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `input` | — | Path to input `.mp4` file |
| `--output PATH` | same dir, `blurred_` prefix | Output file path or directory |
| `--detection-interval N` | `10` | Run YOLO every N frames |
| `--blur-strength N` | `51` | Gaussian kernel size (must be odd) |
| `--conf F` | `0.25` | Detection confidence threshold |
| `--lookback-frames N` | `20` | Frame buffer size for backward tracking |
| `--tracker` | `kcf` | Tracker to use (`kcf` or `csrt`) |
| `--debug` | off | Write annotated debug video and CSV |

```bash
# Basic — output saved as blurred_my_video.mp4 next to the input
video-processor my_video.mp4

# Write to a specific directory
video-processor my_video.mp4 --output /tmp/

# More frequent detection, stronger blur
video-processor my_video.mp4 --detection-interval 3 --blur-strength 75

# Enable debug output
video-processor my_video.mp4 --debug
```

---

## How blurring works

The pipeline combines periodic YOLO detection with continuous KCF tracking to blur every face and license plate in every frame, without running the expensive neural network on each frame.

### Detection

Every `--detection-interval` frames, two YOLO models run in parallel via `ThreadPoolExecutor`:

- **YOLOv12n-face** (ONNX, ~6 MB) — detects faces. Auto-downloaded from GitHub on first run.
- **yolo-v9-t-384-license-plate-end2end** — detects license plates. Bundled via [`open_image_models`](https://github.com/ankandrew/open-image-models).

Each model returns a list of bounding boxes with confidence scores. Boxes with confidence below `--conf` are discarded.

### Track matching

Detection results are matched to existing tracks using the **Hungarian algorithm** on an IoU cost matrix. A pair is accepted only if raw IoU ≥ 0.3. The match score is `iou × conf`. Detections with no matching track create new tracks.

On matched frames, the track box is blended: `0.7 × YOLO + 0.3 × KCF`, then the KCF tracker is reinitialized on the blended position. This avoids hard snapping and keeps the tracker aligned with the detector.

### Tracking

Between detection frames, each active track is advanced by one frame using **OpenCV KCF** (or **CSRT** if `--tracker-algorithm csrt`). KCF is fast and CPU-only. CSRT is slower but more accurate on non-rigid deformations.

- Tracks where the KCF tracker reports failure are dropped immediately.
- Tracks that go `max_coast_cycles` (4) detection intervals without a matching detection expire.

### Backward tracking

When a new track is created, a second KCF tracker rewinds through the in-memory frame buffer (a `deque` of size `--lookback-frames`) and fills in bounding boxes retroactively — so the object is blurred even before it was first detected.

Frames are held in the buffer until it is full, ensuring backward-tracked boxes are applied before the frame is written to disk.

### Blur application

For each active bounding box:

1. The box is expanded by **20%** in all directions.
2. A **rounded-rectangle alpha mask** is drawn (15% corner radius).
3. **Gaussian blur** is applied with kernel size `--blur-strength` (must be odd).
4. The blurred region is composited back onto the frame using the alpha mask.

### Audio

After all frames are processed, the bundled FFmpeg re-muxes the original audio stream into the output file without re-encoding. No audio quality is lost.

### Full pipeline flow

```
Input file
   │
   ├─ Every detection-interval frames ──► YOLO face model ─┐
   │                                   └► YOLO plate model ─┤
   │                                                         ▼
   │                                          Hungarian IoU matching
   │                                         ┌───────────────────────┐
   │                                         │  Existing tracks       │
   │                                         │  ├─ matched → update   │
   │                                         │  └─ unmatched → expire │
   │                                         │  New detections        │
   │                                         │  └─ no match → create  │
   │                                         │      └─ backward track │
   │                                         └───────────────────────┘
   │
   ├─ Every other frame ────────────────► KCF/CSRT advance each track
   │
   └─ Every frame ──────────────────────► Apply Gaussian blur per box
                                       └► Write frame to output
   │
   └─ After all frames ─────────────────► FFmpeg mux original audio
```

---

## Streaming API

When installed with `.[server]` extras, the processor runs as a FastAPI service that the NestJS server communicates with.

```bash
.venv/bin/uvicorn video_processor.server:app --reload --port 8000
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a push or pull session |
| `GET` | `/sessions/{id}/status` | Get segment count and status |
| `POST` | `/sessions/{id}/segment` | Push mode: submit one `.ts` segment, receive processed bytes |
| `DELETE` | `/sessions/{id}` | Free tracker memory |
| `GET` | `/health` | Health check |

### Push mode (file upload)

NestJS sends individual `.ts` segments one at a time. The processor maintains stateful KCF tracker context across segments so tracking is continuous across segment boundaries.

```bash
# Create session
curl -X POST http://localhost:8000/sessions \
  -H "Content-Type: application/json" \
  -d '{"width": 1280, "height": 720, "fps": 30}'
# → {"session_id": "<uuid>"}

# Send a segment, receive processed bytes
curl -X POST http://localhost:8000/sessions/<id>/segment \
  -F "segment=@input_seg.ts" \
  --output blurred_seg.ts
```

### Pull mode (HLS URL)

The processor fetches an HLS stream directly, processes each segment, and writes `seg_XXXX.ts` files to a shared output directory autonomously. NestJS only polls the status endpoint.

```bash
curl -X POST http://localhost:8000/sessions \
  -H "Content-Type: application/json" \
  -d '{"url": "http://host/stream.m3u8", "output_dir": "/tmp/streams/abc123"}'
```

### Session parameters

| Field | Default | Description |
|-------|---------|-------------|
| `url` | — | HLS playlist URL (pull mode only) |
| `output_dir` | — | Output directory for `.ts` files (pull mode only) |
| `width` / `height` / `fps` | — | Required for push mode |
| `detection_interval` | `10` | Run YOLO every N frames |
| `blur_strength` | `51` | Gaussian kernel size (must be odd) |
| `conf` | `0.25` | Detection confidence threshold |
| `lookback_frames` | `20` | Backward tracking buffer depth |
| `tracker_algorithm` | `kcf` | `kcf` or `csrt` |

Sessions idle for more than 10 minutes are cleaned up automatically.

---

## Debug mode

`--debug` produces two extra files alongside the output:

**`debug_<input>.mp4`** — annotated video with color-coded bounding boxes:

| Color | Mode | Meaning |
|-------|------|---------|
| Green | `DETECT` | Frame where YOLO ran |
| Blue-orange | `TRACK` | Frame using KCF output |
| Cyan | `COAST` | Track kept alive without a fresh detection |
| Gray | `LOOKBACK` | Box filled in retroactively |

**`debug_<input>.csv`** — per-frame box data:

```
frame,mode,track_id,category,x1,y1,x2,y2
0,DETECT,0,face,120,45,210,180
1,TRACK,0,face,121,46,211,181
```

Visualize the CSV overlaid on the original video:

```bash
python scripts/visualize_csv.py debug_input.csv input.mp4
```

---

## Module reference

| File | Responsibility |
|------|----------------|
| `cli.py` | Argument parsing, output path resolution, model loading, pipeline entry |
| `pipeline.py` | Main frame loop, buffer management, backward tracking orchestration |
| `detection.py` | Parallel YOLO inference, box extraction and validation |
| `models.py` | Model loading — face ONNX auto-downloaded from GitHub, plate via open_image_models |
| `track_manager.py` | Track lifecycle: create, match (IoU ≥ 0.3), coast, expire |
| `track.py` | `Track` dataclass, KCF tracker creation, `backward_track()` |
| `frame_ops.py` | `apply_blur()` and `draw_debug_frame()` |
| `audio.py` | Bundled FFmpeg audio detection and mux |
| `streaming.py` | Stateful frame-level pipeline for streaming (`push_frame`, `flush_state`) |
| `server.py` | FastAPI endpoints; pull mode runs a background thread |
| `hls_puller.py` | HLS playlist polling, segment download, exponential-backoff reconnect |
