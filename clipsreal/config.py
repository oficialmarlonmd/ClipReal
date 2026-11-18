"""Carrega config.yaml + .env com valores padrão."""
from __future__ import annotations

import copy
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
# Dica: a pasta do projeto está no OneDrive — aponte CLIPSREAL_DATA para fora dele (ex.: C:\ClipsRealData)
# para os vídeos pesados não lotarem a sincronização.
DATA = Path(os.getenv("CLIPSREAL_DATA") or (ROOT / "data")).resolve()
JOBS_DIR = DATA / "jobs"
UPLOADS_DIR = DATA / "uploads"
CRED_DIR = ROOT / "credentials"

for d in (DATA, JOBS_DIR, UPLOADS_DIR, CRED_DIR):
    d.mkdir(parents=True, exist_ok=True)

DEFAULTS: dict = {
    "channel": {
        "name": "GTA VI", "handle": "@BabyDragonOFC", "language": "pt-BR",
        "niche": "GTA 6", "default_hashtags": ["#GTA6", "#GTAVI", "#Shorts"],
        "cta": "Inscreva-se para mais cortes de GTA 6!", "watermark_text": "@BabyDragonOFC",
    },
    "llm": {"provider": "gemini", "model": "auto", "use_video_analysis": True,
            "max_video_minutes_for_upload": 50, "transcript_chunk_minutes": 30},
    "transcription": {"enabled": True, "model": "small", "device": "cpu",
                      "compute_type": "int8", "language": None},
    "clips": {"target_count": 10, "min_seconds": 15, "max_seconds": 58, "min_score": 50},
    "render": {"mode": "blur", "fg_zoom": 1.15, "width": 1080, "height": 1920, "fps": 30,
               "crf": 21, "preset": "veryfast", "loudnorm": True, "captions": True,
               "hook_title": True, "watermark": True, "caption_font": "Arial Black",
               "caption_size": 82, "caption_color": "&H00FFFFFF",
               "highlight_color": "&H0000E5FF", "caption_margin_v": 470,
               "words_per_group": 3, "hook_font": "Arial Black", "hook_size": 66},
    "upload": {"privacy": "public", "category_id": "20", "made_for_kids": False,
               "timezone": "America/Sao_Paulo",
               "slots": ["07:30", "11:00", "13:00", "16:00", "18:30", "20:00", "21:30", "23:00"],
               "max_per_day": 6},
    "monitor": {"interval_minutes": 30, "auto_upload": False, "sources": []},
    "trend_keywords": ["gta 6", "gta vi", "vice city", "lucia", "jason"],
}


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config() -> dict:
    path = ROOT / "config.yaml"
    user = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            user = yaml.safe_load(f) or {}
    return _merge(DEFAULTS, user)


CFG = load_config()


def reload() -> dict:
    global CFG
    load_dotenv(ROOT / ".env", override=True)
    CFG.clear()
    CFG.update(load_config())
    return CFG


def gemini_key() -> str | None:
    if not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        load_dotenv(ROOT / ".env", override=False)
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or None


def youtube_client_secret() -> Path:
    p = os.getenv("YOUTUBE_CLIENT_SECRET", "credentials/client_secret.json")
    path = Path(p)
    return path if path.is_absolute() else ROOT / path


def set_env_var(key: str, value: str) -> None:
    """Atualiza ou adiciona uma variável no .env e em os.environ."""
    env_path = ROOT / ".env"
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    replaced = False
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}")
            replaced = True
        else:
            new_lines.append(line)
    if not replaced:
        new_lines.append(f"{key}={value}")
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    os.environ[key] = value


def save_config(updates: dict) -> dict:
    """Mescla updates no config.yaml preservando o restante e recarrega CFG."""
    path = ROOT / "config.yaml"
    cur = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            cur = yaml.safe_load(f) or {}
    merged = _merge(cur, updates)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(merged, f, allow_unicode=True, sort_keys=False)
    return reload()
