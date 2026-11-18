const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch {} throw new Error(m); }
  return r.json();
};
const toast = (m) => { const d = document.createElement("div"); d.textContent = m; $("#toast").appendChild(d); setTimeout(() => d.remove(), 5000); };

let currentJob = null, clipSig = "", selected = new Set();

// ------------------------------------------------------------ status
async function loadStatus() {
  try {
    const s = await api("/api/status");
    const p = [];
    p.push(`<span class="pill ${s.ffmpeg ? "ok" : "bad"}">FFmpeg ${s.ffmpeg ? "✓" : "✗"}${s.ffmpeg && !s.subtitles ? " (sem legendas)" : ""}</span>`);
    p.push(`<span class="pill ${s.gemini ? "ok" : "bad"}">${s.gemini ? "IA: " + esc(s.gemini_model) : "IA: sem GEMINI_API_KEY (heurístico)"}</span>`);
    p.push(s.youtube_auth ? `<span class="pill ok">YouTube conectado ✓</span>`
      : `<span class="pill bad">YouTube ✗ <button id="ytauth">Conectar</button></span>`);
    p.push(`<span class="pill">${esc(s.channel.handle)}</span>`);
    if (s.queues.pipeline || s.queues.uploads) p.push(`<span class="pill">Fila: ${s.queues.pipeline} render · ${s.queues.uploads} upload</span>`);
    $("#pills").innerHTML = p.join("");
    const b = $("#ytauth");
    if (b) b.onclick = async () => {
      if (!s.client_secret) return toast("Coloque credentials/client_secret.json (veja README) antes de conectar.");
      toast("Abrindo navegador para autorizar o canal...");
      try { const c = await api("/api/youtube/auth", { method: "POST" }); toast("Conectado: " + (c.title || "ok")); loadStatus(); }
      catch (e) { toast("Erro: " + e.message); }
    };
  } catch (e) { /* servidor reiniciando */ }
}

// ------------------------------------------------------------ jobs
async function loadJobs() {
  const jobs = await api("/api/jobs");
  $("#jobs").innerHTML = jobs.map((j) => `
    <div class="job ${currentJob === j.id ? "active" : ""}" data-id="${j.id}">
      <div class="t">${j.kind === "compilation" ? "🎬 " : ""}${esc(j.title || j.source)}</div>
      <div class="s"><span class="status-${j.status}">${j.status === "done" ? "✓ concluído" : j.status === "error" ? "✗ erro" : esc(j.stage || j.status)}</span>
        <span>#${j.id} <span class="del" data-del="${j.id}" title="Excluir">🗑</span></span></div>
      ${j.status === "running" || j.status === "queued" ? `<div class="progress"><div style="width:${Math.round((j.progress || 0) * 100)}%"></div></div>` : ""}
    </div>`).join("") || `<div class="muted">Nenhum trabalho ainda. Cole um link acima.</div>`;
  document.querySelectorAll(".job").forEach((el) => el.onclick = (ev) => {
    const del = ev.target.dataset.del;
    if (del) { if (confirm("Excluir trabalho e arquivos?")) api(`/api/jobs/${del}`, { method: "DELETE" }).then(() => { if (currentJob == del) currentJob = null; loadJobs(); }); return; }
    currentJob = +el.dataset.id; clipSig = ""; selected.clear(); loadJob(); loadJobs();
  });
  if (!currentJob && jobs.length) { currentJob = jobs[0].id; loadJob(); }
}

const scoreClass = (s) => s >= 85 ? "v" : s >= 70 ? "h" : s >= 55 ? "m" : "l";
const LBL = { llm: "IA", energy: "Energia", hook: "Gancho 3s", dynamics: "Ritmo", duration: "Duração", trend: "Tendência" };

function clipCard(c) {
  const bd = c.breakdown || {};
  const bars = Object.keys(LBL).filter((k) => k in bd).map((k) =>
    `<span>${LBL[k]}</span><div class="bar"><i style="width:${bd[k]}%"></i></div><span>${Math.round(bd[k])}</span>`).join("");
  const media = c.video_url ? `<video src="${c.video_url}" controls preload="metadata" poster="${c.thumb_url || ""}"></video>`
    : `<div class="muted" style="width:170px;aspect-ratio:9/16;display:grid;place-items:center;background:#000;border-radius:9px">${esc(c.status)}…</div>`;
  const yt = c.youtube_id ? `<a class="yt" href="${c.youtube_url}" target="_blank">▶ ${c.status === "scheduled" ? "Agendado " + new Date(c.publish_at).toLocaleString("pt-BR") : "No ar"}</a>` : "";
  return `
  <div class="clip ${c.kind === "long" ? "long" : ""} ${selected.has(c.id) ? "sel" : ""}" data-id="${c.id}">
    ${media}
    <div class="f">
      <div class="score">
        <div class="badge ${scoreClass(c.score)}" title="Score de viralização">${Math.round(c.score || 0)}</div>
        <div class="bars">${bars || `<span>${esc(c.score_label || "")}</span>`}</div>
      </div>
      <div class="meta-row"><span class="tag">${esc(c.score_label || "")}</span><span class="tag">${esc(c.category || c.kind)}</span>
        ${c.kind === "short" ? `<span>${(c.end - c.start).toFixed(1)}s</span>` : ""} ${yt}
        <label style="margin-left:auto"><input type="checkbox" class="selbox" ${selected.has(c.id) ? "checked" : ""}> selecionar</label></div>
      ${c.reason ? `<div class="muted" style="font-size:12px">💡 ${esc(c.reason)}</div>` : ""}
      <div class="lbl"><span>Título</span><span class="cnt"></span></div>
      <input class="i-title" maxlength="100" value="${esc(c.title)}">
      <div class="lbl">Descrição</div>
      <textarea class="i-desc">${esc(c.description)}</textarea>
      <div class="lbl">Hashtags</div>
      <input class="i-hash" value="${esc((c.hashtags || []).join(" "))}">
      <div class="lbl"><span>Tags ${c.kind === "long" ? "(vídeo longo)" : "(opcional em Shorts)"}</span></div>
      <input class="i-tags" value="${esc((c.tags || []).join(", "))}">
      ${c.kind === "short" ? `<div class="meta-row">Gancho <input class="i-hook" style="width:170px" value="${esc(c.hook)}">
        Início <input class="i-start" type="number" step="0.1" value="${c.start}"> Fim <input class="i-end" type="number" step="0.1" value="${c.end}"></div>` : ""}
      ${c.error ? `<div class="err">${esc(c.error)}</div>` : ""}
      <div class="btns">
        <button class="small b-save">💾 Salvar</button>
        <button class="small b-seo">✨ Regerar SEO</button>
        ${c.kind === "short" ? `<button class="small b-render">🎞 Re-renderizar</button>` : ""}
        <button class="small b-copy">📋 Copiar</button>
        ${c.video_url ? `<a href="${c.video_url}" download><button class="small">⬇ MP4</button></a>` : ""}
        ${c.thumb_url ? `<a href="${c.thumb_url}" download><button class="small">⬇ Capa</button></a>` : ""}
        ${!c.youtube_id && c.status === "rendered" ? `<button class="small primary b-up">⬆ Agendar</button><button class="small b-now">Publicar já</button>` : ""}
      </div>
    </div>
  </div>`;
}

function readCard(el) {
  const v = (s) => $(s, el)?.value;
  const out = {
    title: v(".i-title"), description: v(".i-desc"),
    hashtags: (v(".i-hash") || "").split(/\s+/).filter(Boolean),
    tags: (v(".i-tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
  };
  if ($(".i-hook", el)) { out.hook = v(".i-hook"); out.start = +v(".i-start"); out.end = +v(".i-end"); }
  return out;
}

function bindCard(el) {
  const id = +el.dataset.id;
  const cnt = () => { $(".cnt", el).textContent = `${$(".i-title", el).value.length}/100`; };
  $(".i-title", el).oninput = cnt; cnt();
  $(".selbox", el).onchange = (e) => { e.target.checked ? selected.add(id) : selected.delete(id); el.classList.toggle("sel", e.target.checked); };
  $(".b-save", el).onclick = async () => { await api(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(readCard(el)) }); toast("Salvo ✓"); };
  $(".b-seo", el).onclick = async () => { toast("Gerando novo SEO..."); await api(`/api/clips/${id}/metadata`, { method: "POST" }); clipSig = ""; loadJob(); };
  const r = $(".b-render", el);
  if (r) r.onclick = async () => { await api(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(readCard(el)) }); await api(`/api/clips/${id}/render`, { method: "POST" }); toast("Re-renderizando..."); clipSig = ""; };
  $(".b-copy", el).onclick = () => {
    const d = readCard(el);
    navigator.clipboard.writeText(`${d.title}\n\n${d.description}\n\nTags: ${d.tags.join(", ")}`); toast("Título + descrição + tags copiados");
  };
  const up = async (schedule) => {
    try { await api(`/api/clips/${id}`, { method: "PATCH", body: JSON.stringify(readCard(el)) });
      await api(`/api/clips/${id}/upload`, { method: "POST", body: JSON.stringify({ schedule }) });
      toast(schedule === "auto" ? "Enviando e agendando no próximo horário livre..." : "Enviando e publicando..."); clipSig = "";
    } catch (e) { toast("Erro: " + e.message); }
  };
  const bu = $(".b-up", el); if (bu) bu.onclick = () => up("auto");
  const bn = $(".b-now", el); if (bn) bn.onclick = () => { if (confirm("Publicar imediatamente?")) up("now"); };
}

async function loadJob() {
  if (!currentJob) return;
  const j = await api(`/api/jobs/${currentJob}`);
  $("#jobtitle").textContent = j.title || j.source;
  const dur = j.duration ? ` · ${Math.round(j.duration / 60)} min` : "";
  $("#jobinfo").innerHTML = `<span class="status-${j.status}">${esc(j.status)}</span> · ${esc(j.stage || "")}${dur} ${j.message ? "· " + esc(j.message) : ""}
    ${j.status === "error" ? ` <button class="small" id="retry">Tentar de novo</button>` : ""}`;
  const rb = $("#retry"); if (rb) rb.onclick = () => api(`/api/jobs/${j.id}/retry`, { method: "POST" }).then(() => { clipSig = ""; loadJobs(); });
  const sig = JSON.stringify(j.clips.map((c) => [c.id, c.status, c.file_path, c.thumb_url, c.youtube_id, c.publish_at, c.title, c.description, c.tags, c.hashtags, c.score, c.error]));
  if (sig === clipSig) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest(".clip") && clipSig) return; // não atrapalha edição
  clipSig = sig;
  $("#clips").innerHTML = j.clips.map(clipCard).join("") || `<div class="muted">${j.status === "done" ? "Nenhum corte." : "Processando… os cortes aparecem aqui."}</div>`;
  document.querySelectorAll(".clip").forEach(bindCard);
}

// ------------------------------------------------------------ ações
$("#go").onclick = async () => {
  const source = $("#source").value.trim();
  if (!source) return toast("Cole um link ou caminho de arquivo");
  const body = { source, count: +$("#count").value, mode: $("#mode").value, min_score: +$("#minscore").value, auto_upload: $("#autoup").checked };
  const r = await api("/api/jobs", { method: "POST", body: JSON.stringify(body) });
  $("#source").value = ""; currentJob = r.id; clipSig = ""; toast(`Trabalho #${r.id} na fila`); loadJobs(); loadJob();
};

$("#file").onchange = () => {
  const f = $("#file").files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  const q = new URLSearchParams({ count: $("#count").value, mode: $("#mode").value, auto_upload: $("#autoup").checked });
  const xhr = new XMLHttpRequest();
  $("#upbar").classList.remove("hidden");
  xhr.upload.onprogress = (e) => { $("#upbar div").style.width = `${(e.loaded / e.total) * 100}%`; };
  xhr.onload = () => {
    $("#upbar").classList.add("hidden");
    if (xhr.status >= 300) return toast("Erro ao enviar arquivo: " + xhr.responseText);
    const r = JSON.parse(xhr.responseText); currentJob = r.id; clipSig = ""; toast(`Arquivo enviado — trabalho #${r.id}`); loadJobs();
  };
  xhr.open("POST", "/api/jobs/upload?" + q); xhr.send(fd);
};

$("#selall").onclick = () => { document.querySelectorAll(".clip").forEach((el) => { selected.add(+el.dataset.id); el.classList.add("sel"); $(".selbox", el).checked = true; }); };
$("#compile").onclick = async () => {
  if (selected.size < 2) return toast("Selecione pelo menos 2 cortes");
  try { const r = await api("/api/compilation", { method: "POST", body: JSON.stringify({ clip_ids: [...selected] }) });
    toast(`Vídeo longo na fila (#${r.id})`); currentJob = r.id; clipSig = ""; selected.clear(); loadJobs(); } catch (e) { toast(e.message); }
};
$("#upsel").onclick = async () => {
  if (!selected.size) return toast("Selecione cortes");
  for (const id of selected) { try { await api(`/api/clips/${id}/upload`, { method: "POST", body: JSON.stringify({ schedule: "auto" }) }); } catch (e) { toast(e.message); break; } }
  toast(`${selected.size} cortes enviados para agendamento`); clipSig = "";
};

// ------------------------------------------------------------ configurações
async function openConfig() {
  const c = await api("/api/config");
  $("#cfg-gem").value = "";
  $("#cfg-gem-st").textContent = c.gemini_set ? `Chave atual: ${c.gemini_masked}` : "Nenhuma chave configurada.";
  $("#cfg-yt-st").textContent = c.client_secret ? "client_secret.json encontrado ✓" : "client_secret.json ainda não enviado.";
  $("#cfg-handle").value = c.channel.handle || "@BabyDragonOFC";
  $("#cfg-maxday").value = c.upload.max_per_day || 6;
  $("#cfg-slots").value = (c.upload.slots || []).join(", ");
  $("#cfg-sources").value = (c.monitor.sources || []).map((s) => `${s.name || ""} | ${s.channel_id || ""}`).join("\n");
  $("#cfg-mon-auto").checked = !!c.monitor.auto_upload;
  $("#cfg-modal").classList.remove("hidden");
}
$("#open-cfg").onclick = openConfig;
$("#close-cfg").onclick = () => $("#cfg-modal").classList.add("hidden");
$("#cfg-modal").onclick = (e) => { if (e.target === $("#cfg-modal")) $("#cfg-modal").classList.add("hidden"); };

$("#cfg-save").onclick = async () => {
  const sources = $("#cfg-sources").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split("|").map((x) => x.trim());
    return parts.length >= 2 ? { name: parts[0], channel_id: parts[1] } : { name: parts[0], channel_id: parts[0] };
  });
  const slots = $("#cfg-slots").value.split(",").map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  const payload = {
    gemini_api_key: $("#cfg-gem").value.trim() || null,
    channel: { handle: $("#cfg-handle").value.trim() || "@BabyDragonOFC", watermark_text: $("#cfg-handle").value.trim() || "@BabyDragonOFC" },
    upload: { max_per_day: +$("#cfg-maxday").value || 6, ...(slots.length ? { slots } : {}) },
    monitor: { auto_upload: $("#cfg-mon-auto").checked, sources },
  };
  await api("/api/config", { method: "POST", body: JSON.stringify(payload) });
  toast("Configurações salvas ✓");
  loadStatus();
  openConfig();
};

$("#cfg-test-gem").onclick = async () => {
  if ($("#cfg-gem").value.trim()) await api("/api/config", { method: "POST", body: JSON.stringify({ gemini_api_key: $("#cfg-gem").value.trim() }) });
  $("#cfg-gem-st").textContent = "Testando Gemini...";
  try {
    const r = await api("/api/gemini/test", { method: "POST" });
    $("#cfg-gem-st").textContent = `Conectado ✓ Modelo ativo: ${r.model}`;
    loadStatus();
  } catch (e) { $("#cfg-gem-st").textContent = "Erro: " + e.message; }
};

$("#cfg-secret").onchange = async () => {
  const f = $("#cfg-secret").files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  const r = await fetch("/api/youtube/secret", { method: "POST", body: fd });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return toast("Erro: " + (j.detail || r.statusText)); }
  $("#cfg-yt-st").textContent = "client_secret.json salvo ✓ Agora clique em Conectar canal.";
  loadStatus();
};

$("#cfg-yt-conn").onclick = async () => {
  toast("Abrindo navegador para autorizar o YouTube...");
  try { const c = await api("/api/youtube/auth", { method: "POST" }); $("#cfg-yt-st").textContent = "Conectado: " + (c.title || "OK"); loadStatus(); }
  catch (e) { $("#cfg-yt-st").textContent = "Erro: " + e.message; }
};

$("#cfg-mon-check").onclick = async () => {
  const r = await api("/api/monitor/check", { method: "POST" });
  toast(r.created.length ? `${r.created.length} novo(s) vídeo(s) na fila!` : "Nenhum vídeo novo nas fontes.");
  loadJobs();
};

loadStatus(); loadJobs();
setInterval(() => { loadJobs(); loadJob(); }, 3000);
setInterval(loadStatus, 10000);
