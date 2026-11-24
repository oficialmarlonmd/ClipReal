import { useEffect, useState } from "react";
import {
  Captions,
  CaptionsOff,
  Check,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/api";
import { cleanScoreLabel, cn, FMT_META, SCORE_LABELS, scoreBadgeClass } from "@/lib/utils";
import type { ClipItem, RenderMode, SettingsTab, StatusResponse } from "@/types";

interface Props {
  clip: ClipItem;
  status: StatusResponse | null;
  defaultMode: RenderMode;
  defaultCaptions: boolean;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onRefresh: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onConfirmPublishNow: (clipId: number, saveFn: () => Promise<void>) => void;
}

const FIELD_CLS =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";

export function ClipCard({
  clip,
  status,
  defaultMode,
  defaultCaptions,
  selected,
  onToggleSelect,
  onRefresh,
  onOpenSettings,
  onConfirmPublishNow,
}: Props) {
  const [title, setTitle] = useState(clip.title || "");
  const [description, setDescription] = useState(clip.description || "");
  const [hashtags, setHashtags] = useState((clip.hashtags || []).join(" "));
  const [tags, setTags] = useState((clip.tags || []).join(", "));
  const [hook, setHook] = useState(clip.hook || "");
  const [start, setStart] = useState(String(clip.start ?? 0));
  const [end, setEnd] = useState(String(clip.end ?? 0));
  const [mode, setMode] = useState<RenderMode>(
    (clip.render_mode as RenderMode) || defaultMode || "blur",
  );
  const [withCaptions, setWithCaptions] = useState<boolean>(defaultCaptions);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<"seo" | "score">("seo");

  // Sync incoming server data only when user has no unsaved local edits
  useEffect(() => {
    if (dirty) return;
    setTitle(clip.title || "");
    setDescription(clip.description || "");
    setHashtags((clip.hashtags || []).join(" "));
    setTags((clip.tags || []).join(", "));
    setHook(clip.hook || "");
    setStart(String(clip.start ?? 0));
    setEnd(String(clip.end ?? 0));
    setMode(((clip.render_mode as RenderMode) || defaultMode || "blur"));
  }, [clip, defaultMode, dirty]);

  const payload = () => {
    const out: Record<string, unknown> = {
      title,
      description,
      hashtags: hashtags.split(/\s+/).filter(Boolean),
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    if (clip.kind === "short") {
      out.hook = hook;
      out.start = Number(start) || 0;
      out.end = Number(end) || 0;
    }
    return out;
  };

  const save = async (silent = false) => {
    setBusy("save");
    try {
      await API.patchClip(clip.id, payload());
      setDirty(false);
      if (!silent) toast.success("Alterações salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const regenSeo = async () => {
    setBusy("seo");
    try {
      await API.regenSeo(clip.id);
      setDirty(false);
      onRefresh();
      toast.success("SEO atualizado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao gerar SEO");
    } finally {
      setBusy(null);
    }
  };

  const rerender = async () => {
    setBusy("render");
    try {
      await save(true);
      await API.renderClip(clip.id, { mode, captions: withCaptions, use_saved_style: true });
      toast.info(
        `Re-renderizando em ${FMT_META[mode]?.label || mode} (${withCaptions ? "com legenda" : "sem legenda"})…`,
      );
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao re-renderizar");
    } finally {
      setBusy(null);
    }
  };

  const upload = async (schedule: "auto" | "now") => {
    setBusy("upload");
    try {
      await save(true);
      await API.uploadClip(clip.id, schedule);
      toast.info(schedule === "auto" ? "Agendando no próximo slot livre…" : "Publicando no YouTube…");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro no upload");
    } finally {
      setBusy(null);
    }
  };

  const publishInstagram = async () => {
    if (!status?.instagram_auth) {
      toast.error("Conecte o Instagram primeiro em Chaves & API → Instagram & TikTok.");
      onOpenSettings("social");
      return;
    }
    setBusy("ig");
    try {
      await save(true);
      await API.publishInstagram(clip.id);
      toast.info("Enviando corte vertical para o Instagram Reels…");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao publicar no Instagram");
    } finally {
      setBusy(null);
    }
  };

  const publishTikTok = async () => {
    if (!status?.tiktok_auth) {
      toast.error("Conecte o TikTok primeiro em Chaves & API → Instagram & TikTok.");
      onOpenSettings("social");
      return;
    }
    setBusy("tt");
    try {
      await save(true);
      await API.publishTikTok(clip.id);
      toast.info("Enviando corte vertical para o TikTok…");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao publicar no TikTok");
    } finally {
      setBusy(null);
    }
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(`${title}\n\n${description}\n\nTags: ${tags}`);
    toast.success("Metadados copiados");
  };

  const dur = Math.max(0, (Number(end) || 0) - (Number(start) || 0)).toFixed(1);
  const bd = clip.breakdown || {};
  const labelText = cleanScoreLabel(clip.score_label) || clip.score_label || "";

  return (
    <article
      className={cn(
        "rounded-xl border bg-[#131317] p-3.5 transition-colors",
        selected ? "border-zinc-400 ring-1 ring-zinc-400/40" : "border-zinc-800/90 hover:border-zinc-700",
        clip.kind === "long" ? "flex flex-col gap-3" : "grid grid-cols-[172px_1fr] gap-4 max-sm:grid-cols-1",
      )}
    >
      {/* Preview media */}
      <div className={cn("relative shrink-0", clip.kind === "long" ? "w-full" : "w-[172px] max-sm:w-full")}>
        {clip.video_url ? (
          <video
            src={clip.video_url}
            controls
            preload="metadata"
            poster={clip.thumb_url || undefined}
            className={cn(
              "w-full rounded-lg border border-zinc-800 bg-black object-cover",
              clip.kind === "long" ? "aspect-video" : "aspect-[9/16] max-sm:max-h-[420px]",
            )}
          />
        ) : (
          <div
            className={cn(
              "flex w-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-xs text-zinc-500",
              clip.kind === "long" ? "aspect-video" : "aspect-[9/16]",
            )}
          >
            {clip.status}…
          </div>
        )}
      </div>

      {/* Inspector */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "tabular-mono inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold",
                scoreBadgeClass(clip.score || 0),
              )}
            >
              {Math.round(clip.score || 0)}
            </span>
            {labelText && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300 border border-zinc-800">
                {labelText}
              </span>
            )}
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-400 border border-zinc-800">
              {clip.category || clip.kind}
            </span>
            {clip.kind === "short" && (
              <span className="tabular-mono rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-400 border border-zinc-800">
                {dur}s
              </span>
            )}
            {clip.youtube_id && (
              <a
                href={clip.youtube_url || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                <span>
                  {clip.status === "scheduled" && clip.publish_at
                    ? `Agendado ${new Date(clip.publish_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`
                    : "YT Publicado"}
                </span>
              </a>
            )}
            {clip.ig_status === "published" && (
              clip.ig_url ? (
                <a
                  href={clip.ig_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30 hover:underline"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  <span>No Reels</span>
                </a>
              ) : (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
                  No Reels
                </span>
              )
            )}
            {clip.ig_status === "uploading" && (
              <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 border border-sky-500/30">
                IG enviando…
              </span>
            )}
            {(clip.tiktok_status === "published" || clip.tiktok_status === "inbox") && (
              clip.tiktok_url ? (
                <a
                  href={clip.tiktok_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30 hover:underline"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  <span>{clip.tiktok_status === "inbox" ? "Rascunho TikTok" : "No TikTok"}</span>
                </a>
              ) : (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/30">
                  {clip.tiktok_status === "inbox" ? "Rascunho TikTok" : "No TikTok"}
                </span>
              )
            )}
            {clip.tiktok_status === "uploading" && (
              <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 border border-sky-500/30">
                TikTok enviando…
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setPanel("seo")}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                  panel === "seo" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                SEO
              </button>
              <button
                type="button"
                onClick={() => setPanel("score")}
                className={cn(
                  "rounded px-2 py-0.5 font-medium transition-colors cursor-pointer",
                  panel === "score" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                Score &amp; Tags
              </button>
            </div>

            <button
              type="button"
              onClick={() => onToggleSelect(clip.id)}
              aria-pressed={selected}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors cursor-pointer",
                selected
                  ? "border-zinc-200 bg-zinc-100 text-zinc-950"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {selected && <Check className="h-3 w-3" />}
              <span>{selected ? "Selecionado" : "Selecionar"}</span>
            </button>
          </div>
        </div>

        {clip.reason && (
          <p className="rounded-md border-l-2 border-zinc-600 bg-zinc-900/70 px-2.5 py-1.5 text-xs text-zinc-300">
            {clip.reason}
          </p>
        )}

        {panel === "seo" ? (
          <div className="flex flex-col gap-2">
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                <span>Título</span>
                <span className={cn("tabular-mono", title.length > 95 ? "text-rose-400" : title.length > 75 ? "text-amber-400" : "")}>
                  {title.length}/100
                </span>
              </div>
              <input
                maxLength={100}
                value={title}
                onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                className={FIELD_CLS}
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                <span>Descrição</span>
                <span className="tabular-mono">{description.length} chars</span>
              </div>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                className={cn(FIELD_CLS, "resize-y leading-relaxed")}
              />
            </div>

            {clip.kind === "short" && (
              <div className="grid grid-cols-[1fr_76px_76px] gap-2 max-sm:grid-cols-2">
                <div className="max-sm:col-span-2">
                  <span className="mb-1 block text-[11px] text-zinc-500">Gancho na tela</span>
                  <input
                    value={hook}
                    onChange={(e) => { setHook(e.target.value); setDirty(true); }}
                    className={FIELD_CLS}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-zinc-500">Início (s)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={start}
                    onChange={(e) => { setStart(e.target.value); setDirty(true); }}
                    className={cn(FIELD_CLS, "tabular-mono")}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[11px] text-zinc-500">Fim (s)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={end}
                    onChange={(e) => { setEnd(e.target.value); setDirty(true); }}
                    className={cn(FIELD_CLS, "tabular-mono")}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {Object.keys(SCORE_LABELS).some((k) => k in bd) && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-2.5">
                {Object.keys(SCORE_LABELS)
                  .filter((k) => k in bd)
                  .map((k) => (
                    <div key={k} className="grid grid-cols-[62px_1fr_26px] items-center gap-2 text-[11px]">
                      <span className="text-zinc-400">{SCORE_LABELS[k]}</span>
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-zinc-200" style={{ width: `${bd[k]}%` }} />
                      </div>
                      <span className="tabular-mono text-right text-zinc-300">{Math.round(bd[k])}</span>
                    </div>
                  ))}
              </div>
            )}

            <div>
              <span className="mb-1 block text-[11px] text-zinc-500">Hashtags</span>
              <input
                value={hashtags}
                onChange={(e) => { setHashtags(e.target.value); setDirty(true); }}
                className={FIELD_CLS}
              />
            </div>

            <div>
              <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                <span>Tags ({clip.kind === "long" ? "vídeo longo" : "Shorts"})</span>
                <span className={cn("tabular-mono", tags.length > 480 ? "text-rose-400" : tags.length > 420 ? "text-amber-400" : "")}>
                  {tags.length}/480
                </span>
              </div>
              <input
                value={tags}
                onChange={(e) => { setTags(e.target.value); setDirty(true); }}
                className={FIELD_CLS}
              />
            </div>
          </div>
        )}

        {clip.error && (
          <div className="max-h-24 overflow-auto rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 whitespace-pre-wrap">
            {clip.error}
          </div>
        )}
        {clip.ig_error && (
          <div className="max-h-24 overflow-auto rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 whitespace-pre-wrap">
            {clip.ig_error}
          </div>
        )}
        {clip.tiktok_error && (
          <div className="max-h-24 overflow-auto rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300 whitespace-pre-wrap">
            {clip.tiktok_error}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <Button
            size="sm"
            variant={dirty ? "subtle" : "default"}
            className={dirty ? "border-amber-500/50 text-amber-300" : ""}
            disabled={busy !== null}
            onClick={() => save(false)}
          >
            <Save className="h-3 w-3" />
            <span>{dirty ? "Salvar*" : "Salvar"}</span>
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={regenSeo}>
            <Sparkles className="h-3 w-3" />
            <span>{busy === "seo" ? "Gerando…" : "Regerar SEO"}</span>
          </Button>

          {clip.kind === "short" && (
            <>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as RenderMode)}
                aria-label="Formato para re-renderizar"
                className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200"
              >
                {(Object.keys(FMT_META) as RenderMode[]).map((k) => (
                  <option key={k} value={k}>
                    {FMT_META[k].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-pressed={withCaptions}
                onClick={() => setWithCaptions((v) => !v)}
                title="Alternar entre gerar com legenda ou sem legenda ao re-renderizar"
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors cursor-pointer",
                  withCaptions
                    ? "border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
                )}
              >
                {withCaptions ? <Captions className="h-3.5 w-3.5" /> : <CaptionsOff className="h-3.5 w-3.5" />}
                <span>{withCaptions ? "Com legenda" : "Sem legenda"}</span>
              </button>
              <Button size="sm" disabled={busy !== null} onClick={rerender}>
                <RefreshCw className="h-3 w-3" />
                <span>Re-render</span>
              </Button>
            </>
          )}

          <Button size="sm" onClick={copyAll}>
            <Copy className="h-3 w-3" />
            <span>Copiar</span>
          </Button>

          {clip.video_url && (
            <a
              href={clip.video_url}
              download
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <Download className="h-3 w-3" />
              <span>MP4</span>
            </a>
          )}

          {clip.thumb_url && (
            <a
              href={clip.thumb_url}
              download
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <Download className="h-3 w-3" />
              <span>Capa</span>
            </a>
          )}

          {!clip.youtube_id &&
            Boolean(clip.video_url) &&
            (clip.status === "rendered" || clip.status === "error") && (
            <>
              <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => upload("auto")}>
                <Upload className="h-3 w-3" />
                <span>Agendar YT</span>
              </Button>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => onConfirmPublishNow(clip.id, () => upload("now"))}
              >
                Publicar já
              </Button>
            </>
          )}

          {clip.kind === "short" &&
            Boolean(clip.video_url) &&
            clip.status !== "rendering" &&
            clip.status !== "pending" && (
            <>
              <Button
                size="sm"
                disabled={busy !== null || clip.ig_status === "uploading"}
                onClick={publishInstagram}
                title="Postar corte em pé no Instagram Reels"
              >
                <Share2 className="h-3 w-3" />
                <span>
                  {clip.ig_status === "uploading"
                    ? "IG…"
                    : clip.ig_status === "published"
                      ? "Repostar IG"
                      : "IG Reels"}
                </span>
              </Button>
              <Button
                size="sm"
                disabled={busy !== null || clip.tiktok_status === "uploading"}
                onClick={publishTikTok}
                title="Postar corte em pé no TikTok"
              >
                <Share2 className="h-3 w-3" />
                <span>
                  {clip.tiktok_status === "uploading"
                    ? "TikTok…"
                    : clip.tiktok_status === "published" || clip.tiktok_status === "inbox"
                      ? "Repostar TT"
                      : "TikTok"}
                </span>
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
