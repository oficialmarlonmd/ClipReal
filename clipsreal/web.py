"""Painel web local (FastAPI) — http://localhost:8000"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, media, metadata, monitor, pipeline, render, youtube
from .config import CFG, DATA, UPLOADS_DIR, gemini_key, reload, save_config, set_env_var, youtube_client_secret
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
        rel = Path(p).resolve().relative_to(DATA.resolve())
        return "/data/" + rel.as_posix()
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
        "channel": CFG["channel"], "render_mode": CFG["render"]["mode"], "target_count": CFG["clips"]["target_count"],
    }


# ----------------------------------------------------------------- jobs
class JobIn(BaseModel):
    source: str
    count: int | None = None
    mode: str | None = None
    min_score: float | None = None
    auto_upload: bool = False
    use_video: bool | None = None


@app.post("/api/jobs")
def create_job(j: JobIn):
    opts = {k: v for k, v in j.model_dump().items() if k != "source" and v is not None}
    return {"id": pipeline.enqueue_job(j.source.strip(), opts)}


@app.post("/api/jobs/upload")
async def upload_file(file: UploadFile = File(...), count: int | None = None, mode: str | None = None,
                      auto_upload: bool = False):
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
    opts = {k: v for k, v in {"count": count, "mode": mode, "auto_upload": auto_upload}.items() if v}
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
    return [_clip_out(c) for c in db.list_clips()]


@app.patch("/api/clips/{clip_id}")
def patch_clip(clip_id: int, p: ClipPatch):
    if not db.get_clip(clip_id):
        raise HTTPException(404)
    fields = {k: v for k, v in p.model_dump().items() if v is not None}
    db.update_clip(clip_id, **fields)
    clip = db.get_clip(clip_id)
    metadata.sync_clip_files(clip)
    return _clip_out(clip)


@app.post("/api/clips/{clip_id}/render")
def rerender(clip_id: int):
    db.update_clip(clip_id, status="pending")
    pipeline.submit(pipeline.render_clip, clip_id)
    return {"ok": True}


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
        "channel": CFG["channel"], "clips": CFG["clips"], "render": CFG["render"],
        "upload": CFG["upload"], "monitor": CFG["monitor"],
    }


class ConfigIn(BaseModel):
    gemini_api_key: str | None = None
    channel: dict | None = None
    clips: dict | None = None
    upload: dict | None = None
    monitor: dict | None = None


@app.post("/api/config")
def update_config(c: ConfigIn):
    if c.gemini_api_key is not None and c.gemini_api_key.strip():
        set_env_var("GEMINI_API_KEY", c.gemini_api_key.strip())
    updates = {k: v for k, v in {"channel": c.channel, "clips": c.clips, "upload": c.upload,
                                 "monitor": c.monitor}.items() if v is not None}
    if updates:
        save_config(updates)
        monitor.start()
    return {"ok": True, "gemini_set": bool(gemini_key())}


@app.post("/api/config/reload")
def cfg_reload():
    reload()
    return {"ok": True}


@app.post("/api/monitor/check")
def monitor_check():
    return {"created": monitor.check_once()}
