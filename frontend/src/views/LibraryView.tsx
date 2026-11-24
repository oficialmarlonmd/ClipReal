import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, ExternalLink, Film, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/api";
import { cn, scoreBadgeClass, statusColorClass } from "@/lib/utils";
import type { BrollItem, ClipItem, StatusResponse } from "@/types";

interface Props {
  status: StatusResponse | null;
  brolls: BrollItem[];
  initialTab?: "clips" | "broll";
  onOpenJobInStudio: (jobId: number) => void;
  onRefreshBrolls: () => void;
  onRefreshStatus: () => void;
  onRequestConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
}

export function LibraryView({
  status,
  brolls,
  initialTab = "clips",
  onOpenJobInStudio,
  onRefreshBrolls,
  onRefreshStatus,
  onRequestConfirm,
}: Props) {
  const [tab, setTab] = useState<"clips" | "broll">(initialTab);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [uploadingBroll, setUploadingBroll] = useState(false);
  const brollInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const list = await API.clips();
        if (active) setClips(list);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao carregar biblioteca");
      } finally {
        if (active) setLoading(false);
      }
    };
    if (tab === "clips") {
      load();
    } else {
      onRefreshBrolls();
    }
    return () => {
      active = false;
    };
  }, [tab, onRefreshBrolls]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clips.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (c.title || "").toLowerCase().includes(q) ||
        (c.job_title || "").toLowerCase().includes(q) ||
        (c.category || "").toLowerCase().includes(q)
      );
    });
  }, [clips, query, statusFilter]);

  const handleUploadBroll = async (file?: File | null) => {
    if (!file) return;
    setUploadingBroll(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await API.uploadBroll(fd);
      toast.success(`B-Roll "${file.name}" adicionado.`);
      onRefreshBrolls();
      onRefreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar B-Roll");
    } finally {
      setUploadingBroll(false);
      if (brollInputRef.current) brollInputRef.current.value = "";
    }
  };

  const handleSetDefaultBroll = async (name: string) => {
    try {
      await API.saveConfig({ render: { dopamine_video: name } });
      toast.success(`B-Roll padrão definido: ${name}`);
      onRefreshStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao definir padrão");
    }
  };

  const handleDeleteBroll = (name: string) => {
    onRequestConfirm({
      title: "Remover vídeo B-Roll",
      message: `Tem certeza que deseja excluir "${name}" da pasta de B-Rolls?`,
      confirmLabel: "Excluir B-Roll",
      danger: true,
      onConfirm: async () => {
        try {
          await API.deleteBroll(name);
          toast.success("B-Roll removido.");
          onRefreshBrolls();
          onRefreshStatus();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Erro ao remover B-Roll");
        }
      },
    });
  };

  const defaultBroll = status?.render?.dopamine_video || "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-[#121216] p-1">
          <button
            type="button"
            onClick={() => setTab("clips")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              tab === "clips" ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            Cortes gerados ({clips.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("broll")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
              tab === "broll" ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            Vídeos B-Roll ({brolls.length})
          </button>
        </div>

        {tab === "clips" ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar título, live ou categoria…"
                className="w-64 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="all">Todos os status</option>
              <option value="rendered">Renderizados</option>
              <option value="scheduled">Agendados</option>
              <option value="uploaded">Publicados</option>
              <option value="error">Com erro</option>
            </select>
          </div>
        ) : (
          <div>
            <input
              ref={brollInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleUploadBroll(e.target.files?.[0])}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={uploadingBroll}
              onClick={() => brollInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploadingBroll ? "Enviando…" : "Adicionar vídeo B-Roll"}
            </Button>
          </div>
        )}
      </div>

      {tab === "clips" ? (
        loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-72 animate-pulse rounded-xl border border-zinc-800/80 bg-[#121216]"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-[#121216]/60 px-6 py-16 text-center">
            <Film className="mx-auto mb-2 h-6 w-6 text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">Nenhum corte encontrado</p>
            <p className="mt-1 text-xs text-zinc-500">
              Ajuste os filtros ou inicie uma nova extração no Studio.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((c) => (
              <article
                key={c.id}
                className="flex flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121216]"
              >
                <div className="relative aspect-[9/14] bg-black">
                  {c.video_url ? (
                    <video
                      src={c.video_url}
                      poster={c.thumb_url || undefined}
                      controls
                      preload="metadata"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                      Sem arquivo renderizado
                    </div>
                  )}
                  <span
                    className={cn(
                      "tabular-mono absolute left-2 top-2 rounded border px-1.5 py-0.5 text-[11px] font-semibold backdrop-blur",
                      scoreBadgeClass(c.score),
                    )}
                  >
                    {Math.round(c.score)}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-[13px] font-medium text-zinc-100">
                      {c.title || `Corte #${c.idx}`}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {c.job_title || `Job #${c.job_id}`} ·{" "}
                      <span className={statusColorClass(c.status)}>{c.status}</span>
                    </p>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 pt-2">
                    <Button
                      size="xs"
                      variant="default"
                      className="flex-1"
                      onClick={() => onOpenJobInStudio(c.job_id)}
                    >
                      Abrir no Studio
                    </Button>
                    {c.video_url && (
                      <a
                        href={c.video_url}
                        download
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-zinc-50"
                        title="Baixar MP4"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {c.youtube_url && (
                      <a
                        href={c.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:text-zinc-50"
                        title="Abrir no YouTube"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      ) : brolls.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-[#121216]/60 px-6 py-16 text-center">
          <Film className="mx-auto mb-2 h-6 w-6 text-zinc-600" />
          <p className="text-sm font-medium text-zinc-300">Nenhum vídeo B-Roll cadastrado</p>
          <p className="mt-1 text-xs text-zinc-500">
            Envie clipes de gameplay, parkour ou corrida (MP4) para usar no formato Dual Dopamine.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brolls.map((b) => {
            const isDefault = defaultBroll === b.name;
            return (
              <div
                key={b.name}
                className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121216]"
              >
                <div className="aspect-video bg-black">
                  <video src={b.url} controls preload="metadata" className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-zinc-100">{b.name}</p>
                    <p className="tabular-mono text-[11px] text-zinc-500">{b.size_mb.toFixed(1)} MB</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="xs"
                      variant={isDefault ? "primary" : "default"}
                      onClick={() => handleSetDefaultBroll(b.name)}
                    >
                      {isDefault && <Check className="h-3 w-3" />}
                      {isDefault ? "Padrão" : "Usar padrão"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-zinc-500 hover:text-rose-400"
                      onClick={() => handleDeleteBroll(b.name)}
                      aria-label={`Remover ${b.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
