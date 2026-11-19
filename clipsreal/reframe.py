"""Reframe 16:9 -> 9:16: rastreamento de rosto (OpenCV YuNet / Haar) por plano de cena."""
from __future__ import annotations

import logging
import urllib.request
from pathlib import Path

import numpy as np

log = logging.getLogger("clipsreal.reframe")
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"


_yunet_tried = False


def _get_detector():
    global _yunet_tried
    import cv2
    from .config import ROOT

    yunet = ROOT / "models" / "face_detection_yunet_2023mar.onnx"
    if not yunet.exists() and not _yunet_tried and hasattr(cv2, "FaceDetectorYN"):
        _yunet_tried = True
        try:
            yunet.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(YUNET_URL, timeout=10) as resp:
                yunet.write_bytes(resp.read())
        except Exception as e:  # noqa: BLE001
            log.warning("Download YuNet falhou: %s", e)
    if yunet.exists() and hasattr(cv2, "FaceDetectorYN"):
        det = cv2.FaceDetectorYN.create(str(yunet), "", (320, 320), score_threshold=0.7)

        def detect(bgr):
            h, w = bgr.shape[:2]
            det.setInputSize((w, h))
            _, faces = det.detect(bgr)
            if faces is None or not len(faces):
                return []
            return [(float(f[0]), float(f[1]), float(f[2]), float(f[3])) for f in faces]

        return detect

    if hasattr(cv2, "CascadeClassifier"):
        xml = Path(getattr(cv2.data, "haarcascades", "")) / "haarcascade_frontalface_default.xml"
        if xml.is_file():
            cascade = cv2.CascadeClassifier(str(xml))

            def detect_haar(bgr):
                gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=6, minSize=(40, 40))
                return [(float(x), float(y), float(w), float(h)) for (x, y, w, h) in faces]

            return detect_haar
    return None


def face_track_x(video: Path, start: float, end: float, scenes: list[float], src_w: int, src_h: int,
                 out_h: int = 1920, out_w: int = 1080, sample_fps: float = 2.0) -> list[tuple[float, float, int]]:
    """Retorna [(t0_rel, t1_rel, x_crop_px)] em coordenadas do vídeo escalado para altura out_h."""
    import cv2

    scale = out_h / max(src_h, 1)
    scaled_w = int(src_w * scale)
    max_x = max(scaled_w - out_w, 0)
    center_x = max_x // 2

    detect = _get_detector()
    if detect is None:
        return [(0, round(end - start, 2), center_x)]

    cap = cv2.VideoCapture(str(video))
    bounds = [start] + [t for t in scenes if start < t < end] + [end]
    shots = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        xs = []
        for t in np.arange(a + 0.1, b, 1.0 / sample_fps):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            small = cv2.resize(frame, (640, int(640 * frame.shape[0] / frame.shape[1])))
            faces = detect(small)
            if faces:
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                cx = (x + w / 2) / small.shape[1] * scaled_w
                xs.append(cx)
        if xs:
            x = int(np.clip(np.median(xs) - out_w / 2, 0, max_x))
        else:
            x = shots[-1][2] if shots else center_x
        shots.append((round(a - start, 2), round(b - start, 2), x))
    cap.release()
    # funde planos vizinhos com posição parecida
    merged: list[tuple[float, float, int]] = []
    for s in shots:
        if merged and abs(merged[-1][2] - s[2]) < 60:
            merged[-1] = (merged[-1][0], s[1], merged[-1][2])
        else:
            merged.append(s)
    return merged[:40] or [(0, end - start, center_x)]


def crop_x_expr(shots: list[tuple[float, float, int]]) -> str:
    if len(shots) == 1:
        return str(shots[0][2])
    expr = str(shots[-1][2])
    for t0, t1, x in reversed(shots[:-1]):
        expr = f"if(lt(t\\,{t1})\\,{x}\\,{expr})"
    return expr


def _even_box(cw: int, ch: int, cx: int, cy: int, sw: int, sh: int) -> tuple[int, int, int, int]:
    cw = max(64, min(sw, cw) // 2 * 2)
    ch = max(64, min(sh, ch) // 2 * 2)
    cx = max(0, min(sw - cw, cx)) // 2 * 2
    cy = max(0, min(sh - ch, cy)) // 2 * 2
    return cw, ch, cx, cy


_CAM_CACHE: dict[tuple[str, str], tuple[int, int, int, int, float, float] | None] = {}


def _detect_global_cam_rect(video: Path, sw: int, sh: int,
                            cam_pos: str = "auto") -> tuple[int, int, int, int, float, float] | None:
    """Encontra o retangulo fixo da webcam do streamer no video todo usando cluster de rostos + bordas temporais."""
    import cv2

    cache_key = (str(video), cam_pos)
    if cache_key in _CAM_CACHE:
        return _CAM_CACHE[cache_key]

    detect = _get_detector()
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    nframes = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    dur = (nframes / fps) if nframes > 0 else 0.0
    if dur <= 0:
        cap.release()
        _CAM_CACHE[cache_key] = None
        return None

    scale_w = 640
    scale_h = max(1, int(scale_w * sh / max(sw, 1)))
    rx, ry = sw / scale_w, sh / scale_h
    frames: list = []
    dets: list[tuple[float, float, float, float]] = []

    for frac in np.linspace(0.06, 0.94, 12):
        cap.set(cv2.CAP_PROP_POS_MSEC, float(dur * frac) * 1000)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        small = cv2.resize(frame, (scale_w, scale_h))
        frames.append(small)
        if detect is None:
            continue
        for x, y, w, h in detect(small):
            fx, fy, fw, fh = (x + w / 2) * rx, (y + h / 2) * ry, w * rx, h * ry
            # Se o usuario escolheu um quadrante manual, filtra rostos dentro dele
            if cam_pos != "auto":
                in_left = fx < sw * 0.5
                in_top = fy < sh * 0.45
                in_bot = fy > sh * 0.55
                if cam_pos.endswith("left") and not in_left:
                    continue
                if cam_pos.endswith("right") and in_left:
                    continue
                if cam_pos.startswith("top") and not in_top:
                    continue
                if cam_pos.startswith("bottom") and not in_bot:
                    continue
            dets.append((fx, fy, fw, fh))
    cap.release()

    # Agrupa deteccoes estaticas de webcam (overlay <= 24% da largura)
    clusters: list[list[tuple[float, float, float, float]]] = []
    tol_x, tol_y = sw * 0.06, sh * 0.08
    for d in dets:
        fx, fy, fw, fh = d
        if fw > sw * 0.24:
            continue
        for cl in clusters:
            mx = float(np.median([c[0] for c in cl]))
            my = float(np.median([c[1] for c in cl]))
            if abs(fx - mx) <= tol_x and abs(fy - my) <= tol_y:
                cl.append(d)
                break
        else:
            clusters.append([d])

    min_hits = max(3, len(frames) // 4)
    clusters = [cl for cl in clusters if len(cl) >= min_hits]
    if not clusters:
        _CAM_CACHE[cache_key] = None
        return None

    best = max(clusters, key=lambda cl: len(cl) + (2.0 if np.median([c[2] for c in cl]) < sw * 0.16 else 0.0))
    fx = float(np.median([c[0] for c in best]))
    fy = float(np.median([c[1] for c in best]))
    fw = float(np.median([c[2] for c in best]))
    fh = float(np.median([c[3] for c in best]))

    if len(frames) < 4:
        _CAM_CACHE[cache_key] = None
        return None

    # Snap nas bordas estaticas da webcam usando media temporal dos gradientes
    gx_acc = np.zeros((scale_h, scale_w), dtype=np.float32)
    gy_acc = np.zeros((scale_h, scale_w), dtype=np.float32)
    for sm in frames:
        gray = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gx_acc += np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
        gy_acc += np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    gx_mean = gx_acc / len(frames)
    gy_mean = gy_acc / len(frames)

    sfx, sfy, sfw, sfh = fx / rx, fy / ry, fw / rx, fh / ry
    yb0 = max(0, int(sfy - 1.2 * sfh))
    yb1 = min(scale_h, int(sfy + 1.4 * sfh))
    col_prof = gx_mean[yb0:yb1, :].mean(axis=0) if yb1 > yb0 else gx_mean.mean(axis=0)

    if sfx - 2.6 * sfw <= 8:
        x1_s = 0
    else:
        xl_min = max(0, int(sfx - 3.8 * sfw))
        xl_max = max(xl_min + 1, int(sfx - 0.55 * sfw))
        seg_l = col_prof[xl_min:xl_max]
        x1_s = xl_min + int(np.argmax(seg_l)) if seg_l.size and seg_l.max() > 18 else max(0, int(sfx - 2.0 * sfw))

    if scale_w - (sfx + 2.6 * sfw) <= 8:
        x2_s = scale_w
    else:
        xr_min = min(scale_w - 2, int(sfx + 0.55 * sfw))
        xr_max = min(scale_w, int(sfx + 4.0 * sfw))
        seg_r = col_prof[xr_min:xr_max]
        x2_s = xr_min + int(np.argmax(seg_r)) if seg_r.size and seg_r.max() > 18 else min(scale_w, int(sfx + 2.0 * sfw))

    xb0 = min(scale_w - 1, x1_s + 4)
    xb1 = max(xb0 + 1, x2_s - 4)
    row_prof = gy_mean[:, xb0:xb1].mean(axis=1)

    if sfy - 2.0 * sfh <= 6:
        y1_s = 0
    else:
        yt_min = max(0, int(sfy - 2.5 * sfh))
        yt_max = max(yt_min + 1, int(sfy - 0.55 * sfh))
        seg_t = row_prof[yt_min:yt_max]
        y1_s = yt_min + int(np.argmax(seg_t)) if seg_t.size and seg_t.max() > 18 else max(0, int(sfy - 1.3 * sfh))

    if scale_h - (sfy + 2.0 * sfh) <= 6:
        y2_s = scale_h
    else:
        yb_min = min(scale_h - 2, int(sfy + 0.6 * sfh))
        yb_max = min(scale_h, int(sfy + 2.6 * sfh))
        seg_b = row_prof[yb_min:yb_max]
        y2_s = yb_min + int(np.argmax(seg_b)) if seg_b.size and seg_b.max() > 18 else min(scale_h, int(sfy + 1.45 * sfh))

    pad = 4
    x1 = max(0, int(x1_s * rx) + (pad if x1_s > 0 else 0))
    x2 = min(sw, int(x2_s * rx) - (pad if x2_s < scale_w else 0))
    y1 = max(0, int(y1_s * ry) + (pad if y1_s > 0 else 0))
    y2 = min(sh, int(y2_s * ry) - (pad if y2_s < scale_h else 0))
    if x2 - x1 < 80 or y2 - y1 < 60:
        _CAM_CACHE[cache_key] = None
        return None
    res = (x1, y1, x2, y2, fx, fy)
    _CAM_CACHE[cache_key] = res
    return res


def _fit_aspect_inside_rect(x1: int, y1: int, x2: int, y2: int, fx: float, fy: float,
                            sw: int, sh: int, target_aspect: float) -> tuple[int, int, int, int]:
    rw, rh = max(1, x2 - x1), max(1, y2 - y1)
    if rw / rh >= target_aspect:
        ch = rh
        cw = int(ch * target_aspect)
        cx = int(np.clip(fx - cw / 2, x1, max(x1, x2 - cw)))
        cy = y1
    else:
        cw = rw
        ch = int(cw / target_aspect)
        cx = x1
        cy = int(np.clip(fy - ch * 0.42, y1, max(y1, y2 - ch)))
    return _even_box(cw, ch, cx, cy, sw, sh)


def detect_facecam_box(video: Path, start: float, end: float, sw: int, sh: int,
                       cam_pos: str = "auto", target_aspect: float = 1.5) -> tuple[int, int, int, int]:
    """Detecta ou posiciona a janela de facecam (w, h, x, y) para layouts Dual / Dual Dopamine."""
    pos = (cam_pos or "auto").strip().lower()

    # 1. Tenta detectar a webcam fixa do streamer no video todo (funciona em auto e tambem refina posicoes manuais)
    global_cam = _detect_global_cam_rect(video, sw, sh, cam_pos=pos)
    if global_cam is not None:
        return _fit_aspect_inside_rect(*global_cam, sw, sh, target_aspect)

    # 2. Fallback para posicao manual escolhida pelo usuario
    if pos in ("top-left", "top-right", "mid-left", "mid-right", "bottom-left", "bottom-right"):
        bh = int(sh * 0.30)
        bw = int(bh * target_aspect)
        if bw > sw:
            bw = sw
            bh = int(bw / target_aspect)
        mx, my = int(sw * 0.015), int(sh * 0.03)
        cx = mx if pos.endswith("left") else (sw - bw - mx)
        if pos.startswith("top"):
            cy = my
        elif pos.startswith("mid"):
            cy = (sh - bh) // 2
        else:
            cy = sh - bh - my
        return _even_box(bw, bh, cx, cy, sw, sh)

    # 3. Video sem webcam overlay (ex.: podcast tela cheia ou trailer): usa rosto no trecho
    import cv2

    detect = _get_detector()
    samples: list[tuple[float, float, float, float]] = []
    if detect is not None:
        cap = cv2.VideoCapture(str(video))
        span = max(end - start, 0.5)
        for frac in (0.15, 0.4, 0.65, 0.85):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(start + span * frac) * 1000)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            scale_w = 640
            small_h = max(1, int(scale_w * frame.shape[0] / max(frame.shape[1], 1)))
            small = cv2.resize(frame, (scale_w, small_h))
            faces = detect(small)
            if not faces:
                continue
            rx = frame.shape[1] / scale_w
            ry = frame.shape[0] / small_h
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            samples.append(((x + w / 2) * rx, (y + h / 2) * ry, w * rx, h * ry))
        cap.release()

    if samples:
        fx = float(np.median([s[0] for s in samples]))
        fy = float(np.median([s[1] for s in samples]))
        fh = float(np.median([s[3] for s in samples]))
        bh = int(np.clip(fh * 2.6, sh * 0.24, sh * 0.65))
        bw = int(bh * target_aspect)
        if bw > sw:
            bw = sw
            bh = int(bw / target_aspect)
        cx = int(fx - bw / 2)
        cy = int(fy - bh * 0.42)
        return _even_box(bw, bh, cx, cy, sw, sh)

    bh = int(sh * 0.58)
    bw = min(sw, int(bh * target_aspect))
    return _even_box(bw, bh, (sw - bw) // 2, int(sh * 0.05), sw, sh)
