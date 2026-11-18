"""Teste ponta-a-ponta do pipeline (modo heurístico, whisper tiny) com o vídeo sintético."""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from clipsreal.config import CFG  # noqa: E402

CFG["transcription"]["model"] = sys.argv[2] if len(sys.argv) > 2 else "tiny"
CFG["clips"]["target_count"] = 3
CFG["clips"]["min_score"] = 0

from clipsreal import db, pipeline  # noqa: E402

src = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "data" / "test" / "test.mp4")
t0 = time.time()
jid = db.create_job(src, options={"mode": "blur"})
pipeline.process_job(jid)
job = db.get_job(jid)
print("JOB", jid, job["status"], job["message"], f"{time.time() - t0:.1f}s")
for c in db.list_clips(jid):
    print(c["id"], c["status"], c["score"], c["breakdown"], c["start"], c["end"], c["title"], c["file_path"], c["error"])
