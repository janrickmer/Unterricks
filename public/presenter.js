// presenter.js – Präsentation (PDF) in Folienbilder umwandeln und im Vollbild live für alle zeigen.
import { h, clear, api, apiUrl, wsUrl, toast, errToast, icon } from "./ui.js";
import { PUBLIC_URL, isValidCode, formatCode, slideCodeBoxes, slideSessionCode } from "./shared.js";

let pdfjsP = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = import("/vendor/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; return m; });
  return pdfjsP;
}

/* Breite eines Zeichens in der passenden allgemeinen Schrift (Festbreite, Serife, sonst serifenlos) – für die Lage des Codes im Satz */
let measCtx = null; const measured = new Map();
const genericFont = (fam) => (/mono|courier/i.test(fam) ? '"Courier New", Courier, monospace' : /serif/i.test(fam) && !/sans/i.test(fam) ? '"Times New Roman", Times, serif' : "Arial, Helvetica, sans-serif");
function advance(ch, fam) {
  const f = genericFont(fam), k = f + "|" + ch;
  if (!measured.has(k)) { measCtx ||= document.createElement("canvas").getContext("2d"); measCtx.font = "bold 100px " + f; measured.set(k, measCtx.measureText(ch).width); }
  return measured.get(k);
}
/* Codes auf einer Seite: Textstücke von PDF.js in Gerätekoordinaten (gedrehter Text zählt nicht) → slideCodeBoxes */
async function codeBoxes(lib, page, vp) {
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items || []) {
    if (typeof it.str !== "string") continue;   // Markierungen ohne Text
    const tx = lib.Util.transform(vp.transform, it.transform), hgt = Math.hypot(tx[2], tx[3]);
    const turned = Math.abs(tx[1]) > hgt * 0.02 || Math.abs(tx[2]) > hgt * 0.02;
    items.push(turned ? { str: "", eol: true } : { str: it.str, x: tx[4], base: tx[5], w: it.width * vp.scale, h: hgt, eol: !!it.hasEOL, family: ((tc.styles || {})[it.fontName] || {}).fontFamily || "" });
  }
  return slideCodeBoxes(items, advance);
}
/* alten Code übermalen und den neuen hineinschreiben: Hintergrund = häufigste Farbe am Rand des Kastens, Schrift = die davon am weitesten
   entfernte Farbe im Kasten; fett, wenn der alte Code viel Farbe hatte; gleiche Größe, notfalls schmaler (gleiche Breite). */
function paintCode(ctx, b, text) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const x = Math.max(0, Math.floor(b.x0 - b.h * 0.12)), y = Math.max(0, Math.floor(b.base - b.h * 0.95));
  const w = Math.min(W, Math.ceil(b.x1 + b.h * 0.12)) - x, hh = Math.min(H, Math.ceil(b.base + b.h * 0.3)) - y;
  if (w < 3 || hh < 3) return false;
  const d = ctx.getImageData(x, y, w, hh).data, px = (i) => [d[i], d[i + 1], d[i + 2]];
  const buckets = new Map();
  const add = (cx, cy) => { const c = px((cy * w + cx) * 4), k = (c[0] >> 4) * 256 + (c[1] >> 4) * 16 + (c[2] >> 4), e = buckets.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += c[0]; e[2] += c[1]; e[3] += c[2]; buckets.set(k, e); };
  for (let cx = 0; cx < w; cx++) { add(cx, 0); add(cx, hh - 1); }
  for (let cy = 1; cy < hh - 1; cy++) { add(0, cy); add(w - 1, cy); }
  let top = null; for (const e of buckets.values()) if (!top || e[0] > top[0]) top = e;
  const bg = [top[1] / top[0], top[2] / top[0], top[3] / top[0]];
  const dist = (c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
  let fg = [0, 0, 0], far = 0;
  for (let i = 0; i < d.length; i += 4) { const c = px(i), q = dist(c); if (q > far) { far = q; fg = c; } }
  if (far < 40) return false;   // kein erkennbarer Text an dieser Stelle (z. B. Code nur in der Textebene)
  let ink = 0; for (let i = 0; i < d.length; i += 4) if (dist(px(i)) > far * 0.5) ink++;
  const weight = ink / (d.length / 4) > 0.2 ? "bold" : "normal";
  const fam = genericFont(b.family);
  ctx.save();
  ctx.fillStyle = "rgb(" + bg.map(Math.round).join(",") + ")"; ctx.fillRect(x, y, w, hh);
  const bw = b.x1 - b.x0;
  let size = b.h; ctx.font = weight + " " + size + "px " + fam;
  let tw = ctx.measureText(text).width;
  if (tw > bw * 1.04) { size = (size * bw) / tw; ctx.font = weight + " " + size + "px " + fam; tw = ctx.measureText(text).width; }
  ctx.fillStyle = "rgb(" + fg.join(",") + ")"; ctx.textBaseline = "alphabetic";
  ctx.fillText(text, b.x0 + (bw - tw) / 2, b.base);
  ctx.restore();
  return true;
}

/* PDF im Browser rendern (PDF.js) und jede Seite als JPEG hochladen. onProgress(i, n).
   opt.code = Code der Sitzung: steht auf Folie 1 ein anderer (Präsentation aus einer früheren Sitzung), wird er auf allen Folien ersetzt.
   Ergebnis swapped = {from, to, slides} oder null. Die hochgeladene PDF selbst bleibt unverändert. */
export async function rasterizeAndUpload(file, fileId, token, onProgress, opt = {}) {
  const want = isValidCode(opt.code) ? opt.code : "";
  let oldCode = "";
  const swappedOn = [];
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: false }).promise;
  const n = doc.numPages;
  if (n > 300) throw new Error("Die Präsentation hat mehr als 300 Folien.");
  const thumbs = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(1920 / v1.width, 1920 / v1.height, 4);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (want) {
      try {
        const boxes = await codeBoxes(lib, page, vp);
        if (i === 1) oldCode = slideSessionCode(boxes);
        if (oldCode && oldCode !== want) { let k = 0; for (const b of boxes) if (b.code === oldCode && paintCode(ctx, b, formatCode(want))) k++; if (k) swappedOn.push(i); }
      } catch {}   // ohne lesbare Textebene: Folie bleibt, wie sie ist
    }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(apiUrl("/api/teacher/files/" + fileId + "/slides/" + i + "?w=" + canvas.width + "&h=" + canvas.height), { method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "image/jpeg" }, body: blob });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || "Folie " + i + " konnte nicht gespeichert werden.");
        break;
      } catch (e) { if (attempt >= 2) throw e; await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
    }
    if (i <= 40) { const t = document.createElement("canvas"); const k = 120 / canvas.height; t.width = Math.round(canvas.width * k); t.height = 120; t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height); thumbs.push(t.toDataURL("image/jpeg", 0.7)); }
    page.cleanup();
    if (onProgress) onProgress(i, n);
  }
  await doc.destroy();
  const ready = await api("POST", "/api/teacher/files/" + fileId + "/ready", { token, body: { pages: n } });
  return { pages: n, thumbs, file: ready.file, swapped: swappedOn.length ? { from: oldCode, to: want, slides: swappedOn } : null };
}

/* ---------- Live-Verbindung der Lehrkraft ---------- */
export class TeacherLive {
  constructor(lessonId, token, onState) { this.lessonId = lessonId; this.token = token; this.onState = onState; this.ws = null; this.closed = false; this.fails = 0; this.want = null; this.queue = []; }
  async connect() {
    if (this.closed) return;
    try {
      const t = await api("POST", "/api/teacher/lessons/" + this.lessonId + "/live-ticket", { token: this.token });
      const ws = new WebSocket(wsUrl(t.url));
      this.ws = ws;
      ws.onopen = () => {
        this.fails = 0;
        if (this.want) ws.send(JSON.stringify(this.want));   // nach Wiederverbindung den Stand der Lehrkraft erneut setzen
        else ws.send(JSON.stringify({ t: "hello" }));
        for (const m of this.queue.splice(0)) ws.send(m);
        clearInterval(this.pingT); this.pingT = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000);
      };
      ws.onmessage = (ev) => { if (ev.data === "pong") return; try { this.onState(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { clearInterval(this.pingT); if (this.closed) return; this.fails++; this.onState({ t: "conn", ok: false }); this.reT = setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** Math.min(this.fails, 4))); };
    } catch (e) { this.fails++; this.reT = setTimeout(() => this.connect(), 3000); }
  }
  send(m) {
    if (m.t === "start") this.want = { ...m };
    else if (m.t === "goto" && this.want) this.want.slide = m.slide;
    else if (m.t === "stop") this.want = null;
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s);
  }
  close() { this.closed = true; clearTimeout(this.reT); clearInterval(this.pingT); try { this.ws && this.ws.close(); } catch {} }
}

/* ---------- Präsentationsmodus (Vollbild) ---------- */
export async function fetchSlides(fileId, token) {
  return api("GET", "/api/teacher/files/" + fileId + "/slides", { token });
}
// slides vorab laden (fetchSlides), damit das Vollbild ohne Wartezeit direkt aus dem Klick angefordert werden kann
export async function startPresenter({ lessonId, file, token, startSlide = 1, onEnd, slides, onMark, shownUntil = null }) {
  const s = slides || (await fetchSlides(file.id, token));
  const urls = (s.urls || []).map(apiUrl), n = s.pages, pages = n;
  let cur = Math.min(Math.max(1, startSlide), n), students = 0, connOk = true;
  const img = h("img", { alt: "", draggable: "false" });
  const counter = h("span", { class: "counter" });
  const info = h("span", { class: "small" });
  const fsBtn = h("button", { class: "btn small", type: "button", onclick: () => toggleFs() }, "Vollbild");
  // „Bis hier gezeigt“: aktuelle Folie als letzte im Unterricht gezeigte Folie markieren (Schüler:innen bekommen nach der Freigabe nur bis hier)
  let marked = shownUntil, marking = false;
  const markState = h("span", { class: "small markstate", "aria-live": "polite" });
  const markBtn = onMark ? h("button", { class: "btn small", type: "button", onclick: async () => {
    if (marking) return; marking = true; markBtn.disabled = true;
    const n = cur;
    try {
      await onMark(n, (m) => { markState.textContent = m; });
      marked = n >= pages ? null : n;
      markState.textContent = marked ? "Bis Folie " + n + " markiert" : "Letzte Folie: alle Folien freigegeben";
    } catch (e) { markState.textContent = "Nicht markiert: " + (e && e.message ? e.message : e); }
    marking = false; markBtn.disabled = false; paintMark();
  } }, "Bis hier gezeigt") : null;
  function paintMark() { if (markBtn) markBtn.setAttribute("aria-label", "Folie " + cur + " als letzte im Unterricht gezeigte Folie markieren" + (marked ? " (bisher: Folie " + marked + ")" : "")); }
  const root = h("div", { class: "presenter", role: "dialog", "aria-label": "Präsentation läuft" },
    h("div", { class: "stage" }, img),
    h("div", { class: "bar" },
      h("button", { class: "btn small", type: "button", onclick: () => goto(cur - 1), "aria-label": "Vorherige Folie" }, icon("left")),
      counter,
      h("button", { class: "btn small", type: "button", onclick: () => goto(cur + 1), "aria-label": "Nächste Folie" }, icon("right")),
      h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE für alle"), info,
      h("span", { class: "grow" }), markBtn, markState,
      fsBtn,
      h("button", { class: "btn small onair", type: "button", onclick: () => end(true) }, "Präsentation für alle beenden"),
      h("button", { class: "btn small", type: "button", onclick: () => end(false), title: "Fenster schließen, Live-Anzeige läuft weiter" }, "Schließen")));
  const cache = new Map();
  const preload = (k) => { if (k >= 1 && k <= n && !cache.has(k)) { const im = new Image(); im.src = urls[k - 1]; cache.set(k, im); } };
  const live = new TeacherLive(lessonId, token, (m) => {
    if (m.t === "count") students = m.students;
    else if (m.t === "state") { if (typeof m.students === "number") students = m.students; connOk = true; }
    else if (m.t === "conn") connOk = m.ok;
    paintInfo();
  });
  function paintInfo() { clear(info).append(...(connOk ? [] : [icon("alert"), "Verbindung wird wiederhergestellt … · "]), students + " Schüler:in" + (students === 1 ? "" : "nen") + " verbunden"); }
  function paint() { img.src = urls[cur - 1]; counter.textContent = cur + " / " + n; preload(cur + 1); preload(cur + 2); preload(cur - 1); paintMark(); }
  function goto(k) { k = Math.min(Math.max(1, k), n); if (k === cur) return; cur = k; paint(); live.send({ t: "goto", slide: cur }); }
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFs() {
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const f = root.requestFullscreen || root.webkitRequestFullscreen; if (f) Promise.resolve(f.call(root)).catch(() => {}); }
  }
  const onKey = (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(e.key)) { e.preventDefault(); goto(cur + 1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(e.key)) { e.preventDefault(); goto(cur - 1); }
    else if (e.key === "Home") goto(1); else if (e.key === "End") goto(n);
    else if (e.key === "f" || e.key === "F") toggleFs();
  };
  let idleT = null;
  const wake = () => { root.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add("idle"), 2500); };
  let tx = null;
  root.querySelector(".stage").addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); goto(e.clientX - r.left > r.width / 3 ? cur + 1 : cur - 1); });
  root.addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; }, { passive: true });
  root.addEventListener("touchend", (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) goto(dx < 0 ? cur + 1 : cur - 1); tx = null; });
  root.addEventListener("mousemove", wake);
  document.addEventListener("keydown", onKey);
  function end(stopForAll) {
    document.removeEventListener("keydown", onKey); clearTimeout(idleT);
    if (stopForAll) live.send({ t: "stop" });
    setTimeout(() => live.close(), stopForAll ? 400 : 0);
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {});
    root.remove();
    if (stopForAll) toast("Die Live-Präsentation wurde für alle beendet.", "ok");
    if (onEnd) onEnd(stopForAll);
  }
  document.body.append(root);
  paint(); paintInfo(); wake();
  // Vollbild muss direkt aus dem Klick heraus angefordert werden (Aufrufer ruft startPresenter im Klick-Handler auf)
  toggleFs();
  live.connect();
  live.send({ t: "start", fileId: file.id, pages: n, slide: cur });
  return { end };
}

/* Sitzungscode groß für den Beamer – mit QR-Code zu Unterricks (public/qr-unterricks.svg, erzeugt von scripts/qr-unterricks.mjs) */
export function showCode(code, title) {
  const site = PUBLIC_URL.replace(/^https:\/\//, "");
  const root = h("div", { class: "codeshow", role: "dialog", "aria-label": "Sitzungscode" },
    h("div", null, h("div", { style: { fontSize: "1.4rem", opacity: .85 }, text: title || "Sitzungscode" }),
      h("div", { class: "cs-grid" },
        h("div", { class: "c", text: code }),
        h("figure", { class: "qrbox" }, h("img", { class: "qr", src: "qr-unterricks.svg", alt: "QR-Code zu " + PUBLIC_URL, width: "296", height: "296" }), h("figcaption", { text: site }))),
      h("p", { style: { fontSize: "1.2rem", opacity: .85 }, text: "QR-Code scannen oder " + site + " öffnen → Passwort → Klasse und Fach → Code eingeben" }),
      h("button", { class: "btn", type: "button", onclick: () => close() }, "Schließen")));
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  document.body.append(root);
  const f = root.requestFullscreen || root.webkitRequestFullscreen; if (f) Promise.resolve(f.call(root)).catch(() => {});
}
export { clear, errToast };
