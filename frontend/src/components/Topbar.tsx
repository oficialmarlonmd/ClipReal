import { Layers, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { API } from "@/lib/api";
import { cn, VIEW_META } from "@/lib/utils";
import type { SettingsTab, StatusResponse, ViewId } from "@/types";

interface Props {
  view: ViewId;
  status: StatusResponse | null;
  onSelectView: (v: ViewId) => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onRefreshStatus: () => void;
}

export function Topbar({ view, status, onSelectView, onOpenSettings, onRefreshStatus }: Props) {
  const meta = VIEW_META[view];
  const wmOn =
    status?.render?.watermark !== false && Boolean((status?.channel?.watermark_text || "").trim());

  const handleYtQuickConnect = async () => {
    if (!status?.client_secret && !status?.oauth_broker_url) {
      onOpenSettings("yt");
      toast.info("Clique para conectar com Google (configure o Broker 1-clique ou envie client_secret.json).");
      return;
    }
    try {
      const r = await API.ytOAuthStart();
      if (r.mode === "broker" && r.auth_url) {
        window.open(r.auth_url, "clipsreal_yt_oauth", "width=560,height=720");
        toast.info("Entre com sua conta Google na janela aberta…");
      } else {
        toast.success(`Conectado: ${r.info?.title || "YouTube OK"}`);
        onRefreshStatus();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao conectar YouTube");
    }
  };

  const handleSocialQuickConnect = async (platform: "instagram" | "tiktok") => {
    const canOneClick =
      Boolean(status?.oauth_broker_url) ||
      (platform === "instagram" ? Boolean(status?.instagram_configured) : Boolean(status?.tiktok_configured));
    if (!canOneClick) {
      toast.info(
        `Para conectar ${platform === "instagram" ? "Instagram" : "TikTok"}, informe a URL do OAuth Broker ou cole Token/Chaves abaixo.`,
      );
      onOpenSettings("social");
      return;
    }
    try {
      const r =
        platform === "instagram"
          ? await API.igOAuthStart(status?.instagram?.login_type)
          : await API.ttOAuthStart(status?.tiktok?.post_mode);
      window.open(r.auth_url, `clipsreal_${platform}_oauth`, "width=560,height=720");
      toast.info(`Entre com sua conta ${platform === "instagram" ? "Instagram" : "TikTok"} na janela aberta…`);
    } catch {
      onOpenSettings("social");
    }
  };

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-800/80 bg-[#09090b]/90 px-6 py-3 backdrop-blur-md max-sm:px-4">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-50">{meta.title}</h1>
        <p className="truncate text-xs text-zinc-500">{meta.subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <StatusChip ok={Boolean(status?.ffmpeg)} label={status?.ffmpeg && !status.subtitles ? "FFmpeg (sem libass)" : "FFmpeg"} />
        <StatusChip
          ok={Boolean(status?.gemini)}
          label={status?.gemini ? status.gemini_model || "Gemini" : "Sem Gemini"}
          onClick={() => onOpenSettings("ai")}
        />
        {status?.youtube_auth ? (
          <StatusChip ok label="YouTube" onClick={() => onOpenSettings("yt")} />
        ) : (
          <button
            type="button"
            onClick={handleYtQuickConnect}
            className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
            <span>Conectar YouTube</span>
          </button>
        )}

        <StatusChip
          ok={Boolean(status?.instagram_auth)}
          label={
            status?.instagram_auth && status.instagram_user?.username
              ? `IG @${status.instagram_user.username.replace(/^@/, "")}`
              : status?.instagram_auth
                ? "Instagram"
                : "Conectar IG"
          }
          muted={!status?.instagram_auth}
          onClick={() => (status?.instagram_auth ? onOpenSettings("social") : handleSocialQuickConnect("instagram"))}
        />
        <StatusChip
          ok={Boolean(status?.tiktok_auth)}
          label={
            status?.tiktok_auth && (status.tiktok_user?.username || status.tiktok_user?.display_name)
              ? `TT ${status.tiktok_user.username ? `@${status.tiktok_user.username.replace(/^@/, "")}` : status.tiktok_user.display_name}`
              : status?.tiktok_auth
                ? "TikTok"
                : "Conectar TikTok"
          }
          muted={!status?.tiktok_auth}
          onClick={() => (status?.tiktok_auth ? onOpenSettings("social") : handleSocialQuickConnect("tiktok"))}
        />

        <button
          type="button"
          onClick={() => onSelectView("brand")}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-700 hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <Layers className="h-3 w-3 text-zinc-500" />
          <span>{wmOn ? status?.channel?.watermark_text : "Sem marca"}</span>
        </button>

        {(status?.queues.pipeline || 0) + (status?.queues.uploads || 0) > 0 && (
          <span className="tabular-mono inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
            <span>
              Fila {status?.queues.pipeline}R · {status?.queues.uploads}U
            </span>
          </span>
        )}

        <button
          type="button"
          onClick={() => onOpenSettings("ai")}
          aria-label="Abrir configurações"
          className="hidden h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100 max-lg:inline-flex cursor-pointer"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}

function StatusChip({
  ok,
  label,
  muted,
  onClick,
}: {
  ok: boolean;
  label: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
        ok
          ? "border-zinc-800 bg-zinc-900 text-zinc-200"
          : muted
            ? "border-zinc-800/80 bg-zinc-950 text-zinc-500 hover:text-zinc-300"
            : "border-rose-500/30 bg-rose-500/10 text-rose-300",
        onClick && "cursor-pointer hover:border-zinc-700 transition-colors",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-emerald-400" : muted ? "bg-zinc-600" : "bg-rose-400")} />
      <span>{label}</span>
    </Tag>
  );
}
