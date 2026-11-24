import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { SettingsDialog, type SettingsTab } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { API } from "@/lib/api";
import { VIEW_META } from "@/lib/utils";
import type { BrollItem, ClipItem, JobItem, StatusResponse, ViewId } from "@/types";
import { AnalyticsView } from "@/views/AnalyticsView";
import { BrandKitView } from "@/views/BrandKitView";
import { CalendarView } from "@/views/CalendarView";
import { LibraryView } from "@/views/LibraryView";
import { StudioView } from "@/views/StudioView";
import { WorkspaceView } from "@/views/WorkspaceView";

export function App() {
  const [view, setView] = useState<ViewId>("studio");
  const [librarySubTab, setLibrarySubTab] = useState<"clips" | "broll">("clips");

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [currentJobId, setCurrentJobId] = useState<number | null>(null);
  const [activeJob, setActiveJob] = useState<(JobItem & { clips: ClipItem[] }) | null>(null);
  const [brolls, setBrolls] = useState<BrollItem[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("ai");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await API.status();
      setStatus(s);
    } catch {
      // ignore transient poll failures
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const list = await API.jobs();
      setJobs(list);
      setCurrentJobId((prev) => {
        if (prev && list.some((j) => j.id === prev)) return prev;
        return list.length > 0 ? list[0].id : null;
      });
    } catch {
      // ignore transient poll failures
    }
  }, []);

  const refreshActiveJob = useCallback(async (jobId: number | null) => {
    if (!jobId) {
      setActiveJob(null);
      return;
    }
    try {
      const j = await API.job(jobId);
      setActiveJob(j);
    } catch {
      // ignore transient poll failures
    }
  }, []);

  const refreshBrolls = useCallback(async () => {
    try {
      setBrolls(await API.brollList());
    } catch {
      // ignore
    }
  }, []);

  // Initial bootstrap
  useEffect(() => {
    refreshStatus();
    refreshJobs();
    refreshBrolls();
  }, [refreshStatus, refreshJobs, refreshBrolls]);

  // Fetch active job details whenever selection changes
  useEffect(() => {
    refreshActiveJob(currentJobId);
  }, [currentJobId, refreshActiveJob]);

  // Live polling (2.5s)
  useEffect(() => {
    const id = window.setInterval(() => {
      refreshStatus();
      if (view === "studio") {
        refreshJobs();
        if (currentJobId) refreshActiveJob(currentJobId);
      }
    }, 2500);
    return () => window.clearInterval(id);
  }, [view, currentJobId, refreshStatus, refreshJobs, refreshActiveJob]);

  // Global OAuth callback listener (supports both local callbacks and OAuth Broker popup/BroadcastChannel)
  useEffect(() => {
    const brokerOrigin = (() => {
      try {
        return status?.oauth_broker_url ? new URL(status.oauth_broker_url).origin : "";
      } catch {
        return "";
      }
    })();

    const handleOAuthEvent = async (d: unknown, origin?: string) => {
      if (!d || typeof d !== "object") return;
      const msg = d as {
        type?: string;
        platform?: string;
        ok?: boolean;
        detail?: string;
        provider?: string;
        client_state?: string;
        token_bundle?: Record<string, unknown>;
      };
      if (msg.type === "clipsreal:broker_token") {
        if (origin && brokerOrigin && origin !== brokerOrigin) return;
        if (msg.provider && msg.client_state && msg.token_bundle) {
          try {
            const res = await API.brokerComplete(msg.provider, msg.client_state, msg.token_bundle);
            toast.success(`Conectado: ${res.label}`);
            void refreshStatus();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao finalizar login");
          }
        }
        return;
      }
      if (msg.type === "clipsreal:oauth") {
        if (origin && origin !== window.location.origin) return;
        if (msg.ok) {
          toast.success(msg.detail || `${msg.platform || "Conta"} conectado!`);
          void refreshStatus();
        } else {
          toast.error(msg.detail || "Falha ao conectar conta");
        }
      }
    };

    const onWinMsg = (ev: MessageEvent) => {
      void handleOAuthEvent(ev.data, ev.origin);
    };
    window.addEventListener("message", onWinMsg);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("clipsreal_oauth");
      bc.onmessage = (ev) => {
        void handleOAuthEvent(ev.data);
      };
    }

    return () => {
      window.removeEventListener("message", onWinMsg);
      bc?.close();
    };
  }, [status?.oauth_broker_url, refreshStatus]);

  // Dynamic document title
  useEffect(() => {
    document.title = `${VIEW_META[view].title} · ClipsReal`;
  }, [view]);

  const handleOpenSettings = useCallback((tab: SettingsTab = "ai") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleSwitchView = useCallback((nextView: ViewId, subTab?: string) => {
    if (nextView === "library" && (subTab === "broll" || subTab === "clips")) {
      setLibrarySubTab(subTab);
    }
    setView(nextView);
  }, []);

  const handleOpenJobInStudio = useCallback((jobId: number) => {
    setCurrentJobId(jobId);
    setView("studio");
  }, []);

  const handleRequestConfirm = useCallback(
    (opts: Omit<ConfirmState, "open">) => {
      setConfirmState({ ...opts, open: true });
    },
    [],
  );

  return (
    <div className="flex min-h-screen bg-[#09090b] text-zinc-100 max-lg:flex-col">
      <Sidebar
        view={view}
        onSelectView={(v) => handleSwitchView(v)}
        status={status}
        onOpenSettings={handleOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          view={view}
          status={status}
          onSelectView={(v) => handleSwitchView(v)}
          onOpenSettings={handleOpenSettings}
          onRefreshStatus={refreshStatus}
        />

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-6 max-sm:p-4">
          {view === "studio" && (
            <StudioView
              status={status}
              jobs={jobs}
              currentJobId={currentJobId}
              activeJob={activeJob}
              brolls={brolls}
              onSelectJob={setCurrentJobId}
              onRefreshJobs={refreshJobs}
              onRefreshJob={() => refreshActiveJob(currentJobId)}
              onRefreshStatus={refreshStatus}
              onSwitchView={handleSwitchView}
              onOpenSettings={handleOpenSettings}
              onRequestConfirm={handleRequestConfirm}
            />
          )}

          {view === "brand" && (
            <BrandKitView
              status={status}
              currentJobId={currentJobId}
              onSaved={refreshStatus}
              onAfterRerender={() => {
                setView("studio");
                refreshActiveJob(currentJobId);
              }}
            />
          )}

          {view === "library" && (
            <LibraryView
              status={status}
              brolls={brolls}
              initialTab={librarySubTab}
              onOpenJobInStudio={handleOpenJobInStudio}
              onRefreshBrolls={refreshBrolls}
              onRefreshStatus={refreshStatus}
              onRequestConfirm={handleRequestConfirm}
            />
          )}

          {view === "calendar" && (
            <CalendarView
              onOpenSettings={handleOpenSettings}
              onOpenJobInStudio={handleOpenJobInStudio}
            />
          )}

          {view === "analytics" && (
            <AnalyticsView
              onOpenJobInStudio={handleOpenJobInStudio}
              onOpenSettings={handleOpenSettings}
            />
          )}

          {view === "billing" && (
            <WorkspaceView status={status} onSaved={refreshStatus} />
          )}
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        initialTab={settingsTab}
        onOpenChange={setSettingsOpen}
        onSaved={refreshStatus}
        onJobsChanged={refreshJobs}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#131317",
            border: "1px solid #27272a",
            color: "#f4f4f5",
          },
        }}
      />
    </div>
  );
}
