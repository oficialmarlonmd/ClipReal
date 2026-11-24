import type {
  AnalyticsResponse,
  BrollItem,
  ClipItem,
  ConfigResponse,
  JobItem,
  ScheduleResponse,
  StatusResponse,
} from "@/types";

export async function api<T = unknown>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers = opts.body instanceof FormData
    ? opts.headers
    : { "Content-Type": "application/json", ...opts.headers };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.detail || msg;
    } catch {
      // ignore json parse failure
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function uploadWithProgress<T = { id: number }>(
  url: string,
  formData: FormData,
  onProgress?: (pct: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 300) {
        try {
          const d = JSON.parse(xhr.responseText);
          return reject(new Error(d.detail || xhr.responseText));
        } catch {
          return reject(new Error(xhr.responseText || xhr.statusText));
        }
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T);
      } catch {
        resolve({} as T);
      }
    };
    xhr.onerror = () => reject(new Error("Falha de rede durante o upload."));
    xhr.open("POST", url);
    xhr.send(formData);
  });
}

export const API = {
  status: () => api<StatusResponse>("/api/status"),
  jobs: () => api<JobItem[]>("/api/jobs"),
  job: (id: number) => api<JobItem & { clips: ClipItem[] }>(`/api/jobs/${id}`),
  createJob: (body: Record<string, unknown>) =>
    api<{ id: number }>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  retryJob: (id: number) => api<{ ok: boolean }>(`/api/jobs/${id}/retry`, { method: "POST" }),
  deleteJob: (id: number) => api<{ ok: boolean }>(`/api/jobs/${id}`, { method: "DELETE" }),
  clips: () => api<ClipItem[]>("/api/clips"),
  patchClip: (id: number, body: Record<string, unknown>) =>
    api<ClipItem>(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  regenSeo: (id: number) => api<Record<string, unknown>>(`/api/clips/${id}/metadata`, { method: "POST" }),
  renderClip: (id: number, body: Record<string, unknown>) =>
    api<{ ok: boolean }>(`/api/clips/${id}/render`, { method: "POST", body: JSON.stringify(body) }),
  renderBatch: (body: Record<string, unknown>) =>
    api<{ ok: boolean; queued: number }>("/api/clips/render-batch", { method: "POST", body: JSON.stringify(body) }),
  uploadClip: (id: number, schedule: string) =>
    api<{ ok: boolean }>(`/api/clips/${id}/upload`, { method: "POST", body: JSON.stringify({ schedule }) }),
  compile: (clipIds: number[]) =>
    api<{ id: number }>("/api/compilation", { method: "POST", body: JSON.stringify({ clip_ids: clipIds }) }),
  config: () => api<ConfigResponse>("/api/config"),
  saveConfig: (body: Record<string, unknown>) =>
    api<{ ok: boolean }>("/api/config", { method: "POST", body: JSON.stringify(body) }),
  testGemini: () => api<{ ok: boolean; model: string }>("/api/gemini/test", { method: "POST" }),
  ytAuth: () => api<{ title?: string }>("/api/youtube/auth", { method: "POST" }),
  uploadSecret: (fd: FormData) => api<{ ok: boolean }>("/api/youtube/secret", { method: "POST", body: fd }),
  uploadCookies: (fd: FormData) => api<{ ok: boolean }>("/api/youtube/cookies", { method: "POST", body: fd }),
  brollList: () => api<BrollItem[]>("/api/broll"),
  uploadBroll: (fd: FormData) => api<{ ok: boolean }>("/api/broll", { method: "POST", body: fd }),
  deleteBroll: (name: string) =>
    api<{ ok: boolean }>(`/api/broll/${encodeURIComponent(name)}`, { method: "DELETE" }),
  schedule: () => api<ScheduleResponse>("/api/schedule"),
  analytics: () => api<AnalyticsResponse>("/api/analytics"),
  checkMonitor: () => api<{ created: number[] }>("/api/monitor/check", { method: "POST" }),
};
