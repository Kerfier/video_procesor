# Server

NestJS 11 application that orchestrates video anonymization. It accepts video files and HLS stream URLs from the client, drives the Python processing service, and serves processed HLS segments back to the browser.

Related: [main README](../README.md) · [processor/README.md](../processor/README.md) · [client/README.md](../client/README.md)

## Contents

- [Setup](#setup)
- [Architecture](#architecture)
- [Processing flows](#processing-flows)
- [API reference](#api-reference)
- [Environment variables](#environment-variables)
- [Error handling](#error-handling)

---

## Setup

**Requirements:** Node.js ≥ 24, pnpm ≥ 10

```bash
npm install
npm run start:dev     # development with hot reload
npm run build         # compile TypeScript → dist/
npm run start:prod    # production
```

The Python processor must be running at `PYTHON_SERVICE_URL` (default `http://localhost:8000`). See the [processor README](../processor/README.md) for setup.

```bash
# Tests
npm test              # unit tests
npm run test:e2e      # e2e tests
npm run test:cov      # with coverage
```

---

## Architecture

The server is split into focused NestJS modules:

```
AppModule
├── ConfigModule          — env validation (refuses to start on bad config)
├── ServeStaticModule     — serves compiled React SPA from client/dist/
├── HealthModule          — /health and /health/ready endpoints
├── AnonymizationClientModule  — HTTP client to the Python service
├── HlsModule             — ffmpeg subprocess for file segmentation
└── StreamsModule
    ├── StreamsController       — POST/GET/DELETE /api/streams/*
    ├── HlsEgressController     — GET /streams/:id/playlist.m3u8 and segments
    ├── StreamsService          — session repository (in-memory Map)
    ├── UrlStreamProcessor      — pull mode: polls Python status
    └── FileStreamProcessor     — push mode: drives ffmpeg + segment queue
```

### Session state

All sessions live in an in-memory `Map<streamId, StreamSession>`. Node.js is single-threaded so there are no race conditions.

```ts
interface StreamSession {
  streamId: string            // UUID, also the output subdirectory name
  pythonSessionId?: string    // absent for raw passthrough
  status: 'starting' | 'processing' | 'done' | 'error'
  inputType: 'url' | 'file'
  outputDir: string           // OUTPUT_DIR/{streamId}
  outputSegments: OutputSegment[]
  segmentQueue: IQueue | null // null in pull mode
  abortController: AbortController
  error?: string
}
```

Processed segments are written to `OUTPUT_DIR/{streamId}/seg_XXXX.ts` (4-digit zero-padded sequence).

---

## Processing flows

### Pull mode — HLS URL

The Python service fetches and processes the source HLS stream autonomously. NestJS only polls for progress and serves the resulting files.

```
Client                NestJS               Python
  │                     │                    │
  │  POST /start-url    │                    │
  │────────────────────►│  POST /sessions    │
  │                     │───────────────────►│
  │                     │◄─── session_id ────│
  │◄── { streamId } ────│                    │
  │                     │                    │ (fetches + processes HLS in background)
  │                     │  every 500 ms      │
  │                     │  GET /sessions/status
  │                     │───────────────────►│
  │                     │◄─── segment_count ─│
  │  every 2 s          │                    │
  │  GET /status        │                    │
  │────────────────────►│                    │
  │◄── segmentCount ────│                    │
  │                     │                    │
  │  GET playlist.m3u8  │                    │
  │────────────────────►│                    │
  │◄── M3U8 text ───────│                    │
  │  GET seg_XXXX.ts    │                    │
  │────────────────────►│ sendFile from disk │
```

NestJS never touches the segment bytes in pull mode — Python writes them directly to the shared output directory, and NestJS serves them from disk.

### Push mode — file upload

NestJS drives the full pipeline: ffmpeg segments the uploaded file, each segment is sent to Python, the processed bytes are written to disk.

```
Client           NestJS         ffmpeg        Queue        Python
  │               │               │             │             │
  │  POST /upload │               │             │             │
  │──────────────►│  probe file   │             │             │
  │               │──────────────►│             │             │
  │               │◄── w/h/fps ───│             │             │
  │               │  POST /sessions             │             │
  │               │────────────────────────────────────────►  │
  │               │◄────────────────────────── session_id ─── │
  │◄── streamId ──│               │             │             │
  │               │  segmentAndStream()         │             │
  │               │──────────────►│             │             │
  │               │               │  segment    │             │
  │               │               │────────────►│             │
  │               │               │  (non-blocking)           │
  │               │               │             │  POST /segment
  │               │               │             │────────────►│
  │               │               │             │◄─ bytes ────│
  │               │               │             │  write to disk
  │  every 2 s    │               │             │             │
  │  GET /status  │               │             │             │
  │──────────────►│               │             │             │
  │◄── count ─────│               │             │             │
```

The segment queue (`p-queue`, concurrency = 1) sends segments to Python strictly in order. This is required because Python maintains stateful KCF tracker context across segments — out-of-order delivery would corrupt tracking state. The queue also buffers backpressure when ffmpeg produces segments faster than Python processes them.

`p-queue` is ESM-only and is dynamically imported at runtime to avoid top-level CommonJS issues in NestJS.

### Raw passthrough

Identical to push mode, but no Python session is created. The segment handler returns the original bytes unchanged. No processing parameters are accepted.

---

## API reference

### `POST /api/streams/start-url`

Start a pull-mode stream from an HLS URL.

```json
{
  "url": "http://host/stream.m3u8",
  "detectionInterval": 10,
  "blurStrength": 51,
  "conf": 0.25,
  "lookbackFrames": 20,
  "trackerAlgorithm": "kcf"
}
```

Response: `{ "streamId": "<uuid>" }` — returned immediately, processing runs in background.

### `POST /api/streams/upload`

Upload a video file for processing. Multipart form-data: `file` + optional parameters as form fields. Accepted formats: `.mp4`, `.mov`, `.mkv`, `.avi`. Maximum size: 4 GB.

Response: `{ "streamId": "<uuid>" }`

### `POST /api/streams/upload-raw`

Upload a video file without anonymization. Multipart: `file` only.

Response: `{ "streamId": "<uuid>" }`

### `GET /api/streams/:id/status`

```json
{ "status": "processing", "segmentCount": 5 }
{ "status": "done", "segmentCount": 12 }
{ "status": "error", "segmentCount": 3, "error": "message" }
```

### `DELETE /api/streams/:id`

Abort processing (kills ffmpeg subprocess / stops poll loop), delete the Python session, return 204.

### `GET /streams/:id/playlist.m3u8`

HLS media playlist. Always `Cache-Control: no-cache, no-store`.

- **URL mode:** returns last 5 segments (live sliding window) — HLS.js treats this as a live stream.
- **File mode:** returns all segments as an `EVENT` playlist; adds `EXT-X-ENDLIST` when status is `Done`.

### `GET /streams/:id/segments/:filename`

Serves a processed `.ts` segment from disk. Filename is validated against `/^seg_\d{4}\.ts$/` to prevent path traversal.

### `GET /health`

Liveness check. Always returns `{ "status": "ok" }`.

### `GET /health/ready`

Readiness check. Pings the Python service `/health`. Returns 503 if Python is unreachable.

---

## Environment variables

Validated at startup via `class-validator` — the application refuses to start if values are invalid.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | NestJS listen port |
| `PYTHON_SERVICE_URL` | `http://localhost:8000` | Python FastAPI base URL |
| `OUTPUT_DIR` | `/tmp/streams` | Root directory for processed HLS segments |
| `PYTHON_TIMEOUT_MS` | `120000` | HTTP timeout for calls to Python |
| `STREAM_POLL_MS` | `500` | Poll interval for Python status in pull mode |
| `HLS_SEGMENT_DURATION` | `2` | Target segment duration in seconds |
| `SHUTDOWN_DRAIN_TIMEOUT_MS` | `10000` | Max ms to wait for segment queues on shutdown |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary |
| `FFPROBE_PATH` | `ffprobe` | Path to the ffprobe binary |

---

## Error handling

### Python service errors

| Python HTTP status | NestJS behaviour |
|--------------------|-----------------|
| `404` | Re-throws `NotFoundException` |
| `422` (segment endpoint only) | Logs warning, passes original segment bytes through |
| `5xx` / network error | Re-throws `InternalServerErrorException` |

### Stream cancellation

`DELETE /api/streams/:id` calls `abortController.abort()`. The poll loop in `UrlStreamProcessor` checks the signal on each iteration and exits. The ffmpeg child process is killed via its process reference.

### Queue errors

If segment processing throws (other than 422), the queue task clears the pending backlog, sets `session.status = error`, and attempts best-effort Python session deletion.

### Graceful shutdown

`FileStreamProcessor` implements `OnApplicationShutdown`. On SIGTERM it waits up to `SHUTDOWN_DRAIN_TIMEOUT_MS` for all active queues to drain, preventing truncated output files on restarts.
