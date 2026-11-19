"""Detecção e censura localizada (apenas sobre a área sensível) para cenas +18."""
from __future__ import annotations

import logging
from pathlib import Path

from .llm import get_llm

log = logging.getLogger("clipsreal.censor")

CENSOR_PROMPT = """You are a strict platform-safety video moderation assistant for YouTube Shorts, TikTok, and Instagram Reels.
Inspect these sequential video frames (from a clip of duration {dur:.1f}s) and locate ONLY explicit 18+ / policy-violating visual regions that could cause a video takedown or age strike:
- Exposed nudity or explicit intimate body parts / sexual acts
- Graphic extreme gore, dismemberment, exposed organs, or excessive realistic blood closeups
- Explicit hate symbols or uncensored slurs visible on screen

IMPORTANT RULES:
- DO NOT flag normal clothed characters, normal gameplay, driving, regular action, weapons, HUD/UI, or normal faces/webcams.
- NEVER return a box covering the whole screen. Tightly bound ONLY the specific sensitive part that needs blurring/pixelation.
- If a frame is safe, do NOT include it.
- Coordinates MUST use box_2d: [ymin, xmin, ymax, xmax] normalized 0 to 1000.

Reply ONLY with valid JSON:
{{"detections":[{{"frame":0,"t":1.5,"label":"nudity|gore|explicit","box_2d":[ymin,xmin,ymax,xmax]}}]}}
If all frames are safe, reply: {{"detections":[]}}
"""


def _sample_frames(video: Path, start: float, end: float, max_frames: int = 18) -> list[tuple[float, bytes]]:
    import cv2

    dur = max(0.5, float(end - start))
    step = max(1.2, dur / max_frames)
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        return []
    out: list[tuple[float, bytes]] = []
    t_rel = min(0.4, dur * 0.25)
    try:
        while t_rel < dur and len(out) < max_frames:
            cap.set(cv2.CAP_PROP_POS_MSEC, float(start + t_rel) * 1000.0)
            ok, frame = cap.read()
            if ok and frame is not None:
                h, w = frame.shape[:2]
                if w > 640:
                    nh = max(2, int(h * 640 / w))
                    frame = cv2.resize(frame, (640, nh))
                ok_jpg, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
                if ok_jpg:
                    out.append((round(t_rel, 2), buf.tobytes()))
            t_rel += step
    finally:
        cap.release()
    return out


def _iou(a: dict, b: dict) -> float:
    x1 = max(a["x"], b["x"])
    y1 = max(a["y"], b["y"])
    x2 = min(a["x"] + a["w"], b["x"] + b["w"])
    y2 = min(a["y"] + a["h"], b["y"] + b["h"])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    if inter <= 0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / max(1, union)


def _to_pixel_box(box_2d: list, sw: int, sh: int, t0: float, t1: float, label: str = "") -> dict | None:
    if not isinstance(box_2d, (list, tuple)) or len(box_2d) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = [float(v) for v in box_2d]
    except (TypeError, ValueError):
        return None
    if max(ymin, xmin, ymax, xmax) <= 1.05:
        ymin, xmin, ymax, xmax = ymin * 1000.0, xmin * 1000.0, ymax * 1000.0, xmax * 1000.0
    ymin, ymax = max(0.0, min(ymin, ymax)), min(1000.0, max(ymin, ymax))
    xmin, xmax = max(0.0, min(xmin, xmax)), min(1000.0, max(xmin, xmax))
    bw_n, bh_n = xmax - xmin, ymax - ymin
    if bw_n < 15 or bh_n < 15:
        return None
    # Nunca censura a tela inteira — exige região localizada
    if (bw_n * bh_n) > 600_000 or (bw_n > 850 and bh_n > 700):
        return None
    pad_x, pad_y = bw_n * 0.08, bh_n * 0.08
    x1 = max(0, int((xmin - pad_x) / 1000.0 * sw)) // 2 * 2
    y1 = max(0, int((ymin - pad_y) / 1000.0 * sh)) // 2 * 2
    x2 = min(sw, int((xmax + pad_x) / 1000.0 * sw)) // 2 * 2
    y2 = min(sh, int((ymax + pad_y) / 1000.0 * sh)) // 2 * 2
    w, h = x2 - x1, y2 - y1
    if w < 16 or h < 16 or (w * h) > 0.62 * sw * sh:
        return None
    return {"t0": round(t0, 2), "t1": round(t1, 2), "x": x1, "y": y1, "w": w, "h": h, "label": label[:24]}


def _merge_boxes(boxes: list[dict], sw: int, sh: int, max_boxes: int = 16) -> list[dict]:
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda b: (b["t0"], b["x"], b["y"]))
    merged: list[dict] = []
    for b in boxes:
        placed = False
        for m in merged:
            if b["t0"] <= m["t1"] + 0.5 and _iou(m, b) >= 0.15:
                nx1 = min(m["x"], b["x"]) // 2 * 2
                ny1 = min(m["y"], b["y"]) // 2 * 2
                nx2 = max(m["x"] + m["w"], b["x"] + b["w"]) // 2 * 2
                ny2 = max(m["y"] + m["h"], b["y"] + b["h"]) // 2 * 2
                nw, nh = nx2 - nx1, ny2 - ny1
                if (nw * nh) <= 0.62 * sw * sh:
                    m.update({"t1": max(m["t1"], b["t1"]), "x": nx1, "y": ny1, "w": nw, "h": nh})
                    placed = True
                    break
        if not placed:
            merged.append(dict(b))
    merged.sort(key=lambda b: (b["t1"] - b["t0"]) * b["w"] * b["h"], reverse=True)
    return sorted(merged[:max_boxes], key=lambda b: b["t0"])


def detect_sensitive_regions(video: Path, start: float, end: float, sw: int, sh: int) -> list[dict]:
    """Detecta caixas localizadas de conteúdo +18 usando Gemini Vision nos frames amostrados."""
    llm = get_llm()
    if not llm.available or sw <= 0 or sh <= 0:
        return []
    frames = _sample_frames(video, start, end)
    if not frames:
        return []

    from google.genai import types

    dur = max(0.5, float(end - start))
    step = frames[1][0] - frames[0][0] if len(frames) > 1 else dur
    raw_boxes: list[dict] = []

    for b in range(0, len(frames), 10):
        batch = frames[b:b + 10]
        parts: list = []
        for idx, (t_rel, jpg) in enumerate(batch):
            parts.append(f"Frame {idx} (t={t_rel:.2f}s):")
            parts.append(types.Part.from_bytes(data=jpg, mime_type="image/jpeg"))
        try:
            data = llm.generate_json(CENSOR_PROMPT.format(dur=dur), files=parts, temperature=0.1, retries=2)
        except Exception as e:  # noqa: BLE001
            log.warning("Detecção +18 falhou no lote %s: %s", b, e)
            continue
        dets = data.get("detections", []) if isinstance(data, dict) else []
        for d in dets or []:
            if not isinstance(d, dict):
                continue
            try:
                fi = int(d.get("frame", -1))
                t_rel = batch[fi][0] if 0 <= fi < len(batch) else float(d.get("t", 0.0))
            except (TypeError, ValueError):
                continue
            t0 = max(0.0, t_rel - step * 0.65)
            t1 = min(dur, t_rel + step * 0.65)
            box = _to_pixel_box(d.get("box_2d"), sw, sh, t0, t1, str(d.get("label") or "18+"))
            if box:
                raw_boxes.append(box)
    return _merge_boxes(raw_boxes, sw, sh)


def build_censor_filter(boxes: list[dict], sw: int, sh: int, style: str = "pixelate") -> tuple[str, str]:
    """Constrói cadeia FFmpeg que aplica censura APENAS sobre as caixas [x,y,w,h] em [t0,t1]."""
    valid = []
    for b in boxes or []:
        try:
            t0, t1 = max(0.0, float(b["t0"])), float(b["t1"])
            x, y = max(0, int(b["x"])) // 2 * 2, max(0, int(b["y"])) // 2 * 2
            w, h = min(sw - x, int(b["w"])) // 2 * 2, min(sh - y, int(b["h"])) // 2 * 2
        except (KeyError, TypeError, ValueError):
            continue
        if t1 > t0 and w >= 16 and h >= 16 and (w * h) <= 0.65 * sw * sh:
            valid.append({"t0": t0, "t1": t1, "x": x, "y": y, "w": w, "h": h})
    if not valid:
        return "", "[0:v]"

    st = (style or "pixelate").strip().lower()
    if st == "black":
        draws = ",".join(
            f"drawbox=x={b['x']}:y={b['y']}:w={b['w']}:h={b['h']}:"
            f"color=black@0.98:t=fill:enable='between(t\\,{b['t0']:.2f}\\,{b['t1']:.2f})'"
            for b in valid
        )
        return f"[0:v]{draws}[vcens];", "[vcens]"

    chains = []
    cur = "0:v"
    for i, b in enumerate(valid):
        nxt = "vcens" if i == len(valid) - 1 else f"vc{i}"
        w, h, x, y = b["w"], b["h"], b["x"], b["y"]
        t0, t1 = b["t0"], b["t1"]
        if st == "blur":
            rad = max(2, min(28, (min(w, h) // 4) - 1))
            fx = f"boxblur={rad}:2"
        else:
            pw, ph = max(4, w // 14), max(4, h // 14)
            max_cr = max(1, (min(w, h) // 4) - 1)
            rad = min(4, max_cr)
            fx = f"scale={pw}:{ph}:flags=neighbor,scale={w}:{h}:flags=neighbor"
            if min(w, h) >= 20:
                fx += f",boxblur={rad}:1"
        chains.append(
            f"[{cur}]split=2[cb{i}][cs{i}];"
            f"[cs{i}]crop={w}:{h}:{x}:{y},{fx}[cf{i}];"
            f"[cb{i}][cf{i}]overlay={x}:{y}:enable='between(t\\,{t0:.2f}\\,{t1:.2f})'[{nxt}]"
        )
        cur = nxt
    return ";".join(chains) + ";", "[vcens]"
