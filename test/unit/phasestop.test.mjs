// Zwischenstopp aus der Präsentation (Nachtrag 34): Phase jeder Folie aus der unsichtbaren Zeile „Unterricks-Phase: n“ lesen (public/shared.js
// phaseMarkOf, nie in der Überschrift einer Codefolie), daraus den Zwischenstopp im Schulportal-Eintrag bestimmen (stopForShown – Regel der Lehrkraft
// „vor diese Phase“), speichern am Server (…/ready, PUT …/phases, …/slides, fileOut; nie für Schüler:innen), Sitzungsdatei. Test-PDFs mit pdf-lib (frei erfunden).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));
const PL = await import("pdf-lib");
const { PDFDocument, StandardFonts, rgb, setTextRenderingMode } = PL;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const S = await import("../../public/shared.js");
const { cleanSessionFile } = await import("../../public/sessionfile.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const F = await import("../../worker/files.js");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { COLUMNS } = await import("../../worker/db.js");

const piece = (str, x, base, h, extra = {}) => ({ str, x, base, w: str.length * h * 0.5, h, eol: false, ...extra });
const PORTAL = "**1) Einstieg**\n- Karikatur\n\n**2) Partnerarbeit**\n- Feibeitsblatt ~~Die wehrhafte Demokratie~~\n\n**3) Sicherung**\n- Tafelbild\n\n--> Nächste Stunde\n\n**4) Diskussion**\n- Argumentationswippe";
const stopBefore = (text) => { const l = text.split("\n"), i = l.indexOf(S.STOP_LINE); return i < 0 ? null : l.slice(i + 1).find((x) => x.trim()); };

/* ---------- Phase lesen ---------- */
test("Phase der Folie lesen: Groß-/Kleinschreibung, Leerraum, gesperrt, auf mehrere Stücke bzw. Zeilen verteilt; ungültige Zahlen nicht", () => {
  assert.equal(S.PHASE_MARK, "Unterricks-Phase");
  for (const [lines, want] of [
    [["Unterricks-Phase: 3"], 3], [["unterricks-phase:3"], 3], [["UNTERRICKS–PHASE : 12"], 12], [["Unterricks Phase 7"], 7], [["U n t e r r i c k s - P h a s e : 4"], 4],
    [["Titel der Folie", "Unterricks-", "Phase:  5"], 5], [["Unterricks", "-Phase: 2"], 2], [["Unterricks-Phase：８"], 8], [[{ text: "Unterricks-Phase: 9" }], 9],
    [["Unterricks-Phase: 0"], null], [["Unterricks-Phase: 123"], null], [["Phase: 3"], null], [["Unterricks-Codefolie: Hier zeigt Unterricks den QR-Code und den Sitzungscode."], null],
    [["Unterricks-Phase: 2", "Unterricks-Phase: 4"], 2], [[], null], [null, null],
  ]) assert.equal(S.phaseMarkOf(lines), want, JSON.stringify(lines));
  assert.equal(S.stripPhaseMarks("Partnerarbeit Unterricks-Phase: 3").trim(), "Partnerarbeit");
});

test("Codefolie: die Zeile „Unterricks-Phase: n“ wird nie Teil der Überschrift – klein, groß (unsichtbar), auf derselben Grundlinie oder umbrochen", () => {
  const head = ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"];
  const base = [piece(head[0], 100, 260, 40), piece(head[1], 100, 340, 56), piece(S.CODE_SLIDE_LINE, 100, 1050, 16)];
  const cases = {
    "klein am Rand": [piece("Unterricks-Phase: 2", 4, 1078, 2)],
    "groß, unsichtbar": [piece("Unterricks-Phase: 2", 100, 600, 44)],
    "auf der Grundlinie der Codefolien-Zeile": [piece("Unterricks-Phase: 2", 1500, 1050, 16)],
    "in zwei Zeilen": [piece("Unterricks-", 100, 640, 44), piece("Phase: 2", 100, 700, 44)],
    "in drei Stücken": [piece("Unterricks-", 100, 640, 44), piece(" ", 380, 640, 44), piece("Phase: 2", 420, 640, 44)],
  };
  for (const [name, extra] of Object.entries(cases)) {
    const lines = S.slideTextLines([...base, ...extra]);
    assert.equal(S.phaseMarkOf(lines), 2, name);
    assert.deepEqual(S.codeSlideLines(lines, 1080), head, name);
  }
  // ohne die Zeile „Unterricks-Phase“ bleibt alles wie bisher – auch eine große Zeile „Phase 2“ gehört dann zur Überschrift
  assert.ok(S.codeSlideLines(S.slideTextLines([...base, piece("Phase 2", 100, 420, 44)]), 1080).includes("Phase 2"));
  assert.equal(S.codeSlideLines(S.slideTextLines([piece("Folie 3", 100, 300, 40), piece("Unterricks-Phase: 2", 4, 1078, 2)]), 1080), null, "gewöhnliche Folie bleibt gewöhnlich");
});

// Textstücke einer echten PDF wie presenter.js (pageItems): PDF.js-Gerätekoordinaten
async function pdfLines(bytes, scale = 2) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i), vp = page.getViewport({ scale }), tc = await page.getTextContent();
    const items = tc.items.filter((it) => typeof it.str === "string").map((it) => {
      const tx = pdfjs.Util.transform(vp.transform, it.transform), hgt = Math.hypot(tx[2], tx[3]);
      return { str: it.str, x: tx[4], base: tx[5], w: it.width * scale, h: hgt, eol: !!it.hasEOL };
    });
    out.push({ lines: S.slideTextLines(items), items, h: vp.height });
  }
  await doc.destroy();
  return out;
}
// Präsentation wie von Claude: Folie 1 Titel (Phase 1), Folie 2 Codefolie (Phase 2), Folie 3 ohne Phase; mode "invisible" = Textdarstellungsmodus 3,
// "bg" = 1,5 pt in der Farbe des Hintergrunds, "split" = in zwei Textstücken
async function deck(mode) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), bg = rgb(0.12, 0.2, 0.38);
  const mark = (page, text) => {
    if (mode === "invisible") { page.pushOperators(setTextRenderingMode(3)); page.drawText(text, { x: 20, y: 6, size: 9, font: f }); page.pushOperators(setTextRenderingMode(0)); }
    else if (mode === "split") { page.drawText("Unterricks-", { x: 2, y: 1, size: 1.5, font: f, color: bg }); page.drawText(text.slice("Unterricks-".length), { x: 12, y: 1, size: 1.5, font: f, color: bg }); }
    else page.drawText(text, { x: 2, y: 1, size: 1.5, font: f, color: bg });
  };
  const slide = (lines) => { const p = d.addPage([960, 540]); p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg }); lines.forEach(([t, y, s]) => p.drawText(t, { x: 60, y, size: s, font: f, color: rgb(1, 1, 1) })); return p; };
  mark(slide([["Die wehrhafte Demokratie", 300, 48]]), "Unterricks-Phase: 1");
  mark(slide([["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", 330, 28], ["Feibeitsblatt: Die wehrhafte Demokratie", 260, 40], [S.CODE_SLIDE_LINE, 20, 10]]), "Unterricks-Phase: 2");
  slide([["Quellen", 300, 40]]);
  return d.save();
}
test("echte PDF: PDF.js liefert unsichtbaren Text (Modus 3) und winzigen Text in Hintergrundfarbe – Phase je Folie, Codefolie ohne die Zeile", async () => {
  for (const mode of ["invisible", "bg", "split"]) {
    const pages = await pdfLines(await deck(mode));
    assert.deepEqual(pages.map((p) => S.phaseMarkOf(p.lines)), [1, 2, null], mode);
    assert.deepEqual(S.codeSlideLines(pages[1].lines, pages[1].h), ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"], mode);
    assert.equal(S.cleanSlidePhases(pages.map((p) => S.phaseMarkOf(p.lines)), 3).join(","), "1,2,", mode);
  }
});

/* ---------- Phasen des Schulportal-Eintrags und Regel für den Zwischenstopp ---------- */
test("Phasen des Schulportal-Eintrags: nummerierte fette Überschriften in der Reihenfolge des Eintrags", () => {
  assert.deepEqual(S.portalPhases(PORTAL).map((x) => [x.n, x.line, x.label]), [[1, 0, "1) Einstieg"], [2, 3, "2) Partnerarbeit"], [3, 6, "3) Sicherung"], [4, 11, "4) Diskussion"]]);
  assert.deepEqual(S.portalPhases("**5. ~~Video~~: BVerfG** (10 min)\n- 6) kein Kopf\n6) ohne Fett\n**x) nein**").map((x) => x.label), ["5 Video: BVerfG (10 min)".replace("5 ", "5) ")]);
  assert.deepEqual(S.portalPhases(""), []);
});

test("Zwischenstopp aus der letzten gezeigten Folie: Anfang, Mitte und Ende einer Phase, Folien ohne Phase, Phasen ohne Folien, Stunde geschafft", () => {
  //            Folie: 1  2  3  4  5  6  7     8
  const P = [1, 1, 2, 2, 2, 3, null, 4];
  const at = (n, p = P, t = PORTAL) => { const r = S.stopForShown(t, p, n); return r.text !== undefined && !r.complete ? stopBefore(r.text) : r; };
  assert.equal(at(1), "**1) Einstieg**", "Phase 1 angefangen (Folie 2 gehört noch dazu) → vor Phase 1");
  assert.equal(at(2), "**2) Partnerarbeit**", "Ende von Phase 1 → vor Phase 2");
  assert.equal(at(3), "**2) Partnerarbeit**", "Anfang von Phase 2: angefangen gilt als nicht geschafft");
  assert.equal(at(4), "**2) Partnerarbeit**", "Mitte von Phase 2");
  assert.equal(at(5), "**3) Sicherung**", "Ende von Phase 2");
  assert.equal(at(6), "**4) Diskussion**", "Ende von Phase 3 (Folie 7 ohne Phase zählt nicht) → vor Phase 4, auch nach „--> Nächste Stunde“");
  assert.equal(at(7), "**4) Diskussion**", "Folie ohne Phase: es gilt die letzte zugeordnete davor");
  const r = S.stopForShown(PORTAL, P, 5);
  assert.deepEqual([r.phase, r.label, r.line], [3, "3) Sicherung", 6]);
  assert.ok(!S.hasStop(PORTAL) && S.hasStop(r.text) && S.removeStops(r.text) === PORTAL, "nur die Zeile kommt dazu");
  // Phase ohne Folien (2) gilt als nicht geschafft; Phase 3 hat Folien nach der markierten
  assert.equal(at(2, [1, 1, 3, 3, 4]), "**2) Partnerarbeit**");
  // Titelfolie ohne Phase und als letzte gezeigte: vor die erste Phase
  assert.equal(at(1, [null, 1, 1, 2]), "**1) Einstieg**");
  // Stunde geschafft: nach Phase 4 kommt keine mehr
  assert.equal(at(4, [1, 2, 3, 4, 4]), "**4) Diskussion**", "Folie 5 gehört noch zu Phase 4");
  assert.deepEqual(S.stopForShown(PORTAL, [1, 2, 3, 4, 4], 5), { complete: true, phase: 4, manual: false });
  // neue Markierung verschiebt einen vorhandenen Zwischenstopp (auch einen von Hand gesetzten): die letzte Handlung gilt
  const manual = S.insertStop(PORTAL, 0).text, moved = S.stopForShown(manual, P, 5);
  assert.equal(stopBefore(moved.text), "**3) Sicherung**"); assert.equal(moved.text.split(S.STOP_LINE).length, 2, "nur ein Zwischenstopp");
  // kein Ergebnis: ohne Phasen, ohne Überschriften, Phase fehlt, Phase doppelt
  assert.deepEqual(S.stopForShown(PORTAL, null, 3), { error: "nomarks" });
  assert.deepEqual(S.stopForShown(PORTAL, [null, null], 1), { error: "nomarks" });
  assert.deepEqual(S.stopForShown("- nur Stichpunkte", P, 3), { error: "noheads" });
  assert.deepEqual(S.stopForShown(PORTAL, [1, 7, 7, 2], 2), { error: "missing", phase: 7 });
  assert.deepEqual(S.stopForShown(PORTAL + "\n**2) Noch einmal**", P, 2), { error: "twice", phase: 2 });
});

test("Markierung aufgehoben bzw. Stunde geschafft: nur der Zwischenstopp, den Unterricks selbst eingetragen hat und der noch an seiner Stelle steht, verschwindet", () => {
  const P = [1, 1, 2, 2, 2, 3, null, 4];
  const auto = S.stopForShown(PORTAL, P, 5), rec = { phase: auto.phase, until: 5 };
  // aufgehoben: der eigene Zwischenstopp geht
  const rm = S.stopForShown(auto.text, P, null, rec);
  assert.deepEqual([rm.remove, rm.phase, rm.label, rm.text], [true, 3, "3) Sicherung", PORTAL]);
  // von Hand verschoben (jetzt vor Phase 2): bleibt
  const handMoved = S.insertStop(auto.text, S.portalPhases(auto.text).find((x) => x.n === 2).line).text;
  assert.deepEqual(S.stopForShown(handMoved, P, null, rec), { keep: true, manual: true });
  // von Hand gesetzt (ohne Vermerk): bleibt
  assert.deepEqual(S.stopForShown(auto.text, P, null, null), { keep: true, manual: true });
  // ohne Zwischenstopp: nichts zu tun
  assert.deepEqual(S.stopForShown(PORTAL, P, null, rec), { keep: true, manual: false });
  // Leerzeile zwischen Zwischenstopp und Überschrift zählt nicht
  assert.equal(S.stopForShown(auto.text.replace(S.STOP_LINE + "\n", S.STOP_LINE + "\n\n"), P, null, rec).remove, true);
  // Stunde geschafft: der eigene geht, ein von Hand gesetzter bleibt
  const done = S.stopForShown(auto.text, [1, 2, 3, 4], 4, rec);
  assert.deepEqual([done.complete, done.remove, done.removed, done.text], [true, true, "3) Sicherung", PORTAL]);
  assert.deepEqual(S.stopForShown(handMoved, [1, 2, 3, 4], 4, rec), { complete: true, phase: 4, manual: true });
  // neue Markierung nach dem eigenen: verschiebt ihn (die letzte Handlung gilt)
  assert.equal(stopBefore(S.stopForShown(auto.text, P, 2, rec).text), "**2) Partnerarbeit**");
});

test("Phasen der Folien aus fremden Daten: genau so viele wie Folien, Ganzzahlen 1–99 oder null; gespeichert tolerant gelesen", () => {
  assert.deepEqual(S.cleanSlidePhases([1, null, 2], 3), [1, null, 2]);
  assert.equal(S.cleanSlidePhases([null, null], 2), null, "ohne Phase");
  assert.equal(S.cleanSlidePhases(null, 2), null);
  for (const bad of [[1, 2], [1, 2, 3, 4], [0, 1, 2], [1, 100, 2], [1, "2", 3], [1.5, 2, 3], "1,2,3", { 0: 1 }]) assert.equal(S.cleanSlidePhases(bad, 3), undefined, JSON.stringify(bad));
  assert.deepEqual(S.slidePhasesData(JSON.stringify({ v: 1, pdf: [1, 2], hand: [1, 1, 2], auto: { phase: 2, until: 1 } }), 3), { pdf: null, hand: [1, 1, 2], auto: { phase: 2, until: 1 } }, "pdf passt nicht zur Seitenzahl");
  assert.deepEqual(S.slidePhasesData("kaputt", 3), { pdf: null, hand: null, auto: null });
  assert.deepEqual(S.slidePhasesData(null, 3), { pdf: null, hand: null, auto: null });
  assert.deepEqual(S.slidePhasesOf({ phases: { pdf: [1, 2], hand: null } }), [1, 2]);
  assert.deepEqual(S.slidePhasesOf({ phases: { pdf: [1, 2], hand: [2, 2] } }), [2, 2], "von Hand gilt vor der PDF");
  assert.equal(S.slidePhasesOf({}), null);
});

test("Präsentations-Prompt: Phase jeder Folie unsichtbar (Modus 3 bzw. ≤ 2 pt in Hintergrundfarbe), einzige Ausnahme auf Codefolien, ohne das Wort „Zwischenstopp“", () => {
  const ctx = { subject: "powi", klass: "8C", lesson: { title: "T", topic: "Wehrhafte Demokratie", durationMin: 90 }, materials: [], sheets: [] };
  for (const klass of ["8C", "6B"]) {
    const p = S.claudePresentationPrompt({ ...ctx, klass }, PORTAL, []);
    const sec = p.slice(p.indexOf("## Phase jeder Folie: unsichtbar in der PDF"), p.indexOf("## Notizen für die Lehrkraft"));
    assert.ok(sec.length > 200 && p.indexOf("## Zeitlos gestalten") < p.indexOf("## Phase jeder Folie") && p.indexOf("## Phase jeder Folie") < p.indexOf("## Notizen für die Lehrkraft"), klass);
    for (const t of ["auch auf der Titelfolie, auf Materialfolien und Unterricks-Codefolien – genau eine Zeile „Unterricks-Phase: 3“ als echter Text in einer Zeile",
      "die Nummer der Phase im verbindlichen Stundenverlauf unten", "Titelfolie und Agenda gehören zur Phase, in der sie zuerst gezeigt werden (meist 1)", "eine Folie, die zu keiner Phase gehört, bekommt keine Zeile",
      "unsichtbarer Text (Textdarstellungsmodus 3, z. B. mit reportlab `setTextRenderMode(3)`)", "höchstens 2 pt", "in genau der Farbe des Hintergrunds an dieser Stelle – nie über anderem Inhalt",
      "Unterricks nimmt sie nie in die Überschrift einer Unterricks-Codefolie"]) assert.ok(sec.includes(t), klass + ": " + t);
    assert.ok(p.includes("weiterer Text würde Teil der Überschrift (einzige Ausnahme: die unsichtbare Zeile „Unterricks-Phase: …“, siehe „Phase jeder Folie“)"), "Regel der Codefolie nennt die Ausnahme");
    assert.ok(!p.includes("Zwischenstopp"), "die interne Markierung bleibt draußen");
  }
});

/* ---------- Server ---------- */
const TOKEN = "lehrkraft-token-phasen", STOKEN = "schueler-token-phasen", DEV = "eeeeeeeeeeeeeeee";
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + tok, "Content-Type": raw ? (/\/slides\//.test(path) ? "image/jpeg" : "application/pdf") : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : res }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN);
async function setup(pages = 3) {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8C", title: "Wehrhafte Demokratie", date: new Date(c.now - 2 * 864e5).toISOString().slice(0, 10), startTime: "08:00", durationMin: 90 }, c.now - 864e5);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, '8C', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  c.db.raw.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, l.id, c.now - 600e3);
  const up = await call(c, F.routePresentationUpload, "POST", "/api/teacher/lessons/" + l.id + "/presentation?name=D.pdf", await deck("invisible"), l.id);
  const fid = up.data.file.id;
  for (let n = 1; n <= pages; n++) await call(c, F.routeSlideUpload, "PUT", "/api/teacher/files/" + fid + "/slides/" + n + "?w=1920&h=1080", new Uint8Array([0xff, 0xd8, n]), fid, String(n));
  return { c, l, fid };
}
const ready = (c, fid, body) => call(c, F.routePresentationReady, "POST", "/x", body, fid);
const phasesPut = (c, fid, body) => call(c, F.routePhasesPut, "PUT", "/x", body, fid);

test("Server: neue Spalte files.slide_phases (additiv); Phasen mit …/ready gespeichert und geprüft, …/slides und fileOut liefern sie", async () => {
  assert.ok(COLUMNS.some(([t, col, def]) => t === "files" && col === "slide_phases" && def === "TEXT"));
  const { c, l, fid } = await setup();
  let r = await ready(c, fid, { pages: 3, codeSlides: [], phases: [1, 2, null] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.file.phases, { pdf: [1, 2, null], hand: null, auto: null });
  const sl = await call(c, F.routeTeacherSlides, "GET", "/x", undefined, fid);
  assert.deepEqual(sl.data.phases, { pdf: [1, 2, null], hand: null, auto: null });
  const lg = await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id);
  assert.deepEqual(lg.data.files.find((f) => f.area === "presentation").phases.pdf, [1, 2, null], "GET lesson (FILE_COLS)");
  for (const bad of [[1, 2], [1, 2, 3, 4], [0, 1, 1], [1, 100, 1], ["1", 2, 3], "1,2,3"]) {
    const b = await ready(c, fid, { pages: 3, codeSlides: [], phases: bad });
    assert.deepEqual([b.status, /Ungültige Phasen der Folien/.test(b.data.error)], [400, true], JSON.stringify(bad));
  }
  assert.deepEqual((await call(c, F.routeTeacherSlides, "GET", "/x", undefined, fid)).data.phases.pdf, [1, 2, null], "eine abgelehnte Anfrage ändert nichts");
  // ältere offene Seite ohne das Feld: bleibt, wie es ist; ohne eine Phase: null
  assert.deepEqual((await ready(c, fid, { pages: 3, codeSlides: [] })).data.file.phases.pdf, [1, 2, null]);
  assert.deepEqual((await ready(c, fid, { pages: 3, codeSlides: [], phases: null })).data.file.phases, { pdf: null, hand: null, auto: null });
  assert.equal(c.db.raw.prepare("SELECT slide_phases FROM files WHERE id=?").get(fid).slide_phases, null);
  // Zuordnung aus der Sitzungsdatei (phasesHand) gilt vor der PDF
  assert.deepEqual((await ready(c, fid, { pages: 3, codeSlides: [], phases: [1, 2, null], phasesHand: [1, 1, 2] })).data.file.phases, { pdf: [1, 2, null], hand: [1, 1, 2], auto: null });
});

test("Server: PUT …/phases – Zuordnung von Hand und Vermerk des eingetragenen Zwischenstopps; Schüler:innen sehen davon nichts", async () => {
  const { c, l, fid } = await setup();
  await ready(c, fid, { pages: 3, codeSlides: [], phases: [1, 2, null] });
  let r = await phasesPut(c, fid, { hand: [1, 1, 2] });
  assert.deepEqual([r.status, r.data.file.phases], [200, { pdf: [1, 2, null], hand: [1, 1, 2], auto: null }]);
  r = await phasesPut(c, fid, { auto: { phase: 2, until: 2 } });
  assert.deepEqual(r.data.file.phases, { pdf: [1, 2, null], hand: [1, 1, 2], auto: { phase: 2, until: 2 } }, "fehlt ein Feld, bleibt es");
  r = await phasesPut(c, fid, { hand: null, auto: null });
  assert.deepEqual(r.data.file.phases, { pdf: [1, 2, null], hand: null, auto: null }, "wieder die Phasen der PDF");
  for (const bad of [{ hand: [1, 2] }, { hand: [1, 0, 2] }, { auto: { phase: 0, until: 1 } }, { auto: { phase: 2, until: 9 } }, { auto: "x" }]) assert.equal((await phasesPut(c, fid, bad)).status, 400, JSON.stringify(bad));
  assert.equal((await callAs("falsch")(c, F.routePhasesPut, "PUT", "/x", { hand: null }, fid)).status, 401, "nur angemeldet");
  assert.equal((await scall(c, F.routePhasesPut, "PUT", "/x", { hand: null }, fid)).status, 401, "nicht mit dem Token von Schüler:innen");
  await phasesPut(c, fid, { hand: [1, 1, 2] });
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/x", undefined, l.id);
  assert.equal(sv.status, 200);
  assert.ok(!JSON.stringify(sv.data).includes('"phases"') && !JSON.stringify(sv.data).includes("slide_phases"), "Schüleransicht ohne Phasen der Folien");
});

test("Sitzungsdatei: die Zuordnung der Lehrkraft (slidePhases) kommt mit – nur an der Präsentation, geprüft", () => {
  const base = { kind: "unterricks-sitzung", v: 1, source: {}, lesson: {}, chat: [], drafts: [], sheets: [], notes: [] };
  const d = cleanSessionFile({ ...base, files: [{ area: "presentation", kind: "file", name: "P.pdf", path: "dateien/1 - P.pdf", slidePhases: [1, 1, "2", 0, 3, null] },
    { area: "student", kind: "file", name: "A.pdf", path: "dateien/2 - A.pdf", slidePhases: [1] }, { area: "presentation", kind: "file", name: "Q.pdf", path: "dateien/3 - Q.pdf", slidePhases: [null] }] });
  assert.deepEqual(d.files[0].slidePhases, [1, 1, null, null, 3, null]);
  assert.equal(d.files[1].slidePhases, undefined, "nur an der Präsentation");
  assert.equal(d.files[2].slidePhases, undefined, "ohne Phase kein Feld");
});

/* ---------- Prüfbefunde (S33 check) ---------- */
test("Phase lesen (Prüfbefund): sichtbarer Text „… in Unterricks“ + „Phase 2: …“ gewinnt nicht gegen die echte Zeile; gesperrte zweistellige Zahl; Zahl direkt dahinter; Seitenzahl daneben", () => {
  // die Fundstelle mit Bindestrich und Doppelpunkt gewinnt – auch wenn die sichtbare über zwei Zeilen davor steht
  assert.equal(S.phaseMarkOf(["Öffnet das Material in Unterricks", "Phase 2: Partnerarbeit", "Unterricks-Phase: 3"]), 3);
  assert.equal(S.phaseMarkOf(["Öffnet das Material in Unterricks", "Phase 2: Partnerarbeit", "Unterricks-", "Phase: 3"]), 3, "auch umbrochen");
  // gesperrt gesetzt: auch die Zahl
  assert.equal(S.phaseMarkOf(["U n t e r r i c k s - P h a s e : 1 2"]), 12);
  assert.equal(S.phaseMarkOf(["U n t e r r i c k s - P h a s e :  1  2"]), 1, "Wortlücke (zwei Leerzeichen): nicht dieselbe Zahl");
  // nicht gesperrt: „1 2“ ist die Zeile und eine Seitenzahl daneben
  assert.equal(S.phaseMarkOf(["Unterricks-Phase: 1 2"]), 1);
  assert.equal(S.phaseMarkOf(["Unterricks-Phase: 1 2025"]), 1);
  // direkt dahinter Text, der mit einer Zahl beginnt (gleiche Grundlinie, ohne Abstand verbunden): die Textstücke einzeln gelten zuerst
  assert.equal(S.phaseMarkOf(["Unterricks-Phase: 22025 Quelle: Statistik"]), null, "nur verbunden: nicht eindeutig");
  assert.equal(S.phaseMarkOf(["Unterricks-Phase: 22025 Quelle: Statistik"], [{ str: "Unterricks-Phase: 2" }, { str: "2025 Quelle: Statistik" }]), 2);
  assert.equal(S.phaseMarkOf([], ["Unterricks-Phase: 7"]), 7, "Textstücke als Strings");
});

test("Codefolie (Prüfbefund): eine sichtbare Zeile „Phase 2“ der Überschrift bleibt, wenn die Zeile „Unterricks-Phase“ ganz in einer Zeile steht; umbrochen fallen nur ihre Stücke weg", () => {
  const head = [piece("Phase 2", 100, 200, 44), piece("Bearbeitet das Feibeitsblatt", 100, 300, 44), piece(S.CODE_SLIDE_LINE, 100, 1050, 16)];
  assert.deepEqual(S.codeSlideLines(S.slideTextLines([...head, piece("Unterricks-Phase: 2", 4, 1078, 2)]), 1080), ["Phase 2", "Bearbeitet das Feibeitsblatt"]);
  assert.deepEqual(S.codeSlideLines(S.slideTextLines(head), 1080), ["Phase 2", "Bearbeitet das Feibeitsblatt"], "ohne Zeile wie bisher");
  // umbrochen: genau ihre Stücke, „Phase 2“ der Überschrift bleibt
  assert.deepEqual(S.codeSlideLines(S.slideTextLines([...head, piece("Unterricks-", 100, 640, 44), piece("Phase: 3", 100, 700, 44)]), 1080), ["Phase 2", "Bearbeitet das Feibeitsblatt"]);
  // „… in Unterricks“ + „Phase 2: …“ sichtbar, die echte Zeile winzig: die sichtbaren Zeilen bleiben vollständig
  const vis = [piece("Öffnet das Material in Unterricks", 100, 200, 44), piece("Phase 2: Partnerarbeit", 100, 330, 44), piece(S.CODE_SLIDE_LINE, 100, 1050, 16), piece("Unterricks-Phase: 3", 4, 1078, 2)];
  const lines = S.slideTextLines(vis);
  assert.equal(S.phaseMarkOf(lines), 3);
  assert.deepEqual(S.codeSlideLines(lines, 1080), ["Öffnet das Material in Unterricks", "Phase 2: Partnerarbeit"]);
});

test("echte PDF (Prüfbefund): Zeile mit Zeichenabstand (gesperrt, zweistellig) und Fußzeile, die mit einer Jahreszahl beginnt, auf derselben Grundlinie", async () => {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), bg = rgb(0.12, 0.2, 0.38);
  const p1 = d.addPage([960, 540]);
  p1.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg });
  p1.pushOperators(PL.setCharacterSpacing(3)); p1.drawText("Unterricks-Phase: 12", { x: 4, y: 3, size: 6, font: f, color: bg }); p1.pushOperators(PL.setCharacterSpacing(0));
  const p2 = d.addPage([960, 540]);
  p2.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg });
  const w = f.widthOfTextAtSize("Unterricks-Phase: 2", 6);
  p2.drawText("Unterricks-Phase: 2", { x: 4, y: 3, size: 6, font: f, color: bg }); p2.drawText("2025 Quelle: Statistik", { x: 4 + w + 20, y: 3, size: 6, font: f, color: rgb(1, 1, 1) });
  // ohne jeden Abstand dahinter (gegen den Prompt: „nie über anderem Inhalt“) verbindet PDF.js beides zu einem Textstück „…: 22025 …“ – dann bleibt die Folie
  // ohne Phase (nie eine falsche); die Lehrkraft ordnet sie unter „Phasen der Folien“ zu
  const p3 = d.addPage([960, 540]);
  p3.drawText("Unterricks-Phase: 2", { x: 4, y: 3, size: 6, font: f }); p3.drawText("2025 Quelle: Statistik", { x: 4 + w, y: 3, size: 6, font: f });
  const pages = await pdfLines(await d.save());
  assert.equal(S.phaseMarkOf(pages[0].lines, pages[0].items), 12, JSON.stringify(pages[0].lines.map((l) => l.text)));
  assert.equal(S.phaseMarkOf(pages[1].lines, pages[1].items), 2, JSON.stringify(pages[1].lines.map((l) => l.text)));
  assert.equal(S.phaseMarkOf(pages[2].lines, pages[2].items), null, JSON.stringify(pages[2].items.map((i) => i.str)));
});

test("Zwischenstopp nach dem Speichern von „Phasen der Folien“ (Prüfbefund, keepManual): ohne Zwischenstopp bzw. mit dem eigenen eintragen, einen von Hand gesetzten stehen lassen", () => {
  const P = [1, 1, 2, 2, 2, 3, null, 4];
  // noch kein Zwischenstopp (z. B. vorher „Folien ohne Phasen“): eingetragen
  assert.equal(stopBefore(S.stopForShown(PORTAL, P, 4, null, { keepManual: true }).text), "**2) Partnerarbeit**");
  // der eigene steht noch an seiner Stelle: er folgt der neuen Zuordnung
  const auto = S.stopForShown(PORTAL, P, 5), rec = { phase: auto.phase, until: 5 };
  assert.equal(stopBefore(S.stopForShown(auto.text, [1, 1, 2, 2, 3, 3, 4, 4], 5, rec, { keepManual: true }).text), "**3) Sicherung**");
  assert.equal(stopBefore(S.stopForShown(auto.text, [1, 1, 1, 2, 2, 2, 4, 4], 5, rec, { keepManual: true }).text), "**2) Partnerarbeit**");
  // von Hand gesetzt (ohne Vermerk) bzw. verschoben: bleibt
  const hand = S.insertStop(PORTAL, 0).text;
  assert.deepEqual(S.stopForShown(hand, P, 4, null, { keepManual: true }), { keep: true, manual: true });
  const moved = S.insertStop(auto.text, S.portalPhases(auto.text).find((x) => x.n === 2).line).text;
  assert.deepEqual(S.stopForShown(moved, P, 4, rec, { keepManual: true }), { keep: true, manual: true });
  // eine neue Markierung (ohne keepManual) verschiebt ihn weiterhin
  assert.equal(stopBefore(S.stopForShown(hand, P, 4).text), "**2) Partnerarbeit**");
});

test("Server (Prüfbefund): Stand der Sitzung GET …/stamp – gleich dem aus GET …/lessons/:id, ändert sich mit Eintrag, Markierung und Phasen der Präsentation; vier Anweisungen; nur angemeldet", async () => {
  const { c, l, fid } = await setup();
  await ready(c, fid, { pages: 3, codeSlides: [], phases: [1, 2, null] });
  const stamp = async () => (await call(c, L.routeLessonStamp, "GET", "/x", undefined, l.id)).data;
  const full = async () => (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.stamp;
  let s0 = await stamp();
  assert.equal(typeof s0.stamp, "string"); assert.equal(s0.stamp, await full(), "derselbe Stand in beiden Antworten");
  assert.equal(s0.portalVersion, 0);
  const tick = async () => { c.now += 1000; };
  await tick(); await call(c, L.routePortalPut, "PUT", "/x", { text: PORTAL, baseVersion: 0 }, l.id);
  let s1 = await stamp();
  assert.ok(s1.stamp !== s0.stamp && s1.portalVersion === 1 && s1.stamp === await full(), "Schulportal-Eintrag gespeichert");
  await tick(); await phasesPut(c, fid, { auto: { phase: 2, until: 1 } });
  const s2 = await stamp();
  assert.ok(s2.stamp !== s1.stamp && s2.stamp === await full(), "Vermerk bzw. Phasen der Präsentation (updated_at der Datei)");
  assert.equal((await stamp()).stamp, s2.stamp, "ohne Änderung gleich");
  assert.equal((await callAs("falsch")(c, L.routeLessonStamp, "GET", "/x", undefined, l.id)).status, 401, "nur angemeldet");
  assert.equal((await call(c, L.routeLessonStamp, "GET", "/x", undefined, "ffffffffffffffff")).status, 404);
  assert.ok(/c\.db\.batch\(\[\s*c\.db\.prepare[^\]]*\]\)/.test(readFileSync(new URL("../../worker/lessons.js", import.meta.url), "utf8").slice(readFileSync(new URL("../../worker/lessons.js", import.meta.url), "utf8").indexOf("export async function routeLessonStamp"))), "ein Batch");
});
