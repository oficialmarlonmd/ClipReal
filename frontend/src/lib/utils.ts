import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RenderMode, ViewId } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const FMT_META: Record<RenderMode, { label: string; short: string; desc: string }> = {
  blur: { label: "Janela Blur", short: "16:9 + blur", desc: "Quadro 16:9 centralizado com fundo desfocado" },
  dual: { label: "Dual Stream", short: "Cam + game", desc: "Facecam superior + gameplay em tela dividida" },
  dual_dopamine: { label: "Dual Dopamine", short: "Split + B-Roll", desc: "Split vertical com gancho central ou vídeo B-Roll" },
  card: { label: "Social Card", short: "Card 16:9", desc: "Quadro 16:9 emoldurado estilo feed" },
  face: { label: "Rastrear Rosto", short: "Auto-face", desc: "Enquadramento 9:16 seguindo quem fala" },
  crop: { label: "Crop Central", short: "Zoom 9:16", desc: "Zoom vertical preenchendo toda a tela" },
  fit: { label: "Cinema Fit", short: "Letterbox", desc: "Quadro completo com barras pretas" },
};

export const VIEW_META: Record<ViewId, { title: string; subtitle: string }> = {
  studio: { title: "Studio de Cortes", subtitle: "Extraia, edite e agende Shorts e compilações" },
  brand: { title: "Brand Kit", subtitle: "Identidade visual padrão: marca d'água, gancho e legendas" },
  library: { title: "Biblioteca", subtitle: "Acervo de cortes renderizados e vídeos B-Roll" },
  calendar: { title: "Agenda", subtitle: "Grade de horários diários, fila agendada e histórico" },
  analytics: { title: "Analytics", subtitle: "Métricas de produção, viralidade e prontidão" },
  billing: { title: "Workspace", subtitle: "Perfil do canal, consumo e níveis locais" },
};

export const SCORE_LABELS: Record<string, string> = {
  llm: "IA",
  energy: "Energia",
  hook: "Gancho 3s",
  dynamics: "Ritmo",
  duration: "Duração",
  trend: "Tendência",
};

export function scoreBadgeClass(score: number): string {
  if (score >= 85) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (score >= 70) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (score >= 55) return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  return "bg-zinc-800 text-zinc-400 border-zinc-700";
}

export function cleanScoreLabel(label?: string): string {
  return String(label || "").replace(/[^\p{L}\p{N}\s.+\-/()]/gu, "").trim();
}

export function statusColorClass(status: string): string {
  if (status === "done" || status === "rendered" || status === "uploaded") return "text-emerald-400";
  if (status === "error") return "text-rose-400";
  if (status === "queued" || status === "scheduled") return "text-sky-400";
  return "text-amber-400";
}
