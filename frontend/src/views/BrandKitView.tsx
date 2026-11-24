import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { API } from "@/lib/api";
import { cn, FMT_META } from "@/lib/utils";
import type { RenderMode, StatusResponse } from "@/types";

interface Props {
  status: StatusResponse | null;
  currentJobId: number | null;
  onSaved: () => void;
  onAfterRerender: () => void;
}

const WM_POSITIONS = [
  { id: "top-left", label: "Topo Esq" },
  { id: "top-center", label: "Topo Centro" },
  { id: "top-right", label: "Topo Dir" },
  { id: "bottom-left", label: "Base Esq" },
  { id: "bottom-center", label: "Base Centro" },
  { id: "bottom-right", label: "Base Dir" },
] as const;

function assToHex(val?: string): string {
  if (!val) return "#FFE500";
  const s = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  const m = s.replace(/^&H/i, "").replace(/&$/, "");
  if (/^[0-9a-fA-F]{6,8}$/.test(m)) {
    const bgr = m.slice(-6);
    const b = bgr.slice(0, 2);
    const g = bgr.slice(2, 4);
    const r = bgr.slice(4, 6);
    return `#${r}${g}${b}`.toUpperCase();
  }
  return "#FFE500";
}

function hexToAss(hex: string): string {
  const clean = hex.replace("#", "").trim();
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    return `&H00${b}${g}${r}`.toUpperCase();
  }
  return "&H0000E5FF";
}

const HIGHLIGHT_SWATCHES = [
  { hex: "#FFFF00", label: "Amarelo" },
  { hex: "#FFFFFF", label: "Branco" },
  { hex: "#34D399", label: "Esmeralda" },
  { hex: "#38BDF8", label: "Azul" },
  { hex: "#FB7185", label: "Coral" },
];

const SELECT_CLS =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[13px] text-zinc-100 focus:border-zinc-500 focus:outline-none";

const INPUT_CLS =
  "w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";

export function BrandKitView({ status, currentJobId, onSaved, onAfterRerender }: Props) {
  const [wmEnabled, setWmEnabled] = useState(true);
  const [wmText, setWmText] = useState("@BabyDragonOFC");
  const [wmPos, setWmPos] = useState("bottom-center");
  const [wmOpacity, setWmOpacity] = useState(65);
  const [wmSize, setWmSize] = useState(38);

  const [hookEnabled, setHookEnabled] = useState(true);
  const [hookStyle, setHookStyle] = useState<"white" | "red" | "black">("white");
  const [hookPos, setHookPos] = useState<"auto" | "middle" | "top">("auto");

  const [captions, setCaptions] = useState(true);
  const [wordsPerGroup, setWordsPerGroup] = useState(3);
  const [highlightColor, setHighlightColor] = useState("#FFE500");

  const [defaultMode, setDefaultMode] = useState<RenderMode>("dual");
  const [camPos, setCamPos] = useState("auto");
  const [censor18, setCensor18] = useState(true);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!status) return;
    const r = status.render || {};
    const c = status.channel || {};
    setWmEnabled(r.watermark !== false);
    setWmText(c.watermark_text || c.handle || "");
    setWmPos((r.watermark_position || "bottom-center").replace("_", "-"));
    const rawOp = typeof r.watermark_opacity === "number" ? r.watermark_opacity : 65;
    setWmOpacity(rawOp <= 1 ? Math.round(rawOp * 100) : Math.round(rawOp));
    setWmSize(typeof r.watermark_size === "number" ? r.watermark_size : 38);
    setHookEnabled(r.hook_title !== false);
    setHookStyle(r.hook_style || "white");
    setHookPos(r.hook_position || "auto");
    setCaptions(r.captions !== false);
    setWordsPerGroup(r.words_per_group || 3);
    setHighlightColor(assToHex(r.highlight_color));
    setDefaultMode((r.mode as RenderMode) || "dual");
    setCamPos(r.cam_position || "auto");
    setCensor18(r.censor_18plus !== false);
  }, [status]);

  const buildPayload = () => ({
    channel: {
      watermark_text: wmText.trim(),
    },
    render: {
      mode: defaultMode,
      cam_position: camPos,
      watermark: wmEnabled,
      watermark_position: wmPos,
      watermark_opacity: wmOpacity,
      watermark_size: wmSize,
      hook_title: hookEnabled,
      hook_style: hookStyle,
      hook_position: hookPos,
      captions,
      words_per_group: wordsPerGroup,
      highlight_color: hexToAss(highlightColor),
      censor_18plus: censor18,
    },
  });

  const handleSave = async (rerenderCurrent = false) => {
    setSaving(true);
    try {
      await API.saveConfig(buildPayload());
      onSaved();
      if (rerenderCurrent) {
        if (!currentJobId) {
          toast.info("Brand Kit salvo. Abra um trabalho no Studio para re-renderizar.");
        } else {
          const res = await API.renderBatch({ job_id: currentJobId, mode: defaultMode, captions });
          toast.success(`Brand Kit salvo! Re-renderizando ${res.queued} corte(s)…`);
          onAfterRerender();
        }
      } else {
        toast.success("Brand Kit salvo como padrão.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar Brand Kit");
    } finally {
      setSaving(false);
    }
  };

  const wmPosClasses: Record<string, string> = {
    "top-left": "top-3 left-3 text-left",
    "top-center": "top-3 left-1/2 -translate-x-1/2 text-center",
    "top-right": "top-3 right-3 text-right",
    "bottom-left": "bottom-3 left-3 text-left",
    "bottom-center": "bottom-3 left-1/2 -translate-x-1/2 text-center",
    "bottom-right": "bottom-3 right-3 text-right",
  };

  const hookStyleClasses =
    hookStyle === "red"
      ? "bg-rose-600 text-white"
      : hookStyle === "black"
        ? "bg-zinc-950/90 text-white border border-zinc-700"
        : "bg-white text-zinc-950";

  const effectiveHookPos =
    hookPos === "auto"
      ? defaultMode === "dual" || defaultMode === "dual_dopamine"
        ? "middle"
        : "top"
      : defaultMode === "blur" || defaultMode === "card" || defaultMode === "fit"
        ? "top"
        : hookPos;

  const hookPosClass =
    effectiveHookPos === "middle"
      ? defaultMode === "dual"
        ? "top-[37%] -translate-y-1/2"
        : defaultMode === "dual_dopamine"
          ? "top-[44%] -translate-y-1/2"
          : "top-1/2 -translate-y-1/2"
      : defaultMode === "blur" || defaultMode === "card" || defaultMode === "fit"
        ? "top-[14%]"
        : "top-9";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {/* Watermark */}
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Marca d&apos;água do canal</h2>
              <p className="text-xs text-zinc-500">
                Assinatura gravada diretamente nos cortes exportados.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <Switch checked={wmEnabled} onCheckedChange={setWmEnabled} />
              <span>{wmEnabled ? "Ativada" : "Desativada"}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">
                Texto da marca d&apos;água
              </label>
              <div className="flex gap-2">
                <input
                  value={wmText}
                  onChange={(e) => setWmText(e.target.value)}
                  placeholder="@SeuCanal"
                  className={INPUT_CLS}
                />
                {status?.channel?.handle && (
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => setWmText(status.channel.handle || "")}
                  >
                    Usar @handle
                  </Button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Posição na tela</label>
              <div className="grid grid-cols-3 gap-1.5">
                {WM_POSITIONS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setWmPos(p.id)}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors cursor-pointer",
                      wmPos === p.id
                        ? "border-zinc-400 bg-zinc-800 text-zinc-50"
                        : "border-zinc-800/80 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-400">Opacidade</span>
                <span className="tabular-mono text-zinc-300">{wmOpacity}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={wmOpacity}
                onChange={(e) => setWmOpacity(Number(e.target.value))}
                className="w-full accent-zinc-100"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-400">Tamanho da fonte</span>
                <span className="tabular-mono text-zinc-300">{wmSize}px</span>
              </div>
              <input
                type="range"
                min={18}
                max={54}
                step={2}
                value={wmSize}
                onChange={(e) => setWmSize(Number(e.target.value))}
                className="w-full accent-zinc-100"
              />
            </div>
          </div>
        </section>

        {/* Hook & Captions */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Gancho visual (Hook)</h2>
                <p className="text-xs text-zinc-500">Título de impacto nos primeiros segundos.</p>
              </div>
              <Switch checked={hookEnabled} onCheckedChange={setHookEnabled} />
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Estilo do card</label>
                <select
                  value={hookStyle}
                  onChange={(e) => setHookStyle(e.target.value as "white" | "red" | "black")}
                  className={SELECT_CLS}
                >
                  <option value="white">Caixa Branca (estilo Reels/Shorts)</option>
                  <option value="red">Alerta Vermelho</option>
                  <option value="black">Tarja Escura</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Posição</label>
                <select
                  value={hookPos}
                  onChange={(e) => setHookPos(e.target.value as "auto" | "middle" | "top")}
                  className={SELECT_CLS}
                >
                  <option value="auto">Automático por formato (acima no Blur / divisor no Dual)</option>
                  <option value="top">Sempre no topo / acima do vídeo</option>
                  <option value="middle">Centro / Divisor (Dual / Tela cheia)</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Legendas dinâmicas</h2>
                <p className="text-xs text-zinc-500">Sincronizadas palavra por palavra.</p>
              </div>
              <Switch checked={captions} onCheckedChange={setCaptions} />
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-400">Palavras por bloco</span>
                  <span className="tabular-mono text-zinc-300">{wordsPerGroup}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={6}
                  step={1}
                  value={wordsPerGroup}
                  onChange={(e) => setWordsPerGroup(Number(e.target.value))}
                  className="w-full accent-zinc-100"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Cor de destaque da palavra ativa
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {HIGHLIGHT_SWATCHES.map((s) => (
                    <button
                      key={s.hex}
                      type="button"
                      title={s.label}
                      onClick={() => setHighlightColor(s.hex)}
                      className={cn(
                        "h-6 w-6 rounded-full border transition-transform cursor-pointer",
                        highlightColor.toUpperCase() === s.hex
                          ? "scale-110 border-white ring-2 ring-white/30"
                          : "border-zinc-700 hover:scale-105",
                      )}
                      style={{ backgroundColor: s.hex }}
                    />
                  ))}
                  <input
                    type="color"
                    value={highlightColor}
                    onChange={(e) => setHighlightColor(e.target.value)}
                    className="h-6 w-8 cursor-pointer rounded border border-zinc-800 bg-zinc-950 p-0.5"
                    aria-label="Cor personalizada de destaque"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Default render mode */}
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <h2 className="text-sm font-semibold text-zinc-100">Enquadramento e segurança padrão</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Aplicados automaticamente em novas extrações e no Monitor RSS.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Formato padrão</label>
              <select
                value={defaultMode}
                onChange={(e) => setDefaultMode(e.target.value as RenderMode)}
                className={SELECT_CLS}
              >
                {(Object.keys(FMT_META) as RenderMode[]).map((m) => (
                  <option key={m} value={m}>
                    {FMT_META[m].label} — {FMT_META[m].short}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Posição da facecam</label>
              <select
                value={camPos}
                onChange={(e) => setCamPos(e.target.value)}
                className={SELECT_CLS}
              >
                <option value="auto">Auto (IA detecta rosto)</option>
                <option value="top-left">Canto superior esquerdo</option>
                <option value="top-right">Canto superior direito</option>
                <option value="mid-left">Meio esquerdo</option>
                <option value="mid-right">Meio direito</option>
                <option value="bottom-left">Canto inferior esquerdo</option>
                <option value="bottom-right">Canto inferior direito</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                <span>Censura +18 local</span>
                <Switch checked={censor18} onCheckedChange={setCensor18} />
              </label>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="primary" disabled={saving} onClick={() => handleSave(false)}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Salvando…" : "Salvar Brand Kit"}
          </Button>
          <Button variant="default" disabled={saving} onClick={() => handleSave(true)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Salvar e re-renderizar trabalho atual
          </Button>
        </div>
      </div>

      {/* Live 9:16 Simulator */}
      <aside className="xl:sticky xl:top-20 xl:self-start">
        <div className="rounded-xl border border-zinc-800/80 bg-[#121216] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">Prévia 9:16 ao vivo</span>
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              {FMT_META[defaultMode]?.label}
            </span>
          </div>

          <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-[22px] border border-zinc-700/70 bg-zinc-950 shadow-2xl">
            {/* Background layers according to format */}
            {defaultMode === "dual" || defaultMode === "dual_dopamine" ? (
              <div className="flex h-full flex-col">
                <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-zinc-800/70 to-zinc-900 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                  {defaultMode === "dual" ? "Facecam" : "Clipe Principal"}
                </div>
                <div className="h-px bg-zinc-700" />
                <div className="flex flex-[1.2] items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
                  {defaultMode === "dual" ? "Gameplay" : "B-Roll / Gameplay"}
                </div>
              </div>
            ) : defaultMode === "blur" || defaultMode === "card" || defaultMode === "fit" ? (
              <div
                className={cn(
                  "flex h-full items-center justify-center px-3",
                  defaultMode === "blur" ? "bg-zinc-900/90" : "bg-black",
                )}
              >
                <div
                  className={cn(
                    "flex aspect-video w-full items-center justify-center bg-zinc-800/80 text-[10px] font-medium uppercase tracking-widest text-zinc-400",
                    defaultMode === "card" ? "rounded-lg border border-zinc-600/60 shadow-lg" : "rounded-sm",
                  )}
                >
                  16:9 Source
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-gradient-to-b from-zinc-800/50 via-zinc-900 to-zinc-950 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                {defaultMode === "face" ? "Auto-Face 9:16" : "Crop 9:16"}
              </div>
            )}

            {/* Hook Overlay */}
            {hookEnabled && (
              <div className={cn("pointer-events-none absolute inset-x-4 z-10 flex justify-center", hookPosClass)}>
                <div
                  className={cn(
                    "max-w-[92%] rounded-md px-2.5 py-1 text-center text-[11px] font-bold leading-tight shadow-lg",
                    hookStyleClasses,
                  )}
                >
                  REAÇÃO ABSURDA NA LIVE
                </div>
              </div>
            )}

            {/* Captions Overlay */}
            {captions && (
              <div className="pointer-events-none absolute inset-x-3 bottom-12 z-10 text-center">
                <p className="text-[12px] font-extrabold uppercase tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]">
                  ISSO FOI{" "}
                  <span style={{ color: highlightColor }}>INSANO</span>
                  {wordsPerGroup > 3 ? " DEMAIS" : ""}
                </p>
              </div>
            )}

            {/* Watermark Overlay */}
            {wmEnabled && wmText.trim() && (
              <div
                className={cn(
                  "pointer-events-none absolute z-20 font-semibold tracking-tight text-white drop-shadow",
                  wmPosClasses[wmPos] || wmPosClasses["bottom-center"],
                )}
                style={{
                  opacity: wmOpacity / 100,
                  fontSize: `${Math.max(9, Math.round(wmSize * 0.34))}px`,
                }}
              >
                {wmText.trim()}
              </div>
            )}
          </div>

          <p className="mt-3 text-center text-[11px] text-zinc-500">
            Proporção aproximada de 1080×1920 (YouTube Shorts / Reels / TikTok).
          </p>
        </div>
      </aside>
    </div>
  );
}
