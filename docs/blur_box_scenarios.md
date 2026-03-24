# Blur Box Behavior Scenarios

How blur boxes behave from detection through tracking, coasting, and expiration.

## Overview

The system alternates between two frame types:

- **Detection frames** (every `detection_interval` frames, default 5): YOLO models run to find faces and license plates.
- **Tracking frames** (all other frames): CSRT correlation tracker follows previously detected objects.

Each detected object becomes a **Track** with a lifecycle governed by these states:

```
                    ┌─────────────────────────┐
                    │                         │
                    v                         │ (re-detected, IoU match)
[New Detection] --> ACTIVE (fd=0) ────────────┘
                    │
                    │ (not detected on next detection frame)
                    v
                 COASTING (fd=1..max_coast_cycles)
                    │
            ┌───────┴───────┐
            │               │
   (fd > max)         (CSRT fails > max_csrt_fail_frames consecutive tracking frames)
            v               v
         EXPIRED         REMOVED
```

`fd` = `frames_since_detect`, incremented only on detection frames when a track is not matched.

## Key Parameters

| Parameter | Default | Effect |
|-----------|---------|--------|
| `detection_interval` | 5 | Run YOLO every N frames |
| `max_coast_cycles` | 4 | Detection frames without a match before expiring a track |
| `max_csrt_fail_frames` | 2 | Consecutive tracking-frame CSRT failures before removing a track |
| `iou_threshold` | 0.3 | Minimum IoU to match a detection to an existing track |
| `blur_strength` | 51 | Gaussian blur kernel size (must be odd) |
| `conf` | 0.25 | YOLO confidence threshold |

## Detection Matching

Detections are matched to existing tracks using the **Hungarian algorithm** (globally optimal assignment), not greedy first-fit. The match score is `iou * conf` (confidence-weighted), but a pair is only accepted if the raw IoU is ≥ `iou_threshold`. This means:

- High-confidence detections are preferred when two candidates compete for the same track.
- The spatial constraint (IoU ≥ 0.3) is always enforced regardless of confidence.

## Box Position on Detection Frames

When a detection is matched to an existing track, the track's box is **blended** between the CSRT-tracked position and the YOLO detection: `box = 0.7 × yolo + 0.3 × csrt`. The CSRT tracker is then reinitialized from the blended position. This avoids the hard "snap" that would occur if the YOLO box were applied directly.

## Blur Box Rendering

Every frame, all active track boxes are blurred with:
1. **20% expansion** around the center to prevent harsh edges
2. **Gaussian blur** with the configured kernel size
3. **Rounded rectangle mask** (15% corner radius) for smooth blending
4. **Alpha compositing** of blurred region over original

---

## Scenario 1: Object Appears and Stays Visible

A face enters the frame and remains visible continuously.

| Frame | Type | What Happens | Blur Box |
|-------|------|-------------|----------|
| 0 | DETECT | YOLO finds face -> new Track created (id=0, fd=0), CSRT tracker initialized on detected box | Box appears at detected position |
| 1 | TRACK | CSRT `update()` succeeds -> box coordinates updated | Box follows object smoothly |
| 2 | TRACK | CSRT `update()` succeeds | Box follows |
| 3 | TRACK | CSRT `update()` succeeds | Box follows |
| 4 | TRACK | CSRT `update()` succeeds | Box follows |
| 5 | DETECT | YOLO re-detects face, matched to Track 0 via Hungarian IoU matching -> fd reset to 0, box blended (0.7×YOLO + 0.3×CSRT), CSRT reinitialized on blended box | Box moves smoothly to new position |
| 6-9 | TRACK | CSRT tracks | Box follows smoothly |
| 10 | DETECT | Matched again | Cycle continues |

**Takeaway:** Between detections, CSRT provides smooth motion tracking. On detection frames, the box blends toward the model's fresh coordinates rather than snapping abruptly.

---

## Scenario 2: Object Disappears Suddenly (CSRT Fails)

An object leaves the frame or gets fully occluded between detection frames.

| Frame | Type | What Happens | Blur Box |
|-------|------|-------------|----------|
| 0 | DETECT | Face detected, Track created | Box appears |
| 1 | TRACK | CSRT `update()` **fails** (object left frame) -> `frames_since_csrt_fail` = 1 | Box stays at last known position |
| 2 | TRACK | CSRT `update()` **fails** again -> `frames_since_csrt_fail` = 2 | Box stays at last known position |
| 3 | TRACK | CSRT `update()` **fails** again -> `frames_since_csrt_fail` = 3 > `max_csrt_fail_frames` (2) -> **track removed** | **Box disappears** |

**Takeaway:** When CSRT fails, the track persists for up to `max_csrt_fail_frames` (2) consecutive failures, holding the last known box position. This prevents single-frame flicker from momentary tracking loss (e.g., motion blur, fast pan). Only sustained failure removes the track.

---

## Scenario 3: Object Not Re-detected but CSRT Still Tracks (Coasting)

The YOLO model stops detecting an object (e.g., partial occlusion lowers confidence below threshold), but CSRT can still follow it.

| Frame | Type | What Happens | Blur Box |
|-------|------|-------------|----------|
| 0 | DETECT | Face detected, Track created (fd=0) | Box appears |
| 1-4 | TRACK | CSRT tracks successfully | Box follows |
| 5 | DETECT | YOLO does **not** find the face -> fd incremented to 1, track enters coasting | Box stays (last known position from CSRT) |
| 6-9 | TRACK | CSRT still tracks successfully -> box updated | Box continues to follow |
| 10 | DETECT | Still not detected -> fd=2 | Box stays |
| 11-14 | TRACK | CSRT tracks | Box follows |
| 15 | DETECT | Still not detected -> fd=3 | Box stays |
| 16-19 | TRACK | CSRT tracks | Box follows |
| 20 | DETECT | Still not detected -> fd=4 | Box stays (at limit) |
| 21-24 | TRACK | CSRT tracks | Box follows |
| 25 | DETECT | Still not detected -> fd=5 > max_coast_cycles (4) -> **track expired** | **Box disappears** |

**Takeaway:** Coasting keeps a track alive for up to `max_coast_cycles` (4) detection cycles without a YOLO match. During coasting, CSRT still updates the box position. The track is only checked for expiration on detection frames.

---

## Scenario 4: Temporary Occlusion then Re-detection

An object is briefly occluded (1-2 detection cycles) and then becomes visible again.

| Frame | Type | What Happens | Blur Box |
|-------|------|-------------|----------|
| 0 | DETECT | Face detected, Track created (fd=0) | Box appears |
| 1-4 | TRACK | CSRT tracks | Box follows |
| 5 | DETECT | Face occluded, not detected -> fd=1, coasting starts | Box stays |
| 6-9 | TRACK | CSRT may partially track through occlusion | Box moves (or holds last position for up to 2 frames if CSRT fails, then removed) |
| 10 | DETECT | Face visible again, matched via Hungarian IoU -> fd reset to 0, box blended, CSRT reinitialized | Box moves smoothly to fresh detection |
| 11+ | TRACK | Normal tracking resumes | Box follows smoothly |

**Takeaway:** Coasting bridges temporary detection gaps. When re-detected, the track seamlessly continues with the same track ID. If CSRT also fails for more than `max_csrt_fail_frames` frames during the occlusion, the track is removed and a new track is created upon re-detection.

---

## Scenario 5: New Object Appears Mid-Video

A second person walks into frame while another is already being tracked.

| Frame | Type | What Happens | Blur Box |
|-------|------|-------------|----------|
| 0 | DETECT | Face A detected -> Track 0 | 1 box |
| 1-4 | TRACK | CSRT tracks face A. Face B enters frame on frame 3 | 1 box (face B is **not detected** on tracking frames) |
| 5 | DETECT | YOLO detects both faces. Hungarian matching assigns Face A to Track 0 (IoU). Face B has no match -> new Track 1 created | **2 boxes** |
| 6-9 | TRACK | Both CSRT trackers update | 2 boxes follow independently |

**Takeaway:** New objects can **only** be picked up on detection frames. An object entering between detections will be unblurred for up to `detection_interval - 1` frames before being detected. Lower `detection_interval` reduces this gap at the cost of processing speed.

---

## Scenario 6: Two Objects Swap Positions

Two faces cross paths between detection frames.

| Frame | Type | What Happens | Blur Box |
|-------|------|-------------|----------|
| 0 | DETECT | Face A at left (Track 0), Face B at right (Track 1) | 2 boxes |
| 1-4 | TRACK | CSRT tracks both; faces move toward each other and swap sides | 2 boxes follow their targets |
| 5 | DETECT | YOLO detects both faces in swapped positions. Hungarian algorithm finds the globally optimal assignment, reducing (but not eliminating) ID swaps compared to greedy matching | 2 boxes still cover both faces |

**Takeaway:** The Hungarian matcher minimizes ID swaps when objects cross paths. Track ID misassignment does **not** affect blur quality (both faces remain blurred), but it is visible in debug output where track IDs are displayed.
