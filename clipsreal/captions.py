"""Legendas dinâmicas palavra-por-palavra (ASS/libass) + título-gancho + marca d'água."""
from __future__ import annotations

import re
import textwrap
from pathlib import Path


def ts(t: float) -> str:
    cs = int(round(max(t, 0) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _inline_color(ass_color: str) -> str:
    hexpart = re.sub(r"[^0-9A-Fa-f]", "", ass_color.replace("&H", ""))[-6:]
    return f"&H{hexpart.upper()}&"


def _esc(s: str) -> str:
    return s.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")


def group_words(words: list[dict], max_words: int = 3, max_gap: float = 0.6) -> list[list[dict]]:
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur and (len(cur) >= max_words or w["start"] - cur[-1]["end"] > max_gap
                    or re.search(r"[.!?…]$", cur[-1]["word"])):
            groups.append(cur)
            cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def build_ass(words: list[dict], out: Path, rcfg: dict, duration: float, hook: str = "",
              watermark: str = "", width: int = 1080, height: int = 1920) -> Path:
    font, size = rcfg["caption_font"], rcfg["caption_size"]
    hl = _inline_color(rcfg["highlight_color"])
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: Caption,{font},{size},{rcfg['caption_color']},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,"
        f"1,7,3,2,60,60,{rcfg['caption_margin_v']},1",
        f"Style: Hook,{rcfg['hook_font']},{rcfg['hook_size']},&H00000000,&H000000FF,&H00FFFFFF,&H64000000,-1,0,0,0,"
        f"100,100,0,0,3,18,0,8,70,70,{int(height * 0.12)},1",
        f"Style: Mark,Arial,38,&H60FFFFFF,&H000000FF,&H80000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,2,40,40,"
        f"{int(height * 0.055)},1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    end_all = ts(duration)
    if hook and rcfg.get("hook_title", True):
        wrapped = "\\N".join(textwrap.wrap(_esc(hook.upper()), width=20)[:3])
        lines.append(f"Dialogue: 2,{ts(0)},{end_all},Hook,,0,0,0,,{{\\fad(150,0)}}{wrapped}")
    if watermark and rcfg.get("watermark", True):
        lines.append(f"Dialogue: 1,{ts(0)},{end_all},Mark,,0,0,0,,{_esc(watermark)}")

    if rcfg.get("captions", True) and words:
        groups = group_words(words, rcfg.get("words_per_group", 3))
        for gi, g in enumerate(groups):
            nxt_start = groups[gi + 1][0]["start"] if gi + 1 < len(groups) else None
            g_end = g[-1]["end"]
            if nxt_start is not None and nxt_start - g_end < 0.35:
                g_end = nxt_start
            for wi, w in enumerate(g):
                st = w["start"]
                en = g[wi + 1]["start"] if wi + 1 < len(g) else g_end
                if en <= st:
                    en = st + 0.08
                parts = []
                for wj, w2 in enumerate(g):
                    t = _esc(w2["word"].upper())
                    if wj == wi:
                        parts.append(f"{{\\c{hl}\\fscx112\\fscy112}}{t}{{\\r}}")
                    else:
                        parts.append(t)
                lines.append(f"Dialogue: 3,{ts(min(st, duration))},{ts(min(en, duration))},Caption,,0,0,0,,"
                             + " ".join(parts))
    out.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")
    return out
