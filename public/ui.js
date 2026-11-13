// ui.js – kleine DOM-Hilfen, API-Aufrufe, Speicher, Dialoge. Fremde Daten nur per textContent (nie innerHTML).

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

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = h("div", { class: "modal-back", role: "presentation" });
  const box = h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title });
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); if (onClose) onClose(); prev && prev.focus && prev.focus(); };
  const prev = document.activeElement;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const content = h("div", { class: "body" });
  if (typeof body === "function") body(content, close); else if (body) content.append(body);
  const foot = h("footer", null, actions.map((a) => h("button", { class: "btn " + (a.class || ""), type: "button", onclick: async (e) => {
    if (a.onClick) { const r = await a.onClick(e, close); if (r === false) return; } close();
  } }, a.label)));
  box.append(h("header", null, h("h2", { text: title }), h("button", { class: "btn ghost small iconbtn", type: "button", "aria-label": "Schließen", onclick: close }, icon("x"))), content);
  if (actions.length) box.append(foot);
  back.append(box);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  // ohne Eingabefeld und ohne Hauptknopf (z. B. Rückfragen mit einem roten Knopf): der erste Knopf unten („Abbrechen“) – sonst bliebe der Fokus
  // hinter dem Dialog, und Enter auf dem Auslöser öffnete ihn ein zweites Mal
  const f = box.querySelector("input, textarea, select, button.primary") || foot.querySelector("button");
  // nur fokussieren, wenn im Dialog noch nichts fokussiert ist (sonst würde schnelles Tippen ins falsche Feld umgelenkt)
  if (f) setTimeout(() => { if (!box.contains(document.activeElement)) f.focus(); }, 30);
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
