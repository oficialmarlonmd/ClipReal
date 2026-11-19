const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) {
    let m = r.statusText;
    try { m = (await r.json()).detail || m; } catch {}
    throw new Error(m);
  }
  return r.json();
};

const toast = (m, kind = "info") => {
  const d = document.createElement("div");
  if (kind === "ok" || kind === "err") d.className = kind;
  d.textContent = m;
  $("#toast").appendChild(d);
  setTimeout(() => d.remove(), 4800);
};

const FMT_META = {
  blur: { label: "Janela Blur", desc: "Janela inteira 16:9 no formato em pé com fundo desfocado" },
  dual: { label: "Dual Stream", desc: "Facecam do streamer em cima + Gameplay centralizado embaixo" },
  dual_dopamine: { label: "Dual Dopamine", desc: "Split tela dupla com banner central de gancho / vídeo B-Roll" },
  card: { label: "Social Card", desc: "Vídeo 16:9 completo dentro de um card escuro estilo feed" },
  face: { label: "Rastrear Rosto", desc: "Tela cheia 9:16 seguindo automaticamente quem fala" },
  crop: { label: "Crop Central", desc: "Zoom vertical preenchendo toda a tela 9:16" },
  fit: { label: "Cinema Fit", desc: "Vídeo inteiro preservado com barras pretas" },
};

const VIEW_META = {
  studio: ["Studio de Cortes", "Transforme lives, VODs e gameplays em Shorts virais"],
  brand: ["Brand Kit & Marca d'água", "Personalize e salve sua identidade visual, gancho e legendas"],
  library: ["Biblioteca & Dopamina", "Todos os seus cortes renderizados e vídeos B-Roll para Dual Dopamine"],
  calendar: ["Calendário & Agendamento", "Gerencie horários diários, fila agendada e publicações no YouTube"],
  analytics: ["Analytics & Desempenho", "Métricas reais do seu pipeline, viralidade e prontidão do canal"],
  billing: ["Planos, Uso & Conta", "Gerencie workspace, licença comercial, limites e assinaturas"],
};

let currentView = "studio";
let currentJob = null;
let currentClips = [];
let clipSig = "";
let selected = new Set();
let cfgInit = false;
let lastStatus = null;
let selectedMode = "blur";
let bkPos = "bottom-center";
let bkSimMode = "blur";

// ------------------------------------------------------------ navigation & views
function switchView(name) {
  if (!VIEW_META[name]) name = "studio";
  currentView = name;
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  const [title, sub] = VIEW_META[name];
  $("#view-title").textContent = title;
  $("#view-sub").textContent = sub;

  if (name === "brand") loadBrandKit();
  else if (name === "library") { loadLibraryClips(); loadBroll(); }
  else if (name === "calendar") loadCalendar();
  else if (name === "analytics") loadAnalytics();
  else if (name === "billing") loadBilling();
}
$$(".nav-item").forEach((b) => { b.onclick = () => switchView(b.dataset.view); });

// ------------------------------------------------------------ format picker
function selectMode(mode) {
  selectedMode = FMT_META[mode] ? mode : "blur";
  $$("#fmt-grid .fmt-card").forEach((b) => b.classList.toggle("active", b.dataset.mode === selectedMode));
  $("#fmt-active-desc").textContent = FMT_META[selectedMode].desc;
  const isDual = selectedMode === "dual" || selectedMode === "dual_dopamine";
  $("#dual-opts-row").classList.toggle("hidden", !isDual);
  $("#dopamine-broll-wrap").classList.toggle("hidden", selectedMode !== "dual_dopamine");
  if (selectedMode === "dual_dopamine" && $("#opt-hook-pos").value === "auto") {
    $("#opt-hook-pos").value = "middle";
  }
}
$$("#fmt-grid .fmt-card").forEach((b) => { b.onclick = () => selectMode(b.dataset.mode); });
$("#go-broll-lib").onclick = () => {
  switchView("library");
  $$(".lib-tab").forEach((b) => b.classList.toggle("active", b.dataset.ltab === "broll"));
  $("#lib-clips-panel").classList.remove("active");
  $("#lib-broll-panel").classList.add("active");
};

// ------------------------------------------------------------ status & defaults
function applyDefaultsToMainBar(s) {
  if (!s) return;
  if ($("#lang")) $("#lang").value = s.transcription_language || "auto";
  if (s.render?.mode) selectMode(s.render.mode);
  if ($("#count") && s.clips?.target_count) $("#count").value = s.clips.target_count;
  if ($("#minscore") && s.clips?.min_score !== undefined) $("#minscore").value = s.clips.min_score;
  if ($("#opt-hook")) $("#opt-hook").checked = s.render?.hook_title !== false;
  if ($("#opt-caps")) $("#opt-caps").checked = s.render?.captions !== false;
  if ($("#opt-wm")) $("#opt-wm").checked = s.render?.watermark !== false;
  if ($("#opt-wm-text")) $("#opt-wm-text").value = s.channel?.watermark_text ?? "";
  if ($("#opt-cam-pos") && s.render?.cam_position) $("#opt-cam-pos").value = s.render.cam_position;
  if ($("#opt-hook-style") && s.render?.hook_style) $("#opt-hook-style").value = s.render.hook_style;
  if ($("#opt-hook-pos") && s.render?.hook_position) $("#opt-hook-pos").value = s.render.hook_position;
  $("#wm-quick-hint").textContent = "";
}

async function refreshBrollSelect() {
  try {
    const list = await api("/api/broll");
    const cur = $("#opt-broll").value || lastStatus?.render?.dopamine_video || "";
    $("#opt-broll").innerHTML = `<option value="">Auto (Cam + Gameplay + Banner)</option>`
      + list.map((it) => `<option value="${esc(it.name)}">${esc(it.name)} (${it.size_mb} MB)</option>`).join("");
    if (cur && list.some((it) => it.name === cur)) $("#opt-broll").value = cur;
  } catch {}
}

async function loadStatus() {
  try {
    const s = await api("/api/status");
    lastStatus = s;
    if (!cfgInit) {
      applyDefaultsToMainBar(s);
      refreshBrollSelect();
      cfgInit = true;
    }
    $("#side-handle").textContent = s.channel?.handle || "@BabyDragonOFC";
    $("#side-plan").textContent = (s.workspace?.plan || "PRO").toUpperCase();
    $("#side-tagline").innerHTML = `${esc(s.workspace?.brand_tagline || "GTA 6 Studio")} <span class="plan-chip" id="side-plan">${esc((s.workspace?.plan || "PRO").toUpperCase())}</span>`;

    const wmOn = s.render?.watermark !== false && Boolean((s.channel?.watermark_text || "").trim());
    const wmLabel = wmOn ? `🏷 ${esc(s.channel.watermark_text)}` : "🏷 Sem marca d'água";
    const p = [];
    p.push(`<span class="pill ${s.ffmpeg ? "ok" : "bad"}">FFmpeg ${s.ffmpeg ? "✓" : "✗"}${s.ffmpeg && !s.subtitles ? " (sem legendas)" : ""}</span>`);
    p.push(`<span class="pill ${s.gemini ? "ok" : "bad"}">${s.gemini ? "IA: " + esc(s.gemini_model) : "IA: sem GEMINI_API_KEY"}</span>`);
    p.push(s.youtube_auth
      ? `<span class="pill ok">YouTube ✓</span>`
      : `<span class="pill bad">YouTube ✗ <button id="ytauth">Conectar</button></span>`);
    p.push(`<span class="pill clickable" id="pill-wm" title="Abrir Brand Kit para editar e salvar">${wmLabel}</span>`);
    if (s.queues.pipeline || s.queues.uploads) {
      p.push(`<span class="pill">Fila: ${s.queues.pipeline} render · ${s.queues.uploads} upload</span>`);
    }
    $("#pills").innerHTML = p.join("");

    const b = $("#ytauth");
    if (b) b.onclick = async () => {
      if (!s.client_secret) { openConfig("yt"); return toast("Suba o client_secret.json em Canal & YouTube.", "err"); }
      toast("Abrindo navegador para autorizar o canal...");
      try {
        const c = await api("/api/youtube/auth", { method: "POST" });
        toast("Conectado: " + (c.title || "ok"), "ok");
        loadStatus();
      } catch (e) { toast("Erro: " + e.message, "err"); }
    };
    const pw = $("#pill-wm");
    if (pw) pw.onclick = () => switchView("brand");

    // Setup meter in sidebar
    const checks = [Boolean(s.ffmpeg), Boolean(s.gemini), Boolean(s.youtube_auth), wmOn];
    const done = checks.filter(Boolean).length;
    $("#side-setup-pct").textContent = `${done}/4`;
    $("#side-setup-bar").style.width = `${Math.round((done / 4) * 100)}%`;
  } catch {}
}

// ------------------------------------------------------------ quick watermark bar
$("#opt-wm").onchange = () => { $("#wm-quick-hint").textContent = "Alterado — clique em Salvar padrão para fixar."; };
$("#opt-wm-text").oninput = () => { $("#wm-quick-hint").textContent = "Não salvo como padrão ainda."; };
$("#open-wm-studio").onclick = () => switchView("brand");

$("#save-wm-quick").onclick = async () => {
  const btn = $("#save-wm-quick");
  btn.disabled = true;
  try {
    const wmText = $("#opt-wm-text").value.trim();
    const wmOn = $("#opt-wm").checked;
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({
        channel: { watermark_text: wmText },
        render: { watermark: wmOn },
      }),
    });
    $("#wm-quick-hint").textContent = "Padrão salvo ✓";
    toast(wmOn && wmText ? `Marca d'água "${wmText}" salva ✓` : "Marca d'água desativada/limpa e salva ✓", "ok");
    loadStatus();
  } catch (e) {
    toast("Erro ao salvar marca d'água: " + e.message, "err");
  } finally {
    btn.disabled = false;
  }
};

// ------------------------------------------------------------ jobs & clips
function syncBatchButtons() {
  const n = selected.size;
  $("#rerendersel").textContent = `🎞 Re-renderizar (${n})`;
  $("#compile").textContent = `🎬 Vídeo longo (${n})`;
  $("#upsel").textContent = `⬆ Agendar (${n})`;
  $("#rerendersel").disabled = n < 1;
  $("#compile").disabled = n < 2;
  $("#upsel").disabled = n < 1;

  const visibleIds = $$(".clip").map((el) => +el.dataset.id);
  const allSel = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  $("#selall").textContent = allSel ? "Limpar seleção" : "Selecionar todos";
}

async function loadJobs() {
  const jobs = await api("/api/jobs");
  $("#jobs-count").textContent = jobs.length;
  $("#jobs").innerHTML = jobs.map((j) => {
    const stText = j.status === "done" ? "✓ concluído" : j.status === "error" ? "✗ erro" : esc(j.stage || j.status);
    const pct = Math.round((j.progress || 0) * 100);
    return `
      <div class="job ${currentJob === j.id ? "active" : ""}" data-id="${j.id}">
        <div class="t" title="${esc(j.title || j.source)}">${j.kind === "compilation" ? "🎬 " : ""}${esc(j.title || j.source)}</div>
        <div class="s">
          <span class="status-${j.status}">${stText}${j.status === "running" ? ` (${pct}%)` : ""}</span>
          <span>#${j.id} <span class="del" data-del="${j.id}" title="Excluir trabalho">🗑</span></span>
        </div>
        ${j.status === "running" || j.status === "queued" ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ""}
      </div>`;
  }).join("") || `<div class="muted" style="font-size:13px">Nenhum trabalho ainda. Cole um link ou envie um MP4 acima.</div>`;

  $$(".job").forEach((el) => {
    el.onclick = async (ev) => {
      const del = ev.target.dataset.del;
      if (del) {
        ev.stopPropagation();
        if (confirm("Excluir trabalho e arquivos renderizados?")) {
          await api(`/api/jobs/${del}`, { method: "DELETE" });
          if (currentJob == del) { currentJob = null; currentClips = []; }
          clipSig = "";
          loadJobs();
          if (!currentJob) {
            $("#jobtitle").textContent = "Selecione um trabalho";
            $("#jobinfo").innerHTML = "";
            $("#clips").innerHTML = "";
          }
        }
        return;
      }
      currentJob = +el.dataset.id;
      clipSig = "";
      selected.clear();
      syncBatchButtons();
      loadJob();
      loadJobs();
    };
  });
  if (!currentJob && jobs.length) {
    currentJob = jobs[0].id;
    loadJob();
  }
}

const scoreClass = (s) => s >= 85 ? "v" : s >= 70 ? "h" : s >= 55 ? "m" : "l";
const LBL = { llm: "IA", energy: "Energia", hook: "Gancho 3s", dynamics: "Ritmo", duration: "Duração", trend: "Tendência" };

function formatSelectOpts(activeMode) {
  return Object.entries(FMT_META).map(([k, m]) =>
    `<option value="${k}" ${k === activeMode ? "selected" : ""}>${esc(m.label)}</option>`
  ).join("");
}

function clipCard(c) {
  const bd = c.breakdown || {};
  const bars = Object.keys(LBL).filter((k) => k in bd).map((k) =>
    `<span>${LBL[k]}</span><div class="bar"><i style="width:${bd[k]}%"></i></div><span>${Math.round(bd[k])}</span>`).join("");
  const media = c.video_url
    ? `<video src="${c.video_url}" controls preload="metadata" poster="${c.thumb_url || ""}"></video>`
    : `<div class="vid-placeholder">${esc(c.status)}…</div>`;
  const yt = c.youtube_id
    ? `<a class="yt" href="${c.youtube_url}" target="_blank" rel="noopener">▶ ${c.status === "scheduled" ? "Agendado " + new Date(c.publish_at).toLocaleString("pt-BR") : "No ar"}</a>`
    : "";
  const dur = Math.max(0, (c.end || 0) - (c.start || 0)).toFixed(1);
  const cMode = c.render_mode || lastStatus?.render?.mode || "blur";
  return `
  <div class="clip ${c.kind === "long" ? "long" : ""} ${selected.has(c.id) ? "sel" : ""}" data-id="${c.id}">
    ${media}
    <div class="f">
      <div class="score">
        <div class="badge ${scoreClass(c.score)}" title="Score de viralização">${Math.round(c.score || 0)}</div>
        <div class="bars">${bars || `<span>${esc(c.score_label || "")}</span>`}</div>
      </div>
      <div class="meta-row">
        <span class="tag">${esc(c.score_label || "")}</span>
        <span class="tag">${esc(c.category || c.kind)}</span>
        ${c.kind === "short" ? `<span class="tag c-dur">${dur}s</span><span class="tag">${esc(FMT_META[cMode]?.label || cMode)}</span>` : ""}
        ${yt}
        <label class="chk" style="margin-left:auto"><input type="checkbox" class="selbox" ${selected.has(c.id) ? "checked" : ""}> selecionar</label>
      </div>
      ${c.reason ? `<div class="reason-box">💡 ${esc(c.reason)}</div>` : ""}
      <div class="lbl"><span>Título</span><span class="cnt cnt-title"></span></div>
      <input class="i-title" maxlength="100" value="${esc(c.title)}">
      <div class="lbl"><span>Descrição</span><span class="cnt cnt-desc"></span></div>
      <textarea class="i-desc">${esc(c.description)}</textarea>
      <div class="lbl"><span>Hashtags</span></div>
      <input class="i-hash" value="${esc((c.hashtags || []).join(" "))}">
      <div class="lbl"><span>Tags ${c.kind === "long" ? "(vídeo longo)" : "(Shorts)"}</span><span class="cnt cnt-tags"></span></div>
      <input class="i-tags" value="${esc((c.tags || []).join(", "))}">
      ${c.kind === "short" ? `
      <div class="clip-timing">
        <div><div class="lbl">Gancho na tela</div><input class="i-hook" value="${esc(c.hook)}"></div>
        <div><div class="lbl">Início (s)</div><input class="i-start" type="number" step="0.1" value="${c.start}"></div>
        <div><div class="lbl">Fim (s)</div><input class="i-end" type="number" step="0.1" value="${c.end}"></div>
      </div>` : ""}
      ${c.error ? `<div class="err">${esc(c.error)}</div>` : ""}
      <div class="btns">
        <button class="small b-save">💾 Salvar</button>
        <button class="small b-seo">✨ Regerar SEO</button>
        ${c.kind === "short" ? `<select class="small-sel i-mode" title="Formato para re-renderizar">${formatSelectOpts(cMode)}</select><button class="small b-render">🎞 Re-renderizar</button>` : ""}
        <button class="small b-copy">📋 Copiar</button>
        ${c.video_url ? `<a href="${c.video_url}" download><button class="small" type="button">⬇ MP4</button></a>` : ""}
        ${c.thumb_url ? `<a href="${c.thumb_url}" download><button class="small" type="button">⬇ Capa</button></a>` : ""}
        ${!c.youtube_id && c.status === "rendered"
          ? `<button class="small primary b-up">⬆ Agendar</button><button class="small b-now">Publicar já</button>`
          : ""}
      </div>
    </div>
  </div>`;
}

function readCard(el) {
  const v = (s) => $(s, el)?.value;
  const out = {
    title: v(".i-title"),
    description: v(".i-desc"),
    hashtags: (v(".i-hash") || "").split(/\s+/).filter(Boolean),
    tags: (v(".i-tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
  };
  if ($(".i-hook", el)) {
    out.hook = v(".i-hook");
    out.start = +v(".i-start");
    out.end = +v(".i-end");
  }
  return out;
}

function bindCard(el) {
  const id = +el.dataset.id;
  const saveBtn = $(".b-save", el);
  const markDirty = () => { el.dataset.dirty = "1"; saveBtn.classList.add("dirty"); saveBtn.textContent = "💾 Salvar*"; };
  const clearDirty = () => { delete el.dataset.dirty; saveBtn.classList.remove("dirty"); saveBtn.textContent = "💾 Salvar"; };

  const updateCounts = () => {
    const tLen = $(".i-title", el).value.length;
    const ct = $(".cnt-title", el);
    ct.textContent = `${tLen}/100`;
    ct.className = `cnt cnt-title ${tLen > 95 ? "over" : tLen > 75 ? "warn" : ""}`;
    $(".cnt-desc", el).textContent = `${$(".i-desc", el).value.length} chars`;
    const tagsLen = $(".i-tags", el).value.length;
    const ctags = $(".cnt-tags", el);
    ctags.textContent = `${tagsLen}/480`;
    ctags.className = `cnt cnt-tags ${tagsLen > 480 ? "over" : tagsLen > 420 ? "warn" : ""}`;
    if ($(".i-start", el) && $(".c-dur", el)) {
      const dur = Math.max(0, (+$(".i-end", el).value || 0) - (+$(".i-start", el).value || 0));
      $(".c-dur", el).textContent = `${dur.toFixed(1)}s`;
    }
  };
  updateCounts();

  $$("input:not(.selbox), textarea", el).forEach((inp) => {
    inp.addEventListener("input", () => { markDirty(); updateCounts(); });
  });

  $(".selbox", el).onchange = (e) => {
    e.target.checked ? selected.add(id) : selected.delete(id);
    el.classList.toggle("sel", e.target.checked);
    syncBatchButtons();
  };

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      await api(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(readCard(el)) });
      clearDirty();
      toast("Alterações salvas ✓", "ok");
    } catch (e) { toast("Erro ao salvar: " + e.message, "err"); }
    finally { saveBtn.disabled = false; }
  };

  $(".b-seo", el).onclick = async () => {
    const btn = $(".b-seo", el);
    btn.disabled = true;
    btn.textContent = "✨ Gerando…";
    try {
      await api(`/api/clips/${id}/metadata`, { method: "POST" });
      clearDirty();
      clipSig = "";
      await loadJob(true);
      toast("SEO atualizado ✓", "ok");
    } catch (e) { toast("Erro ao gerar SEO: " + e.message, "err"); }
    finally { btn.disabled = false; btn.textContent = "✨ Regerar SEO"; }
  };

  const r = $(".b-render", el);
  if (r) r.onclick = async () => {
    r.disabled = true;
    try {
      await api(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(readCard(el)) });
      clearDirty();
      const chosenMode = $(".i-mode", el)?.value || null;
      await api(`/api/clips/${id}/render`, {
        method: "POST",
        body: JSON.stringify({ mode: chosenMode, use_saved_style: true }),
      });
      toast(`Re-renderizando no formato ${FMT_META[chosenMode]?.label || chosenMode}…`);
      clipSig = "";
      loadJob(true);
    } catch (e) { toast("Erro: " + e.message, "err"); }
    finally { r.disabled = false; }
  };

  $(".b-copy", el).onclick = () => {
    const d = readCard(el);
    navigator.clipboard.writeText(`${d.title}\n\n${d.description}\n\nTags: ${d.tags.join(", ")}`);
    toast("Título + descrição + tags copiados ✓", "ok");
  };

  const up = async (schedule) => {
    try {
      await api(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(readCard(el)) });
      clearDirty();
      await api(`/api/clips/${id}/upload`, { method: "POST", body: JSON.stringify({ schedule }) });
      toast(schedule === "auto" ? "Enviando e agendando no próximo horário livre…" : "Enviando e publicando…");
      clipSig = "";
      loadJob(true);
    } catch (e) { toast("Erro no upload: " + e.message, "err"); }
  };
  const bu = $(".b-up", el); if (bu) bu.onclick = () => up("auto");
  const bn = $(".b-now", el); if (bn) bn.onclick = () => { if (confirm("Publicar imediatamente no YouTube?")) up("now"); };
}

function renderFilteredClips(emptyReason = "") {
  const f = $("#clip-filter").value;
  const sort = $("#clip-sort").value;
  let list = [...currentClips];
  if (f === "selected") list = list.filter((c) => selected.has(c.id));
  else if (f === "rendered") list = list.filter((c) => c.status === "rendered");
  else if (f === "published") list = list.filter((c) => c.youtube_id || c.status === "scheduled" || c.status === "uploaded");

  if (sort === "time") list.sort((a, b) => (a.start || 0) - (b.start || 0));
  else list.sort((a, b) => (b.score || 0) - (a.score || 0));

  $("#clips").innerHTML = list.map(clipCard).join("")
    || `<div class="empty-state">${emptyReason || "Nenhum corte corresponde ao filtro atual."}</div>`;
  $$(".clip").forEach(bindCard);
  syncBatchButtons();
}

$("#clip-filter").onchange = () => renderFilteredClips();
$("#clip-sort").onchange = () => renderFilteredClips();

async function loadJob(force = false) {
  if (!currentJob) return;
  const j = await api(`/api/jobs/${currentJob}`);
  $("#jobtitle").textContent = j.title || j.source;
  const dur = j.duration ? ` · ${Math.round(j.duration / 60)} min` : "";
  const cnt = j.clips.length ? ` · ${j.clips.length} cortes` : "";
  $("#jobinfo").innerHTML = `<span class="status-${j.status}">${esc(j.status)}</span> · ${esc(j.stage || "")}${dur}${cnt} ${j.message ? "· " + esc(j.message) : ""}
    ${j.status === "error" ? ` <button class="small" id="retry">🔄 Tentar novamente</button>` : ""}`;
  const rb = $("#retry");
  if (rb) rb.onclick = () => api(`/api/jobs/${j.id}/retry`, { method: "POST" }).then(() => { clipSig = ""; loadJobs(); });

  const sig = JSON.stringify(j.clips.map((c) => [
    c.id, c.status, c.render_mode, c.video_url, c.thumb_url, c.youtube_id, c.publish_at,
    c.title, c.description, c.tags, c.hashtags, c.hook, c.reason, c.score, c.error,
  ]));
  if (!force && sig === clipSig) return;
  const hasDirty = $$(".clip[data-dirty='1']").length > 0;
  const editingClip = document.activeElement?.closest?.(".clip");
  if (!force && (editingClip || hasDirty) && clipSig) return;

  clipSig = sig;
  currentClips = j.clips || [];
  renderFilteredClips(j.status === "done" ? "Nenhum corte gerado neste trabalho." : "Processando… os cortes aparecem aqui automaticamente.");
}

// ------------------------------------------------------------ submit & batch actions
async function submitJob() {
  const source = $("#source").value.trim();
  if (!source) return toast("Cole um link ou caminho de arquivo", "err");
  const go = $("#go");
  go.disabled = true;
  try {
    const body = {
      source,
      count: +$("#count").value,
      mode: selectedMode,
      language: $("#lang").value,
      min_score: +$("#minscore").value,
      auto_upload: $("#autoup").checked,
      watermark: $("#opt-wm").checked,
      watermark_text: $("#opt-wm-text").value.trim(),
      hook_title: $("#opt-hook").checked,
      hook_style: $("#opt-hook-style").value,
      hook_position: $("#opt-hook-pos").value,
      cam_position: $("#opt-cam-pos").value,
      dopamine_video: $("#opt-broll").value,
      captions: $("#opt-caps").checked,
    };
    const r = await api("/api/jobs", { method: "POST", body: JSON.stringify(body) });
    $("#source").value = "";
    currentJob = r.id;
    clipSig = "";
    selected.clear();
    toast(`Trabalho #${r.id} na fila (${FMT_META[selectedMode].label}) ✓`, "ok");
    loadJobs();
    loadJob(true);
  } catch (e) { toast("Erro: " + e.message, "err"); }
  finally { go.disabled = false; }
}

$("#go").onclick = submitJob;
$("#source").addEventListener("keydown", (e) => { if (e.key === "Enter") submitJob(); });

$("#file").onchange = () => {
  const f = $("#file").files[0];
  if (!f) return;
  $("#file-picked").textContent = `Enviando: ${f.name}`;
  const fd = new FormData();
  fd.append("file", f);
  const q = new URLSearchParams({
    count: $("#count").value,
    mode: selectedMode,
    min_score: $("#minscore").value,
    language: $("#lang").value,
    auto_upload: $("#autoup").checked,
    watermark: $("#opt-wm").checked,
    watermark_text: $("#opt-wm-text").value.trim(),
    hook_title: $("#opt-hook").checked,
    hook_style: $("#opt-hook-style").value,
    hook_position: $("#opt-hook-pos").value,
    cam_position: $("#opt-cam-pos").value,
    dopamine_video: $("#opt-broll").value,
    captions: $("#opt-caps").checked,
  });
  const xhr = new XMLHttpRequest();
  $("#upbar").classList.remove("hidden");
  $("#upbar-txt").classList.remove("hidden");
  xhr.upload.onprogress = (e) => {
    const pct = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : 0;
    $("#upbar div").style.width = `${pct}%`;
    $("#upbar-txt").textContent = `Upload: ${pct}%`;
  };
  xhr.onload = () => {
    $("#upbar").classList.add("hidden");
    $("#upbar-txt").classList.add("hidden");
    $("#file-picked").textContent = "";
    $("#file").value = "";
    if (xhr.status >= 300) return toast("Erro ao enviar arquivo: " + xhr.responseText, "err");
    const r = JSON.parse(xhr.responseText);
    currentJob = r.id;
    clipSig = "";
    toast(`Arquivo enviado — trabalho #${r.id} na fila ✓`, "ok");
    loadJobs();
    loadJob(true);
  };
  xhr.onerror = () => {
    $("#upbar").classList.add("hidden");
    $("#upbar-txt").classList.add("hidden");
    $("#file-picked").textContent = "";
    toast("Falha no upload do arquivo", "err");
  };
  xhr.open("POST", "/api/jobs/upload?" + q);
  xhr.send(fd);
};

$("#selall").onclick = () => {
  const cards = $$(".clip");
  const allSel = cards.length > 0 && cards.every((el) => selected.has(+el.dataset.id));
  cards.forEach((el) => {
    const id = +el.dataset.id;
    if (allSel) selected.delete(id);
    else selected.add(id);
    el.classList.toggle("sel", !allSel);
    $(".selbox", el).checked = !allSel;
  });
  syncBatchButtons();
};

$("#rerendersel").onclick = async () => {
  if (!selected.size) return;
  try {
    const r = await api("/api/clips/render-batch", {
      method: "POST",
      body: JSON.stringify({ clip_ids: [...selected] }),
    });
    toast(`${r.queued} corte(s) na fila para re-renderizar ✓`, "ok");
    clipSig = "";
    loadJob(true);
  } catch (e) { toast("Erro: " + e.message, "err"); }
};

$("#compile").onclick = async () => {
  if (selected.size < 2) return toast("Selecione pelo menos 2 cortes", "err");
  try {
    const r = await api("/api/compilation", { method: "POST", body: JSON.stringify({ clip_ids: [...selected] }) });
    toast(`Vídeo longo na fila (#${r.id}) ✓`, "ok");
    currentJob = r.id;
    clipSig = "";
    selected.clear();
    syncBatchButtons();
    loadJobs();
  } catch (e) { toast(e.message, "err"); }
};

$("#upsel").onclick = async () => {
  if (!selected.size) return toast("Selecione cortes", "err");
  let ok = 0;
  for (const id of selected) {
    try {
      await api(`/api/clips/${id}/upload`, { method: "POST", body: JSON.stringify({ schedule: "auto" }) });
      ok++;
    } catch (e) { toast(e.message, "err"); break; }
  }
  if (ok) toast(`${ok} corte(s) enviados para agendamento ✓`, "ok");
  clipSig = "";
  loadJob(true);
};

// ------------------------------------------------------------ BRAND KIT VIEW
function updateBrandPreview() {
  const wmOn = $("#bk-wm-enabled").checked;
  const wmTxt = $("#bk-wm-text").value.trim() || "@BabyDragonOFC";
  const op = +$("#bk-wm-opacity").value || 65;
  const sz = +$("#bk-wm-size").value || 38;
  $("#bk-wm-op-val").textContent = `${op}%`;
  $("#bk-wm-sz-val").textContent = `${sz} px`;

  const preview = $("#bk-preview");
  preview.className = `phone-preview sim-${bkSimMode}`;

  const hk = $("#bk-prev-hook");
  hk.style.display = $("#bk-hook").checked ? "block" : "none";
  const hStyle = $("#bk-hook-style").value;
  hk.className = `prev-hook style-${hStyle}`;
  let hPos = $("#bk-hook-pos").value;
  if (hPos === "auto") hPos = (bkSimMode === "dual" || bkSimMode === "dual_dopamine") ? "middle" : "top";
  hk.style.top = hPos === "middle" ? (bkSimMode === "dual_dopamine" ? "39%" : "35%") : "10%";

  const cp = $("#bk-prev-caps");
  cp.style.display = $("#bk-caps").checked ? "block" : "none";
  const hl = $("#bk-hl-color").value;
  const hlCss = hl.includes("FFE600") ? "#00e5ff" : hl.includes("88FF2E") ? "#2eff88" : hl.includes("882EFF") ? "#ff2e88" : "#ffd900";
  cp.querySelector("span").style.color = hlCss;

  const pw = $("#bk-prev-wm");
  pw.style.display = wmOn && $("#bk-wm-text").value.trim() !== "" ? "block" : "none";
  pw.textContent = wmTxt;
  pw.style.opacity = String(op / 100);
  pw.style.fontSize = `${Math.max(8, Math.round(sz * 0.3))}px`;
  pw.style.top = ""; pw.style.bottom = ""; pw.style.left = ""; pw.style.right = ""; pw.style.transform = "";
  if (bkPos.startsWith("top")) pw.style.top = "4.5%";
  else pw.style.bottom = "5.5%";
  if (bkPos.endsWith("left")) pw.style.left = "10px";
  else if (bkPos.endsWith("right")) pw.style.right = "10px";
  else { pw.style.left = "50%"; pw.style.transform = "translateX(-50%)"; }
}

$$("#bk-wm-pos-grid .pos-btn").forEach((b) => {
  b.onclick = () => {
    bkPos = b.dataset.pos;
    $$("#bk-wm-pos-grid .pos-btn").forEach((x) => x.classList.toggle("active", x.dataset.pos === bkPos));
    updateBrandPreview();
  };
});
$$(".bk-sim-mode").forEach((b) => {
  b.onclick = () => { bkSimMode = b.dataset.sim; updateBrandPreview(); };
});
["#bk-wm-enabled", "#bk-wm-text", "#bk-wm-opacity", "#bk-wm-size", "#bk-hook", "#bk-hook-style",
  "#bk-hook-pos", "#bk-caps", "#bk-words", "#bk-hl-color", "#bk-mode"].forEach((s) => {
  $(s).addEventListener("input", updateBrandPreview);
  $(s).addEventListener("change", updateBrandPreview);
});
$("#bk-mode").addEventListener("change", () => { bkSimMode = $("#bk-mode").value; updateBrandPreview(); });
$("#bk-wm-use-handle").onclick = () => {
  $("#bk-wm-text").value = lastStatus?.channel?.handle || "@BabyDragonOFC";
  updateBrandPreview();
};

async function loadBrandKit() {
  const c = await api("/api/config");
  const r = c.render || {};
  const ch = c.channel || {};
  $("#bk-wm-enabled").checked = r.watermark !== false;
  $("#bk-wm-text").value = ch.watermark_text ?? "";
  bkPos = r.watermark_position || "bottom-center";
  $$("#bk-wm-pos-grid .pos-btn").forEach((b) => b.classList.toggle("active", b.dataset.pos === bkPos));
  $("#bk-wm-opacity").value = r.watermark_opacity ?? 65;
  $("#bk-wm-size").value = r.watermark_size ?? 38;
  $("#bk-hook").checked = r.hook_title !== false;
  $("#bk-hook-style").value = r.hook_style || "white";
  $("#bk-hook-pos").value = r.hook_position || "auto";
  $("#bk-caps").checked = r.captions !== false;
  $("#bk-words").value = String(r.words_per_group || 3);
  $("#bk-hl-color").value = r.highlight_color || "&H0000E5FF";
  $("#bk-mode").value = r.mode || "blur";
  $("#bk-cam-pos").value = r.cam_position || "auto";
  bkSimMode = r.mode || "blur";
  const shortIds = currentClips.filter((x) => x.kind !== "long").map((x) => x.id);
  $("#bk-save-rerender").style.display = shortIds.length ? "inline-flex" : "none";
  updateBrandPreview();
}

async function saveBrandKit() {
  await api("/api/config", {
    method: "POST",
    body: JSON.stringify({
      channel: { watermark_text: $("#bk-wm-text").value.trim() },
      render: {
        mode: $("#bk-mode").value,
        cam_position: $("#bk-cam-pos").value,
        watermark: $("#bk-wm-enabled").checked,
        watermark_position: bkPos,
        watermark_opacity: +$("#bk-wm-opacity").value || 65,
        watermark_size: +$("#bk-wm-size").value || 38,
        hook_title: $("#bk-hook").checked,
        hook_style: $("#bk-hook-style").value,
        hook_position: $("#bk-hook-pos").value,
        captions: $("#bk-caps").checked,
        words_per_group: +$("#bk-words").value || 3,
        highlight_color: $("#bk-hl-color").value,
      },
    }),
  });
  cfgInit = false;
  await loadStatus();
}

$("#bk-save").onclick = async () => {
  const b = $("#bk-save"); b.disabled = true;
  try { await saveBrandKit(); toast("Brand Kit salvo ✓", "ok"); }
  catch (e) { toast("Erro: " + e.message, "err"); }
  finally { b.disabled = false; }
};
$("#bk-save-rerender").onclick = async () => {
  const shortIds = currentClips.filter((x) => x.kind !== "long").map((x) => x.id);
  if (!shortIds.length) return;
  const b = $("#bk-save-rerender"); b.disabled = true;
  try {
    await saveBrandKit();
    const r = await api("/api/clips/render-batch", { method: "POST", body: JSON.stringify({ clip_ids: shortIds }) });
    toast(`Brand Kit salvo e ${r.queued} corte(s) na fila para re-renderizar ✓`, "ok");
    clipSig = "";
    switchView("studio");
    loadJob(true);
  } catch (e) { toast("Erro: " + e.message, "err"); }
  finally { b.disabled = false; }
};

// ------------------------------------------------------------ LIBRARY & B-ROLL VIEW
$$(".lib-tab").forEach((b) => {
  b.onclick = () => {
    const t = b.dataset.ltab;
    $$(".lib-tab").forEach((x) => x.classList.toggle("active", x.dataset.ltab === t));
    $("#lib-clips-panel").classList.toggle("active", t === "clips");
    $("#lib-broll-panel").classList.toggle("active", t === "broll");
  };
});

async function loadLibraryClips() {
  const all = await api("/api/clips");
  const q = ($("#lib-search").value || "").trim().toLowerCase();
  const st = $("#lib-status").value;
  const filtered = all.filter((c) => {
    if (st !== "all" && c.status !== st) return false;
    if (q && !`${c.title} ${c.hook} ${c.job_title} ${c.category}`.toLowerCase().includes(q)) return false;
    return true;
  });
  $("#lib-grid").innerHTML = filtered.map((c) => `
    <div class="lib-card">
      ${c.video_url ? `<video src="${c.video_url}" controls preload="metadata" poster="${c.thumb_url || ""}"></video>` : `<div class="vid-placeholder" style="width:100%">${esc(c.status)}</div>`}
      <div class="row" style="justify-content:space-between;gap:4px">
        <span class="badge ${scoreClass(c.score)}" style="font-size:13px;min-width:auto;padding:2px 8px">${Math.round(c.score || 0)}</span>
        <span class="tag">${esc(FMT_META[c.render_mode]?.label || c.render_mode || c.kind)}</span>
        <span class="tag status-${c.status}">${esc(c.status)}</span>
      </div>
      <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.title)}">${esc(c.title || c.hook)}</div>
      <div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.job_title)}</div>
      <div class="btns">
        <button class="small b-open-job" data-jid="${c.job_id}" type="button">Abrir no Studio</button>
        ${c.video_url ? `<a href="${c.video_url}" download><button class="small" type="button">⬇ MP4</button></a>` : ""}
      </div>
    </div>`).join("") || `<div class="empty-state">Nenhum corte encontrado na biblioteca.</div>`;
  $$(".b-open-job", $("#lib-grid")).forEach((btn) => {
    btn.onclick = () => { currentJob = +btn.dataset.jid; clipSig = ""; switchView("studio"); loadJobs(); loadJob(true); };
  });
}
$("#lib-search").oninput = loadLibraryClips;
$("#lib-status").onchange = loadLibraryClips;
$("#lib-refresh").onclick = loadLibraryClips;

async function loadBroll() {
  const list = await api("/api/broll");
  refreshBrollSelect();
  const defBroll = lastStatus?.render?.dopamine_video || "";
  $("#broll-grid").innerHTML = list.map((b) => `
    <div class="lib-card broll">
      <video src="${b.url}" controls preload="metadata"></video>
      <div class="row" style="justify-content:space-between">
        <strong style="font-size:13px;overflow:hidden;text-overflow:ellipsis">${esc(b.name)}</strong>
        <span class="tag">${b.size_mb} MB</span>
      </div>
      <div class="btns">
        <button class="small ${defBroll === b.name ? "accent" : ""} b-use-broll" data-name="${esc(b.name)}" type="button">
          ${defBroll === b.name ? "✓ Padrão Dual Dopamine" : "Usar como padrão"}
        </button>
        <button class="small b-del-broll" data-name="${esc(b.name)}" type="button">🗑</button>
      </div>
    </div>`).join("") || `<div class="empty-state">Nenhum vídeo B-Roll enviado ainda. Sem B-Roll, o modo Dual Dopamine divide Facecam + Gameplay + Banner central automaticamente!</div>`;

  $$(".b-use-broll", $("#broll-grid")).forEach((btn) => {
    btn.onclick = async () => {
      await api("/api/config", { method: "POST", body: JSON.stringify({ render: { dopamine_video: btn.dataset.name } }) });
      await loadStatus();
      loadBroll();
      toast(`"${btn.dataset.name}" definido como B-Roll padrão ✓`, "ok");
    };
  });
  $$(".b-del-broll", $("#broll-grid")).forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Remover B-Roll "${btn.dataset.name}"?`)) return;
      await api(`/broll/${encodeURIComponent(btn.dataset.name)}`, { method: "DELETE" });
      await loadStatus();
      loadBroll();
      toast("B-Roll removido", "ok");
    };
  });
}

$("#broll-upload").onchange = () => {
  const f = $("#broll-upload").files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  toast(`Enviando B-Roll "${f.name}"…`);
  fetch("/api/broll", { method: "POST", body: fd })
    .then((r) => r.ok ? r.json() : r.json().then((d) => { throw new Error(d.detail || r.statusText); }))
    .then(() => { $("#broll-upload").value = ""; loadBroll(); toast("B-Roll adicionado ✓", "ok"); })
    .catch((e) => toast("Erro: " + e.message, "err"));
};

// ------------------------------------------------------------ CALENDAR VIEW
async function loadCalendar() {
  const d = await api("/api/schedule");
  $("#cal-sub").textContent = `Fuso: ${d.upload_cfg.timezone} · Máx ${d.upload_cfg.max_per_day}/dia · YouTube ${d.youtube_auth ? "conectado ✓" : "não conectado"}`;
  $("#cal-slots").innerHTML = (d.upcoming_slots || []).map((iso) =>
    `<span class="slot-chip">🕒 ${new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>`
  ).join("") || `<span class="muted">Sem horários livres.</span>`;

  const schedItems = [...(d.scheduled || []), ...(d.published || []).slice(0, 10)];
  $("#cal-scheduled").innerHTML = schedItems.map((c) => `
    <div class="sched-row">
      <div style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</div>
        <div class="muted" style="font-size:12px">${c.publish_at ? "Agendado: " + new Date(c.publish_at).toLocaleString("pt-BR") : "Publicado"}</div>
      </div>
      ${c.youtube_url ? `<a class="yt" href="${c.youtube_url}" target="_blank" rel="noopener">▶ Abrir</a>` : `<span class="tag">${esc(c.status)}</span>`}
    </div>`).join("") || `<div class="muted">Nenhum vídeo agendado ou publicado ainda.</div>`;

  $("#cal-ready").innerHTML = (d.ready || []).slice(0, 20).map((c) => `
    <div class="sched-row">
      <div style="min-width:0">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title || c.hook)}</div>
        <div class="muted" style="font-size:12px">Score ${Math.round(c.score || 0)} · ${esc(c.score_label)}</div>
      </div>
      <div class="row" style="gap:6px;flex-wrap:nowrap">
        <button class="small primary cal-auto" data-id="${c.id}" type="button">⬆ Próximo slot</button>
      </div>
    </div>`).join("") || `<div class="muted">Todos os cortes prontos já foram agendados!</div>`;

  $$(".cal-auto", $("#cal-ready")).forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/api/clips/${btn.dataset.id}/upload`, { method: "POST", body: JSON.stringify({ schedule: "auto" }) });
        toast("Enviado para o próximo slot livre ✓", "ok");
        loadCalendar();
      } catch (e) { toast(e.message, "err"); }
    };
  });
}
$("#cal-refresh").onclick = loadCalendar;

// ------------------------------------------------------------ ANALYTICS VIEW
async function loadAnalytics() {
  const a = await api("/api/analytics");
  const t = a.totals;
  $("#ana-kpis").innerHTML = `
    <div class="kpi"><small>Cortes Gerados</small><strong>${t.clips}</strong><span class="muted">${t.compilations} compilações · ${t.jobs_done}/${t.jobs} jobs</span></div>
    <div class="kpi"><small>Score Médio Viral</small><strong>${t.avg_score}</strong><span class="muted">${a.tiers.viral} cortes 🔥 Viral (≥85)</span></div>
    <div class="kpi"><small>Conteúdo Processado</small><strong>${t.source_minutes} min</strong><span class="muted">${t.clips_minutes} min de cortes gerados</span></div>
    <div class="kpi"><small>Publicações YouTube</small><strong>${t.scheduled + t.uploaded}</strong><span class="muted">${t.scheduled} agendados · ${t.uploaded} no ar</span></div>
  `;

  const totalTiers = Math.max(1, a.tiers.viral + a.tiers.high + a.tiers.medium + a.tiers.low);
  const tierMeta = [
    ["🔥 Viral (85+)", a.tiers.viral],
    ["Alto (70-84)", a.tiers.high],
    ["Médio (55-69)", a.tiers.medium],
    ["Baixo (<55)", a.tiers.low],
  ];
  $("#ana-tiers").innerHTML = tierMeta.map(([lbl, val]) => `
    <div class="tier-bar-row">
      <span>${lbl}</span>
      <div class="tier-bar-track"><i style="width:${Math.round((val / totalTiers) * 100)}%"></i></div>
      <strong>${val}</strong>
    </div>`).join("");

  const maxMode = Math.max(1, ...a.modes.map((m) => m[1]));
  $("#ana-modes").innerHTML = a.modes.map(([m, val]) => `
    <div class="tier-bar-row">
      <span>${esc(FMT_META[m]?.label || m)}</span>
      <div class="tier-bar-track"><i style="width:${Math.round((val / maxMode) * 100)}%;background:var(--cyan)"></i></div>
      <strong>${val}</strong>
    </div>`).join("") || `<div class="muted">Sem dados ainda.</div>`;

  const ob = a.onboarding;
  const obList = [
    ["FFmpeg + libass instalado", ob.has_ffmpeg],
    ["Chave Gemini IA configurada", ob.has_gemini],
    ["Marca d'água definida", ob.has_watermark],
    ["Canal YouTube conectado", ob.has_youtube],
    ["Primeiro lote de cortes gerado", ob.has_clips],
  ];
  $("#ana-onboard").innerHTML = obList.map(([lbl, ok]) =>
    `<div class="check-row"><span>${lbl}</span><span class="tag ${ok ? "status-done" : "status-error"}">${ok ? "✓ OK" : "Pendente"}</span></div>`
  ).join("");

  $("#ana-cats").innerHTML = a.categories.map(([cat, n]) =>
    `<span class="tag">${esc(cat)}: <b>${n}</b></span>`
  ).join("") || `<span class="muted">Sem categorias.</span>`;

  $("#ana-top").innerHTML = a.top_clips.map((c) => `
    <div class="lib-card">
      ${c.video_url ? `<video src="${c.video_url}" controls preload="metadata" poster="${c.thumb_url || ""}"></video>` : ""}
      <div class="row" style="justify-content:space-between">
        <span class="badge ${scoreClass(c.score)}" style="font-size:13px;min-width:auto;padding:2px 8px">${Math.round(c.score)}</span>
        <span class="tag">${esc(c.category)}</span>
      </div>
      <div style="font-weight:600;font-size:13px">${esc(c.title || c.hook)}</div>
    </div>`).join("") || `<div class="empty-state">Processe um vídeo para ver seu ranking viral aqui.</div>`;
}

// ------------------------------------------------------------ BILLING & ACCOUNT VIEW
const PLANS = [
  { id: "Starter", price: "R$ 0", period: "/mês", feats: ["Até 60 min/mês de vídeo", "Formatos Blur & Crop", "Marca d'água padrão", "Exportação MP4 local"] },
  { id: "Pro", price: "R$ 97", period: "/mês", feats: ["Até 600 min/mês de vídeo", "Dual Stream + Dual Dopamine", "Brand Kit completo + SEO IA", "Agendamento YouTube automático"] },
  { id: "Agency", price: "R$ 247", period: "/mês", feats: ["Minutos ilimitados", "Multi-canais & Monitor RSS", "Compilações 16:9 ilimitadas", "Suporte prioritário & White-label"] },
];

async function loadBilling() {
  const [c, a] = await Promise.all([api("/api/config"), api("/api/analytics")]);
  const ws = c.workspace || {};
  $("#acc-owner").value = ws.owner_name || "";
  $("#acc-tagline").value = ws.brand_tagline || "";
  $("#acc-ch-name").value = c.channel?.name || "";
  $("#acc-handle").value = c.channel?.handle || "";
  $("#acc-license").value = ws.license_key || "";

  const plan = ws.plan || "Pro";
  const limitMin = plan === "Starter" ? 60 : plan === "Pro" ? 600 : 3000;
  const usedMin = a.totals.source_minutes || 0;
  const pct = Math.min(100, Math.round((usedMin / limitMin) * 100));

  $("#bill-usage").innerHTML = `
    <div class="check-row"><span>Plano ativo</span><span class="plan-chip">${esc(plan.toUpperCase())}</span></div>
    <div class="check-row"><span>Minutos processados</span><strong>${usedMin} / ${plan === "Agency" ? "∞" : limitMin + " min"}</strong></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="check-row"><span>Cortes renderizados no workspace</span><strong>${a.totals.clips} cortes</strong></div>
    <div class="check-row"><span>Compilações 16:9 geradas</span><strong>${a.totals.compilations} vídeos</strong></div>
  `;

  $("#plans-grid").innerHTML = PLANS.map((p) => `
    <div class="plan-card ${p.id === plan ? "active" : ""}">
      <div class="row" style="justify-content:space-between">
        <strong>${p.id}</strong>
        ${p.id === plan ? `<span class="tag status-done">Ativo</span>` : ""}
      </div>
      <div class="plan-price">${p.price} <small>${p.period}</small></div>
      <ul>${p.feats.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <button type="button" class="small ${p.id === plan ? "accent" : "primary"} b-set-plan" data-plan="${p.id}">
        ${p.id === plan ? "✓ Plano Atual" : "Selecionar " + p.id}
      </button>
    </div>`).join("");

  $$(".b-set-plan", $("#plans-grid")).forEach((btn) => {
    btn.onclick = async () => {
      await api("/api/config", { method: "POST", body: JSON.stringify({ workspace: { plan: btn.dataset.plan } }) });
      await loadStatus();
      loadBilling();
      toast(`Workspace atualizado para o plano ${btn.dataset.plan} ✓`, "ok");
    };
  });
}

$("#acc-save").onclick = async () => {
  await api("/api/config", {
    method: "POST",
    body: JSON.stringify({
      workspace: {
        owner_name: $("#acc-owner").value.trim(),
        brand_tagline: $("#acc-tagline").value.trim() || "GTA 6 Studio",
        license_key: $("#acc-license").value.trim(),
      },
      channel: {
        name: $("#acc-ch-name").value.trim() || "GTA VI",
        handle: $("#acc-handle").value.trim() || "@BabyDragonOFC",
      },
    }),
  });
  await loadStatus();
  loadBilling();
  toast("Perfil do workspace salvo ✓", "ok");
};

// ------------------------------------------------------------ QUICK CONFIG MODAL
function switchMTab(name) {
  $$(".m-tab").forEach((b) => b.classList.toggle("active", b.dataset.mtab === name));
  $$(".m-panel").forEach((p) => p.classList.toggle("active", p.dataset.mpanel === name));
}
$$(".m-tab").forEach((b) => { b.onclick = () => switchMTab(b.dataset.mtab); });

async function openConfig(tab = "ai") {
  const c = await api("/api/config");
  $("#cfg-gem").value = "";
  $("#cfg-gem-st").textContent = c.gemini_set ? `Chave atual: ${c.gemini_masked}` : "Nenhuma chave configurada.";
  $("#cfg-lang").value = (c.transcription && c.transcription.language) || "auto";
  $("#cfg-count").value = c.clips?.target_count ?? 10;
  $("#cfg-minscore").value = c.clips?.min_score ?? 50;
  $("#cfg-use-video").checked = c.llm?.use_video_analysis !== false;
  $("#cfg-ch-name").value = c.channel?.name || "GTA VI";
  $("#cfg-handle").value = c.channel?.handle || "@BabyDragonOFC";
  $("#cfg-cta").value = c.channel?.cta || "";
  $("#cfg-yt-st").textContent = c.client_secret ? "client_secret.json encontrado ✓" : "client_secret.json ainda não enviado.";
  $("#cfg-maxday").value = c.upload?.max_per_day || 6;
  $("#cfg-tz").value = c.upload?.timezone || "America/Sao_Paulo";
  $("#cfg-slots").value = (c.upload?.slots || []).join(", ");
  $("#cfg-sources").value = (c.monitor?.sources || []).map((s) => `${s.name || ""} | ${s.channel_id || ""}`).join("\n");
  $("#cfg-mon-auto").checked = !!c.monitor?.auto_upload;
  switchMTab(tab);
  $("#cfg-modal").classList.remove("hidden");
}

$("#open-cfg").onclick = () => openConfig("ai");
$("#close-cfg").onclick = () => $("#cfg-modal").classList.add("hidden");
$("#cfg-modal").onclick = (e) => { if (e.target === $("#cfg-modal")) $("#cfg-modal").classList.add("hidden"); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#cfg-modal").classList.contains("hidden")) $("#cfg-modal").classList.add("hidden");
});

$("#cfg-save").onclick = async () => {
  const sources = $("#cfg-sources").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split("|").map((x) => x.trim());
    return parts.length >= 2 ? { name: parts[0], channel_id: parts[1] } : { name: parts[0], channel_id: parts[0] };
  });
  const slots = $("#cfg-slots").value.split(",").map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  const lang = $("#cfg-lang").value;
  await api("/api/config", {
    method: "POST",
    body: JSON.stringify({
      gemini_api_key: $("#cfg-gem").value.trim() || null,
      channel: {
        name: $("#cfg-ch-name").value.trim() || "GTA VI",
        handle: $("#cfg-handle").value.trim() || "@BabyDragonOFC",
        cta: $("#cfg-cta").value.trim(),
      },
      clips: { target_count: +$("#cfg-count").value || 10, min_score: +$("#cfg-minscore").value || 50 },
      llm: { use_video_analysis: $("#cfg-use-video").checked },
      transcription: { language: lang === "auto" ? null : lang },
      upload: {
        max_per_day: +$("#cfg-maxday").value || 6,
        timezone: $("#cfg-tz").value.trim() || "America/Sao_Paulo",
        ...(slots.length ? { slots } : {}),
      },
      monitor: { auto_upload: $("#cfg-mon-auto").checked, sources },
    }),
  });
  cfgInit = false;
  await loadStatus();
  $("#cfg-modal").classList.add("hidden");
  toast("Configurações salvas ✓", "ok");
};

$("#cfg-test-gem").onclick = async () => {
  if ($("#cfg-gem").value.trim()) {
    await api("/api/config", { method: "POST", body: JSON.stringify({ gemini_api_key: $("#cfg-gem").value.trim() }) });
  }
  $("#cfg-gem-st").textContent = "Testando Gemini…";
  try {
    const r = await api("/api/gemini/test", { method: "POST" });
    $("#cfg-gem-st").textContent = `Conectado ✓ Modelo ativo: ${r.model}`;
    loadStatus();
  } catch (e) { $("#cfg-gem-st").textContent = "Erro: " + e.message; }
};

$("#cfg-secret").onchange = async () => {
  const f = $("#cfg-secret").files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  const r = await fetch("/api/youtube/secret", { method: "POST", body: fd });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return toast("Erro: " + (j.detail || r.statusText), "err"); }
  $("#cfg-yt-st").textContent = "client_secret.json salvo ✓ Agora clique em Conectar canal.";
  loadStatus();
};

$("#cfg-yt-conn").onclick = async () => {
  toast("Abrindo navegador para autorizar o YouTube…");
  try {
    const c = await api("/api/youtube/auth", { method: "POST" });
    $("#cfg-yt-st").textContent = "Conectado: " + (c.title || "OK");
    loadStatus();
  } catch (e) { $("#cfg-yt-st").textContent = "Erro: " + e.message; }
};

$("#cfg-mon-check").onclick = async () => {
  const r = await api("/api/monitor/check", { method: "POST" });
  toast(r.created.length ? `${r.created.length} novo(s) vídeo(s) na fila!` : "Nenhum vídeo novo nas fontes.");
  loadJobs();
};

// ------------------------------------------------------------ init & polling
loadStatus();
loadJobs();
setInterval(() => {
  if (currentView === "studio") { loadJobs(); loadJob(); }
}, 3000);
setInterval(loadStatus, 10000);
