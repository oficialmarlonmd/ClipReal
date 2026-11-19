"""Cliente Gemini (google-genai): seleção automática de modelo, JSON estruturado e upload de vídeo."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from .config import CFG, gemini_key

FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash"]


class LLMUnavailable(RuntimeError):
    pass


class GeminiLLM:
    def __init__(self):
        self.key = gemini_key()
        self._client = None
        self._model: str | None = None
        self._candidates: list[str] = []

    @property
    def available(self) -> bool:
        return bool(self.key)

    @property
    def client(self):
        if not self.key:
            raise LLMUnavailable("GEMINI_API_KEY não configurada no .env")
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=self.key)
        return self._client

    # ------------------------------------------------------------------ modelo
    def _rank_models(self) -> list[str]:
        names = []
        try:
            for m in self.client.models.list():
                name = (m.name or "").replace("models/", "")
                actions = getattr(m, "supported_actions", None) or []
                if actions and "generateContent" not in actions:
                    continue
                low = name.lower()
                if "flash" not in low or not low.startswith("gemini"):
                    continue
                if any(x in low for x in ("image", "tts", "live", "audio", "embedding", "thinking", "8b")):
                    continue
                names.append(name)
        except Exception:
            return list(FALLBACK_MODELS)

        def key(n: str):
            v = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
            ver = float(v[1]) if v else 0
            full_flash = 0 if "lite" in n else 1
            stable = 0 if any(x in n for x in ("preview", "exp")) else 1
            latest_alias = 1 if n.endswith("-latest") else 0
            return (full_flash, ver, stable, -latest_alias, -len(n))

        names.sort(key=key, reverse=True)
        return names + [m for m in FALLBACK_MODELS if m not in names]

    @property
    def model(self) -> str:
        if self._model:
            return self._model
        conf = CFG["llm"].get("model", "auto")
        if conf and conf != "auto":
            self._model = conf
            self._candidates = [conf] + FALLBACK_MODELS
        else:
            self._candidates = self._rank_models()
            self._model = self._candidates[0]
        return self._model

    # ------------------------------------------------------------------ chamadas
    def generate_json(self, prompt: str, files: list | None = None, temperature: float = 0.6,
                      retries: int = 4):
        from google.genai import types

        contents = [*(files or []), prompt]
        last_err = None
        _ = self.model
        tried = set()
        for attempt in range(max(retries, len(self._candidates) + 1)):
            model = self._model
            try:
                resp = self.client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        temperature=temperature,
                        response_mime_type="application/json",
                        http_options=types.HttpOptions(
                            timeout=120000 if files else 60000,
                            retry_options=types.HttpRetryOptions(attempts=1),
                        ),
                    ),
                )
                return parse_json(resp.text or "")
            except Exception as e:  # noqa: BLE001
                last_err = e
                msg = f"{type(e).__name__}: {e}".lower()
                transient = ("429", "resource_exhausted", "503", "unavailable", "500", "deadline",
                             "timeout", "timed out")
                if any(x in msg for x in ("not found", "404", "not supported", *transient)) and self._candidates:
                    if any(x in msg for x in ("not found", "404", "not supported")):
                        self._candidates = [c for c in self._candidates if c != model]
                    else:
                        tried.add(model)
                    nxt = [c for c in self._candidates if c not in tried]
                    if nxt:
                        self._model = nxt[0]
                        continue
                    if self._candidates and any(x in msg for x in transient):
                        tried.clear()
                        self._model = self._candidates[0]
                        time.sleep(min(30, 3 * 2 ** min(attempt, 3)))
                        continue
                if isinstance(e, json.JSONDecodeError) or "json" in msg:
                    continue
                raise
        raise RuntimeError(f"Falha no Gemini após {retries} tentativas: {last_err}")

    def upload_video(self, path: Path, timeout: int = 900):
        f = self.client.files.upload(file=str(path))
        t0 = time.time()
        while getattr(f.state, "name", str(f.state)) == "PROCESSING":
            if time.time() - t0 > timeout:
                raise TimeoutError("Gemini demorou demais para processar o vídeo")
            time.sleep(5)
            f = self.client.files.get(name=f.name)
        if getattr(f.state, "name", str(f.state)) == "FAILED":
            raise RuntimeError("Gemini falhou ao processar o vídeo")
        return f

    def delete_file(self, f) -> None:
        try:
            self.client.files.delete(name=f.name)
        except Exception:
            pass


def parse_json(text: str):
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.S)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"(\{.*\}|\[.*\])", t, flags=re.S)
        if m:
            return json.loads(m.group(1))
        raise


_llm: GeminiLLM | None = None


def get_llm() -> GeminiLLM:
    global _llm
    if _llm is None or _llm.key != gemini_key():
        _llm = GeminiLLM()
    return _llm
