"""Painel web local (FastAPI) — http://localhost:8000"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, media, metadata, monitor, pipeline, render, youtube
from .config import BROLL_DIR, CFG, DATA, UPLOADS_DIR, gemini_key, reload, save_config, set_env_var, youtube_client_secret
from .llm import get_llm

log = logging.getLogger("clipsreal.web")
STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # retoma jobs que ficaram pendentes
    for j in db.query("SELECT id, kind FROM jobs WHERE status IN ('queued','running')"):
        db.execute("DELETE FROM clips WHERE job_id=?", (j["id"],))
        pipeline.submit(pipeline.process_compilation if j["kind"] == "compilation" else pipeline.process_job, j["id"])
    db.execute("UPDATE clips SET status='rendered' WHERE status='uploading' AND (youtube_id IS NULL OR youtube_id='')")
    monitor.start()
    yield


app = FastAPI(title="ClipsReal", lifespan=_lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _media_url(p: str | None) -> str | None:
    if not p:
        return None
    try:
        path = Path(p).resolve()
        rel = path.relative_to(DATA.resolve())
        ver = f"?v={path.stat().st_mtime_ns // 1_000_000}" if path.exists() else ""
        return "/data/" + rel.as_posix() + ver
    except ValueError:
        return None


def _clip_out(c: dict) -> dict:
    c = dict(c)
    c["video_url"] = _media_url(c.get("file_path"))
    c["thumb_url"] = _media_url(c.get("thumb_path"))
    if c.get("youtube_id"):
        c["youtube_url"] = (f"https://youtube.com/shorts/{c['youtube_id']}" if c.get("kind") == "short"
                            else f"https://youtu.be/{c['youtube_id']}")
    return c


@app.get("/data/{path:path}")
def data_file(path: str):
    p = (DATA / path).resolve()
    if not str(p).startswith(str(DATA.resolve())) or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


# ----------------------------------------------------------------- status
def _broll_list() -> list[dict]:
    if not BROLL_DIR.is_dir():
        return []
    out = []
    for p in sorted(BROLL_DIR.iterdir()):
        if p.is_file() and p.suffix.lower() in (".mp4", ".mov", ".mkv", ".webm"):
            out.append({
                "name": p.name,
                "size_mb": round(p.stat().st_size / (1024 * 1024), 1),
                "url": f"/broll/{p.name}?v={p.stat().st_mtime_ns // 1_000_000}",
            })
    return out


@app.get("/api/status")
def status():
    try:
        ff = media.ffmpeg_bin()
    except Exception:  # noqa: BLE001
        ff = None
    return {
        "ffmpeg": ff, "subtitles": render.subtitles_supported() if ff else False,
        "gemini": bool(gemini_key()), "gemini_model": (get_llm().model if gemini_key() else None),
        "youtube_auth": youtube.is_authenticated(), "client_secret": youtube_client_secret().exists(),
        "monitor": monitor.running(), "queues": pipeline.queue_sizes(),
        "workspace": CFG["workspace"], "channel": CFG["channel"], "render": CFG["render"], "clips": CFG["clips"],
        "render_mode": CFG["render"]["mode"], "target_count": CFG["clips"]["target_count"],
        "transcription_language": CFG["transcription"].get("language") or "auto",
        "broll_count": len(_broll_list()),
    }


# ----------------------------------------------------------------- jobs
class JobIn(BaseModel):
    source: str
    count: int | None = None
    mode: str | None = None
    min_score: float | None = None
    language: str | None = None
    auto_upload: bool = False
    use_video: bool | None = None
    watermark: bool | None = None
    watermark_text: str | None = None
    hook_title: bool | None = None
    hook_style: str | None = None
    hook_position: str | None = None
    cam_position: str | None = None
    dopamine_video: str | None = None
    captions: bool | None = None


@app.post("/api/jobs")
def create_job(j: JobIn):
    opts = {k: v for k, v in j.model_dump().items() if k != "source" and v is not None}
    return {"id": pipeline.enqueue_job(j.source.strip(), opts)}


@app.post("/api/jobs/upload")
async def upload_file(file: UploadFile = File(...), count: int | None = None, mode: str | None = None,
                      min_score: float | None = None, language: str | None = None, auto_upload: bool = False,
                      watermark: bool | None = None, watermark_text: str | None = None,
                      hook_title: bool | None = None, hook_style: str | None = None,
                      hook_position: str | None = None, cam_position: str | None = None,
                      dopamine_video: str | None = None, captions: bool | None = None):
    safe = "".join(ch for ch in (file.filename or "video.mp4") if ch.isalnum() or ch in "._- ") or "video.mp4"
    fd, tmp = tempfile.mkstemp(dir=UPLOADS_DIR, suffix=".part")
    with os.fdopen(fd, "wb") as f:
        shutil.copyfileobj(file.file, f, length=8 * 1024 * 1024)
    dest = UPLOADS_DIR / safe
    i = 1
    while dest.exists():
        dest = UPLOADS_DIR / f"{Path(safe).stem}_{i}{Path(safe).suffix}"
        i += 1
    shutil.move(tmp, dest)
    raw_opts = {"count": count, "mode": mode or None, "min_score": min_score, "language": language or None,
                "auto_upload": auto_upload, "watermark": watermark, "watermark_text": watermark_text,
                "hook_title": hook_title, "hook_style": hook_style or None, "hook_position": hook_position or None,
                "cam_position": cam_position or None, "dopamine_video": dopamine_video, "captions": captions}
    opts = {k: v for k, v in raw_opts.items() if v is not None}
    return {"id": pipeline.enqueue_job(str(dest), opts)}


@app.get("/api/jobs")
def jobs():
    return db.list_jobs()


@app.get("/api/jobs/{job_id}")
def job(job_id: int):
    j = db.get_job(job_id)
    if not j:
        raise HTTPException(404)
    j["clips"] = [_clip_out(c) for c in db.list_clips(job_id)]
    return j


@app.post("/api/jobs/{job_id}/retry")
def retry(job_id: int):
    j = db.get_job(job_id)
    if not j:
        raise HTTPException(404)
    db.execute("DELETE FROM clips WHERE job_id=?", (job_id,))
    db.update_job(job_id, status="queued", progress=0, message="", stage="")
    pipeline.submit(pipeline.process_compilation if j["kind"] == "compilation" else pipeline.process_job, job_id)
    return {"ok": True}


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int):
    db.delete_job(job_id)
    shutil.rmtree(pipeline.job_dir(job_id), ignore_errors=True)
    return {"ok": True}


# ----------------------------------------------------------------- clips
class ClipPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    hashtags: list[str] | None = None
    tags: list[str] | None = None
    hook: str | None = None
    start: float | None = None
    end: float | None = None


@app.get("/api/clips")
def clips():
    job_titles = {j["id"]: (j.get("title") or j.get("source") or "") for j in db.list_jobs(300)}
    out = []
    for c in db.list_clips():
        item = _clip_out(c)
        item["job_title"] = job_titles.get(c["job_id"], "")
        out.append(item)
    return out


@app.patch("/api/clips/{clip_id}")
def patch_clip(clip_id: int, p: ClipPatch):
    if not db.get_clip(clip_id):
        raise HTTPException(404)
    fields = {k: v for k, v in p.model_dump().items() if v is not None}
    db.update_clip(clip_id, **fields)
    clip = db.get_clip(clip_id)
    metadata.sync_clip_files(clip)
    return _clip_out(clip)


class RenderOptsIn(BaseModel):
    mode: str | None = None
    cam_position: str | None = None
    hook_style: str | None = None
    hook_position: str | None = None
    dopamine_video: str | None = None
    use_saved_style: bool = True


@app.post("/api/clips/{clip_id}/render")
def rerender(clip_id: int, opts: RenderOptsIn | None = Body(default=None)):
    clip = db.get_clip(clip_id)
    if not clip:
        raise HTTPException(404)
    o = opts.model_dump() if opts else {}
    overrides = {k: o[k] for k in ("mode", "cam_position", "hook_style", "hook_position", "dopamine_video")
                 if o.get(k) is not None}
    if overrides.get("mode"):
        db.update_clip(clip_id, render_mode=overrides["mode"])
    db.update_clip(clip_id, status="pending")
    pipeline.submit(pipeline.render_clip, clip_id, None, None, None, None, None,
                    o.get("use_saved_style", True), overrides or None)
    return {"ok": True}


class BatchRenderIn(BaseModel):
    clip_ids: list[int]
    mode: str | None = None
    cam_position: str | None = None
    hook_style: str | None = None
    hook_position: str | None = None
    dopamine_video: str | None = None


@app.post("/api/clips/render-batch")
def render_batch(b: BatchRenderIn):
    overrides = {k: getattr(b, k) for k in ("mode", "cam_position", "hook_style", "hook_position", "dopamine_video")
                 if getattr(b, k) is not None}
    queued = 0
    for cid in b.clip_ids:
        c = db.get_clip(cid)
        if not c or c.get("kind") == "long":
            continue
        if overrides.get("mode"):
            db.update_clip(cid, render_mode=overrides["mode"])
        db.update_clip(cid, status="pending")
        pipeline.submit(pipeline.render_clip, cid, None, None, None, None, None, True, overrides or None)
        queued += 1
    return {"ok": True, "queued": queued}


@app.post("/api/clips/{clip_id}/metadata")
def regen(clip_id: int):
    return pipeline.regen_metadata(clip_id)


class UploadIn(BaseModel):
    schedule: str | None = "auto"   # auto | now | ISO-UTC


@app.post("/api/clips/{clip_id}/upload")
def upload_clip(clip_id: int, u: UploadIn):
    if not youtube.is_authenticated():
        raise HTTPException(400, "Conecte o YouTube primeiro")
    db.update_clip(clip_id, status="uploading")
    pipeline.submit(pipeline.upload_clip, clip_id, u.schedule, uploads=True)
    return {"ok": True}


class CompIn(BaseModel):
    clip_ids: list[int]
    title: str = ""


@app.post("/api/compilation")
def compilation(c: CompIn):
    if len(c.clip_ids) < 2:
        raise HTTPException(400, "Selecione pelo menos 2 cortes")
    return {"id": pipeline.enqueue_compilation(c.clip_ids, c.title)}


# ----------------------------------------------------------------- youtube / sistema
@app.post("/api/youtube/auth")
def yt_auth():
    try:
        return youtube.authenticate()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.get("/api/youtube/channel")
def yt_channel():
    try:
        return youtube.channel_info()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.post("/api/youtube/secret")
async def yt_secret(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"JSON inválido: {e}")
    if "installed" not in data and "web" not in data:
        raise HTTPException(400, "Arquivo não parece um client_secret.json OAuth do Google Cloud")
    dest = youtube_client_secret()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return {"ok": True, "path": str(dest)}


@app.post("/api/gemini/test")
def gemini_test():
    if not gemini_key():
        raise HTTPException(400, "GEMINI_API_KEY não configurada")
    try:
        llm = get_llm()
        res = llm.generate_json('Responda somente JSON: {"ok":true}', temperature=0.0, retries=2)
        return {"ok": True, "model": llm.model, "reply": res}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.get("/api/config")
def get_config():
    k = gemini_key() or ""
    masked = (k[:4] + "..." + k[-4:]) if len(k) > 10 else ("configurada" if k else "")
    return {
        "gemini_set": bool(k), "gemini_masked": masked,
        "client_secret": youtube_client_secret().exists(),
        "workspace": CFG["workspace"], "channel": CFG["channel"], "clips": CFG["clips"],
        "render": CFG["render"], "llm": CFG["llm"], "transcription": CFG["transcription"],
        "upload": CFG["upload"], "monitor": CFG["monitor"],
    }


class ConfigIn(BaseModel):
    gemini_api_key: str | None = None
    workspace: dict | None = None
    channel: dict | None = None
    clips: dict | None = None
    render: dict | None = None
    llm: dict | None = None
    transcription: dict | None = None
    upload: dict | None = None
    monitor: dict | None = None


@app.post("/api/config")
def update_config(c: ConfigIn):
    if c.gemini_api_key is not None and c.gemini_api_key.strip():
        set_env_var("GEMINI_API_KEY", c.gemini_api_key.strip())
    trans = dict(c.transcription) if c.transcription is not None else None
    if trans is not None and "language" in trans:
        raw_lang = (trans["language"] or "").strip().lower()
        trans["language"] = None if raw_lang in ("", "auto", "none") else raw_lang
    updates = {k: v for k, v in {"workspace": c.workspace, "channel": c.channel, "clips": c.clips,
                                 "render": c.render, "llm": c.llm, "transcription": trans,
                                 "upload": c.upload, "monitor": c.monitor}.items()
               if v is not None}
    if updates:
        save_config(updates)
        monitor.start()
    return {"ok": True, "gemini_set": bool(gemini_key()), "workspace": CFG["workspace"],
            "channel": CFG["channel"], "render": CFG["render"]}


@app.post("/api/config/reload")
def cfg_reload():
    reload()
    return {"ok": True}


@app.post("/api/monitor/check")
def monitor_check():
    return {"created": monitor.check_once()}


# ----------------------------------------------------------------- b-roll / dual dopamine
@app.get("/api/broll")
def list_broll():
    return _broll_list()


@app.get("/broll/{name}")
def get_broll(name: str):
    p = (BROLL_DIR / Path(name).name).resolve()
    if not str(p).startswith(str(BROLL_DIR.resolve())) or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


@app.post("/api/broll")
async def upload_broll(file: UploadFile = File(...)):
    BROLL_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(ch for ch in (file.filename or "dopamine.mp4") if ch.isalnum() or ch in "._- ") or "dopamine.mp4"
    if Path(safe).suffix.lower() not in (".mp4", ".mov", ".mkv", ".webm"):
        raise HTTPException(400, "Envie um arquivo de vídeo (.mp4, .mov, .mkv ou .webm)")
    dest = BROLL_DIR / safe
    i = 1
    while dest.exists():
        dest = BROLL_DIR / f"{Path(safe).stem}_{i}{Path(safe).suffix}"
        i += 1
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f, length=8 * 1024 * 1024)
    return {"ok": True, "name": dest.name, "items": _broll_list()}


@app.delete("/api/broll/{name}")
def delete_broll(name: str):
    p = (BROLL_DIR / Path(name).name).resolve()
    if not str(p).startswith(str(BROLL_DIR.resolve())) or not p.is_file():
        raise HTTPException(404)
    p.unlink()
    if CFG["render"].get("dopamine_video") == p.name:
        save_config({"render": {"dopamine_video": ""}})
    return {"ok": True, "items": _broll_list()}


# ----------------------------------------------------------------- calendário & analytics (telas comerciais)
@app.get("/api/schedule")
def get_schedule():
    all_clips = [_clip_out(c) for c in db.list_clips()]
    scheduled = sorted(
        [c for c in all_clips if c.get("publish_at") and c.get("status") in ("scheduled", "uploading")],
        key=lambda x: x["publish_at"],
    )
    published = [c for c in all_clips if c.get("status") == "uploaded" or (c.get("youtube_id") and not c.get("publish_at"))]
    ready = [c for c in all_clips if c.get("status") == "rendered" and not c.get("youtube_id")]
    taken = db.scheduled_publish_times()
    upcoming = []
    sim_taken = list(taken)
    for _ in range(8):
        try:
            nxt = youtube.next_slot(sim_taken, CFG)
            upcoming.append(nxt)
            sim_taken.append(nxt)
        except Exception:
            break
    return {
        "scheduled": scheduled,
        "published": published,
        "ready": ready,
        "upcoming_slots": upcoming,
        "upload_cfg": CFG["upload"],
        "youtube_auth": youtube.is_authenticated(),
    }


@app.get("/api/analytics")
def get_analytics():
    all_jobs = db.list_jobs(500)
    all_clips = db.list_clips()
    shorts = [c for c in all_clips if c.get("kind") != "long"]
    comps = [c for c in all_clips if c.get("kind") == "long"]
    scores = [float(c["score"]) for c in shorts if c.get("score") is not None]
    tiers = {"viral": 0, "high": 0, "medium": 0, "low": 0}
    cats: dict[str, int] = {}
    modes: dict[str, int] = {}
    for c in shorts:
        sc = float(c.get("score") or 0)
        if sc >= 85:
            tiers["viral"] += 1
        elif sc >= 70:
            tiers["high"] += 1
        elif sc >= 55:
            tiers["medium"] += 1
        else:
            tiers["low"] += 1
        cat = (c.get("category") or "outro").lower()
        cats[cat] = cats.get(cat, 0) + 1
        m = (c.get("render_mode") or CFG["render"]["mode"] or "blur").lower()
        modes[m] = modes.get(m, 0) + 1

    total_src_min = round(sum(float(j.get("duration") or 0) for j in all_jobs if j.get("kind") != "compilation") / 60, 1)
    total_clip_sec = round(sum(max(0.0, float(c.get("end") or 0) - float(c.get("start") or 0)) for c in shorts), 1)
    top_clips = [_clip_out(c) for c in sorted(shorts, key=lambda x: x.get("score") or 0, reverse=True)[:6]]

    return {
        "totals": {
            "jobs": len(all_jobs),
            "jobs_done": sum(1 for j in all_jobs if j.get("status") == "done"),
            "clips": len(shorts),
            "compilations": len(comps),
            "rendered": sum(1 for c in all_clips if c.get("status") == "rendered"),
            "scheduled": sum(1 for c in all_clips if c.get("status") == "scheduled"),
            "uploaded": sum(1 for c in all_clips if c.get("status") == "uploaded"),
            "avg_score": round(sum(scores) / len(scores), 1) if scores else 0.0,
            "source_minutes": total_src_min,
            "clips_minutes": round(total_clip_sec / 60, 1),
        },
        "tiers": tiers,
        "categories": sorted(cats.items(), key=lambda x: x[1], reverse=True)[:8],
        "modes": sorted(modes.items(), key=lambda x: x[1], reverse=True),
        "top_clips": top_clips,
        "onboarding": {
            "has_ffmpeg": bool(media.ffmpeg_bin()) if _try_ffmpeg() else False,
            "has_gemini": bool(gemini_key()),
            "has_youtube": youtube.is_authenticated(),
            "has_watermark": bool((CFG["channel"].get("watermark_text") or "").strip()),
            "has_clips": len(all_clips) > 0,
        },
        "workspace": CFG["workspace"],
    }


def _try_ffmpeg() -> bool:
    try:
        return bool(media.ffmpeg_bin())
    except Exception:
        return False
