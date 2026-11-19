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


_WM_ALIGN = {
    "bottom-left": 1,
    "bottom-center": 2,
    "bottom-right": 3,
    "top-left": 7,
    "top-center": 8,
    "top-right": 9,
}


_HOOK_STYLES = {
    # (PrimaryColour text, OutlineColour box fill, BackColour shadow)
    "white": ("&H00000000", "&H00FFFFFF", "&H64000000"),
    "red":   ("&H00FFFFFF", "&H001A1AD8", "&H80000000"),
    "black": ("&H00FFFFFF", "&H00000000", "&H80000000"),
}


def _hook_layout(rcfg: dict, height: int, has_broll: bool = False) -> tuple[int, int]:
    mode = (rcfg.get("mode") or "blur").strip().lower()
    pos = (rcfg.get("hook_position") or "auto").strip().lower()
    if pos == "auto":
        pos = "middle" if mode in ("dual", "dual_dopamine") else "top"
    if pos == "middle":
        if mode == "dual":
            return 8, int(height * 0.345)
        if mode == "dual_dopamine":
            return 8, int(height * (0.465 if has_broll else 0.365))
        return 5, 0
    if mode == "card":
        return 8, int(height * 0.14)
    return 8, int(height * 0.11)


def build_ass(words: list[dict], out: Path, rcfg: dict, duration: float, hook: str = "",
              watermark: str = "", width: int = 1080, height: int = 1920,
              has_broll: bool = False) -> Path:
    font, size = rcfg["caption_font"], rcfg["caption_size"]
    hl = _inline_color(rcfg["highlight_color"])
    wm_pos = (rcfg.get("watermark_position") or "bottom-center").strip().lower()
    wm_align = _WM_ALIGN.get(wm_pos, 2)
    wm_margin_v = int(height * (0.045 if wm_align >= 7 else 0.055))
    wm_size = max(18, min(80, int(rcfg.get("watermark_size", 38) or 38)))
    wm_opacity = max(10, min(100, int(rcfg.get("watermark_opacity", 65) or 65)))
    wm_alpha = int(round((100 - wm_opacity) / 100 * 255))
    wm_out_alpha = min(255, int(wm_alpha + (255 - wm_alpha) * 0.45))
    h_txt, h_box, h_back = _HOOK_STYLES.get((rcfg.get("hook_style") or "white").lower(), _HOOK_STYLES["white"])
    h_align, h_margin_v = _hook_layout(rcfg, height, has_broll=has_broll)
    is_dual = (rcfg.get("mode") or "") in ("dual", "dual_dopamine")
    hook_sz = min(int(rcfg.get("hook_size", 66)), 54) if is_dual else int(rcfg.get("hook_size", 66))
    cap_margin_v = int(rcfg.get("caption_margin_v", 470))
    if (rcfg.get("mode") or "") in ("dual", "dual_dopamine", "card"):
        cap_margin_v = min(cap_margin_v, int(height * 0.14))
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        f"Style: Caption,{font},{size},{rcfg['caption_color']},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,"
        f"1,7,3,2,60,60,{cap_margin_v},1",
        f"Style: Hook,{rcfg['hook_font']},{hook_sz},{h_txt},&H000000FF,{h_box},{h_back},-1,0,0,0,"
        f"100,100,0,0,3,16,0,{h_align},56,56,{h_margin_v},1",
        f"Style: Mark,Arial,{wm_size},&H{wm_alpha:02X}FFFFFF,&H000000FF,&H{wm_out_alpha:02X}000000,&H00000000,-1,0,0,0,"
        f"100,100,1,0,1,2,0,{wm_align},48,48,{wm_margin_v},1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    end_all = ts(duration)
    if hook and rcfg.get("hook_title", True):
        wrap_w = 28 if is_dual else 22
        wrapped = "\\N".join(textwrap.wrap(_esc(hook.upper()), width=wrap_w)[:2])
        lines.append(f"Dialogue: 2,{ts(0)},{end_all},Hook,,0,0,0,,{wrapped}")
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
