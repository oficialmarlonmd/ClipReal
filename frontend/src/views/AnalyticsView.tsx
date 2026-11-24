import { useEffect, useState } from "react";
import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API } from "@/lib/api";
import { cn, FMT_META, scoreBadgeClass } from "@/lib/utils";
import type { AnalyticsResponse, RenderMode } from "@/types";

interface Props {
  onOpenJobInStudio: (jobId: number) => void;
  onOpenSettings: (tab?: "ai" | "yt" | "mon") => void;
}

export function AnalyticsView({ onOpenJobInStudio, onOpenSettings }: Props) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await API.analytics());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-zinc-800/80 bg-[#121216]" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const t = data.totals;
  const tierTotal = Math.max(1, data.tiers.viral + data.tiers.high + data.tiers.medium + data.tiers.low);
  const modeMax = Math.max(1, ...data.modes.map(([, n]) => n));

  const checklist = [
    { ok: data.onboarding.has_ffmpeg, label: "FFmpeg com suporte a legendas", action: null },
    { ok: data.onboarding.has_gemini, label: "Chave Gemini configurada", action: () => onOpenSettings("ai") },
    { ok: data.onboarding.has_youtube, label: "Canal do YouTube autenticado", action: () => onOpenSettings("yt") },
    { ok: data.onboarding.has_watermark, label: "Marca d'água do Brand Kit ativa", action: null },
    { ok: data.onboarding.has_clips, label: "Primeiro corte extraído", action: null },
  ];

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button size="xs" variant="ghost" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar métricas
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KpiCard label="Cortes gerados" value={String(t.clips)} sub={`${t.rendered} renderizados`} />
        <KpiCard label="Score médio" value={`${Math.round(t.avg_score)}/100`} sub={`${data.tiers.viral} virais (85+)`} />
        <KpiCard label="Publicados / Fila" value={`${t.uploaded} / ${t.scheduled}`} sub={`${t.compilations} compilações`} />
        <KpiCard
          label="Minutos analisados"
          value={`${Math.round(t.source_minutes)}m`}
          sub={`${Math.round(t.clips_minutes)}m em cortes`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Virality Distribution */}
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-100">Distribuição de viralidade</h2>
          <div className="space-y-3">
            {[
              { label: "Viral (85+)", count: data.tiers.viral, bar: "bg-emerald-400" },
              { label: "Alto (70–84)", count: data.tiers.high, bar: "bg-amber-400" },
              { label: "Médio (55–69)", count: data.tiers.medium, bar: "bg-sky-400" },
              { label: "Baixo (<55)", count: data.tiers.low, bar: "bg-zinc-600" },
            ].map((row) => (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-zinc-400">{row.label}</span>
                  <span className="tabular-mono font-medium text-zinc-200">{row.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className={cn("h-full rounded-full transition-all", row.bar)}
                    style={{ width: `${Math.round((row.count / tierTotal) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Formats Usage */}
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-100">Formatos utilizados</h2>
          {data.modes.length === 0 ? (
            <p className="text-xs text-zinc-500">Ainda sem cortes renderizados.</p>
          ) : (
            <div className="space-y-3">
              {data.modes.map(([mode, count]) => (
                <div key={mode}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">
                      {FMT_META[mode as RenderMode]?.label || mode}
                    </span>
                    <span className="tabular-mono text-zinc-400">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className="h-full rounded-full bg-zinc-300"
                      style={{ width: `${Math.round((count / modeMax) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Readiness Checklist */}
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <h2 className="mb-4 text-sm font-semibold text-zinc-100">Prontidão do estúdio</h2>
          <ul className="space-y-2.5">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 text-zinc-300">
                  {item.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-zinc-600" />
                  )}
                  <span className={item.ok ? "text-zinc-200" : "text-zinc-500"}>{item.label}</span>
                </span>
                {!item.ok && item.action && (
                  <button
                    type="button"
                    onClick={item.action}
                    className="text-[11px] font-medium text-zinc-300 underline hover:text-white cursor-pointer"
                  >
                    Configurar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Categories & Top Clips */}
      {data.categories.length > 0 && (
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-100">Categorias mais frequentes</h2>
          <div className="flex flex-wrap gap-2">
            {data.categories.map(([cat, count]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300"
              >
                <span>{cat}</span>
                <span className="tabular-mono text-zinc-500">{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {data.top_clips.length > 0 && (
        <section className="rounded-xl border border-zinc-800/80 bg-[#121216] p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-100">Melhores cortes (Top Score)</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {data.top_clips.slice(0, 6).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenJobInStudio(c.job_id)}
                className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3 text-left transition-colors hover:border-zinc-700 cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[13px] font-medium text-zinc-100">{c.title}</p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500">{c.category || "Highlight"}</p>
                </div>
                <span
                  className={cn(
                    "tabular-mono shrink-0 rounded border px-1.5 py-0.5 text-xs font-semibold",
                    scoreBadgeClass(c.score),
                  )}
                >
                  {Math.round(c.score)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#121216] p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="tabular-mono mt-1.5 text-2xl font-semibold tracking-tight text-zinc-50">{value}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}
