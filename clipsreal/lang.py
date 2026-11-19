"""Resolução e normalização de idioma (PT / EN) para transcrição, IA, SEO e YouTube."""
from __future__ import annotations

import copy
import re

EN_CTA = "Subscribe to the channel for daily GTA 6 clips!"
PT_CTA = "Inscreva-se no canal para cortes de GTA 6 todos os dias!"
EN_NICHE = "GTA 6 / GTA VI (Grand Theft Auto VI) — clips, gameplay, secrets, news"
PT_NICHE = "GTA 6 / GTA VI (Grand Theft Auto VI) — cortes, gameplay, segredos, notícias"

EN_TREND_KEYWORDS = [
    "secret", "secrets", "easter egg", "nobody noticed", "detail", "details",
    "police", "cop", "cops", "chase", "robbery", "heist", "stick up", "shootout",
    "bug", "glitch", "physics", "insane", "crazy", "wild", "unreal", "leak",
    "leaks", "trailer", "map", "car", "cars", "money", "cash", "release",
    "tiger", "tigers", "baby", "jail", "prison", "fight", "plane",
]

_EN_STOP = {
    "the", "you", "and", "that", "this", "with", "have", "what", "are", "for",
    "not", "was", "it's", "i'm", "don't", "gonna", "bro", "bruh", "wait", "look",
    "they", "we", "here", "she", "he", "his", "her", "your", "out", "get", "got",
    "can", "all", "man", "oh", "my", "god", "shit", "fuck", "like", "just",
}
_PT_STOP = {
    "que", "não", "nao", "para", "com", "uma", "você", "voce", "isso", "como",
    "está", "esta", "aqui", "mais", "meu", "minha", "pra", "tá", "ta", "cara",
    "mano", "olha", "gente", "muito", "esse", "essa", "ele", "ela", "dos", "das",
    "por", "tem", "vai", "foi", "são", "sao", "sobre", "tudo", "bem", "nos",
}
_PT_DIACRITICS = re.compile(r"[ãõçáéíóúâêôà]", re.I)


def normalize_lang(val: str | None) -> str | None:
    """Normaliza código/nome de idioma para 'pt', 'en', outro ISO curto ou None (auto)."""
    s = (val or "").strip().lower()
    if s in ("", "auto", "none", "null"):
        return None
    if s.startswith("en") or s in ("english", "inglês", "ingles"):
        return "en"
    if s.startswith("pt") or s in ("portuguese", "português", "portugues"):
        return "pt"
    return s.split("-")[0]


def is_english(lang: str | None) -> bool:
    return normalize_lang(lang) == "en"


def detect_text_language(text: str) -> str | None:
    """Heurística leve para diferenciar inglês vs português em transcrições/títulos."""
    txt = (text or "").strip()
    if not txt:
        return None
    words = re.findall(r"[a-zA-ZÀ-ÿ']+", txt.lower())
    if not words:
        return None
    en_hits = sum(1 for w in words if w in _EN_STOP)
    pt_hits = sum(1 for w in words if w in _PT_STOP)
    pt_accents = len(_PT_DIACRITICS.findall(txt))
    # Um acento isolado (ex.: "Lucía" do Whisper) não deve superar stopwords claras em inglês
    pt_score = pt_hits * 2 + (pt_accents if pt_accents >= 3 else 0)
    en_score = en_hits * 2
    if en_score == 0 and pt_score == 0:
        return None
    if en_score > pt_score:
        return "en"
    if pt_score > en_score:
        return "pt"
    return None


def effective_language(cfg: dict, transcript_text: str = "", title: str = "", detected: str | None = None) -> str:
    """Resolve o idioma final do trabalho ('en' ou 'pt') sem misturar idiomas."""
    explicit = normalize_lang(cfg.get("resolved_language")) or normalize_lang(
        (cfg.get("transcription") or {}).get("language")
    )
    if explicit in ("en", "pt"):
        return explicit

    det = normalize_lang(detected)
    if det in ("en", "pt"):
        return det

    from_txt = detect_text_language(transcript_text)
    if from_txt in ("en", "pt"):
        return from_txt

    from_title = detect_text_language(title)
    if from_title in ("en", "pt"):
        return from_title

    ch_lang = normalize_lang((cfg.get("channel") or {}).get("language"))
    return ch_lang if ch_lang in ("en", "pt") else "pt"


def apply_language_cfg(cfg: dict, lang: str | None) -> dict:
    """Retorna cópia de cfg alinhada ao idioma alvo (CTA, nicho, canal e trend_keywords)."""
    norm = normalize_lang(lang)
    if not norm:
        return cfg
    out = copy.deepcopy(cfg)
    out["resolved_language"] = norm
    ch = out.setdefault("channel", {})
    cta = (ch.get("cta") or "").strip()
    niche = (ch.get("niche") or "").strip()
    kws = list(out.get("trend_keywords") or [])

    if norm == "en":
        ch["language"] = "en"
        if not cta or any(k in cta.lower() for k in ("inscreva", "cortes de gta", "todos os dias")):
            ch["cta"] = EN_CTA
        if not niche or any(k in niche.lower() for k in ("cortes", "segredos", "notícias")):
            ch["niche"] = EN_NICHE
        existing = {k.lower() for k in kws}
        for k in EN_TREND_KEYWORDS:
            if k.lower() not in existing:
                kws.append(k)
        out["trend_keywords"] = kws
    elif norm == "pt":
        ch["language"] = "pt-BR"
        if not cta or "subscribe" in cta.lower():
            ch["cta"] = PT_CTA
        if not niche or "secrets, news" in niche.lower():
            ch["niche"] = PT_NICHE
    return out
