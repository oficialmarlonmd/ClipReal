"""Detecção de melhores momentos: janela temporal híbrida (Gemini + sinais de reação/humor)."""
from __future__ import annotations

import logging
import re
from pathlib import Path

import numpy as np

from . import lang as lang_utils, media, transcribe, virality
from .llm import get_llm

log = logging.getLogger("clipsreal.highlights")


def _fmt(t: float) -> str:
    sec = max(0.0, float(t))
    if sec >= 3600:
        return f"{int(sec // 3600)}:{int(sec // 60 % 60):02d}:{sec % 60:04.1f}"
    return f"{int(sec // 60):02d}:{sec % 60:04.1f}"


def _peaks_in_window(signals: dict, a: float, b: float, n: int = 14,
                     min_gap: float = 8.0) -> list[tuple[float, float]]:
    """Extrai picos de energia e saltos súbitos (reações/risadas/sustos) dentro de [a, b]."""
    e = np.array(signals.get("energy") or [], dtype=float)
    hop = float(signals.get("hop", 0.5) or 0.5)
    if not e.size or b <= a:
        return []
    ia = max(0, int(a / hop))
    ib = min(len(e), max(ia + 1, int(np.ceil(b / hop))))
    seg = e[ia:ib]
    if not seg.size:
        return []
    # Combina energia absoluta com salto relativo à mediana da janela (detecta reações em trechos calmos)
    baseline = float(np.percentile(seg, 55))
    burst = seg + np.maximum(0.0, seg - baseline) * 1.25
    order = np.argsort(burst)[::-1]
    picked: list[tuple[float, float]] = []
    for idx in order:
        t = (ia + int(idx)) * hop
        if all(abs(t - p[0]) >= min_gap for p in picked):
            picked.append((round(t, 1), round(float(seg[idx]), 2)))
        if len(picked) >= n:
            break
    return sorted(picked)


def _scene_rate(signals: dict, end: float, bucket: float = 60.0, start: float = 0.0) -> str:
    scenes = signals.get("scenes", [])
    rows = []
    for b in np.arange(max(0.0, start), max(end, start + 1.0), bucket):
        c = sum(1 for t in scenes if b <= t < b + bucket)
        rows.append(f"{_fmt(b)}={c}")
    return ", ".join(rows[:120])


def _transcript_block(transcript: list[dict], a: float, b: float) -> str:
    lines = [f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}" for s in transcript
             if s["end"] > a and s["start"] < b]
    return "\n".join(lines)


def _reaction_hints(transcript: list[dict], a: float, b: float, max_items: int = 12) -> list[tuple[float, float, str]]:
    """Identifica falas com gatilhos de humor/reação ou aceleração súbita de fala em [a, b]."""
    segs = [s for s in transcript if s["end"] > a and s["start"] < b and (s.get("text") or "").strip()]
    if not segs:
        return []
    scored: list[tuple[float, float, str]] = []
    for s in segs:
        txt = s["text"].strip()
        dur = max(float(s["end"]) - float(s["start"]), 0.4)
        wps = len(txt.split()) / dur
        hits, rx_score = virality.reaction_intensity(txt)
        burst_score = max(0.0, (wps - 2.6) * 14.0) if len(txt.split()) >= 5 else 0.0
        total = rx_score + burst_score + (10.0 if hits else 0.0)
        if total >= 12.0:
            scored.append((round(float(s["start"]), 1), round(total, 1), txt))
    scored.sort(key=lambda x: x[1], reverse=True)
    picked: list[tuple[float, float, str]] = []
    for t, sc, txt in scored:
        if all(abs(t - pt) >= 12.0 for pt, _, _ in picked):
            picked.append((t, sc, txt))
        if len(picked) >= max_items:
            break
    return sorted(picked)


def _plan_windows(duration: float, target_count: int, max_window_s: float = 600.0) -> list[tuple[float, float]]:
    """Divide vídeos e lives em janelas densas (~5-10 min) para cobrir o conteúdo todo sem perder o meio."""
    dur = max(float(duration), 1.0)
    if dur <= 420 and target_count <= 8:
        return [(0.0, dur)]
    # Pede no máximo ~6 candidatos por chamada para evitar truncamento do LLM
    needed_calls = max(int(np.ceil(dur / max_window_s)), int(np.ceil(target_count * 1.6 / 6)))
    step = min(max_window_s, max(180.0, dur / max(needed_calls, 1)))
    overlap = min(35.0, step * 0.1)
    windows: list[tuple[float, float]] = []
    a = 0.0
    while a < dur - 10.0:
        b = min(dur, a + step + (overlap if a + step < dur else 0.0))
        windows.append((round(a, 1), round(b, 1)))
        if b >= dur:
            break
        a += step
    return windows or [(0.0, dur)]


def _window_has_activity(transcript: list[dict], signals: dict, a: float, b: float) -> bool:
    if any(s["end"] > a and s["start"] < b and (s.get("text") or "").strip() for s in transcript):
        return True
    e = signals.get("energy") or []
    hop = float(signals.get("hop", 0.5) or 0.5)
    if e:
        ia = max(0, int(a / hop))
        ib = min(len(e), max(ia + 1, int(np.ceil(b / hop))))
        if ia < ib and max(e[ia:ib]) >= 0.06:
            return True
    return any(a <= t <= b for t in (signals.get("scenes") or []))


PROMPT_PT = """Você é o melhor editor de cortes virais de GTA 6 (GTA VI) e livestreams do YouTube Brasil.
Canal: {channel} ({handle}) — nicho: {niche}.
Vídeo de origem: "{title}" (duração total {duration:.0f}s). Trecho analisado: {a:.0f}s até {b:.0f}s.

Sua tarefa: encontrar os MELHORES momentos reais deste trecho para virar YouTube Shorts.
Priorize momentos genuínos de live e gameplay:
- Reações fortes e espontâneas (gargalhadas, sustos, choque, gritos, rage, incredulidade)
- Momentos engraçados, fails, piadas, interações rápidas com o chat ou situações absurdas
- Curiosidade/revelação (segredos, detalhes, easter eggs, física, polícia, personagens) e clímax de ação
- Gancho imediato nos primeiros 1–3 segundos e payoff claro no final, funcionando SEM contexto da live toda.
{video_note}

TRANSCRIÇÃO DO TRECHO (segundos absolutos):
{transcript}

SINAIS DE REAÇÃO / HUMOR / FALA RÁPIDA NO TRECHO:
{reactions}

PICOS DE ENERGIA DE ÁUDIO NO TRECHO (t em segundos, intensidade 0-1):
{peaks}

CORTES DE CENA POR MINUTO NO TRECHO (mm:ss=quantidade):
{scenes}

Regras:
- Cada corte entre {min_s} e {max_s} segundos, sem sobreposição, dentro de {a:.0f}s–{b:.0f}s.
- Comece exatamente no gancho/reação (nunca em silêncio ou enrolação) e termine logo após o payoff.
- Retorne entre {min_n} e {n} candidatos distintos distribuídos ao longo de {a:.0f}s–{b:.0f}s (não pare com poucos se houver bons momentos).
- Avalie as notas (0-10) com justiça: momentos realmente engraçados, reativos ou empolgantes devem receber 7–9; ouro viral 9–10; mornos 4–6.
- REGRA ESTRITA DE IDIOMA: Escreva TODOS os campos de texto ("hook", "category", "reason") estritamente em PORTUGUÊS (mantendo apenas nomes próprios como Lucia, Jason, Vice City, GTA 6). Não misture frases em inglês.

Responda SOMENTE JSON neste formato:
{{"clips":[{{"start":12.5,"end":41.0,
  "hook":"TEXTO DE GANCHO NA TELA (máx 6 palavras, MAIÚSCULAS, EM PORTUGUÊS)",
  "category":"humor|reação|fail|ação|revelação|easter egg|bug|polêmica|gameplay insana",
  "reason":"por que vai viralizar (1 frase em português)",
  "scores":{{"hook":0-10,"emotion":0-10,"value":0-10,"trend":0-10,"standalone":0-10}}}}]}}
"""

PROMPT_EN = """You are the top viral GTA 6 (Grand Theft Auto VI) and livestream YouTube Shorts editor.
Channel: {channel} ({handle}) — niche: {niche}.
Source video: "{title}" (total duration {duration:.0f}s). Analyzed segment: {a:.0f}s to {b:.0f}s.

Your task: find the BEST real moments in this segment to turn into viral YouTube Shorts.
Prioritize genuine livestream and gameplay highlights:
- Authentic reactions & high emotion (hard laughs, jumpscares, shock, screams, rage, disbelief, hype)
- Funny moments, fails, comedic timing, quick chat banter, or absurd/unexpected situations
- Curiosity/reveals (secrets, details, easter eggs, physics, police AI, characters) and intense action payoffs
- Strong hook in the first 1–3 seconds and clean payoff at the end, working WITHOUT needing context from the rest of the stream.
{video_note}

SEGMENT TRANSCRIPT (absolute seconds):
{transcript}

REACTION / COMEDY / FAST-SPEECH HINTS IN THIS SEGMENT:
{reactions}

AUDIO ENERGY PEAKS IN THIS SEGMENT (t in seconds, intensity 0-1):
{peaks}

SCENE CUTS PER MINUTE IN THIS SEGMENT (mm:ss=count):
{scenes}

Rules:
- Each clip must be between {min_s} and {max_s} seconds, non-overlapping, within {a:.0f}s–{b:.0f}s.
- Start right on the hook/setup (never in silence or dead air) and end right after the payoff.
- Return between {min_n} and {n} distinct, non-overlapping candidates distributed across {a:.0f}s–{b:.0f}s (do not stop early when good moments exist).
- Calibrate scores (0-10) fairly: genuinely funny, reactive, or exciting moments should score 7–9; standout viral gold 9–10; mild moments 4–6.
- STRICT LANGUAGE RULE: Write ALL generated text fields ("hook", "category", "reason") strictly in ENGLISH ONLY. Never use Portuguese or mix languages.

Reply ONLY with valid JSON in this exact format:
{{"clips":[{{"start":12.5,"end":41.0,
  "hook":"ON-SCREEN HOOK TEXT (max 6 words, ALL CAPS, ENGLISH ONLY)",
  "category":"comedy|reaction|fail|action|reveal|easter egg|bug|controversy|insane gameplay",
  "reason":"why this will go viral (1 short sentence in English)",
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


def _nms(cands: list[dict], thr: float = 0.32) -> list[dict]:
    out: list[dict] = []
    for c in sorted(cands, key=lambda x: (x["score"] + (1.5 if x.get("_src") == "llm" else 0.0)), reverse=True):
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
                   progress=None, windows: list[tuple[float, float]] | None = None) -> list[dict]:
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

    max_win = min(float(lcfg.get("transcript_chunk_minutes", 10) or 10) * 60.0, 600.0)
    all_windows = windows or _plan_windows(duration, int(ccfg["target_count"]), max_window_s=max_win)
    active = [(a, b) for a, b in all_windows if _window_has_activity(transcript, signals, a, b)] or all_windows
    n_chunks = len(active)
    target = int(ccfg["target_count"])
    per_chunk = max(3, min(10, int(np.ceil(target * 2.0 / n_chunks))))
    min_n = max(1, min(per_chunk - 1, int(np.ceil(target / n_chunks))))

    out: list[dict] = []
    en = lang_utils.is_english(cfg.get("resolved_language") or ch.get("language"))
    prompt_tpl = PROMPT_EN if en else PROMPT_PT
    no_speech = ("(no speech — gameplay/trailer video; use the video and signals)" if en
                 else "(sem fala — vídeo de gameplay/trailer; use o vídeo e os sinais)")
    na = "(n/a)" if en else "(n/d)"
    vnote = ("The VIDEO is attached: watch the specific time range and use both visual reactions/action and audio." if en
             else "O VÍDEO está anexado: assista ao trecho indicado e use também reações visuais e ação.") if files else ""
    try:
        for i, (a, b) in enumerate(active):
            progress(0.35 + 0.65 * i / n_chunks, f"IA analisando trecho {i + 1}/{n_chunks}")
            peaks = _peaks_in_window(signals, a, b, n=14, min_gap=8.0)
            rx_hints = _reaction_hints(transcript, a, b, max_items=12)
            rx_txt = "\n".join(f"[{t:.1f}s] {txt[:140]}" for t, _, txt in rx_hints) or na
            prompt = prompt_tpl.format(
                channel=ch["name"], handle=ch["handle"], niche=ch["niche"], title=title, duration=duration,
                a=a, b=b, min_s=ccfg["min_seconds"], max_s=ccfg["max_seconds"], min_n=min_n, n=per_chunk,
                transcript=_transcript_block(transcript, a, b) or no_speech,
                reactions=rx_txt,
                peaks=", ".join(f"{t:.0f}s:{v:.2f}" for t, v in peaks) or na,
                scenes=_scene_rate({"scenes": [t for t in signals.get("scenes", []) if a <= t <= b]},
                                   b, start=a) or na,
                video_note=vnote,
            )
            try:
                data = llm.generate_json(prompt, files=files)
            except Exception as e:  # noqa: BLE001
                log.warning("Janela %.0f-%.0fs falhou no Gemini: %s", a, b, e)
                continue
            clips = data.get("clips", data) if isinstance(data, dict) else data
            for c in clips or []:
                try:
                    s_val, e_val = float(c["start"]), float(c["end"])
                    if e_val > s_val and e_val > 0 and s_val < duration:
                        c["_src"] = "llm"
                        out.append(c)
                except (KeyError, TypeError, ValueError):
                    continue
    finally:
        if uploaded is not None:
            llm.delete_file(uploaded)
    return out


def _heuristic_hook(text: str, keywords: list[str], idx: int, lang: str = "pt") -> tuple[str, str, str]:
    low = text.lower()
    hits = [k for k in keywords if re.search(r"\b" + re.escape(k.lower()) + r"\b", low)]
    rx_hits, _ = virality.reaction_intensity(text)
    en = lang_utils.is_english(lang)
    if any(k in low for k in ("haha", "lmao", "lmfao", "lol", "kkk", "rsrs", "funny", "engraçad", "morri", "socorro")):
        return (("THIS STREAM MOMENT IS HILARIOUS 😂", "comedy", "laughter/comedy reaction + energy burst")
                if en else ("ESSE MOMENTO DA LIVE É HILÁRIO 😂", "humor", "risada/humor na live + pico de energia"))
    if rx_hits >= 1:
        return (("LIVE REACTION GOING CRAZY 😱", "reaction", "strong live reaction + sudden audio burst")
                if en else ("REAÇÃO ABSURDA AO VIVO 😱", "reação", "reação espontânea na live + pico de energia"))
    if any(k in low for k in ("easter egg", "segredo", "secret", "detalhe", "detail", "ninguém percebeu", "nobody noticed")):
        return (("NOBODY NOTICED THIS IN GTA 6!", "easter egg", "hidden secret/detail + audio energy spike")
                if en else ("NINGUÉM PERCEBEU ISSO NO GTA 6!", "easter egg", "segredo/detalhe oculto + pico de energia"))
    if any(k in low for k in ("polícia", "police", "cop", "perseguição", "chase", "assalto", "robbery", "heist", "stick up")):
        return (("INSANE CHASE IN VICE CITY!", "action", "high tension/action + audio spike")
                if en else ("PERSEGUIÇÃO INSANA EM VICE CITY!", "ação", "alta tensão/ação + pico de áudio"))
    if any(k in low for k in ("bug", "glitch", "física", "physics")):
        return (("LOOK AT GTA 6 PHYSICS 😱", "bug", "unexpected physics/moment + energy spike")
                if en else ("OLHA A FÍSICA DO GTA 6 😱", "bug", "física/momento inesperado + pico de energia"))
    if any(k in low for k in ("lucia", "jason")):
        name = "LUCIA" if "lucia" in low else "JASON"
        return ((f"LOOK WHAT {name} DID IN GTA 6!", "insane gameplay", "protagonist spotlight + energy spike")
                if en else (f"OLHA O QUE {name} FEZ NO GTA 6!", "gameplay insana", "protagonista em destaque + pico de energia"))
    if hits:
        kw = hits[0].upper()
        return ((f"{kw} IN GTA 6 IS INSANE!", "insane gameplay", f"trending keywords ({', '.join(hits[:3])}) + energy spike")
                if en else (f"{kw} NO GTA 6 É ABSURDO!", "gameplay insana", f"palavras em alta ({', '.join(hits[:3])}) + pico de energia"))
    fallbacks = (
        ["WAIT FOR THIS STREAM MOMENT 😱", "IS THIS EVEN REAL?!", "CHAT LOST IT AT THIS MOMENT!"]
        if en else ["ESPERA PRA VER ESSA REAÇÃO 😱", "ISSO AO VIVO FOI REAL?!", "O CHAT SURTOU NESSA HORA!"]
    )
    return (fallbacks[idx % len(fallbacks)],
            "reaction" if en else "reação",
            "audio intensity peak and reaction pacing" if en else "pico de reação/áudio e ritmo da live")


def _anchor_start(t_peak: float, transcript: list[dict], duration: float, L: float) -> tuple[float, float]:
    """Posiciona início 1-2s antes do pico para garantir que o gancho caia nos 3 primeiros segundos."""
    start = max(0.0, t_peak - 1.5)
    if transcript:
        nearby = [s["start"] for s in transcript if t_peak - 2.4 <= s["start"] <= t_peak + 0.6]
        if nearby:
            start = max(0.0, min(nearby, key=lambda x: abs(x - (t_peak - 1.2))))
    end = min(duration, start + L)
    return start, end


def heuristic_candidates(transcript, signals, cfg, duration: float,
                         windows: list[tuple[float, float]] | None = None) -> list[dict]:
    ccfg = cfg["clips"]
    kws = cfg.get("trend_keywords") or []
    lang = cfg.get("resolved_language") or cfg["channel"].get("language") or "pt"
    en = lang_utils.is_english(lang)
    target = int(ccfg["target_count"])
    lens = [L for L in (26, 34) if ccfg["min_seconds"] <= L <= ccfg["max_seconds"]] or [ccfg["min_seconds"]]

    win_list = windows or _plan_windows(duration, target, max_window_s=600.0)
    per_win_peaks = max(4, min(12, int(np.ceil(target * 2.5 / max(len(win_list), 1)))))

    seeds: list[float] = []
    for a, b in win_list:
        win_seeds: list[float] = []
        for t, _, _ in _reaction_hints(transcript, a, b, max_items=per_win_peaks):
            win_seeds.append(t)
        for t, _ in _peaks_in_window(signals, a, b, n=per_win_peaks, min_gap=10.0):
            if all(abs(t - s) >= 8.0 for s in win_seeds):
                win_seeds.append(t)
        seeds.extend(sorted(win_seeds))

    cands: list[dict] = []
    for idx, t in enumerate(seeds):
        for L in lens:
            start, end = _anchor_start(t, transcript, duration, L)
            if end - start < min(ccfg["min_seconds"], duration):
                continue
            txt = transcribe.text_between(transcript, start, end)
            hook, cat, reason = _heuristic_hook(txt, kws, idx, lang=lang)
            cands.append({"start": start, "end": end, "hook": hook, "reason": reason,
                          "category": cat, "_src": "heurístico"})
    if not cands:  # sem áudio e sem fala: janelas regulares distribuídas
        step = max(float(ccfg["min_seconds"]), min(40.0, duration / max(target, 1)))
        cands = [{"start": float(s), "end": float(min(duration, s + step)),
                  "hook": "INSANE MOMENT IN GTA 6!" if en else "MOMENTO INSANO NO GTA 6!",
                  "reason": "gameplay highlight window" if en else "janela de gameplay",
                  "category": "gameplay", "_src": "heurístico"}
                 for s in np.arange(0, max(duration - ccfg["min_seconds"], 1), step)]
    return cands


def _select_diverse(final: list[dict], target_count: int, min_score: float, duration: float) -> list[dict]:
    """Seleciona até target_count garantindo cobertura temporal em lives longas sem travar abaixo da meta."""
    if not final:
        return []
    eligible = [c for c in final if c["score"] >= min_score]
    if len(eligible) < target_count and min_score <= 65:
        seen_ids = {id(c) for c in eligible}
        extra = [c for c in final if id(c) not in seen_ids and c["score"] >= 40.0]
        eligible.extend(extra[: target_count - len(eligible)])
    if len(eligible) < min(3, len(final)):
        seen_ids = {id(c) for c in eligible}
        eligible.extend([c for c in final if id(c) not in seen_ids][: min(3, len(final)) - len(eligible)])

    if len(eligible) <= target_count:
        return sorted(eligible, key=lambda x: x["score"], reverse=True)

    # Diversidade temporal: em vídeos/lives >= 20 min, garante os melhores momentos espalhados por blocos (~10 min)
    if duration >= 1200 and target_count >= 8:
        n_buckets = min(target_count, max(4, int(round(duration / 600.0))))
        b_size = duration / n_buckets
        buckets: list[list[dict]] = [[] for _ in range(n_buckets)]
        for c in sorted(eligible, key=lambda x: x["score"], reverse=True):
            mid = (c["start"] + c["end"]) / 2.0
            bi = min(n_buckets - 1, max(0, int(mid / max(b_size, 1e-6))))
            buckets[bi].append(c)

        picked: list[dict] = []
        picked_ids: set[int] = set()
        # Primeiro, o melhor corte de cada janela (ordenado pelas janelas com melhor clipe)
        non_empty = [b for b in buckets if b]
        non_empty.sort(key=lambda b: b[0]["score"], reverse=True)
        for b in non_empty:
            if len(picked) >= target_count:
                break
            picked.append(b[0])
            picked_ids.add(id(b[0]))

        # Depois completa os slots restantes pelos maiores scores globais
        for c in sorted(eligible, key=lambda x: x["score"], reverse=True):
            if len(picked) >= target_count:
                break
            if id(c) not in picked_ids:
                picked.append(c)
                picked_ids.add(id(c))
        return sorted(picked, key=lambda x: x["score"], reverse=True)

    return sorted(eligible, key=lambda x: x["score"], reverse=True)[:target_count]


def find_highlights(video: Path, work_dir: Path, transcript, signals, cfg, duration: float, title: str,
                    progress=None) -> tuple[list[dict], str]:
    """Retorna (cortes ordenados por score, método usado)."""
    t_sample = " ".join(s["text"] for s in (transcript or [])[:40])
    det = transcribe.detected_language(work_dir / "transcript.json")
    target_lang = lang_utils.effective_language(cfg, transcript_text=t_sample, title=title, detected=det)
    cfg = lang_utils.apply_language_cfg(cfg, target_lang)

    target_count = int(cfg["clips"]["target_count"])
    max_win = min(float(cfg["llm"].get("transcript_chunk_minutes", 10) or 10) * 60.0, 600.0)
    windows = _plan_windows(duration, target_count, max_window_s=max_win)

    method = "heurístico"
    llm_raw: list[dict] = []
    if get_llm().available:
        try:
            llm_raw = llm_candidates(video, work_dir, transcript, signals, cfg, duration, title,
                                     progress, windows=windows)
            if llm_raw:
                method = f"gemini ({get_llm().model})"
        except Exception as e:  # noqa: BLE001
            log.warning("Gemini falhou, usando heurística: %s", e)

    final_llm = _nms([_finalize(c, transcript, signals, cfg, duration) for c in llm_raw])

    # Completa janelas sem cobertura do LLM ou quando o LLM trouxe menos que a meta
    uncovered = [
        (a, b) for a, b in windows
        if _window_has_activity(transcript, signals, a, b)
        and not any(c["end"] > a and c["start"] < b for c in final_llm)
    ]
    raw = list(final_llm)
    if not final_llm:
        heur_raw = heuristic_candidates(transcript, signals, cfg, duration, windows=windows)
        raw = [_finalize(c, transcript, signals, cfg, duration) for c in heur_raw]
    elif len(final_llm) < target_count or uncovered:
        top_up_wins = uncovered if len(final_llm) >= target_count else windows
        heur_raw = heuristic_candidates(transcript, signals, cfg, duration, windows=top_up_wins)
        raw.extend(_finalize(c, transcript, signals, cfg, duration) for c in heur_raw)

    final = _nms(raw)
    selected = _select_diverse(final, target_count, float(cfg["clips"]["min_score"]), duration)
    if llm_raw and any(c.get("_src") == "heurístico" for c in selected):
        method = f"gemini ({get_llm().model}) + heurístico"
    for c in selected:
        c.pop("_src", None)
    return selected, method
