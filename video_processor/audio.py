import shutil
import subprocess
import warnings
from pathlib import Path


def has_audio_stream(video_path: Path) -> bool:
    if not shutil.which("ffprobe"):
        return False
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(video_path)],
        capture_output=True, text=True,
    )
    return "audio" in result.stdout


def mux_audio(input_video: Path, silent_output: Path, final_output: Path) -> bool:
    """Copy audio from input_video into silent_output → final_output. Returns True on success."""
    if not shutil.which("ffmpeg"):
        warnings.warn("ffmpeg not found — output will have no audio.")
        return False
    if not has_audio_stream(input_video):
        return False
    cmd = [
        "ffmpeg", "-y",
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
