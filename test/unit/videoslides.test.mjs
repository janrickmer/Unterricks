// Videofolien (Nachtrag 38): YouTube-Video an der Stelle einer Folie eingebettet abspielen. Geprüft: Erkennen der unsichtbaren Zeile „Unterricks-Video: …“
// (auch in echten PDFs, mit pdf-lib erzeugt), Zeitangaben, Prüfen und Speichern (…/ready, PUT …/videos, …/slides, fileOut, Sitzungsdatei), der Stand im
// Durable Object (nur Lehrkraft und Beamer, nie Schüler:innen; Rückmeldung des Beamers an die Lehrkraft), das YouTube-Protokoll (postMessage), der Link für
// das Folienfenster nach der Stunde und der Präsentations-Prompt (wo das Video vorkommt, Link, Aufbau der Folie). Testdaten frei erfunden.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));

class FakeWs {
  constructor() { this.sent = []; this.closed = null; this.att = null; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att === null ? null : structuredClone(this.att); }
  send(m) { if (this.closed) throw new Error("geschlossen"); this.sent.push(m); }
  close(code, reason) { if (!this.closed) this.closed = { code, reason }; }
  msgs() { return this.sent.filter((x) => x !== "pong").map((x) => JSON.parse(x)); }
  last() { const m = this.msgs(); return m[m.length - 1]; }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWs(); this[1] = new FakeWs(); } };
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) {
    if (init && init.status === 101) { super(null, { status: 200 }); Object.defineProperty(this, "status", { value: 101 }); this.webSocket = init.webSocket; }
    else super(body, init);
  }
};

const { PDFDocument, StandardFonts, rgb, setTextRenderingMode } = await import("pdf-lib");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const S = await import("../../public/shared.js");
const V = await import("../../public/videoslides.js");
const { cleanSessionFile } = await import("../../public/sessionfile.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const F = await import("../../worker/files.js");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { COLUMNS } = await import("../../worker/db.js");
const { LiveRoom } = await import("../../worker/live.js");
const { LIVE_IDLE, liveReduce, liveVideo } = await import("../../worker/livestate.js");

const ID = "Fk1u8VKrJGA", ID2 = "M7lc1UVf-VE";

test("Zeitangaben: 1:30, 01:02:03, 90, 90s, 1m30s, „1:30 min“ – sonst null", () => {
  for (const [s, want] of [["1:30", 90], ["01:30", 90], ["0:05", 5], ["1:02:03", 3723], ["90", 90], ["90s", 90], ["90 s", 90], ["90 Sek.", 90], ["1m30s", 90], ["1h2m3s", 3723], ["2m", 120],
    ["1:30 min", 90], ["4:05 Min.", 245], ["0", 0], ["", null], ["1:75", null], ["abc", null], ["1:30:5", null], ["-5", null], ["24:00:00", null], [null, null], [90, null]])
    assert.equal(V.parseClock(s), want, JSON.stringify(s));
  assert.equal(V.fmtClock(245), "4:05"); assert.equal(V.fmtClock(3723), "1:02:03");
});

test("Marke „Unterricks-Video: …“: Link, Start, Ende und Titel; tolerant in der Schreibung, streng beim Link", () => {
  assert.deepEqual(V.parseVideoMark("Unterricks-Video: https://www.youtube.com/watch?v=" + ID + " | Start: 1:30 | Ende: 4:05 | Titel: Das Bundesverfassungsgericht"),
    { id: ID, start: 90, end: 245, title: "Das Bundesverfassungsgericht" });
  assert.deepEqual(V.parseVideoMark("Unterricks-Video: https://youtu.be/" + ID + "?t=42"), { id: ID, start: 42 }, "Start aus dem Link");
  assert.deepEqual(V.parseVideoMark("Unterricks-Video: https://youtu.be/" + ID + "?t=42 | Start: 0:10"), { id: ID, start: 10 }, "Start der Marke gilt vor dem Link");
  assert.deepEqual(V.parseVideoMark("unterricks video https://www.youtube.com/shorts/" + ID + " | titel: „Kurz“"), { id: ID, title: "Kurz" }, "andere Schreibung, Anführungszeichen weg");
  assert.deepEqual(V.parseVideoMark("U n t e r r i c k s - V i d e o : https://www.youtube-nocookie.com/embed/" + ID + " | Ende: 30"), { id: ID, end: 30 }, "gesperrt gesetzt");
  assert.deepEqual(V.parseVideoMark("Unterricks–Video：https://www.youtube.com/watch?v=" + ID + " | Ende: 0:20 | Start: 0:30"), { id: ID, start: 30 }, "Ende vor dem Start entfällt");
  assert.deepEqual(V.parseVideoMark("Unterricks-Video: https://www.youtube.com/watch?v=Fk1u8 VKrJGA"), { id: ID }, "von PDF.js mit Leerzeichen zerlegter Link");
  assert.deepEqual(V.parseVideoMark("Unterricks-Video: https://www.youtube.com/watch?v=" + ID + " | Farbe: rot | Start: soon"), { id: ID }, "Unbekanntes und Unlesbares entfallen");
  for (const bad of ["Unterricks-Video: https://vimeo.com/123", "Unterricks-Video:", "Unterricks-Video: https://www.youtube.com/playlist?list=PL1", "Video: https://youtu.be/" + ID,
    "Unterricks-Phase: 3", "", null]) assert.equal(V.parseVideoMark(bad), null, String(bad));
  // die Zeile aus dem Prompt wird genau so wieder gelesen
  for (const v of [{ id: ID }, { id: ID2, start: 30 }, { id: ID, start: 90, end: 245, title: "Wahlen | einfach?" }]) {
    const back = V.parseVideoMark(V.videoMarkLine(v));
    assert.deepEqual(back, v.title && v.title.includes("|") ? { ...v, title: "Wahlen" } : v, V.videoMarkLine(v));
  }
});

// Textstücke einer echten PDF wie presenter.js (pageItems)
async function pdfLines(bytes, scale = 2) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), vp = page.getViewport({ scale }), tc = await page.getTextContent();
    const items = tc.items.filter((it) => typeof it.str === "string").map((it) => {
      const tx = pdfjs.Util.transform(vp.transform, it.transform), hgt = Math.hypot(tx[2], tx[3]);
      return { str: it.str, x: tx[4], base: tx[5], w: it.width * scale, h: hgt, eol: !!it.hasEOL };
    });
    out.push({ lines: S.slideTextLines(items), items });
  }
  await doc.destroy();
  return out;
}
// Präsentation wie von Claude: Folie 1 Titel, Folie 2 Videofolie (Titel, Link, Ausschnitt, Marke mit Titel), Folie 3 Videofolie ohne Titel in der Marke,
// Folie 4 nur ein sichtbarer Link (keine Videofolie)
async function deck(mode) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold), bg = rgb(0.12, 0.2, 0.38), white = rgb(1, 1, 1);
  const mark = (p, text) => {
    if (mode === "invisible") { p.pushOperators(setTextRenderingMode(3)); p.drawText(text, { x: 20, y: 6, size: 8, font: f }); p.pushOperators(setTextRenderingMode(0)); }
    else p.drawText(text, { x: 2, y: 1, size: 1.5, font: f, color: bg });
  };
  const slide = (lines) => { const p = d.addPage([960, 540]); p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg }); lines.forEach(([t, y, s, font]) => p.drawText(t, { x: 60, y, size: s, font: font || f, color: white })); return p; };
  mark(slide([["Wahlen in Deutschland", 300, 48, b]]), "Unterricks-Phase: 1");
  const v = slide([["Video: Wahlen einfach erklärt", 420, 40, b], ["https://www.youtube.com/watch?v=" + ID, 340, 22], ["Ausschnitt: 0:30–1:15", 300, 22]]);
  mark(v, "Unterricks-Phase: 2"); mark(v, V.videoMarkLine({ id: ID, start: 30, end: 75, title: "Wahlen einfach erklärt" }));
  const w = slide([["Video: Das Wahlsystem", 420, 40, b], ["https://youtu.be/" + ID2, 340, 22]]);
  mark(w, "Unterricks-Video: https://youtu.be/" + ID2);
  slide([["Weiterlesen: https://www.youtube.com/watch?v=" + ID, 300, 24]]);
  return d.save();
}
test("echte PDF: Videofolien aus der unsichtbaren Zeile (Textdarstellungsmodus 3 bzw. winzig in Hintergrundfarbe); Titel sonst aus der Überschrift", async () => {
  for (const mode of ["invisible", "bg"]) {
    const pages = await pdfLines(await deck(mode));
    const got = pages.map((p) => V.videoMarkOf(p.lines, p.items));
    assert.deepEqual(got, [null, { id: ID, start: 30, end: 75, title: "Wahlen einfach erklärt" }, { id: ID2, title: "Das Wahlsystem" }, null], mode);
    assert.deepEqual(pages.map((p) => S.phaseMarkOf(p.lines, p.items)), [1, 2, null, null], mode + ": die Phase bleibt lesbar");
    assert.equal(S.codeSlideLines(pages[1].lines, 1080), null, mode + ": keine Codefolie");
  }
  assert.equal(V.slideTitleOf([{ text: "Unterricks-Phase: 2", h: 3, base: 1070 }, { text: "„Wahlen“", h: 80, base: 200 }, { text: "https://youtu.be/" + ID, h: 40, base: 300 }]), "Wahlen");
  assert.equal(V.slideTitleOf([{ text: "Film – Die Wahl", h: 60, base: 100 }, { text: "zur Bundestagswahl", h: 58, base: 160 }, { text: "klein", h: 10, base: 400 }]), "Die Wahl zur Bundestagswahl", "umbrochen");
  assert.equal(V.slideTitleOf([]), "");
});

test("Videofolien prüfen: Folie 1…Seitenzahl, je Folie eine, gültige Kennung; streng (Lehrkraft) bzw. nachsichtig (PDF); gespeichert {pdf, hand}", () => {
  const raw = [{ n: 3, id: ID, start: 0, end: 60, title: "  Ein   Titel ", extra: 1 }, { n: 1, id: ID2, start: 30 }, { n: 3, id: ID2 }, { n: 9, id: ID }, { n: 2, id: "kurz" }, "x", { n: 2, id: ID, start: 50, end: 40 }];
  assert.deepEqual(V.cleanVideoSlides(raw, 5), [{ n: 1, id: ID2, start: 30 }, { n: 2, id: ID, start: 50 }, { n: 3, id: ID, end: 60, title: "Ein Titel" }]);
  assert.equal(V.cleanVideoSlides(raw, 5, true), undefined, "streng: ein ungültiger Eintrag → undefined");
  assert.deepEqual(V.cleanVideoSlides([], 5, true), [], "[] = bewusst keine");
  assert.deepEqual(V.cleanVideoSlides("x", 5), []); assert.equal(V.cleanVideoSlides("x", 5, true), undefined);
  assert.equal(V.cleanVideoSlides(Array.from({ length: 61 }, (_, i) => ({ n: i + 1, id: ID })), 300, true), undefined, "höchstens 60");
  assert.deepEqual(V.videoSlidesData(JSON.stringify({ v: 1, pdf: [{ n: 2, id: ID }], hand: [] }), 3), { pdf: [{ n: 2, id: ID }], hand: [] });
  assert.deepEqual(V.videoSlidesData("kaputt", 3), { pdf: null, hand: null });
  assert.deepEqual(V.videoSlidesData(JSON.stringify({ pdf: [{ n: 5, id: ID }] }), 3), { pdf: null, hand: null }, "Folien jenseits der Seitenzahl entfallen");
  assert.deepEqual(V.videoSlidesOf({ videos: { pdf: [{ n: 2, id: ID }], hand: null } }), [{ n: 2, id: ID }]);
  assert.deepEqual(V.videoSlidesOf({ videos: { pdf: [{ n: 2, id: ID }], hand: [] } }), [], "die Lehrkraft gilt vor der PDF – auch „keine“");
  assert.deepEqual(V.videoSlidesOf(null), []);
  assert.equal(V.videoSlidesStore({ pdf: null, hand: null }), null);
  assert.deepEqual(V.videoAt([{ n: 2, id: ID }], 2), { n: 2, id: ID }); assert.equal(V.videoAt([{ n: 2, id: ID }], 3), null);
});

test("Adressen: nur aus der geprüften Kennung – youtube.com zum Öffnen, youtube-nocookie.com für den Player (Steuerung, Ausschnitt, Herkunft)", () => {
  assert.equal(V.videoWatchUrl({ id: ID }), "https://www.youtube.com/watch?v=" + ID);
  assert.equal(V.videoWatchUrl({ id: ID, start: 90, end: 120 }), "https://www.youtube.com/watch?v=" + ID + "&t=90s");
  assert.equal(V.videoPlayerUrl({ id: ID, start: 90, end: 245 }, "https://unterricks.janrickmer.de"),
    "https://www.youtube-nocookie.com/embed/" + ID + "?enablejsapi=1&autoplay=1&playsinline=1&rel=0&start=90&end=245&origin=https%3A%2F%2Funterricks.janrickmer.de");
  assert.equal(V.videoPlayerUrl({ id: ID }, "null"), "https://www.youtube-nocookie.com/embed/" + ID + "?enablejsapi=1&autoplay=1&playsinline=1&rel=0", "ohne gültige Herkunft keine");
  assert.equal(V.videoClipText({ id: ID, start: 90, end: 245 }), "Ausschnitt 1:30–4:05");
  assert.equal(V.videoClipText({ id: ID, start: 90 }), "ab 1:30"); assert.equal(V.videoClipText({ id: ID, end: 60 }), "bis 1:00"); assert.equal(V.videoClipText({ id: ID }), "");
  assert.equal(V.videoName({ id: ID, title: "X" }), "X"); assert.equal(V.videoName({ id: ID }), "Video");
});

test("YouTube-Protokoll (postMessage, wie die IFrame-API): Anmelden, Befehle, Rückmeldungen als JSON-Text", () => {
  assert.deepEqual(JSON.parse(V.ytListen()), { event: "listening", id: 1, channel: "widget" });
  assert.deepEqual(JSON.parse(V.ytCommand("seekTo", [42, true])), { event: "command", func: "seekTo", args: [42, true], id: 1, channel: "widget" });
  const s = { ready: false, state: -1, time: 0, dur: 0, err: null };
  // so antwortet der Player von youtube-nocookie.com (beobachtet am 17.11.2026): JSON-Text
  assert.equal(V.ytApply(s, V.ytRead('{"event":"initialDelivery","info":{"apiInterface":["playVideo"],"playerState":-1,"currentTime":30,"duration":1344},"id":1,"channel":"widget"}')), true);
  assert.deepEqual(s, { ready: true, state: -1, time: 30, dur: 1344, err: null });
  V.ytApply(s, V.ytRead('{"event":"onReady","id":1,"channel":"widget"}'));
  V.ytApply(s, V.ytRead({ event: "infoDelivery", info: { playerState: 1, currentTime: 31.5 } }));
  assert.deepEqual([s.state, s.time], [1, 31.5]);
  V.ytApply(s, V.ytRead('{"event":"onStateChange","info":2}')); assert.equal(s.state, 2);
  V.ytApply(s, V.ytRead('{"event":"onError","info":150}')); assert.equal(s.err, 150);
  assert.equal(V.ytApply(s, V.ytRead('{"event":"infoDelivery","info":{"playerState":9,"currentTime":-3}}')), false, "Unsinn ändert nichts");
  for (const bad of ["kein json", "{}", '{"event":3}', 42, null, "x".repeat(200001)]) assert.equal(V.ytRead(bad), null);
  assert.match(V.ytErrorText(150), /darf laut YouTube nicht eingebettet werden/); assert.match(V.ytErrorText(100), /nicht \(mehr\)/);
  // Rückmeldung eines Beamers: nur bekannte Felder, Zahlen begrenzt
  assert.deepEqual(V.cleanVideoReport({ n: 2, id: ID, rev: 3, state: 1, time: 12.345, dur: 600, blocked: true, err: 150, noapi: false, muted: true, x: "<b>" }),
    { n: 2, id: ID, rev: 3, state: 1, time: 12.3, dur: 600, blocked: true, err: 150, noapi: false, muted: true });
  for (const bad of [{ n: 0, id: ID, rev: 1 }, { n: 2, id: "x", rev: 1 }, { n: 2, id: ID }, null]) assert.equal(V.cleanVideoReport(bad), null);
  assert.deepEqual(V.cleanVideoReport({ n: 2, id: ID, rev: 1, state: 7, time: -1 }), { n: 2, id: ID, rev: 1, state: -1, time: null, dur: null, blocked: false, err: null, noapi: false, muted: false });
});

test("gewünschter Stand: Stelle rechnet ab dem Empfang weiter, nie hinter das Ende des Ausschnitts", () => {
  const vs = V.cleanVideoState({ n: 2, id: ID, start: 30, end: 75, playing: true, pos: 40, rev: 4, extra: 1 });
  assert.deepEqual(vs, { n: 2, id: ID, start: 30, end: 75, playing: true, pos: 40, rev: 4 });
  assert.equal(V.videoPosNow({ ...vs, at: 1000 }, 6000), 45);
  assert.equal(V.videoPosNow({ ...vs, at: 1000 }, 100000), 75, "nicht über das Ende");
  assert.equal(V.videoPosNow({ ...vs, playing: false, at: 1000 }, 6000), 40, "pausiert bleibt die Stelle");
  assert.equal(V.cleanVideoState({ n: 2, id: ID, playing: true, pos: 400, rev: 1, end: 60 }).pos, 60);
  for (const bad of [{ n: 2, id: ID, playing: true }, { n: 0, id: ID, rev: 1 }, { n: 2, id: "x", rev: 1 }, null]) assert.equal(V.cleanVideoState(bad), null);
  assert.equal(V.videoKey({ n: 2, id: ID, rev: 4 }), "2|" + ID + "|4");
});

/* ---------- Durable Object ---------- */
function roomCtx() {
  const data = new Map(), socks = [];
  return { socks, data,
    storage: { get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : undefined), put: async (k, v) => { data.set(k, structuredClone(v)); } },
    acceptWebSocket(ws, tags) { socks.push({ ws, tags, gone: false }); },
    getWebSockets(tag) { return socks.filter((s) => !s.gone && (!tag || s.tags.includes(tag))).map((s) => s.ws); },
    getTags(ws) { const s = socks.find((x) => x.ws === ws); return s ? s.tags : []; },
    setWebSocketAutoResponse() {} };
}
async function join(room, role, gen) {
  const res = await room.fetch(new Request("https://live/ws?role=" + role + (gen !== undefined ? "&gen=" + gen + "&exp=4000000000000" : ""), { headers: { Upgrade: "websocket" } }));
  assert.equal(res.status, 101);
  return room.ctx.socks[room.ctx.socks.length - 1].ws;
}
const FILE = "0123456789abcdef";
const setMsg = (extra = {}) => ({ t: "video", op: "set", n: 2, video: { id: ID, start: 30, end: 75, title: "Wahlen" }, playing: true, pos: 30, rev: 1, ...extra });

test("Live-Stand: Video nur auf der aktuellen Folie (keine Codefolie); Folienwechsel, Codefolie und Beenden schließen es; v bleibt", () => {
  const st = { ...LIVE_IDLE };
  liveReduce(st, { t: "start", fileId: FILE, pages: 4, slide: 0, code: "K7QM4X", title: "T", codeSlides: [{ n: 3, lines: [] }] }, 1000);
  assert.equal(liveReduce(st, setMsg(), 2000), false, "Folie 0 (Codefolie) – nicht Folie 2");
  liveReduce(st, { t: "goto", slide: 2 }, 3000);
  const v0 = st.v;
  assert.equal(liveReduce(st, setMsg(), 4000), true);
  assert.equal(st.v, v0, "v bleibt (das Folienbild ändert sich nicht)");
  assert.deepEqual(liveVideo(st, 14000), { n: 2, id: ID, start: 30, end: 75, title: "Wahlen", playing: true, pos: 40, rev: 1 }, "Stelle zum Sendezeitpunkt");
  assert.equal(liveReduce(st, setMsg({ playing: false, pos: 41, rev: 2 }), 15000), true);
  assert.deepEqual([liveVideo(st, 99000).playing, liveVideo(st, 99000).pos, liveVideo(st, 99000).rev], [false, 41, 2]);
  assert.equal(liveReduce(st, setMsg({ rev: undefined }), 16000), true); assert.equal(st.video.rev, 3, "ohne rev zählt der Server weiter");
  for (const bad of [setMsg({ n: 3 }), setMsg({ video: { id: "x" } }), setMsg({ playing: "ja" }), { t: "video", op: "play", n: 2 }, { t: "video", op: "close", n: 2, video: null }]) {
    const before = JSON.stringify(st.video);
    if (bad.op !== "close") assert.equal(liveReduce(st, bad, 17000), false, JSON.stringify(bad));
    else { liveReduce(st, bad, 17000); assert.equal(st.video, null, "close schließt"); liveReduce(st, setMsg({ rev: 5 }), 17000); }
    if (bad.op !== "close") assert.equal(JSON.stringify(st.video), before);
  }
  liveReduce(st, { t: "code", on: true }, 18000); assert.equal(st.video, null, "„Sitzungscode zeigen“ beendet das Video");
  liveReduce(st, { t: "code", on: false }, 18500); liveReduce(st, setMsg({ rev: 6 }), 19000);
  liveReduce(st, { t: "goto", slide: 3 }, 20000); assert.equal(st.video, null, "Folienwechsel beendet es");
  liveReduce(st, { t: "goto", slide: 2 }, 21000); liveReduce(st, setMsg({ rev: 7 }), 22000);
  assert.equal(liveReduce(st, { t: "goto", slide: 3 }, 23000) && liveReduce(st, setMsg({ n: 3, rev: 8 }), 24000), false, "Platzhalterfolie (Codefolie): kein Video");
  liveReduce(st, { t: "goto", slide: 2 }, 25000); liveReduce(st, setMsg({ rev: 9 }), 26000);
  liveReduce(st, { t: "start", fileId: FILE, pages: 4, slide: 2, code: "K7QM4X", resume: true }, 27000);
  assert.equal(st.video && st.video.rev, 9, "erneut geöffnet (resume, dieselbe Folie): das Video läuft weiter");
  liveReduce(st, { t: "start", fileId: FILE, pages: 4, slide: 2, code: "K7QM4X" }, 28000);
  assert.equal(st.video, null, "neu gestartet: kein Video");
  liveReduce(st, setMsg({ rev: 10 }), 29000); liveReduce(st, { t: "stop" }, 30000);
  assert.deepEqual([st.video, st.vrev], [null, 10], "Beenden: kein Video, vrev bleibt monoton");
});

test("Durable Object: Video geht an Lehrkraft und Beamer, nie an Schüler:innen (die bekommen nicht einmal eine Nachricht); Rückmeldung des Beamers nur an die Lehrkraft", async () => {
  const room = new LiveRoom(roomCtx(), { SETTINGS_SECRET: "nur-test-geheimnis" });
  const t = await join(room, "teacher"), s = await join(room, "student"), b = await join(room, "beamer", 0);
  await room.webSocketMessage(t, JSON.stringify({ t: "start", fileId: FILE, pages: 4, slide: 2, code: "K7QM4X", title: "T" }));
  const sBefore = s.sent.length;
  await room.webSocketMessage(t, JSON.stringify(setMsg()));
  assert.equal(s.sent.length, sBefore, "Schüler:innen bekommen bei Befehlen zum Video keine Nachricht");
  assert.deepEqual([b.last().video.id, b.last().video.playing, b.last().video.rev], [ID, true, 1]);
  assert.equal(t.last().video.id, ID);
  assert.ok(!s.sent.some((m) => m.includes('"video"')), "nie ein Feld video bei den Schüler:innen");
  const polled = await (await room.fetch(new Request("https://live/state?role=student"))).json();
  assert.equal(polled.video, undefined, "auch nicht beim Abfragen");
  assert.equal((await (await room.fetch(new Request("https://live/state?role=beamer&gen=0"))).json()).video.id, ID, "der Beamer schon (Rückfall ohne WebSocket)");
  // Rückmeldung des Beamers: geprüft an die Lehrkraft, nicht an die Schüler:innen, nicht gespeichert
  const tBefore = t.sent.length;
  await room.webSocketMessage(b, JSON.stringify({ t: "vstate", n: 2, id: ID, rev: 1, state: 1, time: 31.26, dur: 600, blocked: false, x: "<b>" }));
  assert.deepEqual(t.last(), { t: "vstate", n: 2, id: ID, rev: 1, state: 1, time: 31.3, dur: 600, blocked: false, err: null, noapi: false, muted: false });
  assert.equal(t.sent.length, tBefore + 1);
  assert.ok(!s.sent.some((m) => m.includes("vstate")));
  for (const bad of ["kein json", JSON.stringify({ t: "goto", slide: 4 }), JSON.stringify({ t: "vstate", n: 2, id: "x", rev: 1 }), "x".repeat(3000)]) await room.webSocketMessage(b, bad);
  assert.equal(t.sent.length, tBefore + 1, "Ungültiges wird nicht weitergereicht; ein Beamer steuert nichts");
  assert.equal((await room.state()).slide, 2);
  await room.webSocketMessage(s, JSON.stringify(setMsg({ rev: 9 })));
  assert.equal((await room.state()).video.rev, 1, "Schüler:innen können kein Video steuern");
  await room.webSocketMessage(s, JSON.stringify({ t: "vstate", n: 2, id: ID, rev: 1, state: 2 }));
  assert.equal(t.sent.length, tBefore + 1, "… und nichts melden");
  await room.webSocketMessage(t, JSON.stringify({ t: "video", op: "close" }));
  assert.equal(b.last().video, undefined, "geschlossen: kein Video mehr am Beamer");
});

/* ---------- Server: Speichern, Lehrkraft, Folienfenster ---------- */
const TOKEN = "lehrkraft-token-videos", STOKEN = "schueler-token-videos", DEV = "dddddddddddddddd";
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + tok, "Content-Type": raw ? (/\/slides\//.test(path) ? "image/jpeg" : "application/pdf") : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : res }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN);
async function setup(pages = 4) {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8C", title: "Wahlen", date: new Date(c.now - 2 * 864e5).toISOString().slice(0, 10), startTime: "08:00", durationMin: 90 }, c.now - 864e5);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, '8C', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  c.db.raw.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, l.id, c.now - 600e3);
  const up = await call(c, F.routePresentationUpload, "POST", "/api/teacher/lessons/" + l.id + "/presentation?name=W.pdf", new Uint8Array(await deck("invisible")), l.id);
  const fid = up.data.file.id;
  for (let n = 1; n <= pages; n++) await call(c, F.routeSlideUpload, "PUT", "/api/teacher/files/" + fid + "/slides/" + n + "?w=1920&h=1080", new Uint8Array([0xff, 0xd8, n]), fid, String(n));
  return { c, l, fid };
}
const ready = (c, fid, body) => call(c, F.routePresentationReady, "POST", "/x", body, fid);
const videosPut = (c, fid, body) => call(c, F.routeVideosPut, "PUT", "/x", body, fid);
const VIDS = [{ n: 2, id: ID, start: 30, end: 75, title: "Wahlen einfach erklärt" }, { n: 3, id: ID2, title: "Das Wahlsystem" }];

test("Server: neue Spalte files.video_slides (additiv); …/ready speichert die Videofolien der PDF, …/slides und fileOut liefern sie", async () => {
  assert.ok(COLUMNS.some(([t, col, def]) => t === "files" && col === "video_slides" && def === "TEXT"));
  const { c, l, fid } = await setup();
  let r = await ready(c, fid, { pages: 4, codeSlides: [], videos: [...VIDS, { n: 9, id: ID }, { n: 1, id: "kaputt" }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.file.videos, { pdf: VIDS, hand: null }, "aus der PDF nachsichtig: Ungültiges entfällt");
  assert.deepEqual((await call(c, F.routeTeacherSlides, "GET", "/x", undefined, fid)).data.videos, { pdf: VIDS, hand: null });
  assert.deepEqual((await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.files.find((f) => f.area === "presentation").videos.pdf, VIDS, "GET lesson (FILE_COLS)");
  assert.deepEqual((await ready(c, fid, { pages: 4, codeSlides: [] })).data.file.videos.pdf, VIDS, "ältere offene Seite ohne das Feld: bleibt");
  assert.deepEqual((await ready(c, fid, { pages: 4, codeSlides: [], videos: [] })).data.file.videos, { pdf: null, hand: null }, "neue PDF ohne Videofolien");
  assert.equal(c.db.raw.prepare("SELECT video_slides FROM files WHERE id=?").get(fid).video_slides, null);
  // von der Lehrkraft (Sitzungsdatei): streng; [] = bewusst keine
  assert.deepEqual((await ready(c, fid, { pages: 4, codeSlides: [], videos: VIDS, videosHand: [] })).data.file.videos, { pdf: VIDS, hand: [] });
  assert.equal((await ready(c, fid, { pages: 4, codeSlides: [], videos: VIDS, videosHand: [{ n: 9, id: ID }] })).status, 400);
});

test("Server: PUT …/videos – Videofolien der Lehrkraft (gelten vor der PDF), zurück zur PDF; geprüft; nur angemeldet", async () => {
  const { c, fid } = await setup();
  await ready(c, fid, { pages: 4, codeSlides: [], videos: VIDS });
  let r = await videosPut(c, fid, { hand: [{ n: 4, id: ID, start: 10, title: "Neu" }] });
  assert.deepEqual([r.status, r.data.file.videos], [200, { pdf: VIDS, hand: [{ n: 4, id: ID, start: 10, title: "Neu" }] }]);
  r = await videosPut(c, fid, { hand: [] });
  assert.deepEqual(r.data.file.videos, { pdf: VIDS, hand: [] }, "keine Videofolien – bewusst");
  r = await videosPut(c, fid, { hand: null });
  assert.deepEqual(r.data.file.videos, { pdf: VIDS, hand: null }, "wieder die aus der PDF");
  for (const bad of [{}, { hand: "x" }, { hand: [{ n: 5, id: ID }] }, { hand: [{ n: 2, id: ID }, { n: 2, id: ID2 }] }, { hand: [{ n: 2, id: "https://youtu.be/" + ID }] }, { hand: [{ n: 2, id: ID, start: 40, end: 30 }] }]) {
    r = await videosPut(c, fid, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.match((await videosPut(c, fid, { hand: [{ n: 5, id: ID }] })).data.error, /Ungültige Videofolien/);
  assert.equal((await callAs("falsch")(c, F.routeVideosPut, "PUT", "/x", { hand: null }, fid)).status, 401);
  assert.equal((await scall(c, F.routeVideosPut, "PUT", "/x", { hand: null }, fid)).status, 401, "nicht mit dem Token von Schüler:innen");
});

test("Folienfenster nach der Stunde: zur Videofolie der Link zu YouTube (mit Titel und Ausschnitt) – sonst nichts über Videos für Schüler:innen", async () => {
  const { c, l, fid } = await setup();
  await ready(c, fid, { pages: 4, codeSlides: [], videos: VIDS });
  const r = await scall(c, ST.routeStudentPresentationSlides, "POST", "/x", { from: 1, to: 4 }, l.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.slides.map((x) => x.video || null), [null, { url: "https://www.youtube.com/watch?v=" + ID + "&t=30s", title: "Wahlen einfach erklärt", clip: "Ausschnitt 0:30–1:15" },
    { url: "https://www.youtube.com/watch?v=" + ID2, title: "Das Wahlsystem", clip: "" }, null]);
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/x", undefined, l.id);
  assert.ok(!JSON.stringify(sv.data).includes(ID) && !JSON.stringify(sv.data).includes("video"), "die Sitzungsansicht nennt keine Videos");
  // markierte letzte gezeigte Folie: nur bis dorthin (die Videofolie 3 liegt dahinter)
  c.db.raw.prepare("UPDATE files SET shown_until=2, cut_size=10 WHERE id=?").run(fid);
  const cut = await scall(c, ST.routeStudentPresentationSlides, "POST", "/x", { from: 1, to: 4 }, l.id);
  assert.deepEqual(cut.data.slides.map((x) => x.n), [1, 2]);
});

test("Sitzungsdatei: die Videofolien der Lehrkraft (slideVideos) kommen mit – geprüft, nur an der Präsentation", () => {
  const base = { kind: "unterricks-sitzung", v: 1, source: {}, lesson: {}, chat: [], drafts: [], sheets: [], notes: [] };
  const d = cleanSessionFile({ ...base, files: [{ area: "presentation", kind: "file", name: "P.pdf", path: "dateien/1 - P.pdf", slideVideos: [{ n: 2, id: ID, start: 30, x: 1 }, { n: 0, id: ID }] },
    { area: "student", kind: "file", name: "A.pdf", path: "dateien/2 - A.pdf", slideVideos: [{ n: 1, id: ID }] }, { area: "presentation", kind: "file", name: "Q.pdf", path: "dateien/3 - Q.pdf", slideVideos: [] },
    { area: "presentation", kind: "file", name: "R.pdf", path: "dateien/4 - R.pdf" }] });
  assert.deepEqual(d.files[0].slideVideos, [{ n: 2, id: ID, start: 30 }]);
  assert.equal(d.files[1].slideVideos, undefined, "nur an der Präsentation");
  assert.deepEqual(d.files[2].slideVideos, [], "[] = bewusst keine");
  assert.equal(d.files[3].slideVideos, undefined, "ältere Datei: die Videofolien der PDF gelten");
});

/* ---------- Präsentations-Prompt ---------- */
const PORTAL = "**1) Einstieg**\n- Karikatur ~~Wer wählt?~~\n\n**2) Video: Wahlen einfach erklärt**\n- Video: https://www.youtube.com/watch?v=" + ID + "&feature=youtu.be (0:30–1:15)\n" +
  "- Beobachtungsauftrag ~~Wer darf wählen?~~\n\n**3) Partnerarbeit**\n- ~~Das Wahlsystem~~ https://youtu.be/" + ID2 + "?t=90\n- noch einmal: https://youtu.be/" + ID2 + "?t=90\n\n--> Nächste Stunde\n\n**4) Diskussion**\n- https://example.org/text";
test("Präsentations-Prompt: Videos aus dem Schulportal-Eintrag (mit Phase und Ausschnitt) und den Links der Sitzung – mit Link, Stelle und genauem Aufbau der Videofolie", () => {
  const vids = V.lessonVideos(PORTAL, [{ kind: "link", name: "Erklärfilm Bundestag", text: "https://www.youtube.com/watch?v=abcdefghijk" }, { kind: "link", name: "Doppelt", text: "https://youtu.be/" + ID },
    { kind: "link", name: "Text", text: "https://example.org/" }, { kind: "file", name: "M1.pdf", text: "https://youtu.be/zzzzzzzzzzz" }]);
  assert.deepEqual(vids, [
    { id: ID, start: 30, end: 75, title: "Wahlen einfach erklärt", phase: 2, phaseLabel: "2) Video: Wahlen einfach erklärt", source: "portal" },
    { id: ID2, start: 90, title: "Das Wahlsystem", phase: 3, phaseLabel: "3) Partnerarbeit", source: "portal" },
    { id: "abcdefghijk", title: "Erklärfilm Bundestag", phase: null, phaseLabel: "", source: "link" },
    { id: ID, title: "Doppelt", phase: null, phaseLabel: "", source: "link" }]);
  const sec = V.videoPromptSection(vids);
  for (const t of ["## Videofolien: YouTube-Videos eingebettet abspielen", "auf den Geräten der Schüler:innen erscheint dabei nur die Folie selbst",
    "- Video 1 – in Phase 2 („2) Video: Wahlen einfach erklärt“)", "https://www.youtube.com/watch?v=" + ID + ", Ausschnitt 0:30–1:15",
    "unsichtbare Zeile auf dieser Folie: Unterricks-Video: https://www.youtube.com/watch?v=" + ID + " | Start: 0:30 | Ende: 1:15 | Titel: Wahlen einfach erklärt",
    "- Video 2 – in Phase 3", "Unterricks-Video: https://www.youtube.com/watch?v=" + ID2 + " | Start: 1:30 | Titel: Das Wahlsystem",
    "- Video 3 – ohne festen Platz im Stundenverlauf (Link der Sitzung „Erklärfilm Bundestag“)", "ganzes Video",
    "oben groß „Video: <Titel des Videos>“", "als anklickbarer Link (Link-Anmerkung auf dieselbe Adresse)", "kein Vorschaubild, kein Screenshot und kein Logo von YouTube, kein QR-Code",
    "Textdarstellungsmodus 3", "„Unterricks-Phase: n“", "erfinde keine Videos und keine Links"]) assert.ok(sec.includes(t), t);
  assert.ok(!V.videoPromptSection(vids, { analog: true }).includes("Geräten der Schüler:innen"), "Jg. 5/6: keine iPads im Unterricht");
  assert.equal(V.videoPromptSection([]), "", "ohne Videos kein Abschnitt");
  // jede Zeile, die der Prompt vorgibt, erkennt Unterricks wieder
  for (const line of sec.split("\n").filter((x) => x.includes("unsichtbare Zeile auf dieser Folie: "))) assert.ok(V.parseVideoMark(line.split(": ").slice(1).join(": ")), line);
  // eingebaut in den Präsentations-Prompt (session.js übergibt ctx.videoSection)
  const ctx = { lessonId: "a".repeat(16), subject: "powi", klass: "8C", lesson: { title: "Wahlen", topic: "Wahlen", durationMin: 45 }, materials: [], sheets: [] };
  const p = S.claudePresentationPrompt({ ...ctx, videoSection: sec }, PORTAL, []);
  assert.ok(p.includes(sec) && p.indexOf(sec) < p.indexOf("## Zeitlos gestalten"), "der Abschnitt steht vor „Zeitlos gestalten“");
  assert.ok(p.includes("YouTube-Videos nur als Videofolie (siehe oben); andere Links"));
  const p0 = S.claudePresentationPrompt(ctx, "**1) Einstieg**\n- Karikatur", []);
  assert.ok(!p0.includes("Videofolie") && !p0.includes("Unterricks-Video"), "ohne Videos bleibt der Prompt wie bisher");
});
