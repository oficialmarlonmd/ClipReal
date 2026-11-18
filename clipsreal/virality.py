"""Score de viralização (0-100) — modelo composto, explicável e ajustável.

score = Σ peso_i × sinal_i   (sinais normalizados 0..100)

  llm        45%  julgamento do Gemini: gancho, emoção, valor/curiosidade, tendência, autonomia
  energy     15%  intensidade de áudio (tiros, explosões, gritos, música) vs. média do vídeo
  hook       12%  força dos 3 primeiros segundos (fala + energia imediata)
  dynamics   10%  ritmo visual (cortes de cena por 10s)
  duration    8%  aderência à duração ideal de Shorts (20–40s)
  trend      10%  palavras-chave em alta do nicho GTA 6
Se não houver LLM, o peso dele é redistribuído proporcionalmente entre os outros sinais.
"""
from __future__ import annotations

import numpy as np

WEIGHTS = {"llm": 0.45, "energy": 0.15, "hook": 0.12, "dynamics": 0.10, "duration": 0.08, "trend": 0.10}
LLM_KEYS = ("hook", "emotion", "value", "trend", "standalone")


def _energy_slice(signals: dict, start: float, end: float) -> np.ndarray:
    e = signals.get("energy") or []
    hop = signals.get("hop", 0.5)
    if not e:
        return np.array([])
    a, b = int(start / hop), max(int(end / hop), int(start / hop) + 1)
    return np.array(e[a:b], dtype=float)


def label(score: float) -> str:
    if score >= 85:
        return "🔥 Viral"
    if score >= 70:
        return "Alto"
    if score >= 55:
        return "Médio"
    return "Baixo"


def score_clip(start: float, end: float, signals: dict, text: str, words_first3: int,
               keywords: list[str], llm_scores: dict | None = None, extra_text: str = "") -> tuple[float, dict]:
    dur = max(end - start, 0.1)
    bd: dict[str, float] = {}

    # --- LLM
    if llm_scores:
        vals = [float(llm_scores.get(k, 0) or 0) for k in LLM_KEYS if k in llm_scores]
        if vals:
            bd["llm"] = float(np.clip(np.mean(vals) * 10, 0, 100))

    # --- energia (top 30% da janela relativo à média global)
    seg = _energy_slice(signals, start, end)
    glob_e = np.array(signals.get("energy") or [0.0])
    gmean = float(glob_e.mean()) if glob_e.size else 0.0
    if seg.size:
        top = np.sort(seg)[-max(1, int(seg.size * 0.3)):]
        rel = top.mean() / (gmean * 2 + 1e-6)
        bd["energy"] = float(np.clip(rel * 100, 0, 100))
    else:
        bd["energy"] = 40.0

    # --- gancho (3 primeiros segundos)
    first = _energy_slice(signals, start, start + 3)
    e3 = float(np.clip((first.max() if first.size else 0) / (gmean * 2 + 1e-6), 0, 1))
    speech_part = min(words_first3 / 6, 1.0)
    has_speech = bool(text.strip())
    bd["hook"] = float((0.5 * speech_part + 0.5 * e3) * 100 if has_speech else e3 * 100)

    # --- dinâmica visual
    scenes = [t for t in signals.get("scenes", []) if start <= t <= end]
    per10 = len(scenes) / dur * 10
    if per10 < 0.5:
        dyn = 25 + per10 * 50
    elif per10 <= 4:
        dyn = 60 + (per10 - 0.5) / 3.5 * 40
    else:
        dyn = max(60.0, 100 - (per10 - 4) * 8)
    bd["dynamics"] = float(np.clip(dyn, 0, 100))

    # --- duração
    if 20 <= dur <= 40:
        d = 100.0
    elif dur < 20:
        d = max(30.0, 100 - (20 - dur) * 7)
    else:
        d = max(40.0, 100 - (dur - 40) * 3)
    bd["duration"] = d

    # --- tendência
    blob = f"{text} {extra_text}".lower()
    hits = sum(1 for k in keywords if k.lower() in blob)
    bd["trend"] = float(min(35 + hits * 15, 100))

    weights = {k: w for k, w in WEIGHTS.items() if k in bd}
    total_w = sum(weights.values())
    score = sum(bd[k] * w for k, w in weights.items()) / total_w
    bd = {k: round(v, 1) for k, v in bd.items()}
    return round(float(score), 1), bd
