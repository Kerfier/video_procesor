# Client

React 19 single-page application for video anonymization. Users can paste an HLS stream URL or upload a video file; the app starts processing, shows live status, and plays back the blurred stream in the browser as segments become available.

Related: [main README](../README.md) · [server/README.md](../server/README.md) · [processor/README.md](../processor/README.md)

## Contents

- [Setup](#setup)
- [Architecture](#architecture)
- [Components](#components)
- [Hooks](#hooks)
- [API layer](#api-layer)
- [HLS playback](#hls-playback)

---

## Setup

**Requirements:** Node.js ≥ 24, pnpm ≥ 10

```bash
npm install
npm run dev       # dev server → http://localhost:5173
npm run build     # tsc --noEmit + vite build → dist/
npm run lint
npm run format
```

```bash
# Tests (Vitest)
npm test              # run once
npm run test:watch    # watch mode
npm run test:cov      # with coverage
```

The dev server proxies `/api` and `/streams` to `http://localhost:3000` (NestJS), so no CORS configuration is needed during development. In production, NestJS serves the compiled `dist/` directly.

> **React compiler:** This project uses `babel-plugin-react-compiler`. Do **not** add `useCallback`, `useMemo`, or `React.memo` manually — the compiler handles memoization automatically.

---

## Architecture

No client-side routing. A single view transitions between three states driven by the `useStream` hook:

- **Idle** — input panel is active, user can enter a URL or pick a file.
- **Loading** — start request in flight; input is disabled.
- **Active** — stream is running; status badge and video player are shown.

```
App (useStream)
├── InputPanel (tab: url | file)
│   ├── UrlInput → AdvancedSettings
│   └── FileUpload → AdvancedSettings
├── StatusBadge (shown while streamId != null)
└── StreamPlayer (shown when hasEnoughSegments)
```

---

## Components

### `App.tsx`

Root component. Owns the `useStream` hook and passes actions down as props.

- Renders `InputPanel` always (disabled while loading or a stream is active).
- Renders `StatusBadge` while `streamId !== null`.
- Renders `StreamPlayer` only when `hasEnoughSegments` is true — the required segment count is dynamic, based on segment duration (see [HLS playback](#hls-playback)).
- Shows `startError` inline below the input panel on failure.

### `InputPanel.tsx`

Tab container (`url` | `file`). Renders either `UrlInput` or `FileUpload` based on the active tab.

### `UrlInput.tsx`

Form for starting a pull-mode stream from an HLS `.m3u8` URL. Includes an optional `AdvancedSettings` section (collapsed by default).

### `FileUpload.tsx`

Drag-and-drop file uploader. Uses `useFileInput` for file state and drag handlers. Accepted formats: `.mp4`, `.mov`, `.mkv`, `.avi`.

A **Raw passthrough** checkbox hides `AdvancedSettings` and triggers the raw upload path — useful for baseline comparison with no blurring applied.

### `AdvancedSettings.tsx`

Four numeric inputs for processing parameters:

| Field | Default | Range/Step | Description |
|-------|---------|------------|-------------|
| Detection interval | `10` | 3–10, step 1 | Run YOLO every N frames |
| Blur strength | `51` | ≥1, step 2 (odd only) | Gaussian kernel size |
| Confidence | `0.25` | 0.1–1.0, step 0.05 | YOLO detection threshold |
| Lookback frames | `20` | ≥1, step 1 | Backward tracking buffer depth |
| Tracker algorithm | `kcf` | `kcf` \| `csrt` | Tracking algorithm between detection frames |

### `StreamPlayer.tsx`

Video playback component. Wraps a `<video>` element managed by `useHlsPlayer`. Displays the stream ID and a "Stop & Delete" button. Shows an error banner on fatal HLS.js errors.

### `StatusBadge.tsx`

Colored status indicator. Shows a dot, a status label (`processing` / `done` / `error`), the segment count, and an optional error message.

---

## Hooks

### `useStream.ts`

Central state coordinator. Uses `useReducer` internally.

```ts
{
  streamId: string | null
  statusResponse: StreamStatusResponse | null
  isLoading: boolean
  startError: string | null
  startUrl(url, params): Promise<void>
  uploadFile(file, params): Promise<void>
  uploadRawFile(file): Promise<void>
  stop(): Promise<void>
}
```

State machine:

```
Idle ──START──► Loading ──START_OK──► Active ──RESET──► Idle
                    └──START_ERR──► Idle
                                      ↑
                              STATUS updates (stays Active)
```

### `useStatusPoller.ts`

Polls `GET /api/streams/:id/status` every 2 seconds. Stops automatically when `status` is `done` or `error`. Swallows network errors and keeps polling through transient failures.

### `useHlsPlayer.ts`

Manages the HLS.js lifecycle for a given `streamId`.

1. Creates `new Hls(hlsConfig)`.
2. Loads `/streams/{streamId}/playlist.m3u8`.
3. Attaches to the `<video>` element.
4. Listens for fatal errors and exposes them via `hlsError`.
5. **Safari fallback:** if HLS.js is unsupported but native HLS is available, sets `video.src` directly.

Destroys the HLS instance and clears `video.src` on unmount.

### `useAdvancedSettings.ts`

Manages processing parameters and the collapsed/expanded toggle. Returns `{ params, setParams, showAdvanced, toggleAdvanced }`.

### `useFileInput.ts`

Manages file selection and drag-and-drop. Returns `{ file, isDragOver, inputRef, dragHandlers, handleFileChange, formattedSize, formatError }`. Validates MIME type against the allowed format list.

---

## API layer

`streamsApi.ts` is a thin Axios wrapper. All start operations use a 30-second timeout. Paths are relative — the Vite proxy handles routing to NestJS in development; in production all requests are same-origin.

| Function | Method | Path |
|----------|--------|------|
| `startUrlStream(url, params?)` | `POST` | `/api/streams/start-url` |
| `uploadFileStream(file, params?, onProgress?)` | `POST` | `/api/streams/upload` |
| `uploadRawFileStream(file, onProgress?)` | `POST` | `/api/streams/upload-raw` |
| `getStreamStatus(streamId)` | `GET` | `/api/streams/:id/status` |
| `deleteStream(streamId)` | `DELETE` | `/api/streams/:id` |

---

## HLS playback

HLS.js is configured for low-latency streaming:

| Option | Value | Effect |
|--------|-------|--------|
| `enableWorker` | `true` | Parses playlists/segments in a Web Worker |
| `lowLatencyMode` | `true` | Enables low-latency HLS optimizations |
| `maxBufferLength` | `30` | Buffer 30 s ahead of playhead |
| `maxMaxBufferLength` | `60` | Hard cap at 60 s |
| `liveSyncDurationCount` | `2` | Stay 2 target-durations behind the live edge |
| `maxBufferHole` | `0.5` | Tolerate gaps up to 0.5 s before seeking |

The player appears only once `hasEnoughSegments` is true (`useStream.ts`). The threshold adapts to segment duration so HLS.js always has sufficient buffer before starting:

| Segment duration | Minimum segments |
|-----------------|-----------------|
| < 4 s (or unknown) | 3 |
| 4–7 s | 2 |
| ≥ 8 s | 1 |

**URL mode** uses a live sliding window (last 5 segments) — HLS.js treats it as a live stream and keeps fetching new playlists.

**File mode** uses an `EVENT` playlist that grows until `EXT-X-ENDLIST` is added when processing completes.
