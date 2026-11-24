"""TikTok Content Posting API v2: OAuth2 + PKCE, refresh token e upload em chunks locais."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

import httpx

from .config import DATA, tiktok_client_key, tiktok_client_secret, tiktok_redirect_uri

log = logging.getLogger("clipsreal.tiktok")
TOKEN = DATA / "tiktok_token.json"
API_BASE = "https://open.tiktokapis.com"
SINGLE_CHUNK_MAX = 64 * 1024 * 1024
MULTI_CHUNK_SIZE = 10 * 1024 * 1024

_lock = threading.Lock()
_pending_oauth: dict[str, tuple[str, str, str, float]] = {}  # state -> (code_verifier, redirect_uri, post_mode, ts)


def _load_token() -> dict[str, Any] | None:
    if not TOKEN.is_file():
        return None
    try:
        data = json.loads(TOKEN.read_text(encoding="utf-8"))
        return data if data.get("access_token") else None
    except Exception:  # noqa: BLE001
        return None


def _save_token(data: dict[str, Any]) -> None:
    TOKEN.parent.mkdir(parents=True, exist_ok=True)
    TOKEN.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def is_authenticated() -> bool:
    return _load_token() is not None


def disconnect() -> None:
    if TOKEN.is_file():
        TOKEN.unlink()


def connected_summary() -> dict[str, Any]:
    tok = _load_token()
    if not tok:
        return {"connected": False}
    return {
        "connected": True,
        "open_id": str(tok.get("open_id") or ""),
        "username": str(tok.get("username") or ""),
        "display_name": str(tok.get("display_name") or ""),
        "scope": str(tok.get("scope") or ""),
        "expires_at": tok.get("expires_at"),
    }


def _api_error(resp: httpx.Response, payload: dict | None = None) -> str:
    data = payload
    if data is None:
        try:
            data = resp.json()
        except Exception:  # noqa: BLE001
            data = None
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict) and err.get("code") not in (None, "", "ok"):
            return f"[{err.get('code')}] {err.get('message') or resp.text}"
        if "error_description" in data or ("error" in data and isinstance(data["error"], str)):
            return f"[{data.get('error')}] {data.get('error_description') or resp.text}"
    return resp.text or resp.reason_phrase


def friendly_error(exc: Exception) -> str:
    raw = str(exc)
    low = raw.lower()
    if "unaudited_client_can_only_post_to_private_accounts" in low:
        return (
            "App TikTok ainda não auditado só pode publicar como Privado (SELF_ONLY) ou enviar para "
            "Rascunho/Inbox (video.upload). Altere o modo/privacidade em Redes Sociais."
        )
    if "scope_not_authorized" in low:
        return (
            "Escopo não autorizado no token TikTok (video.publish ou video.upload). "
            "Reconecte o TikTok ou alterne o modo de envio entre Direto e Inbox/Rascunho."
        )
    if "access_token_invalid" in low or "invalid_grant" in low:
        return "Token do TikTok inválido ou expirado. Reconecte sua conta em Chaves & API → Redes Sociais."
    if "spam_risk" in low or "rate_limit" in low:
        return f"Limite temporário de publicações atingido no TikTok: {raw}"
    return f"TikTok: {raw}"


def _prune_pending() -> None:
    cutoff = time.time() - 900
    for k in [k for k, v in _pending_oauth.items() if v[3] < cutoff]:
        _pending_oauth.pop(k, None)


def start_oauth(post_mode: str = "direct", redirect_uri: str | None = None) -> str:
    client_key = tiktok_client_key()
    client_secret = tiktok_client_secret()
    if not client_key or not client_secret:
        raise RuntimeError(
            "Preencha TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET em Chaves & API → Redes Sociais "
            "(ou use conexão rápida via Access Token)."
        )
    redir = (redirect_uri or tiktok_redirect_uri()).strip()
    mode = "inbox" if str(post_mode).lower() == "inbox" else "direct"
    scopes = "user.info.basic,video.upload" if mode == "inbox" else "user.info.basic,video.publish,video.upload"
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")

    with _lock:
        _prune_pending()
        _pending_oauth[state] = (verifier, redir, mode, time.time())

    qs = urlencode({
        "client_key": client_key,
        "scope": scopes,
        "response_type": "code",
        "redirect_uri": redir,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return f"https://www.tiktok.com/v2/auth/authorize/?{qs}"


def _fetch_user_profile(client: httpx.Client, token: str) -> dict[str, str]:
    r = client.get(
        f"{API_BASE}/v2/user/info/",
        params={"fields": "open_id,display_name,username"},
        headers={"Authorization": f"Bearer {token}"},
    )
    if not r.is_success:
        return {}
    data = r.json()
    user = (data.get("data") or {}).get("user") or {}
    return {
        "open_id": str(user.get("open_id") or ""),
        "display_name": str(user.get("display_name") or ""),
        "username": str(user.get("username") or ""),
    }


def finish_oauth(code: str, state: str) -> dict[str, Any]:
    with _lock:
        entry = _pending_oauth.pop(state, None)
    if not entry:
        raise RuntimeError("Sessão OAuth do TikTok expirada ou inválida. Tente conectar novamente.")
    verifier, redir, _mode, _ = entry
    ck = tiktok_client_key()
    cs = tiktok_client_secret()

    with httpx.Client(timeout=30.0) as client:
        r = client.post(
            f"{API_BASE}/v2/oauth/token/",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "client_key": ck,
                "client_secret": cs,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redir,
                "code_verifier": verifier,
            },
        )
        d = r.json()
        if not r.is_success or "access_token" not in d:
            raise RuntimeError(_api_error(r, d))

        profile = _fetch_user_profile(client, d["access_token"])
        now = time.time()
        tok = {
            "access_token": d["access_token"],
            "refresh_token": d.get("refresh_token") or "",
            "open_id": profile.get("open_id") or d.get("open_id") or "",
            "display_name": profile.get("display_name") or "",
            "username": profile.get("username") or "",
            "scope": d.get("scope") or "",
            "expires_at": int(now + int(d.get("expires_in") or 86400)),
            "refresh_expires_at": int(now + int(d.get("refresh_expires_in") or 31536000)),
        }
        _save_token(tok)
    return connected_summary()


def connect_manual(access_token: str, open_id: str = "", scope: str = "") -> dict[str, Any]:
    token = access_token.strip()
    if not token:
        raise ValueError("Cole o Access Token do TikTok.")
    with httpx.Client(timeout=30.0) as client:
        profile = _fetch_user_profile(client, token)
        if not profile and not open_id.strip():
            # Tenta validar via creator_info caso escopo user.info.basic não esteja incluído
            cr = client.post(
                f"{API_BASE}/v2/post/publish/creator_info/query/",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
                json={},
            )
            if not cr.is_success or (cr.json().get("error") or {}).get("code") not in (None, "ok"):
                raise RuntimeError(_api_error(cr))
            cuser = (cr.json().get("data") or {})
            profile = {
                "open_id": open_id.strip(),
                "username": str(cuser.get("creator_username") or ""),
                "display_name": str(cuser.get("creator_nickname") or ""),
            }
    tok = {
        "access_token": token,
        "refresh_token": "",
        "open_id": profile.get("open_id") or open_id.strip(),
        "display_name": profile.get("display_name") or "",
        "username": profile.get("username") or "",
        "scope": scope.strip() or "video.publish,video.upload",
        "expires_at": None,
    }
    _save_token(tok)
    return connected_summary()


def ensure_valid_token() -> dict[str, Any]:
    tok = _load_token()
    if not tok:
        raise RuntimeError("TikTok não conectado. Conecte em Chaves & API → Redes Sociais.")
    exp = tok.get("expires_at")
    if exp and time.time() > float(exp) - 120 and tok.get("refresh_token") and tiktok_client_key() and tiktok_client_secret():
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                f"{API_BASE}/v2/oauth/token/",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "client_key": tiktok_client_key(),
                    "client_secret": tiktok_client_secret(),
                    "grant_type": "refresh_token",
                    "refresh_token": tok["refresh_token"],
                },
            )
            d = r.json()
            if r.is_success and "access_token" in d:
                now = time.time()
                tok["access_token"] = d["access_token"]
                tok["refresh_token"] = d.get("refresh_token") or tok["refresh_token"]
                tok["scope"] = d.get("scope") or tok.get("scope") or ""
                tok["expires_at"] = int(now + int(d.get("expires_in") or 86400))
                _save_token(tok)
    return tok


def creator_info() -> dict[str, Any]:
    tok = ensure_valid_token()
    with httpx.Client(timeout=20.0) as client:
        r = client.post(
            f"{API_BASE}/v2/post/publish/creator_info/query/",
            headers={
                "Authorization": f"Bearer {tok['access_token']}",
                "Content-Type": "application/json; charset=UTF-8",
            },
            json={},
        )
        d = r.json()
        if not r.is_success or (d.get("error") or {}).get("code") not in (None, "ok"):
            raise RuntimeError(_api_error(r, d))
        return d.get("data") or {}


def chunk_plan(file_size: int) -> tuple[int, int]:
    """Calcula (chunk_size, total_chunk_count) segundo regras de 5MB-64MB do TikTok."""
    if file_size <= SINGLE_CHUNK_MAX:
        return file_size, 1
    total = max(1, file_size // MULTI_CHUNK_SIZE)
    return MULTI_CHUNK_SIZE, total


def upload_video(
    video: Path,
    title: str,
    cfg: dict,
    privacy_level: str | None = None,
    post_mode: str | None = None,
    progress: Callable[[float], None] | None = None,
) -> dict[str, str]:
    """Envia MP4 vertical local via TikTok Content Posting API v2 (Direct ou Inbox)."""
    tok = ensure_valid_token()
    token = tok["access_token"]
    tt_cfg = cfg.get("tiktok") or {}
    mode = str(post_mode or tt_cfg.get("post_mode") or "direct").strip().lower()
    granted = {s.strip() for s in str(tok.get("scope") or "").split(",") if s.strip()}
    if mode == "direct" and granted and "video.publish" not in granted and "video.upload" in granted:
        mode = "inbox"

    file_size = video.stat().st_size
    chunk_sz, total_chunks = chunk_plan(file_size)

    with httpx.Client(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=UTF-8",
        }
        chosen_privacy = str(privacy_level or tt_cfg.get("privacy_level") or "PUBLIC_TO_EVERYONE")

        if mode == "inbox":
            init_url = f"{API_BASE}/v2/post/publish/inbox/video/init/"
            body: dict[str, Any] = {
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": file_size,
                    "chunk_size": chunk_sz,
                    "total_chunk_count": total_chunks,
                }
            }
        else:
            # Consulta opcoes reais permitidas para o criador antes de publicar
            cr = client.post(f"{API_BASE}/v2/post/publish/creator_info/query/", headers=headers, json={})
            cr_data = cr.json() if cr.content else {}
            if cr.is_success and (cr_data.get("error") or {}).get("code") in (None, "ok"):
                opts = (cr_data.get("data") or {}).get("privacy_level_options") or []
                if opts and chosen_privacy not in opts:
                    chosen_privacy = "SELF_ONLY" if "SELF_ONLY" in opts else str(opts[0])
            init_url = f"{API_BASE}/v2/post/publish/video/init/"
            body = {
                "post_info": {
                    "title": title[:2200],
                    "privacy_level": chosen_privacy,
                    "disable_comment": bool(tt_cfg.get("disable_comment", False)),
                    "disable_duet": bool(tt_cfg.get("disable_duet", False)),
                    "disable_stitch": bool(tt_cfg.get("disable_stitch", False)),
                },
                "source_info": {
                    "source": "FILE_UPLOAD",
                    "video_size": file_size,
                    "chunk_size": chunk_sz,
                    "total_chunk_count": total_chunks,
                },
            }

        if progress:
            progress(0.1)
        init_resp = client.post(init_url, headers=headers, json=body)
        init_json = init_resp.json() if init_resp.content else {}
        if not init_resp.is_success or (init_json.get("error") or {}).get("code") not in (None, "ok"):
            raise RuntimeError(_api_error(init_resp, init_json))

        data = init_json.get("data") or {}
        publish_id = str(data["publish_id"])
        upload_url = str(data["upload_url"])

        with video.open("rb") as f:
            for idx in range(total_chunks):
                start_b = idx * chunk_sz
                read_len = (file_size - start_b) if idx == total_chunks - 1 else chunk_sz
                chunk_bytes = f.read(read_len)
                end_b = start_b + len(chunk_bytes) - 1
                put_resp = client.put(
                    upload_url,
                    headers={
                        "Content-Type": "video/mp4",
                        "Content-Length": str(len(chunk_bytes)),
                        "Content-Range": f"bytes {start_b}-{end_b}/{file_size}",
                    },
                    content=chunk_bytes,
                )
                if put_resp.status_code not in (200, 201, 206):
                    raise RuntimeError(_api_error(put_resp))
                if progress:
                    progress(0.2 + 0.55 * ((idx + 1) / total_chunks))

        final_status = "PROCESSING_UPLOAD"
        for _ in range(45):
            st_resp = client.post(
                f"{API_BASE}/v2/post/publish/status/fetch/",
                headers=headers,
                json={"publish_id": publish_id},
            )
            st_json = st_resp.json() if st_resp.content else {}
            if st_resp.is_success:
                st_data = st_json.get("data") or {}
                st_val = str(st_data.get("status") or "")
                if st_val == "PUBLISH_COMPLETE":
                    final_status = "published"
                    break
                if st_val == "SEND_TO_USER_INBOX":
                    final_status = "inbox"
                    break
                if st_val == "FAILED":
                    raise RuntimeError(st_data.get("fail_reason") or "Publicação rejeitada pelo TikTok.")
            time.sleep(3)
        else:
            final_status = "inbox" if mode == "inbox" else "published"

        if progress:
            progress(1.0)
        username = str(tok.get("username") or "").lstrip("@")
        profile_url = f"https://www.tiktok.com/@{username}" if username else ""
        return {
            "publish_id": publish_id,
            "status": final_status,
            "privacy_level": chosen_privacy if mode == "direct" else "INBOX",
            "url": profile_url,
        }
