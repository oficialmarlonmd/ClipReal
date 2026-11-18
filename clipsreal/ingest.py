"""Ingestão: link (YouTube, Twitch, Kick, Drive...) via yt-dlp ou arquivo local."""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Callable

from . import media


def is_url(s: str) -> bool:
    return s.strip().lower().startswith(("http://", "https://"))


def ingest(source: str, dest_dir: Path, progress: Callable[[float, str], None] | None = None) -> dict:
    dest_dir.mkdir(parents=True, exist_ok=True)
    progress = progress or (lambda p, m: None)

    if not is_url(source):
        src = Path(source.strip().strip('"'))
        if not src.is_file():
            raise FileNotFoundError(f"Arquivo não encontrado: {src}")
        info = media.probe(src)
        return {"path": str(src), "title": src.stem, "duration": info["duration"], "url": None, "uploader": None}

    import yt_dlp

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                progress(min(d.get("downloaded_bytes", 0) / total, 1.0), "Baixando vídeo")

    opts = {
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(dest_dir / "source.%(ext)s"),
        "ffmpeg_location": media.ffmpeg_dir(),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [hook],
        "retries": 5,
        "concurrent_fragment_downloads": 4,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(source.strip(), download=True)
    path = None
    for f in dest_dir.glob("source.*"):
        if f.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
            path = f
            break
    if path is None:
        raise RuntimeError("Download concluído mas arquivo não encontrado.")
    if path.suffix.lower() != ".mp4":
        mp4 = dest_dir / "source.mp4"
        media.run(["-i", path, "-c", "copy", mp4], check=False)
        if mp4.exists() and mp4.stat().st_size > 0:
            os.remove(path)
            path = mp4
    dur = info.get("duration") or media.probe(path)["duration"]
    return {"path": str(path), "title": info.get("title") or path.stem, "duration": float(dur or 0),
            "url": source.strip(), "uploader": info.get("uploader"),
            "description": (info.get("description") or "")[:1500]}


def copy_upload(tmp_path: Path, name: str, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / name
    shutil.move(str(tmp_path), out)
    return out
