import { useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  Film,
  Layers,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API, uploadWithProgress } from "@/lib/api";
import { cn, FMT_META, statusColorClass } from "@/lib/utils";
import type { BrollItem, ClipItem, JobItem, RenderMode, SettingsTab, StatusResponse, ViewId } from "@/types";
import { ClipCard } from "@/views/ClipCard";

interface Props {
  status: StatusResponse | null;
  jobs: JobItem[];
  currentJobId: number | null;
  activeJob: (JobItem & { clips: ClipItem[] }) | null;
  brolls: BrollItem[];
  onSelectJob: (id: number | null) => void;
  onRefreshJobs: () => void;
  onRefreshJob: () => void;
  onRefreshStatus: () => void;
  onSwitchView: (v: ViewId, subTab?: string) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onRequestConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
}

const MODES: RenderMode[] = ["blur", "dual", "dual_dopamine", "card", "face", "crop", "fit"];

export function StudioView({
  status,
  jobs,
  currentJobId,
  activeJob,
  brolls,
  onSelectJob,
  onRefreshJobs,
  onRefreshJob,
  onRefreshStatus,
  onSwitchView,
  onOpenSettings,
  onRequestConfirm,
}: Props) {
  const initialized = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState("");
  const [mode, setMode] = useState<RenderMode>("blur");
  const [count, setCount] = useState("15");
  const [language, setLanguage] = useState("auto");
  const [minScore, setMinScore] = useState("60");
  const [camPos, setCamPos] = useState("auto");
  const [broll, setBroll] = useState("");
  const [hookStyle, setHookStyle] = useState<"white" | "red" | "black">("white");
  const [hookPos, setHookPos] = useState<"auto" | "middle" | "top">("auto");
  const [optHook, setOptHook] = useState(true);
  const [optCaps, setOptCaps] = useState(true);
  const [optCensor, setOptCensor] = useState(true);
  const [autoUpload, setAutoUpload] = useState(false);
  const [optWm, setOptWm] = useState(true);
  const [wmText, setWmText] = useState("@BabyDragonOFC");
  const [wmHint, setWmHint] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState("");

  const [clipFilter, setClipFilter] = useState<"all" | "selected" | "rendered" | "published">("all");
  const [clipSort, setClipSort] = useState<"score" | "time">("score");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!status || initialized.current) return;
    initialized.current = true;
    const initMode = (status.render?.mode as RenderMode) || "blur";
    setMode(initMode);
    setCount(String(status.clips?.target_count ?? 15));
    setLanguage(status.transcription_language || "auto");
    setMinScore(String(status.clips?.min_score ?? 50));
    setOptHook(status.render?.hook_title !== false);
    setOptCaps(status.render?.captions !== false);
    setOptCensor(status.render?.censor_18plus !== false);
    setOptWm(status.render?.watermark !== false);
    setWmText(status.channel?.watermark_text ?? "");
    if (status.render?.cam_position) setCamPos(status.render.cam_position);
    if (status.render?.hook_style) setHookStyle(status.render.hook_style);
    if (status.render?.hook_position) {
      const dualMode = initMode === "dual" || initMode === "dual_dopamine";
      setHookPos(!dualMode && status.render.hook_position === "middle" ? "auto" : status.render.hook_position);
    }
    if (status.render?.dopamine_video) setBroll(status.render.dopamine_video);
  }, [status]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentJobId]);

  const isDual = mode === "dual" || mode === "dual_dopamine";

  const handleModeSelect = (m: RenderMode) => {
    setMode(m);
    if (m !== "dual" && m !== "dual_dopamine" && hookPos === "middle") {
      setHookPos("auto");
    }
  };

  const handleSaveWatermark = async () => {
    try {
      await API.saveConfig({
        channel: { watermark_text: wmText.trim() },
        render: { watermark: optWm },
      });
      setWmHint("Salvo");
      toast.success("Marca d'água padrão salva");
      onRefreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar marca");
    }
  };

  const handleSubmitUrl = async () => {
    if (!source.trim()) {
      toast.error("Cole um link ou caminho de arquivo");
      return;
    }
    setSubmitting(true);
    try {
      const r = await API.createJob({
        source: source.trim(),
        count: Number(count) || 10,
        mode,
        language,
        min_score: Number(minScore) || 0,
        auto_upload: autoUpload,
        watermark: optWm,
        watermark_text: wmText.trim(),
        hook_title: optHook,
        hook_style: hookStyle,
        hook_position: isDual ? hookPos : (hookPos === "middle" ? "auto" : hookPos),
        cam_position: camPos,
        dopamine_video: broll,
        captions: optCaps,
        censor_18plus: optCensor,
      });
      setSource("");
      onSelectJob(r.id);
      toast.success(`Trabalho #${r.id} adicionado à fila (${FMT_META[mode].label})`);
      onRefreshJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar trabalho");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    setUploadName(file.name);
    setUploadPct(0);
    const fd = new FormData();
    fd.append("file", file);
    const q = new URLSearchParams({
      count,
      mode,
      min_score: minScore,
      language,
      auto_upload: String(autoUpload),
      watermark: String(optWm),
      watermark_text: wmText.trim(),
      hook_title: String(optHook),
      hook_style: hookStyle,
      hook_position: isDual ? hookPos : (hookPos === "middle" ? "auto" : hookPos),
      cam_position: camPos,
      dopamine_video: broll,
      captions: String(optCaps),
      censor_18plus: String(optCensor),
    });
    try {
      const r = await uploadWithProgress<{ id: number }>(`/api/jobs/upload?${q}`, fd, setUploadPct);
      onSelectJob(r.id);
      toast.success(`Arquivo enviado — trabalho #${r.id} na fila`);
      onRefreshJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setUploadPct(null);
      setUploadName("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clips = activeJob?.clips || [];
  const visibleClips = useMemo(() => {
    let list = [...clips];
    if (clipFilter === "selected") list = list.filter((c) => selectedIds.has(c.id));
    else if (clipFilter === "rendered") list = list.filter((c) => c.status === "rendered");
    else if (clipFilter === "published") {
      list = list.filter(
        (c) =>
          c.youtube_id ||
          c.status === "scheduled" ||
          c.status === "uploaded" ||
          c.ig_status === "published" ||
          c.tiktok_status === "published" ||
          c.tiktok_status === "inbox",
      );
    }
    if (clipSort === "time") list.sort((a, b) => (a.start || 0) - (b.start || 0));
    else list.sort((a, b) => (b.score || 0) - (a.score || 0));
    return list;
  }, [clips, clipFilter, clipSort, selectedIds]);

  const allSelected = visibleClips.length > 0 && visibleClips.every((c) => selectedIds.has(c.id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleClips.forEach((c) => next.delete(c.id));
      else visibleClips.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const batchRerender = async () => {
    if (!selectedIds.size) return;
    try {
      const r = await API.renderBatch({ clip_ids: [...selectedIds], captions: optCaps });
      toast.success(
        `${r.queued} corte(s) enviados para re-render (${optCaps ? "com legenda" : "sem legenda"})`,
      );
      onRefreshJob();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const batchCompile = async () => {
    if (selectedIds.size < 2) {
      toast.error("Selecione pelo menos 2 cortes");
      return;
    }
    try {
      const r = await API.compile([...selectedIds]);
      toast.success(`Compilação 16:9 na fila (#${r.id})`);
      onSelectJob(r.id);
      setSelectedIds(new Set());
      onRefreshJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const batchSchedule = async () => {
    if (!selectedIds.size) return;
    let ok = 0;
    for (const id of selectedIds) {
      try {
        await API.uploadClip(id, "auto");
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao agendar");
        break;
      }
    }
    if (ok) toast.success(`${ok} corte(s) enviados para agendamento`);
    onRefreshJob();
  };

  const selectedShortsCount = clips.filter((c) => selectedIds.has(c.id) && c.kind === "short").length;

  const batchPublishSocial = async (platform: "instagram" | "tiktok") => {
    if (!selectedShortsCount) {
      toast.error("Instagram Reels e TikTok aceitam apenas cortes verticais (9:16).");
      return;
    }
    if (platform === "instagram" && !status?.instagram_auth) {
      toast.error("Conecte seu Instagram primeiro em Chaves & API → Instagram & TikTok.");
      onOpenSettings("social");
      return;
    }
    if (platform === "tiktok" && !status?.tiktok_auth) {
      toast.error("Conecte seu TikTok primeiro em Chaves & API → Instagram & TikTok.");
      onOpenSettings("social");
      return;
    }
    try {
      const r = await API.publishBatch([...selectedIds], platform);
      toast.success(
        `${r.queued} corte(s) em pé enviado(s) para fila do ${platform === "instagram" ? "Instagram Reels" : "TikTok"}`,
      );
      onRefreshJob();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enfileirar publicação");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Intake Composer */}
      <section className="rounded-xl border border-zinc-800/90 bg-[#121216] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmitUrl(); }}
            placeholder="Cole a URL do YouTube, Twitch, Kick, Drive ou caminho local .mp4…"
            aria-label="URL do vídeo ou caminho local"
            className="h-9 min-w-[260px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-800">
            <Upload className="h-3.5 w-3.5 text-zinc-400" />
            <span>Arquivo</span>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
            />
          </label>
          <Button variant="primary" className="h-9 px-4" disabled={submitting} onClick={handleSubmitUrl}>
            {submitting ? "Enfileirando…" : "Gerar cortes"}
          </Button>
        </div>

        {/* Compact Format Selector */}
        <div className="mt-3.5">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-zinc-400">Enquadramento 9:16</span>
            <span className="text-zinc-500">{FMT_META[mode].desc}</span>
          </div>
          <div className="grid grid-cols-7 gap-2 max-xl:grid-cols-4 max-sm:grid-cols-2">
            {MODES.map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeSelect(m)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer",
                    active
                      ? "border-zinc-300 bg-zinc-800/80 text-zinc-50"
                      : "border-zinc-800/90 bg-zinc-950/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
                  )}
                >
                  <FormatGlyph mode={m} active={active} />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{FMT_META[m].label}</div>
                    <div className="truncate text-[10.5px] text-zinc-500">{FMT_META[m].short}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Contextual Dual / Dopamine bar */}
        {isDual && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs">
            <label className="flex items-center gap-2 text-zinc-400">
              <span>Facecam</span>
              <select
                value={camPos}
                onChange={(e) => setCamPos(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              >
                <option value="auto">Auto (IA)</option>
                <option value="top-left">Topo Esq.</option>
                <option value="top-right">Topo Dir.</option>
                <option value="mid-left">Meio Esq.</option>
                <option value="mid-right">Meio Dir.</option>
                <option value="bottom-left">Base Esq.</option>
                <option value="bottom-right">Base Dir.</option>
              </select>
            </label>

            {mode === "dual_dopamine" && (
              <label className="flex items-center gap-2 text-zinc-400">
                <span>B-Roll</span>
                <select
                  value={broll}
                  onChange={(e) => setBroll(e.target.value)}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                >
                  <option value="">Auto (Cam + Game + Banner)</option>
                  {brolls.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name} ({b.size_mb} MB)
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Button size="sm" variant="ghost" onClick={() => onSwitchView("library", "broll")}>
              Gerenciar B-Roll
            </Button>

            <label className="flex items-center gap-2 text-zinc-400">
              <span>Gancho</span>
              <select
                value={hookStyle}
                onChange={(e) => setHookStyle(e.target.value as "white" | "red" | "black")}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              >
                <option value="white">Caixa Branca</option>
                <option value="red">Banner Vermelho</option>
                <option value="black">Faixa Preta</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-zinc-400">
              <span>Posição</span>
              <select
                value={hookPos}
                onChange={(e) => setHookPos(e.target.value as "auto" | "middle" | "top")}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              >
                <option value="auto">Auto</option>
                <option value="middle">Centro / Divisor</option>
                <option value="top">Topo</option>
              </select>
            </label>
          </div>
        )}

        {/* Parameters + Brand strip */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/80 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-zinc-400">
              <span>Cortes</span>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="tabular-mono h-7 w-16 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-center text-xs text-zinc-100"
              />
            </label>
            <label className="flex items-center gap-1.5 text-zinc-400">
              <span>Idioma</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100"
              >
                <option value="auto">Auto</option>
                <option value="pt">PT-BR</option>
                <option value="en">EN</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-zinc-400">
              <span>Score mín.</span>
              <input
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                className="tabular-mono h-7 w-16 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-center text-xs text-zinc-100"
              />
            </label>

            <div className="h-4 w-px bg-zinc-800 max-sm:hidden" />

            <div
              role="group"
              aria-label="Legendas automáticas nos cortes"
              title="Escolha Sem legenda se o vídeo original já vier legendado"
              className="inline-flex h-7 items-center rounded-md border border-zinc-800 bg-zinc-950 p-0.5"
            >
              <button
                type="button"
                aria-pressed={optCaps}
                onClick={() => setOptCaps(true)}
                className={cn(
                  "inline-flex h-full items-center gap-1 rounded px-2 text-xs font-medium transition-colors cursor-pointer",
                  optCaps
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                <Captions className="h-3.5 w-3.5" />
                <span>Com legenda</span>
              </button>
              <button
                type="button"
                aria-pressed={!optCaps}
                onClick={() => setOptCaps(false)}
                className={cn(
                  "inline-flex h-full items-center gap-1 rounded px-2 text-xs font-medium transition-colors cursor-pointer",
                  !optCaps
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                <CaptionsOff className="h-3.5 w-3.5" />
                <span>Sem legenda</span>
              </button>
            </div>

            <ToggleChip label="Gancho" checked={optHook} onChange={setOptHook} />
            <ToggleChip
              label="Censura +18"
              checked={optCensor}
              onChange={setOptCensor}
              icon={<ShieldCheck className="h-3 w-3" />}
            />
            <ToggleChip label="Auto-agendar" checked={autoUpload} onChange={setAutoUpload} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ToggleChip label="Marca" checked={optWm} onChange={(v) => { setOptWm(v); setWmHint("Alterado"); }} />
            <input
              value={wmText}
              maxLength={60}
              onChange={(e) => { setWmText(e.target.value); setWmHint("Não salvo"); }}
              placeholder="@handle"
              aria-label="Texto da marca d'água"
              className="h-7 w-36 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
            <Button size="sm" onClick={handleSaveWatermark}>
              Salvar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onSwitchView("brand")}>
              <Layers className="h-3.5 w-3.5" />
              <span>Brand Kit</span>
            </Button>
            {wmHint && <span className="text-[11px] text-zinc-500">{wmHint}</span>}
          </div>
        </div>

        {uploadPct !== null && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-zinc-400">
              <span className="truncate">Enviando {uploadName}</span>
              <span className="tabular-mono">{uploadPct}%</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-zinc-100 transition-all" style={{ width: `${uploadPct}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* Master-Detail Workspace */}
      <div className="grid grid-cols-[284px_1fr] items-start gap-4 max-lg:grid-cols-1">
        {/* Jobs Queue Rail */}
        <aside className="sticky top-[68px] max-h-[calc(100vh-88px)] overflow-y-auto rounded-xl border border-zinc-800/90 bg-[#121216] p-3.5 max-lg:static max-lg:max-h-none">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-zinc-100">Trabalhos</h2>
            <span className="tabular-mono rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-400 border border-zinc-800">
              {jobs.length}
            </span>
          </div>

          {jobs.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              Nenhum trabalho ainda. Cole um link ou envie um arquivo acima.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {jobs.map((j) => {
                const active = currentJobId === j.id;
                const pct = Math.round((j.progress || 0) * 100);
                const stLabel = j.status === "done" ? "Concluído" : j.status === "error" ? "Erro" : j.stage || j.status;
                return (
                  <div
                    key={j.id}
                    onClick={() => onSelectJob(j.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelectJob(j.id); }}
                    className={cn(
                      "group rounded-lg border p-2.5 transition-colors cursor-pointer",
                      active
                        ? "border-zinc-500 bg-zinc-800/70"
                        : "border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-900/70",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {j.kind === "compilation" && <Film className="h-3.5 w-3.5 shrink-0 text-zinc-400" />}
                        <span className="truncate text-xs font-medium text-zinc-100" title={j.title || j.source}>
                          {j.title || j.source}
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Excluir trabalho #${j.id}`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onRequestConfirm({
                            title: `Excluir trabalho #${j.id}?`,
                            message: "O trabalho e os arquivos renderizados serão removidos permanentemente.",
                            confirmLabel: "Excluir",
                            danger: true,
                            onConfirm: async () => {
                              await API.deleteJob(j.id);
                              if (currentJobId === j.id) onSelectJob(null);
                              onRefreshJobs();
                              toast.success(`Trabalho #${j.id} excluído`);
                            },
                          });
                        }}
                        className="rounded p-1 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-800 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className={cn("truncate font-medium", statusColorClass(j.status))}>
                        {stLabel}
                        {j.status === "running" ? ` (${pct}%)` : ""}
                      </span>
                      <span className="tabular-mono text-zinc-500">#{j.id}</span>
                    </div>

                    {(j.status === "running" || j.status === "queued") && (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full bg-zinc-200 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Clips Panel */}
        <section className="rounded-xl border border-zinc-800/90 bg-[#121216] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/80 pb-3.5">
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold text-zinc-100">
                {activeJob ? activeJob.title || activeJob.source : "Selecione um trabalho"}
              </h2>
              {activeJob && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span className={cn("font-medium", statusColorClass(activeJob.status))}>
                    {activeJob.status}
                  </span>
                  {activeJob.stage && <span>· {activeJob.stage}</span>}
                  {activeJob.duration ? <span className="tabular-mono">· {Math.round(activeJob.duration / 60)} min</span> : null}
                  {clips.length > 0 && <span className="tabular-mono">· {clips.length} cortes</span>}
                  {activeJob.message && <span className="text-zinc-500">· {activeJob.message}</span>}
                  {activeJob.status === "error" && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await API.retryJob(activeJob.id);
                        toast.info("Reprocessando trabalho…");
                        onRefreshJobs();
                        onRefreshJob();
                      }}
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Tentar novamente</span>
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={clipFilter}
                onChange={(e) => setClipFilter(e.target.value as typeof clipFilter)}
                aria-label="Filtrar cortes"
                className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
              >
                <option value="all">Todos</option>
                <option value="selected">Selecionados</option>
                <option value="rendered">Prontos</option>
                <option value="published">Publicados / Agendados</option>
              </select>
              <select
                value={clipSort}
                onChange={(e) => setClipSort(e.target.value as typeof clipSort)}
                aria-label="Ordenar cortes"
                className="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
              >
                <option value="score">Score ↓</option>
                <option value="time">Ordem no vídeo</option>
              </select>
              <Button size="sm" onClick={toggleSelectAll}>
                {allSelected ? "Limpar" : "Selecionar todos"}
              </Button>
              <Button size="sm" disabled={selectedIds.size < 1} onClick={batchRerender}>
                Re-render ({selectedIds.size})
              </Button>
              <Button size="sm" variant="subtle" disabled={selectedIds.size < 2} onClick={batchCompile}>
                Compilar 16:9 ({selectedIds.size})
              </Button>
              <Button size="sm" variant="primary" disabled={selectedIds.size < 1} onClick={batchSchedule}>
                Agendar YT ({selectedIds.size})
              </Button>
              <Button
                size="sm"
                disabled={selectedShortsCount < 1}
                onClick={() => batchPublishSocial("instagram")}
                title="Publicar cortes verticais selecionados no Instagram Reels"
              >
                Reels ({selectedShortsCount})
              </Button>
              <Button
                size="sm"
                disabled={selectedShortsCount < 1}
                onClick={() => batchPublishSocial("tiktok")}
                title="Publicar cortes verticais selecionados no TikTok"
              >
                TikTok ({selectedShortsCount})
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-2">
            {visibleClips.length === 0 ? (
              <div className="col-span-full rounded-lg border border-dashed border-zinc-800 py-14 text-center text-xs text-zinc-500">
                {!activeJob
                  ? "Selecione um trabalho à esquerda ou inicie uma nova extração acima."
                  : activeJob.status === "done"
                    ? "Nenhum corte corresponde ao filtro atual."
                    : activeJob.status === "error"
                      ? "O trabalho falhou — ajuste a causa acima e clique em Tentar novamente."
                      : "Processando… os cortes renderizados aparecem aqui automaticamente."}
              </div>
            ) : (
              visibleClips.map((c) => (
                <ClipCard
                  key={c.id}
                  clip={c}
                  status={status}
                  defaultMode={mode}
                  defaultCaptions={
                    typeof activeJob?.options?.captions === "boolean"
                      ? activeJob.options.captions
                      : optCaps
                  }
                  selected={selectedIds.has(c.id)}
                  onToggleSelect={toggleSelect}
                  onRefresh={onRefreshJob}
                  onOpenSettings={onOpenSettings}
                  onConfirmPublishNow={(cid, saveFn) =>
                    onRequestConfirm({
                      title: `Publicar corte #${cid} agora?`,
                      message: "O vídeo será enviado e publicado imediatamente no canal do YouTube conectado.",
                      confirmLabel: "Publicar agora",
                      onConfirm: () => { void saveFn(); },
                    })
                  }
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ToggleChip({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors cursor-pointer",
        checked
          ? "border-zinc-600 bg-zinc-800 text-zinc-100"
          : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-zinc-300",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", checked ? "bg-emerald-400" : "bg-zinc-600")} />
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FormatGlyph({ mode, active }: { mode: RenderMode; active: boolean }) {
  const stroke = active ? "border-zinc-400" : "border-zinc-700";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex h-8 w-5 shrink-0 flex-col items-center justify-center overflow-hidden rounded-[3px] border bg-zinc-950",
        stroke,
      )}
    >
      {mode === "blur" && <div className="h-3 w-full border-y border-zinc-600 bg-zinc-800" />}
      {mode === "dual" && (
        <>
          <div className="h-[38%] w-full border-b border-zinc-700 bg-zinc-800" />
          <div className="h-[62%] w-full bg-zinc-900" />
        </>
      )}
      {mode === "dual_dopamine" && (
        <>
          <div className="h-[44%] w-full bg-zinc-800" />
          <div className="h-[3px] w-full bg-zinc-200" />
          <div className="h-[52%] w-full bg-zinc-900" />
        </>
      )}
      {mode === "card" && <div className="h-3 w-4 rounded-[2px] border border-zinc-600 bg-zinc-800" />}
      {mode === "face" && <div className="h-2.5 w-2.5 rounded-full border border-zinc-300" />}
      {mode === "crop" && <div className="h-full w-full bg-zinc-800/80" />}
      {mode === "fit" && <div className="h-2.5 w-full bg-zinc-700" />}
    </div>
  );
}
