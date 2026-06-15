const invoke = window.__TAURI__.core.invoke;

const state = {
  networks: [],
  status: null,
  serviceUp: false,
  installed: false,
  tokenOk: false,
  scan: { hosts: [], yourIp: "", loading: false, error: "", done: false },
  owned: { members: [], loading: false, error: "", done: false },
  page: "home",
  selected: localStorage.getItem("zt_selected") || ""
};

function cfg() {
  return {
    lang: localStorage.getItem("zt_lang") || "ru",
    token: localStorage.getItem("zt_token") || ""
  };
}

function getSaved() {
  try { return JSON.parse(localStorage.getItem("zt_saved") || "[]"); }
  catch (e) { return []; }
}
function setSaved(list) { localStorage.setItem("zt_saved", JSON.stringify(list)); }

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"))); });
}

function setLang(lang) {
  window.__lang = lang;
  localStorage.setItem("zt_lang", lang);
  document.documentElement.setAttribute("lang", lang);
  applyI18n();
  render();
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setupNav() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      state.page = btn.getAttribute("data-page");
      document.getElementById("page-" + state.page).classList.add("active");
      if (state.page === "setup") refreshSetup();
    });
  });
}

function statusOfNetwork(net) {
  if (!net) return "none";
  if (net.status === "OK") return "ok";
  if (net.status === "ACCESS_DENIED") return "denied";
  if (net.status === "NOT_FOUND") return "bad";
  return "wait";
}

function ipsOf(net) {
  const a = (net && net.assignedAddresses) || [];
  return a.map(x => x.split("/")[0]).filter(x => x.indexOf(".") >= 0).join(", ") || "—";
}

function ownerOf(id) { return id ? id.slice(0, 10) : "—"; }

const MARK = {
  ok: '<path d="M48 42l8 8 16-16" stroke="#34c759" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  off: '<path d="M50 32l20 20M70 32l-20 20" stroke="#48484a" stroke-width="6" fill="none" stroke-linecap="round"/>',
  wait: '<circle cx="48" cy="42" r="3.5" fill="#ffd60a"/><circle cx="60" cy="42" r="3.5" fill="#ffd60a"/><circle cx="72" cy="42" r="3.5" fill="#ffd60a"/>'
};

function combined() {
  const map = new Map();
  getSaved().forEach(s => map.set(s.id, { id: s.id, label: s.label || s.id, saved: true }));
  state.networks.forEach(n => {
    if (map.has(n.id)) map.get(n.id).net = n;
    else map.set(n.id, { id: n.id, label: n.name || n.id, saved: false, net: n });
  });
  return [...map.values()];
}

function renderSelect() {
  const sel = document.getElementById("networkSelect");
  const items = combined();
  let html = `<option value="">${items.length ? t("opt.select") : t("opt.none")}</option>`;
  items.forEach(it => { html += `<option value="${it.id}">${escapeHtml(it.label)} — ${it.id}</option>`; });
  sel.innerHTML = html;
  sel.value = state.selected;
}

function renderHome() {
  const net = state.networks.find(n => n.id === state.selected);
  const st = statusOfNetwork(net);
  let key = "disconnected", mk = MARK.off, color = "#e9eaed";
  if (!state.serviceUp) { key = "service_off"; }
  else if (st === "ok") { key = "connected"; mk = MARK.ok; color = "#ffffff"; }
  else if (st === "wait") { key = "connecting"; mk = MARK.wait; }
  else if (st === "denied") { key = "denied"; }

  document.getElementById("statusTitle").textContent = t("status." + key);
  document.getElementById("statusSub").textContent = t("sub." + key);
  document.getElementById("cloudBody").setAttribute("fill", color);
  document.getElementById("cloudMark").innerHTML = mk;

  const btn = document.getElementById("connectBtn");
  const joined = !!net;
  btn.textContent = joined ? t("btn.disconnect") : t("btn.connect");
  btn.classList.toggle("on", joined);
  btn.disabled = !state.serviceUp;
}

function renderNetworks() {
  const list = document.getElementById("netList");
  const items = combined();
  if (!items.length) { list.innerHTML = `<div class="empty">${t("net.empty")}</div>`; return; }

  list.innerHTML = items.map(it => {
    const net = it.net;
    const st = statusOfNetwork(net);
    const cls = st === "ok" ? "ok" : (st === "wait" ? "wait" : (st === "denied" || st === "bad" ? "bad" : "dim"));
    const stateText = net ? (net.status || "—") : t("net.not_joined");
    const sel = it.id === state.selected;
    return `<div class="net-card ${sel ? "sel" : ""}">
      <div class="net-info">
        <div class="net-name">${escapeHtml(it.label)} ${sel ? `<span class="badge">${t("net.selected")}</span>` : ""}</div>
        <div class="net-meta">${it.id}</div>
        <div class="net-meta">${t("net.owner")}: ${ownerOf(it.id)}</div>
        ${net ? `<div class="net-meta">${t("net.your_ip")}: ${ipsOf(net)}</div>` : ""}
        <div class="net-status ${cls}">${escapeHtml(stateText)}</div>
      </div>
      <div class="net-actions">
        ${sel ? "" : `<button class="mini-btn" data-sel="${it.id}">${t("net.select")}</button>`}
        ${net ? `<button class="mini-btn danger" data-leave="${it.id}">${t("net.leave")}</button>`
              : `<button class="mini-btn primary" data-join="${it.id}">${t("net.join")}</button>`}
        ${it.saved ? `<button class="mini-btn" data-rm="${it.id}">${t("net.remove")}</button>` : ""}
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-sel]").forEach(b => b.addEventListener("click", () => selectNet(b.getAttribute("data-sel"))));
  list.querySelectorAll("[data-join]").forEach(b => b.addEventListener("click", () => join(b.getAttribute("data-join"))));
  list.querySelectorAll("[data-leave]").forEach(b => b.addEventListener("click", () => leave(b.getAttribute("data-leave"))));
  list.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => removeSaved(b.getAttribute("data-rm"))));
}

function isOwner(id) {
  return !!(state.status && id && id.slice(0, 10) === state.status.address);
}

function renderDevices() {
  const owner = document.getElementById("devOwner");
  const bodyEl = document.getElementById("devBody");
  const info = document.getElementById("scanInfo");
  const btn = document.getElementById("scanBtn");
  const id = state.selected;

  owner.innerHTML = id ? `<div class="info-row"><span>${t("dev.owner")}</span><b class="copyable" data-copy="${ownerOf(id)}">${ownerOf(id)}</b></div>` : "";

  const joined = id && state.networks.find(n => n.id === id);
  if (!joined) { btn.textContent = t("dev.scan"); info.textContent = ""; bodyEl.innerHTML = `<div class="empty">${t("dev.no_network")}</div>`; return; }

  if (isOwner(id)) { btn.textContent = t("dev.refresh"); renderOwned(bodyEl, info); }
  else { btn.textContent = t("dev.scan"); renderScan(bodyEl, info); }
}

function renderScan(bodyEl, info) {
  const sc = state.scan;
  if (sc.loading) { info.textContent = t("dev.scanning"); bodyEl.innerHTML = `<div class="empty">${t("dev.scanning")}</div>`; return; }
  if (sc.error) { info.textContent = ""; bodyEl.innerHTML = `<div class="empty">${escapeHtml(sc.error)}</div>`; return; }
  if (!sc.done) { info.textContent = ""; bodyEl.innerHTML = `<div class="empty">${t("dev.scan_hint")}</div>`; return; }

  info.textContent = t("dev.found").replace("{n}", sc.hosts.length);
  if (!sc.hosts.length) { bodyEl.innerHTML = `<div class="empty">${t("dev.empty")}</div>`; return; }

  const rows = sc.hosts.map(ip => {
    const me = ip === sc.yourIp;
    return `<div class="dev-row">
      <div class="dev-cell name"><div><span class="dot on"></span><span class="copyable" data-copy="${ip}">${escapeHtml(ip)}</span> ${me ? `<span class="badge">${t("dev.you")}</span>` : ""}</div></div>
      <div class="dev-cell st on">${t("dev.online")}</div>
    </div>`;
  }).join("");

  bodyEl.innerHTML = `<div class="dev-head">
      <div class="dev-cell name">${t("dev.col_ip")}</div>
      <div class="dev-cell st">${t("dev.col_status")}</div>
    </div>${rows}`;
}

function renderOwned(bodyEl, info) {
  const ow = state.owned;
  info.textContent = t("dev.owner_hint");
  if (ow.loading) { bodyEl.innerHTML = `<div class="empty">${t("dev.scanning")}</div>`; return; }
  if (ow.error) { bodyEl.innerHTML = `<div class="empty">${escapeHtml(ow.error)}</div>`; return; }
  if (!ow.done) { bodyEl.innerHTML = `<div class="empty">${t("dev.owner_hint")}</div>`; return; }
  if (!ow.members.length) { bodyEl.innerHTML = `<div class="empty">${t("dev.empty")}</div>`; return; }

  const rows = ow.members.map(m => {
    const node = m.address || (m.id || "").split("-").pop() || "";
    const ip = ((m.ipAssignments) || []).filter(x => x.indexOf(".") >= 0).join(", ") || "—";
    const auth = !!m.authorized;
    const me = node === state.status.address;
    return `<div class="dev-row">
      <div class="dev-cell name">
        <div><span class="dot ${auth ? "on" : "off"}"></span><span class="copyable" data-copy="${node}">${node}</span> ${me ? `<span class="badge">${t("dev.you")}</span>` : ""}</div>
        <div class="sub"><span class="copyable" data-copy="${ip}">${escapeHtml(ip)}</span> · ${auth ? t("dev.authorized") : t("dev.unauthorized")}</div>
      </div>
      <div class="dev-cell actions">
        ${auth ? `<button class="mini-btn danger" data-cauth="0" data-node="${node}">${t("dev.deauthorize")}</button>`
               : `<button class="mini-btn primary" data-cauth="1" data-node="${node}">${t("dev.authorize")}</button>`}
      </div>
    </div>`;
  }).join("");

  bodyEl.innerHTML = `<div class="dev-head">
      <div class="dev-cell name">${t("dev.col_name")}</div>
      <div class="dev-cell actions"></div>
    </div>${rows}`;

  bodyEl.querySelectorAll("[data-cauth]").forEach(b =>
    b.addEventListener("click", () => controllerAuth(b.getAttribute("data-node"), b.getAttribute("data-cauth") === "1")));
}

function renderProfile() {
  const s = state.status || {};
  const node = document.getElementById("pfNode");
  node.textContent = s.address || "—";
  if (s.address) { node.classList.add("copyable"); node.setAttribute("data-copy", s.address); }
  document.getElementById("pfStatus").textContent = state.serviceUp
    ? (s.online ? t("profile.online") : t("profile.offline"))
    : t("status.service_off");
  document.getElementById("pfVersion").textContent = s.version || "—";
}

function renderSetup() {
  const inst = document.getElementById("suInstalled");
  const run = document.getElementById("suRunning");
  const loc = document.getElementById("suLocal");
  inst.textContent = state.installed ? t("setup.installed") : t("setup.not_installed");
  inst.className = state.installed ? "ok" : "bad";
  run.textContent = state.serviceUp ? t("setup.running") : t("setup.stopped");
  run.className = state.serviceUp ? "ok" : "bad";
  loc.textContent = state.tokenOk ? t("setup.granted") : t("setup.not_granted");
  loc.className = state.tokenOk ? "ok" : "bad";
  document.getElementById("installBtn").style.display = state.installed ? "none" : "inline-block";
  document.getElementById("grantBtn").style.display = state.tokenOk ? "none" : "inline-block";
}

function render() {
  renderSelect();
  renderHome();
  renderNetworks();
  renderDevices();
  renderProfile();
  renderSetup();
}

async function refreshLocal() {
  try { state.status = await invoke("zt_status"); state.serviceUp = true; }
  catch (e) { state.serviceUp = false; state.status = null; state.networks = []; }
  if (state.serviceUp) {
    try { const nets = await invoke("list_networks"); state.networks = Array.isArray(nets) ? nets : []; }
    catch (e) { state.networks = []; }
  }
  render();
}

async function refreshSetup() {
  try { state.installed = await invoke("zt_installed"); } catch (e) { state.installed = false; }
  try { state.tokenOk = await invoke("token_available"); } catch (e) { state.tokenOk = false; }
  renderSetup();
}

async function loadDevices() {
  const id = state.selected;
  if (!id || !state.networks.find(n => n.id === id)) { toast(t("dev.no_network")); return; }
  if (isOwner(id)) {
    state.owned = { members: [], loading: true, error: "", done: false };
    renderDevices();
    try {
      const r = await invoke("controller_members", { nwid: id });
      state.owned = { members: Array.isArray(r) ? r : [], loading: false, error: "", done: true };
    } catch (e) {
      state.owned = { members: [], loading: false, error: String(e || ""), done: true };
    }
    renderDevices();
    return;
  }
  state.scan = { hosts: [], yourIp: "", loading: true, error: "", done: false };
  renderDevices();
  try {
    const r = await invoke("scan_network", { nwid: id });
    state.scan = { hosts: (r && r.hosts) || [], yourIp: (r && r.your_ip) || "", loading: false, error: "", done: true };
  } catch (e) {
    state.scan = { hosts: [], yourIp: "", loading: false, error: String(e || ""), done: true };
  }
  renderDevices();
}

async function controllerAuth(node, authorized) {
  try {
    await invoke("controller_authorize", { nwid: state.selected, member: node, authorized });
    toast(t("msg.done"));
    loadDevices();
  } catch (e) { toast(String(e || "")); }
}

async function createNetwork() {
  const name = document.getElementById("createInput").value.trim();
  const token = cfg().token;
  toast(t("msg.creating"));
  let id = "";
  let viaCentral = false;
  try {
    const net = await invoke("controller_create", { name });
    id = ((net && (net.id || net.nwid)) || "").toLowerCase();
  } catch (e) {
    if (!token) { toast(t("msg.no_controller")); return; }
    try {
      const net = await invoke("central_create_network", { token, name });
      id = ((net && net.id) || "").toLowerCase();
      viaCentral = true;
    } catch (e2) { handleErr(e2); return; }
  }
  if (!/^[0-9a-f]{16}$/.test(id)) { toast(t("msg.no_controller")); return; }
  const list = getSaved().filter(s => s.id !== id);
  list.push({ id, label: name || id });
  setSaved(list);
  document.getElementById("createInput").value = "";
  try { await invoke("join_network", { nwid: id }); } catch (e) {}
  const node = state.status && state.status.address;
  if (node) {
    if (viaCentral) {
      try { await invoke("central_update_member", { token, networkId: id, nodeId: node, body: { config: { authorized: true } } }); } catch (e) {}
    } else {
      try { await invoke("controller_authorize", { nwid: id, member: node, authorized: true }); } catch (e) {}
    }
  }
  selectNet(id, true);
  toast(t("msg.net_created"));
  await refreshLocal();
}

async function copyText(s) {
  if (!s || s === "—") return;
  const tauriClip = window.__TAURI__ && window.__TAURI__.clipboardManager;
  if (tauriClip && tauriClip.writeText) {
    try { await tauriClip.writeText(s); toast(t("msg.copied")); return; }
    catch (e) {}
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(s); toast(t("msg.copied")); return; }
    catch (e) {}
  }
  const ta = document.createElement("textarea");
  ta.value = s;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.left = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  toast(ok ? t("msg.copied") : s);
}

async function doGrant() {
  try {
    await invoke("grant_token_access");
    await refreshSetup();
    await refreshLocal();
    toast(state.tokenOk ? t("msg.granted") : t("msg.grant_fail"));
  } catch (e) { toast(t("msg.grant_fail")); }
}

function handleErr(e) {
  const msg = String(e || "");
  if (msg.includes("authtoken_not_found")) toast(t("msg.token_missing"));
  else toast(msg);
}

async function join(id) {
  try { await invoke("join_network", { nwid: id }); toast(t("msg.joined")); selectNet(id, true); await refreshLocal(); }
  catch (e) { handleErr(e); }
}
async function leave(id) {
  try { await invoke("leave_network", { nwid: id }); toast(t("msg.left")); await refreshLocal(); }
  catch (e) { handleErr(e); }
}

function selectNet(id, silent) {
  state.selected = id;
  localStorage.setItem("zt_selected", id);
  state.scan = { hosts: [], yourIp: "", loading: false, error: "", done: false };
  state.owned = { members: [], loading: false, error: "", done: false };
  if (!silent) render();
}

function addSavedFromInputs() {
  const label = document.getElementById("labelInput").value.trim();
  const id = document.getElementById("idInput").value.trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(id)) { toast(t("msg.bad_id")); return; }
  const list = getSaved().filter(s => s.id !== id);
  list.push({ id, label: label || id });
  setSaved(list);
  document.getElementById("labelInput").value = "";
  document.getElementById("idInput").value = "";
  toast(t("msg.saved_net"));
  selectNet(id, true);
  render();
}

function removeSaved(id) { setSaved(getSaved().filter(s => s.id !== id)); render(); }

async function importNetworks() {
  const c = cfg();
  if (!c.token) { toast(t("dev.no_token")); return; }
  try {
    const r = await invoke("central_networks_list", { token: c.token });
    const arr = Array.isArray(r) ? r : [];
    const list = getSaved();
    let added = 0;
    arr.forEach(n => {
      const id = (n.id || "").toLowerCase();
      if (!/^[0-9a-f]{16}$/.test(id)) return;
      const name = (n.config && n.config.name) || n.id;
      const i = list.findIndex(s => s.id === id);
      if (i >= 0) list[i].label = name;
      else { list.push({ id, label: name }); added++; }
    });
    setSaved(list);
    render();
    toast(t("msg.import_done").replace("{n}", added));
  } catch (e) { toast(String(e || "")); }
}

async function doInstall() {
  try { await invoke("install_zerotier"); toast(t("msg.install_started")); }
  catch (e) { toast(String(e || "")); }
}

async function connectToggle() {
  const sel = state.selected;
  if (!sel) { toast(t("msg.select_first")); return; }
  const joined = state.networks.find(n => n.id === sel);
  const btn = document.getElementById("connectBtn");
  btn.disabled = true;
  document.getElementById("statusTitle").textContent = t(joined ? "status.disconnected" : "status.connecting");
  document.getElementById("statusSub").textContent = t(joined ? "sub.disconnected" : "sub.connecting");
  if (joined) await leave(sel); else await join(sel);
}

function setupEvents() {
  document.getElementById("connectBtn").addEventListener("click", connectToggle);
  document.getElementById("networkSelect").addEventListener("change", e => selectNet(e.target.value));
  document.getElementById("addBtn").addEventListener("click", addSavedFromInputs);
  document.getElementById("createBtn").addEventListener("click", createNetwork);
  document.getElementById("importBtn").addEventListener("click", importNetworks);
  document.getElementById("langSelect").addEventListener("change", e => setLang(e.target.value));
  document.getElementById("installBtn").addEventListener("click", doInstall);
  document.getElementById("grantBtn").addEventListener("click", doGrant);
  document.getElementById("scanBtn").addEventListener("click", loadDevices);
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-copy]");
    if (el) copyText(el.getAttribute("data-copy"));
  });
  document.getElementById("recheckBtn").addEventListener("click", () => { refreshSetup(); refreshLocal(); });
  document.getElementById("saveBtn").addEventListener("click", () => {
    localStorage.setItem("zt_token", document.getElementById("tokenInput").value.trim());
    toast(t("settings.saved"));
  });
}

function loadSettingsUi() {
  const c = cfg();
  document.getElementById("langSelect").value = c.lang;
  document.getElementById("tokenInput").value = c.token;
}

async function boot() {
  window.__lang = cfg().lang;
  setupNav();
  setupEvents();
  loadSettingsUi();
  applyI18n();
  await refreshSetup();
  await refreshLocal();
  setInterval(refreshLocal, 2500);
}

window.addEventListener("DOMContentLoaded", boot);
