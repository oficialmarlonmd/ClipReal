"""Instagram Reels API (Meta Graph / Instagram Login): OAuth, token e Resumable Upload local."""
from __future__ import annotations

import json
import logging
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

import httpx

from .config import DATA, instagram_app_id, instagram_app_secret, instagram_redirect_uri

log = logging.getLogger("clipsreal.instagram")
TOKEN = DATA / "instagram_token.json"
DEFAULT_API_VERSION = "v21.0"

_lock = threading.Lock()
_pending_oauth: dict[str, tuple[str, str, float]] = {}  # state -> (login_type, redirect_uri, created_at)


def _load_token() -> dict[str, Any] | None:
    if not TOKEN.is_file():
        return None
    try:
        data = json.loads(TOKEN.read_text(encoding="utf-8"))
        return data if data.get("access_token") and data.get("ig_user_id") else None
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
        "ig_user_id": str(tok.get("ig_user_id") or ""),
        "username": str(tok.get("username") or ""),
        "api_type": str(tok.get("api_type") or "instagram"),
        "expires_at": tok.get("expires_at"),
    }


def _graph_host(api_type: str, api_version: str = DEFAULT_API_VERSION) -> str:
    host = "graph.facebook.com" if api_type == "facebook" else "graph.instagram.com"
    return f"https://{host}/{api_version}"


def _api_error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                code = err.get("code")
                sub = err.get("error_subcode")
                msg = err.get("error_user_msg") or err.get("message") or resp.text
                return f"[{code}/{sub}] {msg}" if code else str(msg)
            if "error_message" in body:
                return str(body["error_message"])
    except Exception:  # noqa: BLE001
        pass
    return resp.text or resp.reason_phrase


def friendly_error(exc: Exception) -> str:
    raw = str(exc)
    low = raw.lower()
    if "190" in raw or "oauthexception" in low or "access token" in low and ("expired" in low or "invalid" in low):
        return (
            "Token do Instagram expirado ou inválido. Reconecte sua conta em "
            "Chaves & API → Redes Sociais (OAuth ou novo Token)."
        )
    if "instagram_content_publish" in low or "instagram_business_content_publish" in low or "[10/" in raw or "[200/" in raw:
        return (
            "Permissão de publicação negada pela Meta. Verifique se a conta é Profissional "
            "(Business/Creator) e se possui a permissão instagram_business_content_publish / instagram_content_publish."
        )
    if "2207" in raw or "aspect ratio" in low or "media_type" in low:
        return f"Instagram rejeitou o formato do vídeo: {raw}"
    return f"Instagram: {raw}"


def _prune_pending() -> None:
    cutoff = time.time() - 900
    for k in [k for k, v in _pending_oauth.items() if v[2] < cutoff]:
        _pending_oauth.pop(k, None)


def start_oauth(login_type: str = "instagram", redirect_uri: str | None = None) -> str:
    app_id = instagram_app_id()
    app_secret = instagram_app_secret()
    if not app_id or not app_secret:
        raise RuntimeError(
            "Preencha INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET em Chaves & API → Redes Sociais "
            "(ou use conexão rápida via Access Token)."
        )
    redir = (redirect_uri or instagram_redirect_uri()).strip()
    ltype = "facebook" if str(login_type).lower() == "facebook" else "instagram"
    state = secrets.token_urlsafe(24)
    with _lock:
        _prune_pending()
        _pending_oauth[state] = (ltype, redir, time.time())

    if ltype == "facebook":
        qs = urlencode({
            "client_id": app_id,
            "redirect_uri": redir,
            "response_type": "code",
            "state": state,
            "scope": "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement",
        })
        return f"https://www.facebook.com/{DEFAULT_API_VERSION}/dialog/oauth?{qs}"

    qs = urlencode({
        "enable_fb_login": "0",
        "force_authentication": "1",
        "client_id": app_id,
        "redirect_uri": redir,
        "response_type": "code",
        "state": state,
        "scope": "instagram_business_basic,instagram_business_content_publish",
    })
    return f"https://www.instagram.com/oauth/authorize?{qs}"


def _discover_account(client: httpx.Client, token: str, api_type: str, ig_user_id: str = "") -> tuple[str, str, str]:
    """Resolve (api_type, ig_user_id, username) validando o token na Meta API."""
    candidates = ["instagram", "facebook"] if api_type == "auto" else [api_type]
    if api_type == "auto" and token.startswith("EA"):
        candidates = ["facebook", "instagram"]

    last_err = "Não foi possível validar o token na Meta API."
    for kind in candidates:
        base = _graph_host(kind)
        if kind == "instagram":
            r = client.get(f"{base}/me", params={"fields": "user_id,id,username", "access_token": token})
            if r.is_success:
                d = r.json()
                uid = str(ig_user_id or d.get("user_id") or d.get("id") or "").strip()
                uname = str(d.get("username") or "").strip()
                if uid:
                    return "instagram", uid, uname
            last_err = _api_error_detail(r)
        else:
            if ig_user_id:
                r = client.get(f"{base}/{ig_user_id}", params={"fields": "id,username", "access_token": token})
                if r.is_success:
                    d = r.json()
                    return "facebook", str(d.get("id") or ig_user_id), str(d.get("username") or "")
                last_err = _api_error_detail(r)
            else:
                r = client.get(
                    f"{base}/me/accounts",
                    params={"fields": "id,name,instagram_business_account{id,username}", "access_token": token},
                )
                if r.is_success:
                    for page in r.json().get("data") or []:
                        ig_acc = page.get("instagram_business_account")
                        if isinstance(ig_acc, dict) and ig_acc.get("id"):
                            return "facebook", str(ig_acc["id"]), str(ig_acc.get("username") or page.get("name") or "")
                    last_err = (
                        "Token Facebook válido, mas nenhuma Página vinculada a um Instagram Profissional/Business "
                        "foi encontrada. Informe o IG User ID manualmente ou vincule a Página no Meta Business."
                    )
                else:
                    last_err = _api_error_detail(r)
    raise RuntimeError(last_err)


def finish_oauth(code: str, state: str) -> dict[str, Any]:
    with _lock:
        entry = _pending_oauth.pop(state, None)
    if not entry:
        raise RuntimeError("Sessão OAuth do Instagram expirada ou inválida. Tente conectar novamente.")
    ltype, redir, _ = entry
    app_id = instagram_app_id()
    app_secret = instagram_app_secret()

    with httpx.Client(timeout=30.0) as client:
        if ltype == "facebook":
            r = client.get(
                f"https://graph.facebook.com/{DEFAULT_API_VERSION}/oauth/access_token",
                params={"client_id": app_id, "client_secret": app_secret, "redirect_uri": redir, "code": code},
            )
            if not r.is_success:
                raise RuntimeError(_api_error_detail(r))
            short_tok = r.json()["access_token"]
            rl = client.get(
                f"https://graph.facebook.com/{DEFAULT_API_VERSION}/oauth/access_token",
                params={
                    "grant_type": "fb_exchange_token",
                    "client_id": app_id,
                    "client_secret": app_secret,
                    "fb_exchange_token": short_tok,
                },
            )
            tok_data = rl.json() if rl.is_success else r.json()
            token = tok_data["access_token"]
            expires_in = int(tok_data.get("expires_in") or 5184000)
            uid_seed = ""
        else:
            r = client.post(
                "https://api.instagram.com/oauth/access_token",
                data={
                    "client_id": app_id,
                    "client_secret": app_secret,
                    "grant_type": "authorization_code",
                    "redirect_uri": redir,
                    "code": code,
                },
            )
            if not r.is_success:
                raise RuntimeError(_api_error_detail(r))
            d_short = r.json()
            short_tok = d_short["access_token"]
            uid_seed = str(d_short.get("user_id") or "")
            rl = client.get(
                "https://graph.instagram.com/access_token",
                params={"grant_type": "ig_exchange_token", "client_secret": app_secret, "access_token": short_tok},
            )
            tok_data = rl.json() if rl.is_success else d_short
            token = tok_data["access_token"]
            expires_in = int(tok_data.get("expires_in") or 5184000)

        api_type, ig_user_id, username = _discover_account(client, token, ltype, uid_seed)

    payload = {
        "access_token": token,
        "ig_user_id": ig_user_id,
        "username": username,
        "api_type": api_type,
        "expires_at": int(time.time() + expires_in),
    }
    _save_token(payload)
    return connected_summary()


def save_broker_token(token_bundle: dict[str, Any]) -> dict[str, Any]:
    """Persiste token obtido via OAuth Broker (1 clique) e retorna resumo da conta."""
    token = str(token_bundle.get("access_token") or "").strip()
    if not token:
        raise ValueError("Access Token do Instagram ausente na resposta do OAuth Broker.")
    ig_user_id = str(token_bundle.get("ig_user_id") or "").strip()
    username = str(token_bundle.get("username") or "").strip()
    api_type = str(token_bundle.get("api_type") or "auto").strip() or "auto"
    if not ig_user_id:
        with httpx.Client(timeout=30.0) as client:
            api_type, ig_user_id, discovered_name = _discover_account(client, token, api_type=api_type)
            username = username or discovered_name
    exp_in = token_bundle.get("expires_in")
    expires_at = token_bundle.get("expires_at") or (int(time.time() + int(exp_in)) if exp_in else None)
    _save_token({
        "auth_mode": "broker",
        "access_token": token,
        "ig_user_id": ig_user_id,
        "username": username,
        "api_type": api_type,
        "expires_at": expires_at,
    })
    return connected_summary()


def connect_manual(access_token: str, ig_user_id: str = "", api_type: str = "auto") -> dict[str, Any]:
    token = access_token.strip()
    if not token:
        raise ValueError("Cole o Access Token do Instagram.")
    with httpx.Client(timeout=30.0) as client:
        resolved_type, resolved_uid, username = _discover_account(
            client, token, api_type=api_type.strip().lower() or "auto", ig_user_id=ig_user_id.strip()
        )
    payload = {
        "access_token": token,
        "ig_user_id": resolved_uid,
        "username": username,
        "api_type": resolved_type,
        "expires_at": None,
    }
    _save_token(payload)
    return connected_summary()


def ensure_valid_token() -> dict[str, Any]:
    tok = _load_token()
    if not tok:
        raise RuntimeError("Instagram não conectado. Conecte em Chaves & API → Redes Sociais.")
    exp = tok.get("expires_at")
    if tok.get("api_type") == "instagram" and exp and time.time() > float(exp) - 7 * 86400:
        try:
            with httpx.Client(timeout=20.0) as client:
                r = client.get(
                    "https://graph.instagram.com/refresh_access_token",
                    params={"grant_type": "ig_refresh_token", "access_token": tok["access_token"]},
                )
                if r.is_success:
                    d = r.json()
                    tok["access_token"] = d.get("access_token") or tok["access_token"]
                    tok["expires_at"] = int(time.time() + int(d.get("expires_in") or 5184000))
                    _save_token(tok)
        except Exception as e:  # noqa: BLE001
            log.warning("Falha ao renovar token do Instagram: %s", e)
    return tok


def _stream_file(path: Path, chunk_size: int = 1024 * 1024):
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk


def upload_reel(
    video: Path,
    caption: str,
    cfg: dict,
    share_to_feed: bool | None = None,
    progress: Callable[[float], None] | None = None,
) -> dict[str, str]:
    """Envia MP4 vertical local como Reel via Meta Resumable Upload e publica."""
    tok = ensure_valid_token()
    ig_cfg = cfg.get("instagram") or {}
    api_version = str(ig_cfg.get("api_version") or DEFAULT_API_VERSION)
    api_type = str(tok.get("api_type") or "instagram")
    base = _graph_host(api_type, api_version)
    ig_user_id = tok["ig_user_id"]
    token = tok["access_token"]
    share = ig_cfg.get("share_to_feed", True) if share_to_feed is None else bool(share_to_feed)
    file_size = video.stat().st_size

    with httpx.Client(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
        if progress:
            progress(0.1)
        init_resp = client.post(
            f"{base}/{ig_user_id}/media",
            data={
                "media_type": "REELS",
                "upload_type": "resumable",
                "caption": caption[:2200],
                "share_to_feed": "true" if share else "false",
                "access_token": token,
            },
        )
        if not init_resp.is_success:
            raise RuntimeError(_api_error_detail(init_resp))
        init_data = init_resp.json()
        container_id = str(init_data["id"])
        upload_uri = str(init_data.get("uri") or f"https://rupload.facebook.com/ig-api-upload/{api_version}/{container_id}")

        if progress:
            progress(0.25)
        up_resp = client.post(
            upload_uri,
            headers={
                "Authorization": f"OAuth {token}",
                "offset": "0",
                "file_size": str(file_size),
                "Content-Type": "application/octet-stream",
            },
            content=_stream_file(video),
        )
        if not up_resp.is_success:
            raise RuntimeError(_api_error_detail(up_resp))

        if progress:
            progress(0.6)
        status_code = "IN_PROGRESS"
        for _ in range(60):
            st_resp = client.get(
                f"{base}/{container_id}",
                params={"fields": "status_code,status", "access_token": token},
            )
            if st_resp.is_success:
                st_data = st_resp.json()
                status_code = str(st_data.get("status_code") or "")
                if status_code == "FINISHED":
                    break
                if status_code in ("ERROR", "EXPIRED"):
                    raise RuntimeError(st_data.get("status") or f"Processamento falhou ({status_code})")
            time.sleep(3)
        else:
            raise RuntimeError("Tempo esgotado aguardando processamento do Reel no Instagram.")

        if progress:
            progress(0.85)
        pub_resp = client.post(
            f"{base}/{ig_user_id}/media_publish",
            data={"creation_id": container_id, "access_token": token},
        )
        if not pub_resp.is_success:
            raise RuntimeError(_api_error_detail(pub_resp))
        media_id = str(pub_resp.json()["id"])

        permalink = ""
        try:
            perm_resp = client.get(
                f"{base}/{media_id}",
                params={"fields": "permalink", "access_token": token},
            )
            if perm_resp.is_success:
                permalink = str(perm_resp.json().get("permalink") or "")
        except Exception:  # noqa: BLE001
            pass

        if progress:
            progress(1.0)
        return {"id": media_id, "url": permalink}
