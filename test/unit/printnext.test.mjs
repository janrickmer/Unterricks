// Feld „Druckaufträge für den nächsten Arbeitstag“ (public/printnext.js, Anforderung 14) im Browser-Ersatz (fake-dom.mjs): Aufbau, Namen wie in
// der Druckliste der Sitzung, Einzel-Download, „Alle Dateien herunterladen“ nacheinander als einzelne Dateien (keine ZIP-Datei), gestaltete
// Vorlagen, leere Zustände, Fehler mit „Erneut versuchen“ (Fokus), Abbruch beim Verlassen der Seite. Der Server über globalThis.__tapi.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
// pdfmaker.js lädt pdf-lib unter /vendor/… (so liefert es der Browser aus) – hier aus node_modules
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "/vendor/pdf-lib.esm.min.js" ? n("pdf-lib", c) : n(s, c); }'));
const D = installDom({ hash: "#/lk" });
const { ApiError } = await import("../../public/ui.js");
const PN = await import("../../public/printnext.js");
const { resetPrintQueue } = await import("../../public/designrender.js");

const id = (n) => String(n).padStart(16, "a");
const pfile = (n, name, extra = {}) => ({ id: id(n), area: "print", kind: "file", name, mime: "application/pdf", size: 2048, pages: 1, status: "ready", source: "upload", createdAt: n,
  print: { copies: 28, duplex: true, color: false }, printName: "28x - beidseitig - sw - " + name.replace(/\.pdf$/, "") + ".pdf", ...extra });
const DATA = () => ({ ok: true, today: "2026-11-17", candidate: "2026-11-18", date: "2026-11-18", sessions: [
  { id: id("b1"), subject: "gs", klass: "gs1a2b3c4d", title: "Josef", date: "2026-11-18", startTime: "07:55", school: "gs", label: "Religion 2ab", subtitle: "Religion · Jahrgang 2", course: { id: "gs1a2b3c4d", short: "Religion 2ab", label: "Religion · Jahrgang 2" },
    files: [pfile(1, "Arbeitsblatt Josef.pdf", { area: "student", print: { copies: 22, duplex: true, color: false }, printName: "22x - beidseitig - sw - Arbeitsblatt Josef.pdf" })] },
  { id: id("b2"), subject: "powi", klass: "8A", title: "Gewaltenteilung", date: "2026-11-18", startTime: "08:00", school: "gym", label: "PoWi 8A", subtitle: "Politik und Wirtschaft · 8A",
    files: [pfile(2, "AB Gewaltenteilung.pdf"), pfile(3, "Tafelbild", { kind: "text", size: 0, printName: "1x - einseitig - sw - Tafelbild.pdf", print: { copies: 1, duplex: false, color: false } }),
      pfile(4, "Gestaltet.pdf", { status: "pending", source: "claude", design: { outdated: true, error: null, htmlAt: 5, pdfAt: null, text: "" }, printName: "2x - beidseitig - Farbe - Gestaltet.pdf" })] },
  { id: id("b3"), subject: "ethik", klass: "10C", title: "Glück", date: "2026-11-18", startTime: "11:30", school: "gym", label: "Ethik 10C", subtitle: "Ethik · 10C", files: [] },
] });

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text);
/* warten, bis cond() gilt (höchstens 3 s) – statt fester Wartezeiten, die unter Last zu kurz sein können */
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }
const desc = (el) => (el ? el.tagName + (el.id ? "#" + el.id : "") + " „" + el.textContent.trim().slice(0, 40) + "“" : String(el));
/* Seite mit dem Feld; routes: [Muster für „METHODE /pfad“, (Treffer, body) → Antwort] */
let rec;
async function page(routes, wait = 5) {
  if (globalThis.__leave) globalThis.__leave();
  resetPrintQueue();
  rec = { calls: [], urls: [], blobs: [], sleeps: 0 };
  globalThis.__tapi = async (method, path, o = {}) => {
    rec.calls.push(method + " " + path);
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  Object.assign(PN.io, { url: (u, n) => rec.urls.push([u, n]), blob: (b, n) => rec.blobs.push([b, n]), sleep: async () => { rec.sleeps++; },
    fetch: async (u) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7 " + u).buffer }) });
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  const card = PN.printNextCard();
  app.append(card);
  await D.sleep(wait);
  return card;
}
const link = [/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m) => ({ url: "/api/dl/" + m[1] + "?d=a&e=1&s=x" })];
const lessonText = [/^GET \/api\/teacher\/lessons\/(\w+)$/, () => ({ files: [{ id: id(3), text: "# Tafelbild\n\nDie **Gewaltenteilung** – Legislative, Exekutive, Judikative." }] })];

test("Texte: Tag (morgen, übersprungener Tag, Ferien bis Freitag), keine Druckaufträge, kein Unterricht, Abschlussmeldung", () => {
  assert.equal(PN.longDay("2026-11-18"), "Mittwoch, 18.11.2026");
  assert.equal(PN.dayText({ today: "2026-11-17", candidate: "2026-11-18", date: "2026-11-18" }), "für morgen, Mittwoch, 18.11.2026");
  assert.equal(PN.dayText({ today: "2026-11-20", candidate: "2026-11-23", date: "2026-11-23" }), "für Montag, 23.11.2026");
  assert.equal(PN.dayText({ today: "2026-11-16", candidate: "2026-11-17", date: "2026-11-18" }), "Am Dienstag, 17.11.2026, ist laut Stundenplan kein Unterricht – deshalb die Druckaufträge für Mittwoch, 18.11.2026.");
  assert.equal(PN.dayText({ today: "2026-11-20", candidate: "2026-11-23", date: "2026-11-30" }),
    "Von Montag, 23.11.2026, bis Freitag, 27.11.2026, ist laut Stundenplan kein Unterricht – deshalb die Druckaufträge für Montag, 30.11.2026.", "bis Freitag, nicht bis Sonntag");
  assert.equal(PN.dayText({ today: "2026-11-17", candidate: "2026-11-18", date: null }), "In den nächsten Wochen ist kein Unterricht geplant.");
  const f = (n) => ({ printName: n + ".pdf" });
  assert.equal(PN.doneText(3, [], []), "Fertig: Alle 3 Dateien sind einzeln heruntergeladen.");
  assert.equal(PN.doneText(1, [f("Gestaltet")], [{ f: f("Kaputt"), msg: "Fehler 404" }]),
    "Fertig: Eine Datei ist heruntergeladen. Noch nicht dabei (wird gerade als PDF gedruckt): „Gestaltet.pdf“. Nicht heruntergeladen: „Kaputt.pdf“ (Fehler 404).");
  assert.equal(PN.printNameOf({ name: "AB.pdf", print: { copies: 3, duplex: false, color: true } }), "3x - einseitig - Farbe - AB.pdf", "ohne printName wie die ZIP-Datei der Sitzung");
});

test("Aufbau: Überschrift mit Drucker, Tag, je Sitzung eine Gruppe (Link zur Sitzung, „In der Sitzung bearbeiten“), Namen wie in der Druckliste", async () => {
  let release;
  const printed = new Promise((r) => { release = r; });
  const card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText,
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, async () => { await printed; return { file: pfile(4, "Gestaltet.pdf", { status: "ready", source: "claude", pages: 2, design: { outdated: false, error: null, htmlAt: 5, pdfAt: 6, text: "" }, printName: "2x - beidseitig - Farbe - Gestaltet.pdf" }) }; }]]);
  assert.equal($("h2", card).textContent, "Druckaufträge für den nächsten Arbeitstag");
  assert.equal($(".pn-ico", card).getAttribute("aria-hidden"), "true"); assert.ok($(".pn-ico svg", card), "Drucker-Symbol");
  assert.equal($("#pn-day", card).textContent, "für morgen, Mittwoch, 18.11.2026");
  assert.equal(card.getAttribute("aria-labelledby"), "pn-h");
  const groups = $$(".pn-group", card);
  assert.deepEqual(groups.map((g) => $("h3", g).textContent), ["07:55 Grundschule Religion 2ab – Josef", "08:00 PoWi 8A – Gewaltenteilung"]);
  assert.deepEqual(groups.map((g) => $("h3 a", g).getAttribute("href")), ["#/lk/s/" + id("b1"), "#/lk/s/" + id("b2")]);
  const edit = $(".pn-edit", groups[1]);
  assert.equal(edit.getAttribute("href"), "#/lk/s/" + id("b2") + "/druckliste");
  assert.equal(edit.getAttribute("aria-label"), "Druckliste von „Gewaltenteilung“ (PoWi 8A) in der Sitzung bearbeiten");
  assert.deepEqual($$(".pn-row .name", card).map((x) => x.textContent),
    ["22x - beidseitig - sw - Arbeitsblatt Josef.pdf", "28x - beidseitig - sw - AB Gewaltenteilung.pdf", "1x - einseitig - sw - Tafelbild.pdf", "2x - beidseitig - Farbe - Gestaltet.pdf"]);
  assert.equal($(".pn-none", card).textContent, "Ohne Druckaufträge: 11:30 Ethik 10C.");
  // gestaltete Vorlage noch nicht gedruckt: kein Download, Stand wie in der Sitzung; die gemeinsame Warteschlange druckt sie
  const des = $$(".pn-row", card)[3];
  assert.equal($("button", des), null);
  assert.match($(".meta", des).textContent, /wird als PDF gedruckt …/);
  assert.ok(rec.calls.includes("POST /api/teacher/files/" + id(4) + "/render"), "Druck angestoßen");
  // Einzel-Download wie in der Sitzung: signierter Link unter dem Druck-Namen; Text als A4-PDF aus dem Text der Sitzung
  const b = $$(".pn-row", card)[1].querySelector("button");
  assert.equal(b.getAttribute("aria-label"), "Herunterladen – 28x - beidseitig - sw - AB Gewaltenteilung.pdf");
  D.userClick(b); await D.sleep(5);
  assert.deepEqual(rec.urls, [["/api/dl/" + id(2) + "?d=a&e=1&s=x", "28x - beidseitig - sw - AB Gewaltenteilung.pdf"]]);
  assert.equal(document.activeElement, b, "Fokus bleibt auf dem Knopf – " + desc(document.activeElement));
  D.userClick($$(".pn-row", card)[2].querySelector("button")); await until(() => rec.blobs.length === 1, "Text als PDF"); assert.equal(rec.blobs[0][1], "1x - einseitig - sw - Tafelbild.pdf");
  assert.equal(new TextDecoder().decode(new Uint8Array(await rec.blobs[0][0].arrayBuffer()).subarray(0, 5)), "%PDF-");
  assert.ok(rec.calls.includes("GET /api/teacher/lessons/" + id("b2")), "Text aus der Sitzung geholt");
  // Arbeitsblatt der Kinder mit „Auch ausdrucken“: der Server nennt es wie im Material – auf GitHub Pages (andere Herkunft) zählt sein Name,
  // nicht das download-Attribut. Deshalb als Blob unter dem Druck-Namen, nie über den Link direkt
  D.userClick($$(".pn-row", card)[0].querySelector("button")); await until(() => rec.blobs.length === 2, "Arbeitsblatt der Kinder");
  assert.equal(rec.blobs[1][1], "22x - beidseitig - sw - Arbeitsblatt Josef.pdf");
  assert.equal(new TextDecoder().decode(new Uint8Array(await rec.blobs[1][0].arrayBuffer())), "%PDF-1.7 /api/dl/" + id(1) + "?d=a&e=1&s=x", "Inhalt über den signierten Link");
  assert.equal(rec.urls.length, 1, "kein direkter Link-Download für das Arbeitsblatt der Kinder");
  // nach dem Druck: Zeile mit Download (nur diese Zeile neu)
  const keep = $$(".pn-row", card)[0];
  release(); await until(() => $$(".pn-row", card)[3] !== des, "Zeile nach dem Druck neu");
  const des2 = $$(".pn-row", card)[3];
  assert.ok(des2 !== des && $("button", des2), "neu aufgebaut, jetzt mit „Herunterladen“");
  assert.match($(".meta", des2).textContent, /PDF, von Claude gestaltet · 2 Seiten/);
  assert.equal($(".meta", des2).textContent.match(/von Claude/g).length, 1, "Herkunft nur einmal (wie in der Sitzung)");
  assert.deepEqual($$(".pn-row .ficon", card).map((x) => x.textContent), ["PDF", "PDF", "PDF", "PDF"], "auch Textmaterial mit PDF-Symbol (es kommt als PDF)");
  assert.equal($$(".pn-row", card)[0], keep, "andere Zeilen bleiben");
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("„Alle Dateien herunterladen“: nacheinander je eine Datei (keine ZIP-Datei), Pause dazwischen, Fortschritt, nicht gedruckte Vorlage genannt", async () => {
  const seen = [];
  const card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText,
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);   // der Drucker antwortet nicht
  const all = button(card, "Alle Dateien herunterladen");
  assert.ok(all && !all.classList.contains("hidden"));
  assert.equal(all.getAttribute("aria-describedby"), "pn-all-h");
  assert.match($("#pn-all-h", card).textContent, /keine ZIP-Datei/);
  const status = $("#pn-status", card);
  assert.equal(status.getAttribute("role"), "status");
  let open;
  const gate = new Promise((r) => { open = r; });
  PN.io.sleep = async () => { rec.sleeps++; seen.push(status.textContent); if (rec.sleeps === 1) await gate; };   // die erste Pause hält an
  D.userClick(all);
  await until(() => rec.sleeps === 1, "erste Pause");
  assert.equal(all.getAttribute("aria-disabled"), "true", "gesperrt, solange er läuft");
  assert.equal(document.activeElement, all, "Fokus bleibt – " + desc(document.activeElement));
  D.userClick(all);   // zweiter Klick während des Laufs: wirkungslos
  open();
  await until(() => /^Fertig/.test(status.textContent), "Abschlussmeldung");
  assert.deepEqual(rec.blobs.map((x) => x[1]), ["22x - beidseitig - sw - Arbeitsblatt Josef.pdf", "28x - beidseitig - sw - AB Gewaltenteilung.pdf", "1x - einseitig - sw - Tafelbild.pdf"]);
  assert.ok(rec.blobs.every(([b, n]) => b.type === "application/pdf" && !/\.zip$/i.test(n)), "einzelne PDF-Dateien");
  assert.equal(rec.urls.length, 0);
  assert.equal(rec.sleeps, 2, "Pause zwischen den Downloads (nicht nach dem letzten)");
  assert.deepEqual(seen, ["Lade 1 von 3: „22x - beidseitig - sw - Arbeitsblatt Josef.pdf“ …", "Lade 2 von 3: „28x - beidseitig - sw - AB Gewaltenteilung.pdf“ …"]);
  assert.equal(status.textContent, "Fertig: Alle 3 Dateien sind einzeln heruntergeladen. Noch nicht dabei (wird gerade als PDF gedruckt): „2x - beidseitig - Farbe - Gestaltet.pdf“.");
  assert.equal(all.getAttribute("aria-disabled"), null);
  const bytes = new TextDecoder().decode(new Uint8Array(await rec.blobs[1][0].arrayBuffer()));
  assert.equal(bytes, "%PDF-1.7 /api/dl/" + id(2) + "?d=a&e=1&s=x", "Inhalt über den signierten Link (apiUrl)");
  // eine Datei lässt sich nicht laden: die übrigen kommen trotzdem, die Meldung nennt sie
  PN.io.fetch = async (u) => (u.includes(id(1)) ? { ok: false, status: 404 } : { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("%PDF-x").buffer });
  rec.blobs = [];
  D.userClick(all); await until(() => /^Fertig/.test(status.textContent), "Abschlussmeldung");
  assert.equal(rec.blobs.length, 2);
  assert.match(status.textContent, /^Fertig: Alle 2 Dateien sind einzeln heruntergeladen\. .* Nicht heruntergeladen: „22x - beidseitig - sw - Arbeitsblatt Josef\.pdf“ \(„Arbeitsblatt Josef\.pdf“ ließ sich nicht laden \(Fehler 404\)\.\)\.$/);
});

test("Verlassen der Seite bricht „Alle Dateien herunterladen“ ab; nur gestaltete, noch nicht gedruckte Vorlagen → Hinweis statt Download", async () => {
  let card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText, [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);
  PN.io.sleep = async () => { rec.sleeps++; globalThis.__leave(); };   // während der ersten Pause verlässt die Lehrkraft die Seite
  D.userClick(button(card, "Alle Dateien herunterladen")); await until(() => rec.sleeps === 1, "erste Pause"); await D.sleep(30);
  assert.equal(rec.blobs.length, 1, "nach dem Verlassen keine weiteren Downloads");
  const only = DATA();
  only.sessions = [{ ...only.sessions[1], files: [only.sessions[1].files[2]] }];
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => only], [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);
  D.userClick(button(card, "Alle Dateien herunterladen")); await D.sleep(5);
  assert.equal($("#pn-status", card).textContent, "Die Vorlagen werden gerade noch als PDF gedruckt – bitte gleich noch einmal.");
  assert.equal(rec.blobs.length, 0);
});

test("leer: keine Druckaufträge (auch nach übersprungenem Tag), kein Unterricht; Fehler mit „Erneut versuchen“ – Fokus nie auf body", async () => {
  const none = { ...DATA(), sessions: [{ ...DATA().sessions[2] }] };
  let card = await page([[/^GET \/api\/teacher\/print-next$/, () => none]]);
  assert.equal($(".pn-empty", card).textContent, "Für Mittwoch, 18.11.2026, gibt es keine Druckaufträge.");
  assert.ok($("#pn-day", card).classList.contains("hidden"), "der Tag steht schon im Satz");
  assert.ok(button(card, "Alle Dateien herunterladen").classList.contains("hidden"));
  assert.equal($(".pn-none", card).textContent, "Ohne Druckaufträge: 11:30 Ethik 10C.");
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => ({ ...none, candidate: "2026-11-17", today: "2026-11-16", sessions: [] })]]);
  assert.match($("#pn-day", card).textContent, /^Am Dienstag, 17\.11\.2026, ist laut Stundenplan kein Unterricht/);
  assert.equal($(".pn-empty", card).textContent, "Für Mittwoch, 18.11.2026, gibt es keine Druckaufträge.");
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => ({ ok: true, today: "2026-11-17", candidate: "2026-11-18", date: null, sessions: [] })]]);
  assert.equal($(".pn-empty", card).textContent, "In den nächsten Wochen ist kein Unterricht geplant.");
  assert.equal($("#pn-day", card).textContent, "");
  // Fehler → ruhige Meldung mit „Erneut versuchen“; danach steht das Feld und der Fokus auf der Überschrift
  let fail = true;
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => { if (fail) throw new ApiError("Keine Verbindung zum Server.", 0); return DATA(); }], [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);
  assert.equal($(".pn-err", card).textContent, "Die Druckaufträge ließen sich nicht laden: Keine Verbindung zum Server.");
  assert.equal($(".pn-err", card).getAttribute("role"), "alert");
  const again = button(card, "Erneut versuchen");
  fail = false;
  D.userClick(again); await D.sleep(10);
  assert.equal($$(".pn-group", card).length, 2);
  assert.equal(document.activeElement, $("#pn-h", card), "Fokus auf der Überschrift – " + desc(document.activeElement));
});

test("gestaltete Vorlage, deren PDF-Druck scheitert bzw. am Tageskontingent hängt: „Alle“ nennt sie als nicht gedruckt (nicht „wird gerade gedruckt“)", async () => {
  const broken = [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => { throw new ApiError("Der PDF-Druck ist fehlgeschlagen.", 502, { code: "render_failed" }); }];
  // Druck scheitert: Zeile „Druck fehlgeschlagen“, Abschlussmeldung mit „Erneut drucken“ in der Sitzung
  let card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText, broken]);
  await until(() => /Druck fehlgeschlagen/.test($(".meta", $$(".pn-row", card)[3]).textContent), "Zeile meldet den Fehler");
  assert.ok($$(".pn-row", card)[3].classList.contains("design-err"));
  D.userClick(button(card, "Alle Dateien herunterladen"));
  const status = $("#pn-status", card);
  await until(() => /^Fertig/.test(status.textContent), "Abschlussmeldung");
  assert.equal(status.textContent, "Fertig: Alle 3 Dateien sind einzeln heruntergeladen. Nicht dabei, weil der PDF-Druck nicht geklappt hat (in der Sitzung „Erneut drucken“): „2x - beidseitig - Farbe - Gestaltet.pdf“.");
  // nur diese Vorlage: kein „bitte gleich noch einmal“ (es druckt nichts von selbst)
  const only = DATA();
  only.sessions = [{ ...only.sessions[1], files: [only.sessions[1].files[2]] }];
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => only], broken]);
  await until(() => /Druck fehlgeschlagen/.test($(".pn-row .meta", card).textContent), "Zeile meldet den Fehler");
  D.userClick(button(card, "Alle Dateien herunterladen")); await D.sleep(5);
  assert.equal($("#pn-status", card).textContent, "Keine Datei ist fertig: Der PDF-Druck der Vorlagen hat nicht geklappt – bitte in der Sitzung „Erneut drucken“.");
  assert.equal(rec.blobs.length, 0);
  // Tageskontingent: die Warteschlange hört auf – ALLE gestalteten Zeilen sagen „Noch nicht gedruckt“, nicht nur die gerade gedruckte
  const two = DATA();
  two.sessions[1].files.push(pfile(5, "Zweite.pdf", { status: "pending", source: "claude", design: { outdated: true, error: null, htmlAt: 7, pdfAt: null, text: "" }, printName: "1x - beidseitig - sw - Zweite.pdf" }));
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => two], link, lessonText,
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => { throw new ApiError("Das Tageskontingent für den PDF-Druck ist aufgebraucht.", 429, { code: "render_quota" }); }]]);
  await until(() => $$(".pn-row .meta", card).filter((m) => /^Noch nicht gedruckt: Das Tageskontingent/.test(m.textContent)).length === 2, "beide Zeilen: noch nicht gedruckt");
  D.userClick(button(card, "Alle Dateien herunterladen"));
  await until(() => /^Fertig/.test($("#pn-status", card).textContent), "Abschlussmeldung");
  assert.match($("#pn-status", card).textContent, /Nicht dabei, weil der PDF-Druck nicht geklappt hat \(in der Sitzung „Erneut drucken“\): „2x - beidseitig - Farbe - Gestaltet\.pdf“, „1x - beidseitig - sw - Zweite\.pdf“\.$/);
  assert.doesNotMatch($("#pn-status", card).textContent, /wird gerade als PDF gedruckt/);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});
