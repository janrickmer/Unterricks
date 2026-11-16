// Prüfung von Nachtrag 31b (zweite, unabhängige Prüfung vom 16.11.2026): wiederverwendete Bildkarten auf der Druckliste der Grundschul-Sitzung im Browser-Ersatz
// (fake-dom.mjs, Server über globalThis.__tapi). Befunde: (1) der Einzel-Download von Claude GESTALTETER wiederverwendeter Bildkarten lief über den signierten Link –
// der Server nannte die Datei nach der Druckliste der Sitzung, der sie gehören (Content-Disposition geht dem download-Attribut vor); (2) war ihre neue Gestaltung
// gedruckt, baute die Seite die GANZE Druckliste neu (Fokus und eine halb getippte Anzahl in einer anderen Zeile gingen verloren); (3) „Nicht ausdrucken“ nahm
// den Fokus, auch wenn die Lehrkraft ihn während der Anfrage woandershin gesetzt hatte; (4) die kompakte Ansicht zeigte den Dateinamen statt des Druck-Namens;
// (5) „Nicht ausdrucken – …“ nannte nach einer Änderung der Druckangaben noch den alten Namen; (6) ein getippter Verweis auf Bildkarten einer früheren (nicht der
// vorigen) Sitzung hieß im Verlaufsplan „PDF nicht gefunden“, obwohl die Druckliste sie schon zeigte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const LID = "d1".repeat(8), PREV = "d2".repeat(8), OLD = "d3".repeat(8), X = "e1".repeat(8), Y = "e2".repeat(8), P = "e3".repeat(8);
const D = installDom({ hash: "#/lk/s/" + LID });
const { ApiError } = await import("../../public/ui.js");
const GSS = await import("../../public/gssession.js");
const { resetPrintQueue } = await import("../../public/designrender.js");
const S = await import("../../public/shared.js");

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
const lessonOf = (portal) => ({ id: LID, subject: "gs", klass: "gs1", title: "Noah und die Taube", topic: "Noah", date: "2026-11-17", startTime: "08:00", durationMin: 45, ideas: "", homework: "",
  portal, portalVersion: 1, portalUpdatedAt: 1, portalSource: "lehrkraft", parentSummary: "", parentNote: "", createdAt: 1, unitId: null, unitRow: null, cancelled: false });
const course = { gs: { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", subjectName: "Religion", religion: true, grade: 2, classes: ["a", "b"], gradeText: "Jahrgangsstufe 2" }, classSize: 22 };
// Bildkarten einer anderen Sitzung des Kurses (wie gsRefData: fileOut ohne die Druckangaben ihrer Sitzung, dazu Herkunft)
const cardSet = (id, name, lessonId, title, date, extra = {}) => ({ id, area: "teacher", kind: "file", name, mime: "application/pdf", size: 4096, pages: 3, status: "ready", source: "claude", createdAt: 5,
  cards: { texts: ["a", "b", "c"], share: true, rev: 0, pages: 3, current: true, version: 6 }, design: { outdated: false, error: null, htmlAt: 5, pdfAt: 6, text: "" },
  lessonId, lessonTitle: title, date, ...extra });
const printFile = () => ({ id: P, area: "print", kind: "file", name: "Ausmalbild Taube.pdf", mime: "application/pdf", size: 2048, pages: 1, status: "ready", source: "upload", createdAt: 3,
  print: { copies: 22, duplex: false, color: false }, printName: "22x - sw - einseitig - Reli2 - Ausmalbild Taube.pdf" });
const PLAN = "**1) Erzählung: Die Arche (15 Min., Sitzkreis)**\n- Lehrkraft erzählt mit den Bildkarten [[pdf:" + X + "]]";
// Druckangaben dieser Sitzung (PUT …/card-prints) wie routeCardPrints
function cardPrintsRoute(state, gate = () => null) {
  return [/^PUT \/api\/teacher\/lessons\/\w+\/card-prints$/, async (m, b) => {
    const g = gate(); if (g) await g;
    const cur = state[b.fileId] && !state[b.fileId].off ? state[b.fileId] : { ...S.CARD_PRINT };
    state[b.fileId] = b.off === true ? { off: true } : { copies: b.copies ?? cur.copies, duplex: b.duplex ?? cur.duplex, color: b.color ?? cur.color };
    return { cardPrints: JSON.parse(JSON.stringify(state)) };
  }];
}
async function page(d, routes = []) {
  if (globalThis.__leave) globalThis.__leave();
  document.querySelectorAll(".modal-back, .ctxmenu").forEach((x) => x.remove());
  resetPrintQueue();
  globalThis.__go = [];
  const calls = server([...routes, [/^GET \/api\/teacher\/lessons\/\w+\/parent-link$/, () => ({ token: "tokA" })],
    [/^PUT \/api\/teacher\/lessons\/\w+\/portal$/, (m, b) => ({ portal: { text: b.text, version: 2, updatedAt: 2, source: "lehrkraft" } })]]);
  await GSS.gsSessionPage(LID, { course, messages: [], refFiles: [], files: [], unit: null, courseCards: [], cardPrints: {}, ...d });
  await D.sleep(5);
  return calls;
}
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
const rowOf = (name) => $$("#printcard .printrow").find((r) => $(".name", r) && $(".name", r).textContent === name) || null;
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }
const desc = (el) => (el ? el.tagName + (el.id ? "#" + el.id : "") + " „" + el.textContent.trim().slice(0, 40) + "“" : String(el));
const same = (a, b, msg) => assert.ok(a === b, (msg || "") + " – ist " + desc(a) + ", erwartet " + desc(b));
/* Downloads des Browsers: angeklickte Links (href, download) */
function captureDownloads() {
  const got = [], orig = document.body.append.bind(document.body), origUrl = URL.createObjectURL, origFetch = globalThis.fetch;
  document.body.append = (...xs) => { for (const x of xs) if (x && x.tagName === "A" && x.getAttribute("download") !== null) got.push({ href: x.getAttribute("href"), name: x.getAttribute("download") }); return orig(...xs); };
  URL.createObjectURL = () => "blob:test";
  globalThis.fetch = async () => new Response(new TextEncoder().encode("%PDF-1.7 Karten"));
  return { got, restore: () => { document.body.append = orig; URL.createObjectURL = origUrl; globalThis.fetch = origFetch; } };
}
const link = [/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m) => ({ url: "/api/dl/" + m[1] + "?d=a&p=pr&e=1&s=x" })];

test("Befund 1 + 4 + 5: gestaltete wiederverwendete Bildkarten – Einzel-Download als Blob unter dem Namen dieser Sitzung (Druckliste und kompakte Ansicht), Name und „Nicht ausdrucken – …“ folgen den Druckangaben", async () => {
  const state = {};
  const calls = await page({ lesson: lessonOf(PLAN), files: [printFile()], courseCards: [cardSet(X, "Bildkarten Arche.pdf", PREV, "Noah baut die Arche", "2026-11-16")] }, [cardPrintsRoute(state), link]);
  const N1 = "1x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf", N2 = "2x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf";
  const row = rowOf(N1);
  assert.ok(row, "Zeile „" + N1 + "“: " + $$("#printcard .printrow .name").map((x) => x.textContent).join(" | "));
  assert.ok($(".meta", row).textContent.includes("PDF, von Claude gestaltet") && $(".meta", row).textContent.includes("Bildkarten aus der Sitzung „Noah baut die Arche“ (Mo, 16.11.2026)"), $(".meta", row).textContent);
  // Anzahl ändern: nur diese Zeile folgt (dasselbe Element), samt Namen von „Nicht ausdrucken“
  const copies = $("input.pcopies", row);
  copies.value = "2"; D.fire(copies, "change");
  await until(() => $(".name", row).textContent === N2, "Name mit 2 Exemplaren");
  assert.deepEqual(calls.filter((c) => c.method === "PUT" && c.path.endsWith("/card-prints")).map((c) => c.body), [{ fileId: X, copies: 2 }]);
  same(rowOf(N2), row, "dieselbe Zeile (kein Neuaufbau)");
  assert.ok(button(row, "Nicht ausdrucken – " + N2), "„Nicht ausdrucken“ nennt den neuen Namen");
  // Herunterladen: als Blob unter dem Namen DIESER Sitzung – mit print (nie die alte Gestaltung), nie über den Link des Servers (der nennt die Datei anders)
  const dl = captureDownloads();
  try {
    D.userClick(button(row, "Herunterladen"));
    await until(() => dl.got.length === 1, "Download");
    assert.deepEqual(dl.got, [{ href: "blob:test", name: N2 }]);
    assert.deepEqual(calls.filter((c) => c.path.endsWith("/link")).map((c) => [c.path, c.body]), [["/api/teacher/files/" + X + "/link", { print: true }]]);
    // kompakte Ansicht „Ich bin jetzt im Unterricht“: Druck-Name dieser Sitzung, derselbe Weg
    D.userClick($("#inclass-go"));
    await until(() => $$("#ic-material .ic-print .ic-name").length === 2, "kompakte Ansicht mit zwei Einträgen zum Ausdrucken");
    assert.deepEqual($$("#ic-material .ic-print .ic-name").map((x) => x.textContent), ["22x - sw - einseitig - Reli2 - Ausmalbild Taube.pdf", N2], "Druck-Namen dieser Sitzung (nicht nur der Dateiname)");
    const item = $$("#ic-material .ic-print").find((li) => $(".ic-name", li).textContent === N2);
    D.userClick(button(item, "Herunterladen") || $("button", item));
    await until(() => dl.got.length === 2, "Download aus der kompakten Ansicht");
    assert.deepEqual(dl.got[1], { href: "blob:test", name: N2 });
    D.userClick($("#inclass-back"));
  } finally { dl.restore(); }
  assert.equal(state[X].copies, 2);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Befund 2: neue Gestaltung wiederverwendeter Bildkarten fertig gedruckt – nur ihre Zeile wird neu gebaut; Fokus und eine halb getippte Anzahl in einer anderen Zeile bleiben", async () => {
  let release;
  const printed = new Promise((r) => { release = r; });
  const redesign = cardSet(X, "Bildkarten Arche.pdf", PREV, "Noah baut die Arche", "2026-11-16", { design: { outdated: true, error: null, htmlAt: 7, pdfAt: 6, text: "" } });
  const calls = await page({ lesson: lessonOf(PLAN), files: [printFile()], courseCards: [redesign], cardPrints: { [X]: { copies: 2, duplex: false, color: true } } }, [link,
    // die Antwort des Servers ist die Datei der Sitzung, der die Bildkarten gehören – mit IHRER Druckliste (1x)
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, async () => { await printed; return { file: { ...redesign, design: { outdated: false, error: null, htmlAt: 7, pdfAt: 8, text: "" }, pages: 4, size: 5000,
      print: { ...S.CARD_PRINT }, printName: "1x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf" } }; }]]);
  const N2 = "2x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf";
  const own = rowOf("22x - sw - einseitig - Reli2 - Ausmalbild Taube.pdf"), cardsRow = rowOf(N2);
  assert.ok(own && cardsRow);
  assert.ok(!button(cardsRow, "Herunterladen") && $(".meta", cardsRow).textContent.includes("wird als PDF gedruckt"), "neue Gestaltung noch nicht gedruckt: kein Download – " + $(".meta", cardsRow).textContent);
  assert.ok(calls.some((c) => c.path === "/api/teacher/files/" + X + "/render"), "die Warteschlange druckt sie");
  // die Lehrkraft tippt in der anderen Zeile „25“ – nach der „2“ wird gedruckt
  const copies = $("input.pcopies", own);
  copies.focus(); copies.value = "2";
  release();
  await until(() => !!button(rowOf(N2) || own, "Herunterladen") && rowOf(N2) !== cardsRow, "Zeile der Bildkarten neu (gedruckt)");
  same(rowOf("22x - sw - einseitig - Reli2 - Ausmalbild Taube.pdf"), own, "die andere Zeile ist dasselbe Element");
  same(document.activeElement, copies, "Fokus bleibt im Feld „Exemplare“");
  assert.equal(copies.value, "2", "die halb getippte Anzahl bleibt stehen");
  assert.ok(!calls.some((c) => c.method === "PATCH"), "nichts gespeichert, was die Lehrkraft nicht bestätigt hat");
  const now = rowOf(N2);
  assert.ok(now && $(".meta", now).textContent.includes("4 Seiten"), "neuer Stand in der Zeile, Name mit den Druckangaben DIESER Sitzung (2x) – " + (now ? $(".meta", now).textContent : ""));
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Befund 2 (Fortsetzung): „Erneut drucken“ wiederverwendeter Bildkarten nimmt die Meldung zurück; ein Neuzeichnen des Verlaufsplans baut die Druckliste nicht neu auf", async () => {
  let release;
  const printed = new Promise((r) => { release = r; });
  const failed = cardSet(X, "Bildkarten Arche.pdf", PREV, "Noah baut die Arche", "2026-11-16", { design: { outdated: true, error: "Der Drucker hat abgelehnt.", htmlAt: 7, pdfAt: 6, text: "" } });
  const state = {};
  const calls = await page({ lesson: lessonOf(PLAN), files: [printFile()], courseCards: [failed] }, [link, cardPrintsRoute(state),
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, async () => { await printed; return { file: { ...failed, design: { outdated: false, error: null, htmlAt: 7, pdfAt: 8, text: "" } } }; }]]);
  const N1 = "1x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf";
  const row = rowOf(N1);
  assert.ok($(".meta", row).textContent.startsWith("Druck fehlgeschlagen: Der Drucker hat abgelehnt") && row.classList.contains("design-err"), $(".meta", row).textContent);
  const again = button(row, "Erneut drucken");
  again.focus(); D.userClick(again);
  await until(() => rowOf(N1) !== row, "Zeile neu");
  const row2 = rowOf(N1);
  assert.ok(!$(".meta", row2).textContent.startsWith("Druck fehlgeschlagen") && !button(row2, "Erneut drucken"), "die alte Meldung ist weg – " + $(".meta", row2).textContent);
  assert.ok(row2.contains(document.activeElement), "Fokus in der neuen Zeile – " + desc(document.activeElement));
  assert.ok(calls.some((c) => c.path === "/api/teacher/files/" + X + "/render"));
  release();
  await until(() => !!button(rowOf(N1), "Herunterladen"), "gedruckt");
  // Druckangaben geändert (nur diese Zeile), dann ändert sich der Verlaufsplan an anderer Stelle: die Druckliste bleibt stehen
  const row3 = rowOf(N1), own = rowOf("22x - sw - einseitig - Reli2 - Ausmalbild Taube.pdf");
  const color = $('select[aria-label^="Schwarz-weiß oder farbig"]', row3);
  color.value = "0"; D.fire(color, "change");
  const NSW = "1x - sw - einseitig - Reli2 - Bildkarten Arche.pdf";
  await until(() => $(".name", row3).textContent === NSW, "schwarz-weiß");
  D.userClick(button($("#gsplan"), "Bearbeiten"));
  const ta = $("#gsplan-text");
  ta.value = PLAN + "\n- Danach malen die Kinder."; D.fire(ta, "input");
  await D.sleep(5);
  same(rowOf(NSW), row3, "Zeile der Bildkarten nicht neu aufgebaut");
  same(rowOf("22x - sw - einseitig - Reli2 - Ausmalbild Taube.pdf"), own, "andere Zeile nicht neu aufgebaut");
  // ein Verweis kommt dazu bzw. fällt weg: dann folgt die Liste
  ta.value = "**1) Bewegungslied (5 Min.)**"; D.fire(ta, "input");
  await until(() => !rowOf(NSW), "Verweis entfernt → nicht mehr auf der Liste");
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Befund 3: „Nicht ausdrucken“ (wiederverwendete Bildkarten) – Fokus auf „Wieder ausdrucken“ nur, wenn er sonst verloren wäre; hat die Lehrkraft ihn woandershin gesetzt, bleibt er dort", async () => {
  let gate = null;
  const state = {};
  await page({ lesson: lessonOf(PLAN), files: [printFile()], courseCards: [cardSet(X, "Bildkarten Arche.pdf", PREV, "Noah baut die Arche", "2026-11-16")] }, [link, cardPrintsRoute(state, () => gate)]);
  const N1 = "1x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf";
  // ohne Zutun: Fokus auf „Wieder ausdrucken“ derselben Bildkarten
  D.userClick(button(rowOf(N1), "Nicht ausdrucken – " + N1));
  await until(() => !rowOf(N1), "Zeile weg");
  const back = button($("#print-refoff"), "Wieder ausdrucken – Bildkarten Arche.pdf");
  assert.ok(back && !$("#print-refoff").classList.contains("hidden"));
  same(document.activeElement, back, "Fokus auf „Wieder ausdrucken“");
  D.userClick(back);
  await until(() => !!rowOf(N1), "wieder auf der Liste");
  // die Anfrage dauert; die Lehrkraft geht inzwischen in die Hausaufgabe
  let open;
  gate = new Promise((r) => { open = r; });
  D.userClick(button(rowOf(N1), "Nicht ausdrucken – " + N1));
  await D.sleep(5);
  const hw = $("#gs-homework");
  hw.focus();
  open(); gate = null;
  await until(() => !rowOf(N1), "Zeile weg");
  await D.sleep(5);
  same(document.activeElement, hw, "Fokus bleibt in der Hausaufgabe");
  assert.equal(state[X].off, true);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Befund 6: Verweis auf Bildkarten einer früheren (nicht der vorigen) Sitzung – der Verlaufsplan nennt sie sofort mit Namen, wie die Druckliste", async () => {
  await page({ lesson: lessonOf("**1) Bewegungslied (5 Min.)**"), files: [printFile()],
    courseCards: [cardSet(Y, "Regenbogen Karten.pdf", OLD, "Gott schließt einen Bund", "2026-11-09", { source: "upload", design: undefined })] }, [link]);
  D.userClick(button($("#gsplan"), "Bearbeiten"));
  const ta = $("#gsplan-text");
  ta.value = "**1) Erzählung (15 Min., Sitzkreis)**\n- Danach: [[pdf:" + Y + "]]"; D.fire(ta, "input");
  await until(() => !!rowOf("1x - farbig - einseitig - Reli2 - Regenbogen Karten.pdf"), "auf der Druckliste");
  const refs = $$("#gsplan .pdfref");
  assert.deepEqual(refs.map((x) => x.firstChild.textContent), ["Regenbogen Karten.pdf"], "Name statt „PDF nicht gefunden“");
  assert.equal($$("#gsplan .pdfref.missing").length, 0);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Befund 5 (auch eigene Bildkarten, seit Nachtrag 31): „Nicht ausdrucken – …“ nennt nach einer Änderung von Anzahl oder Farbe den neuen Druck-Namen", async () => {
  const own = { ...cardSet(Y, "Josef.pdf", LID, "", "2026-11-17"), print: { ...S.CARD_PRINT }, printName: "1x - farbig - einseitig - Reli2 - Josef.pdf" };
  delete own.lessonId; delete own.lessonTitle; delete own.date;
  const calls = await page({ lesson: lessonOf("**1) Erzählung (15 Min., Sitzkreis)**\n- [[pdf:" + Y + "]]"), files: [own] }, [link,
    [/^GET \/api\/teacher\/files\/(\w+)\/cards$/, () => ({ img: { base: "/i/", q: "" }, w: 100, h: 70, pages: 3, texts: ["a", "b", "c"], share: true, rev: 0, current: true, version: 6, status: "ready", name: "Josef.pdf" })],
    [/^PATCH \/api\/teacher\/files\/(\w+)$/, (m, b) => { const p = { ...own.print, ...b }; return { file: { ...own, print: p, printName: S.printFileName({ name: "Josef.pdf", ...p, course: "Reli2" }) } }; }]]);
  const row = rowOf("1x - farbig - einseitig - Reli2 - Josef.pdf");
  assert.ok(button(row, "Nicht ausdrucken – 1x - farbig - einseitig - Reli2 - Josef.pdf"));
  const color = $('select[aria-label^="Schwarz-weiß oder farbig"]', row);
  color.value = "0"; D.fire(color, "change");
  await until(() => $(".name", row).textContent === "1x - sw - einseitig - Reli2 - Josef.pdf", "Name folgt");
  assert.deepEqual(calls.filter((c) => c.method === "PATCH").map((c) => c.body), [{ color: false }]);
  assert.ok(button(row, "Nicht ausdrucken – 1x - sw - einseitig - Reli2 - Josef.pdf"), "der Knopf nennt den neuen Namen");
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});
