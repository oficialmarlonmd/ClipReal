import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Clock, ExternalLink, RefreshCw, Send, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/api";
import { cn, scoreBadgeClass } from "@/lib/utils";
import type { ScheduleResponse, SettingsTab } from "@/types";

interface Props {
  onOpenSettings: (tab?: SettingsTab) => void;
  onOpenJobInStudio: (jobId: number) => void;
}

export function CalendarView({ onOpenSettings, onOpenJobInStudio }: Props) {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.schedule();
      setData(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar agenda");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleScheduleNext = async (clipId: number) => {
    if (!data?.youtube_auth) {
      toast.error("Conecte seu canal do YouTube em Configurações antes de agendar.");
      onOpenSettings("yt");
      return;
    }
    setUploadingId(clipId);
    try {
      await API.uploadClip(clipId, "auto");
      toast.success("Corte enviado para a fila do próximo slot.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao agendar corte");
    } finally {
      setUploadingId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-xl border border-zinc-800/80 bg-[#121216]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl border border-zinc-800/80 bg-[#121216]" />
          <div className="h-64 animate-pulse rounded-xl border border-zinc-800/80 bg-[#121216]" />
        </div>
      </div>
    );
  }

  const slots = data?.upcoming_slots || [];
  const scheduled = data?.scheduled || [];
  const published = data?.published || [];
  const ready = data?.ready || [];

  return (
    <div className="space-y-5">
      {/* Slots Strip */}
      <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Próximos horários disponíveis</h2>
            <p className="text-xs text-zinc-500">
              Fuso {data?.upload_cfg?.timezone || "America/Sao_Paulo"} · Máx.{" "}
              {data?.upload_cfg?.max_per_day || 6}/dia
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="default" onClick={() => onOpenSettings("yt")}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Editar grade
            </Button>
            <Button size="xs" variant="ghost" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {slots.length === 0 ? (
            <p className="text-xs text-zinc-500">Nenhum slot configurado.</p>
          ) : (
            slots.slice(0, 12).map((s) => (
              <span
                key={s}
                className="tabular-mono inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300"
              >
                <Clock className="h-3 w-3 text-zinc-500" />
                {new Date(s).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ))
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Ready to schedule */}
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">
              Prontos para agendar ({ready.length})
            </h2>
            <span className="text-xs text-zinc-500">1 clique → próximo slot</span>
          </div>

          {ready.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-500">
              Nenhum corte renderizado aguardando agendamento.
            </p>
          ) : (
            <div className="space-y-2">
              {ready.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenJobInStudio(c.job_id)}
                      className="truncate text-left text-[13px] font-medium text-zinc-100 hover:underline cursor-pointer"
                    >
                      {c.title || `Corte #${c.idx}`}
                    </button>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span
                        className={cn(
                          "tabular-mono rounded border px-1 py-0.2 font-semibold",
                          scoreBadgeClass(c.score),
                        )}
                      >
                        {Math.round(c.score)}
                      </span>
                      <span className="truncate">{c.job_title || `Job #${c.job_id}`}</span>
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="primary"
                    disabled={uploadingId === c.id}
                    onClick={() => handleScheduleNext(c.id)}
                  >
                    <Send className="h-3 w-3" />
                    {uploadingId === c.id ? "Enviando…" : "Próximo slot"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Scheduled & Published */}
        <section className="space-y-5">
          <div className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <CalendarClock className="h-4 w-4 text-sky-400" />
              Agendados no YouTube ({scheduled.length})
            </h2>
            {scheduled.length === 0 ? (
              <p className="py-5 text-center text-xs text-zinc-500">Nenhum vídeo agendado ainda.</p>
            ) : (
              <div className="space-y-2">
                {scheduled.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-zinc-100">{c.title}</p>
                      <p className="tabular-mono text-[11px] text-sky-400">
                        {c.publish_at
                          ? new Date(c.publish_at).toLocaleString("pt-BR")
                          : "Na fila de upload"}
                      </p>
                    </div>
                    {c.youtube_url && (
                      <a
                        href={c.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-400 hover:text-zinc-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Publicados ({published.length})
            </h2>
            {published.length === 0 ? (
              <p className="py-5 text-center text-xs text-zinc-500">Nenhum corte publicado ainda.</p>
            ) : (
              <div className="space-y-2">
                {published.slice(0, 12).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-3 py-2"
                  >
                    <p className="truncate text-[13px] text-zinc-200">{c.title}</p>
                    {c.youtube_url && (
                      <a
                        href={c.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-400 hover:underline"
                      >
                        Ver <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
