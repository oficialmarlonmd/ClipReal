import {
  BarChart3,
  CalendarClock,
  Clapperboard,
  FolderKanban,
  Layers,
  Scissors,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SettingsTab, StatusResponse, ViewId } from "@/types";

interface Props {
  view: ViewId;
  onSelectView: (v: ViewId) => void;
  status: StatusResponse | null;
  onOpenSettings: (tab?: SettingsTab) => void;
}

const NAV_ITEMS: { id: ViewId; label: string; icon: typeof Scissors }[] = [
  { id: "studio", label: "Studio & Cortes", icon: Scissors },
  { id: "brand", label: "Brand Kit", icon: Layers },
  { id: "library", label: "Biblioteca", icon: FolderKanban },
  { id: "calendar", label: "Agenda", icon: CalendarClock },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "billing", label: "Workspace", icon: Settings2 },
];

export function Sidebar({ view, onSelectView, status, onOpenSettings }: Props) {
  const wmOn =
    status?.render?.watermark !== false && Boolean((status?.channel?.watermark_text || "").trim());
  const checks = [
    Boolean(status?.ffmpeg),
    Boolean(status?.gemini),
    Boolean(status?.youtube_auth),
    wmOn,
  ];
  const done = checks.filter(Boolean).length;
  const pct = Math.round((done / 4) * 100);
  const plan = (status?.workspace?.plan || "PRO").toUpperCase();

  return (
    <aside className="sticky top-0 z-20 flex h-screen w-[228px] shrink-0 flex-col border-r border-zinc-800/80 bg-[#0d0d10] px-3 py-4 max-lg:static max-lg:h-auto max-lg:w-full max-lg:border-b max-lg:border-r-0">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-950">
          <Clapperboard className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold tracking-tight text-zinc-50">ClipsReal</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-zinc-300">
              {plan}
            </span>
          </div>
          <p className="truncate text-[11px] text-zinc-500">
            {status?.workspace?.brand_tagline || "Video Clip Studio"}
          </p>
        </div>
      </div>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5 max-lg:flex-row max-lg:flex-wrap">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectView(id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors cursor-pointer",
                active
                  ? "bg-zinc-800/90 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active ? "text-zinc-100" : "text-zinc-500")} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 max-lg:hidden">
        <div className="rounded-lg border border-zinc-800/80 bg-[#131317] p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Canal</span>
            <span className="truncate max-w-[130px] font-medium text-zinc-200">
              {status?.channel?.handle || "@BabyDragonOFC"}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-zinc-500">Setup</span>
            <span className="tabular-mono text-zinc-300">{done}/4</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-zinc-200 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <Button
            variant="default"
            size="sm"
            className="mt-3 w-full"
            onClick={() => onOpenSettings("ai")}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Chaves &amp; API</span>
          </Button>
        </div>
      </div>
    </aside>
  );
}
