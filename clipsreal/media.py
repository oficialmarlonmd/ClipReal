"""Localização e execução do FFmpeg + utilitários de mídia (probe, áudio, cenas, energia)."""
from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

_FFMPEG: str | None = None


def ffmpeg_bin() -> str:
    """Procura FFmpeg: PATH -> WinGet (Gyan.FFmpeg) -> imageio-ffmpeg (fallback embutido)."""
    global _FFMPEG
    if _FFMPEG:
        return _FFMPEG
    la = os.environ.get("LOCALAPPDATA", "")
    cands = [shutil.which("ffmpeg"), os.path.join(la, "Microsoft", "WinGet", "Links", "ffmpeg.exe")]
    cands += glob.glob(os.path.join(la, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg*", "**", "bin", "ffmpeg.exe"),
                       recursive=True)
    for c in cands:
        if c and os.path.isfile(c):
            _FFMPEG = c
            return c
    try:
        import imageio_ffmpeg
        _FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
        return _FFMPEG
    except Exception:
        pass
    raise RuntimeError("FFmpeg não encontrado. Rode setup.ps1 ou instale: winget install Gyan.FFmpeg")


def ffmpeg_dir() -> str:
    return str(Path(ffmpeg_bin()).parent)


def has_filter(name: str) -> bool:
    try:
        p = subprocess.run([ffmpeg_bin(), "-hide_banner", "-filters"], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        return re.search(rf"\s{re.escape(name)}\s", p.stdout) is not None
    except Exception:
        return False


def run(args: list[str], cwd: str | Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    cmd = [ffmpeg_bin(), "-hide_banner", "-y", *[str(a) for a in args]]
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou (code {p.returncode}):\n{p.stderr[-2500:]}")
    return p


def probe(path: str | Path) -> dict:
    p = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    err = p.stderr
    dur = 0.0
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if m:
        dur = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    w = h = 0
    m = re.search(r"Video:.*?[\s,](\d{2,5})x(\d{2,5})[\s,\]]", err)
    if m:
        w, h = int(m[1]), int(m[2])
    fps = 30.0
    m = re.search(r"(\d+(?:\.\d+)?) fps", err)
    if m:
        fps = float(m[1])
    rot = re.search(r"rotation of (-?\d+)", err) or re.search(r"rotate\s*:\s*(-?\d+)", err)
    if rot and abs(int(rot[1])) in (90, 270):
        w, h = h, w
    return {"duration": dur, "width": w, "height": h, "fps": fps, "has_audio": "Audio:" in err}


def extract_audio(video: str | Path, wav: str | Path) -> Path:
    run(["-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav])
    return Path(wav)


def make_proxy(video: str | Path, out: str | Path, height: int = 360) -> Path:
    """Versão leve (360p, 6fps, áudio mono) para enviar ao Gemini."""
    run(["-i", video, "-vf", f"scale=-2:{height},fps=6", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "32", "-c:a", "aac", "-ac", "1", "-b:a", "48k", out])
    return Path(out)


def scene_changes(video: str | Path, threshold: float = 0.35) -> list[float]:
    p = run(["-i", video, "-an", "-vf", f"fps=4,scale=256:-2,select='gt(scene,{threshold})',showinfo",
             "-f", "null", "-"], check=False)
    return [float(x) for x in re.findall(r"pts_time:([\d.]+)", p.stderr)]


def audio_energy(wav: str | Path, hop: float = 0.5) -> list[float]:
    """RMS por janela de `hop` segundos, normalizado 0..1 (percentil 98)."""
    with wave.open(str(wav), "rb") as wf:
        sr = wf.getframerate()
        n = int(sr * hop)
        vals = []
        while True:
            buf = wf.readframes(n * 200)
            if not buf:
                break
            a = np.frombuffer(buf, dtype=np.int16).astype(np.float32) / 32768.0
            usable = len(a) // n * n
            if usable:
                blocks = a[:usable].reshape(-1, n)
                vals.extend(np.sqrt((blocks ** 2).mean(axis=1)).tolist())
            if len(a) > usable:
                rest = a[usable:]
                vals.append(float(np.sqrt((rest ** 2).mean())))
    if not vals:
        return []
    arr = np.array(vals)
    ref = np.percentile(arr, 98) or 1e-6
    return np.clip(arr / ref, 0, 1).round(3).tolist()


def extract_frame(video: str | Path, t: float, out: str | Path) -> Path:
    run(["-ss", f"{max(t, 0):.3f}", "-i", video, "-frames:v", "1", "-q:v", "2", out])
    return Path(out)
