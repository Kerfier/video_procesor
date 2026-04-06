"""HLS pull loop for URL-based streaming sessions.

Downloads segments from an HLS playlist, processes each one through the
provided processing function, and writes the output to disk.

Run inside a daemon thread via server._run_pull_session — never call directly
from an async context.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable
from urllib.parse import urljoin
import logging

import requests

if TYPE_CHECKING:
    from .streaming import StreamingState

logger = logging.getLogger("hls_puller")

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_STREAM_INF_RE = re.compile(r"#EXT-X-STREAM-INF:.*?BANDWIDTH=(\d+)", re.IGNORECASE)
_EXTINF_RE = re.compile(r"#EXTINF:([\d.]+)")
_ENDLIST_TAG = "#EXT-X-ENDLIST"
_MEDIA_SEQUENCE_RE = re.compile(r"#EXT-X-MEDIA-SEQUENCE:(\d+)")


def _fetch_text(url: str, session: requests.Session, timeout: int = 10) -> str:
    resp = session.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def _fetch_bytes(url: str, session: requests.Session, timeout: int = 30) -> bytes:
    resp = session.get(url, stream=False, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def _resolve_media_url(url: str, http: requests.Session) -> str:
    """Return the media playlist URL.

    If *url* is a master playlist (contains #EXT-X-STREAM-INF), pick the
    highest-bandwidth variant and return its absolute URL. Otherwise return
    *url* unchanged.
    """
    text = _fetch_text(url, http)
    matches = _STREAM_INF_RE.findall(text)
    if not matches:
        # Already a media playlist
        return url

    # Pick highest-bandwidth variant
    lines = text.splitlines()
    best_bw = -1
    best_uri = None
    for i, line in enumerate(lines):
        m = _STREAM_INF_RE.match(line)
        if m:
            bw = int(m.group(1))
            # Next non-empty line is the variant URI
            for j in range(i + 1, len(lines)):
                variant_uri = lines[j].strip()
                if variant_uri and not variant_uri.startswith("#"):
                    if bw > best_bw:
                        best_bw = bw
                        best_uri = variant_uri
                    break

    if best_uri is None:
        raise ValueError(f"Master playlist at {url!r} has no usable variants")

    return urljoin(url, best_uri)


# ---------------------------------------------------------------------------
# HLSPlaylist dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HLSPlaylist:
    segments: list[tuple[int, str, float]]  # (seq, url, duration)
    is_end: bool

    @staticmethod
    def parse(text: str, base_url: str) -> HLSPlaylist:
        """Parse a media playlist into an HLSPlaylist."""
        lines = text.splitlines()
        base_seq = 0
        m = _MEDIA_SEQUENCE_RE.search(text)
        if m:
            base_seq = int(m.group(1))

        segments: list[tuple[int, str, float]] = []
        duration = 2.0
        seq = base_seq
        for line in lines:
            line = line.strip()
            mext = _EXTINF_RE.match(line)
            if mext:
                duration = float(mext.group(1))
                continue
            if line and not line.startswith("#"):
                segments.append((seq, urljoin(base_url, line), duration))
                seq += 1
                duration = 2.0

        return HLSPlaylist(segments=segments, is_end=_ENDLIST_TAG in text)


def _fetch_new_segments(
    playlist: HLSPlaylist,
    seen_seqs: set[int],
) -> list[tuple[int, str, float]]:
    """Return segments from *playlist* whose sequence numbers are not in *seen_seqs*."""
    return [(seq, url, dur) for seq, url, dur in playlist.segments if seq not in seen_seqs]


def _download_segment(
    seq: int,
    url: str,
    http: requests.Session,
    stop_event: threading.Event,
) -> bytes | None:
    """Download one segment. Returns None if stop_event is set. Raises on HTTP error."""
    if stop_event.is_set():
        return None
    return _fetch_bytes(url, http)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def pull_and_process(
    url: str,
    output_dir: Path,
    state: StreamingState,
    process_fn: Callable[[StreamingState, bytes], bytes],
    stop_event: threading.Event,
    on_segment_written: Callable[[int], None],
    max_consecutive_errors: int = 10,
    max_passthrough: int = 3,
) -> None:
    """Blocking HLS pull loop.

    Downloads segments from *url*, calls *process_fn(state, ts_bytes) -> bytes*
    for each, and writes the result to *output_dir/seg_{n:04d}.ts*.

    Runs until:
    - #EXT-X-ENDLIST is seen in the playlist (VOD end)
    - *stop_event* is set (caller signalled stop)
    - An unrecoverable error occurs (raises)

    Reconnect behaviour on network/HTTP errors: exponential backoff starting
    at 2 s, capped at 30 s. After *max_consecutive_errors* consecutive failures
    (playlist fetch or segment download combined) the function raises so the
    caller can mark the session as errored instead of leaking the thread.

    After *max_passthrough* consecutive processing failures the function raises
    rather than silently falling back to raw passthrough indefinitely.

    Args:
        url: HLS playlist URL (master or media).
        output_dir: Directory to write processed segments into.
        state: StreamingState — passed through to process_fn.
        process_fn: Callable (state, bytes) -> bytes. Should raise
            _DecodeError (from server.py) on corrupt input — in that case
            the raw unprocessed bytes are written instead (passthrough).
        stop_event: Set this to cleanly stop the loop.
        on_segment_written: Called with (sequence: int) after each write.
        max_consecutive_errors: Max consecutive network/fetch failures before raising.
        max_passthrough: Max consecutive processing failures before raising.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    with requests.Session() as http:
        http.headers["User-Agent"] = "video-processor-hls-puller/1.0"

        # Resolve master → media playlist URL once
        media_url = _resolve_media_url(url, http)

        seen_seqs: set[int] = set()
        output_seq = 0          # monotonic counter for output filenames
        backoff = 2.0
        consecutive_errors = 0
        consecutive_passthrough = 0

        while not stop_event.is_set():
            try:
                playlist_text = _fetch_text(media_url, http)
                playlist = HLSPlaylist.parse(playlist_text, media_url)
                consecutive_errors = 0
                backoff = 2.0
            except requests.HTTPError as exc:
                status = exc.response.status_code if exc.response is not None else None
                if status is not None and status < 500 and status != 429:
                    # 4xx (except 429 Too Many Requests) — permanent; give up immediately
                    raise RuntimeError(
                        f"Permanent HTTP {status} fetching playlist {media_url!r}; giving up"
                    ) from exc
                # 5xx or 429 — transient; apply backoff
                consecutive_errors += 1
                wait = min(backoff, 30.0)
                backoff = min(backoff * 2, 30.0)
                logger.warning(
                    f"Playlist fetch HTTP error {status} (#{consecutive_errors}); "
                    f"retrying in {wait:.0f}s",
                    exc_info=True,
                )
                if consecutive_errors >= max_consecutive_errors:
                    raise RuntimeError(
                        f"Playlist fetch failed {consecutive_errors} times consecutively; giving up"
                    ) from exc
                stop_event.wait(wait)
                continue
            except Exception as exc:
                consecutive_errors += 1
                wait = min(backoff, 30.0)
                backoff = min(backoff * 2, 30.0)
                logger.warning(
                    f"Playlist fetch error (#{consecutive_errors}): {exc}; "
                    f"retrying in {wait:.0f}s",
                    exc_info=True,
                )
                if consecutive_errors >= max_consecutive_errors:
                    raise RuntimeError(
                        f"Playlist fetch failed {consecutive_errors} times consecutively; giving up"
                    ) from exc
                stop_event.wait(wait)
                continue

            new_segments = _fetch_new_segments(playlist, seen_seqs)

            for seq, seg_url, _dur in new_segments:
                if stop_event.is_set():
                    return

                seen_seqs.add(seq)

                # Download
                try:
                    raw_bytes = _download_segment(seq, seg_url, http, stop_event)
                except requests.HTTPError as exc:
                    status = exc.response.status_code if exc.response is not None else None
                    if status is not None and status < 500 and status != 429:
                        raise RuntimeError(
                            f"Permanent HTTP {status} downloading segment seq={seq}; giving up"
                        ) from exc
                    logger.warning(
                        f"Segment download HTTP error {status} seq={seq}", exc_info=True
                    )
                    consecutive_errors += 1
                    if consecutive_errors >= max_consecutive_errors:
                        raise RuntimeError(
                            f"Segment download failed {consecutive_errors} times consecutively; giving up"
                        ) from exc
                    wait = min(backoff, 30.0)
                    backoff = min(backoff * 2, 30.0)
                    stop_event.wait(wait)
                    continue
                except Exception as exc:
                    logger.warning(f"Segment download error seq={seq}: {exc}", exc_info=True)
                    consecutive_errors += 1
                    if consecutive_errors >= max_consecutive_errors:
                        raise RuntimeError(
                            f"Segment download failed {consecutive_errors} times consecutively; giving up"
                        ) from exc
                    wait = min(backoff, 30.0)
                    backoff = min(backoff * 2, 30.0)
                    stop_event.wait(wait)
                    continue

                if raw_bytes is None:
                    # stop_event was set inside _download_segment
                    return

                consecutive_errors = 0
                backoff = 2.0

                # Process — passthrough on decode failure, up to max_passthrough times
                try:
                    out_bytes = process_fn(state, raw_bytes)
                    consecutive_passthrough = 0
                except Exception as exc:
                    consecutive_passthrough += 1
                    logger.warning(
                        f"Passthrough raw bytes due to processing error on seq={seq} "
                        f"(#{consecutive_passthrough}): {exc}",
                        exc_info=True,
                    )
                    if consecutive_passthrough >= max_passthrough:
                        raise RuntimeError(
                            f"Processing failed {consecutive_passthrough} times consecutively; giving up"
                        ) from exc
                    out_bytes = raw_bytes

                # Write
                out_path = output_dir / f"seg_{output_seq:04d}.ts"
                out_path.write_bytes(out_bytes)
                on_segment_written(output_seq)
                output_seq += 1

            if playlist.is_end:
                return

            # Live stream: wait a moment before polling again
            if not new_segments:
                stop_event.wait(1.0)
            # If we got segments, loop immediately to check for more