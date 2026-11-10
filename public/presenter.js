// presenter.js – Präsentation (PDF) in Folienbilder umwandeln und im Vollbild live für alle zeigen.
import { h, clear, api, apiUrl, wsUrl, toast, errToast, icon } from "./ui.js";

let pdfjsP = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = import("/vendor/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; return m; });
  return pdfjsP;
}

/* PDF im Browser rendern (PDF.js) und jede Seite als JPEG hochladen. onProgress(i, n) */
export async function rasterizeAndUpload(file, fileId, token, onProgress) {
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
  return { pages: n, thumbs, file: ready.file };
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
export async function startPresenter({ lessonId, file, token, startSlide = 1, onEnd, slides }) {
  const s = slides || (await fetchSlides(file.id, token));
  const urls = (s.urls || []).map(apiUrl), n = s.pages;
  let cur = Math.min(Math.max(1, startSlide), n), students = 0, connOk = true;
  const img = h("img", { alt: "", draggable: "false" });
  const counter = h("span", { class: "counter" });
  const info = h("span", { class: "small" });
  const fsBtn = h("button", { class: "btn small", type: "button", onclick: () => toggleFs() }, "Vollbild");
  const root = h("div", { class: "presenter", role: "dialog", "aria-label": "Präsentation läuft" },
    h("div", { class: "stage" }, img),
    h("div", { class: "bar" },
      h("button", { class: "btn small", type: "button", onclick: () => goto(cur - 1), "aria-label": "Vorherige Folie" }, "◀"),
      counter,
      h("button", { class: "btn small", type: "button", onclick: () => goto(cur + 1), "aria-label": "Nächste Folie" }, icon("right")),
      h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE für alle"), info,
      h("span", { class: "grow" }),
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
  function paint() { img.src = urls[cur - 1]; counter.textContent = cur + " / " + n; preload(cur + 1); preload(cur + 2); preload(cur - 1); }
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

/* Sitzungscode groß für den Beamer */
export function showCode(code, title) {
  const root = h("div", { class: "codeshow", role: "dialog", "aria-label": "Sitzungscode" },
    h("div", null, h("div", { style: { fontSize: "1.4rem", opacity: .85 }, text: title || "Sitzungscode" }), h("div", { class: "c", text: code }),
      h("p", { style: { fontSize: "1.2rem", opacity: .85 }, text: "Unterricks öffnen → Passwort → Klasse und Fach → Code eingeben" }),
      h("button", { class: "btn", type: "button", onclick: () => close() }, "Schließen")));
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  document.body.append(root);
  const f = root.requestFullscreen || root.webkitRequestFullscreen; if (f) Promise.resolve(f.call(root)).catch(() => {});
}
export { clear, errToast };
