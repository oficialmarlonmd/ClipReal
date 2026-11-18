"""Verificação completa: pipeline Shorts (com gancho), reframe face, compilação 16:9, agendamento e API web."""
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from clipsreal.config import CFG  # noqa: E402

CFG["transcription"]["model"] = "tiny"
CFG["clips"]["target_count"] = 3
CFG["clips"]["min_score"] = 0

from clipsreal import db, media, pipeline, render, youtube  # noqa: E402

src = ROOT / "data" / "test" / "test.mp4"
assert src.is_file(), f"Falta vídeo de teste: {src}"

print("1) Testando pipeline Shorts (heurístico com gancho + legendas + thumbnail)...")
t0 = time.time()
jid = db.create_job(str(src), options={"mode": "blur"})
pipeline.process_job(jid)
job = db.get_job(jid)
assert job["status"] == "done", job
clips = db.list_clips(jid)
assert len(clips) == 3, f"Esperado 3 cortes, veio {len(clips)}"
for c in clips:
    assert c["status"] == "rendered", c
    assert Path(c["file_path"]).is_file(), c["file_path"]
    assert Path(c["thumb_path"]).is_file(), c["thumb_path"]
    assert c["hook"], "Hook vazio!"
    assert c["title"] and c["description"] and c["hashtags"] and c["tags"]
    info = media.probe(c["file_path"])
    assert info["width"] == 1080 and info["height"] == 1920, info
    print(f"   Short #{c['id']}: {c['score']} ({c['score_label']}) | hook={c['hook']!r} | title={c['title']!r}")
print(f"   OK em {time.time() - t0:.1f}s")

print("2) Testando reframe modo 'face' (OpenCV + FFmpeg)...")
face_dir = pipeline.job_dir(jid) / "face_test"
info_src = media.probe(src)
sig = json.loads((pipeline.job_dir(jid) / "signals.json").read_text(encoding="utf-8"))
old_mode = CFG["render"]["mode"]
CFG["render"]["mode"] = "face"
face_out = render.render_short(src, 2.0, 7.0, face_dir, info_src, CFG, sig["scenes"], ass_name=None,
                               out_name="face.mp4")
CFG["render"]["mode"] = old_mode
finfo = media.probe(face_out)
assert finfo["width"] == 1080 and finfo["height"] == 1920, finfo
print(f"   OK face.mp4 -> {finfo['width']}x{finfo['height']} ({finfo['duration']:.1f}s)")

print("3) Testando compilação vídeo longo 16:9 + capítulos + SEO + thumb 1280x720...")
t1 = time.time()
cid_list = [c["id"] for c in clips]
comp_jid = db.create_job(",".join(map(str, cid_list)), kind="compilation", options={"clip_ids": cid_list})
pipeline.process_compilation(comp_jid)
cjob = db.get_job(comp_jid)
assert cjob["status"] == "done", cjob
cclips = db.list_clips(comp_jid)
assert len(cclips) == 1 and cclips[0]["kind"] == "long", cclips
lc = cclips[0]
linfo = media.probe(lc["file_path"])
assert linfo["width"] == 1920 and linfo["height"] == 1080, linfo
assert "00:00" in lc["description"], lc["description"]
assert len(lc["tags"]) >= 10, lc["tags"]
from PIL import Image  # noqa: E402
im = Image.open(lc["thumb_path"])
assert im.size == (1280, 720), im.size
print(f"   OK long.mp4 -> {linfo['width']}x{linfo['height']} ({linfo['duration']:.1f}s), "
      f"{len(lc['tags'])} tags, thumb={im.size}, title={lc['title']!r} em {time.time() - t1:.1f}s")

print("4) Testando extração de frame do Short renderizado com Hook + Legenda...")
media.extract_frame(clips[0]["file_path"], 4.0, ROOT / "data" / "test" / "preview_hook.jpg")
print("   OK preview_hook.jpg")

print("5) Testando agendamento next_slot (fuso BRT + max_per_day)...")
taken = []
for _ in range(10):
    slot = youtube.next_slot(taken, CFG, min_lead_minutes=1)
    assert slot.endswith("Z") and slot not in taken
    taken.append(slot)
print(f"   OK 10 slots gerados sem colisão: {taken[0]} ... {taken[-1]}")

print("6) Testando API FastAPI...")
from fastapi.testclient import TestClient  # noqa: E402
from clipsreal.web import app  # noqa: E402

with TestClient(app) as client:
    assert client.get("/").status_code == 200
    st = client.get("/api/status").json()
    assert st["ffmpeg"] and st["subtitles"] is True, st
    cfg_r = client.get("/api/config").json()
    assert cfg_r["channel"]["handle"] == "@BabyDragonOFC"
    jb = client.get(f"/api/jobs/{jid}").json()
    assert len(jb["clips"]) == 3
    p = client.patch(f"/api/clips/{clips[0]['id']}", json={"title": "Título Editado Teste GTA 6"}).json()
    assert p["title"] == "Título Editado Teste GTA 6"
    assert "Título Editado Teste GTA 6" in (Path(clips[0]["file_path"]).parent / "metadata.txt").read_text(encoding="utf-8")
    rg = client.post(f"/api/clips/{clips[0]['id']}/metadata").json()
    assert rg["title"]
print("   OK todas as rotas principais responderam corretamente!")
print("\nTUDO VERIFICADO COM SUCESSO!")
