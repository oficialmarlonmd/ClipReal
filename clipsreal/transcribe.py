"""Transcrição local com faster-whisper (timestamps por palavra)."""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Callable

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

_model = None
_model_key = None
_lock = threading.Lock()


def _get_model(cfg: dict):
    global _model, _model_key
    key = (cfg["model"], cfg["device"], cfg["compute_type"])
    with _lock:
        if _model is None or _model_key != key:
            from faster_whisper import WhisperModel
            from .config import ROOT
            _model = WhisperModel(cfg["model"], device=cfg["device"], compute_type=cfg["compute_type"],
                                  download_root=str(ROOT / "models"))
            _model_key = key
    return _model


def transcribe(wav: Path, cfg: dict, cache: Path, duration: float,
               progress: Callable[[float, str], None] | None = None) -> list[dict]:
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    progress = progress or (lambda p, m: None)
    if not cfg.get("enabled", True):
        return []
    progress(0.0, "Carregando modelo Whisper")
    model = _get_model(cfg)
    segments, info = model.transcribe(str(wav), language=cfg.get("language") or None, word_timestamps=True,
                                      vad_filter=True, beam_size=1,
                                      vad_parameters={"min_silence_duration_ms": 500})
    out = []
    total = duration or getattr(info, "duration", 0) or 1
    for s in segments:
        words = [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
                 for w in (s.words or []) if w.word.strip()]
        out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(), "words": words})
        progress(min(s.end / total, 1.0), "Transcrevendo")
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def words_between(transcript: list[dict], start: float, end: float) -> list[dict]:
    """Palavras dentro de [start,end] com tempos relativos ao início do corte."""
    res = []
    for seg in transcript:
        if seg["end"] < start or seg["start"] > end:
            continue
        for w in seg.get("words", []):
            if w["start"] >= start - 0.05 and w["end"] <= end + 0.3:
                res.append({"start": max(w["start"] - start, 0), "end": max(w["end"] - start, 0.05),
                            "word": w["word"]})
    return res


def text_between(transcript: list[dict], start: float, end: float) -> str:
    return " ".join(s["text"] for s in transcript if s["end"] > start and s["start"] < end).strip()
