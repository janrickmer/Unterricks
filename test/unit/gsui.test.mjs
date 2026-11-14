// Oberfläche der Grundschul-Sitzung im Browser-Ersatz (fake-dom.mjs, Attrappen für app.js und teacher.js, Server über globalThis.__tapi):
// Befunde der Abschlussprüfung, Gruppe C – Verlaufsplan nach dem Druck, Bildkarten, Materialkasten, Dialoge, Fokus und Beschriftungen.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const LID = "a1".repeat(8), L2 = "a2".repeat(8), UNIT = "b1".repeat(8), A = "c1".repeat(8), B = "c2".repeat(8), C = "c3".repeat(8), R = "c4".repeat(8);
const D = installDom({ hash: "#/lk/s/" + LID });
const { h, ApiError } = await import("../../public/ui.js");
const GSS = await import("../../public/gssession.js");
const PV = await import("../../public/portalview.js");
const CA = await import("../../public/cards.js");
const { resetPrintQueue } = await import("../../public/designrender.js");
const { STOP_LINE } = await import("../../public/shared.js");

/* Server-Attrappe: [Muster für „METHODE /pfad“, (Treffer, body) → Antwort]; alle Anfragen in calls */
function server(routes) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  return calls;
}
const pdf = (id, name, extra = {}) => ({ id, name, area: "student", kind: "file", mime: "application/pdf", size: 1000, pages: 1, status: "ready", source: "upload", createdAt: 1, ...extra });
const lessonOf = (extra = {}) => ({ id: LID, subject: "gs", klass: "gs1", title: "Josef in Ägypten", topic: "Josef", date: "2026-11-10", startTime: "08:00", durationMin: 45, ideas: "", homework: "",
  portal: "", portalVersion: 1, portalUpdatedAt: 1, portalSource: "lehrkraft", parentSummary: "", parentNote: "", createdAt: 1, unitId: null, unitRow: null, cancelled: false, ...extra });
const course = { gs: { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", subjectName: "Religion", grade: 2, classes: ["a", "b"], gradeText: "Jahrgangsstufe 2 der Grundschule" }, classSize: 22 };
const unitOf = (extra = {}) => ({ id: UNIT, subject: "gs", klass: "gs1", title: "Josef", version: 3, plan: { schritte: [], lernaufgabe: "" }, params: {}, revise: null,
  rows: [{ uid: "r1", stundenfrage: "Wer war Josef?", ablauf: [], schritt: null, date: "2026-11-10", time: "08:00" }], ...extra });
const portalOk = (b) => ({ portal: { text: b.text, version: 2, updatedAt: 2, source: "lehrkraft" } });
const base = (token = "tokA") => [[/^GET \/api\/teacher\/lessons\/\w+\/parent-link$/, () => ({ token: typeof token === "function" ? token() : token })], [/^PUT \/api\/teacher\/lessons\/\w+\/portal$/, (m, b) => portalOk(b)]];
async function page(d, routes = []) {
  if (globalThis.__leave) globalThis.__leave();
  document.querySelectorAll(".modal-back, .ctxmenu").forEach((x) => x.remove());
  resetPrintQueue();
  globalThis.__go = [];
  const calls = server([...routes, ...base()]);
  await GSS.gsSessionPage(d.lesson.id, { course, messages: [], refFiles: [], files: [], unit: null, ...d });
  await D.sleep(5);
  return calls;
}
const $ = (s) => document.querySelector(s);
const button = (root, text) => [...(root || document).querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const modalButton = (text) => button($(".modal"), text);
// nie DOM-Knoten an assert.equal geben: die Fehlermeldung bildete den ganzen Seitenbaum ab (Speicher)
const desc = (el) => (el ? el.tagName + (el.id ? "#" + el.id : "") + " „" + el.textContent.trim().slice(0, 40) + "“" : String(el));
const same = (a, b, msg) => assert.ok(a === b, (msg || "") + " – ist " + desc(a) + ", erwartet " + desc(b));
const none = (a, msg) => assert.ok(!a, (msg || "") + " – noch da: " + desc(a));
const click = (a) => { const ev = new D.Event("click", { bubbles: true, cancelable: true }); a.dispatchEvent(ev); return ev.defaultPrevented; };

test("F10/F32 + F09: im Verlaufsplan gilt nur gestaltetes Material ohne PDF als „wird gedruckt …“; beim Klick zählt der Stand der Datei", () => {
  const files = {
    [A]: pdf(A, "Arbeitsblatt.pdf", { status: "pending", design: { outdated: true, error: null } }),
    [C]: pdf(C, "Bildkarten.pdf", { area: "teacher", status: "processing", cards: { texts: [], share: false, rev: 0, version: 1, current: false } }),
    [R]: pdf(R, "Vorlesetext.pdf", { status: "pending", designed: true }),
  };
  const box = h("div"); document.body.append(box);
  let pend = 0;
  PV.paintPlanPreview(box, "- [[pdf:" + A + "]]\n- [[pdf:" + C + "]]\n- [[pdf:" + R + "]]", { fileOf: (id) => files[id] || null, onPending: () => pend++ });
  const links = box.querySelectorAll("a.pdfref");
  assert.deepEqual(links.map((a) => a.firstChild.textContent), ["Arbeitsblatt.pdf (wird gedruckt …)", "Bildkarten.pdf", "Vorlesetext.pdf (wird gedruckt …)"]);
  assert.equal(click(links[1]), false, "hochgeladene Bildkarten (Bilder entstehen noch) öffnen sich");
  assert.equal(click(links[0]), true); assert.equal(pend, 1);
  // gedruckt, ohne dass der Verlaufsplan neu gezeichnet wurde: der Link öffnet die PDF
  Object.assign(files[A], { status: "ready", design: { outdated: false, error: null } });
  assert.equal(click(links[0]), false); assert.equal(pend, 1);
  assert.equal(PV.refPending({ status: "processing", cards: {} }), false);
  assert.equal(PV.refPending({ status: "pending", design: {} }), true);
  assert.equal(PV.refPending({ status: "ready", design: { outdated: true } }), false, "neue Gestaltung, alte PDF da: öffnet die bisherige");
  box.remove();
});

test("F09: ist die PDF gedruckt, verschwindet „(wird gedruckt …)“ im Verlaufsplan sofort – der Fokus eines Verweises bleibt", async () => {
  let release;
  const printed = new Promise((r) => { release = r; });
  const des = { outdated: true, error: null, htmlAt: 5, pdfAt: null, text: "" };
  await page({ lesson: lessonOf({ portal: "**1) Arbeitsblatt**\n- [[pdf:" + A + "]]" }), files: [pdf(A, "Arbeitsblatt.pdf", { status: "pending", design: des })] },
    [[/^POST \/api\/teacher\/files\/\w+\/render$/, async () => { await printed; return { file: pdf(A, "Arbeitsblatt.pdf", { size: 2000, design: { ...des, outdated: false, pdfAt: 5 } }) }; }]]);
  const ref = () => $("#gsplan a.pdfref");
  assert.equal(ref().firstChild.textContent, "Arbeitsblatt.pdf (wird gedruckt …)");
  ref().focus();
  release();
  await D.sleep(20);
  assert.equal(ref().firstChild.textContent, "Arbeitsblatt.pdf");
  same(document.activeElement, ref(), "Fokus auf dem neu gezeichneten Verweis");
  assert.ok($("#gs-parents").textContent.includes("Eltern sehen von dieser Sitzung: „Arbeitsblatt.pdf“"));
  assert.deepEqual(globalThis.__domErrors.map(String), []);
});

test("F33: Löschen und Umbenennen im Materialkasten – Druckliste, „Eltern sehen …“ und Verlaufsplan sofort aktuell", async () => {
  const ab = pdf(B, "AB Josef.pdf", { print: { copies: 22, duplex: true, color: false }, printName: "22x - beidseitig - sw - AB Josef.pdf" });
  await page({ lesson: lessonOf({ portal: "- [[pdf:" + B + "]]" }), files: [ab] }, [
    [/^PATCH \/api\/teacher\/files\/\w+$/, (m, b) => { const n = b.name.replace(/\.pdf$/, "") + ".pdf"; return { file: { ...ab, name: n, printName: "22x - beidseitig - sw - " + n } }; }],
    [/^DELETE \/api\/teacher\/files\/\w+$/, () => ({})]]);
  await D.sleep(5);
  assert.ok($("#gs-parents").textContent.includes("„AB Josef.pdf“"));
  globalThis.prompt = () => "AB Josef neu";
  $('#gs-material button[aria-label="Umbenennen"]').click();
  await D.sleep(10);
  assert.deepEqual($("#printcard").querySelectorAll(".printrow .name").map((x) => x.textContent), ["22x - beidseitig - sw - AB Josef neu.pdf"], "Druckliste mit dem neuen Namen");
  assert.ok($("#gsplan a.pdfref").textContent.startsWith("AB Josef neu.pdf"), "Verlaufsplan mit dem neuen Namen");
  assert.ok($("#gs-parents").textContent.includes("„AB Josef neu.pdf“"));
  // umgekehrt: in der Druckliste umbenannt – auch der Materialkasten zeigt den neuen Namen
  globalThis.prompt = () => "AB Josef final";
  $('#printcard button[aria-label="Umbenennen – AB Josef neu.pdf"]').click();
  await D.sleep(10);
  assert.ok($("#gs-material .item .name").textContent === "AB Josef final.pdf", $("#gs-material .item .name").textContent);
  assert.ok($("#gsplan a.pdfref").textContent.startsWith("AB Josef final.pdf") && $("#gs-parents").textContent.includes("„AB Josef final.pdf“"));
  $('#gs-material button[aria-label="Löschen"]').click();
  await D.sleep(5);
  modalButton("Löschen").click();
  await D.sleep(10);
  assert.equal($("#printcard").querySelectorAll(".printrow").length, 0, "Druckliste ohne die gelöschte Datei");
  assert.ok($("#gs-parents").textContent.includes("Eltern sehen von dieser Sitzung: noch kein Material"));
  assert.equal($("#gsplan .pdfref").textContent, "PDF nicht gefunden");
  delete globalThis.prompt;
  assert.deepEqual(globalThis.__domErrors.map(String), []);
});

test("F36: „Zwischenstopp entfernen“ – der Fokus geht auf „Zwischenstopp eintragen …“ statt auf body", async () => {
  await page({ lesson: lessonOf({ portal: "**1) Ankommen**\n" + STOP_LINE + "\n**2) Rätsel**" }) });
  const un = button($("#gsplan"), "Zwischenstopp entfernen");
  assert.ok(un && !un.classList.contains("hidden"));
  D.userClick(un);
  assert.ok(un.classList.contains("hidden"));
  same(document.activeElement, button($("#gsplan"), "Zwischenstopp eintragen …"));
});

test("F41: Felder der Sitzungsdaten haben zugängliche Namen (label for)", async () => {
  await page({ lesson: lessonOf() });
  const meta = $("#gs-meta");
  const named = Object.fromEntries(meta.querySelectorAll("label").map((l) => [l.textContent, l.getAttribute("for") ? document.getElementById(l.getAttribute("for")) : null]));
  for (const [k, tag] of [["Titel", "INPUT"], ["Thema", "INPUT"], ["Datum", "INPUT"], ["Beginn (Uhrzeit)", "INPUT"], ["Dauer (Minuten)", "INPUT"], ["Ideen und Wünsche", "TEXTAREA"]]) {
    assert.ok(named[k] && named[k].tagName === tag && meta.contains(named[k]), "„" + k + "“ beschriftet sein Feld");
  }
  assert.equal(named["Datum"].getAttribute("aria-label"), "Datum der Sitzung", "Name wie bisher (E2E und Gymnasium)");
});

test("F31: Konflikt-Dialog ohne Wahl geschlossen – der Text bleibt ungespeichert und wird beim Zurückkehren nicht ersetzt", async () => {
  const current = { text: "**1) Fassung von Claude**", version: 2, updatedAt: 2, source: "claude" };
  await page({ lesson: lessonOf({ portal: "**1) Alt**" }) }, [
    [/^PUT \/api\/teacher\/lessons\/\w+\/portal$/, (m, b) => { if (b.force) return portalOk(b); throw new ApiError("Konflikt", 409, { code: "portal_conflict", current }); }],
    [/^GET \/api\/teacher\/lessons\/\w+$/, () => ({ lesson: lessonOf({ portal: current.text, portalVersion: 2, portalSource: "claude" }), files: [], refFiles: [], messages: [], unit: null })]]);
  const edit = button($("#gsplan"), "Bearbeiten");
  edit.click();
  const ta = $("#gsplan-text");
  ta.value = "**1) Meine Fassung**";
  D.fire(ta, "input");
  button($("#gsplan"), "Fertig").click();
  await D.sleep(10);
  assert.ok($(".modal") && $(".modal").textContent.includes("Welche Fassung soll gelten?"));
  D.press("Escape");
  await D.sleep(5);
  none($(".modal"));
  assert.ok($("#gsplan .save-state").textContent.includes("Nicht gespeichert – Konflikt offen"), $("#gsplan .save-state").textContent);
  D.fire(document, "visibilitychange");
  await D.sleep(10);
  assert.equal(ta.value, "**1) Meine Fassung**", "nicht still durch die gespeicherte Fassung ersetzt");
  assert.ok($("#gsplan .pl").textContent.includes("Meine Fassung"));
});

test("F31: solange der Konflikt-Dialog offen ist, gilt der Text als ungespeichert – Zurückkehren ersetzt ihn nicht, Verlassen fragt nach", async () => {
  const current = { text: "**1) Fassung von Claude**", version: 2, updatedAt: 2, source: "claude" };
  const puts = [];
  await page({ lesson: lessonOf({ portal: "**1) Alt**" }) }, [
    [/^PUT \/api\/teacher\/lessons\/\w+\/portal$/, (m, b) => { puts.push(b); if (b.force || b.baseVersion === 2) return portalOk(b); throw new ApiError("Konflikt", 409, { code: "portal_conflict", current }); }],
    [/^GET \/api\/teacher\/lessons\/\w+$/, () => ({ lesson: lessonOf({ portal: current.text, portalVersion: 2, portalSource: "claude" }), files: [], refFiles: [], messages: [], unit: null })]]);
  await D.sleep(10);
  document.querySelectorAll(".modal-back").forEach((x) => x.remove());   // Konflikt-Dialog der vorigen Seite (sie speichert beim Verlassen)
  puts.length = 0;
  button($("#gsplan"), "Bearbeiten").click();
  const ta = $("#gsplan-text");
  ta.value = "**1) Meine Fassung**";
  D.fire(ta, "input");
  button($("#gsplan"), "Fertig").click();
  await D.sleep(10);
  assert.ok($(".modal") && $(".modal").textContent.includes("Welche Fassung soll gelten?"));
  D.fire(document, "visibilitychange");   // zurück aus dem Tab mit Claude, der Dialog ist noch offen
  await D.sleep(10);
  assert.equal(ta.value, "**1) Meine Fassung**", "nicht still durch die gespeicherte Fassung ersetzt");
  const ev = new D.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, "Verlassen der Seite: der Browser fragt nach");
  modalButton("Meine Fassung speichern").click();
  await D.sleep(20);
  none($(".modal"), "kein zweiter Konflikt-Dialog");
  assert.ok(puts.length >= 2 && puts.slice(1).every((b) => b.text === "**1) Meine Fassung**"), JSON.stringify(puts));
  assert.ok($("#gsplan .save-state").textContent.startsWith("Gespeichert"), $("#gsplan .save-state").textContent);
});

test("F28: „Sitzungslink für Eltern kopieren“ holt den Link beim Zurückkehren neu (erneuert oder nach einer Krankmeldung weitergegeben)", async () => {
  let token = "tokA";
  if (globalThis.__leave) globalThis.__leave();
  resetPrintQueue();
  server([[/^GET \/api\/teacher\/lessons\/\w+\/parent-link$/, () => ({ token })], [/^GET \/api\/teacher\/lessons\/\w+$/, () => ({ lesson: lessonOf(), files: [], refFiles: [], messages: [], unit: null })],
    [/^POST \/api\/teacher\/lessons\/\w+\/parent-link$/, () => { token = token || "tokNeu"; return { token }; }]]);
  await GSS.gsSessionPage(LID, { course, messages: [], refFiles: [], files: [], unit: null, lesson: lessonOf() });
  await D.sleep(5);
  $("#gs-copy").click();
  await D.sleep(5);
  assert.ok(D.clip.text.endsWith("#/eltern/tokA"), D.clip.text);
  token = "tokB";   // in einem anderen Fenster erneuert
  D.fire(document, "visibilitychange");
  $("#gs-copy").click();
  await D.sleep(5);
  assert.ok(D.clip.text.endsWith("#/eltern/tokB"), D.clip.text);
  token = null;     // Krankmeldung im anderen Fenster: der Link gehört jetzt dem Ausfall-Eintrag
  D.fire(window, "focus", { bubbles: false });
  await D.sleep(5);
  $("#gs-copy").click();
  await D.sleep(5);
  assert.ok(D.clip.text.endsWith("#/eltern/tokNeu"), "neuer Link statt des weitergegebenen: " + D.clip.text);
});

test("F26: „Stunde ausfallen lassen?“ nimmt den Fokus (Abbrechen) und öffnet sich nie doppelt; gefährliche Rückfragen ebenso", async () => {
  await page({ lesson: lessonOf({ unitId: UNIT, unitRow: "r1" }), unit: unitOf() }, [
    [/^POST \/api\/teacher\/lessons\/\w+\/cancel$/, () => ({ version: 3, plan: { cancelled: { date: "2026-11-10", time: "08:00" }, moves: [{ n: 1, title: "Wer war Josef?", from: { date: "2026-11-10", time: "08:00" }, to: null }], undatedRows: [] } })]]);
  const sick = $("#gs-sick-btn");
  D.userClick(sick);
  sick.click();   // Enter auf dem Knopf, bevor der Dialog den Fokus hat
  await D.sleep(60);
  assert.equal(document.querySelectorAll(".modal").length, 1, "nur ein Dialog");
  assert.ok($(".modal").contains(document.activeElement) && document.activeElement.textContent === "Abbrechen", "Fokus im Dialog – ist " + desc(document.activeElement));
  D.press("Escape");
  same(document.activeElement, sick, "zurück zum Auslöser");
  D.userClick(sick);
  await D.sleep(60);
  assert.equal(document.querySelectorAll(".modal").length, 1, "nach dem Schließen wieder zu öffnen");
  D.press("Escape");
  // gefährliche Rückfrage (z. B. „Link erneuern“): Fokus auf „Abbrechen“
  $("#gs-renew").focus();
  D.press("Enter");
  await D.sleep(60);
  assert.ok($(".modal") && document.activeElement.textContent === "Abbrechen" && $(".modal").contains(document.activeElement));
  D.press("Escape");
  same(document.activeElement, $("#gs-renew"));
});

test("F11/F25: „Krankmeldung rückgängig machen“ auf der Seite des Ausfall-Eintrags führt zur Sitzung, die wieder an diesem Termin liegt", async () => {
  const revise = { open: true, canUndo: true, undoId: "u1", items: [{ id: "i1", date: "2026-11-10", time: "08:00", placeholderId: LID, lessonId: L2, title: "Wer war Josef?" }] };
  const routes = (afterUnit) => [
    [/^GET \/api\/teacher\/units\/\w+$/, () => ({ unit: { ...unitOf({ revise }), lessons: [{ id: L2, title: "Wer war Josef?", date: "2026-11-12", time: "08:00" }, { id: LID, title: "Ausgefallen", date: "2026-11-10", cancelled: true }] } })],
    [/^POST \/api\/teacher\/units\/\w+\/cancel\/undo$/, () => ({ unit: afterUnit })],
    [/^PATCH \/api\/teacher\/units\/\w+$/, () => ({ unit: { ...unitOf({ revise: { ...revise, open: false } }), lessons: [{ id: L2 }, { id: LID, cancelled: true }] } })]];
  await page({ lesson: lessonOf({ cancelled: true, unitId: UNIT, title: "Ausgefallen" }), unit: unitOf({ revise }) },
    routes({ ...unitOf(), lessons: [{ id: L2, title: "Wer war Josef?", date: "2026-11-10", time: "08:00" }] }));
  assert.ok($(".revisebox"));
  button($(".revisebox"), "Krankmeldung rückgängig machen").click();
  await D.sleep(5);
  modalButton("Rückgängig machen").click();
  await D.sleep(10);
  assert.deepEqual(globalThis.__go, ["#/lk/s/" + L2], "zur wieder eingeplanten Sitzung – nie zurück auf den gelöschten Ausfall-Eintrag");
  // ohne die Sitzung (z. B. inzwischen gelöscht): zur Einheit
  await page({ lesson: lessonOf({ cancelled: true, unitId: UNIT, title: "Ausgefallen" }), unit: unitOf({ revise }) }, routes({ ...unitOf(), lessons: [] }));
  button($(".revisebox"), "Krankmeldung rückgängig machen").click();
  await D.sleep(5);
  modalButton("Rückgängig machen").click();
  await D.sleep(10);
  assert.deepEqual(globalThis.__go, ["#/lk/u/" + UNIT]);
  // „Erledigt – Hinweis entfernen“: der Ausfall-Eintrag bleibt – diese Seite neu laden
  await page({ lesson: lessonOf({ cancelled: true, unitId: UNIT, title: "Ausgefallen" }), unit: unitOf({ revise }) }, routes(null));
  button($(".revisebox"), "Erledigt – Hinweis entfernen").click();
  await D.sleep(10);
  assert.deepEqual(globalThis.__go, ["#/lk/s/" + LID]);
});

test("F35: Kontextmenü – Esc und Auswahl geben den Fokus an den Auslöser zurück, Tab über den letzten Eintrag hinaus schließt das Menü und geht vom Auslöser aus weiter", async () => {
  const before = h("button", { type: "button" }, "Davor"), opener = h("button", { type: "button" }, "PDF-Verweis einfügen …"), next = h("button", { type: "button" }, "Weiter");
  const wrap = h("div", null, before, opener, next); document.body.append(wrap);
  let picked = 0;
  const open = async () => { opener.focus(); PV.contextMenu(10, 10, [{ label: "Eins", onClick: () => picked++ }, { label: "Zwei", onClick: () => picked++ }, { label: "Drei", onClick: () => picked++ }]); await D.sleep(2); };
  const at = (t, msg) => assert.ok(document.activeElement.textContent === t, (msg || "") + " – ist " + desc(document.activeElement));
  await open();
  at("Eins");
  D.press("Escape");
  none($(".ctxmenu")); same(document.activeElement, opener, "Esc: zurück zum Auslöser");
  // Tastatur: alle Einträge erreichbar (Tab und Pfeiltasten) – erst über den letzten hinaus schließt Tab das Menü
  await open();
  D.press("Tab"); at("Zwei", "Tab: nächster Eintrag"); assert.ok($(".ctxmenu"), "Menü bleibt offen");
  D.press("ArrowDown"); at("Drei"); D.press("ArrowDown"); at("Eins", "Pfeil nach unten am Ende: wieder oben");
  D.press("ArrowUp"); at("Drei"); D.press("Home"); at("Eins"); D.press("End"); at("Drei");
  D.press("Tab");
  none($(".ctxmenu"), "Tab über den letzten Eintrag hinaus schließt das Menü"); same(document.activeElement, next, "… und geht vom Auslöser aus weiter");
  await open();
  D.press("Tab", { shiftKey: true });
  none($(".ctxmenu"), "Umschalt+Tab vor dem ersten Eintrag schließt das Menü"); same(document.activeElement, opener, "… zurück auf den Auslöser");
  await open();
  D.press("Tab"); D.press("Enter");
  assert.equal(picked, 1, "Enter wählt den zweiten Eintrag"); none($(".ctxmenu")); same(document.activeElement, opener);
  await open();
  D.userClick(button($(".ctxmenu"), "Zwei"));
  assert.equal(picked, 2); none($(".ctxmenu")); same(document.activeElement, opener, "Auswahl: zurück zum Auslöser");
  // der Fokus woanders (z. B. ein Dialog): nicht zurückholen
  await open();
  const other = h("input"); document.body.append(other);
  other.focus();
  none($(".ctxmenu"), "Fokus außerhalb: Menü zu"); same(document.activeElement, other);
  wrap.remove(); other.remove();
});

/* ---------- Bildkarten (cards.js) ---------- */
async function cardsSetup(id, { getFails = 0 } = {}) {
  if (globalThis.__leave) globalThis.__leave();
  document.querySelectorAll(".modal-back").forEach((x) => x.remove());
  resetPrintQueue();
  const set = pdf(id, "Arche Noah.pdf", { area: "teacher", pages: 2, cards: { texts: ["", ""], share: false, rev: 0, version: 7, current: true, pages: 2 } });
  const srv = { texts: ["", ""], share: false, rev: 0, current: true, pages: 2, version: 7, img: { base: "/api/img/", q: "" }, w: 100, h: 70 };
  const calls = server([
    [/^GET \/api\/teacher\/files\/\w+\/cards$/, () => { if (getFails-- > 0) throw new ApiError("Keine Verbindung zum Server.", 0); return { ...srv }; }],
    [/^PUT \/api\/teacher\/files\/\w+\/cards$/, (m, b) => { Object.assign(srv, { texts: b.texts || srv.texts, rev: srv.rev + 1 }); return { cards: { texts: srv.texts, share: srv.share, rev: srv.rev } }; }],
    [/^POST \/api\/teacher\/files\/\w+\/link$/, () => { throw new ApiError("Keine Verbindung zum Server.", 0); }],
    [/^DELETE \/api\/teacher\/files\/\w+$/, () => ({})]]);
  const st = { files: [set] };
  const card = CA.cardsCard({ lessonId: LID, st, insertRef: () => {}, onChange: () => {} });
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  app.append(card.el);
  await D.sleep(5);
  return { calls, srv, st };
}

test("F34: scheitert die Bilderstellung, bleibt ein gerade getippter Erzähltext stehen (und wird gespeichert)", async () => {
  const { calls, srv } = await cardsSetup(C);
  const ta = $("#cs-t-" + C + "-1");
  ta.focus();
  ta.value = "Noah baut eine Arche.";
  ta.setSelectionRange(4, 4);
  D.fire(ta, "input");
  CA.queueCards({ id: C, version: 7 }, { again: true });
  await D.sleep(20);
  const now = $("#cs-t-" + C + "-1");
  assert.ok(now && now !== ta, "der Satz wurde neu aufgebaut");
  assert.ok($("#cs-" + C).textContent.includes("Die Bilder ließen sich nicht erstellen"));
  assert.equal(now.value, "Noah baut eine Arche.", "getippter Text nicht verworfen");
  same(document.activeElement, now); assert.equal(now.selectionStart, 4, "Schreibmarke bleibt");
  assert.deepEqual(srv.texts, ["Noah baut eine Arche.", ""], "gespeichert");
  assert.ok(calls.some((x) => x.method === "PUT"));
});

test("F34: auch ein noch nicht geladener Kartensatz (frisch hochgeladen, Laden gescheitert) speichert den getippten Erzähltext", async () => {
  const { calls, srv } = await cardsSetup(B, { getFails: 1 });
  const ta = $("#cs-t-" + B + "-2");
  ta.focus();
  ta.value = "Die Tiere gehen in die Arche.";
  D.fire(ta, "input");
  CA.queueCards({ id: B, version: 7 }, { again: true });   // scheitert (keine Verbindung)
  await D.sleep(20);
  assert.equal($("#cs-t-" + B + "-2").value, "Die Tiere gehen in die Arche.");
  assert.deepEqual(srv.texts, ["", "Die Tiere gehen in die Arche."], "gespeichert – vorher blieb der Text ohne geladenen Stand (rev) ungespeichert");
  assert.ok(calls.some((x) => x.method === "PUT"));
});

test("F37: „Bilder erneut erstellen“ und „Löschen“ lassen den Fokus nicht auf body fallen", async () => {
  await cardsSetup(R);
  CA.queueCards({ id: R, version: 7 }, { again: true });
  await D.sleep(20);
  const retry = button($("#cs-" + R), "Bilder erneut erstellen");
  assert.ok(retry && retry.id === "cs-retry-" + R);
  D.userClick(retry);
  assert.ok(document.activeElement.tagName === "H3", "Fokus auf der Überschrift des Satzes – ist " + desc(document.activeElement));
  assert.equal(document.activeElement.textContent, "Arche Noah.pdf");
  await D.sleep(20);   // scheitert erneut: der Satz wird wieder neu aufgebaut, der Fokus bleibt
  assert.ok(document.activeElement.id === "cs-h-" + R, "ist " + desc(document.activeElement));
  D.userClick(button($("#cs-" + R), "Löschen"));
  await D.sleep(40);
  assert.ok(document.activeElement.textContent === "Abbrechen", "Rückfrage mit Fokus – ist " + desc(document.activeElement));
  modalButton("Endgültig löschen").click();
  await D.sleep(10);
  none($("#cs-" + R));
  assert.ok(document.activeElement.id === "gs-cards-h", "nach dem Löschen: Überschrift „Bildkarten“ – ist " + desc(document.activeElement));
});

/* ---------- Anforderung 13 (S11): offener Teil der vorigen Sitzung, Hinweis nach dem Setzen eines Zwischenstopps ---------- */
test("S11: Karte zum Zwischenstopp der vorigen Sitzung direkt unter dem Verlaufsplan – Nicht geschafft (mit PDF-Namen) und Stand der Entscheidung", async () => {
  const prevFile = { ...pdf(A, "Arbeitsblatt Josef.pdf"), lessonId: L2, previous: true };
  const ps = { id: L2, title: "Josef und seine Brüder", date: "2026-11-05", portal: "**1) Erzählung (10 Min.)**\n" + STOP_LINE + "\n**2) Arbeitsblatt (15 Min.)**\n- [[pdf:" + A + "]]",
    portalVersion: 2, done: "**1) Erzählung (10 Min.)**", open: "**2) Arbeitsblatt (15 Min.)**\n- [[pdf:" + A + "]]", row: null, decision: null, openFiles: [{ id: A, name: "Arbeitsblatt Josef.pdf" }] };
  await page({ lesson: lessonOf({ portal: "**1) Ankommen**" }), refFiles: [prevFile], previousStop: ps });
  const card = $("#gs-prevstop");
  assert.ok(card && $("#gsplan").nextElementSibling === card, "unter dem Verlaufsplan (der Verlaufsplan bleibt erste Karte)");
  assert.equal($("#gs-prevstop-h").textContent, "Hinweis: Die letzte Stunde wurde nicht vollständig beendet");
  assert.equal($("#gs-prevstop-open").textContent, "Nicht geschafft: 2) Arbeitsblatt (15 Min.)");
  assert.equal($("#gs-prevstop-state").textContent, "Beim Planen mit Claude („Stunde mit Claude planen“) erklärt Claude, was offen geblieben ist, und fragt Sie, ob es in diese Stunde übernommen oder darauf verzichtet wird.");
  assert.equal(card.querySelectorAll(".stopfield").length, 1, "Vorschau des Verlaufsplans wie bisher");
  assert.equal(card.querySelector("a.pdfref").firstChild.textContent, "Arbeitsblatt Josef.pdf");
  // entschieden (mit Claude), mit Einheit
  await page({ lesson: lessonOf({ portal: "**1) Ankommen**", unitId: UNIT, unitRow: "r1" }), unit: unitOf(), refFiles: [prevFile], previousStop: { ...ps, decision: { choice: "verzichten", at: Date.parse("2026-11-09T09:00:00Z") } } });
  assert.equal($("#gs-prevstop-state").textContent, "Entschieden am Mo, 09.11.2026: Auf den offenen Teil wird verzichtet.");
  assert.ok($("#gs-prevstop-state").classList.contains("decided"));
  D.userClick(button($("#gs-prevstop"), "Ausblenden"));
  none($("#gs-prevstop"), "ausgeblendet");
  assert.ok(document.activeElement.id === "gsplan-h", "nach „Ausblenden“: Überschrift „Verlaufsplan“ – ist " + desc(document.activeElement));
  // ohne Zwischenstopp der vorigen Sitzung keine Karte
  await page({ lesson: lessonOf() });
  none($("#gs-prevstop"));
});

/* Nachtrag 26: erledigt (mit Claude entschieden, danach den Verlaufsplan dieser Sitzung gespeichert) → die Karte verschwindet ganz; ändert sich die vorige
   Sitzung (Entscheidung ungültig), ist sie wieder da. Beim Zurückkehren in den Tab ohne Neuladen, nach dem Speichern auf der Seite sofort. */
test("Nachtrag 26: Karte verschwindet nach Entscheidung + Speichern – vom Server (Zurückkehren), nach dem Speichern auf der Seite, Fokus bleibt auf der Seite", async () => {
  const at0 = Date.parse("2026-11-09T09:00:00Z");
  const ps = { id: L2, title: "Josef und seine Brüder", date: "2026-11-05", portal: "**1) Erzählung**\n" + STOP_LINE + "\n**2) Arbeitsblatt**", portalVersion: 2,
    done: "**1) Erzählung**", open: "**2) Arbeitsblatt**", row: null, decision: null, settled: false, openFiles: [] };
  // vom Server schon erledigt: keine Karte, der Verlaufsplan bleibt erste Karte, nichts dazwischen
  await page({ lesson: lessonOf({ portal: "**1) Ankommen**" }), previousStop: { ...ps, decision: { choice: "uebernehmen", at: at0 }, settled: true } });
  none($("#gs-prevstop"), "erledigt: keine Karte");
  assert.ok($("#gsplan").nextElementSibling && $("#gsplan").nextElementSibling.id !== "gs-prevstop");
  // nur entschieden: Karte mit „Entschieden am …“; die Lehrkraft speichert den Verlaufsplan auf der Seite → Karte weg, ohne Neuladen
  let server = { ...ps, decision: { choice: "verzichten", at: at0 } };
  const get = [/^GET \/api\/teacher\/lessons\/\w+$/, () => ({ lesson: lessonOf({ portal: "**1) Ankommen**" }), files: [], refFiles: [], messages: [], unit: null, previousStop: server })];
  const calls = await page({ lesson: lessonOf({ portal: "**1) Ankommen**" }), previousStop: server }, [get,
    [/^PUT \/api\/teacher\/lessons\/\w+\/portal$/, (m, b) => ({ portal: { text: b.text, version: 2, updatedAt: at0 + 5000, source: "lehrkraft" } })]]);
  assert.equal($("#gs-prevstop-state").textContent, "Entschieden am Mo, 09.11.2026: Auf den offenen Teil wird verzichtet.");
  button($("#gsplan"), "Bearbeiten").click();
  const ta = $("#gsplan-text");
  ta.value = "**1) Ankommen**\n**2) Lied**";
  D.fire(ta, "input");
  button($("#gsplan"), "Fertig").click();
  await D.sleep(10);
  assert.ok(calls.some((x) => x.method === "PUT"), "gespeichert");
  none($("#gs-prevstop"), "nach dem Speichern des Verlaufsplans: Karte weg");
  // Zurückkehren: der Server sagt dasselbe (erledigt) – die Karte bleibt weg
  server = { ...server, settled: true };
  D.fire(document, "visibilitychange");
  await D.sleep(10);
  none($("#gs-prevstop"));
  // die vorige Sitzung ändert sich (Zwischenstopp verschoben): Entscheidung ungültig → beim Zurückkehren wieder da
  server = { ...ps, portalVersion: 3 };
  D.fire(document, "visibilitychange");
  await D.sleep(10);
  assert.ok($("#gs-prevstop") && $("#gsplan").nextElementSibling === $("#gs-prevstop"), "wieder offen: Karte unter dem Verlaufsplan");
  assert.ok($("#gs-prevstop-state").textContent.startsWith("Beim Planen mit Claude"));
  // mit Claude entschieden und gespeichert (anderer Tab), der Fokus liegt noch in der Karte: sie verschwindet trotzdem, der Fokus geht auf „Verlaufsplan“
  const link = [...$("#gs-prevstop").querySelectorAll("a")].find((a) => a.textContent === "Vorige Sitzung öffnen");
  link.focus();
  same(document.activeElement, link);
  server = { ...ps, portalVersion: 3, decision: { choice: "uebernehmen", at: at0 + 9000 }, settled: true };
  D.fire(document, "visibilitychange");
  await D.sleep(10);
  none($("#gs-prevstop"), "erledigt (Claude in einem anderen Tab): Karte weg");
  assert.ok(document.activeElement.id === "gsplan-h", "Fokus auf der Überschrift „Verlaufsplan“ – ist " + desc(document.activeElement));
  // ohne Entscheidung macht ein Speichern auf der Seite nichts
  assert.equal(PV.prevStopAfterSave({ ...ps }, at0), null);
  assert.equal(PV.prevStopAfterSave({ ...ps, decision: { choice: "verzichten", at: at0 } }, at0 - 1), null, "vor der Entscheidung gespeichert");
  assert.deepEqual(PV.prevStopAfterSave({ ...ps, decision: { choice: "verzichten", at: at0 } }, at0), { ...ps, decision: { choice: "verzichten", at: at0 }, settled: true }, "gleicher Zeitpunkt zählt");
  assert.equal(PV.prevStopShown(null), false);
  assert.equal(PV.prevStopShown({ ...ps, settled: true }), false);
  assert.equal(PV.prevStopShown(ps), true);
});

test("S11: Hinweis nach dem Eintragen eines Zwischenstopps – nächste Sitzung noch nicht bzw. schon geplant; verschwindet mit dem Zwischenstopp", async () => {
  await page({ lesson: lessonOf({ portal: "**1) Ankommen**\n**2) Rätsel**" }), nextLesson: null });
  const hint = $("#gs-stop-next");
  assert.ok(hint && hint.classList.contains("hidden"), "vorher kein Hinweis");
  D.userClick(button($("#gsplan"), "Zwischenstopp eintragen …"));
  D.userClick(modalButton("Zwischenstopp eintragen"));
  await D.sleep(5);
  assert.ok(!hint.classList.contains("hidden"));
  assert.equal(hint.textContent, "Zwischenstopp gesetzt. Beim Planen der nächsten Sitzung mit Claude wird gefragt, ob der offene Teil übernommen oder darauf verzichtet wird.");
  D.userClick(button($("#gsplan"), "Zwischenstopp entfernen"));
  assert.ok(hint.classList.contains("hidden"), "mit dem Zwischenstopp weg");
  // die nächste Sitzung ist schon geplant: dort fragt „Stunde mit Claude planen“ erneut
  await page({ lesson: lessonOf({ portal: "**1) Ankommen**\n**2) Rätsel**" }), nextLesson: { id: L2, title: "Josef in Ägypten (2)", date: "2026-11-12", planned: true } });
  D.userClick(button($("#gsplan"), "Zwischenstopp eintragen …"));
  D.userClick(modalButton("Zwischenstopp eintragen"));
  await D.sleep(5);
  assert.equal($("#gs-stop-next").textContent, "Zwischenstopp gesetzt. Die nächste Sitzung „Josef in Ägypten (2)“ (Do, 12.11.2026) ist schon geplant – „Stunde mit Claude planen“ fragt dort erneut, ob der offene Teil übernommen oder darauf verzichtet wird. Nächste Sitzung öffnen");
  assert.equal($("#gs-stop-next a").getAttribute("href"), "#/lk/s/" + L2);
});

test("S11: „Nicht geschafft“ – Phasen des offenen Teils, ohne die Markierung „--> Nächste Stunde“; ohne Phasen die Stichpunkte; Verweise mit Namen", () => {
  assert.equal(PV.stopOpenSummary("**3) Partnerarbeit**\n- M1\n\n--> Nächste Stunde\n\n**4) Diskussionsrunde**\n- Wippe"), "3) Partnerarbeit; 4) Diskussionsrunde");
  assert.equal(PV.stopOpenSummary("- Aufgabe 4 besprechen\n- Video"), "Aufgabe 4 besprechen; Video");
  assert.equal(PV.stopOpenSummary("- [[pdf:" + A + "]] ausmalen", { gs: true, nameOf: (id) => (id === A ? "Ausmalbild.pdf" : null) }), "Ausmalbild.pdf ausmalen");
  assert.equal(PV.stopOpenSummary(""), "");
});
