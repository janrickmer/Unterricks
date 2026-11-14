// ui.js – kleine DOM-Hilfen, API-Aufrufe, Speicher, Dialoge (samt Tastaturfokus im Dialog). Fremde Daten nur per textContent (nie innerHTML).

/* Element bauen: h("div", {class: "x", onclick: fn, text: "…"}, kind1, kind2) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
/* für el.append(...nn(a, b, …)): leere Teile (null/undefined/false) weglassen – das native append schriebe sonst „null“ */
export const nn = (...kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

/* ---------- Speicher (kann im privaten Modus fehlen) ---------- */
const mem = new Map();
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return mem.has(k) ? mem.get(k) : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } },
  del(k) { try { localStorage.removeItem(k); } catch { mem.delete(k); } },
};
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export function deviceId() {
  let d = store.get("u.dev");
  if (!d || !/^[A-Za-z0-9_-]{22,64}$/.test(d)) { d = b64u(rand(32)); store.set("u.dev", d); }
  return d;
}

/* ---------- API ---------- */
/* Server-Adresse: leer = gleiche Herkunft (Seite läuft auf dem Worker). Auf GitHub Pages trägt der Build die Worker-Adresse als
 * <meta name="unterricks-api" content="https://…"> ein; Pfade des Servers („/api/…“, auch signierte Links aus Antworten) gehen dann dorthin. */
const apiMeta = typeof document !== "undefined" ? document.querySelector('meta[name="unterricks-api"]') : null;
export const API = apiMeta && /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1):\d+)$/i.test(apiMeta.getAttribute("content") || "") ? apiMeta.getAttribute("content") : "";
export const apiUrl = (u) => (typeof u === "string" && u.startsWith("/api/") ? API + u : u);
export const wsUrl = (path) => (API || location.origin).replace(/^http/, "ws") + path;
export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; this.code = (data && data.code) || ""; }
}
export async function api(method, path, o = {}) {
  const headers = { ...(o.headers || {}) };
  if (o.token) headers.Authorization = "Bearer " + o.token;
  let body;
  if (o.raw !== undefined) body = o.raw;
  else if (o.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(o.body); }
  let res;
  try { res = await fetch(apiUrl(path), { method, headers, body, cache: "no-store", credentials: "omit", signal: o.signal }); }
  catch (e) { if (e && e.name === "AbortError") throw e; throw new ApiError("Keine Verbindung zum Server. Bitte Internetverbindung prüfen.", 0); }
  if (o.stream && res.ok && (res.headers.get("content-type") || "").includes("text/event-stream")) return res;
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok || !data || data.ok !== true) {
    const msg = (data && data.error) || (res.status === 413 ? "Die Datei ist zu groß." : "Fehler " + res.status);
    throw new ApiError(msg, res.status, data);
  }
  return data;
}
/* Datei-Upload mit Fortschritt (XMLHttpRequest, weil fetch keinen Upload-Fortschritt meldet) */
export function upload(path, file, token, onProgress, contentType) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", apiUrl(path));
    if (token) x.setRequestHeader("Authorization", "Bearer " + token);
    x.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let d = null; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300 && d && d.ok) resolve(d);
      else reject(new ApiError((d && d.error) || "Hochladen fehlgeschlagen (" + x.status + ").", x.status, d));
    };
    x.onerror = () => reject(new ApiError("Keine Verbindung zum Server.", 0));
    x.send(file);
  });
}

/* ---------- Rückmeldungen ---------- */
export function toast(msg, type = "", ms = 4200) {
  const box = document.getElementById("toasts"), last = box.lastElementChild;
  // gleiche Meldung nicht stapeln, sondern nur länger zeigen
  if (last && last.textContent === msg) { clearTimeout(last._t); last._t = setTimeout(() => last.remove(), ms); return; }
  const t = h("div", { class: "toast " + type, text: msg });
  box.append(t);
  t._t = setTimeout(() => t.remove(), ms);
}
export function errToast(e) { toast(e && e.message ? e.message : String(e), "err", 7000); }

/* Knopf während einer Aktion sperren und Drehsymbol zeigen */
export async function busy(btn, fn, label) {
  if (!btn || btn.disabled) return;
  const old = Array.from(btn.childNodes);
  btn.disabled = true; btn.setAttribute("aria-busy", "true");
  clear(btn).append(h("span", { class: "spin", "aria-hidden": "true" }), label || "Bitte warten …");
  try { return await fn(); }
  finally { btn.disabled = false; btn.removeAttribute("aria-busy"); clear(btn).append(...old); }
}

/* ---------- Dialogebenen (Nachtrag 25): Der Tastaturfokus bleibt im obersten offenen Dialog ----------
 * openLayer(el, { onEscape, opener, beforeTab }) meldet einen Dialog bzw. eine Ebene über der Seite an: modal(), die Codefolie „Für den Beamer
 * zeigen“, den Präsentationsmodus, „Buchstabe freigeschaltet“ im Escape-Room und das Vollbild von Folienfenster und Live-Fenster. Nur die oberste
 * Ebene behandelt Tab und Esc: Tab und Umschalt+Tab bleiben in ihr (vom letzten erreichbaren Element zum ersten und umgekehrt; liegt der Fokus auf
 * body, außerhalb oder auf einem gerade gesperrten bzw. entfernten Element, geht Tab zum ersten, Umschalt+Tab zum letzten), Esc ruft onEscape
 * (ohne onEscape bleibt Esc bei der Ebene bzw. beim Browser – Vollbild). Ausgeblendete, gesperrte, inerte Elemente und tabindex="-1" zählen nicht;
 * eine Gruppe von Optionsfeldern ist ein Halt (wie im Browser). Eigene Tastenhandler laufen vorher (die Ebenen hören am Fenster): wer
 * preventDefault() aufruft, behält die Taste (z. B. „Beamer verbinden“ und „Timer“ im Präsentationsmodus).
 * Solange eine Ebene offen ist, sind die übrigen Kinder von <body> inert – Tastatur, Maus und der Lesecursor von VoiceOver bleiben in der Ebene.
 * Ausgenommen sind die Meldungen (#toasts, Live-Region) und das Element im Vollbild. release() hebt das sofort auf, restore() gibt den Fokus
 * zurück: an den Auslöser (falls noch da und fokussierbar), sonst an die Ebene darunter – nie, wenn der Fokus schon woanders steht. Wird eine Ebene
 * ohne release() entfernt (Seitenwechsel, Test), räumt ein MutationObserver sie ab; nichts bleibt inert. */
const NATIVE = "a[href], area[href], button, input, select, textarea, iframe, summary, audio[controls], video[controls]", STOPS = NATIVE + ", [contenteditable], [tabindex]";
const layers = [], inerted = new Set();
let layerMo = null, layerKeys = false, layerSeq = 0;
const fsNow = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function shown(el) {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
  if (el.getClientRects && !el.getClientRects().length) return false;
  const cs = typeof window !== "undefined" && window.getComputedStyle ? window.getComputedStyle(el) : null;
  return !cs || cs.visibility !== "hidden";
}
/* fokussierbar (auch tabindex="-1"): verbunden, sichtbar, nicht gesperrt, nicht inert */
const canFocus = (el) => !!el && el.nodeType === 1 && el.isConnected && !el.matches(":disabled") && !el.closest("[inert]") && shown(el);
function isStop(el) {
  const ti = el.getAttribute("tabindex");
  if (ti !== null && /^\s*-\d/.test(ti)) return false;
  if (el.tagName === "INPUT" && el.type === "hidden") return false;
  if (el.tagName === "SUMMARY" && ti === null) { const d = el.parentElement; if (!d || d.tagName !== "DETAILS" || [...d.children].find((c) => c.tagName === "SUMMARY") !== el) return false; }
  if (el.getAttribute("contenteditable") === "false" && ti === null && !el.matches(NATIVE)) return false;
  return canFocus(el);
}
/* per Tab erreichbare Elemente in root (Reihenfolge des Dokuments) */
export const tabbables = (root) => [...root.querySelectorAll(STOPS)].filter(isStop);
function stopsOf(root) {   // Halte; Optionsfelder gleichen Namens bilden einen Halt
  const out = [], groups = new Map();
  for (const el of tabbables(root)) {
    const k = el.tagName === "INPUT" && el.type === "radio" && el.name ? el.name : null;
    if (k === null) { out.push([el]); continue; }
    if (!groups.has(k)) { groups.set(k, []); out.push(groups.get(k)); }
    groups.get(k).push(el);
  }
  return out;
}
/* Tab bzw. Umschalt+Tab (Ereignis e) in root halten → true, wenn der Fokus versetzt wurde (dann mit preventDefault) */
export function keepTab(e, root) {
  const list = stopsOf(root), back = !!e.shiftKey, a = document.activeElement;
  const to = (s) => {
    e.preventDefault();
    const t = s && (s.find((x) => x.checked) || (back ? s[s.length - 1] : s[0]));
    if (t) { try { t.focus(); } catch {} }
    return true;
  };
  if (!list.length) return to(null);
  if (!a || a === document.body || a === root || !root.contains(a)) return to(back ? list[list.length - 1] : list[0]);
  const i = list.findIndex((s) => s.includes(a));
  if (i < 0) {   // fokussiert, aber kein Halt (tabindex="-1", Scrollbereich): vom Platz im Dokument aus weiter (4 = folgt, 2 = davor)
    if (!back) return to(list.find((s) => a.compareDocumentPosition(s[0]) & 4) || list[0]);
    return to([...list].reverse().find((s) => a.compareDocumentPosition(s[s.length - 1]) & 2) || list[list.length - 1]);
  }
  if (back && i === 0) return to(list[list.length - 1]);
  if (!back && i === list.length - 1) return to(list[0]);
  return false;   // dazwischen: der Browser geht weiter (auch durch Optionsfelder und Scrollbereiche)
}
function syncLayers() {
  const top = layers[layers.length - 1], fs = fsNow(), want = new Set();
  if (top) for (const c of document.body.children) if (!c.contains(top.el) && c.id !== "toasts" && !(fs && c.contains(fs))) want.add(c);
  for (const el of [...inerted]) if (!want.has(el)) { el.removeAttribute("inert"); inerted.delete(el); }
  for (const el of want) if (!inerted.has(el) && !el.hasAttribute("inert")) { el.setAttribute("inert", ""); inerted.add(el); }
  if (top && !layerMo && typeof MutationObserver === "function") { layerMo = new MutationObserver(() => pruneLayers(true)); layerMo.observe(document.body, { childList: true, subtree: true }); }
  else if (!top && layerMo) { layerMo.disconnect(); layerMo = null; }
}
function pruneLayers(refocus) {
  let gone = false;
  for (let i = layers.length - 1; i >= 0; i--) if (!layers[i].el.isConnected) { layers.splice(i, 1); gone = true; }
  if (!gone) return;
  syncLayers();
  const L = layers[layers.length - 1], a = document.activeElement;
  if (refocus && L && (!a || a === document.body)) focusIn(L);
}
function focusIn(L, extra = []) {
  for (const x of [...extra, L.last, tabbables(L.el)[0], L.el]) if (x && L.el.contains(x) && canFocus(x)) { try { x.focus(); } catch {} if (document.activeElement === x) return true; }
  return false;
}
function restoreFocus(L) {
  const a = document.activeElement;
  if (a && a !== document.body && a.isConnected && !L.el.contains(a)) return;   // steht schon woanders (von der Seite oder der Nutzerin gesetzt)
  const below = layers[layers.length - 1], o = L.opener;
  if (below && below.seq > L.seq) return;   // ein neuerer Dialog (z. B. aus onClose geöffnet) setzt seinen Fokus selbst
  if (below) { focusIn(below, [o]); return; }
  // Seite: der Auslöser – wurde er inzwischen neu gezeichnet, der neue mit derselben id
  for (const x of [o, o && !o.isConnected && o.id ? document.getElementById(o.id) : null]) if (canFocus(x)) { try { x.focus(); } catch {} if (document.activeElement === x) return; }
}
function onLayerKey(e) {
  if (e.defaultPrevented || e.isComposing || (e.key !== "Tab" && e.key !== "Escape") || e.altKey || e.ctrlKey || e.metaKey) return;
  pruneLayers(false);
  const L = layers[layers.length - 1];
  if (!L) return;
  if (e.key === "Escape") { if (L.onEscape) { e.preventDefault(); L.onEscape(e); } return; }
  if (L.beforeTab) L.beforeTab();
  keepTab(e, L.el);
}
const onLayerFocus = (e) => { for (const L of layers) if (L.el.contains(e.target)) L.last = e.target; };
export function openLayer(el, { onEscape = null, opener, beforeTab = null } = {}) {
  if (!layerKeys) { layerKeys = true; window.addEventListener("keydown", onLayerKey); document.addEventListener("focusin", onLayerFocus); }
  pruneLayers(false);
  const o = opener === undefined ? document.activeElement : opener;
  const L = { el, onEscape, beforeTab, opener: o && o !== document.body && !el.contains(o) ? o : null, last: null, seq: ++layerSeq };
  layers.push(L); syncLayers();
  return {
    el,
    get top() { return layers[layers.length - 1] === L; },
    get open() { return layers.includes(L); },
    release(focus = true) { const i = layers.indexOf(L); if (i >= 0) { layers.splice(i, 1); syncLayers(); } if (focus) restoreFocus(L); },
    restore: () => restoreFocus(L),
  };
}
/* Dialoge im Vollbild (z. B. im Präsentationsmodus) gehören in das Element im Vollbild – sonst wären sie dort nicht zu sehen */
function dialogHost() { const f = fsNow(); return f && f.nodeType === 1 && !/^(img|video|iframe|canvas|svg)$/i.test(f.tagName) ? f : document.body; }

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const prev = document.activeElement;
  const back = h("div", { class: "modal-back", role: "presentation" });
  const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title });
  let closed = false, layer = null;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove(); if (layer) layer.release(false);
    try { if (onClose) onClose(); } finally { if (layer) layer.restore(); }
  };
  const content = h("div", { class: "body" });
  if (typeof body === "function") body(content, close); else if (body) content.append(body);
  const foot = h("footer", null, actions.map((a) => h("button", { class: "btn " + (a.class || ""), type: "button", onclick: async (e) => {
    if (a.onClick) { const r = await a.onClick(e, close); if (r === false) return; } close();
  } }, a.label)));
  box.append(h("header", null, h("h2", { text: title }), h("button", { class: "btn ghost small iconbtn", type: "button", "aria-label": "Schließen", onclick: close }, icon("x"))), content);
  if (actions.length) box.append(foot);
  back.append(box);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  if (closed) return { close, el: content };
  dialogHost().append(back);
  // langer Text ohne Knöpfe darin: der Inhalt wird selbst ein Halt, damit er sich per Tastatur rollen lässt (auch in Safari)
  const scrollStop = () => {
    const can = content.scrollHeight > content.clientHeight + 1 && !tabbables(content).length;
    if (can && !content.hasAttribute("tabindex")) content.setAttribute("tabindex", "0");
    else if (!can && content.getAttribute("tabindex") === "0") content.removeAttribute("tabindex");
  };
  layer = openLayer(back, { onEscape: close, opener: prev, beforeTab: scrollStop });
  // erster Halt: Eingabefeld bzw. Hauptknopf, sonst der erste Knopf unten („Abbrechen“ – z. B. bei Rückfragen mit einem roten Knopf), sonst „Schließen“;
  // nur, wenn dieser Dialog noch oben liegt und in ihm noch nichts fokussiert ist (schnelles Tippen wird nie umgelenkt)
  setTimeout(() => {
    if (closed || !layer.top || box.contains(document.activeElement)) return;
    const st = tabbables(box), f = st.find((x) => x.matches("input, textarea, select, button.primary")) || st.find((x) => foot.contains(x)) || st[0];
    if (f) f.focus();
  }, 30);
  return { close, el: content };
}
export function confirmDialog(title, text, okLabel = "OK", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    modal({ title, body: h("p", { text }), onClose: () => { if (!done) resolve(false); },
      actions: [{ label: "Abbrechen", onClick: () => { done = true; resolve(false); } }, { label: okLabel, class: danger ? "danger" : "primary", onClick: () => { done = true; resolve(true); } }] });
  });
}

/* ---------- Zwischenablage ---------- */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = h("textarea", { style: { position: "fixed", top: "-1000px", opacity: "0" } }); ta.value = text;
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); return ok;
  }
}

/* ---------- Formatierung ---------- */
export const fmtBytes = (n) => (n < 1024 ? n + " B" : n < 1024 ** 2 ? (n / 1024).toFixed(0) + " KB" : (n / 1024 ** 2).toFixed(1).replace(".", ",") + " MB");
export const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = String(s).split("-"); return d + "." + m + "." + y; };
export const fmtTime = (ms) => new Date(ms).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtClock = (ms) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
export function fileIcon(name, mime, kind) {
  if (kind === "text") return h("div", { class: "ficon txt", "aria-hidden": "true", text: "TEXT" });
  if (kind === "link") return h("div", { class: "ficon lnk", "aria-hidden": "true", text: "LINK" });
  const ext = ((/\.([a-z0-9]+)$/i.exec(name || "") || [])[1] || "").toLowerCase();
  const m = String(mime || "");
  let cls = "", label = (ext || "DATEI").slice(0, 4).toUpperCase();
  if (m === "application/pdf" || ext === "pdf") cls = "pdf";
  else if (/word|opendocument\.text|rtf/.test(m) || /^(docx?|odt|rtf|pages)$/.test(ext)) cls = "doc";
  else if (/presentation|powerpoint|keynote/.test(m) || /^(pptx?|odp|key)$/.test(ext)) cls = "ppt";
  else if (/sheet|excel|csv/.test(m) || /^(xlsx?|ods|csv|numbers)$/.test(ext)) cls = "xls";
  else if (/^image\//.test(m)) cls = "img";
  return h("div", { class: "ficon " + cls, "aria-hidden": "true", text: label });
}

/* Datei aus signiertem Link herunterladen (funktioniert auch auf dem iPad: „In GoodNotes öffnen“ über Teilen) */
export function downloadUrl(url, name) {
  const a = h("a", { href: apiUrl(url), download: name || "", rel: "noopener" });
  document.body.append(a); a.click(); a.remove();
}
export function downloadBlob(blob, name, keepMs = 60000) {   // keepMs: große Dateien (Sicherung) länger bereithalten
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), keepMs);
}

/* ---------- Symbole: eigene SVG-Strichzeichnungen (24er-Raster, Strich 2) statt Sonderzeichen ---------- */
const ICONS = {
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  x: "M6 6l12 12M18 6L6 18",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  play: "M8 5v14l11-7z",
  pause: "M9 5v14M15 5v14",
  check: "M5 12.5l4.5 4.5L19 7",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  alert: "M12 3.8 2.8 19.6h18.4L12 3.8zM12 9.6v4.6M12 17.2h.01",
  plus: "M12 5v14M5 12h14",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  printer: "M7 9V3.5h10V9M7 17.5H5a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-2M7 14h10v7H7z",
  timer: "M12 21.5a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9.5v4l2.5 1.5M10 2.5h4M12 2.5v3",
  headphones: "M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z",
  upload: "M12 15V4M7 9l5-5 5 5M5 20h14",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
};
const SVGNS = "http://www.w3.org/2000/svg";
export function icon(name) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "ico"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", ICONS[name] || "");
  if (name === "play") p.setAttribute("fill", "currentColor");
  svg.append(p);
  return svg;
}

/* Fach der aktuellen Seite: färbt Kopfband, Akzente und Fokus (Politik und Wirtschaft, Ev. Religion, Ethik) */
export function setFach(subject) {
  const root = document.documentElement;
  if (subject === "powi" || subject === "evrel" || subject === "ethik" || subject === "gs") root.dataset.fach = subject; else delete root.dataset.fach;
}

/* Zustandszeile (z. B. „Gespeichert 10:42“): Symbol statt Sonderzeichen; kind = "ok" | "err" | "" (neutral) */
export function stateLine(el, text, kind = "") {
  clear(el);
  if (kind) { el.dataset.state = kind; el.append(icon(kind === "ok" ? "check" : "alert")); } else delete el.dataset.state;
  el.append(String(text == null ? "" : text));
  return el;
}

/* Kopfband einer Seite: Brotkrumen ([href, Text] bzw. Text), Titel (Text oder fertiges h1), Unterzeile, Chips ({text, strong}), Inhalt rechts.
 * Die Folien (.foils) liegen hinter dem Inhalt: auf Fachseiten eine Folie in der Fachfarbe, sonst die drei Fachfolien übereinander.
 * „Folie auflegen“ läuft nur beim ersten Kopfband nach dem Laden (danach data-laid an <html>). */
export function pageHead({ crumbs, title, sub, chips, aside, fach } = {}) {
  if (fach !== undefined) setFach(fach);
  const root = document.documentElement;
  if (!root.hasAttribute("data-laid") && !pageHead.timer) pageHead.timer = setTimeout(() => root.setAttribute("data-laid", ""), 900);
  const trail = [], n = (crumbs || []).length;
  (crumbs || []).forEach((c, i) => {
    const cur = i === n - 1 && !Array.isArray(c);   // letzte Krume = aktuelle Seite (wiederholt den Titel; am Handy ausgeblendet)
    if (i) trail.push(h("span", { class: "sep" + (cur ? " cur-sep" : ""), "aria-hidden": "true", text: "›" }));
    trail.push(Array.isArray(c) ? h("a", { href: c[0] }, c[1]) : h("span", { class: cur ? "cur" : null, "aria-current": cur ? "page" : null, text: c }));
  });
  const head = title instanceof Node ? title : h("h1", { text: title || "" });
  return h("header", { class: "pagehead" },
    h("div", { class: "foils", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
    trail.length ? h("nav", { class: "crumbs", "aria-label": "Brotkrumen" }, trail) : null,
    aside ? h("div", { class: "row between" }, head, aside) : head,
    sub ? (sub instanceof Node ? sub : h("p", { class: "pagesub", text: sub })) : null,
    chips && chips.length ? h("div", { class: "chips" }, chips.filter(Boolean).map((c) => h("span", { class: "chip" + (c.strong ? " strong" : ""), text: c.text || c }))) : null);
}

/* Seitenrahmen */
export function topbar(links, right) {
  return h("header", { class: "topbar" }, h("div", { class: "inner" },
    h("a", { class: "brand", href: links && links.home ? links.home : "#/" }, h("img", { src: "/icon.svg", alt: "" }), "Unterricks"),
    right ? h("nav", { "aria-label": "Navigation" }, right) : null));
}
