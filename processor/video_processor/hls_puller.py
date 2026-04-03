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
from pathlib import Path
from urllib.parse import urljoin
import logging

import requests

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


def _parse_segments(
    playlist_text: str, playlist_url: str
) -> tuple[list[tuple[int, str, float]], bool]:
    """Parse a media playlist.

    Returns (segments, is_end) where segments is a list of
    (sequence_number, absolute_url, duration) and is_end indicates
    #EXT-X-ENDLIST was present.
    """
    lines = playlist_text.splitlines()
    base_seq = 0
    m = _MEDIA_SEQUENCE_RE.search(playlist_text)
    if m:
        base_seq = int(m.group(1))

    segments: list[tuple[int, str, float]] = []
    duration = 2.0
    seq = base_seq
    for line in lines:
        line = line.strip()
        m = _EXTINF_RE.match(line)
        if m:
            duration = float(m.group(1))
            continue
        if line and not line.startswith("#"):
            abs_url = urljoin(playlist_url, line)
            segments.append((seq, abs_url, duration))
            seq += 1
            duration = 2.0

    is_end = _ENDLIST_TAG in playlist_text
    return segments, is_end


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def pull_and_process(
    url: str,
    output_dir: Path,
    state,
    process_fn,
    stop_event: threading.Event,
    on_segment_written: callable,
) -> None:
    """Blocking HLS pull loop.

    Downloads segments from *url*, calls *process_fn(state, ts_bytes) -> bytes*
    for each, and writes the result to *output_dir/seg_{n:04d}.ts*.

    Runs until:
    - #EXT-X-ENDLIST is seen in the playlist (VOD end)
    - *stop_event* is set (caller signalled stop)
    - An unrecoverable error occurs (raises)

    Reconnect behaviour on network/HTTP errors: exponential backoff starting
    at 2 s, capped at 30 s, retries indefinitely until stop_event is set.

    Args:
        url: HLS playlist URL (master or media).
        output_dir: Directory to write processed segments into.
        state: StreamingState — passed through to process_fn.
        process_fn: Callable (state, bytes) -> bytes. Should raise
            _DecodeError (from server.py) on corrupt input — in that case
            the raw unprocessed bytes are written instead (passthrough).
        stop_event: Set this to cleanly stop the loop.
        on_segment_written: Called with (sequence: int) after each write.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    http = requests.Session()
    http.headers["User-Agent"] = "video-processor-hls-puller/1.0"

    # Resolve master → media playlist URL once
    media_url = _resolve_media_url(url, http)

    seen_seqs: set[int] = set()
    output_seq = 0          # monotonic counter for output filenames
    backoff = 2.0
    consecutive_errors = 0

    while not stop_event.is_set():
        try:
            playlist_text = _fetch_text(media_url, http)
            segments, is_end = _parse_segments(playlist_text, media_url)
            consecutive_errors = 0
            backoff = 2.0
        except Exception as exc:
            consecutive_errors += 1
            wait = min(backoff, 30.0)
            backoff = min(backoff * 2, 30.0)
            # Log to stderr; server.py will catch the thread termination if
            # this keeps failing (but we retry indefinitely here)
            logger.warning(
                f"Playlist fetch error (#{consecutive_errors}): {exc}; "
                f"retrying in {wait:.0f}s",
                exc_info=True
            )
            stop_event.wait(wait)
            continue

        new_segments = [(seq, seg_url, dur) for seq, seg_url, dur in segments if seq not in seen_seqs]

        for seq, seg_url, _dur in new_segments:
            if stop_event.is_set():
                return

            seen_seqs.add(seq)

            # Download
            try:
                raw_bytes = _fetch_bytes(seg_url, http)
            except Exception as exc:
                logger.warning(f"Segment download error seq={seq}: {exc}", exc_info=True)
                consecutive_errors += 1
                wait = min(backoff, 30.0)
                backoff = min(backoff * 2, 30.0)
                stop_event.wait(wait)
                continue

            consecutive_errors = 0
            backoff = 2.0

            # Process — passthrough on decode failure
            try:
                out_bytes = process_fn(state, raw_bytes)
            except Exception as exc:
                # _DecodeError or any unexpected error: write raw
                logger.warning(f"Passthrough raw bytes due to processing target error on seq={seq}: {exc}", exc_info=True)
                out_bytes = raw_bytes

            # Write
            out_path = output_dir / f"seg_{output_seq:04d}.ts"
            out_path.write_bytes(out_bytes)
            on_segment_written(output_seq)
            output_seq += 1

        if is_end:
            return

        # Live stream: wait a moment before polling again
        if not new_segments:
            stop_event.wait(1.0)
        # If we got segments, loop immediately to check for more
