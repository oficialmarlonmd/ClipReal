"""Renderização FFmpeg: Shorts 9:16 (blur/crop/face/fit) e vídeo longo 16:9 (compilação)."""
from __future__ import annotations

import logging
from pathlib import Path

from . import media, reframe

log = logging.getLogger("clipsreal.render")
_SUBS_OK: bool | None = None


def subtitles_supported() -> bool:
    global _SUBS_OK
    if _SUBS_OK is None:
        _SUBS_OK = media.has_filter("subtitles") or media.has_filter("ass")
    return _SUBS_OK


def _even(x: float) -> int:
    return int(x) // 2 * 2


def build_video_filter(info: dict, rcfg: dict, mode: str, video: Path, start: float, end: float,
                       scenes: list[float], has_broll: bool = False) -> str:
    W, H = rcfg["width"], rcfg["height"]
    sw, sh = info["width"] or 1920, info["height"] or 1080
    portrait = sh >= sw
    if mode == "dual":
        h_top = _even(H * 0.375)
        h_bot = H - h_top
        cw, ch, cx, cy = reframe.detect_facecam_box(video, start, end, sw, sh,
                                                    rcfg.get("cam_position", "auto"), W / h_top)
        return (f"[0:v]split=2[cam_in][game_in];"
                f"[cam_in]crop={cw}:{ch}:{cx}:{cy},scale={W}:{h_top}:force_original_aspect_ratio=increase,"
                f"crop={W}:{h_top},setsar=1[top];"
                f"[game_in]scale={W}:{h_bot}:force_original_aspect_ratio=increase,crop={W}:{h_bot},setsar=1[bot];"
                f"[top][bot]vstack=inputs=2,setsar=1")
    if mode == "dual_dopamine":
        if has_broll:
            h_top = _even(H * 0.5)
            h_bot = H - h_top
            return (f"[0:v]scale={W}:{h_top}:force_original_aspect_ratio=increase,crop={W}:{h_top},setsar=1[top];"
                    f"[1:v]scale={W}:{h_bot}:force_original_aspect_ratio=increase,crop={W}:{h_bot},setsar=1[bot];"
                    f"[top][bot]vstack=inputs=2,setsar=1")
        h_top = _even(H * 0.395)
        h_bot = H - h_top
        cw, ch, cx, cy = reframe.detect_facecam_box(video, start, end, sw, sh,
                                                    rcfg.get("cam_position", "auto"), W / h_top)
        return (f"[0:v]split=2[cam_in][game_in];"
                f"[cam_in]crop={cw}:{ch}:{cx}:{cy},scale={W}:{h_top}:force_original_aspect_ratio=increase,"
                f"crop={W}:{h_top},setsar=1[top];"
                f"[game_in]scale={W}:{h_bot}:force_original_aspect_ratio=increase,crop={W}:{h_bot},setsar=1[bot];"
                f"[top][bot]vstack=inputs=2,drawbox=x=0:y={h_top - 3}:w={W}:h=6:color=black:t=fill,setsar=1")
    if mode == "card":
        card_w = _even(W * 0.94)
        card_h = _even(card_w * sh / max(sw, 1))
        bw, bh = W // 8, H // 8
        return (f"[0:v]split=2[bg][fg];"
                f"[bg]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},boxblur=16:2,"
                f"scale={W}:{H},eq=brightness=-0.35:saturation=0.8[bgb];"
                f"[fg]scale={card_w}:{card_h}:force_original_aspect_ratio=decrease,"
                f"pad={card_w + 8}:{card_h + 8}:4:4:#26233a[fgs];"
                f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1")
    if portrait:
        return f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
    if mode == "crop":
        return f"[0:v]scale=-2:{H},crop={W}:{H},setsar=1"
    if mode == "face":
        shots = reframe.face_track_x(video, start, end, scenes, sw, sh, H, W)
        return f"[0:v]scale=-2:{H},crop={W}:{H}:x='{reframe.crop_x_expr(shots)}':y=0,setsar=1"
    if mode == "fit":
        return f"[0:v]scale={W}:-2,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    # blur (janela inteira no formato em pé + fundo desfocado)
    zoom = float(rcfg.get("fg_zoom", 1.0))
    fgw = _even(W * zoom)
    fgh = _even(fgw * sh / sw)
    cw = min(fgw, W)
    bw, bh = W // 4, H // 4
    return (f"[0:v]split=2[bg][fg];"
            f"[bg]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},boxblur=12:2,"
            f"scale={W}:{H},eq=brightness=-0.07:saturation=1.25[bgb];"
            f"[fg]scale={fgw}:{fgh},crop={cw}:{fgh}[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1")


def render_short(video: Path, start: float, end: float, out_dir: Path, info: dict, cfg: dict,
                 scenes: list[float], ass_name: str | None = "captions.ass", out_name: str = "clip.mp4",
                 broll_video: Path | None = None) -> Path:
    rcfg = cfg["render"]
    out_dir.mkdir(parents=True, exist_ok=True)
    dur = round(end - start, 3)
    has_broll = bool(broll_video and Path(broll_video).is_file() and rcfg["mode"] == "dual_dopamine")
    vf = build_video_filter(info, rcfg, rcfg["mode"], video, start, end, scenes, has_broll=has_broll)
    if ass_name and (out_dir / ass_name).exists() and subtitles_supported():
        vf += f",subtitles={ass_name}"
    elif ass_name:
        log.warning("Filtro 'subtitles' indisponível no FFmpeg — renderizando sem legendas.")
    vf += f",fps={rcfg['fps']},format=yuv420p[v]"

    args = ["-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(video)]
    if has_broll:
        args += ["-stream_loop", "-1", "-t", f"{dur:.3f}", "-i", str(broll_video)]
    args += ["-filter_complex", vf, "-map", "[v]"]
    if info.get("has_audio"):
        args += ["-map", "0:a:0"]
        if rcfg.get("loudnorm", True):
            args += ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"]
        args += ["-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    args += ["-c:v", "libx264", "-preset", rcfg["preset"], "-crf", str(rcfg["crf"]),
             "-profile:v", "high", "-movflags", "+faststart", out_name]
    media.run(args, cwd=out_dir)
    return out_dir / out_name


def render_compilation(parts: list[dict], out_dir: Path, cfg: dict) -> tuple[Path, list[tuple[float, str]]]:
    """parts: [{video, start, end, title, has_audio}] -> long.mp4 16:9 + capítulos [(t, título)]."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rcfg = cfg["render"]
    chapters = []
    t = 0.0
    lst = []
    for i, p in enumerate(parts):
        seg = out_dir / f"part_{i:02d}.mp4"
        dur = p["end"] - p["start"]
        args = ["-ss", f"{p['start']:.3f}", "-t", f"{dur:.3f}", "-i", str(p["video"])]
        if not p.get("has_audio"):
            args += ["-f", "lavfi", "-t", f"{dur:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        args += ["-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,"
                        "setsar=1,fps=30,format=yuv420p",
                 "-map", "0:v:0", "-map", "0:a:0" if p.get("has_audio") else "1:a:0",
                 "-c:v", "libx264", "-preset", rcfg["preset"], "-crf", "20"]
        if p.get("has_audio") and rcfg.get("loudnorm", True):
            args += ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11"]
        args += ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                 "-video_track_timescale", "90000", seg.name]
        media.run(args, cwd=out_dir)
        real_dur = media.probe(out_dir / seg.name)["duration"] or dur
        default_chap = "Moment" if str(cfg.get("resolved_language") or "").startswith("en") else "Momento"
        chapters.append((t, p.get("title") or f"{default_chap} {i + 1}"))
        t += real_dur
        lst.append(f"file '{seg.name}'")
    (out_dir / "list.txt").write_text("\n".join(lst), encoding="utf-8")
    media.run(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", "long.mp4"],
              cwd=out_dir)
    for i in range(len(parts)):
        (out_dir / f"part_{i:02d}.mp4").unlink(missing_ok=True)
    return out_dir / "long.mp4", chapters
