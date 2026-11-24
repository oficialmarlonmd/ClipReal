# ClipsReal OAuth Broker — Login 1 Clique para MVP

Este pequeno Cloudflare Worker permite que **qualquer amigo/usuário testando o ClipsReal MVP** clique em:
- **Entrar com Google (YouTube)**
- **Entrar com Instagram**
- **Entrar com TikTok**

**sem precisar criar projeto no Google Cloud Console, sem baixar `client_secret.json` e sem precisar de ngrok para HTTPS** (porque o Worker já roda em HTTPS e envia o token com segurança para o `localhost` de quem está usando).

Os segredos dos seus apps (`GOOGLE_CLIENT_SECRET`, `INSTAGRAM_APP_SECRET`, `TIKTOK_CLIENT_SECRET`) ficam protegidos **somente no Cloudflare**, nunca no GitHub.

---

## Como subir em ~3 minutos (grátis)

1. Entre na pasta `oauth-broker` e faça login no Cloudflare (plano gratuito cobre 100.000 requisições/dia):
   ```bash
   cd oauth-broker
   npx wrangler login
   npx wrangler deploy
   ```
   Ao final, ele mostra sua URL HTTPS, por exemplo:
   `https://clipsreal-oauth-broker.seu-usuario.workers.dev`

2. Cadastre as variáveis secretas no Worker:
   ```bash
   npx wrangler secret put BROKER_STATE_SECRET   # gere uma frase/hash aleatório longo
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put INSTAGRAM_APP_ID
   npx wrangler secret put INSTAGRAM_APP_SECRET
   npx wrangler secret put TIKTOK_CLIENT_KEY
   npx wrangler secret put TIKTOK_CLIENT_SECRET
   ```
   *(Você só precisa cadastrar as redes que quiser habilitar — ex.: só Google e Instagram.)*

3. Nas configurações de cada portal de desenvolvedor, adicione a Redirect URI HTTPS do Worker:
   - **Google Cloud Console** (*Aplicativo da Web / Web application*):
     `https://SUA-URL.workers.dev/callback/youtube`
   - **Meta for Developers** (*Instagram → API setup with Instagram Login*):
     `https://SUA-URL.workers.dev/callback/instagram`
   - **TikTok for Developers** (*Login Kit / Web*):
     `https://SUA-URL.workers.dev/callback/tiktok`

4. No ClipsReal (em `config.yaml` em `auth.broker_url` ou `.env` em `OAUTH_BROKER_URL`), coloque:
   ```yaml
   auth:
     broker_url: https://SUA-URL.workers.dev
   ```
   Se você colocar essa URL pública no `config.yaml` do repositório (ela **não** contém segredos), todo mundo que clonar o projeto já abre o ClipsReal com **Entrar com Google / Instagram / TikTok** funcionando em 1 clique!

> **Importante sobre modo Teste (MVP):** enquanto seus apps no Google/Meta/TikTok ainda não passarem por revisão pública, adicione os e-mails/contas dos amigos testadores em **Usuários de teste** (Google Cloud), **Testadores do Instagram** (Meta Dashboard) e **Sandbox Users** (TikTok Portal).
