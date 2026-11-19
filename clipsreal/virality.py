"""Score de viralização (0-100) — modelo composto, explicável e ajustável.

score = Σ peso_i × sinal_i   (sinais normalizados 0..100)

  llm        45%  julgamento do Gemini: gancho, emoção, valor/curiosidade, tendência, autonomia
  energy     15%  intensidade e picos de áudio (gritos, risadas, explosões) vs. base local e global
  hook       12%  força dos 3 primeiros segundos (fala + energia imediata)
  dynamics   10%  ritmo audiovisual (cortes de cena + variação dinâmica de áudio em lives)
  duration    8%  aderência à duração ideal de Shorts (20–40s)
  trend      10%  palavras-chave do nicho + gatilhos de reação/humor em live
Se não houver LLM, o peso dele é redistribuído proporcionalmente entre os outros sinais.
"""
from __future__ import annotations

import re

import numpy as np

WEIGHTS = {"llm": 0.45, "energy": 0.15, "hook": 0.12, "dynamics": 0.10, "duration": 0.08, "trend": 0.10}
LLM_KEYS = ("hook", "emotion", "value", "trend", "standalone")

_REACTION_RE = re.compile(
    r"\b("
    r"no way|what the (?:fuck|hell|heck)|wait what|bro what|oh my god|omg|holy (?:shit|cow)|"
    r"wtf|bruh|lmao+|lmfao+|lol|haha+|clip (?:it|that)|i'?m dead|insane|crazy|unbelievable|"
    r"let'?s go+|what happened|you gotta be kidding|"
    r"não acredito|nao acredito|mentira|caralho+|krl|porra+|mano do c[eé]u|meu deus|mds|"
    r"olha isso|que isso|socorro|morri|absurdo+|insano|bizarro|kkk+|rsrs+|clipa"
    r")\b",
    re.I,
)


def reaction_intensity(text: str) -> tuple[int, float]:
    """Retorna (qtd_gatilhos, pontuação_extra) para reações, risadas e humor em lives."""
    txt = (text or "").strip()
    if not txt:
        return 0, 0.0
    hits = len(_REACTION_RE.findall(txt))
    punct = txt.count("!") + txt.count("?")
    upper_words = sum(1 for w in txt.split() if len(w) >= 3 and w.isupper())
    score = hits * 18.0 + min(punct, 4) * 5.0 + min(upper_words, 3) * 6.0
    return hits, float(min(score, 100.0))


def _energy_slice(signals: dict, start: float, end: float) -> np.ndarray:
    e = signals.get("energy") or []
    hop = signals.get("hop", 0.5)
    if not e:
        return np.array([])
    a = max(0, int(start / hop))
    b = min(len(e), max(int(end / hop), a + 1))
    if a >= b:
        return np.array([])
    return np.array(e[a:b], dtype=float)


def _local_baseline(signals: dict, start: float, end: float, pad: float = 120.0) -> float:
    """Referência de energia da vizinhança (±2min) para não penalizar trechos calmos de lives longas."""
    win = _energy_slice(signals, max(0.0, start - pad), end + pad)
    if not win.size:
        return 0.0
    return max(float(np.mean(win)), float(np.percentile(win, 60)), 1e-4)


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

    # --- energia (top 30% da janela relativo à média global E à vizinhança local)
    seg = _energy_slice(signals, start, end)
    glob_e = np.array(signals.get("energy") or [0.0])
    gmean = float(glob_e.mean()) if glob_e.size else 0.0
    lbase = _local_baseline(signals, start, end)
    if seg.size:
        top = np.sort(seg)[-max(1, int(seg.size * 0.3)):]
        g_rel = top.mean() / (gmean * 2 + 1e-6)
        l_rel = top.mean() / (lbase * 1.9 + 1e-6) if lbase > 0 else g_rel
        bd["energy"] = float(np.clip(max(g_rel, l_rel) * 100, 0, 100))
    else:
        bd["energy"] = 45.0

    # --- gancho (3.5 primeiros segundos)
    first = _energy_slice(signals, start, start + 3.5)
    ref = min(gmean, lbase) if (gmean > 0 and lbase > 0) else (lbase or gmean)
    e3 = float(np.clip((first.max() if first.size else 0) / (ref * 1.9 + 1e-6), 0, 1))
    speech_part = min(words_first3 / 5.0, 1.0)
    if text:
        head_rx, _ = reaction_intensity(text[:90])
        if head_rx or "!" in text[:80] or "?" in text[:80]:
            speech_part = min(1.0, speech_part + 0.15)
    has_speech = bool(text.strip())
    bd["hook"] = float((0.5 * speech_part + 0.5 * e3) * 100 if has_speech else e3 * 100)

    # --- dinâmica audiovisual (cortes de cena + variação de ritmo do áudio na live)
    scenes = [t for t in signals.get("scenes", []) if start <= t <= end]
    per10 = len(scenes) / dur * 10
    if per10 < 0.5:
        scene_dyn = 35 + per10 * 50
    elif per10 <= 4:
        scene_dyn = 60 + (per10 - 0.5) / 3.5 * 40
    else:
        scene_dyn = max(60.0, 100 - (per10 - 4) * 8)
    audio_dyn = 38.0
    if seg.size > 2 and float(seg.mean()) > 1e-5:
        e_cv = float(np.std(seg) / (seg.mean() + 1e-6))
        audio_dyn = float(np.clip(38.0 + e_cv * 65.0, 38.0, 92.0))
    bd["dynamics"] = float(np.clip(max(scene_dyn, audio_dyn), 0, 100))

    # --- duração
    if 20 <= dur <= 40:
        d = 100.0
    elif dur < 20:
        d = max(30.0, 100 - (20 - dur) * 7)
    else:
        d = max(40.0, 100 - (dur - 40) * 3)
    bd["duration"] = d

    # --- tendência & gatilhos de reação/humor
    blob = f"{text} {extra_text}".lower()
    hits = sum(1 for k in keywords if k.lower() in blob)
    rx_hits, _ = reaction_intensity(f"{text} {extra_text}")
    bd["trend"] = float(min(45 + hits * 14 + min(rx_hits, 3) * 12, 100))

    weights = {k: w for k, w in WEIGHTS.items() if k in bd}
    total_w = sum(weights.values())
    score = sum(bd[k] * w for k, w in weights.items()) / total_w
    bd = {k: round(v, 1) for k, v in bd.items()}
    return round(float(score), 1), bd
