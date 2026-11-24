export type ViewId = "studio" | "brand" | "library" | "calendar" | "analytics" | "billing";

export type SettingsTab = "ai" | "yt" | "social" | "mon";

export type RenderMode = "blur" | "dual" | "dual_dopamine" | "card" | "face" | "crop" | "fit";

export interface WorkspaceConfig {
  plan?: string;
  owner_name?: string;
  brand_tagline?: string;
  license_key?: string;
  onboarding_dismissed?: boolean;
}

export interface ChannelConfig {
  name?: string;
  handle?: string;
  language?: string;
  niche?: string;
  default_hashtags?: string[];
  cta?: string;
  watermark_text?: string;
}

export interface RenderConfig {
  mode?: RenderMode;
  fg_zoom?: number;
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  preset?: string;
  loudnorm?: boolean;
  captions?: boolean;
  hook_title?: boolean;
  hook_style?: "white" | "red" | "black";
  hook_position?: "auto" | "middle" | "top";
  cam_position?: string;
  dopamine_video?: string;
  watermark?: boolean;
  watermark_position?: string;
  watermark_opacity?: number;
  watermark_size?: number;
  words_per_group?: number;
  highlight_color?: string;
  censor_18plus?: boolean;
  censor_style?: string;
}

export interface ClipsConfig {
  target_count?: number;
  min_seconds?: number;
  max_seconds?: number;
  min_score?: number;
}

export interface UploadConfig {
  privacy?: string;
  category_id?: string;
  made_for_kids?: boolean;
  timezone?: string;
  slots?: string[];
  max_per_day?: number;
}

export interface MonitorSource {
  name?: string;
  channel_id: string;
}

export interface MonitorConfig {
  interval_minutes?: number;
  auto_upload?: boolean;
  sources?: MonitorSource[];
}

export interface InstagramConfig {
  share_to_feed?: boolean;
  api_version?: string;
  login_type?: "instagram" | "facebook";
}

export interface TikTokConfig {
  privacy_level?: string;
  post_mode?: "direct" | "inbox";
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
}

export interface InstagramAccountSummary {
  connected: boolean;
  ig_user_id?: string;
  username?: string;
  api_type?: string;
  expires_at?: number | null;
}

export interface TikTokAccountSummary {
  connected: boolean;
  open_id?: string;
  username?: string;
  display_name?: string;
  scope?: string;
  expires_at?: number | null;
}

export interface StatusResponse {
  ffmpeg: string | null;
  subtitles: boolean;
  gemini: boolean;
  gemini_model: string | null;
  youtube_auth: boolean;
  client_secret: boolean;
  youtube_cookies: boolean;
  cookies_from_browser: string;
  instagram_auth?: boolean;
  instagram_user?: InstagramAccountSummary;
  instagram_configured?: boolean;
  instagram_redirect_uri?: string;
  instagram?: InstagramConfig;
  tiktok_auth?: boolean;
  tiktok_user?: TikTokAccountSummary;
  tiktok_configured?: boolean;
  tiktok_redirect_uri?: string;
  tiktok?: TikTokConfig;
  monitor: boolean;
  queues: { pipeline: number; uploads: number };
  workspace: WorkspaceConfig;
  channel: ChannelConfig;
  render: RenderConfig;
  clips: ClipsConfig;
  render_mode: RenderMode;
  target_count: number;
  transcription_language: string;
  broll_count: number;
}

export interface ConfigResponse {
  gemini_set: boolean;
  gemini_masked: string;
  client_secret: boolean;
  youtube_cookies: boolean;
  cookies_from_browser: string;
  instagram_app_id?: string;
  instagram_secret_set?: boolean;
  instagram_secret_masked?: string;
  instagram_redirect_uri?: string;
  instagram_user?: InstagramAccountSummary;
  tiktok_client_key?: string;
  tiktok_secret_set?: boolean;
  tiktok_secret_masked?: string;
  tiktok_redirect_uri?: string;
  tiktok_user?: TikTokAccountSummary;
  workspace: WorkspaceConfig;
  channel: ChannelConfig;
  clips: ClipsConfig;
  render: RenderConfig;
  llm: {
    provider?: string;
    model?: string;
    use_video_analysis?: boolean;
    max_video_minutes_for_upload?: number;
    transcript_chunk_minutes?: number;
  };
  transcription: {
    enabled?: boolean;
    model?: string;
    language?: string | null;
  };
  upload: UploadConfig;
  instagram?: InstagramConfig;
  tiktok?: TikTokConfig;
  monitor: MonitorConfig;
  ingest?: { cookies_from_browser?: string };
}

export interface ClipItem {
  id: number;
  job_id: number;
  job_title?: string;
  kind: "short" | "long";
  idx: number;
  start: number;
  end: number;
  score: number;
  score_label: string;
  breakdown?: Record<string, number>;
  hook?: string;
  reason?: string;
  category?: string;
  transcript?: string;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  file_path?: string | null;
  thumb_path?: string | null;
  video_url?: string | null;
  thumb_url?: string | null;
  status: string;
  render_mode?: RenderMode | string;
  youtube_id?: string | null;
  youtube_url?: string | null;
  publish_at?: string | null;
  error?: string | null;
  ig_status?: string;
  ig_media_id?: string;
  ig_url?: string;
  ig_error?: string;
  tiktok_status?: string;
  tiktok_publish_id?: string;
  tiktok_url?: string;
  tiktok_error?: string;
}

export interface JobItem {
  id: number;
  kind: "clip" | "compilation";
  source: string;
  title: string;
  status: "queued" | "running" | "done" | "error";
  stage: string;
  progress: number;
  message: string;
  video_path?: string | null;
  duration?: number | null;
  options?: Record<string, unknown>;
  clips?: ClipItem[];
}

export interface BrollItem {
  name: string;
  size_mb: number;
  url: string;
}

export interface ScheduleResponse {
  scheduled: ClipItem[];
  published: ClipItem[];
  ready: ClipItem[];
  upcoming_slots: string[];
  upload_cfg: UploadConfig;
  youtube_auth: boolean;
}

export interface AnalyticsResponse {
  totals: {
    jobs: number;
    jobs_done: number;
    clips: number;
    compilations: number;
    rendered: number;
    scheduled: number;
    uploaded: number;
    instagram_published?: number;
    tiktok_published?: number;
    avg_score: number;
    source_minutes: number;
    clips_minutes: number;
  };
  tiers: { viral: number; high: number; medium: number; low: number };
  categories: [string, number][];
  modes: [string, number][];
  top_clips: ClipItem[];
  onboarding: {
    has_ffmpeg: boolean;
    has_gemini: boolean;
    has_youtube: boolean;
    has_instagram?: boolean;
    has_tiktok?: boolean;
    has_watermark: boolean;
    has_clips: boolean;
  };
  workspace: WorkspaceConfig;
}
