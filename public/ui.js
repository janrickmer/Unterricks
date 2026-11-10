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
  try { res = await fetch(path, { method, headers, body, cache: "no-store", credentials: "omit", signal: o.signal }); }
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
    x.open("POST", path);
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
  box.append(h("header", null, h("h2", { text: title }), h("button", { class: "btn ghost small", type: "button", "aria-label": "Schließen", onclick: close }, "✕")), content);
  if (actions.length) box.append(foot);
  back.append(box);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  const f = box.querySelector("input, textarea, select, button.primary");
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
  const a = h("a", { href: url, download: name || "", rel: "noopener" });
  document.body.append(a); a.click(); a.remove();
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* Seitenrahmen */
export function topbar(links, right) {
  return h("header", { class: "topbar" }, h("div", { class: "inner" },
    h("a", { class: "brand", href: links && links.home ? links.home : "#/" }, h("img", { src: "/icon.svg", alt: "" }), "Unterricks"),
    right ? h("nav", { "aria-label": "Navigation" }, right) : null));
}
