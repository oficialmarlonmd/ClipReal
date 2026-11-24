"""YouTube Data API v3: OAuth, upload (Shorts/longo), agendamento (publishAt) e thumbnail."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

from . import lang as lang_utils
from .config import DATA, youtube_client_secret

log = logging.getLogger("clipsreal.youtube")
SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"]
TOKEN = DATA / "youtube_token.json"


def friendly_upload_error(exc: Exception) -> str:
    """Converte erros comuns da YouTube Data API v3 em orientação clara sem perder o motivo."""
    raw = str(exc)
    if "uploadLimitExceeded" in raw:
        return (
            "Limite diário de uploads do canal atingido no YouTube (uploadLimitExceeded). "
            "O YouTube bloqueia novos envios via API por ~24h (mesmo agendados). "
            "Para aumentar o limite, ative os Recursos Avançados em studio.youtube.com "
            "(Configurações → Canal → Qualificação para recursos) e tente reenviar amanhã."
        )
    if "quotaExceeded" in raw:
        return (
            "Cota diária da YouTube Data API v3 atingida (quotaExceeded: 10.000 unidades/dia ≈ 6 vídeos). "
            "Aguarde a renovação diária da API ou reduza Máx/dia nas configurações."
        )
    if "youtubeSignupRequired" in raw or "channelNotFound" in raw:
        return (
            "A conta Google conectada não possui canal do YouTube ativo (youtubeSignupRequired). "
            "Crie o canal no YouTube e reconecte em Canal & YouTube."
        )
    return f"Upload: {raw}"


def is_authenticated() -> bool:
    return TOKEN.exists()


def _credentials(interactive: bool = False):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN.write_text(creds.to_json(), encoding="utf-8")
        return creds
    if not interactive:
        raise RuntimeError("YouTube não autenticado. Rode: python -m clipsreal auth  (ou botão no painel)")
    from google_auth_oauthlib.flow import InstalledAppFlow
    secret = youtube_client_secret()
    if not secret.exists():
        raise FileNotFoundError(f"client_secret.json não encontrado em {secret}. Veja README (seção YouTube API).")
    flow = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    return creds


def authenticate() -> dict:
    creds = _credentials(interactive=True)
    return channel_info(creds)


def _service(creds=None):
    from googleapiclient.discovery import build
    return build("youtube", "v3", credentials=creds or _credentials(), cache_discovery=False)


def channel_info(creds=None) -> dict:
    yt = _service(creds)
    r = yt.channels().list(part="snippet,statistics", mine=True).execute()
    if not r.get("items"):
        return {}
    it = r["items"][0]
    return {"id": it["id"], "title": it["snippet"]["title"], "stats": it.get("statistics", {})}


def upload(video: Path, title: str, description: str, tags: list[str], cfg: dict,
           publish_at: str | None = None, thumbnail: Path | None = None,
           progress: Callable[[float], None] | None = None) -> str:
    from googleapiclient.http import MediaFileUpload

    ucfg = cfg["upload"]
    yt = _service()
    status = {"privacyStatus": ucfg["privacy"], "selfDeclaredMadeForKids": bool(ucfg["made_for_kids"])}
    if publish_at:
        status.update({"privacyStatus": "private", "publishAt": publish_at})
    yt_lang = "en" if lang_utils.is_english(cfg.get("resolved_language") or cfg["channel"].get("language")) else "pt-BR"
    body = {
        "snippet": {"title": title[:100], "description": description[:5000], "tags": tags,
                    "categoryId": str(ucfg["category_id"]), "defaultLanguage": yt_lang,
                    "defaultAudioLanguage": yt_lang},
        "status": status,
    }
    media = MediaFileUpload(str(video), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True)
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    resp = None
    while resp is None:
        st, resp = req.next_chunk()
        if st and progress:
            progress(st.progress())
    vid = resp["id"]
    if thumbnail and Path(thumbnail).exists():
        try:
            yt.thumbnails().set(videoId=vid, media_body=MediaFileUpload(str(thumbnail), mimetype="image/jpeg")).execute()
        except Exception as e:  # noqa: BLE001  (canal precisa estar verificado p/ thumbnails personalizadas)
            log.warning("Thumbnail não aplicada: %s", e)
    return vid


# ----------------------------------------------------------------- agendamento
def next_slot(taken_iso: list[str], cfg: dict, min_lead_minutes: int = 20) -> str:
    """Próximo horário livre (UTC ISO) respeitando slots e max_per_day no fuso do canal."""
    ucfg = cfg["upload"]
    tz = ZoneInfo(ucfg["timezone"])
    taken = set()
    per_day: dict[str, int] = {}
    for iso in taken_iso:
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tz)
        except ValueError:
            continue
        taken.add(dt.strftime("%Y-%m-%d %H:%M"))
        per_day[dt.strftime("%Y-%m-%d")] = per_day.get(dt.strftime("%Y-%m-%d"), 0) + 1
    now = datetime.now(tz) + timedelta(minutes=min_lead_minutes)
    for day in range(0, 60):
        d = (now + timedelta(days=day)).date()
        key = d.strftime("%Y-%m-%d")
        if per_day.get(key, 0) >= ucfg["max_per_day"]:
            continue
        for s in sorted(ucfg["slots"]):
            hh, mm = map(int, s.split(":"))
            dt = datetime(d.year, d.month, d.day, hh, mm, tzinfo=tz)
            if dt < now or dt.strftime("%Y-%m-%d %H:%M") in taken:
                continue
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    raise RuntimeError("Sem horários livres nos próximos 60 dias")
