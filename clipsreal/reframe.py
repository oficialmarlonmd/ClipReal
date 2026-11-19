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


def detect_facecam_box(video: Path, start: float, end: float, sw: int, sh: int,
                       cam_pos: str = "auto", target_aspect: float = 1.5) -> tuple[int, int, int, int]:
    """Detecta ou posiciona a janela de facecam (w, h, x, y) para layouts Dual / Dual Dopamine."""
    pos = (cam_pos or "auto").strip().lower()
    if pos in ("top-left", "top-right", "mid-left", "mid-right", "bottom-left", "bottom-right"):
        bh = int(sh * 0.34)
        bw = int(bh * target_aspect)
        if bw > sw:
            bw = sw
            bh = int(bw / target_aspect)
        mx, my = int(sw * 0.02), int(sh * 0.03)
        cx = mx if pos.endswith("left") else (sw - bw - mx)
        if pos.startswith("top"):
            cy = my
        elif pos.startswith("mid"):
            cy = (sh - bh) // 2
        else:
            cy = sh - bh - my
        return _even_box(bw, bh, cx, cy, sw, sh)

    import cv2

    detect = _get_detector()
    samples: list[tuple[float, float, float, float]] = []
    if detect is not None:
        cap = cv2.VideoCapture(str(video))
        span = max(end - start, 0.5)
        for frac in (0.12, 0.3, 0.5, 0.7, 0.88):
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
            # Prefere rostos consistentes de facecam ou o rosto dominante
            rx = frame.shape[1] / scale_w
            ry = frame.shape[0] / small_h
            for x, y, w, h in faces:
                samples.append(((x + w / 2) * rx, (y + h / 2) * ry, w * rx, h * ry))
        cap.release()

    if samples:
        fx = float(np.median([s[0] for s in samples]))
        fy = float(np.median([s[1] for s in samples]))
        fh = float(np.median([s[3] for s in samples]))
        bh = int(np.clip(fh * 2.9, sh * 0.24, sh * 0.65))
        bw = int(bh * target_aspect)
        if bw > sw:
            bw = sw
            bh = int(bw / target_aspect)
        cx = int(fx - bw / 2)
        cy = int(fy - bh * 0.42)
        return _even_box(bw, bh, cx, cy, sw, sh)

    # Sem rosto detectado: recorte superior-central limpo
    bh = int(sh * 0.58)
    bw = min(sw, int(bh * target_aspect))
    return _even_box(bw, bh, (sw - bw) // 2, int(sh * 0.05), sw, sh)
