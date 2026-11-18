"""Detecção de melhores momentos: Gemini (transcrição + sinais + vídeo) com fallback heurístico."""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from . import media, transcribe, virality
from .llm import get_llm

log = logging.getLogger("clipsreal.highlights")


def _fmt(t: float) -> str:
    return f"{int(t // 60):02d}:{t % 60:04.1f}"


def _peaks(signals: dict, n: int = 40, min_gap: float = 6.0) -> list[tuple[float, float]]:
    e = np.array(signals.get("energy") or [])
    hop = signals.get("hop", 0.5)
    if not e.size:
        return []
    order = np.argsort(e)[::-1]
    picked: list[tuple[float, float]] = []
    for i in order:
        t = i * hop
        if all(abs(t - p[0]) >= min_gap for p in picked):
            picked.append((round(t, 1), float(e[i])))
        if len(picked) >= n:
            break
    return sorted(picked)


def _scene_rate(signals: dict, duration: float, bucket: float = 60.0) -> str:
    scenes = signals.get("scenes", [])
    rows = []
    for b in np.arange(0, duration, bucket):
        c = sum(1 for t in scenes if b <= t < b + bucket)
        rows.append(f"{_fmt(b)}={c}")
    return ", ".join(rows[:240])


def _transcript_block(transcript: list[dict], a: float, b: float) -> str:
    lines = [f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}" for s in transcript
             if s["end"] > a and s["start"] < b]
    return "\n".join(lines)


PROMPT = """Você é o melhor editor de cortes virais de GTA 6 (GTA VI) do YouTube Brasil.
Canal: {channel} ({handle}) — nicho: {niche}.
Vídeo de origem: "{title}" (duração total {duration:.0f}s). Trecho analisado: {a:.0f}s até {b:.0f}s.

Sua tarefa: encontrar os MELHORES momentos para virar YouTube Shorts que viralizam.
Critérios: gancho forte nos 1–3 primeiros segundos, emoção (humor, choque, tensão, hype),
curiosidade/revelação (segredos, detalhes, easter eggs, física, IA da polícia, mapa, personagens Lucia/Jason),
história com começo-meio-fim (payoff no final), e que funcione SEM contexto do vídeo inteiro.
{video_note}

TRANSCRIÇÃO (segundos absolutos):
{transcript}

PICOS DE ENERGIA DE ÁUDIO (t em segundos, intensidade 0-1 — tiros, explosões, gritos, reações):
{peaks}

CORTES DE CENA POR MINUTO (mm:ss=quantidade):
{scenes}

Regras:
- Cada corte entre {min_s} e {max_s} segundos, sem sobreposição, dentro de {a:.0f}s–{b:.0f}s.
- Comece exatamente no momento de maior gancho (não em silêncio ou introdução).
- Termine logo após o payoff (sem enrolação no fim).
- Retorne até {n} candidatos, do melhor para o pior. Seja rigoroso nas notas (0-10).

Responda SOMENTE JSON neste formato:
{{"clips":[{{"start":12.5,"end":41.0,
  "hook":"TEXTO DE GANCHO NA TELA (máx 6 palavras, MAIÚSCULAS)",
  "category":"humor|ação|revelação|easter egg|bug|polêmica|notícia|reação|gameplay insana",
  "reason":"por que vai viralizar (1 frase)",
  "scores":{{"hook":0-10,"emotion":0-10,"value":0-10,"trend":0-10,"standalone":0-10}}}}]}}
"""


def _snap(start: float, end: float, transcript: list[dict], duration: float, min_s: float, max_s: float):
    if transcript:
        starts = [s["start"] for s in transcript if start - 2.5 <= s["start"] <= start + 1.5]
        if starts:
            start = min(starts, key=lambda x: abs(x - start))
        ends = [s["end"] for s in transcript if end - 1.5 <= s["end"] <= end + 2.5]
        if ends:
            end = min(ends, key=lambda x: abs(x - end)) + 0.25
    start = max(0.0, start)
    end = min(duration, end)
    if end - start < min_s:
        end = min(duration, start + min_s)
        if end - start < min_s:
            start = max(0.0, end - min_s)
    if end - start > max_s:
        end = start + max_s
    return round(start, 2), round(end, 2)


def _overlap(a: dict, b: dict) -> float:
    inter = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    return inter / max(1e-6, min(a["end"] - a["start"], b["end"] - b["start"]))


def _nms(cands: list[dict], thr: float = 0.35) -> list[dict]:
    out: list[dict] = []
    for c in sorted(cands, key=lambda x: x["score"], reverse=True):
        if all(_overlap(c, o) < thr for o in out):
            out.append(c)
    return out


def _finalize(c: dict, transcript, signals, cfg, duration) -> dict:
    ccfg = cfg["clips"]
    s, e = _snap(float(c["start"]), float(c["end"]), transcript, duration, ccfg["min_seconds"], ccfg["max_seconds"])
    text = transcribe.text_between(transcript, s, e)
    w3 = len([w for w in transcribe.words_between(transcript, s, s + 3)])
    score, bd = virality.score_clip(s, e, signals, text, w3, cfg["trend_keywords"], c.get("scores"),
                                    extra_text=f"{c.get('hook', '')} {c.get('reason', '')}")
    return {**c, "start": s, "end": e, "transcript": text, "score": score, "breakdown": bd,
            "score_label": virality.label(score)}


def llm_candidates(video: Path, proxy_dir: Path, transcript, signals, cfg, duration: float, title: str,
                   progress=None) -> list[dict]:
    llm = get_llm()
    lcfg, ccfg, ch = cfg["llm"], cfg["clips"], cfg["channel"]
    progress = progress or (lambda p, m: None)
    files = []
    uploaded = None
    if lcfg.get("use_video_analysis") and duration <= lcfg["max_video_minutes_for_upload"] * 60:
        try:
            progress(0.1, "Preparando vídeo para análise visual (Gemini)")
            proxy = proxy_dir / "proxy.mp4"
            if not proxy.exists():
                media.make_proxy(video, proxy)
            progress(0.3, "Enviando vídeo ao Gemini")
            uploaded = llm.upload_video(proxy)
            files = [uploaded]
        except Exception as e:  # noqa: BLE001
            log.warning("Análise visual indisponível: %s", e)
            files = []

    chunk = lcfg["transcript_chunk_minutes"] * 60 if not files else duration + 1
    n_chunks = max(1, int(np.ceil(duration / chunk)))
    per_chunk = max(3, int(np.ceil(ccfg["target_count"] * 2 / n_chunks)))
    peaks = _peaks(signals, n=60)
    out: list[dict] = []
    try:
        for i in range(n_chunks):
            a, b = i * chunk, min(duration, (i + 1) * chunk)
            progress(0.4 + 0.6 * i / n_chunks, f"IA analisando trecho {i + 1}/{n_chunks}")
            prompt = PROMPT.format(
                channel=ch["name"], handle=ch["handle"], niche=ch["niche"], title=title, duration=duration,
                a=a, b=b, min_s=ccfg["min_seconds"], max_s=ccfg["max_seconds"], n=per_chunk,
                transcript=_transcript_block(transcript, a, b) or "(sem fala — vídeo de gameplay/trailer; use o vídeo e os sinais)",
                peaks=", ".join(f"{t:.0f}s:{v:.2f}" for t, v in peaks if a <= t <= b) or "(n/d)",
                scenes=_scene_rate({"scenes": [t for t in signals.get("scenes", []) if a <= t <= b]}, b) or "(n/d)",
                video_note="O VÍDEO está anexado: assista e use também o que acontece visualmente." if files else "",
            )
            data = llm.generate_json(prompt, files=files)
            clips = data.get("clips", data) if isinstance(data, dict) else data
            for c in clips or []:
                try:
                    if float(c["end"]) > float(c["start"]):
                        out.append(c)
                except (KeyError, TypeError, ValueError):
                    continue
    finally:
        if uploaded is not None:
            llm.delete_file(uploaded)
    return out


def _heuristic_hook(text: str, keywords: list[str], idx: int) -> tuple[str, str, str]:
    low = text.lower()
    hits = [k for k in keywords if k.lower() in low]
    if any(k in low for k in ("easter egg", "segredo", "detalhe", "ninguém percebeu")):
        return "NINGUÉM PERCEBEU ISSO NO GTA 6!", "easter egg", "segredo/detalhe oculto + pico de energia"
    if any(k in low for k in ("polícia", "perseguição", "assalto", "heist")):
        return "PERSEGUIÇÃO INSANA EM VICE CITY!", "ação", "alta tensão/ação + pico de áudio"
    if any(k in low for k in ("bug", "glitch", "física")):
        return "OLHA A FÍSICA DO GTA 6 😱", "bug", "física/momento inesperado + pico de energia"
    if any(k in low for k in ("lucia", "jason")):
        name = "LUCIA" if "lucia" in low else "JASON"
        return f"OLHA O QUE {name} FEZ NO GTA 6!", "gameplay insana", "protagonista em destaque + pico de energia"
    if hits:
        kw = hits[0].upper()
        return f"{kw} NO GTA 6 É ABSURDO!", "gameplay insana", f"palavras em alta ({', '.join(hits[:3])}) + pico de energia"
    fallbacks = [
        "MOMENTO INSANO NO GTA 6!",
        "ISSO NO GTA 6 É REAL?!",
        "OLHA O QUE ACONTECEU EM VICE CITY!",
    ]
    return fallbacks[idx % len(fallbacks)], "gameplay insana", "pico de intensidade de áudio e ritmo visual"


def heuristic_candidates(transcript, signals, cfg, duration: float) -> list[dict]:
    ccfg = cfg["clips"]
    kws = cfg.get("trend_keywords") or []
    lens = [L for L in (24, 32, 42) if ccfg["min_seconds"] <= L <= ccfg["max_seconds"]] or [ccfg["min_seconds"]]
    peaks = _peaks(signals, n=80, min_gap=8)
    cands = []
    for idx, (t, _) in enumerate(peaks):
        for L in lens:
            start = max(0.0, t - min(4.0, L * 0.25))   # pico logo no início = gancho
            end = min(duration, start + L)
            txt = transcribe.text_between(transcript, start, end)
            hook, cat, reason = _heuristic_hook(txt, kws, idx)
            cands.append({"start": start, "end": end, "hook": hook, "reason": reason, "category": cat})
    if not cands:  # sem áudio: janelas regulares
        step = max(ccfg["min_seconds"], 30)
        cands = [{"start": s, "end": min(duration, s + step), "hook": "MOMENTO INSANO NO GTA 6!",
                  "reason": "janela de gameplay", "category": "gameplay"}
                 for s in np.arange(0, max(duration - ccfg["min_seconds"], 1), step)]
    return cands


def find_highlights(video: Path, work_dir: Path, transcript, signals, cfg, duration: float, title: str,
                    progress=None) -> tuple[list[dict], str]:
    """Retorna (cortes ordenados por score, método usado)."""
    method = "heurístico"
    raw: list[dict] = []
    if get_llm().available:
        try:
            raw = llm_candidates(video, work_dir, transcript, signals, cfg, duration, title, progress)
            method = f"gemini ({get_llm().model})"
        except Exception as e:  # noqa: BLE001
            log.warning("Gemini falhou, usando heurística: %s", e)
    if not raw:
        raw = heuristic_candidates(transcript, signals, cfg, duration)
    final = [_finalize(c, transcript, signals, cfg, duration) for c in raw]
    final = _nms(final)
    keep = [c for c in final if c["score"] >= cfg["clips"]["min_score"]]
    if len(keep) < min(3, len(final)):  # garante pelo menos alguns cortes
        keep = final[:3]
    return keep[: cfg["clips"]["target_count"]], method
