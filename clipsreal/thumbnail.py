"""Thumbnails estilo YouTube (Pillow): frame + contraste + texto gigante com contorno + selo GTA 6."""
from __future__ import annotations

import os
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

FONT_CANDIDATES = ["impact.ttf", "ariblk.ttf", "arialbd.ttf", "seguibl.ttf", "DejaVuSans-Bold.ttf"]


def _font(size: int) -> ImageFont.FreeTypeFont:
    fonts_dir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for name in FONT_CANDIDATES:
        p = fonts_dir / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    try:
        return ImageFont.truetype(FONT_CANDIDATES[-1], size)
    except OSError:
        return ImageFont.load_default()


def _cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    W, H = size
    r = max(W / img.width, H / img.height)
    img = img.resize((int(img.width * r) + 1, int(img.height * r) + 1), Image.LANCZOS)
    x, y = (img.width - W) // 2, (img.height - H) // 2
    return img.crop((x, y, x + W, y + H))


def make_thumbnail(frame: Path, text: str, out: Path, size: tuple[int, int] = (1280, 720),
                   badge: str = "GTA 6") -> Path:
    W, H = size
    img = _cover(Image.open(frame).convert("RGB"), size)
    img = ImageEnhance.Contrast(img).enhance(1.25)
    img = ImageEnhance.Color(img).enhance(1.35)
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=80))

    # degradê escuro na parte de baixo para leitura do texto
    grad = Image.new("L", (1, H))
    for y in range(H):
        grad.putpixel((0, y), int(max(0, (y - H * 0.35) / (H * 0.65)) * 200))
    shade = Image.new("RGB", size, (0, 0, 0))
    img = Image.composite(shade, img, grad.resize(size))

    d = ImageDraw.Draw(img)
    landscape = W > H
    max_chars = 16 if landscape else 12
    lines = textwrap.wrap(text.upper(), width=max_chars)[:3] or [""]
    fsize = int(H * (0.15 if landscape else 0.075))
    font = _font(fsize)
    line_h = int(fsize * 1.08)
    y = H - line_h * len(lines) - int(H * 0.07)
    colors = [(255, 230, 0), (255, 255, 255), (255, 255, 255)]
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=font)
        x = int(W * 0.05) if landscape else int((W - tw) / 2)
        d.text((x, y), line, font=font, fill=colors[i % 3], stroke_width=max(4, fsize // 12), stroke_fill=(0, 0, 0))
        y += line_h

    if badge:
        bf = _font(int(H * (0.07 if landscape else 0.035)))
        pad = int(H * 0.015)
        bw = int(d.textlength(badge, font=bf)) + pad * 2
        bh = int(bf.size * 1.25) + pad
        bx, by = int(W * 0.04), int(H * 0.05)
        d.rounded_rectangle((bx, by, bx + bw, by + bh), radius=pad, fill=(225, 20, 120))
        d.text((bx + pad, by + pad // 2), badge, font=bf, fill=(255, 255, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=92)
    return out
