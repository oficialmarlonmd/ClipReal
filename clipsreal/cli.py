"""CLI: python -m clipsreal <comando>"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time


def main(argv=None):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="clipsreal", description="Clipagem automática com IA para o canal GTA VI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="Abre o painel web")
    s.add_argument("--port", type=int, default=int(os.getenv("CLIPSREAL_PORT", 8000)))
    s.add_argument("--host", default="127.0.0.1")

    p = sub.add_parser("process", help="Processa um link/arquivo e gera os cortes")
    p.add_argument("source")
    p.add_argument("--count", type=int)
    p.add_argument("--mode", choices=["blur", "crop", "face", "fit"])
    p.add_argument("--min-score", type=float)
    p.add_argument("--upload", action="store_true", help="Agenda upload automático no YouTube")
    p.add_argument("--no-video", action="store_true", help="Não envia o vídeo ao Gemini (só transcrição)")

    c = sub.add_parser("compile", help="Gera vídeo longo 16:9 a partir dos melhores cortes de um job")
    c.add_argument("job_id", type=int)
    c.add_argument("--top", type=int, default=10)

    u = sub.add_parser("upload", help="Envia um corte ao YouTube")
    u.add_argument("clip_id", type=int)
    u.add_argument("--when", default="auto", help="auto | now | 2026-11-20T21:00:00Z")

    sub.add_parser("auth", help="Conecta sua conta do YouTube (OAuth)")
    sub.add_parser("monitor", help="Monitora fontes do config.yaml continuamente")
    sub.add_parser("doctor", help="Verifica dependências e configuração")

    a = ap.parse_args(argv)

    if a.cmd == "serve":
        import uvicorn
        print(f"\n  ClipsReal rodando em  http://localhost:{a.port}\n")
        uvicorn.run("clipsreal.web:app", host=a.host, port=a.port, log_level="info")
        return

    from . import db, pipeline

    if a.cmd == "doctor":
        from . import media, render, youtube
        from .config import gemini_key, youtube_client_secret
        from .llm import get_llm
        ok = True
        try:
            print("FFmpeg ........", media.ffmpeg_bin())
            print("Legendas (libass)", "OK" if render.subtitles_supported() else "AUSENTE")
        except Exception as e:  # noqa: BLE001
            ok = False
            print("FFmpeg ........ ERRO", e)
        print("Gemini key ....", "OK" if gemini_key() else "FALTANDO (.env GEMINI_API_KEY) — modo heurístico")
        if gemini_key():
            try:
                print("Gemini modelo .", get_llm().model)
            except Exception as e:  # noqa: BLE001
                print("Gemini modelo . ERRO", e)
        print("client_secret .", "OK" if youtube_client_secret().exists() else f"FALTANDO ({youtube_client_secret()})")
        print("YouTube token .", "OK" if youtube.is_authenticated() else "não autenticado (rode: auth)")
        sys.exit(0 if ok else 1)

    if a.cmd == "auth":
        from . import youtube
        print("Abrindo navegador para autorizar o canal...")
        print(youtube.authenticate())
        return

    if a.cmd == "process":
        opts = {"count": a.count, "mode": a.mode, "min_score": a.min_score, "auto_upload": a.upload}
        if a.no_video:
            opts["use_video"] = False
        jid = db.create_job(a.source, options={k: v for k, v in opts.items() if v is not None})
        pipeline.process_job(jid)
        job = db.get_job(jid)
        print(f"\nJob {jid}: {job['status']} — {job['message']}")
        for cl in db.list_clips(jid):
            print(f"  #{cl['id']:>4}  score {cl['score']:>5}  {cl['score_label']:<8} "
                  f"{cl['start']:.1f}-{cl['end']:.1f}s  {cl['title']}\n         {cl['file_path']}")
        if a.upload:
            for cl in db.list_clips(jid):
                if cl["status"] == "rendered":
                    pipeline.upload_clip(cl["id"], "auto")
                    print("  agendado:", db.get_clip(cl["id"])["publish_at"])
        return

    if a.cmd == "compile":
        clips = [c for c in db.list_clips(a.job_id) if c["status"] in ("rendered", "uploaded", "scheduled")][: a.top]
        jid = db.create_job(",".join(str(c["id"]) for c in clips), kind="compilation",
                            options={"clip_ids": [c["id"] for c in clips]})
        pipeline.process_compilation(jid)
        print(db.get_job(jid))
        return

    if a.cmd == "upload":
        pipeline.upload_clip(a.clip_id, a.when)
        print(db.get_clip(a.clip_id))
        return

    if a.cmd == "monitor":
        from . import monitor
        print("Monitorando fontes... (Ctrl+C para sair)")
        while True:
            monitor.check_once()
            time.sleep(60)


if __name__ == "__main__":
    main()
