/**
 * ClipsReal OAuth Broker (Cloudflare Worker, 100% stateless e gratuito)
 *
 * Permite que testadores do MVP cliquem em "Entrar com Google (YouTube)",
 * "Entrar com Instagram" e "Entrar com TikTok" em 1 clique direto no app local,
 * sem precisar baixar client_secret.json nem criar apps nos portais Meta/TikTok/Google.
 */

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(str) {
  const pad = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    textEnc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signState(payload, secret) {
  const body = b64url(textEnc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, textEnc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verifyState(token, secret) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw new Error("Estado OAuth inválido.");
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, unb64url(sig), textEnc.encode(body));
  if (!ok) throw new Error("Assinatura OAuth inválida.");
  const data = JSON.parse(textDec.decode(unb64url(body)));
  if (!data.exp || Date.now() > data.exp) throw new Error("Sessão OAuth expirada.");
  return data;
}

function isAllowedLocalCallback(urlStr) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/api\/oauth\/broker-callback$/.test(String(urlStr || ""));
}

async function derivePkce(secret, nonce) {
  const key = await hmacKey(secret);
  const raw = await crypto.subtle.sign("HMAC", key, textEnc.encode(`pkce:${nonce}`));
  const verifier = b64url(raw) + b64url(raw).slice(0, 16);
  const digest = await crypto.subtle.digest("SHA-256", textEnc.encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function handoffHtml({ provider, callback, clientState, tokenBundle, error }) {
  if (error) {
    return new Response(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<title>Erro OAuth · ClipsReal</title>
<style>body{background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}.box{max-width:440px;background:#121216;border:1px solid #27272a;border-radius:12px;padding:24px}h1{font-size:16px;color:#fb7185;margin:0 0 8px}p{font-size:13px;color:#a1a1aa;margin:0}</style>
</head><body><div class="box"><h1>Erro ao conectar</h1><p>${escapeHtml(error)}</p></div></body></html>`,
      { status: 400, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const targetOrigin = new URL(callback).origin;
  const payloadObj = {
    type: "clipsreal:broker_token",
    provider,
    client_state: clientState,
    token_bundle: tokenBundle,
  };
  const payloadJson = JSON.stringify(payloadObj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="dark">
<title>Conectando… · ClipsReal</title>
<style>body{background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}.box{max-width:440px;background:#121216;border:1px solid #27272a;border-radius:12px;padding:24px}h1{font-size:16px;color:#34d399;margin:0 0 8px}p{font-size:13px;color:#a1a1aa;margin:0 0 16px}button{background:#fafafa;color:#09090b;border:0;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}</style>
</head><body><div class="box">
<h1>Autorizado! Finalizando conexão…</h1>
<p>Enviando sessão de volta para o seu ClipsReal local.</p>
<form id="f" method="POST" action="${escapeHtml(callback)}">
  <input type="hidden" name="payload" value="${escapeHtml(JSON.stringify(payloadObj))}">
  <button type="submit">Concluir manualmente</button>
</form>
</div><script>
const p = ${payloadJson};
let sent = false;
try {
  if (window.opener) {
    window.opener.postMessage(p, ${JSON.stringify(targetOrigin)});
    sent = true;
    setTimeout(() => window.close(), 900);
  }
} catch (_) {}
if (!sent) {
  document.getElementById("f").submit();
}
</script></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    const workerOrigin = url.origin;
    const secret = env.BROKER_STATE_SECRET;

    if (path === "/health") {
      return Response.json({
        ok: true,
        providers: {
          youtube: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
          instagram: Boolean(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET),
          tiktok: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
        },
      });
    }

    if (!secret) {
      return Response.json({ error: "BROKER_STATE_SECRET não configurado no Worker." }, { status: 500 });
    }

    // ---- 1. START OAUTH
    if (req.method === "GET" && path.startsWith("/auth/")) {
      const provider = path.slice(6);
      const callback = url.searchParams.get("callback") || "";
      const clientState = url.searchParams.get("client_state") || "";
      const mode = url.searchParams.get("mode") || "";
      if (!isAllowedLocalCallback(callback) || !clientState) {
        return handoffHtml({ error: "Callback local ou client_state inválido." });
      }
      const nonce = crypto.randomUUID();
      const state = await signState({ provider, callback, clientState, mode, nonce, exp: Date.now() + 900_000 }, secret);

      if (provider === "youtube") {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
          return handoffHtml({ error: "GOOGLE_CLIENT_ID/SECRET não configurados no OAuth Broker." });
        }
        const qs = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          redirect_uri: `${workerOrigin}/callback/youtube`,
          response_type: "code",
          scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          state,
        });
        return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${qs}`, 302);
      }

      if (provider === "instagram") {
        if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
          return handoffHtml({ error: "INSTAGRAM_APP_ID/SECRET não configurados no OAuth Broker." });
        }
        if (mode === "facebook") {
          const qs = new URLSearchParams({
            client_id: env.INSTAGRAM_APP_ID,
            redirect_uri: `${workerOrigin}/callback/instagram`,
            response_type: "code",
            scope: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement",
            state,
          });
          return Response.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${qs}`, 302);
        }
        const qs = new URLSearchParams({
          enable_fb_login: "0",
          force_authentication: "1",
          client_id: env.INSTAGRAM_APP_ID,
          redirect_uri: `${workerOrigin}/callback/instagram`,
          response_type: "code",
          scope: "instagram_business_basic,instagram_business_content_publish",
          state,
        });
        return Response.redirect(`https://www.instagram.com/oauth/authorize?${qs}`, 302);
      }

      if (provider === "tiktok") {
        if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
          return handoffHtml({ error: "TIKTOK_CLIENT_KEY/SECRET não configurados no OAuth Broker." });
        }
        const { challenge } = await derivePkce(secret, nonce);
        const scopes = mode === "inbox" ? "user.info.basic,video.upload" : "user.info.basic,video.publish,video.upload";
        const qs = new URLSearchParams({
          client_key: env.TIKTOK_CLIENT_KEY,
          scope: scopes,
          response_type: "code",
          redirect_uri: `${workerOrigin}/callback/tiktok`,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        });
        return Response.redirect(`https://www.tiktok.com/v2/auth/authorize/?${qs}`, 302);
      }

      return Response.json({ error: "Provedor desconhecido." }, { status: 404 });
    }

    // ---- 2. OAUTH CALLBACKS
    if (req.method === "GET" && path.startsWith("/callback/")) {
      const provider = path.slice(10);
      const errMsg = url.searchParams.get("error_description") || url.searchParams.get("error");
      if (errMsg) return handoffHtml({ error: errMsg });
      const code = url.searchParams.get("code") || "";
      const stateRaw = url.searchParams.get("state") || "";
      let st;
      try {
        st = await verifyState(stateRaw, secret);
      } catch (e) {
        return handoffHtml({ error: e.message });
      }
      if (st.provider !== provider || !isAllowedLocalCallback(st.callback)) {
        return handoffHtml({ error: "Parâmetros de retorno OAuth inválidos." });
      }

      try {
        if (provider === "youtube") {
          const r = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: env.GOOGLE_CLIENT_ID,
              client_secret: env.GOOGLE_CLIENT_SECRET,
              code,
              grant_type: "authorization_code",
              redirect_uri: `${workerOrigin}/callback/youtube`,
            }),
          });
          const tok = await r.json();
          if (!r.ok || !tok.access_token) {
            return handoffHtml({ error: tok.error_description || tok.error || "Falha no login Google." });
          }
          return handoffHtml({
            provider: "youtube",
            callback: st.callback,
            clientState: st.clientState,
            tokenBundle: tok,
          });
        }

        if (provider === "instagram") {
          if (st.mode === "facebook") {
            const q1 = new URLSearchParams({
              client_id: env.INSTAGRAM_APP_ID,
              client_secret: env.INSTAGRAM_APP_SECRET,
              redirect_uri: `${workerOrigin}/callback/instagram`,
              code,
            });
            const r1 = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${q1}`);
            const d1 = await r1.json();
            if (!r1.ok || !d1.access_token) {
              return handoffHtml({ error: d1.error?.message || "Falha no login Meta/Facebook." });
            }
            const q2 = new URLSearchParams({
              grant_type: "fb_exchange_token",
              client_id: env.INSTAGRAM_APP_ID,
              client_secret: env.INSTAGRAM_APP_SECRET,
              fb_exchange_token: d1.access_token,
            });
            const r2 = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${q2}`);
            const d2 = r2.ok ? await r2.json() : d1;
            return handoffHtml({
              provider: "instagram",
              callback: st.callback,
              clientState: st.clientState,
              tokenBundle: { access_token: d2.access_token, expires_in: d2.expires_in, api_type: "facebook" },
            });
          }

          const r1 = await fetch("https://api.instagram.com/oauth/access_token", {
            method: "POST",
            body: new URLSearchParams({
              client_id: env.INSTAGRAM_APP_ID,
              client_secret: env.INSTAGRAM_APP_SECRET,
              grant_type: "authorization_code",
              redirect_uri: `${workerOrigin}/callback/instagram`,
              code,
            }),
          });
          const d1 = await r1.json();
          if (!r1.ok || !d1.access_token) {
            return handoffHtml({ error: d1.error_message || "Falha no login Instagram." });
          }
          const qLong = new URLSearchParams({
            grant_type: "ig_exchange_token",
            client_secret: env.INSTAGRAM_APP_SECRET,
            access_token: d1.access_token,
          });
          const r2 = await fetch(`https://graph.instagram.com/access_token?${qLong}`);
          const d2 = r2.ok ? await r2.json() : d1;
          const access_token = d2.access_token || d1.access_token;
          const rMe = await fetch(
            `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(access_token)}`,
          );
          const me = rMe.ok ? await rMe.json() : {};
          return handoffHtml({
            provider: "instagram",
            callback: st.callback,
            clientState: st.clientState,
            tokenBundle: {
              access_token,
              expires_in: d2.expires_in || 5184000,
              ig_user_id: String(me.user_id || d1.user_id || ""),
              username: String(me.username || ""),
              api_type: "instagram",
            },
          });
        }

        if (provider === "tiktok") {
          const { verifier } = await derivePkce(secret, st.nonce);
          const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_key: env.TIKTOK_CLIENT_KEY,
              client_secret: env.TIKTOK_CLIENT_SECRET,
              code,
              grant_type: "authorization_code",
              redirect_uri: `${workerOrigin}/callback/tiktok`,
              code_verifier: verifier,
            }),
          });
          const d = await r.json();
          if (!r.ok || !d.access_token) {
            return handoffHtml({ error: d.error_description || d.error || "Falha no login TikTok." });
          }
          let user = {};
          try {
            const uResp = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", {
              headers: { Authorization: `Bearer ${d.access_token}` },
            });
            const uJson = await uResp.json();
            user = uJson?.data?.user || {};
          } catch (_) {}
          return handoffHtml({
            provider: "tiktok",
            callback: st.callback,
            clientState: st.clientState,
            tokenBundle: {
              access_token: d.access_token,
              refresh_token: d.refresh_token || "",
              expires_in: d.expires_in || 86400,
              scope: d.scope || "",
              open_id: user.open_id || d.open_id || "",
              username: user.username || "",
              display_name: user.display_name || "",
            },
          });
        }
      } catch (e) {
        return handoffHtml({ error: e.message || "Erro interno no OAuth Broker." });
      }
    }

    // ---- 3. TOKEN REFRESH (sem expor client_secret no cliente)
    if (req.method === "POST" && path.startsWith("/refresh/")) {
      const provider = path.slice(9);
      const body = await req.json().catch(() => ({}));
      const rt = String(body.refresh_token || "").trim();
      if (!rt) return Response.json({ detail: "refresh_token ausente" }, { status: 400 });

      if (provider === "youtube") {
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: rt,
            grant_type: "refresh_token",
          }),
        });
        const d = await r.json();
        return Response.json(d, { status: r.status });
      }

      if (provider === "tiktok") {
        const r = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: env.TIKTOK_CLIENT_KEY,
            client_secret: env.TIKTOK_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: rt,
          }),
        });
        const d = await r.json();
        return Response.json(d, { status: r.status });
      }

      return Response.json({ detail: "Provedor não suportado para refresh." }, { status: 404 });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
