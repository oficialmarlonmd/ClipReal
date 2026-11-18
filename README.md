# ClipsReal — Clipagem Automática com IA para GTA VI (`@BabyDragonOFC`)

Ferramenta própria e 100% local inspirada na engenharia reversa da plataforma Real Oficial, feita para transformar lives, VODs, trailers e gameplays de **GTA 6** em **YouTube Shorts (9:16)** e **Compilações Longas (16:9)** prontos para publicar — com legendas dinâmicas, título, descrição, hashtags, tags de vídeo longo, thumbnail e **Score de Viralização (0–100)**.

---

## Como colocar para funcionar AINDA HOJE (3 passos)

### Passo 1 — Tudo já está instalado neste ambiente
O ambiente virtual (`.venv`), as dependências (`yt-dlp`, `faster-whisper`, `google-genai`, `opencv-python`, `fastapi`, `uvicorn`, `google-api-python-client`, `Pillow`) e o **FFmpeg (`9.0.2` com `libass`)** já estão instalados e validados.

Para abrir o painel agora:
```powershell
.\run.ps1
```
O painel abre automaticamente em **http://localhost:8000**.

*(Se quiser reinstalar em outro PC Windows, basta rodar `.\setup.ps1`.)*

---

### Passo 2 — Ativar a Inteligência Artificial (grátis, ~1 minuto)
1. Acesse **[Google AI Studio](https://aistudio.google.com/apikey)** e gere sua `GEMINI_API_KEY` gratuita.
2. No painel do ClipsReal, clique em **⚙ Configurar** (canto superior direito), cole a chave no campo **GEMINI_API_KEY** e clique em **⚡ Testar IA**.
   - *Alternativa manual:* edite o arquivo `.env` e preencha `GEMINI_API_KEY=sua_chave_aqui`.
   - *Sem chave Gemini?* O ClipsReal continua funcionando normalmente em **modo heurístico** (análise de picos de áudio + corte de cena + transcrição Whisper + palavras-chave GTA 6), porém com o Gemini ligado ele assiste a um proxy leve do vídeo e escreve ganchos, títulos e SEO muito superiores.

---

### Passo 3 — Conectar seu canal do YouTube (`@BabyDragonOFC`) para Agendamento Automático
Para o ClipsReal enviar e agendar os vídeos direto no YouTube:
1. Acesse o **[Google Cloud Console](https://console.cloud.google.com/)**, crie um projeto (ex.: `ClipsReal`).
2. Em **APIs e Serviços → Biblioteca**, ative a **YouTube Data API v3**.
3. Em **Tela de permissão OAuth**:
   - Tipo: **Externo** (em modo *Teste*).
   - Adicione seu e-mail dono do canal `@BabyDragonOFC` em **Usuários de teste**.
4. Em **Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo de aplicativo: **App para computador (Desktop app)**.
   - Baixe o arquivo JSON (`client_secret_...json`).
5. No painel **⚙ Configurar** do ClipsReal, clique em **📄 Enviar client_secret.json** e depois em **🔗 Conectar canal** (ou salve em `credentials/client_secret.json` e rode `.\.venv\Scripts\python.exe -m clipsreal auth`).

> **Importante — Pasta OneDrive:** este projeto está dentro do `OneDrive`. Vídeos longos podem ocupar vários GB e sincronizar na nuvem. Para manter seus vídeos e banco fora do OneDrive, adicione no `.env`:
> `CLIPSREAL_DATA=C:\ClipsRealData`

---

## Como Usar

### Via Painel Web (`.\run.ps1` -> `http://localhost:8000`)
1. Cole um **link** (YouTube, Twitch, Kick, Google Drive) ou clique em **📁 Arquivo** para subir um MP4 local.
2. Escolha:
   - **Quantidade de cortes** (padrão `10`)
   - **Formato vertical:**
     - `Blur`: gameplay centralizado + fundo desfocado (melhor para GTA 6)
     - `Face`: rastreia automaticamente quem fala (ideal para reações/podcasts com facecam)
     - `Crop`: corte central 9:16
     - `Fit`: vídeo inteiro com barras pretas
   - **Score mínimo** (padrão `50`)
3. Clique em **⚡ Gerar cortes**. Cada corte sai com:
   - Vídeo `9:16` pronto com legendas karaokê + título-gancho + marca `@BabyDragonOFC`
   - **Score de Viralização (0–100)** + barras explicativas (`IA`, `Energia`, `Gancho 3s`, `Ritmo`, `Duração`, `Tendência`)
   - **Título, Descrição, Hashtags e Tags** editáveis + botões **💾 Salvar**, **✨ Regerar SEO**, **🎞 Re-renderizar**, **📋 Copiar**, **⬇ MP4**, **⬇ Capa** e **⬆ Agendar / Publicar já**.
4. **Vídeo Longo (16:9) Automático:** selecione 2 ou mais cortes e clique em **🎬 Gerar vídeo longo (selecionados)**. Ele monta o compilado 1080p abrindo pelo melhor gancho, gera capítulos `00:00`, thumbnail `1280×720` e 25–35 tags otimizadas.

### Via Linha de Comando (CLI)
```powershell
# Diagnóstico do ambiente
.\.venv\Scripts\python.exe -m clipsreal doctor

# Processar um vídeo e gerar cortes
.\.venv\Scripts\python.exe -m clipsreal process "https://www.youtube.com/watch?v=..." --count 10 --mode blur

# Processar e já agendar no YouTube
.\.venv\Scripts\python.exe -m clipsreal process "C:\Videos\live_gta6.mp4" --upload

# Montar compilação 16:9 com os 8 melhores cortes do job 1
.\.venv\Scripts\python.exe -m clipsreal compile 1 --top 8

# Monitoramento contínuo das fontes configuradas em config.yaml
.\.venv\Scripts\python.exe -m clipsreal monitor
```

---

## Documentação Técnica
Consulte o **[SDD.md](SDD.md)** para a engenharia reversa completa da Real Oficial, especificação matemática do Score de Viralização, arquitetura dos módulos e o plano estratégico de crescimento para buscar **50 milhões de views** no lançamento de GTA 6.
