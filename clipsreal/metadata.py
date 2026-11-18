"""SEO: título, descrição, hashtags e tags (Shorts e vídeo longo) com Gemini + fallback por template."""
from __future__ import annotations

import logging
import re

from .llm import get_llm

log = logging.getLogger("clipsreal.metadata")

SHORT_PROMPT = """Você é especialista em SEO e crescimento de canais de GTA 6 no YouTube Brasil (Shorts).
Canal: {name} ({handle}). Idioma: {lang}. CTA padrão: "{cta}".
Vídeo de origem: "{source_title}".

Para CADA corte abaixo, gere metadados que maximizem CTR e retenção, sem clickbait mentiroso:
- "title": 40-70 caracteres, gap de curiosidade, contém "GTA 6" de forma natural, no máx 1 emoji, sem < ou >.
- "description": 3-5 linhas curtas: 1ª linha = gancho com palavra-chave; contexto do momento; CTA; e por último 3-5 hashtags.
- "hashtags": 3-6 hashtags (sempre incluir #GTA6 e #Shorts), sem espaços.
- "tags": 12-20 tags (PT e EN, variações: "gta 6", "gta vi", "gta 6 gameplay", nomes, lugares) — total < 450 caracteres.
- "thumb_text": 2-4 palavras impactantes para capa.

CORTES:
{items}

Responda SOMENTE JSON: {{"items":[{{"i":0,"title":"...","description":"...","hashtags":["#GTA6"],"tags":["gta 6"],"thumb_text":"..."}}]}}
"""

LONG_PROMPT = """Você é especialista em SEO de vídeos longos de GTA 6 no YouTube Brasil.
Canal: {name} ({handle}). CTA: "{cta}".
Este vídeo longo é uma compilação dos melhores momentos abaixo (capítulos com tempo):
{chapters}

Gere:
- "title": até 70 caracteres, altíssimo CTR (ex.: listas, superlativos, curiosidade), contém "GTA 6", sem < ou >.
- "description": 1º parágrafo (2 linhas) rico em palavras-chave; parágrafo de contexto; a lista de CAPÍTULOS exatamente
  com os tempos fornecidos (formato "00:00 Título"); CTA para inscrever/ativar sino; 3 hashtags no fim.
- "hashtags": 3 hashtags.
- "tags": 25-35 tags PT+EN de cauda curta e longa, total < 480 caracteres.
- "thumb_text": 2-4 palavras para a thumbnail.
- "chapter_titles": lista com um título curto (máx 40 caracteres) para cada capítulo, na mesma ordem.

Responda SOMENTE JSON: {{"title":"","description":"","hashtags":[],"tags":[],"thumb_text":"","chapter_titles":[]}}
"""


# ----------------------------------------------------------------- sanitização
def clean_title(t: str, limit: int = 100) -> str:
    t = re.sub(r"[<>]", "", (t or "").replace("\n", " ")).strip()
    return t[:limit].rstrip()


def clean_hashtags(tags: list[str], defaults: list[str], limit: int = 15) -> list[str]:
    out: list[str] = []
    for h in [*(tags or []), *defaults]:
        h = "#" + re.sub(r"[^\w]", "", str(h).lstrip("#"), flags=re.U)
        if len(h) > 1 and h.lower() not in [x.lower() for x in out]:
            out.append(h)
    return out[:limit]


def clean_tags(tags: list[str], max_total: int = 480) -> list[str]:
    out, total = [], 0
    for t in tags or []:
        t = re.sub(r"[<>,#]", "", str(t)).strip()
        if not t or t.lower() in [x.lower() for x in out] or len(t) > 100:
            continue
        cost = len(t) + (2 if " " in t else 0) + 1
        if total + cost > max_total:
            break
        out.append(t)
        total += cost
    return out


def clean_description(d: str, hashtags: list[str]) -> str:
    d = re.sub(r"[<>]", "", d or "").strip()
    if hashtags and not any(h.lower() in d.lower() for h in hashtags[:2]):
        d += "\n\n" + " ".join(hashtags[:5])
    return d.encode("utf-8")[:4900].decode("utf-8", "ignore")


def fmt_ts(t: float) -> str:
    t = int(t)
    return f"{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60:02d}:{t % 60:02d}"


# ----------------------------------------------------------------- fallback
BASE_TAGS = ["gta 6", "gta vi", "gta 6 gameplay", "grand theft auto 6", "gta 6 brasil", "gta 6 shorts",
             "vice city", "gta 6 lucia", "gta 6 jason", "rockstar games", "gta 6 cortes", "gta 6 momentos",
             "gta 6 segredos", "gta 6 easter egg", "gta 6 pt br", "gta vi gameplay"]


def _fallback_short(c: dict, cfg: dict) -> dict:
    hook = (c.get("hook") or "").strip()
    cat = (c.get("category") or "").lower()
    txt = (c.get("transcript") or "").strip()
    extra_hash = []
    if "vice city" in txt.lower():
        extra_hash.append("#ViceCity")
    if "lucia" in txt.lower():
        extra_hash.append("#Lucia")
    if "jason" in txt.lower():
        extra_hash.append("#Jason")
    if "easter egg" in cat or "easter egg" in txt.lower():
        extra_hash.append("#EasterEgg")
    if hook:
        nice = hook.rstrip("!?.")
        title = nice if "gta" in nice.lower() else f"{nice} no GTA 6"
        if title.isupper() or nice.isupper():
            title = title.capitalize()
            for kw in ("GTA 6", "GTA VI", "GTA", "Vice City", "Leonida", "Lucia", "Jason"):
                title = re.sub(re.escape(kw), kw, title, flags=re.I)
        if "😱" not in title and "🔥" not in title:
            title += " 🔥"
    else:
        title = "Esse momento no GTA 6 é INSANO 😱"
    hashtags = clean_hashtags(extra_hash, cfg["channel"]["default_hashtags"])
    lead = txt[:130].rstrip(" ,;.") + ("..." if len(txt) > 130 else "") if txt else "Olha o que aconteceu no GTA 6!"
    desc = (f"{lead}\n"
            f"{(c.get('reason') or '').strip()}\n{cfg['channel']['cta']}\n\n" + " ".join(hashtags))
    return {"title": clean_title(title), "description": desc, "hashtags": hashtags,
            "tags": clean_tags(BASE_TAGS), "thumb_text": (hook or "GTA 6 INSANO")[:36]}


# ----------------------------------------------------------------- geração
def shorts_metadata(clips: list[dict], cfg: dict, source_title: str) -> list[dict]:
    ch = cfg["channel"]
    results = [_fallback_short(c, cfg) for c in clips]
    llm = get_llm()
    if not llm.available or not clips:
        return results
    for b in range(0, len(clips), 10):
        batch = clips[b:b + 10]
        items = "\n".join(
            f"[{b + i}] gancho: {c.get('hook', '')} | categoria: {c.get('category', '')} | motivo: {c.get('reason', '')}"
            f" | fala: {(c.get('transcript') or '(sem fala)')[:600]}"
            for i, c in enumerate(batch))
        try:
            data = llm.generate_json(SHORT_PROMPT.format(name=ch["name"], handle=ch["handle"], lang=ch["language"],
                                                         cta=ch["cta"], source_title=source_title, items=items),
                                     temperature=0.8)
            for it in data.get("items", []):
                i = int(it.get("i", -1))
                if not 0 <= i < len(results):
                    continue
                hashtags = clean_hashtags(it.get("hashtags", []), ch["default_hashtags"])
                results[i] = {
                    "title": clean_title(it.get("title") or results[i]["title"]),
                    "description": clean_description(it.get("description", ""), hashtags),
                    "hashtags": hashtags,
                    "tags": clean_tags(it.get("tags") or BASE_TAGS),
                    "thumb_text": (it.get("thumb_text") or results[i]["thumb_text"])[:40],
                }
        except Exception as e:  # noqa: BLE001
            log.warning("Metadados via Gemini falharam (usando template): %s", e)
    return results


def long_metadata(chapters: list[tuple[float, str]], cfg: dict) -> dict:
    ch = cfg["channel"]
    chap_txt = "\n".join(f"{fmt_ts(t)} {title}" for t, title in chapters)
    hashtags = clean_hashtags(["#GTA6", "#GTAVI", "#GTA6Gameplay"], [])
    meta = {
        "title": clean_title(f"OS {len(chapters)} MOMENTOS MAIS INSANOS DO GTA 6", 100),
        "description": (f"Os momentos mais insanos, engraçados e chocantes de GTA 6 (GTA VI) em um só vídeo!\n\n"
                        f"CAPÍTULOS:\n{chap_txt}\n\n{ch['cta']}\n\n" + " ".join(hashtags)),
        "hashtags": hashtags, "tags": clean_tags(BASE_TAGS + ["gta 6 compilação", "gta 6 melhores momentos"]),
        "thumb_text": "GTA 6 INSANO", "chapter_titles": [c[1] for c in chapters],
    }
    llm = get_llm()
    if not llm.available:
        return meta
    try:
        data = llm.generate_json(LONG_PROMPT.format(name=ch["name"], handle=ch["handle"], cta=ch["cta"],
                                                    chapters=chap_txt), temperature=0.8)
        titles = data.get("chapter_titles") or []
        if len(titles) == len(chapters):
            chap_txt2 = "\n".join(f"{fmt_ts(t)} {clean_title(n, 60)}" for (t, _), n in zip(chapters, titles))
            desc = (data.get("description") or "").replace(chap_txt, chap_txt2)
            if chap_txt2 not in desc:
                desc = desc + "\n\nCAPÍTULOS:\n" + chap_txt2
        else:
            desc = data.get("description") or meta["description"]
            if "00:00" not in desc:
                desc += "\n\nCAPÍTULOS:\n" + chap_txt
        hashtags = clean_hashtags(data.get("hashtags", []), ["#GTA6"], limit=5)
        meta.update({
            "title": clean_title(data.get("title") or meta["title"]),
            "description": clean_description(desc, hashtags),
            "hashtags": hashtags,
            "tags": clean_tags(data.get("tags") or meta["tags"]),
            "thumb_text": (data.get("thumb_text") or meta["thumb_text"])[:40],
            "chapter_titles": titles or meta["chapter_titles"],
        })
    except Exception as e:  # noqa: BLE001
        log.warning("Metadados longos via Gemini falharam: %s", e)
    return meta


def export_txt(meta: dict, path, score: float | None = None, breakdown: dict | None = None) -> None:
    lines = [f"TÍTULO:\n{meta.get('title', '')}\n", f"DESCRIÇÃO:\n{meta.get('description', '')}\n",
             f"HASHTAGS:\n{' '.join(meta.get('hashtags', []))}\n", f"TAGS:\n{', '.join(meta.get('tags', []))}\n"]
    if score is not None:
        lines.append(f"SCORE VIRAL: {score}  {breakdown or ''}")
    path.write_text("\n".join(lines), encoding="utf-8")


def sync_clip_files(clip: dict) -> None:
    """Atualiza metadata.json e metadata.txt na pasta do corte após edição ou regeneração."""
    import json
    from pathlib import Path

    fp = clip.get("file_path")
    if not fp:
        return
    out_dir = Path(fp).parent
    if not out_dir.is_dir():
        return
    meta = {k: clip.get(k) for k in ("title", "description", "hashtags", "tags", "score", "score_label",
                                     "breakdown", "hook", "reason", "category", "start", "end")}
    (out_dir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    export_txt(meta, out_dir / "metadata.txt", clip.get("score"), clip.get("breakdown"))
