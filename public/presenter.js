// presenter.js – Präsentation (PDF) in Folienbilder umwandeln und im Vollbild live für alle zeigen.
import { h, clear, api, apiUrl, wsUrl, toast, errToast, icon, store, rand, busy } from "./ui.js";
import { isValidCode, formatCode, slideTextLines, slideCodeBoxes, slideSessionCode, codeCover, coverFill, codeFontStyle, codeSlideLines, cleanCodeSlides, cleanSlideNotes, notesFor,
  nextSlideOf, nextSlideLabel, presenterKey, BEAMER_CHANNEL, normBeamerCode, PUBLIC_URL, beamerWindowNote,
  TIMER_PICKS, TIMER_MAX_MIN, TIMER_TOTAL_MAX_MIN, TIMER_ADDS, TIMER_OVER, normTimerMin } from "./shared.js";
import { codeSlideDom } from "./codeslide.js";
import { timerBand } from "./timerband.js";

let pdfjsP = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = import("/vendor/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; return m; });
  return pdfjsP;
}

/* Schriftfamilie für den neuen Code: wie der alte (Festbreite, Serife, sonst serifenlos) – aus den Schriftangaben von PDF.js bzw. der Ersatzfamilie */
const genericFont = (st) => (st && st.mono ? '"Courier New", Courier, monospace' : st && st.serif ? '"Times New Roman", Times, serif' : "Arial, Helvetica, sans-serif");
const styleOf = (b) => { const st = codeFontStyle(b.font); if (/mono|courier/i.test(b.family)) { st.mono = true; st.serif = false; } else if (!b.font && /serif/i.test(b.family) && !/sans/i.test(b.family)) st.serif = true; return st; };
/* Breite eines Zeichens – für die Lage des Codes im Satz: in der Schrift des PDF selbst (PDF.js meldet eingebettete Schriften unter ihrem
   loadedName im Browser an, mf), sonst in der passenden allgemeinen Schrift */
let measCtx = null; const measured = new Map();
function advance(ch, fam, mf) {
  const gen = genericFont({ mono: /mono|courier/i.test(fam), serif: /serif/i.test(fam) && !/sans/i.test(fam) }), f = mf ? "100px " + mf + ", " + gen : "bold 100px " + gen, k = f + "|" + ch;
  if (!measured.has(k)) { measCtx ||= document.createElement("canvas").getContext("2d"); measCtx.font = f; measured.set(k, measCtx.measureText(ch).width); }
  return measured.get(k);
}
/* Textstücke einer Seite: von PDF.js in Gerätekoordinaten (gedrehter Text zählt nicht) – für Platzhalterfolien (codeSlideLines) und Codes
   (slideCodeBoxes). Ein Strich, den eine Schrift als Sonderglyphe ohne Unicode setzt (z. B. Inter zwischen Großbuchstaben: leeres Stück bzw.
   Privatzeichen), zählt als Bindestrich. */
async function pageItems(lib, page, vp) {
  const tc = await page.getTextContent();
  const items = [], sx = Math.hypot(vp.transform[0], vp.transform[1]);   // Maßstab samt /UserUnit (vp.scale enthält ihn nicht)
  const fontOf = (name) => { try { return page.commonObjs.has(name) ? page.commonObjs.get(name) : null; } catch { return null; } };
  const hasFace = (name) => { try { for (const ff of document.fonts) if (ff.family.replace(/["']/g, "") === name && ff.status === "loaded") return true; } catch {} return false; };
  const loaded = (f) => (f && f.loadedName && !f.missingFile && /^[\w-]+$/.test(f.loadedName) && hasFace(f.loadedName) ? '"' + f.loadedName + '"' : "");
  for (const it of tc.items || []) {
    if (typeof it.str !== "string") continue;   // Markierungen ohne Text
    const tx = lib.Util.transform(vp.transform, it.transform), hgt = Math.hypot(tx[2], tx[3]), w = it.width * sx;
    // gedreht oder gespiegelt: keine waagerechte Zeile; schräg (künstliches Kursiv: Scherung in tx[2]) zählt für die Codefolie mit
    const turned = Math.abs(tx[1]) > hgt * 0.02 || !(tx[0] > 0), skewed = Math.abs(tx[2]) > hgt * 0.02;
    const dashLike = (it.str === "" || /^[\uE000-\uF8FF]$/.test(it.str)) && !it.hasEOL && w > hgt * 0.15 && w < hgt * 0.8;
    items.push(turned ? { str: "", eol: true } : { str: dashLike ? "\u2010" : it.str, x: tx[4], base: tx[5], w, h: hgt, eol: !!it.hasEOL, skewed,
      family: ((tc.styles || {})[it.fontName] || {}).fontFamily || "", font: fontOf(it.fontName), mf: loaded(fontOf(it.fontName)) });
  }
  return items;
}
/* alten Code übermalen (Fläche und Farben misst codeCover, die Füllung verläuft wie der Hintergrund – coverFill) und den neuen genau auf
   die Fläche der alten Schrift setzen: gleiche Größe, Breite angeglichen (leicht gestaucht bzw. gestreckt), Schnitt und Familie wie vorher.
   false = an dieser Stelle nicht sicher möglich (Folie bleibt, die Lehrkraft erfährt es). */
function paintCode(ctx, b, text) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (b.x0 < 0 || b.x1 > W || b.base - b.h < 0 || b.base > H) return false;   // nicht ganz auf der Folie – lieber nicht
  const rx = Math.max(0, Math.floor(b.x0 - b.h * 0.6)), ry = Math.max(0, Math.floor(b.base - b.h * 1.4));
  const rw = Math.min(W, Math.ceil(b.x1 + b.h * 0.6)) - rx, rh = Math.min(H, Math.ceil(b.base + b.h * 0.7)) - ry;
  if (rw < 4 || rh < 4) return false;
  const d = ctx.getImageData(rx, ry, rw, rh).data;
  const c = codeCover(d, rw, rh, { x0: b.x0 - rx, x1: b.x1 - rx, base: b.base - ry, h: b.h });
  if (!c) return false;
  ctx.putImageData(new ImageData(coverFill(d, rw, rh, c), c.w, c.h), rx + c.x, ry + c.y);
  const st = styleOf(b), weight = st.bold === null ? (c.share > 0.34 ? "bold" : "normal") : st.bold ? "bold" : "normal";
  const font = (size) => (st.italic ? "italic " : "") + weight + " " + size + "px " + genericFont(st);
  ctx.save();
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.fillStyle = "rgb(" + c.fg.join(",") + ")";
  let size = b.h; ctx.font = font(size);
  let m = ctx.measureText(text), inkW = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
  let k = c.inkW / inkW;
  if (k < 0.8) { size *= k / 0.8; ctx.font = font(size); m = ctx.measureText(text); inkW = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width); k = c.inkW / inkW; }
  k = Math.min(1.2, Math.max(0.8, k));
  ctx.translate(rx + c.inkX + (c.inkW - inkW * k) / 2, b.base); ctx.scale(k, 1);
  ctx.fillText(text, m.actualBoundingBoxLeft || 0, 0);
  ctx.restore();
  return true;
}

/* Seitenzahl einer PDF (Bildkarten: vor dem Hochladen prüfen, ob es höchstens 40 Karten sind und sich die PDF lesen lässt) */
export async function pdfPageCount(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try { return doc.numPages; } finally { await doc.destroy(); }
}
/* PDF im Browser rendern (PDF.js) und jede Seite als JPEG hochladen. onProgress(i, n).
   Platzhalterfolien (Zeile „Unterricks-Codefolie“, codeSlideLines) gehen als codeSlides [{n, lines}] mit an den Server – dort zeigt die
   Live-Präsentation die Codefolie. Stiller Rückfall für ältere Präsentationen mit dem Code auf den Folien: opt.code = Code der Sitzung;
   steht auf Folie 1 ein anderer (Präsentation aus einer früheren Sitzung), wird er auf allen Folien ersetzt. opt.exclude = Codes
   verknüpfter Feibeitsblätter (nie der Sitzungscode). Ergebnis swapped = {from, to, slides, missed} oder null (missed = Folien, auf denen
   der alte Code steht, aber nicht sicher ersetzt werden konnte). Die hochgeladene PDF selbst bleibt unverändert.
   opt.cards (Bildkarten der Grundschule, cards.js): keine Codefolien und kein Ersetzen von Codes, längste Seite 1600 px, höchstens 40 Seiten;
   fertig über …/cards/ready mit opt.version (Stand der PDF, aus dem die Bilder stammen).
   Notizen der Lehrkraft (Nachtrag 20): der Anhang unterricks-notizen.json (bzw. opt.notes aus einer Sitzungsdatei) geht mit …/ready an den Server.
   Trägt die PDF Anhänge oder Notiz-Anmerkungen, bekommen Schüler:innen nur eine bereinigte Fassung (…/clean); die Folienbilder entstehen dann aus
   ihr. Mit Notizen entsteht danach die Anmerkungs-PDF (nur Lehrkraft). Ergebnis zusätzlich notes (Zahl), clean {needed, ok, error}, annotated
   {file, removed} | {error}. */
export async function rasterizeAndUpload(file, fileId, token, onProgress, opt = {}) {
  const cards = !!opt.cards;
  const want = !cards && isValidCode(opt.code) ? opt.code : "";
  let oldCode = "";
  const swappedOn = [], missedOn = [], codeSlides = [];
  const lib = await pdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const open = (data) => lib.getDocument({ data, isEvalSupported: false, disableFontFace: false }).promise;
  let doc = await open(bytes.slice());   // PDF.js übernimmt den Puffer – die Bytes bleiben für pdf-lib erhalten
  const n = doc.numPages;
  if (n > 300) { await doc.destroy(); throw new Error("Die Präsentation hat mehr als 300 Folien."); }
  if (cards && n > 40) { await doc.destroy(); throw new Error("Die PDF hat " + n + " Seiten – höchstens 40 Bildkarten je PDF (eine Seite = eine Karte)."); }
  // Notizen und Anhänge (nicht bei Bildkarten): bereinigte Fassung für Schüler:innen zuerst – die Folienbilder zeigen dann genau sie
  let scan = { needsClean: false, raw: null }, cleanState = null, renderOpt = {};
  if (!cards) {
    const { scanPdfNotes } = await import("./pdfnotes.js");
    try { scan = await scanPdfNotes(doc); } catch {}
    if (scan.needsClean) {
      cleanState = { needed: true, ok: false, error: null };
      try {
        const { uploadClean } = await import("./pdfcut.js");
        const c = await uploadClean({ id: fileId }, token, bytes);
        const cdoc = await open(c.bytes.slice());
        if (cdoc.numPages === n) { await doc.destroy(); doc = cdoc; cleanState.ok = true; } else { await cdoc.destroy(); throw new Error("Seitenzahl stimmt nicht."); }
      } catch (e) {
        // Schüler:innen bekommen die PDF dann vorerst nicht (der Server liefert ohne bereinigte Fassung keine); die Folienbilder ohne Anmerkungen
        cleanState.error = e && e.message ? e.message : String(e);
        renderOpt = { annotationMode: lib.AnnotationMode.DISABLE };
      }
    }
  }
  const notes = cards ? [] : cleanSlideNotes(opt.notes !== undefined && opt.notes !== null ? opt.notes : scan.raw, n);
  const side = cards ? 1600 : 1920;
  const thumbs = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(side / v1.width, side / v1.height, 4);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, ...renderOpt }).promise;
    let items = null, placeholder = false;
    if (!cards) try {   // Platzhalterfolie für die Codefolie? (eigener Versuch: ein Fehler hier schaltet den Rückfall nicht ab)
      items = await pageItems(lib, page, vp);
      const head = codeSlideLines(slideTextLines(items), canvas.height);
      if (head) { placeholder = true; codeSlides.push({ n: i, lines: head }); }
    } catch {}
    if (want && items && !placeholder) {
      try {
        const boxes = slideCodeBoxes(items.map((it) => (it.skewed ? { str: "", eol: true } : it)), advance);   // nur aufrechte Schrift übermalen
        if (i === 1) oldCode = slideSessionCode(boxes, { exclude: opt.exclude, minH: canvas.height * 0.06 });   // kleine Codes sind es nicht
        if (oldCode && oldCode !== want) {
          // derselbe Code doppelt übereinander (z. B. Schatten): nur einmal, und zwar den vordersten (zuletzt gezeichneten)
          const mine = boxes.filter((b) => b.code === oldCode).reverse().filter((b, j, all) => !all.slice(0, j).some((o) => Math.abs(o.x0 - b.x0) < b.h * 0.3 && Math.abs(o.base - b.base) < b.h * 0.3));
          let ok = 0, bad = 0;
          for (const b of mine) { let done = false; try { done = paintCode(ctx, b, formatCode(want)); } catch {} if (done) ok++; else bad++; }
          if (ok) swappedOn.push(i);
          if (bad) missedOn.push(i);
        }
      } catch {}   // ohne lesbare Textebene: Folie bleibt, wie sie ist
    }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(apiUrl("/api/teacher/files/" + fileId + "/slides/" + i + "?w=" + canvas.width + "&h=" + canvas.height + (cards ? "&v=" + encodeURIComponent(opt.version) : "")), { method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "image/jpeg" }, body: blob });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) { const err = new Error((d && d.error) || (cards ? "Kartenbild " : "Folie ") + i + " konnte nicht gespeichert werden."); err.code = (d && d.code) || ""; throw err; }
        break;
      } catch (e) { if (attempt >= 2 || (cards && e.code === "stale")) { if (cards) await doc.destroy(); throw e; } await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
    }
    if (i <= 40) { const t = document.createElement("canvas"); const k = 120 / canvas.height; t.width = Math.round(canvas.width * k); t.height = 120; t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height); thumbs.push(t.toDataURL("image/jpeg", 0.7)); }
    page.cleanup();
    if (onProgress) onProgress(i, n);
  }
  await doc.destroy();
  if (cards) {
    const done = await api("POST", "/api/teacher/files/" + fileId + "/cards/ready", { token, body: { pages: n, version: opt.version } });
    return { pages: n, thumbs, file: done.file };
  }
  const sent = cleanCodeSlides(codeSlides, n);
  const ready = await api("POST", "/api/teacher/files/" + fileId + "/ready", { token, body: { pages: n, codeSlides: sent, notes, clean: !!scan.needsClean } });
  // Anmerkungs-PDF (nur Lehrkraft): ein Fehler hier lässt die Präsentation nutzbar
  let annotated = null;
  const rev = ready.file && ready.file.notesRev;
  if (notes.length && Number.isInteger(rev)) {
    try { const { makeAnnotated } = await import("./pdfnotes.js"); annotated = await makeAnnotated({ id: fileId, name: file.name }, { token, notes, rev, codeSlides: sent, bytes }); }
    catch (e) { annotated = { error: e && e.message ? e.message : String(e) }; }
  }
  return { pages: n, thumbs, file: ready.file, codeSlides: (ready.file && ready.file.codeSlides) || sent, notes: notes.length, clean: cleanState, annotated,
    swapped: swappedOn.length || missedOn.length ? { from: oldCode, to: want, slides: swappedOn, missed: missedOn } : null };
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
    if (m.t === "start") this.want = { ...m, resume: false };   // nach einer Wiederverbindung gilt der Stand dieser Seite
    else if (m.t === "goto" && this.want) { this.want.slide = m.slide; this.want.codeShown = false; }
    else if (m.t === "code" && this.want) this.want.codeShown = !!m.on;   // nach einer Wiederverbindung bleibt die eingeblendete Codefolie
    else if (m.t === "stop") this.want = null;
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s); else this.queue.push(s);
  }
  // Stand neu anfordern (Timer nach Bildschirmsperre bzw. Ruhezustand): nur bei offener Verbindung – sonst kommt er mit der Wiederverbindung
  hello() { if (this.ws && this.ws.readyState === 1) try { this.ws.send(JSON.stringify({ t: "hello" })); } catch {} }
  close() { this.closed = true; clearTimeout(this.reT); clearInterval(this.pingT); try { this.ws && this.ws.close(); } catch {} }
}

/* ---------- Präsentationsmodus (Vollbild) ---------- */
export async function fetchSlides(fileId, token) {
  return api("GET", "/api/teacher/files/" + fileId + "/slides", { token });
}
// slides vorab laden (fetchSlides), damit das Vollbild ohne Wartezeit direkt aus dem Klick angefordert werden kann.
// Codefolie (code = Sitzungscode, title = Titel der Sitzung): Folie 0 vor Folie 1, an Platzhalterfolien (codeSlides) mit deren Überschrift
// und über „Sitzungscode zeigen“ (peek) – bei allen live gleich. startSlide 0 = Start mit der Codefolie.
// Für die Lehrkraft: groß die aktuelle Folie, daneben kleiner die nächste (Vorschau, Taste V, gemerkt); „Beamerfenster öffnen“ = zweites
// Fenster nur mit der aktuellen Folie (beamer.js, BroadcastChannel) für den Beamer als erweiterten Bildschirm; „Beamer verbinden“ (auf allen
// Geräten, Nachtrag 15) = ein zweites Gerät am Beamer (z. B. Schul-iPad an Apple TV) zeigt über den Server nur die aktuelle Folie.
const NEXT_KEY = "u.presnext";
export const BEAMER_PAIR_HINT = "Der Code steht auf dem Gerät am Beamer – dort " + PUBLIC_URL.replace(/^https:\/\//, "") + "/#/beamer öffnen (auf der Startseite: „Dieses Gerät als Beamer verwenden“). " +
  "Spiegeln Sie dieses Gerät dann nicht auf den Beamer: Der Beamer zeigt das zweite Gerät, Sie sehen hier weiter die nächste Folie.";
export const BEAMER_CODE_MISSING = "Bitte geben Sie die sechs Ziffern ein, die auf dem Beamer stehen.";
const beamersText = (n) => (n === 1 ? "Beamer verbunden" : n + " Beamer verbunden");
const BEAMER_CUT_NOTE = "Beamer getrennt";
export const BEAMER_NOTE_MS = 6000;   // so lange steht „Beamer getrennt“ in der Leiste
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
// Timer (Nachtrag 16): Feld „Timer“ innerhalb der Präsentation (kein Toast – im Vollbild nicht zu sehen)
const TIMER_KEY = "u.timermin";   // zuletzt gestartete Minuten (Vorauswahl)
export const TIMER_HINT = "Der Timer steht oben über der Präsentation – bei den Schüler:innen, am Beamer und hier über der aktuellen Folie. " +
  "Am Ende wird er rot („" + TIMER_OVER + "“), ohne Ton, bis Sie ihn schließen.";
export const TIMER_MIN_BAD = "Bitte geben Sie eine ganze Zahl von 1 bis " + TIMER_MAX_MIN + " Minuten ein.";
export const TIMER_MAX_NOTE = "Insgesamt höchstens " + TIMER_TOTAL_MAX_MIN + " Minuten.";
// Notizen der Lehrkraft (Nachtrag 20): nur, wenn das Beamerbild getrennt läuft (Beamerfenster bzw. Beamergerät verbunden) – ein einzeln
// gespiegeltes iPad oder ein gespiegelter Laptop zeigt sie nie (die Klasse sähe sie mit)
export const NOTES_HINT = "Notizen erscheinen, sobald ein Beamerfenster oder Beamergerät verbunden ist – Ihre Anmerkungs-PDF finden Sie unter „Material nur für die Lehrkraft“.";
export const NOTES_PAIR_HINT = "Mit verbundenem Beamer sehen Sie hier unter der aktuellen Folie Ihre Notizen – am Beamer erscheinen sie nie.";
export const NOTES_HINT_MS = 12000;   // so lange steht der Hinweis in der Leiste (sonst bräche sie am iPad hochkant in eine dritte Zeile)
export const NOTES_NONE = "Keine Notizen zu dieser Folie.";
export async function startPresenter({ lessonId, file, token, startSlide = 0, onEnd, slides, onMark, shownUntil = null, code = "", title = "" }) {
  const s = slides || (await fetchSlides(file.id, token));
  const urls = (s.urls || []).map(apiUrl), n = s.pages, pages = n;
  const withCode = isValidCode(code), first = withCode ? 0 : 1;
  const holders = new Map(withCode ? cleanCodeSlides(s.codeSlides || (file && file.codeSlides) || [], n).map((c) => [c.n, c.lines]) : []);
  let cur = Math.min(Math.max(first, startSlide), n), peek = false, students = 0, connOk = true;
  let showNext = store.get(NEXT_KEY) !== "0";
  const img = h("img", { alt: "", draggable: "false" });
  const stage = h("div", { class: "stage" }, img);
  // Timer (Nachtrag 16): dieselbe Anzeige wie bei den Schüler:innen oben auf der großen aktuellen Folie (die Vorschau bekommt keine) – so stimmt
  // es auch, wenn dieses Gerät ohne zweites Gerät gespiegelt wird. Der Stand kommt vom Server (Durable Object).
  const tb = timerBand({ host: stage, onPaint: (v) => paintTimer(v), onStale: () => live.hello() });
  stage.append(tb.el);
  const stageCell = h("div", { class: "stagecell" }, stage);
  // Notizen der Lehrkraft unter der aktuellen Folie (Nachtrag 20) – nie im Beamerfenster, am Beamergerät oder bei Schüler:innen
  const notes = cleanSlideNotes(s.notes || [], n), hasNotes = notes.length > 0;
  const notesHead = h("p", { class: "pn-head" }), notesBody = h("div", { class: "pn-body" });
  const notesBox = h("section", { class: "notespane", tabindex: "0", "aria-label": "Ihre Notizen zur aktuellen Folie (nur für Sie)" }, notesHead, notesBody);
  const curCol = h("div", { class: "curcol" }, stageCell, notesBox);
  let notesAt = null;   // Folie, deren Notizen gerade stehen (beim Wechsel wieder nach oben)
  const npImg = h("img", { alt: "", draggable: "false" });
  const npHead = h("p", { class: "np-head" }), npFrame = h("div", { class: "np-frame" }, npImg);
  const nextPane = h("aside", { class: "nextpane", "aria-label": "Vorschau der nächsten Folie", title: "Zur nächsten Folie" }, h("div", { class: "np-box" }, npHead, npFrame));
  const counter = h("span", { class: "counter" });
  const info = h("span", { class: "small" });
  const fsBtn = h("button", { class: "btn small", type: "button", onclick: () => toggleFs() }, "Vollbild");
  // „Bis hier gezeigt“: aktuelle Folie als letzte im Unterricht gezeigte Folie markieren (Schüler:innen bekommen nach der Freigabe nur bis hier)
  let marked = shownUntil, marking = false;
  const markState = h("span", { class: "small markstate", "aria-live": "polite" });
  const markBtn = onMark ? h("button", { class: "btn small", type: "button", onclick: async () => {
    if (marking || cur === 0 || peek) return; marking = true; markBtn.disabled = true;
    const n = cur;
    try {
      await onMark(n, (m) => { markState.textContent = m; });
      marked = n >= pages ? null : n;
      markState.textContent = marked ? "Bis Folie " + n + " markiert" : "Letzte Folie: alle Folien freigegeben";
    } catch (e) { markState.textContent = "Nicht markiert: " + (e && e.message ? e.message : e); }
    marking = false; paintMark();
  } }, "Bis hier gezeigt") : null;
  function paintMark() {
    if (!markBtn) return;
    markBtn.disabled = marking || cur === 0 || peek;   // die Codefolie ist keine Seite der PDF
    markBtn.setAttribute("aria-label", "Folie " + cur + " als letzte im Unterricht gezeigte Folie markieren" + (marked ? " (bisher: Folie " + marked + ")" : ""));
  }
  // „Sitzungscode zeigen“: Codefolie über der aktuellen Folie – live bei allen; die nächste Bewegung (Pfeil, Klick, Wischen) kehrt zurück
  const codeBtn = withCode ? h("button", { class: "btn small", type: "button", onclick: () => setPeek(!peek) }, "Sitzungscode zeigen") : null;
  function paintCodeBtn() {
    if (!codeBtn) return;
    codeBtn.textContent = peek ? "Zurück zu Folie " + cur : "Sitzungscode zeigen";
    codeBtn.disabled = !peek && cur === 0;
  }
  function setPeek(on) { if (on === peek || (on && cur === 0)) return; moved = true; peek = on; paint(); live.send({ t: "code", on }); }
  // Vorschau der nächsten Folie (nur hier, nie im Beamerfenster und nie bei den Schüler:innen) – bei gespiegeltem Bildschirm ausblenden
  const nextBtn = h("button", { class: "btn small", type: "button", "aria-pressed": String(showNext), "aria-label": "Vorschau der nächsten Folie",
    title: "Vorschau der nächsten Folie ein- oder ausblenden (Taste V)", onclick: () => setNext(!showNext) }, "Vorschau");
  function setNext(on) { showNext = on; store.set(NEXT_KEY, on ? "1" : "0"); nextBtn.setAttribute("aria-pressed", String(on)); root.classList.toggle("with-next", on); paint(); }
  // getrennt = das Beamerbild läuft auf einem anderen Bildschirm: Beamerfenster (BroadcastChannel) oder Beamergerät (Zahl aus dem Durable Object)
  const separate = () => beamers.size > 0 || beamersN > 0;
  function paintNotes() {
    const on = hasNotes && showNext && separate();
    root.classList.toggle("with-notes", on);
    paintNotesHint();
    if (!on) { notesAt = null; return; }
    const items = cur === 0 ? [] : notesFor(notes, cur);
    const head = cur === 0 ? "Codefolie vor Folie 1" : "Notizen zu Folie " + cur + (holders.has(cur) ? " (Codefolie)" : "");
    if (notesAt === cur && notesHead.textContent === head) return;
    notesHead.textContent = head;
    notesBody.replaceChildren(items.length ? h("ul", { class: "pn-list" }, ...items.map((t) => h("li", { text: t }))) : h("p", { class: "pn-none", text: NOTES_NONE }));
    if (notesAt !== cur) notesBox.scrollTop = 0;
    notesAt = cur;
  }
  function paintNotesHint() {
    const want = hasNotes && showNext && !separate() && Date.now() < hintUntil, t = want ? NOTES_HINT : "";
    if (notesHint.textContent !== t) notesHint.textContent = t;
  }
  function showNotesHint() {
    if (!hasNotes) return;
    hintUntil = Date.now() + NOTES_HINT_MS; clearTimeout(hintT);
    hintT = setTimeout(paintNotesHint, NOTES_HINT_MS + 50);
    paintNotesHint();
  }
  // Beamerfenster: nicht auf Tablets und Handys (dort gibt es kein zweites Fenster neben dem Präsentationsfenster)
  const bc = typeof BroadcastChannel === "function" ? new BroadcastChannel(BEAMER_CHANNEL) : null;
  const pid = hex(rand(8)), beamers = new Set();
  let claimAt = Date.now();
  const touchOnly = typeof matchMedia === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;
  const beamBtn = bc && !touchOnly ? h("button", { class: "btn small", type: "button", onclick: () => openBeamer(),
    title: "Zweites Fenster nur mit der aktuellen Folie – für den Beamer als erweiterten Bildschirm. Hier sehen Sie weiter die nächste Folie." }, "Beamerfenster öffnen") : null;
  const beamState = h("span", { class: "small beamstate", "aria-live": "polite" });
  let beamNote = "", beamOne = false;   // Hinweis zum Beamerfenster in der Leiste – Toasts sind im Vollbild nicht zu sehen; beamOne: nur ein Bildschirm erkannt
  // Beamer über ein zweites Gerät (Nachtrag 15): auch auf Tablets – Code des Beamergeräts in einem Feld innerhalb der Präsentation eingeben
  // (kein Seitenwechsel, das Vollbild bleibt); verbunden zeigt die Leiste „Beamer verbunden“ (Zahl aus dem Durable Object)
  let beamersN = 0, devNote = "", devWaitT = null;
  const devBtn = h("button", { class: "btn small", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => openPair() }, "Beamer verbinden");
  const devState = h("span", { class: "small devstate", "aria-live": "polite" });
  const pairIn = h("input", { id: "bmc-in", class: "codein", type: "text", inputmode: "numeric", autocomplete: "off", autocapitalize: "off", autocorrect: "off",
    spellcheck: "false", enterkeyhint: "go", maxlength: "12", "aria-describedby": "bmc-hint bmc-err" });
  const pairErr = h("p", { class: "err", id: "bmc-err", role: "alert" });
  let pairKeyed = false;   // zuletzt per Tastatur ausgelöst (Enter, Esc, Leertaste): der Fokus geht danach zurück auf „Beamer verbinden“
  const pairGo = h("button", { class: "btn primary", type: "submit", onclick: (e) => { pairKeyed = e.detail === 0; } }, "Verbinden");
  const pairConnLine = h("p", { class: "bmc-conn" });
  const unpairBtn = h("button", { class: "btn", type: "button", onclick: (e) => unpair(e.currentTarget, e.detail === 0) }, "Beamer trennen");
  const pairConn = h("div", { class: "bmc-connbox", hidden: true }, pairConnLine, unpairBtn);
  const pairH = h("h2", { id: "bmc-h" }, "Beamer verbinden");
  const pairBox = h("form", { class: "bmc", role: "dialog", "aria-modal": "true", "aria-labelledby": "bmc-h", novalidate: true, onsubmit: (e) => { e.preventDefault(); doPair(); } },
    pairH, pairConn,
    h("div", { class: "field" }, h("label", { for: "bmc-in" }, "Code vom Beamer eingeben"), pairIn),
    h("p", { class: "hint", id: "bmc-hint", text: BEAMER_PAIR_HINT }), hasNotes ? h("p", { class: "hint bmc-notes", text: NOTES_PAIR_HINT }) : null, pairErr,
    h("div", { class: "bmc-acts" }, h("button", { class: "btn", type: "button", onclick: (e) => closePair(e.detail === 0) }, "Abbrechen"), pairGo));
  // eigene Fläche über der ganzen Präsentation: Tippen und Wischen daneben blättern nicht (Klick daneben schließt)
  const pairWrap = h("div", { class: "bmc-back", hidden: true, onclick: (e) => { if (e.target === pairWrap) closePair(false); } }, pairBox);
  // Timer (Nachtrag 16): ein Knopf in der Leiste – ohne Timer „Timer“, sonst die Restzeit (letzte Minute orange, abgelaufen „Zeit um“ rot); er öffnet
  // ein Feld innerhalb der Präsentation (Vollbild bleibt): ohne Timer Dauer wählen und starten, sonst Pause/Weiter, +1 Min, +5 Min, beenden
  // bzw. nach Ablauf schließen. Alles in einem Knopf, damit die Leiste am iPad hochkant nicht in eine dritte Zeile bricht.
  const tmLbl = h("span", { class: "tm-lbl", text: "Timer" });
  const tmSr = h("span", { class: "sr-only", text: "Timer " });
  const tmBtn = h("button", { class: "btn small tmbtn", type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Timer für einen Arbeitsauftrag (Taste T)",
    onclick: () => openTimer() }, icon("timer"), tmSr, tmLbl);
  let tmKeyed = false;   // zuletzt per Tastatur ausgelöst: der Fokus geht danach zurück auf „Timer“
  const tmIn = h("input", { id: "tmc-min", class: "tmc-in", type: "text", inputmode: "numeric", autocomplete: "off", autocapitalize: "off", autocorrect: "off",
    spellcheck: "false", enterkeyhint: "go", maxlength: "12", "aria-describedby": "tmc-hint tmc-err", oninput: () => { tmErr.textContent = ""; tmIn.removeAttribute("aria-invalid"); syncPicks(); } });
  const tmErr = h("p", { class: "err", id: "tmc-err", role: "alert" });
  const picks = TIMER_PICKS.map((n) => h("button", { class: "btn tmc-pick", type: "button", "aria-pressed": "false",
    onclick: () => { tmIn.value = String(n); tmErr.textContent = ""; tmIn.removeAttribute("aria-invalid"); syncPicks(); } }, n + " Min"));
  function syncPicks() { const v = normTimerMin(tmIn.value); picks.forEach((b, i) => b.setAttribute("aria-pressed", String(TIMER_PICKS[i] === v))); }
  const tmGo = h("button", { class: "btn primary", type: "submit", onclick: (e) => { tmKeyed = e.detail === 0; } }, "Timer starten");
  const tmStartBox = h("div", { class: "tmc-start" },
    h("fieldset", { class: "tmc-picks" }, h("legend", { text: "Dauer" }), ...picks),
    h("div", { class: "field" }, h("label", { for: "tmc-min" }, "Minuten (1 bis " + TIMER_MAX_MIN + ")"), tmIn),
    h("p", { class: "hint", id: "tmc-hint", text: TIMER_HINT }), tmErr,
    h("div", { class: "bmc-acts" }, h("button", { class: "btn", type: "button", onclick: (e) => closeTimer(e.detail === 0) }, "Abbrechen"), tmGo));
  const tmNow = h("p", { class: "tmc-now" });
  const tmPause = h("button", { class: "btn", type: "button", onclick: (e) => timerOp(tmView && tmView.paused ? "resume" : "pause", undefined, e) }, "Pause");
  const tmAdds = TIMER_ADDS.map((n) => h("button", { class: "btn", type: "button", onclick: (e) => timerOp("add", n, e) }, "+" + n + " Min"));
  const tmStop = h("button", { class: "btn", type: "button", onclick: (e) => timerOp("stop", undefined, e) }, "Timer beenden");
  const tmMax = h("p", { class: "hint", text: TIMER_MAX_NOTE, hidden: true });
  const tmCtlBox = h("div", { class: "tmc-ctlbox", hidden: true }, tmNow, h("div", { class: "tmc-ctl" }, tmPause, ...tmAdds, tmStop), tmMax,
    h("div", { class: "bmc-acts" }, h("button", { class: "btn primary", type: "button", onclick: (e) => closeTimer(e.detail === 0) }, "Fertig")));
  const tmBox = h("form", { class: "tmc", role: "dialog", "aria-modal": "true", "aria-labelledby": "tmc-h", novalidate: true, onsubmit: (e) => { e.preventDefault(); startTimer(); } },
    h("h2", { id: "tmc-h" }, "Timer"), tmStartBox, tmCtlBox);
  const tmWrap = h("div", { class: "tmc-back", hidden: true, onclick: (e) => { if (e.target === tmWrap) closeTimer(false); } }, tmBox);
  const dlgOpen = () => !pairWrap.hidden || !tmWrap.hidden;
  // Hinweis, warum die Notizen fehlen: nur mit Notizen, eingeblendeter Vorschau und ohne getrennten Beamer – kurz sichtbar (Start, Beamer getrennt)
  const notesHint = h("span", { class: "small notehint", "aria-live": "polite" });
  let hintUntil = 0, hintT = null;
  const root = h("div", { class: "presenter" + (showNext ? " with-next" : ""), role: "dialog", "aria-label": "Präsentation läuft" },
    h("div", { class: "pview" }, curCol, nextPane),
    h("div", { class: "bar" },
      h("button", { class: "btn small", type: "button", onclick: () => goto(cur - 1), "aria-label": "Vorherige Folie" }, icon("left")),
      counter,
      h("button", { class: "btn small", type: "button", onclick: () => goto(cur + 1), "aria-label": "Nächste Folie" }, icon("right")),
      h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE für alle"), info,
      h("span", { class: "grow" }), notesHint, nextBtn, beamBtn, beamState, devBtn, devState, tmBtn, codeBtn, markBtn, markState,
      fsBtn,
      h("button", { class: "btn small onair", type: "button", onclick: () => end(true) }, "Präsentation für alle beenden"),
      h("button", { class: "btn small", type: "button", onclick: () => end(false), title: "Fenster schließen, Live-Anzeige läuft weiter" }, "Schließen")),
    pairWrap, tmWrap, tb.say);
  // Seitenverhältnis der Folien (für die Rahmen neben der Vorschau): aus dem ersten geladenen Folienbild, sonst 16:9
  const setAr = (im) => { if (im.naturalWidth > 0 && im.naturalHeight > 0) root.style.setProperty("--ar", String(Math.round((im.naturalWidth / im.naturalHeight) * 10000) / 10000)); };
  img.addEventListener("load", () => setAr(img));
  let arSet = false;
  const cache = new Map();
  const preload = (k) => { if (k >= 1 && k <= n && !cache.has(k)) { const im = new Image(); im.onload = () => { if (!arSet) { arSet = true; if (!img.naturalWidth) setAr(im); } }; im.src = urls[k - 1]; cache.set(k, im); } };
  // Läuft diese Präsentation schon (Wiederöffnen), übernimmt die Seite einmal den laufenden Stand – solange noch nicht geblättert wurde
  let adopted = false, moved = false;
  const live = new TeacherLive(lessonId, token, (m) => {
    if ((m.t === "count" || m.t === "state") && Number.isInteger(m.beamers) && m.beamers >= 0 && m.beamers !== beamersN) {
      const was = separate();
      beamersN = m.beamers; if (beamersN) { devNote = ""; clearTimeout(devWaitT); } paintDev(); paintBeam();
      if (was && !separate()) showNotesHint();
      paintNotes();
    }
    if (m.t === "count") students = m.students;
    else if (m.t === "state") {
      if (typeof m.students === "number") students = m.students; connOk = true;
      tb.set(m.active ? m.timer : null); sendTimer();   // Timer: jede Nachricht gleicht die Restzeit neu ab (Uhr des Servers)
      if (!adopted && !moved && m.active && m.fileId === file.id && Number.isInteger(m.slide)) {
        adopted = true;
        const k = Math.min(Math.max(first, m.slide), n), pk = withCode && k >= 1 && m.codeShown === true;
        if (k !== cur || pk !== peek) { cur = k; peek = pk; paint(); }
      }
    }
    else if (m.t === "conn") connOk = m.ok;
    paintInfo();
  });
  function paintInfo() { clear(info).append(...(connOk ? [] : [icon("alert"), "Verbindung wird wiederhergestellt … · "]), students + " Schüler:in" + (students === 1 ? "" : "nen") + " verbunden"); }
  /* ---------- Beamer über ein zweites Gerät (Nachtrag 15) ---------- */
  // verbunden: der Knopf selbst zeigt den Stand („Beamer verbunden“, öffnet „Beamer trennen“) – die Leiste bleibt so schmal wie bisher;
  // die Statuszeile sagt es Screenreadern an und zeigt sichtbar nur Zwischenstände (gekoppelt, getrennt)
  function paintDev() {
    devBtn.textContent = beamersN ? beamersText(beamersN) : "Beamer verbinden";
    devState.textContent = beamersN ? beamersText(beamersN) : devNote;
    devState.classList.toggle("sr-only", !!beamersN);
    pairH.textContent = beamersN ? "Beamer" : "Beamer verbinden";
    pairConn.hidden = !beamersN;
    pairConnLine.textContent = beamersN ? beamersText(beamersN) + " – " + (beamersN === 1 ? "er zeigt" : "sie zeigen") + " nur die aktuelle Folie." : "";
  }
  function openPair() {
    if (!pairWrap.hidden || !tmWrap.hidden) return;
    pairErr.textContent = ""; pairIn.value = ""; pairIn.removeAttribute("aria-invalid"); paintDev();
    pairWrap.hidden = false; devBtn.setAttribute("aria-expanded", "true");
    try { pairIn.focus({ preventScroll: true }); } catch {}
  }
  // Fokus zurück: per Tastatur auf „Beamer verbinden“, nach Tippen/Klicken auf die Präsentation (Leertaste und Presenter blättern weiter) –
  // nur, wenn er noch im Feld lag (nie einen schon woandershin gesetzten Fokus wegnehmen)
  function closePair(byKey) {
    if (pairWrap.hidden) return;
    const a = document.activeElement, mine = !a || a === document.body || a === root || pairWrap.contains(a);
    pairWrap.hidden = true; devBtn.setAttribute("aria-expanded", "false");
    if (mine && root.isConnected) { try { (byKey ? devBtn : root).focus({ preventScroll: true }); } catch {} }
  }
  function trapTab(e, wrap = pairWrap) {
    const f = [...wrap.querySelectorAll("button, input")].filter((x) => !x.disabled && x.getClientRects().length > 0);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }
  async function doPair() {
    const code = normBeamerCode(pairIn.value), keyed = pairKeyed; pairKeyed = false;
    if (!code) { pairErr.textContent = BEAMER_CODE_MISSING; pairIn.setAttribute("aria-invalid", "true"); try { pairIn.focus(); } catch {} return; }
    await busy(pairGo, async () => {
      try {
        await api("POST", "/api/teacher/lessons/" + lessonId + "/beamer", { token, body: { code } });
        if (!root.isConnected) return;
        pairIn.removeAttribute("aria-invalid");
        if (!beamersN) devNote = "Beamer gekoppelt – verbindet sich …";
        clearTimeout(devWaitT);
        devWaitT = setTimeout(() => { if (!beamersN) { devNote = "Der Beamer hat sich noch nicht verbunden – ist die Seite dort noch geöffnet?"; paintDev(); } }, 20000);
        paintDev(); closePair(keyed);
      } catch (err) {
        if (!root.isConnected || pairWrap.hidden) return;
        pairErr.textContent = err && err.message ? err.message : String(err); pairIn.setAttribute("aria-invalid", "true");
        const a = document.activeElement;   // zurück ins Feld – nicht, wenn inzwischen z. B. „Abbrechen“ den Fokus hat
        if (!a || a === document.body || a === root || a === pairGo || a === pairIn) { try { pairIn.focus(); pairIn.select(); } catch {} }
      }
    }, "Verbinde …");
  }
  async function unpair(btn, keyed) {
    await busy(btn, async () => {
      try {
        await api("POST", "/api/teacher/lessons/" + lessonId + "/beamer/disconnect", { token });
        clearTimeout(devWaitT); const was = separate(); beamersN = 0; devNote = BEAMER_CUT_NOTE; paintDev(); paintBeam(); closePair(keyed);
        if (was && !separate()) showNotesHint();
        paintNotes();
        // nur kurz sichtbar: der Knopf heißt wieder „Beamer verbinden“ – sonst bräche die Leiste am iPad dauerhaft in eine dritte Zeile
        devWaitT = setTimeout(() => { if (devNote === BEAMER_CUT_NOTE) { devNote = ""; paintDev(); } }, BEAMER_NOTE_MS);
      } catch (err) { if (!pairWrap.hidden) pairErr.textContent = err && err.message ? err.message : String(err); }
    }, "Trenne …");
  }
  /* ---------- Timer (Nachtrag 16) ---------- */
  let tmView = null;
  // nach jedem Zeichnen des Bandes (jede Sekunde, solange er läuft): Knopf in der Leiste und – wenn offen – das Feld
  function paintTimer(v) {
    tmView = v;
    for (const p of ["run", "last", "over", "paused"]) tmBtn.classList.toggle("tm-" + p, !!v && v.phase === p);
    const sr = v ? "Timer " + (v.paused ? "pausiert " : "") : "", lbl = !v ? "Timer" : v.phase === "over" ? "Zeit um" : v.clock;
    if (tmSr.textContent !== sr) tmSr.textContent = sr;   // Name „Timer 4:12“ – sichtbar steht nur die Restzeit
    if (tmLbl.textContent !== lbl) tmLbl.textContent = lbl;
    if (!tmWrap.hidden) paintTimerBox();
  }
  function paintTimerBox() {
    const v = tmView, a = document.activeElement, had = !!a && a !== tmWrap && tmWrap.contains(a);
    tmStartBox.hidden = !!v; tmCtlBox.hidden = !v;
    if (v) {
      tmNow.className = "tmc-now tb-" + v.phase;
      if (tmNow.textContent !== v.text) tmNow.textContent = v.text;
      tmPause.hidden = v.phase === "over"; tmPause.textContent = v.paused ? "Weiter" : "Pause";
      const full = v.phase !== "over" && v.total >= TIMER_TOTAL_MAX_MIN * 60e3;
      for (const b of tmAdds) b.disabled = full;
      tmMax.hidden = !full;
      tmStop.textContent = v.phase === "over" ? "Timer schließen" : "Timer beenden";
    }
    // lag der Fokus im Feld auf etwas, das jetzt verborgen bzw. gesperrt ist (z. B. „Pause“ nach dem Ablauf, auf einem anderen Gerät gestartet):
    // zurück ins Feld – nie einen Fokus wegnehmen, den jemand woandershin gesetzt hat (auch nicht vom body, z. B. nach einem Mausklick)
    if (had && (a.disabled || !a.getClientRects().length || document.activeElement !== a)) focusTimerBox();
  }
  function focusTimerBox() {
    const f = !tmView ? picks.find((b) => b.getAttribute("aria-pressed") === "true") || picks[0] : tmView.phase === "over" ? tmStop : tmPause;
    try { f.focus({ preventScroll: true }); } catch {}
  }
  function openTimer() {
    if (!tmWrap.hidden || !pairWrap.hidden) return;
    tmErr.textContent = ""; tmIn.removeAttribute("aria-invalid");
    tmIn.value = String(normTimerMin(store.get(TIMER_KEY)) || 5); syncPicks();
    tmWrap.hidden = false; tmBtn.setAttribute("aria-expanded", "true");
    paintTimerBox(); focusTimerBox();
  }
  // Fokus zurück wie bei „Beamer verbinden“: per Tastatur auf „Timer“, sonst auf die Präsentation – nur, wenn er noch im Feld lag
  function closeTimer(byKey) {
    if (tmWrap.hidden) return;
    const a = document.activeElement, mine = !a || a === document.body || a === root || tmWrap.contains(a);
    tmWrap.hidden = true; tmBtn.setAttribute("aria-expanded", "false");
    if (mine && root.isConnected) { try { (byKey ? tmBtn : root).focus({ preventScroll: true }); } catch {} }
  }
  function startTimer() {
    const min = normTimerMin(tmIn.value), keyed = tmKeyed; tmKeyed = false;
    if (!min) { tmErr.textContent = TIMER_MIN_BAD; tmIn.setAttribute("aria-invalid", "true"); try { tmIn.focus(); } catch {} return; }
    store.set(TIMER_KEY, String(min));
    live.send({ t: "timer", op: "start", min });
    closeTimer(keyed);
  }
  // Steuerung über den Server: die Anzeige folgt der Antwort (Durable Object), bei allen gleich
  function timerOp(op, min, e) {
    live.send(min === undefined ? { t: "timer", op } : { t: "timer", op, min });
    if (op === "stop") closeTimer(!!e && e.detail === 0);
  }
  // an das Beamerfenster: der Stand jetzt (es zählt selbst weiter)
  function sendTimer() { if (bc && beamers.size) try { bc.postMessage({ t: "timer", id: pid, at: claimAt, timer: tb.snapshot() }); } catch {} }
  // Ansicht einer Folie: Folienbild oder Codefolie (Folie 0, Platzhalterfolie, „Sitzungscode zeigen“ = asCode)
  const viewOf = (k, asCode) => (withCode && (asCode || k === 0 || holders.has(k))
    ? { kind: "code", code, title, lines: asCode || k === 0 ? [] : holders.get(k) || [] } : { kind: "img", src: urls[k - 1] });
  function put(box, v, im) {
    const keep = box === stage ? [tb.el] : [];   // das Band des Timers bleibt über der aktuellen Folie
    if (v.kind === "code") { box.replaceChildren(codeSlideDom(v), ...keep); return; }
    if (im.getAttribute("src") !== v.src) im.src = v.src;
    if (box.firstChild !== im || box.childNodes.length !== 1 + keep.length) box.replaceChildren(im, ...keep);
  }
  function paint() {
    const cv = viewOf(cur, peek), nx = nextSlideOf({ cur, n, peek, holders, withCode }), nv = nx.end ? null : viewOf(nx.k, false);
    put(stage, cv, img);
    counter.textContent = cur === 0 || peek ? "Sitzungscode" : cur + " / " + n;
    if (showNext) {
      npHead.replaceChildren(h("span", { class: "np-k", text: "Als Nächstes" }), " ", h("span", { class: "np-l", text: nextSlideLabel(nx, n) }));
      if (nv) put(npFrame, nv, npImg);
      else npFrame.replaceChildren(h("div", { class: "np-end", text: "Keine weitere Folie" }));
      npFrame.classList.toggle("end", !nv);
    }
    preload(cur + 1); preload(cur + 2); preload(cur - 1); paintMark(); paintCodeBtn(); paintNotes();
    sendShow(cv, nv);
  }
  function goto(k) {
    if (peek) { setPeek(false); return; }   // erst zurück von der eingeblendeten Codefolie
    k = Math.min(Math.max(first, k), n); if (k === cur) return; moved = true; cur = k; paint(); live.send({ t: "goto", slide: cur });
  }
  /* ---------- Beamerfenster (beamer.js): bekommt nur die aktuelle Folie, schickt Tasten zurück ---------- */
  function sendShow(cv = viewOf(cur, peek), nv) {
    if (!bc || !beamers.size) return;
    if (nv === undefined) { const nx = nextSlideOf({ cur, n, peek, holders, withCode }); nv = nx.end ? null : viewOf(nx.k, false); }
    const view = cv.kind === "img" ? { kind: "img", src: cv.src, next: nv && nv.kind === "img" ? nv.src : null } : { kind: "code", code: cv.code, title: cv.title, lines: cv.lines };
    try { bc.postMessage({ t: "show", id: pid, at: claimAt, fach: document.documentElement.dataset.fach || null, view, timer: tb.snapshot() }); } catch {}
  }
  const claim = () => { try { bc.postMessage({ t: "claim", id: pid, at: claimAt }); } catch {} };
  function paintBeam() {
    const note = beamOne ? beamerWindowNote(true, beamersN) : beamNote;   // ist schon ein Beamergerät verbunden, nennt der Hinweis es nicht mehr als Ausweg
    const t = beamers.size ? "Beamerfenster verbunden" + (note ? " · " + note : "") : note;
    if (beamState.textContent !== t) beamState.textContent = t;   // Live-Region: nur Änderungen ansagen
  }
  function openBeamer() {
    let w = null;
    try { w = window.open(location.pathname + location.search + "#/beamer", "unterricks-beamer", "popup=yes,width=1024,height=640"); } catch {}
    if (!w) {
      beamNote = "Beamerfenster blockiert – bitte Pop-up-Fenster für diese Seite erlauben und noch einmal öffnen."; beamOne = false; paintBeam();
      if (!isFs()) toast("Das Beamerfenster wurde blockiert. Bitte erlauben Sie Pop-up-Fenster für diese Seite und klicken Sie noch einmal auf „Beamerfenster öffnen“.", "err", 9000);
      return;
    }
    claimAt = Date.now(); claim();   // ein schon offenes Beamerfenster folgt jetzt dieser Präsentation
    try { w.focus(); } catch {}
    beamOne = !!(window.screen && window.screen.isExtended === false); beamNote = "";
    paintBeam();
  }
  if (bc) bc.onmessage = (ev) => {
    const m = ev.data;
    if (!m || typeof m !== "object" || typeof m.bid !== "string") return;
    if (m.t === "hello") claim();
    else if (m.t === "following") { const was = separate(); if (m.id === pid) { beamers.add(m.bid); sendShow(); } else beamers.delete(m.bid); paintBeam(); if (was && !separate()) showNotesHint(); paintNotes(); }
    else if (m.t === "bye") { const was = separate(); beamers.delete(m.bid); paintBeam(); if (was && !separate()) showNotesHint(); paintNotes(); }
    else if (m.t === "cmd" && m.id === pid && beamers.has(m.bid)) run(m.cmd);
  };
  const onHide = () => { if (bc) try { bc.postMessage({ t: "end", id: pid, why: "close" }); } catch {} };
  const onShow = (e) => { if (e.persisted && bc) { claimAt = Date.now(); claim(); } };   // aus dem Verlauf zurück: Beamerfenster wieder übernehmen
  // wieder sichtbar (z. B. nach der Bildschirmsperre des iPads): den Stand neu holen – sonst zeigte der Timer hier und im Beamerfenster bis zur
  // nächsten Nachricht die Restzeit von vor der Sperre (performance.now() zählt auf manchen Geräten im Ruhezustand nicht weiter)
  const onVis = () => { if (document.visibilityState === "visible") live.hello(); };
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFs() {
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const f = root.requestFullscreen || root.webkitRequestFullscreen; if (f) Promise.resolve(f.call(root)).catch(() => {}); }
  }
  function run(a) {
    if (a === "next") goto(cur + 1); else if (a === "prev") goto(cur - 1);
    else if (a === "first") goto(first); else if (a === "last") goto(n);
    else if (a === "code") { if (codeBtn) setPeek(!peek); }
    else if (a === "fs") toggleFs(); else if (a === "preview") setNext(!showNext);
    else if (a === "timer") openTimer();
  }
  // Enter/Leertaste auf einem Knopf der Leiste lösen den Knopf aus (Tastatur); nach einem Mausklick verliert der Knopf den Fokus wieder,
  // damit Leertaste und Presenter danach weiter blättern
  const onControl = (t) => !!(t && t.closest && root.contains(t) && t.closest("button, a[href], input, select, textarea"));
  const onKey = (e) => {
    if (!pairWrap.hidden) {   // Eingabefeld „Beamer verbinden“: Tasten gehören dem Feld (Pfeile, Rücktaste, Ziffern) – Esc schließt, Tab bleibt darin
      if (e.key === "Escape") { e.preventDefault(); closePair(true); } else if (e.key === "Tab") trapTab(e);
      return;
    }
    if (!tmWrap.hidden) {   // Feld „Timer“: Tasten gehören dem Feld (Ziffern, Enter startet) – Esc schließt, Tab bleibt darin
      if (e.key === "Escape") { e.preventDefault(); closeTimer(true); } else if (e.key === "Tab") trapTab(e, tmWrap);
      return;
    }
    // Notizen per Tastatur lesen: Pfeil hoch/runter rollen dort (Bild- und übrige Tasten blättern weiter, z. B. die eines Presenters)
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && notesBox.contains(e.target)) return;
    const a = presenterKey(e, onControl(e.target)); if (!a) return; if (a === "next" || a === "prev") e.preventDefault(); run(a);
  };
  let idleT = null;
  const wake = () => { root.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add("idle"), 2500); };
  let tx = null;
  stageCell.addEventListener("click", (e) => { const r = stageCell.getBoundingClientRect(); goto(e.clientX - r.left > r.width / 3 ? cur + 1 : cur - 1); });
  nextPane.addEventListener("click", () => goto(cur + 1));
  root.addEventListener("touchstart", (e) => { tx = dlgOpen() ? null : e.touches[0].clientX; }, { passive: true });
  root.addEventListener("touchend", (e) => { if (tx == null || dlgOpen()) { tx = null; return; } const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) goto(dx < 0 ? cur + 1 : cur - 1); tx = null; });
  root.addEventListener("mousemove", wake);
  root.addEventListener("focusin", wake);
  root.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("button"); if (b && e.detail > 0) b.blur(); });
  // nach einem Mausklick in die Notizen behalten sie den Fokus nicht (Leertaste und Presenter blättern weiter); Rollen mit Rad/Finger bleibt
  notesBox.addEventListener("click", (e) => { if (e.detail > 0 && document.activeElement === notesBox) notesBox.blur(); });
  document.addEventListener("keydown", onKey);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  document.addEventListener("visibilitychange", onVis);
  function end(stopForAll) {
    document.removeEventListener("keydown", onKey); clearTimeout(idleT); clearTimeout(devWaitT); clearTimeout(hintT); tb.stop();
    window.removeEventListener("pagehide", onHide); window.removeEventListener("pageshow", onShow); document.removeEventListener("visibilitychange", onVis);
    if (bc) { try { bc.postMessage({ t: "end", id: pid, why: stopForAll ? "stop" : "close" }); } catch {} bc.close(); }
    if (stopForAll) live.send({ t: "stop" });
    setTimeout(() => live.close(), stopForAll ? 400 : 0);
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(() => {});
    root.remove();
    if (stopForAll) toast("Die Live-Präsentation wurde für alle beendet.", "ok");
    if (onEnd) onEnd(stopForAll);   // baut die Seite dahinter evtl. neu (und setzt den Fokus dann selbst)
    if (back && back.isConnected && typeof back.focus === "function" && (!document.activeElement || document.activeElement === document.body)) try { back.focus({ preventScroll: true }); } catch {}
  }
  // Fokus in den Präsentationsmodus (Dialog) – nicht auf dem Knopf dahinter, sonst löste die Leertaste ihn erneut aus; danach zurück
  const back = document.activeElement;
  root.tabIndex = -1;
  document.body.append(root);
  try { root.focus({ preventScroll: true }); } catch {}
  paint(); paintInfo(); wake(); showNotesHint();
  // Vollbild muss direkt aus dem Klick heraus angefordert werden (Aufrufer ruft startPresenter im Klick-Handler auf)
  toggleFs();
  live.connect();
  // resume: läuft diese Präsentation schon, bleibt sie an der laufenden Stelle (neu gestartet beginnt sie mit der Codefolie)
  live.send({ t: "start", fileId: file.id, pages: n, slide: cur, resume: true, ...(withCode ? { code, title, codeSlides: [...holders].map(([k, lines]) => ({ n: k, lines })) } : {}) });
  if (bc) claim();   // ein schon offenes Beamerfenster übernimmt diese Präsentation
  return { end };
}

/* Sitzungscode groß für den Beamer – dieselbe Codefolie wie in der Präsentation (codeslide.js), mit QR-Code zu Unterricks
   (public/qr-unterricks.svg, erzeugt von scripts/qr-unterricks.mjs) */
export function showCode(code, title) {
  const root = h("div", { class: "codeshow", role: "dialog", "aria-label": "Sitzungscode" },
    codeSlideDom({ code, title }),
    h("button", { class: "btn cs-close", type: "button", onclick: () => close() }, "Schließen"));
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  document.body.append(root);
  const f = root.requestFullscreen || root.webkitRequestFullscreen; if (f) Promise.resolve(f.call(root)).catch(() => {});
}
export { clear, errToast };
