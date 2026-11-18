"""Monitor de fontes (RSS do YouTube): novos vídeos entram automaticamente na fila de clipagem."""
from __future__ import annotations

import logging
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET

from . import db, pipeline
from .config import CFG

log = logging.getLogger("clipsreal.monitor")
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
_thread: threading.Thread | None = None
_stop = threading.Event()


def fetch_feed(channel_id: str) -> list[dict]:
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ClipsReal/1.0"}), timeout=20) as r:
        root = ET.fromstring(r.read())
    out = []
    for e in root.findall("a:entry", NS):
        vid = e.findtext("yt:videoId", namespaces=NS)
        out.append({"id": vid, "title": e.findtext("a:title", namespaces=NS),
                    "url": f"https://www.youtube.com/watch?v={vid}"})
    return out


def check_once() -> list[int]:
    created = []
    for src in CFG["monitor"].get("sources") or []:
        cid = src.get("channel_id")
        if not cid:
            continue
        try:
            entries = fetch_feed(cid)
        except Exception as e:  # noqa: BLE001
            log.warning("Feed %s falhou: %s", cid, e)
            continue
        first_run = not db.query("SELECT 1 FROM seen_videos WHERE source=? LIMIT 1", (cid,))
        for ent in entries:
            if db.seen(ent["id"]):
                continue
            db.mark_seen(ent["id"], cid)
            if first_run:      # na 1ª execução só memoriza o histórico, não processa vídeos antigos
                continue
            jid = pipeline.enqueue_job(ent["url"], {"auto_upload": bool(CFG["monitor"].get("auto_upload")),
                                                    "from_monitor": src.get("name", cid)})
            created.append(jid)
            log.info("Novo vídeo de %s -> job %s", src.get("name"), jid)
    return created


def _loop():
    while not _stop.is_set():
        try:
            check_once()
        except Exception as e:  # noqa: BLE001
            log.error("Monitor: %s", e)
        _stop.wait(max(5, int(CFG["monitor"].get("interval_minutes", 30))) * 60)


def start() -> bool:
    global _thread
    if not CFG["monitor"].get("sources"):
        return False
    if _thread and _thread.is_alive():
        return True
    _stop.clear()
    _thread = threading.Thread(target=_loop, daemon=True, name="monitor")
    _thread.start()
    return True


def running() -> bool:
    return bool(_thread and _thread.is_alive())
