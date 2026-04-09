import subprocess
import sys
import warnings
from pathlib import Path

import imageio_ffmpeg


def _ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def _ffprobe_exe() -> str | None:
    """Return the ffprobe binary path alongside the bundled ffmpeg, or None."""
    ffmpeg = Path(_ffmpeg_exe())
    # Try replacing 'ffmpeg' with 'ffprobe' in the filename (e.g. ffmpeg-linux64-v7 → ffprobe-linux64-v7)
    candidate = ffmpeg.parent / ffmpeg.name.replace("ffmpeg", "ffprobe")
    if candidate.exists():
        return str(candidate)
    # Try plain ffprobe / ffprobe.exe in the same directory
    plain = ffmpeg.parent / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    if plain.exists():
        return str(plain)
    return None


def has_audio_stream(video_path: Path) -> bool:
    ffprobe = _ffprobe_exe()
    if ffprobe:
        result = subprocess.run(
            [
                ffprobe, "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=codec_type",
                "-of", "csv=p=0",
                str(video_path),
            ],
            capture_output=True, text=True,
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    # Fallback: ffmpeg -i probe. The "Audio:" stream-type label in ffmpeg's
    # stderr is sourced from av_get_media_type_string() which is not localised.
    result = subprocess.run(
        [_ffmpeg_exe(), "-i", str(video_path)],
        capture_output=True, text=True,
    )
    return "Audio:" in result.stderr


def mux_audio(input_video: Path, silent_output: Path, final_output: Path) -> bool:
    """Copy audio from input_video into silent_output → final_output. Returns True on success."""
    if not has_audio_stream(input_video):
        return False
    cmd = [
        _ffmpeg_exe(), "-y",
        "-i", str(silent_output),
        "-i", str(input_video),
        "-c:v", "copy",
        "-c:a", "aac",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-shortest",
        str(final_output),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        warnings.warn(f"ffmpeg audio mux failed:\n{result.stderr}")
        return False
    try:
        silent_output.unlink()
    except OSError as exc:
        warnings.warn(f"Could not remove intermediate file {silent_output}: {exc}")
    return True
