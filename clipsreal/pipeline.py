"""Orquestrador: fila de trabalho, pipeline completo, re-render, metadados, upload e compilação."""
from __future__ import annotations

import copy
import json
import logging
import queue
import threading
import traceback
from pathlib import Path

from . import captions, censor, db, highlights, ingest, lang as lang_utils, media, metadata, render, thumbnail, transcribe, youtube
from .config import BROLL_DIR, CFG, JOBS_DIR

log = logging.getLogger("clipsreal.pipeline")

_q: "queue.Queue[tuple]" = queue.Queue()
_worker: threading.Thread | None = None
_upload_q: "queue.Queue[tuple]" = queue.Queue()
_upload_worker: threading.Thread | None = None


# ----------------------------------------------------------------- filas
def _loop(q):
    while True:
        fn, args = q.get()
        try:
            fn(*args)
        except Exception:  # noqa: BLE001
            log.error("Tarefa falhou: %s", traceback.format_exc())
        finally:
            q.task_done()


def submit(fn, *args, uploads: bool = False) -> None:
    global _worker, _upload_worker
    if uploads:
        if _upload_worker is None or not _upload_worker.is_alive():
            _upload_worker = threading.Thread(target=_loop, args=(_upload_q,), daemon=True, name="uploads")
            _upload_worker.start()
        _upload_q.put((fn, args))
    else:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, args=(_q,), daemon=True, name="pipeline")
            _worker.start()
        _q.put((fn, args))


def queue_sizes() -> dict:
    return {"pipeline": _q.qsize(), "uploads": _upload_q.qsize()}


def job_cfg(options: dict | None) -> dict:
    cfg = copy.deepcopy(CFG)
    o = options or {}
    if o.get("count"):
        cfg["clips"]["target_count"] = int(o["count"])
    if o.get("min_score") is not None:
        cfg["clips"]["min_score"] = float(o["min_score"])
    for k in ("mode", "hook_style", "hook_position", "cam_position", "dopamine_video",
              "watermark_position"):
        if o.get(k):
            cfg["render"][k] = str(o[k]).strip()
    for k in ("captions", "hook_title", "watermark", "censor_18plus"):
        if k in o:
            cfg["render"][k] = bool(o[k])
    if "watermark_text" in o and o["watermark_text"] is not None:
        cfg["channel"]["watermark_text"] = str(o["watermark_text"]).strip()
    if o.get("watermark_opacity") is not None:
        cfg["render"]["watermark_opacity"] = int(o["watermark_opacity"])
    if o.get("watermark_size") is not None:
        cfg["render"]["watermark_size"] = int(o["watermark_size"])
    if "use_video" in o:
        cfg["llm"]["use_video_analysis"] = bool(o["use_video"])
    if "language" in o:
        norm = lang_utils.normalize_lang(o["language"])
        cfg["transcription"]["language"] = norm
        if norm:
            cfg = lang_utils.apply_language_cfg(cfg, norm)
    elif cfg["transcription"].get("language"):
        norm = lang_utils.normalize_lang(cfg["transcription"].get("language"))
        if norm:
            cfg = lang_utils.apply_language_cfg(cfg, norm)
    return cfg


def _resolve_job_cfg(cfg: dict, work: Path, transcript: list[dict] | None = None,
                     title: str = "", clip_text: str = "") -> dict:
    det = transcribe.detected_language(work / "transcript.json")
    sample = clip_text or " ".join(s["text"] for s in (transcript or [])[:40])
    resolved = lang_utils.effective_language(cfg, transcript_text=sample, title=title, detected=det)
    return lang_utils.apply_language_cfg(cfg, resolved)


def job_dir(job_id: int) -> Path:
    d = JOBS_DIR / f"{job_id:05d}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def enqueue_job(source: str, options: dict | None = None) -> int:
    jid = db.create_job(source, options=options or {})
    submit(process_job, jid)
    return jid


# ----------------------------------------------------------------- pipeline principal
def process_job(job_id: int) -> None:
    job = db.get_job(job_id)
    opts = job.get("options") or {}
    cfg = job_cfg(opts)
    work = job_dir(job_id)

    def stage(base: float, span: float):
        def f(p: float, msg: str):
            db.update_job(job_id, stage=msg, progress=round(base + span * min(max(p, 0), 1), 3))
        return f

    try:
        db.update_job(job_id, status="running", stage="Iniciando", progress=0, message="")
        ing = ingest.ingest(job["source"], work, stage(0, 0.12))
        video = Path(ing["path"])
        info = media.probe(video)
        duration = info["duration"] or ing["duration"]
        db.update_job(job_id, title=ing["title"], video_path=str(video), duration=duration)

        # --- sinais de áudio + transcrição
        transcript: list[dict] = []
        energy: list[float] = []
        if info["has_audio"]:
            stage(0.12, 0.03)(0, "Extraindo áudio")
            wav = work / "audio.wav"
            if not wav.exists():
                media.extract_audio(video, wav)
            energy = media.audio_energy(wav)
            transcript = transcribe.transcribe(wav, cfg["transcription"], work / "transcript.json", duration,
                                               stage(0.15, 0.35))
        stage(0.50, 0.05)(0, "Detectando cortes de cena")
        sig_path = work / "signals.json"
        if sig_path.exists():
            signals = json.loads(sig_path.read_text(encoding="utf-8"))
        else:
            signals = {"hop": 0.5, "energy": energy, "scenes": media.scene_changes(video, duration=duration),
                       "duration": duration}
            sig_path.write_text(json.dumps(signals), encoding="utf-8")

        # --- resolve idioma do trabalho antes dos prompts e SEO
        cfg = _resolve_job_cfg(cfg, work, transcript=transcript, title=ing["title"])

        # --- melhores momentos + score viral
        found, method = highlights.find_highlights(video, work, transcript, signals, cfg, duration, ing["title"],
                                                   stage(0.55, 0.15))
        if not found:
            raise RuntimeError("Nenhum momento encontrado")
        db.update_job(job_id, message=f"{len(found)} cortes via {method}")

        # --- metadados SEO
        stage(0.70, 0.05)(0, "Gerando títulos, descrições, hashtags e tags")
        metas = metadata.shorts_metadata(found, cfg, ing["title"])

        # --- render
        clip_ids = []
        for i, (c, meta) in enumerate(zip(found, metas)):
            stage(0.75, 0.25)(i / len(found), f"Renderizando corte {i + 1}/{len(found)}")
            cid = db.create_clip(job_id, kind="short", idx=i + 1, start=c["start"], end=c["end"], score=c["score"],
                                 score_label=c["score_label"], breakdown=c["breakdown"], hook=c.get("hook", ""),
                                 reason=c.get("reason", ""), category=c.get("category", ""),
                                 transcript=c.get("transcript", ""), title=meta["title"],
                                 description=meta["description"], hashtags=meta["hashtags"], tags=meta["tags"],
                                 render_mode=cfg["render"]["mode"], status="pending")
            clip_ids.append(cid)
            try:
                render_clip(cid, cfg=cfg, transcript=transcript, signals=signals, info=info,
                            thumb_text=meta.get("thumb_text"))
            except Exception as e:  # noqa: BLE001
                log.error("Render do corte %s falhou: %s", cid, e)
                db.update_clip(cid, status="error", error=str(e)[-1500:])

        db.update_job(job_id, status="done", stage="Concluído", progress=1.0)
        if opts.get("auto_upload"):
            for cid in clip_ids:
                if db.get_clip(cid)["status"] == "rendered":
                    submit(upload_clip, cid, "auto", uploads=True)
    except Exception as e:  # noqa: BLE001
        log.error("Job %s falhou: %s", job_id, traceback.format_exc())
        db.update_job(job_id, status="error", message=str(e)[-1500:])


def _load_job_assets(job: dict):
    work = job_dir(job["id"])
    tp, sp = work / "transcript.json", work / "signals.json"
    transcript = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else []
    signals = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {"energy": [], "scenes": [], "hop": 0.5}
    return transcript, signals


def _resolve_broll(name: str | None) -> Path | None:
    if not name:
        return None
    p = (BROLL_DIR / Path(str(name)).name).resolve()
    if str(p).startswith(str(BROLL_DIR.resolve())) and p.is_file():
        return p
    # Caso não seja especificado, usa o primeiro b-roll cadastrado apenas se explicitamente escolhido
    return None


def render_clip(clip_id: int, cfg: dict | None = None, transcript=None, signals=None, info=None,
                thumb_text: str | None = None, use_saved_style: bool = False,
                render_overrides: dict | None = None) -> None:
    clip = db.get_clip(clip_id)
    job = db.get_job(clip["job_id"])
    work = job_dir(job["id"])
    if transcript is None or signals is None:
        transcript, signals = _load_job_assets(job)
    if cfg is None:
        opts = dict(job.get("options") or {})
        if use_saved_style:
            for k in ("watermark", "watermark_text", "watermark_position", "watermark_opacity",
                      "watermark_size", "hook_title", "hook_style", "hook_position", "cam_position",
                      "dopamine_video", "captions"):
                opts.pop(k, None)
        if clip.get("render_mode"):
            opts["mode"] = clip["render_mode"]
        if render_overrides:
            for k, v in render_overrides.items():
                if v is not None:
                    opts[k] = v
        cfg = _resolve_job_cfg(job_cfg(opts), work, transcript=transcript,
                               title=job.get("title") or "", clip_text=clip.get("transcript") or "")
    video = Path(job["video_path"])
    info = info or media.probe(video)
    out_dir = work / "clips" / f"clip_{clip['idx']:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    s, e = float(clip["start"]), float(clip["end"])
    dur = e - s
    db.update_clip(clip_id, status="rendering", error=None, render_mode=cfg["render"]["mode"])

    words = transcribe.words_between(transcript, s, e)
    rc = cfg["render"]
    broll = _resolve_broll(rc.get("dopamine_video"))
    has_broll = bool(broll and rc.get("mode") == "dual_dopamine")
    censor_boxes: list[dict] = []
    if rc.get("censor_18plus", True):
        cpath = out_dir / "censor.json"
        if cpath.exists():
            try:
                censor_boxes = json.loads(cpath.read_text(encoding="utf-8"))
            except Exception:
                censor_boxes = []
        else:
            censor_boxes = censor.detect_sensitive_regions(video, s, e, info.get("width") or 1920,
                                                           info.get("height") or 1080)
            cpath.write_text(json.dumps(censor_boxes, ensure_ascii=False), encoding="utf-8")
    captions.build_ass(words, out_dir / "captions.ass", rc, dur, hook=clip.get("hook") or "",
                       watermark=cfg["channel"].get("watermark_text", ""), width=rc["width"], height=rc["height"],
                       has_broll=has_broll)
    out = render.render_short(video, s, e, out_dir, info, cfg, signals.get("scenes", []), broll_video=broll,
                              censor_boxes=censor_boxes)

    frame = media.extract_frame(video, s + min(3.0, dur / 2), out_dir / "frame.jpg")
    thumb = thumbnail.make_thumbnail(frame, thumb_text or clip.get("hook") or "GTA 6", out_dir / "thumb.jpg",
                                     size=(1080, 1920))
    meta = {k: clip.get(k) for k in ("title", "description", "hashtags", "tags", "score", "score_label",
                                     "breakdown", "hook", "reason", "category", "start", "end")}
    meta["render_mode"] = rc["mode"]
    (out_dir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata.export_txt(meta, out_dir / "metadata.txt", clip.get("score"), clip.get("breakdown"))
    db.update_clip(clip_id, file_path=str(out), thumb_path=str(thumb), status="rendered", render_mode=rc["mode"])


def regen_metadata(clip_id: int) -> dict:
    clip = db.get_clip(clip_id)
    job = db.get_job(clip["job_id"])
    cfg = _resolve_job_cfg(job_cfg(job.get("options")), job_dir(job["id"]),
                           title=job.get("title") or "", clip_text=clip.get("transcript") or clip.get("description") or "")
    if clip.get("kind") == "long":
        # Reconstrói capítulos a partir das linhas com timestamp na descrição atual ou dos clipes do job
        import re
        chaps = []
        for m in re.finditer(r"^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$", clip.get("description") or "", flags=re.M):
            h = int(m[1] or 0)
            sec = h * 3600 + int(m[2]) * 60 + int(m[3])
            chaps.append((float(sec), m[4].strip()))
        default_chap = "Best GTA 6 Moments" if lang_utils.is_english(cfg.get("resolved_language")) else "Melhores Momentos GTA 6"
        meta = metadata.long_metadata(chaps or [(0.0, default_chap)], cfg)
    else:
        meta = metadata.shorts_metadata([clip], cfg, job.get("title") or "")[0]
    db.update_clip(clip_id, title=meta["title"], description=meta["description"], hashtags=meta["hashtags"],
                   tags=meta["tags"])
    metadata.sync_clip_files(db.get_clip(clip_id))
    return meta


# ----------------------------------------------------------------- upload
def upload_clip(clip_id: int, schedule: str | None = "auto") -> None:
    clip = db.get_clip(clip_id)
    job = db.get_job(clip["job_id"])
    cfg = _resolve_job_cfg(job_cfg(job.get("options")), job_dir(job["id"]),
                           title=job.get("title") or "", clip_text=clip.get("transcript") or clip.get("description") or "")
    if clip.get("youtube_id"):
        return
    try:
        publish_at = None
        if schedule == "auto":
            publish_at = youtube.next_slot(db.scheduled_publish_times(), cfg)
        elif schedule and schedule != "now":
            publish_at = schedule
        db.update_clip(clip_id, status="uploading", publish_at=publish_at, error=None)
        desc = clip["description"] or ""
        tags = clip.get("tags") or []
        vid = youtube.upload(Path(clip["file_path"]), clip["title"], desc, tags, cfg, publish_at=publish_at,
                             thumbnail=Path(clip["thumb_path"]) if clip["kind"] == "long" and clip.get("thumb_path")
                             else None)
        db.update_clip(clip_id, youtube_id=vid, status="scheduled" if publish_at else "uploaded")
    except Exception as e:  # noqa: BLE001
        db.update_clip(clip_id, status="error", publish_at=None, error=youtube.friendly_upload_error(e)[-1500:])
        raise


# ----------------------------------------------------------------- vídeo longo
def enqueue_compilation(clip_ids: list[int], title: str = "") -> int:
    jid = db.create_job(",".join(map(str, clip_ids)), kind="compilation", title=title or "Compilação GTA 6",
                        options={"clip_ids": clip_ids})
    submit(process_compilation, jid)
    return jid


def process_compilation(job_id: int) -> None:
    job = db.get_job(job_id)
    cfg = job_cfg({})
    ids = job["options"]["clip_ids"]
    work = job_dir(job_id)
    try:
        db.update_job(job_id, status="running", stage="Montando compilação 16:9", progress=0.05)
        clips = [c for c in (db.get_clip(i) for i in ids) if c and c.get("kind") != "long"]
        if not clips:
            raise RuntimeError("Nenhum corte curto válido selecionado para compilação")
        sample_txt = " ".join(c.get("transcript") or "" for c in clips[:3])
        sample_title = " ".join(c.get("title") or "" for c in clips[:3])
        cfg = lang_utils.apply_language_cfg(
            cfg, lang_utils.effective_language(cfg, transcript_text=sample_txt, title=sample_title)
        )
        clips.sort(key=lambda c: c.get("score") or 0)       # crescente: melhor momento no final (retenção)
        if len(clips) >= 3:
            clips = [clips[-1]] + clips[:-1]                # ...mas abre com o melhor gancho
        parts = []
        for c in clips:
            src = db.get_job(c["job_id"])
            if not src or not src.get("video_path"):
                continue
            info = media.probe(src["video_path"])
            cboxes = []
            cfile = Path(c["file_path"]).parent / "censor.json" if c.get("file_path") else None
            if cfg["render"].get("censor_18plus", True) and cfile and cfile.is_file():
                try:
                    cboxes = json.loads(cfile.read_text(encoding="utf-8"))
                except Exception:
                    cboxes = []
            parts.append({"video": src["video_path"], "start": c["start"], "end": c["end"],
                          "title": (c.get("hook") or c.get("title") or "")[:60], "has_audio": info["has_audio"],
                          "width": info.get("width") or 1920, "height": info.get("height") or 1080,
                          "censor_boxes": cboxes})
        if not parts:
            raise RuntimeError("Vídeos de origem dos cortes não encontrados")
        out, chapters = render.render_compilation(parts, work, cfg)
        total = media.probe(out)["duration"]
        db.update_job(job_id, stage="SEO do vídeo longo", progress=0.8, video_path=str(out), duration=total)
        meta = metadata.long_metadata(chapters, cfg)
        best = clips[0]
        src = db.get_job(best["job_id"])
        frame = media.extract_frame(src["video_path"], best["start"] + 2, work / "frame.jpg")
        thumb = thumbnail.make_thumbnail(frame, meta["thumb_text"], work / "thumb.jpg", size=(1280, 720))
        comp_label = "Compilation" if lang_utils.is_english(cfg.get("resolved_language")) else "Compilação"
        cid = db.create_clip(job_id, kind="long", idx=1, start=0, end=total,
                             score=round(sum(c["score"] or 0 for c in clips) / max(len(clips), 1), 1),
                             score_label=comp_label, breakdown={}, hook=meta["thumb_text"],
                             title=meta["title"], description=meta["description"], hashtags=meta["hashtags"],
                             tags=meta["tags"], file_path=str(out), thumb_path=str(thumb), status="rendered")
        metadata.export_txt(meta, work / "metadata.txt")
        (work / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        db.update_job(job_id, status="done", stage="Concluído", progress=1.0, title=meta["title"],
                      message=f"Vídeo longo com {len(clips)} capítulos (clip #{cid})")
    except Exception as e:  # noqa: BLE001
        log.error("Compilação %s falhou: %s", job_id, traceback.format_exc())
        db.update_job(job_id, status="error", message=str(e)[-1500:])
