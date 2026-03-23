# video_processor

Blur faces and license plates in video files using YOLOv11 detection, CSRT tracking, and linear interpolation.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install PyTorch first (see https://pytorch.org/get-started/locally/ for your platform)
pip install torch torchvision

# Install remaining dependencies
pip install -r requirements.txt
```

## Models

| File | Source |
|------|--------|
| `yolov11n-face.pt` | [akanametov/yolo-face](https://huggingface.co/akanametov/yolo-face) — download manually and place in project root |
| License plate model | [morsetechlab/yolov11-license-plate-detection](https://huggingface.co/morsetechlab/yolov11-license-plate-detection) — downloaded automatically via `huggingface_hub` |

## Usage

```bash
python video_processor.py <input.mp4> [options]
```

| Argument | Default | Description |
|----------|---------|-------------|
| `input` | — | Path to input `.mp4` file |
| `--detection-interval N` | `7` | Run YOLO detection every N frames |
| `--blur-strength N` | `51` | Gaussian blur kernel size (must be odd) |
| `--conf F` | `0.2` | Detection confidence threshold |
| `--debug` | off | Write annotated debug video and CSV |

Output is saved as `blurred_<input>.mp4` in the same directory. Audio is preserved if `ffmpeg` is available.

### Examples

```bash
# Basic usage
python video_processor.py my_video.mp4

# Detect more often, stronger blur
python video_processor.py my_video.mp4 --detection-interval 3 --blur-strength 75

# Enable debug output
python video_processor.py my_video.mp4 --debug
```

## How it works

Detection runs every `--detection-interval` frames (default: every 7th frame). Between detections, each detected object is tracked using a CSRT tracker.

When both the start and end of a segment have the **same number of detected boxes**, positions are **linearly interpolated** frame-by-frame — each box smoothly slides from its start coordinates to its end coordinates. If the box counts differ (an object appeared or disappeared), the tracker output is used instead.

The final trailing segment (no future detection available) always uses the last known detection for the first frame and tracker results for the rest.

## Debug mode

`--debug` produces two additional files alongside the output:

**`debug_<input>.mp4`** — annotated video with color-coded bounding boxes:

| Color | Mode | Meaning |
|-------|------|---------|
| Green | `DETECT` | Frame where YOLO ran |
| Cyan | `INTERPOLATE` | Frame with linearly interpolated box |
| Blue-orange | `TRACK` | Frame using CSRT tracker output |

Each box is labeled with its coordinates. Frame index and mode are shown in the top-left corner.

**`debug_<input>.csv`** — per-frame box data:

```
frame,mode,box_idx,x1,y1,x2,y2
0,DETECT,0,120,45,210,180
1,INTERPOLATE,0,121,46,211,181
...
```

## Known limitations

**Interpolation box-order sensitivity** — interpolation pairs start/end boxes by position in the list using `zip`. If the model returns the same number of boxes between two detection frames but in a different order (e.g. two faces swapped), each box will interpolate toward the wrong target. The blur region will visibly slide across the frame between the two objects rather than staying on them. This does not affect frames that fall back to tracker mode.
