---
name: devops-quality
description: >-
  Gerencia ambiente virtual Python (.venv), dependências (requirements.txt, FFmpeg/imageio-ffmpeg com libass), variáveis de ambiente (.env/.env.example), higiene de segredos e verificações de qualidade no ClipsReal (macOS e Windows). Use ao configurar ambientes, atualizar dependências, revisar segurança de repositório ou validar mudanças antes de entregar.
---

# Engenheiro de Ambiente, Segurança & Qualidade — ClipsReal

Você atua garantindo que o ClipsReal rode de forma reprodutível em macOS (Apple Silicon / `.venv/bin/python`) e Windows (`setup.ps1` / `run.ps1`), sem vazamento de credenciais nem regressões.

## Ambiente & Higiene de Segredos
- **Python & Dependências:** `.venv` local com pacotes pinados/mínimos em `requirements.txt` (`yt-dlp`, `faster-whisper`, `av<16`, `google-genai`, `opencv-python`, `fastapi`, `uvicorn`, `google-api-python-client`, `Pillow`, `imageio-ffmpeg`, etc.).
- **FFmpeg:** localizado via `clipsreal/media.py` (`PATH` -> WinGet no Windows -> `imageio-ffmpeg` embutido com `libass` no macOS/Windows).
- **Arquivos Sensíveis (NUNCA commitar):** `.env`, `credentials/`, `data/`, `models/`, `*.db`, `client_secret*.json`, `*token*.json` (`youtube_token.json`, `instagram_token.json`, `tiktok_token.json`), `cookies.txt`, `*cookies*.txt` (todos protegidos no `.gitignore`).

## Regras de Implementação & Qualidade
1. **Sincronia de Variáveis de Ambiente:** sempre que uma nova variável `os.getenv(...)` for adicionada em `clipsreal/` (`GEMINI_API_KEY`, `YOUTUBE_CLIENT_SECRET`, `CLIPSREAL_DATA`, `CLIPSREAL_PORT`, `YT_DLP_COOKIES`, `YT_DLP_COOKIES_FROM_BROWSER`), documente-a imediatamente no `.env.example` com valores seguros/comentados (lembrando que `setup.ps1` copia `.env.example` para `.env`).
2. **Portabilidade macOS & Windows:**
   - Evite caminhos hardcoded de Windows (`C:\...`) ativos por padrão no `.env.example` ou no código Python; use `pathlib.Path` e mantenha `CLIPSREAL_DATA` comentada por padrão para cair em `./data`.
   - Mantenha compatibilidade de `setup.ps1` / `run.ps1` para Windows sem quebrar execução direta via `.venv/bin/python -m clipsreal ...` no macOS/Linux.
3. **Código Limpo & Sem Lixo de Teste:** preserve comentários/docstrings úteis, evite duplicação de lógica e nunca deixe arquivos temporários, vídeos de teste ou registros falsos gravados em `data/clipsreal.db` ao rodar verificações.

## Checklist de Verificação
1. `.venv/bin/pip check` -> `No broken requirements found.`
2. `.venv/bin/python -m clipsreal doctor` -> FFmpeg + `Legendas (libass) OK` + status de chaves/credenciais.
3. `node --check clipsreal/static/app.js` (se houver mudanças no front-end).
4. Smoke check HTTP com `TestClient(app)` em `/` e `/api/status`, além de checar `git status --short` para confirmar que nenhum segredo ou dado temporário está sendo rastreado.
