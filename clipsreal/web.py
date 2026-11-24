"""Painel web local (FastAPI) — http://localhost:8000"""
from __future__ import annotations

import html
import json
import logging
import mimetypes
import os
import secrets
import shutil
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, instagram, media, metadata, monitor, pipeline, render, tiktok, youtube
from .config import (BROLL_DIR, CFG, DATA, UPLOADS_DIR, gemini_key, instagram_app_id, instagram_app_secret,
                     instagram_redirect_uri, oauth_broker_url, reload, save_config, set_env_var,
                     tiktok_client_key, tiktok_client_secret, tiktok_redirect_uri, youtube_client_secret,
                     youtube_cookies_browser, youtube_cookies_file)
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
    db.execute("UPDATE clips SET ig_status='' WHERE ig_status='uploading'")
    db.execute("UPDATE clips SET tiktok_status='' WHERE tiktok_status='uploading'")
    monitor.start()
    yield


mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
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
    dist_index = STATIC / "dist" / "index.html"
    if not dist_index.is_file():
        raise HTTPException(503, "Frontend não compilado. Execute: npm --prefix frontend run build")
    return FileResponse(dist_index, headers={"Cache-Control": "no-store, must-revalidate"})


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
        "youtube_cookies": youtube_cookies_file().is_file(), "cookies_from_browser": youtube_cookies_browser(),
        "instagram_auth": instagram.is_authenticated(),
        "instagram_user": instagram.connected_summary(),
        "instagram_configured": bool(instagram_app_id() and instagram_app_secret()),
        "instagram_redirect_uri": instagram_redirect_uri(),
        "instagram": CFG.get("instagram") or {},
        "tiktok_auth": tiktok.is_authenticated(),
        "tiktok_user": tiktok.connected_summary(),
        "tiktok_configured": bool(tiktok_client_key() and tiktok_client_secret()),
        "tiktok_redirect_uri": tiktok_redirect_uri(),
        "tiktok": CFG.get("tiktok") or {},
        "oauth_broker_url": oauth_broker_url(),
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
    censor_18plus: bool | None = None


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
                      dopamine_video: str | None = None, captions: bool | None = None,
                      censor_18plus: bool | None = None):
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
                "cam_position": cam_position or None, "dopamine_video": dopamine_video, "captions": captions,
                "censor_18plus": censor_18plus}
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
    captions: bool | None = None
    use_saved_style: bool = True


@app.post("/api/clips/{clip_id}/render")
def rerender(clip_id: int, opts: RenderOptsIn | None = Body(default=None)):
    clip = db.get_clip(clip_id)
    if not clip:
        raise HTTPException(404)
    o = opts.model_dump() if opts else {}
    overrides = {k: o[k] for k in ("mode", "cam_position", "hook_style", "hook_position", "dopamine_video", "captions")
                 if o.get(k) is not None}
    if overrides.get("mode"):
        db.update_clip(clip_id, render_mode=overrides["mode"])
    db.update_clip(clip_id, status="pending")
    pipeline.submit(pipeline.render_clip, clip_id, None, None, None, None, None,
                    o.get("use_saved_style", True), overrides or None)
    return {"ok": True}


class BatchRenderIn(BaseModel):
    clip_ids: list[int] | None = None
    job_id: int | None = None
    mode: str | None = None
    cam_position: str | None = None
    hook_style: str | None = None
    hook_position: str | None = None
    dopamine_video: str | None = None
    captions: bool | None = None


@app.post("/api/clips/render-batch")
def render_batch(b: BatchRenderIn):
    overrides = {k: getattr(b, k) for k in ("mode", "cam_position", "hook_style", "hook_position", "dopamine_video", "captions")
                 if getattr(b, k) is not None}
    ids = list(b.clip_ids) if b.clip_ids else []
    if not ids and b.job_id:
        ids = [c["id"] for c in db.list_clips(b.job_id)]
    queued = 0
    for cid in ids:
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
    clip = db.get_clip(clip_id)
    if not clip:
        raise HTTPException(404)
    if not clip.get("file_path") or not Path(clip["file_path"]).is_file():
        raise HTTPException(400, "Corte ainda não foi renderizado")
    db.update_clip(clip_id, status="uploading", error=None)
    pipeline.submit(pipeline.upload_clip, clip_id, u.schedule, uploads=True)
    return {"ok": True}


class InstagramPublishIn(BaseModel):
    share_to_feed: bool | None = None


@app.post("/api/clips/{clip_id}/instagram")
def publish_instagram_clip(clip_id: int, body: InstagramPublishIn | None = Body(default=None)):
    if not instagram.is_authenticated():
        raise HTTPException(400, "Conecte o Instagram primeiro em Chaves & API → Instagram & TikTok.")
    clip = db.get_clip(clip_id)
    if not clip:
        raise HTTPException(404)
    try:
        pipeline.assert_vertical_clip(clip)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.update_clip(clip_id, ig_status="uploading", ig_error="")
    pipeline.submit(pipeline.upload_instagram_clip, clip_id, body.share_to_feed if body else None, uploads=True)
    return {"ok": True}


class TikTokPublishIn(BaseModel):
    privacy_level: str | None = None
    post_mode: str | None = None


@app.post("/api/clips/{clip_id}/tiktok")
def publish_tiktok_clip(clip_id: int, body: TikTokPublishIn | None = Body(default=None)):
    if not tiktok.is_authenticated():
        raise HTTPException(400, "Conecte o TikTok primeiro em Chaves & API → Instagram & TikTok.")
    clip = db.get_clip(clip_id)
    if not clip:
        raise HTTPException(404)
    try:
        pipeline.assert_vertical_clip(clip)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.update_clip(clip_id, tiktok_status="uploading", tiktok_error="")
    pipeline.submit(
        pipeline.upload_tiktok_clip,
        clip_id,
        body.privacy_level if body else None,
        body.post_mode if body else None,
        uploads=True,
    )
    return {"ok": True}


class BatchPublishIn(BaseModel):
    clip_ids: list[int]
    platform: str  # youtube | instagram | tiktok


@app.post("/api/clips/publish-batch")
def publish_batch(b: BatchPublishIn):
    plat = b.platform.strip().lower()
    if plat not in ("youtube", "instagram", "tiktok"):
        raise HTTPException(400, "Plataforma inválida (use youtube, instagram ou tiktok).")
    if plat == "youtube" and not youtube.is_authenticated():
        raise HTTPException(400, "Conecte o YouTube primeiro.")
    if plat == "instagram" and not instagram.is_authenticated():
        raise HTTPException(400, "Conecte o Instagram primeiro.")
    if plat == "tiktok" and not tiktok.is_authenticated():
        raise HTTPException(400, "Conecte o TikTok primeiro.")
    queued = 0
    for cid in b.clip_ids:
        c = db.get_clip(cid)
        if not c or not c.get("file_path") or not Path(c["file_path"]).is_file():
            continue
        if plat == "youtube":
            if c.get("youtube_id"):
                continue
            db.update_clip(cid, status="uploading", error=None)
            pipeline.submit(pipeline.upload_clip, cid, "auto", uploads=True)
            queued += 1
        elif plat == "instagram":
            try:
                pipeline.assert_vertical_clip(c)
            except ValueError:
                continue
            db.update_clip(cid, ig_status="uploading", ig_error="")
            pipeline.submit(pipeline.upload_instagram_clip, cid, None, uploads=True)
            queued += 1
        elif plat == "tiktok":
            try:
                pipeline.assert_vertical_clip(c)
            except ValueError:
                continue
            db.update_clip(cid, tiktok_status="uploading", tiktok_error="")
            pipeline.submit(pipeline.upload_tiktok_clip, cid, None, None, uploads=True)
            queued += 1
    if not queued:
        raise HTTPException(400, "Nenhum corte vertical renderizado elegível na seleção.")
    return {"ok": True, "queued": queued}


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


@app.post("/api/youtube/cookies")
async def yt_cookies(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as e:
        raise HTTPException(400, f"O arquivo precisa ser texto UTF-8 (Netscape cookies.txt): {e}")
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not any("\t" in ln and len(ln.split("\t")) >= 7 for ln in lines):
        raise HTTPException(400, "Arquivo não parece um cookies.txt no formato Netscape (exportado do navegador).")
    dest = youtube_cookies_file()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    return {"ok": True, "path": str(dest)}


@app.delete("/api/youtube/cookies")
def yt_cookies_delete():
    p = youtube_cookies_file()
    if p.is_file():
        p.unlink()
    return {"ok": True}


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


def _mask_secret(val: str) -> str:
    return (val[:4] + "..." + val[-4:]) if len(val) > 10 else ("configurado" if val else "")


def _oauth_popup_html(platform: str, ok: bool, detail: str) -> HTMLResponse:
    safe_plat = html.escape(platform)
    safe_msg = html.escape(detail)
    status_color = "#34d399" if ok else "#fb7185"
    title = f"{safe_plat} conectado" if ok else f"Erro ao conectar {safe_plat}"
    payload = (
        json.dumps({"type": "clipsreal:oauth", "platform": platform.lower(), "ok": ok, "detail": detail})
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )
    body = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<title>{title} · ClipsReal</title>
<style>
  body{{background:#09090b;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}}
  .box{{max-width:460px;width:100%;background:#121216;border:1px solid #27272a;border-radius:12px;padding:24px}}
  h1{{font-size:16px;margin:0 0 8px;color:{status_color}}}
  p{{font-size:13px;line-height:1.5;color:#a1a1aa;margin:0 0 16px;word-break:break-word}}
  button{{background:#fafafa;color:#09090b;border:0;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}}
</style></head><body><div class="box">
  <h1>{title}</h1><p>{safe_msg}</p>
  <button onclick="window.close()">Fechar janela</button>
</div><script>
  try {{ if (window.opener) window.opener.postMessage({payload}, window.location.origin); }} catch (_) {{}}
  try {{ const ch = new BroadcastChannel("clipsreal_oauth"); ch.postMessage({payload}); ch.close(); }} catch (_) {{}}
  {"setTimeout(() => window.close(), 1400);" if ok else ""}
</script></body></html>"""
    return HTMLResponse(body, status_code=200 if ok else 400)


_broker_lock = threading.Lock()
_pending_broker: dict[str, tuple[str, float]] = {}  # client_state -> (provider, ts)


def _safe_local_origin(origin: str | None) -> str:
    raw = (origin or "").strip().rstrip("/")
    if not raw:
        port = (os.getenv("CLIPSREAL_PORT") or "8000").strip() or "8000"
        return f"http://127.0.0.1:{port}"
    u = urlparse(raw)
    if u.scheme != "http" or u.hostname not in ("localhost", "127.0.0.1"):
        raise HTTPException(400, "Origin local inválido para callback OAuth.")
    return raw


def _start_broker_url(provider: str, origin: str | None, mode: str = "") -> str:
    broker = oauth_broker_url()
    if not broker:
        raise RuntimeError("OAUTH_BROKER_URL não configurada.")
    base_origin = _safe_local_origin(origin)
    nonce = secrets.token_urlsafe(24)
    with _broker_lock:
        cutoff = time.time() - 900
        for k in [k for k, v in _pending_broker.items() if v[1] < cutoff]:
            _pending_broker.pop(k, None)
        _pending_broker[nonce] = (provider, time.time())
    params: dict[str, str] = {
        "callback": f"{base_origin}/api/oauth/broker-callback",
        "client_state": nonce,
    }
    if mode:
        params["mode"] = mode
    return f"{broker}/auth/{provider}?{urlencode(params)}"


def _finish_broker_bundle(provider: str, client_state: str, token_bundle: dict) -> dict:
    with _broker_lock:
        entry = _pending_broker.pop(client_state, None)
    if not entry or entry[0] != provider:
        raise HTTPException(400, "Sessão de login expirada ou inválida. Tente conectar novamente.")
    if provider == "youtube":
        info = youtube.save_broker_token(token_bundle)
        label = info.get("title") or "YouTube conectado"
        return {"platform": "youtube", "label": label, "info": info}
    if provider == "instagram":
        info = instagram.save_broker_token(token_bundle)
        uname = info.get("username") or info.get("ig_user_id") or "Instagram conectado"
        return {"platform": "instagram", "label": f"@{str(uname).lstrip('@')}", "info": info}
    if provider == "tiktok":
        info = tiktok.save_broker_token(token_bundle)
        label = info.get("username") or info.get("display_name") or info.get("open_id") or "TikTok conectado"
        return {"platform": "tiktok", "label": label, "info": info}
    raise HTTPException(400, "Provedor OAuth inválido.")


class SocialOAuthStartIn(BaseModel):
    mode: str | None = None
    redirect_uri: str | None = None
    origin: str | None = None


class BrokerCompleteIn(BaseModel):
    provider: str
    client_state: str
    token_bundle: dict


class InstagramManualIn(BaseModel):
    access_token: str
    ig_user_id: str = ""
    api_type: str = "auto"


class TikTokManualIn(BaseModel):
    access_token: str
    open_id: str = ""
    scope: str = ""


@app.post("/api/youtube/oauth/start")
def youtube_oauth_start(b: SocialOAuthStartIn | None = Body(default=None)):
    try:
        if oauth_broker_url() and not (b and b.mode == "local"):
            return {"mode": "broker", "auth_url": _start_broker_url("youtube", b.origin if b else None)}
        if not youtube_client_secret().exists():
            raise RuntimeError(
                "Nenhum OAuth Broker nem client_secret.json configurados. Configure a URL do OAuth Broker "
                "para login 1 clique ou envie client_secret.json em Configuração avançada."
            )
        return {"mode": "local", "info": youtube.authenticate()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.delete("/api/youtube/auth")
def youtube_disconnect():
    youtube.disconnect()
    return {"ok": True}


class BrokerCheckIn(BaseModel):
    broker_url: str = ""


@app.post("/api/oauth/broker-check")
def oauth_broker_check(b: BrokerCheckIn):
    target = (b.broker_url or oauth_broker_url() or "").strip().rstrip("/")
    if not target:
        raise HTTPException(400, "Informe a URL do OAuth Broker (ex.: https://seu-worker.workers.dev).")
    u = urlparse(target)
    if u.scheme not in ("http", "https") or not u.netloc:
        raise HTTPException(400, "URL inválida. Use https://... (ou http://localhost...)")
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{target}/health")
        if not r.is_success:
            raise HTTPException(400, f"Broker respondeu HTTP {r.status_code}")
        data = r.json()
        return {
            "ok": bool(data.get("ok")),
            "url": target,
            "providers": data.get("providers") or {},
        }
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Não foi possível conectar ao Broker: {e}")


@app.post("/api/oauth/broker-complete")
def oauth_broker_complete(b: BrokerCompleteIn):
    try:
        res = _finish_broker_bundle(b.provider.strip().lower(), b.client_state, b.token_bundle)
        return {"ok": True, **res}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.post("/api/oauth/broker-callback")
async def oauth_broker_callback(request: Request, payload: str = Form(default="")):
    raw_text = payload
    if not raw_text:
        try:
            body_bytes = await request.body()
            raw_text = body_bytes.decode("utf-8")
        except Exception:  # noqa: BLE001
            raw_text = ""
    try:
        data = json.loads(raw_text)
        provider = str(data.get("provider") or "").strip().lower()
        client_state = str(data.get("client_state") or "").strip()
        token_bundle = data.get("token_bundle") or {}
        res = _finish_broker_bundle(provider, client_state, token_bundle)
        nice_name = {"youtube": "YouTube", "instagram": "Instagram", "tiktok": "TikTok"}.get(provider, provider)
        return _oauth_popup_html(nice_name, True, f"Conectado como {res['label']}. Esta janela será fechada.")
    except HTTPException as e:
        return _oauth_popup_html("Conexão", False, str(e.detail))
    except Exception as e:  # noqa: BLE001
        return _oauth_popup_html("Conexão", False, str(e))


@app.post("/api/instagram/oauth/start")
def instagram_oauth_start(b: SocialOAuthStartIn | None = Body(default=None)):
    try:
        ltype = (b.mode if b and b.mode else None) or (CFG.get("instagram") or {}).get("login_type", "instagram")
        if oauth_broker_url() and not (instagram_app_id() and instagram_app_secret()):
            return {"mode": "broker", "auth_url": _start_broker_url("instagram", b.origin if b else None, mode=ltype)}
        url = instagram.start_oauth(login_type=ltype, redirect_uri=(b.redirect_uri if b else None))
        return {"mode": "local", "auth_url": url}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.get("/api/instagram/callback")
def instagram_callback(code: str = "", state: str = "", error: str = "", error_description: str = ""):
    if error:
        return _oauth_popup_html("Instagram", False, error_description or error)
    if not code or not state:
        return _oauth_popup_html("Instagram", False, "Código de autorização ausente na resposta da Meta.")
    try:
        info = instagram.finish_oauth(code, state)
        uname = info.get("username") or info.get("ig_user_id") or "conta vinculada"
        return _oauth_popup_html("Instagram", True, f"Conectado como @{str(uname).lstrip('@')}. Esta janela será fechada.")
    except Exception as e:  # noqa: BLE001
        return _oauth_popup_html("Instagram", False, str(e))


@app.post("/api/instagram/manual")
def instagram_manual(b: InstagramManualIn):
    try:
        return instagram.connect_manual(b.access_token, ig_user_id=b.ig_user_id, api_type=b.api_type)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.delete("/api/instagram/auth")
def instagram_disconnect():
    instagram.disconnect()
    return {"ok": True}


@app.post("/api/tiktok/oauth/start")
def tiktok_oauth_start(b: SocialOAuthStartIn | None = Body(default=None)):
    try:
        pmode = (b.mode if b and b.mode else None) or (CFG.get("tiktok") or {}).get("post_mode", "direct")
        if oauth_broker_url() and not (tiktok_client_key() and tiktok_client_secret()):
            return {"mode": "broker", "auth_url": _start_broker_url("tiktok", b.origin if b else None, mode=pmode)}
        url = tiktok.start_oauth(post_mode=pmode, redirect_uri=(b.redirect_uri if b else None))
        return {"mode": "local", "auth_url": url}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.get("/api/tiktok/callback")
def tiktok_callback(code: str = "", state: str = "", error: str = "", error_description: str = ""):
    if error:
        return _oauth_popup_html("TikTok", False, error_description or error)
    if not code or not state:
        return _oauth_popup_html("TikTok", False, "Código de autorização ausente na resposta do TikTok.")
    try:
        info = tiktok.finish_oauth(code, state)
        label = info.get("username") or info.get("display_name") or info.get("open_id") or "conta vinculada"
        return _oauth_popup_html("TikTok", True, f"Conectado como {label}. Esta janela será fechada.")
    except Exception as e:  # noqa: BLE001
        return _oauth_popup_html("TikTok", False, str(e))


@app.post("/api/tiktok/manual")
def tiktok_manual(b: TikTokManualIn):
    try:
        return tiktok.connect_manual(b.access_token, open_id=b.open_id, scope=b.scope)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.delete("/api/tiktok/auth")
def tiktok_disconnect():
    tiktok.disconnect()
    return {"ok": True}


@app.get("/api/tiktok/creator-info")
def tiktok_creator_info():
    try:
        return tiktok.creator_info()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@app.get("/api/config")
def get_config():
    k = gemini_key() or ""
    ig_sec = instagram_app_secret()
    tt_sec = tiktok_client_secret()
    return {
        "gemini_set": bool(k), "gemini_masked": _mask_secret(k),
        "client_secret": youtube_client_secret().exists(),
        "youtube_cookies": youtube_cookies_file().is_file(),
        "cookies_from_browser": youtube_cookies_browser(),
        "instagram_app_id": instagram_app_id(),
        "instagram_secret_set": bool(ig_sec),
        "instagram_secret_masked": _mask_secret(ig_sec),
        "instagram_redirect_uri": instagram_redirect_uri(),
        "instagram_user": instagram.connected_summary(),
        "tiktok_client_key": tiktok_client_key(),
        "tiktok_secret_set": bool(tt_sec),
        "tiktok_secret_masked": _mask_secret(tt_sec),
        "tiktok_redirect_uri": tiktok_redirect_uri(),
        "tiktok_user": tiktok.connected_summary(),
        "oauth_broker_url": oauth_broker_url(),
        "workspace": CFG["workspace"], "channel": CFG["channel"], "clips": CFG["clips"],
        "render": CFG["render"], "llm": CFG["llm"], "transcription": CFG["transcription"],
        "upload": CFG["upload"], "instagram": CFG.get("instagram") or {}, "tiktok": CFG.get("tiktok") or {},
        "auth": CFG.get("auth") or {}, "monitor": CFG["monitor"], "ingest": CFG["ingest"],
    }


class ConfigIn(BaseModel):
    gemini_api_key: str | None = None
    oauth_broker_url: str | None = None
    instagram_app_id: str | None = None
    instagram_app_secret: str | None = None
    instagram_redirect_uri: str | None = None
    tiktok_client_key: str | None = None
    tiktok_client_secret: str | None = None
    tiktok_redirect_uri: str | None = None
    workspace: dict | None = None
    channel: dict | None = None
    clips: dict | None = None
    render: dict | None = None
    llm: dict | None = None
    transcription: dict | None = None
    upload: dict | None = None
    instagram: dict | None = None
    tiktok: dict | None = None
    auth: dict | None = None
    monitor: dict | None = None
    ingest: dict | None = None


@app.post("/api/config")
def update_config(c: ConfigIn):
    if c.gemini_api_key is not None and c.gemini_api_key.strip():
        set_env_var("GEMINI_API_KEY", c.gemini_api_key.strip())
    if c.oauth_broker_url is not None:
        set_env_var("OAUTH_BROKER_URL", c.oauth_broker_url.strip().rstrip("/"))
    for field, env_name, default_val in (
        (c.instagram_app_id, "INSTAGRAM_APP_ID", None),
        (c.instagram_app_secret, "INSTAGRAM_APP_SECRET", None),
        (c.instagram_redirect_uri, "INSTAGRAM_REDIRECT_URI", instagram_redirect_uri()),
        (c.tiktok_client_key, "TIKTOK_CLIENT_KEY", None),
        (c.tiktok_client_secret, "TIKTOK_CLIENT_SECRET", None),
        (c.tiktok_redirect_uri, "TIKTOK_REDIRECT_URI", tiktok_redirect_uri()),
    ):
        if field is not None and field.strip():
            val = field.strip()
            if default_val is not None and val == default_val and not os.getenv(env_name):
                continue
            set_env_var(env_name, val)
    trans = dict(c.transcription) if c.transcription is not None else None
    if trans is not None and "language" in trans:
        raw_lang = (trans["language"] or "").strip().lower()
        trans["language"] = None if raw_lang in ("", "auto", "none") else raw_lang
    updates = {k: v for k, v in {"workspace": c.workspace, "channel": c.channel, "clips": c.clips,
                                 "render": c.render, "llm": c.llm, "transcription": trans,
                                 "upload": c.upload, "instagram": c.instagram, "tiktok": c.tiktok,
                                 "auth": c.auth, "monitor": c.monitor, "ingest": c.ingest}.items()
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
    ready = [
        c for c in all_clips
        if c.get("status") in ("rendered", "error") and c.get("file_path") and not c.get("youtube_id")
    ]
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
            "instagram_published": sum(1 for c in shorts if c.get("ig_status") == "published"),
            "tiktok_published": sum(1 for c in shorts if c.get("tiktok_status") in ("published", "inbox")),
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
            "has_instagram": instagram.is_authenticated(),
            "has_tiktok": tiktok.is_authenticated(),
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
