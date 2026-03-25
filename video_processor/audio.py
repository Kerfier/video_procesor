import subprocess
import warnings
from pathlib import Path

import imageio_ffmpeg


def _ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def has_audio_stream(video_path: Path) -> bool:
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
    silent_output.unlink()
    return True
