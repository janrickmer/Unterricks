// Seiten der Grundschule und Planungsgrundlagen im Browser-Ersatz (fake-dom.mjs, Attrappen für app.js, teacher.js, PDF.js und XMLHttpRequest):
// Befunde der Abschlussprüfung, Gruppe D – Original-PDF nachreichen (Kursseite und Planungsgrundlagen, Fokus), „Gesicherte Einheit laden“ nicht in
// der Grundschule, Einheit mit nur Ausfall-Einträgen löschen, Prompt des roten Kastens aus der ganzen Einheit, Kursseite behält ungespeicherte
// Eingaben, „Kurs anlegen“ springt nach langem Hochladen nicht zurück, „Erneut versuchen“ der Elternansicht, Fokusrahmen der PDF-Verweise.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
// PDF.js: Seitenzahl aus globalThis.__pdfPages, Text „Seite n“ je Seite
const PDFJS = "export const GlobalWorkerOptions = {}; export function getDocument() { const n = globalThis.__pdfPages || 2; return { promise: Promise.resolve({ numPages: n, destroy: async () => {}, " +
  "getPage: async (i) => ({ getTextContent: async () => ({ items: [{ str: 'Seite ' + i + ' Wasser im Alltag' }] }), cleanup() {} }) }) }; }";
register("data:text/javascript," + encodeURIComponent("export async function resolve(s, c, n) { return s === '/vendor/pdf.min.mjs' ? { url: " +
  JSON.stringify("data:text/javascript," + encodeURIComponent(PDFJS)) + ", shortCircuit: true } : n(s, c); }"));
const D = installDom({ hash: "#/lk/grundschule" });
const { ApiError } = await import("../../public/ui.js");
const BA = await import("../../public/bases.js");
const GSP = await import("../../public/grundschule.js");
const UN = await import("../../public/units.js");
const PA = await import("../../public/parents.js");

/* Server-Attrappe wie in gsui.test.mjs; XMLHttpRequest (Hochladen der Original-PDF) wartet, bis der Test antwortet */
function server(routes) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  return calls;
}
const xhrs = [];
globalThis.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.headers = {}; }
  open(m, u) { this.method = m; this.url = u; }
  setRequestHeader(k, v) { this.headers[k] = v; }
  send(body) { this.body = body; xhrs.push(this); }
  respond(status, data) { this.status = status; this.responseText = JSON.stringify(data); this.onload(); }
};
const nextXhr = async () => { for (let i = 0; i < 200 && !xhrs.length; i++) await D.sleep(5); assert.ok(xhrs.length, "Original-PDF wird hochgeladen"); return xhrs.shift(); };
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const button = (root, text) => [...(root || document).querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const desc = (el) => (el ? el.tagName + (el.id ? "#" + el.id : "") + "." + (el.getAttribute("class") || "") + " „" + el.textContent.trim().slice(0, 40) + "“" : String(el));
const toasts = () => [...$$("#toasts .toast")].map((t) => t.textContent);
const clearToasts = () => $$("#toasts .toast").forEach((t) => t.remove());
const pdfFile = (name = "Curriculum.pdf") => new File([new Uint8Array([37, 80, 68, 70, 45, 49])], name, { type: "application/pdf" });
const pick = (inp, file) => { Object.defineProperty(inp, "files", { value: [file], configurable: true }); D.fire(inp, "change"); };
const typeInto = (el, v) => { el.focus(); el.value = v; D.fire(el, "input"); D.fire(el, "change"); };
const fresh = () => { if (globalThis.__leave) globalThis.__leave(); $$(".modal-back").forEach((x) => x.remove()); clearToasts(); globalThis.__go = []; xhrs.length = 0; };
const waitFor = async (fn, msg) => { for (let i = 0; i < 300; i++) { if (fn()) return; await D.sleep(5); } assert.fail("gewartet auf: " + msg); };

const GSID = "gs1a2b3c4d", B1 = "b1".repeat(8), B2 = "b2".repeat(8);
const baseOf = (id, extra = {}) => ({ id, subject: GSID, kind: "sonstiges", kindLabel: "Sonstige Vorgabe", title: "Curriculum Sachunterricht", pages: 2, scope: [], sections: {}, note: "", fileName: "Curriculum.pdf", createdAt: 1, pdf: false, ...extra });
const courseOf = (extra = {}) => ({ id: GSID, grade: 3, classes: ["c"], religion: false, subjectName: "Sachunterricht", description: "", schoolYear: "2026/27", short: "Sachunterricht 3c", label: "Sachunterricht · Jahrgang 3 (Klasse 3c)", ...extra });

/* Kursseite eines Grundschulkurses mit einer eigenen Planungsgrundlage ohne Original-PDF */
async function coursePage(extraBases = []) {
  const st = { base: baseOf(B1), course: courseOf() };
  st.calls = server([
    [/^GET \/api\/teacher\/gs\/courses\/gs1a2b3c4d$/, () => ({ course: st.course, settings: { weekdays: [{ day: 3, minutes: 45, time: "09:50" }], classSize: 22, updatedAt: 1 } })],
    [/^GET \/api\/teacher\/units\?/, () => ({ units: [] })], [/^GET \/api\/teacher\/lessons\?/, () => ({ lessons: [] })],
    [/^GET \/api\/teacher\/bases\?subject=gs1a2b3c4d$/, () => ({ bases: [st.base, ...extraBases] })], [/^GET \/api\/teacher\/basis\?/, () => ({ missing: [], docs: [] })],
    [/^PATCH \/api\/teacher\/gs\/courses\/gs1a2b3c4d$/, (m, b) => ({ course: (st.course = { ...st.course, description: b.description }) })],
    [/^DELETE \/api\/teacher\/bases\/(\w+)$/, (m) => { extraBases.splice(extraBases.findIndex((x) => x.id === m[1]), 1); return {}; }],
  ]);
  await GSP.gsCoursePage(GSID);
  await D.sleep(5);
  st.reloads = () => st.calls.filter((c) => c.method === "GET" && c.path.startsWith("/api/teacher/bases?")).length;
  return st;
}

test("F30: Kursseite – Speichern von „Fach, Klassen und Beschreibung“ und Löschen einer Planungsgrundlage lassen ungespeicherte Eingaben der anderen Karten stehen", async () => {
  fresh();
  const st = await coursePage([baseOf(B2, { title: "Alter Plan" })]);
  // ungespeicherte Eingaben in „Kurseinstellungen“ (Zahl der Kinder, ein weiterer Termin) und „Thema der neuen Einheit“
  typeInto($("#cs-size"), "24");
  button($("section.cs-card"), "+ Termin pro Woche").click();
  typeInto($$("section.cs-card input.cs-time")[1], "11:30");
  typeInto($("#gs-ut"), "Wasser im Alltag");
  const kept = (when) => {
    assert.equal($("#cs-size").value, "24", when + ": Zahl der Kinder (nicht gespeichert) bleibt stehen");
    assert.deepEqual([...$$("section.cs-card input.cs-time")].map((i) => i.value), ["09:50", "11:30"], when + ": Termine (nicht gespeichert) bleiben stehen");
    assert.equal($("#gs-ut").value, "Wasser im Alltag", when + ": Thema der neuen Einheit bleibt stehen");
  };
  // a) „Fach, Klassen und Beschreibung“ speichern
  typeInto($("#gse-desc"), "Wir erkunden Natur und Technik.");
  const save = $("section.gs-edit button.gse-save");
  save.focus(); save.click();
  await waitFor(() => toasts().includes("Kurs gespeichert.") && st.reloads() === 2, "Kurs gespeichert");
  await D.sleep(10);
  kept("nach „Speichern“");
  assert.equal($("#gse-desc").value, "Wir erkunden Natur und Technik.", "gespeicherte Beschreibung");
  assert.ok(document.activeElement === $("section.gs-edit button.gse-save"), "Fokus wieder auf „Speichern“ – ist " + desc(document.activeElement));
  // b) eine Planungsgrundlage löschen
  const del = $('section.gs-bases [data-base="' + B2 + '"] button.danger');
  del.focus(); del.click();
  await waitFor(() => $(".modal"), "Rückfrage");
  button($(".modal"), "Löschen").click();
  await waitFor(() => toasts().includes("Gelöscht.") && st.reloads() === 3, "gelöscht");
  await D.sleep(10);
  assert.ok(!$('[data-base="' + B2 + '"]'), "Eintrag weg");
  kept("nach dem Löschen");
});

test("F12 + F39: Kursseite – Original-PDF einer eigenen Planungsgrundlage nachreichen; danach hat ihr Knopf den Fokus (nur, wenn er verloren ging)", async () => {
  fresh();
  const st = await coursePage();
  const item = () => $('section.gs-bases [data-base="' + B1 + '"]');
  const pdfBtn = () => item() && item().querySelector("button.bpdf");
  assert.ok(pdfBtn(), "eigene Grundlage ohne Original-PDF: Knopf „Original-PDF hinzufügen“ auf der Kursseite");
  assert.equal(pdfBtn().getAttribute("aria-label"), "Original-PDF hinzufügen – „Curriculum Sachunterricht“");
  // falsche Seitenzahl wird abgelehnt, dieselbe Datei gespeichert
  globalThis.__pdfPages = 3;
  pdfBtn().focus(); pick(item().querySelector('input[type="file"]'), pdfFile());
  await waitFor(() => toasts().includes("Diese PDF hat 3 Seiten, gespeichert sind 2. Bitte dieselbe Datei wählen."), "Seitenzahl abgelehnt");
  assert.equal(xhrs.length, 0, "nichts hochgeladen");
  globalThis.__pdfPages = 2;
  typeInto($("#gs-ut"), "Wasser im Alltag");
  pdfBtn().focus(); pick(item().querySelector('input[type="file"]'), pdfFile());
  const x = await nextXhr();
  assert.equal(x.url, "/api/teacher/bases/" + B1 + "/pdf?name=Curriculum.pdf");
  st.base = { ...st.base, pdf: true };
  x.respond(200, { ok: true, base: st.base });
  await waitFor(() => toasts().includes("Original-PDF zu „Curriculum Sachunterricht“ gespeichert."), "PDF gespeichert");
  await waitFor(() => pdfBtn() && pdfBtn().textContent === "Original-PDF ersetzen", "Knopf heißt „Original-PDF ersetzen“");
  assert.ok(document.activeElement === pdfBtn(), "Fokus auf dem Knopf derselben Grundlage – ist " + desc(document.activeElement));
  assert.ok(item().textContent.includes("Original-PDF gespeichert"));
  assert.equal($("#gs-ut").value, "Wasser im Alltag", "Thema der neuen Einheit bleibt stehen");
  // hat die Nutzerin den Fokus inzwischen woanders hingesetzt, bleibt er dort
  const other = $("#gs-ut"), n = st.reloads();
  pdfBtn().focus(); pick(item().querySelector('input[type="file"]'), pdfFile());
  const y = await nextXhr();
  other.focus();
  y.respond(200, { ok: true, base: st.base });
  await waitFor(() => st.reloads() === n + 1 && !$("section.gs-bases button.bpdf[disabled]"), "neu aufgebaut");
  await D.sleep(10);
  assert.ok(document.activeElement === other, "Fokus bleibt, wo die Nutzerin ihn hingesetzt hat – ist " + desc(document.activeElement));
});

test("F12: Textseite einer eigenen Grundlage eines Grundschulkurses verweist auf die Seite des Kurses", async () => {
  fresh();
  server([[/^GET \/api\/teacher\/bases\/\w+\/text/, () => ({ pages: [{ n: 1, text: "Eins" }, { n: 2, text: "Zwei" }] })],
    [/^GET \/api\/teacher\/bases\/b1b1/, () => ({ base: baseOf(B1) })], [/^GET \/api\/teacher\/bases\/b2b2/, () => ({ base: { ...baseOf(B2), subject: "ethik", kind: "fachkonferenz" } })]]);
  await BA.baseDocPage(B1);
  await D.sleep(5);
  const note = $("main .notice");
  assert.equal(note.textContent, "Für diese Planungsgrundlage ist nur der Text gespeichert (so liest ihn auch die KI). Laden Sie auf der Seite des Kurses unter „Planungsgrundlagen“ mit „Original-PDF hinzufügen“ dieselbe PDF hoch – dann öffnet sich hier das Original.");
  assert.equal(note.querySelector("a").getAttribute("href"), "#/lk/grundschule/k/" + GSID);
  // Gymnasium: Wortlaut unverändert (E2E prüft ihn)
  fresh();
  await BA.baseDocPage(B2);
  await D.sleep(5);
  assert.equal($("main .notice").textContent, "Für diese Planungsgrundlage ist nur der Text gespeichert (so liest ihn auch die KI). Laden Sie unter „Planungsgrundlagen“ mit „Original-PDF hinzufügen“ dieselbe PDF hoch – dann öffnet sich hier das Original.");
});

test("F39: Planungsgrundlagen eines Fachs – nach „Original-PDF hinzufügen“ hat derselbe Eintrag den Fokus", async () => {
  fresh();
  let base = { ...baseOf(B2), subject: "ethik", kind: "fachkonferenz", kindLabel: "Fachkonferenzbeschluss", title: "Fachkonferenzbeschluss Ethik (alt)" };
  const other = { ...base, id: B1, title: "Schulcurriculum Ethik", pdf: true };
  server([[/^GET \/api\/teacher\/bases\?subject=ethik$/, () => ({ bases: [other, base] })],
    [/^GET \/api\/teacher\/subjects$/, () => ({ subjects: { ethik: { grades: [], gradeNotes: {}, rules: "", complete: false } } })]]);
  await BA.basesPage("ethik");
  await D.sleep(5);
  const btn = () => $('[data-base="' + B2 + '"] button.bpdf');
  assert.equal(btn().textContent, "Original-PDF hinzufügen");
  btn().focus(); pick(btn().parentNode.querySelector('input[type="file"]'), pdfFile("Beschluss.pdf"));
  const x = await nextXhr();
  base = { ...base, pdf: true };
  x.respond(200, { ok: true, base });
  await waitFor(() => btn() && btn().textContent === "Original-PDF ersetzen", "neu aufgebaut");
  assert.ok(document.activeElement === btn(), "Fokus auf „Original-PDF ersetzen“ desselben Dokuments – ist " + desc(document.activeElement));
});

test("F40: „Kurs anlegen“ mit Planungsgrundlage – wer während des Hochladens woanders hin gewechselt ist, bleibt dort", async () => {
  for (const away of [true, false]) {
    fresh();
    let n = 0;
    server([[/^GET \/api\/teacher\/schedule$/, () => ({ units: [] })], [/^GET \/api\/teacher\/gs\/courses$/, () => ({ courses: [] })], [/^GET \/api\/teacher\/lessons\?school=gs$/, () => ({ lessons: [] })],
      [/^POST \/api\/teacher\/gs\/courses$/, () => ({ course: courseOf({ id: "gs0000000" + ++n }) })],
      [/^POST \/api\/teacher\/bases$/, (m, b) => ({ base: { ...baseOf(B1), subject: b.subject, title: b.title } })], [/^PUT \/api\/teacher\/bases\/\w+\/pages$/, () => ({})]]);
    await GSP.gsOverviewPage();
    await D.sleep(5);
    const form = $("form.gs-new");
    const input = (name, value) => [...form.querySelectorAll("input")].find((i) => i.getAttribute("name") === name && i.value === value);
    input("gsn-grade", "3").click();
    [...form.querySelectorAll('input[type="checkbox"]')].find((c) => c.value === "c").click();
    input("gsn-subj", "other").click();
    typeInto($("#gsn-name"), "Sachunterricht");
    button(form, "+ Termin pro Woche").click();
    typeInto(form.querySelector("input.cs-time"), "09:50");
    Object.defineProperty($("#gsn-file"), "files", { value: [pdfFile("Curriculum_Sachunterricht.pdf")], configurable: true });
    D.fire(form, "submit");
    const x = await nextXhr();
    assert.equal($("#gsn-err").textContent, "", "keine Meldung");
    if (away) { globalThis.__leave(); const app = $("#app"); while (app.firstChild) app.firstChild.remove(); }
    x.respond(200, { ok: true, base: { ...baseOf(B1), pdf: true } });
    if (away) {
      await waitFor(() => toasts().some((t) => t.startsWith("Kurs „")), "Meldung");
      assert.deepEqual(toasts().filter((t) => t.startsWith("Kurs „")), ["Kurs „Sachunterricht 3c“ angelegt – Sie finden ihn unter „Grundschule“."]);
      await D.sleep(10);
      assert.deepEqual(globalThis.__go, [], "kein Sprung zurück auf die Kursseite");
    } else {
      await waitFor(() => globalThis.__go.length, "weiter zur Kursseite");
      assert.deepEqual(globalThis.__go, ["#/lk/grundschule/k/gs0000000" + n], "Formular noch zu sehen: weiter zur Kursseite");
      assert.ok(toasts().includes("Kurs „Sachunterricht 3c“ angelegt."));
    }
  }
});

const UID = "u1".repeat(8), L1 = "a1".repeat(8), L2 = "a2".repeat(8), LX = "a3".repeat(8);
const gsUnit = (extra = {}) => ({ id: UID, subject: "gs", klass: GSID, title: "Wasser im Alltag", status: "geplant", version: 4, source: null, createdAt: 1, updatedAt: 1,
  params: { start: "2026-11-02", end: "2026-12-18", weekdays: [{ day: 3, minutes: 45, time: "09:50" }], breaks: [] },
  plan: { lernaufgabe: "Wir erklären, woher unser Wasser kommt.", schritte: [{ titel: "Wasser entdecken", beschreibung: "" }] },
  rows: [{ uid: "r1", stundenfrage: "Wo finden wir Wasser?", date: "2026-11-11", time: "09:50", minutes: 45, ablauf: [], schritt: 0 },
    { uid: "r2", stundenfrage: "Woher kommt das Wasser aus dem Hahn?", date: "2026-11-18", time: "09:50", minutes: 45, ablauf: [], schritt: 0 }],
  course: { gs: courseOf(), classSize: 22 }, slots: [], lessons: [], ...extra });
const unitRoutes = (u) => [[/^GET \/api\/teacher\/units\/u1u1/, () => ({ unit: u() })], [/^GET \/api\/teacher\/basis\?/, () => ({ missing: [], docs: [] })]];

test("F13/F27 + F16: Einheitsseite der Grundschule – kein „Gesicherte Einheit laden“; „Einheit löschen“ auch, wenn nur noch Ausfall-Einträge daran hängen", async () => {
  // a) Grundschule ohne Sitzungen: kein Laden aus einer Datei (die Karte „Einheit als Datei“ fehlt dort)
  fresh();
  server(unitRoutes(() => gsUnit({ status: "entwurf" })));
  await UN.unitPage(UID);
  await D.sleep(5);
  assert.ok(!button($("main"), "Gesicherte Einheit laden"), "Grundschule: kein „Gesicherte Einheit laden“");
  assert.ok(!$("main").textContent.includes("Einheit als Datei"), "kein Verweis auf eine Karte, die es nicht gibt");
  assert.ok(button($("main"), "Löschen") || button($("main"), "Einheit löschen"), "ohne Sitzungen: löschen");
  // b) Gymnasium ohne Sitzungen: unverändert
  fresh();
  server([[/^GET \/api\/teacher\/units\/u1u1/, () => ({ unit: { ...gsUnit({ status: "entwurf" }), subject: "powi", klass: "8B", course: null } })], [/^GET \/api\/teacher\/basis\?/, () => ({ missing: [], docs: [] })]]);
  await UN.unitPage(UID);
  await D.sleep(5);
  assert.ok(button($("main"), "Gesicherte Einheit laden"), "Gymnasium: „Gesicherte Einheit laden“ bleibt");
  assert.ok($("main").textContent.includes("(siehe „Einheit als Datei“ unten)"));
  // c) Grundschule: nur noch ein Ausfall-Eintrag → „Einheit löschen“, die Rückfrage nennt ihn
  fresh();
  let deleted = 0;
  const cancelled = [{ id: LX, title: "Ausfall", date: "2026-11-11", time: "09:50", row: null, code: null, minutes: 45, cancelled: true, hasPlan: false, pdfs: 0, cards: 0, hasContent: false }];
  server([...unitRoutes(() => gsUnit({ lessons: cancelled })), [/^DELETE \/api\/teacher\/units\/u1u1/, () => { deleted++; return {}; }]]);
  await UN.unitPage(UID);
  await D.sleep(5);
  const del = button($("main"), "Einheit löschen");
  assert.ok(del, "nur Ausfall-Einträge: „Einheit löschen“ ist da");
  del.click();
  await D.sleep(5);
  assert.equal($(".modal .body").textContent, "Diese Einheit mit Plan und Tabelle löschen? Ihr Ausfall-Eintrag wird ebenfalls gelöscht.");
  button($(".modal"), "Löschen").click();
  await waitFor(() => deleted === 1, "gelöscht");
  await waitFor(() => globalThis.__go.length, "weiter");
  assert.deepEqual(globalThis.__go, ["#/lk/grundschule/k/" + GSID]);
  // d) eine reguläre Sitzung daneben: kein Löschen (der Server lehnte ab)
  fresh();
  server(unitRoutes(() => gsUnit({ lessons: [...cancelled, { ...cancelled[0], id: L1, row: "r1", cancelled: false }] })));
  await UN.unitPage(UID);
  await D.sleep(5);
  assert.ok(!button($("main"), "Einheit löschen"), "mit regulärer Sitzung: kein „Einheit löschen“");
});

test("F14: roter Kasten auf einer Sitzungsseite – der Prompt nutzt die ganze Einheit; lässt sie sich nicht laden, öffnet sich kein Dialog", async () => {
  fresh();
  const partial = gsUnit({ revise: { open: true, items: [{ id: "x1", date: "2026-11-11", time: "09:50", lengths: [] }], canUndo: false } });
  delete partial.lessons; delete partial.course;
  const full = gsUnit({ revise: partial.revise, lessons: [{ id: L1, title: "Wo finden wir Wasser?", date: "2026-11-18", time: "09:50", row: "r1", code: null, minutes: 45, cancelled: false, hasPlan: true, pdfs: 1, cards: 0, hasContent: true }] });
  let fail = 2;
  const calls = server([[/^GET \/api\/teacher\/units\/u1u1/, () => { if (fail-- > 0) throw new ApiError("Keine Verbindung zum Server. Bitte Internetverbindung prüfen.", 0); return { unit: full }; }]]);
  const box = GSP.reviseBox(partial, { unitLink: true });
  document.getElementById("app").append(box);
  await D.sleep(5);
  assert.equal(calls.length, 1, "lädt die Einheit im Hintergrund (scheitert hier)");
  const btn = button(box, "Einheit mit Claude überarbeiten");
  btn.focus(); btn.click();
  await waitFor(() => toasts().some((t) => t.startsWith("Der Prompt braucht die ganze Einheit")), "Meldung");
  assert.ok(!$(".modal"), "kein Dialog mit einem Prompt aus der unvollständigen Einheit");
  assert.ok(document.activeElement === btn, "Fokus bleibt auf dem Knopf – ist " + desc(document.activeElement));
  // zweiter Klick: lädt, dann der Dialog; der Prompt nennt das Fach des Kurses und die geplante Sitzung
  btn.click();
  await waitFor(() => $(".modal"), "Dialog");
  assert.equal(calls.length, 3);
  button($(".modal"), "Prompt kopieren").click();
  await waitFor(() => D.clip.text, "Prompt kopiert");
  assert.ok(D.clip.text.includes("Fachdidaktiker für Sachunterricht an einer Grundschule"), "Fach des Kurses");
  assert.ok(D.clip.text.includes("[uid r1] Mi, 11.11.2026 09:50 (45 Min.): „Wo finden wir Wasser?“ [Lernschritt 1] – Sitzung " + L1 + " – schon geplant: Verlaufsplan, 1 PDF"), "geplante Sitzung");
  assert.ok(D.clip.text.includes("- Kurs: Sachunterricht · Jahrgang 3 (Klasse 3c), 22 Kinder"), "Kurs mit Kinderzahl");
  button($(".modal"), "Schließen").click();
  assert.ok(document.activeElement === btn, "nach dem Schließen wieder auf dem Knopf – ist " + desc(document.activeElement));
  // dritter Klick: die geladene Einheit genügt, keine weitere Anfrage
  btn.click();
  await D.sleep(5);
  assert.ok($(".modal")); assert.equal(calls.length, 3);
  button($(".modal"), "Schließen").click();
  box.remove();
});

test("F14: lädt die Einheit erst beim Klick und arbeitet die Lehrkraft inzwischen woanders weiter, schiebt sich kein Dialog dazwischen", async () => {
  fresh();
  const partial = gsUnit({ revise: { open: true, items: [{ id: "x1", date: "2026-11-11", time: "09:50", lengths: [] }], canUndo: false } });
  delete partial.lessons;
  let release, fail = 1;
  server([[/^GET \/api\/teacher\/units\/u1u1/, async () => { if (fail-- > 0) throw new ApiError("Fehler 500", 500); await new Promise((r) => { release = r; }); return { unit: gsUnit({ revise: partial.revise }) }; }]]);
  const box = GSP.reviseBox(partial, {});
  const field = document.createElement("input");
  document.getElementById("app").append(box, field);
  await D.sleep(5);
  const btn = button(box, "Einheit mit Claude überarbeiten");
  btn.focus(); btn.click();
  await waitFor(() => release, "lädt");
  field.focus();
  release();
  await waitFor(() => toasts().includes("Die Einheit ist geladen – wählen Sie „Einheit mit Claude überarbeiten“ noch einmal."), "Hinweis");
  assert.ok(!$(".modal"), "kein Dialog"); assert.ok(document.activeElement === field, "Fokus bleibt im Feld");
  btn.focus(); btn.click();
  await D.sleep(5);
  assert.ok($(".modal"), "der nächste Klick öffnet den Dialog sofort");
  button($(".modal"), "Schließen").click();
  box.remove(); field.remove();
});

test("F38: Elternansicht – „Erneut versuchen“ gibt den Fokus an die Überschrift der geladenen Seite (bzw. an den neuen Knopf)", async () => {
  fresh();
  const TOKEN = "t".repeat(32);
  const ok = { ok: true, state: "open", now: Date.now(), lesson: { id: L1, title: "Wo finden wir Wasser?", date: "2026-11-11" }, course: { label: "Sachunterricht · Jahrgang 3 (Klasse 3c)" },
    summary: "Wir haben Wasser gesucht.", files: [], cards: [], previous: [] };
  let fails = 2;
  globalThis.fetch = async () => { if (fails-- > 0) throw new TypeError("Failed to fetch"); return new Response(JSON.stringify(ok), { status: 200, headers: { "Content-Type": "application/json" } }); };
  await PA.parentsPage(TOKEN, null, null, null);
  await D.sleep(5);
  let retry = button($("main"), "Erneut versuchen");
  assert.ok(retry, "Netzfehler: „Erneut versuchen“");
  retry.focus(); D.press("Enter");
  await waitFor(() => button($("main"), "Erneut versuchen") && button($("main"), "Erneut versuchen") !== retry, "zweiter Fehlschlag");
  retry = button($("main"), "Erneut versuchen");
  assert.ok(document.activeElement === retry, "erneut gescheitert: Fokus auf dem neuen Knopf – ist " + desc(document.activeElement));
  D.press("Enter");
  await waitFor(() => $("main h1") && $("main h1").textContent === "Wo finden wir Wasser?", "geladen");
  assert.ok(document.activeElement === $("main h1"), "geladen: Fokus auf der Überschrift – ist " + desc(document.activeElement));
  // erster Aufruf des Links ohne Fehler: der Fokus bleibt am Anfang der Seite (wie bisher)
  delete globalThis.fetch;
});

/* ---------- Fokusrahmen der gelben PDF-Verweise: sichtbar in beiden Farbschemata (F15/F29) ---------- */
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
const tokens = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("F15/F29: Fokusrahmen der PDF-Verweise (außerhalb des gelben Kastens) hebt sich im hellen und im dunklen Schema vom Hintergrund ab (≥ 3:1)", () => {
  const light = tokens(/:root\s*\{([\s\S]*?)\n\}/.exec(css)[1]);
  const dark = { ...light, ...tokens(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/.exec(css)[1]) };
  const rule = /\.pdfref:focus-visible\s*\{([^}]*)\}/.exec(css)[1];
  const m = /outline:\s*(\d+)px\s+solid\s+(var\((--[\w-]+)\)|#[0-9a-f]{6})/i.exec(rule);
  assert.ok(m, "Fokusrahmen: " + rule);
  assert.ok(Number(/outline-offset:\s*(-?\d+)px/.exec(rule)[1]) > 0, "Rahmen außerhalb des Kastens");
  for (const [name, t] of [["hell", light], ["dunkel", dark]]) {
    const ring = m[3] ? t[m[3]] : m[2];
    for (const bg of ["--surface", "--paper"]) assert.ok(contrast(ring, t[bg]) >= 3, name + ": Rahmen " + ring + " auf " + bg + " " + t[bg] + " = " + contrast(ring, t[bg]).toFixed(2) + ":1");
  }
  assert.equal(css.match(/\.pdfref[^{]*:focus/g).length, 1, "keine weitere Regel überschreibt den Rahmen");
});
