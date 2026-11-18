"""Persistência SQLite (jobs, clips, uploads, fontes monitoradas)."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any

from .config import DATA

_DB_PATH = DATA / "clipsreal.db"
_lock = threading.RLock()
_conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT DEFAULT 'clip',            -- clip | compilation
    source TEXT,
    title TEXT,
    status TEXT DEFAULT 'queued',        -- queued | running | done | error
    stage TEXT DEFAULT '',
    progress REAL DEFAULT 0,
    message TEXT DEFAULT '',
    video_path TEXT,
    duration REAL,
    options TEXT DEFAULT '{}',
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    kind TEXT DEFAULT 'short',           -- short | long
    idx INTEGER,
    start REAL,
    end REAL,
    score REAL,
    score_label TEXT,
    breakdown TEXT DEFAULT '{}',
    hook TEXT,
    reason TEXT,
    category TEXT,
    transcript TEXT,
    title TEXT,
    description TEXT,
    hashtags TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    file_path TEXT,
    thumb_path TEXT,
    status TEXT DEFAULT 'pending',       -- pending | rendered | uploading | scheduled | uploaded | error
    youtube_id TEXT,
    publish_at TEXT,
    error TEXT,
    created_at REAL
);
CREATE TABLE IF NOT EXISTS seen_videos (
    video_id TEXT PRIMARY KEY,
    source TEXT,
    created_at REAL
);
"""

with _lock:
    _conn.executescript(SCHEMA)
    _conn.commit()

JSON_FIELDS = {"breakdown", "hashtags", "tags", "options"}


def _row(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    for k in JSON_FIELDS:
        if k in d and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except Exception:
                pass
    return d


def _enc(fields: dict) -> dict:
    out = {}
    for k, v in fields.items():
        out[k] = json.dumps(v, ensure_ascii=False) if k in JSON_FIELDS and not isinstance(v, str) else v
    return out


def execute(sql: str, params: tuple | list = ()) -> int:
    with _lock:
        cur = _conn.execute(sql, params)
        _conn.commit()
        return cur.lastrowid


def query(sql: str, params: tuple | list = ()) -> list[dict]:
    with _lock:
        return [_row(r) for r in _conn.execute(sql, params).fetchall()]


# ---------------- jobs ----------------
def create_job(source: str, kind: str = "clip", options: dict | None = None, title: str = "") -> int:
    now = time.time()
    return execute(
        "INSERT INTO jobs(kind, source, title, options, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        (kind, source, title or source, json.dumps(options or {}, ensure_ascii=False), now, now),
    )


def update_job(job_id: int, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = time.time()
    f = _enc(fields)
    sets = ", ".join(f"{k}=?" for k in f)
    execute(f"UPDATE jobs SET {sets} WHERE id=?", (*f.values(), job_id))


def get_job(job_id: int) -> dict | None:
    r = query("SELECT * FROM jobs WHERE id=?", (job_id,))
    return r[0] if r else None


def list_jobs(limit: int = 100) -> list[dict]:
    return query("SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,))


def delete_job(job_id: int) -> None:
    execute("DELETE FROM clips WHERE job_id=?", (job_id,))
    execute("DELETE FROM jobs WHERE id=?", (job_id,))


# ---------------- clips ----------------
def create_clip(job_id: int, **fields: Any) -> int:
    fields = _enc({"job_id": job_id, "created_at": time.time(), **fields})
    cols = ", ".join(fields)
    qs = ", ".join("?" for _ in fields)
    return execute(f"INSERT INTO clips({cols}) VALUES ({qs})", tuple(fields.values()))


def update_clip(clip_id: int, **fields: Any) -> None:
    if not fields:
        return
    f = _enc(fields)
    sets = ", ".join(f"{k}=?" for k in f)
    execute(f"UPDATE clips SET {sets} WHERE id=?", (*f.values(), clip_id))


def get_clip(clip_id: int) -> dict | None:
    r = query("SELECT * FROM clips WHERE id=?", (clip_id,))
    return r[0] if r else None


def list_clips(job_id: int | None = None) -> list[dict]:
    if job_id is None:
        return query("SELECT * FROM clips ORDER BY score DESC, id DESC")
    return query("SELECT * FROM clips WHERE job_id=? ORDER BY score DESC, idx", (job_id,))


def scheduled_publish_times() -> list[str]:
    rows = query("SELECT publish_at FROM clips WHERE publish_at IS NOT NULL AND publish_at != ''")
    return [r["publish_at"] for r in rows]


# ---------------- monitor ----------------
def seen(video_id: str) -> bool:
    return bool(query("SELECT 1 FROM seen_videos WHERE video_id=?", (video_id,)))


def mark_seen(video_id: str, source: str) -> None:
    execute("INSERT OR IGNORE INTO seen_videos(video_id, source, created_at) VALUES (?,?,?)",
            (video_id, source, time.time()))
