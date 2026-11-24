import { useEffect, useState } from "react";
import {
  Cookie,
  ExternalLink,
  KeyRound,
  Link2,
  Radio,
  RefreshCw,
  Share2,
  Smartphone,
  Unlink,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { API } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConfigResponse, InstagramAccountSummary, SettingsTab, TikTokAccountSummary } from "@/types";

export type { SettingsTab };

interface Props {
  open: boolean;
  initialTab: SettingsTab;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onJobsChanged: () => void;
}

const INPUT_CLS =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";

export function SettingsDialog({ open, initialTab, onOpenChange, onSaved, onJobsChanged }: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [geminiKey, setGeminiKey] = useState("");
  const [geminiStatus, setGeminiStatus] = useState("");
  const [lang, setLang] = useState("auto");
  const [count, setCount] = useState("15");
  const [minScore, setMinScore] = useState("60");
  const [useVideo, setUseVideo] = useState(true);

  const [chName, setChName] = useState("GTA VI");
  const [handle, setHandle] = useState("@BabyDragonOFC");
  const [cta, setCta] = useState("");
  const [ytStatus, setYtStatus] = useState("");
  const [cookiesStatus, setCookiesStatus] = useState("");
  const [cookiesBrowser, setCookiesBrowser] = useState("");
  const [maxDay, setMaxDay] = useState("6");
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [slots, setSlots] = useState("");

  const [sources, setSources] = useState("");
  const [monAuto, setMonAuto] = useState(false);

  const [brokerUrl, setBrokerUrl] = useState("");
  const [brokerCheckMsg, setBrokerCheckMsg] = useState("");
  const [brokerProviders, setBrokerProviders] = useState<{ youtube?: boolean; instagram?: boolean; tiktok?: boolean } | null>(null);
  const [ytConnected, setYtConnected] = useState(false);

  // Instagram & TikTok
  const [igAppId, setIgAppId] = useState("");
  const [igAppSecret, setIgAppSecret] = useState("");
  const [igSecretSet, setIgSecretSet] = useState(false);
  const [igRedirect, setIgRedirect] = useState("");
  const [igLoginType, setIgLoginType] = useState<"instagram" | "facebook">("instagram");
  const [igShareFeed, setIgShareFeed] = useState(true);
  const [igUser, setIgUser] = useState<InstagramAccountSummary>({ connected: false });
  const [igManualTok, setIgManualTok] = useState("");
  const [igManualUid, setIgManualUid] = useState("");

  const [ttClientKey, setTtClientKey] = useState("");
  const [ttClientSecret, setTtClientSecret] = useState("");
  const [ttSecretSet, setTtSecretSet] = useState(false);
  const [ttRedirect, setTtRedirect] = useState("");
  const [ttPostMode, setTtPostMode] = useState<"direct" | "inbox">("direct");
  const [ttPrivacy, setTtPrivacy] = useState("PUBLIC_TO_EVERYONE");
  const [ttPrivacyOpts, setTtPrivacyOpts] = useState<string[]>([]);
  const [ttDisableComment, setTtDisableComment] = useState(false);
  const [ttDisableDuet, setTtDisableDuet] = useState(false);
  const [ttDisableStitch, setTtDisableStitch] = useState(false);
  const [ttUser, setTtUser] = useState<TikTokAccountSummary>({ connected: false });
  const [ttManualTok, setTtManualTok] = useState("");
  const [ttManualOpenId, setTtManualOpenId] = useState("");
  const [socialBusy, setSocialBusy] = useState<string | null>(null);

  const loadConfig = () => {
    setLoading(true);
    return API.config()
      .then((c: ConfigResponse) => {
        setGeminiKey("");
        setGeminiStatus(c.gemini_set ? `Chave ativa: ${c.gemini_masked}` : "Nenhuma chave configurada.");
        setLang(c.transcription?.language || "auto");
        setCount(String(c.clips?.target_count ?? 15));
        setMinScore(String(c.clips?.min_score ?? 50));
        setUseVideo(c.llm?.use_video_analysis !== false);
        setChName(c.channel?.name || "GTA VI");
        setHandle(c.channel?.handle || "@BabyDragonOFC");
        setCta(c.channel?.cta || "");
        setBrokerUrl(c.oauth_broker_url || c.auth?.broker_url || "");
        setYtConnected(Boolean(c.client_secret));
        setYtStatus(
          c.oauth_broker_url
            ? "Login 1 clique ativo via OAuth Broker (sem precisar client_secret.json local)."
            : c.client_secret
              ? "client_secret.json carregado"
              : "Conecte via OAuth Broker (1 clique) ou envie seu client_secret.json.",
        );
        setCookiesBrowser(c.ingest?.cookies_from_browser || c.cookies_from_browser || "");
        setCookiesStatus(
          c.youtube_cookies
            ? "cookies.txt salvo (ativo para vídeos +18)"
            : c.cookies_from_browser
              ? `Lendo cookies do navegador: ${c.cookies_from_browser}`
              : "Opcional — necessário para baixar vídeos +18.",
        );
        setMaxDay(String(c.upload?.max_per_day || 6));
        setTz(c.upload?.timezone || "America/Sao_Paulo");
        setSlots((c.upload?.slots || []).join(", "));
        setSources(
          (c.monitor?.sources || [])
            .map((s) => `${s.name || ""} | ${s.channel_id || ""}`)
            .join("\n"),
        );
        setMonAuto(Boolean(c.monitor?.auto_upload));

        setIgAppId(c.instagram_app_id || "");
        setIgAppSecret("");
        setIgSecretSet(Boolean(c.instagram_secret_set));
        setIgRedirect(c.instagram_redirect_uri || "");
        setIgLoginType(c.instagram?.login_type === "facebook" ? "facebook" : "instagram");
        setIgShareFeed(c.instagram?.share_to_feed !== false);
        setIgUser(c.instagram_user || { connected: false });

        setTtClientKey(c.tiktok_client_key || "");
        setTtClientSecret("");
        setTtSecretSet(Boolean(c.tiktok_secret_set));
        setTtRedirect(c.tiktok_redirect_uri || "");
        setTtPostMode(c.tiktok?.post_mode === "inbox" ? "inbox" : "direct");
        setTtPrivacy(c.tiktok?.privacy_level || "PUBLIC_TO_EVERYONE");
        setTtDisableComment(Boolean(c.tiktok?.disable_comment));
        setTtDisableDuet(Boolean(c.tiktok?.disable_duet));
        setTtDisableStitch(Boolean(c.tiktok?.disable_stitch));
        setTtUser(c.tiktok_user || { connected: false });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar config"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!open) return;
    void loadConfig();
  }, [open]);

  useEffect(() => {
    if (!open || !ttUser.connected) {
      setTtPrivacyOpts([]);
      return;
    }
    API.ttCreatorInfo()
      .then((d) => {
        if (Array.isArray(d.privacy_level_options) && d.privacy_level_options.length > 0) {
          setTtPrivacyOpts(d.privacy_level_options);
        }
      })
      .catch(() => {
        // fallback às opções padrão quando em sandbox/manual
      });
  }, [open, ttUser.connected]);

  useEffect(() => {
    if (!open) return;
    const onRefreshEvt = (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | null;
      if (d?.type === "clipsreal:oauth" || d?.type === "clipsreal:broker_token") {
        window.setTimeout(() => { void loadConfig(); }, 350);
      }
    };
    window.addEventListener("message", onRefreshEvt);
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("clipsreal_oauth");
      bc.onmessage = () => {
        window.setTimeout(() => { void loadConfig(); }, 350);
      };
    }
    return () => {
      window.removeEventListener("message", onRefreshEvt);
      bc?.close();
    };
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsedSources = sources
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const parts = l.split("|").map((x) => x.trim());
          return parts.length >= 2
            ? { name: parts[0], channel_id: parts[1] }
            : { name: parts[0], channel_id: parts[0] };
        });
      const parsedSlots = slots
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d{1,2}:\d{2}$/.test(s));

      await API.saveConfig({
        gemini_api_key: geminiKey.trim() || null,
        oauth_broker_url: brokerUrl.trim().replace(/\/+$/, ""),
        instagram_app_id: igAppId.trim() || null,
        instagram_app_secret: igAppSecret.trim() || null,
        instagram_redirect_uri: igRedirect.trim() || null,
        tiktok_client_key: ttClientKey.trim() || null,
        tiktok_client_secret: ttClientSecret.trim() || null,
        tiktok_redirect_uri: ttRedirect.trim() || null,
        auth: { broker_url: brokerUrl.trim().replace(/\/+$/, "") },
        channel: {
          name: chName.trim() || "GTA VI",
          handle: handle.trim() || "@BabyDragonOFC",
          cta: cta.trim(),
        },
        clips: {
          target_count: Number(count) || 10,
          min_score: minScore === "" ? 50 : Number(minScore),
        },
        llm: { use_video_analysis: useVideo },
        transcription: { language: lang === "auto" ? null : lang },
        upload: {
          max_per_day: Number(maxDay) || 6,
          timezone: tz.trim() || "America/Sao_Paulo",
          ...(parsedSlots.length ? { slots: parsedSlots } : {}),
        },
        instagram: {
          login_type: igLoginType,
          share_to_feed: igShareFeed,
        },
        tiktok: {
          post_mode: ttPostMode,
          privacy_level: ttPrivacy,
          disable_comment: ttDisableComment,
          disable_duet: ttDisableDuet,
          disable_stitch: ttDisableStitch,
        },
        monitor: { auto_upload: monAuto, sources: parsedSources },
        ingest: { cookies_from_browser: cookiesBrowser },
      });
      toast.success("Configurações salvas");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleTestGemini = async () => {
    if (geminiKey.trim()) {
      await API.saveConfig({ gemini_api_key: geminiKey.trim() });
    }
    setGeminiStatus("Testando conexão…");
    try {
      const r = await API.testGemini();
      setGeminiStatus(`Conectado — modelo ativo: ${r.model}`);
      onSaved();
    } catch (e) {
      setGeminiStatus(`Erro: ${e instanceof Error ? e.message : "falha"}`);
    }
  };

  const handleSecretUpload = async (file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await API.uploadSecret(fd);
      setYtStatus("client_secret.json salvo — clique em Conectar canal.");
      toast.success("client_secret.json salvo");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar JSON");
    }
  };

  const handleCookiesUpload = async (file?: File) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await API.uploadCookies(fd);
      setCookiesStatus("cookies.txt salvo — pronto para vídeos +18.");
      toast.success("cookies.txt salvo");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar cookies");
    }
  };

  const handleYtConnect = async () => {
    try {
      if (brokerUrl.trim()) {
        await API.saveConfig({
          oauth_broker_url: brokerUrl.trim().replace(/\/+$/, ""),
          auth: { broker_url: brokerUrl.trim().replace(/\/+$/, "") },
        });
      }
      const r = await API.ytOAuthStart();
      if (r.mode === "broker" && r.auth_url) {
        window.open(r.auth_url, "clipsreal_yt_oauth", "width=560,height=720");
        toast.info("Entre com sua conta Google na janela aberta…");
      } else {
        setYtStatus(`Conectado: ${r.info?.title || "OK"}`);
        toast.success("Canal conectado");
        onSaved();
      }
    } catch (e) {
      setYtStatus(`Erro: ${e instanceof Error ? e.message : "falha"}`);
      toast.error(e instanceof Error ? e.message : "Falha ao conectar");
    }
  };

  const handleYtDisconnect = async () => {
    await API.ytDisconnect();
    setYtStatus("YouTube desconectado.");
    toast.info("Conta Google desconectada.");
    onSaved();
  };

  const handleCheckMonitor = async () => {
    try {
      const r = await API.checkMonitor();
      toast.info(
        r.created.length ? `${r.created.length} novo(s) vídeo(s) na fila` : "Nenhum vídeo novo nas fontes.",
      );
      onJobsChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao checar fontes");
    }
  };

  const handleIgOAuth = async () => {
    setSocialBusy("ig-oauth");
    try {
      await API.saveConfig({
        oauth_broker_url: brokerUrl.trim().replace(/\/+$/, ""),
        auth: { broker_url: brokerUrl.trim().replace(/\/+$/, "") },
        instagram_app_id: igAppId.trim() || null,
        instagram_app_secret: igAppSecret.trim() || null,
        instagram_redirect_uri: igRedirect.trim() || null,
        instagram: { login_type: igLoginType, share_to_feed: igShareFeed },
      });
      const r = await API.igOAuthStart(igLoginType, igRedirect.trim() || undefined);
      window.open(r.auth_url, "clipsreal_ig_oauth", "width=560,height=720");
      toast.info("Autorize o Instagram na janela aberta.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar OAuth do Instagram");
    } finally {
      setSocialBusy(null);
    }
  };

  const handleIgManual = async () => {
    if (!igManualTok.trim()) {
      toast.error("Cole o Access Token do Instagram.");
      return;
    }
    setSocialBusy("ig-manual");
    try {
      const info = await API.igManualConnect(igManualTok, igManualUid, "auto");
      setIgUser(info);
      setIgManualTok("");
      toast.success(`Instagram conectado: @${(info.username || info.ig_user_id || "").replace(/^@/, "")}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Token inválido");
    } finally {
      setSocialBusy(null);
    }
  };

  const handleIgDisconnect = async () => {
    setSocialBusy("ig-disc");
    try {
      await API.igDisconnect();
      setIgUser({ connected: false });
      toast.info("Instagram desconectado.");
      onSaved();
    } finally {
      setSocialBusy(null);
    }
  };

  const handleTtOAuth = async () => {
    setSocialBusy("tt-oauth");
    try {
      await API.saveConfig({
        oauth_broker_url: brokerUrl.trim().replace(/\/+$/, ""),
        auth: { broker_url: brokerUrl.trim().replace(/\/+$/, "") },
        tiktok_client_key: ttClientKey.trim() || null,
        tiktok_client_secret: ttClientSecret.trim() || null,
        tiktok_redirect_uri: ttRedirect.trim() || null,
        tiktok: {
          post_mode: ttPostMode,
          privacy_level: ttPrivacy,
          disable_comment: ttDisableComment,
          disable_duet: ttDisableDuet,
          disable_stitch: ttDisableStitch,
        },
      });
      const r = await API.ttOAuthStart(ttPostMode, ttRedirect.trim() || undefined);
      window.open(r.auth_url, "clipsreal_tt_oauth", "width=560,height=720");
      toast.info("Autorize o TikTok na janela aberta.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar OAuth do TikTok");
    } finally {
      setSocialBusy(null);
    }
  };

  const handleTtManual = async () => {
    if (!ttManualTok.trim()) {
      toast.error("Cole o Access Token do TikTok.");
      return;
    }
    setSocialBusy("tt-manual");
    try {
      const info = await API.ttManualConnect(ttManualTok, ttManualOpenId);
      setTtUser(info);
      setTtManualTok("");
      toast.success(`TikTok conectado: ${info.username || info.display_name || "OK"}`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Token TikTok inválido");
    } finally {
      setSocialBusy(null);
    }
  };

  const handleTtDisconnect = async () => {
    setSocialBusy("tt-disc");
    try {
      await API.ttDisconnect();
      setTtUser({ connected: false });
      toast.info("TikTok desconectado.");
      onSaved();
    } finally {
      setSocialBusy(null);
    }
  };

  const handleCheckBroker = async () => {
    const clean = brokerUrl.trim().replace(/\/+$/, "");
    if (!clean) {
      setBrokerCheckMsg("Cole a URL https://... do Cloudflare Worker antes de testar.");
      setBrokerProviders(null);
      return;
    }
    setSocialBusy("broker-check");
    setBrokerCheckMsg("Verificando OAuth Broker…");
    try {
      const r = await API.brokerCheck(clean);
      setBrokerProviders(r.providers);
      await API.saveConfig({ oauth_broker_url: clean, auth: { broker_url: clean } });
      setBrokerCheckMsg("Broker online e salvo! Veja os provedores ativos:");
      onSaved();
    } catch (e) {
      setBrokerProviders(null);
      setBrokerCheckMsg(e instanceof Error ? e.message : "Falha ao testar Broker");
    } finally {
      setSocialBusy(null);
    }
  };

  const igReady = Boolean(brokerUrl.trim() || (igAppId.trim() && igSecretSet));
  const ttReady = Boolean(brokerUrl.trim() || (ttClientKey.trim() && ttSecretSet));

  const effectivePrivacyOptions = ttPrivacyOpts.length
    ? ttPrivacyOpts
    : ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <div className="border-b border-zinc-800 px-6 py-4">
          <DialogTitle>Chaves, Redes Sociais &amp; Monitor</DialogTitle>
          <DialogDescription className="mt-0.5">
            Credenciais de IA, YouTube, Instagram Reels, TikTok (cortes em pé 9:16) e Monitor RSS.
          </DialogDescription>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-zinc-800/80 px-6 py-2.5">
          {(
            [
              ["ai", "IA & Cortes", KeyRound],
              ["yt", "YouTube", Link2],
              ["social", "Instagram & TikTok", Share2],
              ["mon", "Monitor RSS", Radio],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                tab === id
                  ? "bg-zinc-800 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="p-6">
          {loading ? (
            <div className="py-12 text-center text-xs text-zinc-500">Carregando configurações…</div>
          ) : tab === "ai" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Gemini API
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Chave gratuita em{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-zinc-300 underline decoration-zinc-600 underline-offset-2 hover:text-white"
                  >
                    aistudio.google.com/apikey
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Cole sua GEMINI_API_KEY"
                    autoComplete="off"
                    className={INPUT_CLS}
                  />
                  <Button size="sm" onClick={handleTestGemini}>
                    Testar
                  </Button>
                </div>
                <p className="mt-2 text-xs text-zinc-400">{geminiStatus}</p>
              </div>

              <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Padrões de Extração
                </h3>
                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex items-center justify-between gap-3 text-xs text-zinc-300">
                    <span>Idioma padrão</span>
                    <select
                      value={lang}
                      onChange={(e) => setLang(e.target.value)}
                      className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-100"
                    >
                      <option value="auto">Auto (PT / EN)</option>
                      <option value="pt">Português</option>
                      <option value="en">Inglês</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3 text-xs text-zinc-300">
                    <span>Cortes por vídeo</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                      className="tabular-mono w-20 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-center text-xs text-zinc-100"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-xs text-zinc-300">
                    <span>Score viral mínimo</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={minScore}
                      onChange={(e) => setMinScore(e.target.value)}
                      className="tabular-mono w-20 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-center text-xs text-zinc-100"
                    />
                  </label>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-zinc-300">Análise visual com proxy leve</span>
                    <Switch checked={useVideo} onCheckedChange={setUseVideo} />
                  </div>
                </div>
              </div>
            </div>
          ) : tab === "yt" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Identidade do Canal
                </h3>
                <div className="mt-3 flex flex-col gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Nome do canal</label>
                    <input value={chName} onChange={(e) => setChName(e.target.value)} className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Handle (@)</label>
                    <input value={handle} onChange={(e) => setHandle(e.target.value)} className={INPUT_CLS} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">CTA padrão</label>
                    <input value={cta} onChange={(e) => setCta(e.target.value)} className={INPUT_CLS} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Conta Google (YouTube) &amp; Cookies
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={handleYtConnect}>
                    <Link2 className="h-3.5 w-3.5" />
                    <span>Entrar com Google (YouTube)</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleYtDisconnect}>
                    <Unlink className="h-3.5 w-3.5" />
                    <span>Desconectar</span>
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">{ytStatus}</p>

                <details className="mt-3 rounded-md border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                  <summary className="cursor-pointer text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
                    Configuração avançada (OAuth Broker MVP / client_secret.json próprio)
                  </summary>
                  <div className="mt-2.5 space-y-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-400">
                        OAuth Broker URL (opcional p/ login 1 clique sem JSON)
                      </label>
                      <input
                        value={brokerUrl}
                        onChange={(e) => setBrokerUrl(e.target.value)}
                        placeholder="https://clipsreal-oauth-broker.seu-usuario.workers.dev"
                        className={INPUT_CLS}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800">
                        <Upload className="h-3 w-3" />
                        <span>{ytConnected ? "Substituir client_secret.json" : "Enviar client_secret.json"}</span>
                        <input
                          type="file"
                          accept=".json,application/json"
                          className="hidden"
                          onChange={(e) => handleSecretUpload(e.target.files?.[0])}
                        />
                      </label>
                    </div>
                  </div>
                </details>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Máx/dia</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={maxDay}
                      onChange={(e) => setMaxDay(e.target.value)}
                      className={cn(INPUT_CLS, "tabular-mono")}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-400">Fuso horário</label>
                    <input value={tz} onChange={(e) => setTz(e.target.value)} className={INPUT_CLS} />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-xs text-zinc-400">Horários (vírgula)</label>
                  <input value={slots} onChange={(e) => setSlots(e.target.value)} className={cn(INPUT_CLS, "tabular-mono")} />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                    Obs.: o YouTube impõe teto de envios em 24h por canal (aumente em YouTube Studio → Recursos Avançados) e a cota padrão da API (~10.000 unid./dia) cobre ~6 envios/dia.
                  </p>
                </div>

                <div className="mt-3 border-t border-zinc-800 pt-3">
                  <span className="mb-1.5 block text-xs text-zinc-400">Cookies yt-dlp (vídeos +18)</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800">
                      <Cookie className="h-3 w-3" />
                      <span>Enviar cookies.txt</span>
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        className="hidden"
                        onChange={(e) => handleCookiesUpload(e.target.files?.[0])}
                      />
                    </label>
                    <select
                      value={cookiesBrowser}
                      onChange={(e) => setCookiesBrowser(e.target.value)}
                      aria-label="Navegador para cookies"
                      className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                    >
                      <option value="">Navegador: desativado</option>
                      <option value="chrome">Chrome</option>
                      <option value="firefox">Firefox</option>
                      <option value="safari">Safari</option>
                      <option value="brave">Brave</option>
                      <option value="edge">Edge</option>
                    </select>
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-400">{cookiesStatus}</p>
                </div>
              </div>
            </div>
          ) : tab === "social" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-4 py-3 text-xs text-zinc-400">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong className="text-zinc-200">Login 1 Clique (OAuth Broker MVP):</strong>{" "}
                    {brokerUrl.trim()
                      ? "URL configurada — seus amigos entram só com a conta deles."
                      : "para conectar Instagram/TikTok/Google sem App ID em cada PC, suba "}
                    {!brokerUrl.trim() && <code className="text-zinc-200">oauth-broker/worker.js</code>}
                    {!brokerUrl.trim() && " (grátis no Cloudflare) ou use Token direto abaixo."}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={brokerUrl}
                    onChange={(e) => setBrokerUrl(e.target.value)}
                    placeholder="https://clipsreal-oauth-broker.seu-usuario.workers.dev"
                    className={cn(INPUT_CLS, "min-w-[240px] flex-1")}
                  />
                  <Button size="sm" disabled={socialBusy !== null} onClick={handleCheckBroker}>
                    Testar Broker
                  </Button>
                </div>
                {brokerCheckMsg && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
                    <span>{brokerCheckMsg}</span>
                    {brokerProviders && (
                      <>
                        <span className={brokerProviders.youtube ? "text-emerald-400" : "text-rose-400"}>
                          YouTube: {brokerProviders.youtube ? "OK" : "falta secret"}
                        </span>
                        <span className={brokerProviders.instagram ? "text-emerald-400" : "text-rose-400"}>
                          Instagram: {brokerProviders.instagram ? "OK" : "falta secret"}
                        </span>
                        <span className={brokerProviders.tiktok ? "text-emerald-400" : "text-rose-400"}>
                          TikTok: {brokerProviders.tiktok ? "OK" : "falta secret"}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
              {/* Instagram Reels */}
              <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    <Smartphone className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Instagram Reels (9:16)</span>
                  </h3>
                  {igUser.connected ? (
                    <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
                      @{String(igUser.username || igUser.ig_user_id || "conectado").replace(/^@/, "")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-500">Não conectado</span>
                  )}
                </div>

                <div className="mt-3 flex flex-col gap-2.5">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={socialBusy !== null || !igReady}
                      onClick={handleIgOAuth}
                      title={!igReady ? "Configure a URL do OAuth Broker ou App ID/Secret abaixo" : undefined}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span>{igUser.connected ? "Trocar conta Instagram" : "Entrar com Instagram"}</span>
                    </Button>
                    {igUser.connected && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={socialBusy !== null}
                        onClick={handleIgDisconnect}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        <span>Desconectar</span>
                      </Button>
                    )}
                  </div>
                  {!igUser.connected && !igReady && (
                    <p className="text-[11px] text-amber-300/90">
                      Para ativar: cole a URL do OAuth Broker acima ou preencha Token / App ID abaixo.
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-xs text-zinc-300">Compartilhar Reel no Feed principal</span>
                    <Switch checked={igShareFeed} onCheckedChange={setIgShareFeed} />
                  </div>

                  <details open={!igUser.connected && !igReady} className="rounded-md border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                    <summary className="cursor-pointer text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
                      Configuração avançada (App ID próprio ou Token direto)
                    </summary>
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-zinc-400">Meta App ID</label>
                          <input
                            value={igAppId}
                            onChange={(e) => setIgAppId(e.target.value)}
                            placeholder="App ID"
                            className={INPUT_CLS}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-zinc-400">App Secret</label>
                          <input
                            type="password"
                            value={igAppSecret}
                            onChange={(e) => setIgAppSecret(e.target.value)}
                            placeholder={igSecretSet ? "Já salvo (preencha p/ trocar)" : "App Secret"}
                            autoComplete="off"
                            className={INPUT_CLS}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-zinc-400">Login OAuth</label>
                          <select
                            value={igLoginType}
                            onChange={(e) => setIgLoginType(e.target.value as "instagram" | "facebook")}
                            className={INPUT_CLS}
                          >
                            <option value="instagram">Instagram Login (direto)</option>
                            <option value="facebook">Facebook Business Login</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-zinc-400">Redirect URI</label>
                          <input
                            value={igRedirect}
                            onChange={(e) => setIgRedirect(e.target.value)}
                            placeholder="http://localhost:8000/api/instagram/callback"
                            className={cn(INPUT_CLS, "text-[11px]")}
                          />
                        </div>
                      </div>

                      <div className="border-t border-zinc-800/80 pt-2">
                        <p className="mb-1.5 text-[11px] text-zinc-500">
                          Ou cole um Token direto (Meta for Developers):
                        </p>
                        <div className="grid grid-cols-[1fr_100px] gap-1.5">
                          <input
                            type="password"
                            value={igManualTok}
                            onChange={(e) => setIgManualTok(e.target.value)}
                            placeholder="Access Token (IGAA... ou EAA...)"
                            autoComplete="off"
                            className={INPUT_CLS}
                          />
                          <input
                            value={igManualUid}
                            onChange={(e) => setIgManualUid(e.target.value)}
                            placeholder="IG ID (opc.)"
                            className={INPUT_CLS}
                          />
                        </div>
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          disabled={socialBusy !== null}
                          onClick={handleIgManual}
                        >
                          Conectar com Token
                        </Button>
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              {/* TikTok */}
              <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    <Smartphone className="h-3.5 w-3.5 text-zinc-400" />
                    <span>TikTok (9:16)</span>
                  </h3>
                  {ttUser.connected ? (
                    <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
                      {ttUser.username
                        ? `@${ttUser.username.replace(/^@/, "")}`
                        : ttUser.display_name || ttUser.open_id || "Conectado"}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-500">Não conectado</span>
                  )}
                </div>

                <div className="mt-3 flex flex-col gap-2.5">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={socialBusy !== null || !ttReady}
                      onClick={handleTtOAuth}
                      title={!ttReady ? "Configure a URL do OAuth Broker ou Client Key/Secret abaixo" : undefined}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span>{ttUser.connected ? "Trocar conta TikTok" : "Entrar com TikTok"}</span>
                    </Button>
                    {ttUser.connected && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={socialBusy !== null}
                        onClick={handleTtDisconnect}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        <span>Desconectar</span>
                      </Button>
                    )}
                  </div>
                  {!ttUser.connected && !ttReady && (
                    <p className="text-[11px] text-amber-300/90">
                      Para ativar: cole a URL do OAuth Broker acima ou preencha Token / Client Key abaixo.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-400">Modo de envio</label>
                      <select
                        value={ttPostMode}
                        onChange={(e) => setTtPostMode(e.target.value as "direct" | "inbox")}
                        className={INPUT_CLS}
                      >
                        <option value="direct">Direto no perfil (video.publish)</option>
                        <option value="inbox">Inbox / Rascunho (video.upload)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-400">Privacidade</label>
                      <select
                        value={ttPrivacy}
                        onChange={(e) => setTtPrivacy(e.target.value)}
                        className={INPUT_CLS}
                      >
                        {effectivePrivacyOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt === "PUBLIC_TO_EVERYONE"
                              ? "Público"
                              : opt === "MUTUAL_FOLLOW_FRIENDS"
                                ? "Amigos mútuos"
                                : opt === "FOLLOWER_OF_CREATOR"
                                  ? "Seguidores"
                                  : opt === "SELF_ONLY"
                                    ? "Somente eu (Sandbox)"
                                    : opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-400">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <Switch checked={!ttDisableComment} onCheckedChange={(v) => setTtDisableComment(!v)} />
                      <span>Comentários</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <Switch checked={!ttDisableDuet} onCheckedChange={(v) => setTtDisableDuet(!v)} />
                      <span>Dueto</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <Switch checked={!ttDisableStitch} onCheckedChange={(v) => setTtDisableStitch(!v)} />
                      <span>Costurar</span>
                    </label>
                  </div>

                  <details open={!ttUser.connected && !ttReady} className="rounded-md border border-zinc-800/80 bg-zinc-950/60 p-2.5">
                    <summary className="cursor-pointer text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
                      Configuração avançada (Client Key própria ou Token direto)
                    </summary>
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-zinc-400">Client Key</label>
                          <input
                            value={ttClientKey}
                            onChange={(e) => setTtClientKey(e.target.value)}
                            placeholder="Client Key"
                            className={INPUT_CLS}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] text-zinc-400">Client Secret</label>
                          <input
                            type="password"
                            value={ttClientSecret}
                            onChange={(e) => setTtClientSecret(e.target.value)}
                            placeholder={ttSecretSet ? "Já salvo (preencha p/ trocar)" : "Client Secret"}
                            autoComplete="off"
                            className={INPUT_CLS}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-zinc-400">Redirect URI (Desktop/HTTPS)</label>
                        <input
                          value={ttRedirect}
                          onChange={(e) => setTtRedirect(e.target.value)}
                          placeholder="http://127.0.0.1:8000/api/tiktok/callback"
                          className={cn(INPUT_CLS, "text-[11px]")}
                        />
                      </div>
                      <div className="border-t border-zinc-800/80 pt-2">
                        <p className="mb-1.5 text-[11px] text-zinc-500">
                          Ou conecte com Access Token (Sandbox):
                        </p>
                        <div className="grid grid-cols-[1fr_100px] gap-1.5">
                          <input
                            type="password"
                            value={ttManualTok}
                            onChange={(e) => setTtManualTok(e.target.value)}
                            placeholder="Access Token (act....)"
                            autoComplete="off"
                            className={INPUT_CLS}
                          />
                          <input
                            value={ttManualOpenId}
                            onChange={(e) => setTtManualOpenId(e.target.value)}
                            placeholder="Open ID (opc.)"
                            className={INPUT_CLS}
                          />
                        </div>
                        <Button
                          size="sm"
                          className="mt-2 w-full"
                          disabled={socialBusy !== null}
                          onClick={handleTtManual}
                        >
                          Conectar com Token
                        </Button>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800/80 bg-[#16161a] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Monitor Automático RSS
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                1 canal por linha no formato <code className="text-zinc-300">Nome | UCxxxxxxxx</code>.
              </p>
              <textarea
                rows={4}
                value={sources}
                onChange={(e) => setSources(e.target.value)}
                placeholder="Canal Exemplo | UCxxxxxxxxxxxxxxxxxxxxxx"
                className={cn(INPUT_CLS, "mt-3 font-mono text-xs")}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch checked={monAuto} onCheckedChange={setMonAuto} />
                  <span className="text-xs text-zinc-300">Agendar upload automático</span>
                </div>
                <Button size="sm" onClick={handleCheckMonitor}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Checar agora</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-6 py-3.5">
          <Button variant="default" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={handleSave}>
            {saving ? "Salvando…" : "Salvar configurações"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
