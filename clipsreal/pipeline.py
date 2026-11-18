"""Orquestrador: fila de trabalho, pipeline completo, re-render, metadados, upload e compilação."""
from __future__ import annotations

import copy
import json
import logging
import queue
import threading
import traceback
from pathlib import Path

from . import captions, db, highlights, ingest, media, metadata, render, thumbnail, transcribe, youtube
from .config import CFG, JOBS_DIR

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
    if o.get("mode"):
        cfg["render"]["mode"] = o["mode"]
    for k in ("captions", "hook_title", "watermark"):
        if k in o:
            cfg["render"][k] = bool(o[k])
    if "use_video" in o:
        cfg["llm"]["use_video_analysis"] = bool(o["use_video"])
    return cfg


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
            signals = {"hop": 0.5, "energy": energy, "scenes": media.scene_changes(video), "duration": duration}
            sig_path.write_text(json.dumps(signals), encoding="utf-8")

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
                                 status="pending")
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


def render_clip(clip_id: int, cfg: dict | None = None, transcript=None, signals=None, info=None,
                thumb_text: str | None = None) -> None:
    clip = db.get_clip(clip_id)
    job = db.get_job(clip["job_id"])
    cfg = cfg or job_cfg(job.get("options"))
    if transcript is None or signals is None:
        transcript, signals = _load_job_assets(job)
    video = Path(job["video_path"])
    info = info or media.probe(video)
    out_dir = job_dir(job["id"]) / "clips" / f"clip_{clip['idx']:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    s, e = float(clip["start"]), float(clip["end"])
    dur = e - s
    db.update_clip(clip_id, status="rendering", error=None)

    words = transcribe.words_between(transcript, s, e)
    rc = cfg["render"]
    captions.build_ass(words, out_dir / "captions.ass", rc, dur, hook=clip.get("hook") or "",
                       watermark=cfg["channel"].get("watermark_text", ""), width=rc["width"], height=rc["height"])
    out = render.render_short(video, s, e, out_dir, info, cfg, signals.get("scenes", []))

    frame = media.extract_frame(video, s + min(3.0, dur / 2), out_dir / "frame.jpg")
    thumb = thumbnail.make_thumbnail(frame, thumb_text or clip.get("hook") or "GTA 6", out_dir / "thumb.jpg",
                                     size=(1080, 1920))
    meta = {k: clip.get(k) for k in ("title", "description", "hashtags", "tags", "score", "score_label",
                                     "breakdown", "hook", "reason", "category", "start", "end")}
    (out_dir / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata.export_txt(meta, out_dir / "metadata.txt", clip.get("score"), clip.get("breakdown"))
    db.update_clip(clip_id, file_path=str(out), thumb_path=str(thumb), status="rendered")


def regen_metadata(clip_id: int) -> dict:
    clip = db.get_clip(clip_id)
    job = db.get_job(clip["job_id"])
    cfg = job_cfg(job.get("options"))
    if clip.get("kind") == "long":
        # Reconstrói capítulos a partir das linhas com timestamp na descrição atual ou dos clipes do job
        import re
        chaps = []
        for m in re.finditer(r"^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$", clip.get("description") or "", flags=re.M):
            h = int(m[1] or 0)
            sec = h * 3600 + int(m[2]) * 60 + int(m[3])
            chaps.append((float(sec), m[4].strip()))
        meta = metadata.long_metadata(chaps or [(0.0, "Melhores Momentos GTA 6")], cfg)
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
    cfg = job_cfg(job.get("options"))
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
        db.update_clip(clip_id, status="error", publish_at=None, error=f"Upload: {e}"[-1500:])
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
        clips.sort(key=lambda c: c.get("score") or 0)       # crescente: melhor momento no final (retenção)
        if len(clips) >= 3:
            clips = [clips[-1]] + clips[:-1]                # ...mas abre com o melhor gancho
        parts = []
        for c in clips:
            src = db.get_job(c["job_id"])
            if not src or not src.get("video_path"):
                continue
            info = media.probe(src["video_path"])
            parts.append({"video": src["video_path"], "start": c["start"], "end": c["end"],
                          "title": (c.get("hook") or c.get("title") or "")[:60], "has_audio": info["has_audio"]})
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
        cid = db.create_clip(job_id, kind="long", idx=1, start=0, end=total,
                             score=round(sum(c["score"] or 0 for c in clips) / max(len(clips), 1), 1),
                             score_label="Compilação", breakdown={}, hook=meta["thumb_text"],
                             title=meta["title"], description=meta["description"], hashtags=meta["hashtags"],
                             tags=meta["tags"], file_path=str(out), thumb_path=str(thumb), status="rendered")
        metadata.export_txt(meta, work / "metadata.txt")
        (work / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        db.update_job(job_id, status="done", stage="Concluído", progress=1.0, title=meta["title"],
                      message=f"Vídeo longo com {len(clips)} capítulos (clip #{cid})")
    except Exception as e:  # noqa: BLE001
        log.error("Compilação %s falhou: %s", job_id, traceback.format_exc())
        db.update_job(job_id, status="error", message=str(e)[-1500:])
