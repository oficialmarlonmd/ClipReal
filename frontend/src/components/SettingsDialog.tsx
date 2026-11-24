import { useEffect, useState } from "react";
import { Cookie, ExternalLink, KeyRound, Link2, Radio, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { API } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ConfigResponse } from "@/types";

export type SettingsTab = "ai" | "yt" | "mon";

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

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    API.config()
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
        setYtStatus(c.client_secret ? "client_secret.json carregado" : "client_secret.json ainda não enviado.");
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
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Erro ao carregar config"))
      .finally(() => setLoading(false));
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
    toast.info("Abrindo navegador para autorizar o YouTube…");
    try {
      const c = await API.ytAuth();
      setYtStatus(`Conectado: ${c.title || "OK"}`);
      toast.success("Canal conectado");
      onSaved();
    } catch (e) {
      setYtStatus(`Erro: ${e instanceof Error ? e.message : "falha"}`);
    }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <div className="border-b border-zinc-800 px-6 py-4">
          <DialogTitle>Chaves, YouTube &amp; Monitor</DialogTitle>
          <DialogDescription className="mt-0.5">
            Credenciais de IA, integração OAuth do YouTube, cookies de download e monitoramento RSS.
          </DialogDescription>
        </div>

        <div className="flex gap-1 border-b border-zinc-800/80 px-6 py-2.5">
          {(
            [
              ["ai", "IA & Cortes", KeyRound],
              ["yt", "Canal & YouTube", Link2],
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
                  YouTube API &amp; Cookies (+18)
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800">
                    <Upload className="h-3 w-3" />
                    <span>client_secret.json</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => handleSecretUpload(e.target.files?.[0])}
                    />
                  </label>
                  <Button variant="primary" size="sm" onClick={handleYtConnect}>
                    Conectar canal
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">{ytStatus}</p>

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
