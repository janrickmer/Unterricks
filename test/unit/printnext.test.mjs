// Feld „Druckaufträge für den nächsten Arbeitstag“ (public/printnext.js, Anforderung 14) im Browser-Ersatz (fake-dom.mjs): Aufbau, Namen wie in
// der Druckliste der Sitzung, Einzel-Download, „Alle Dateien herunterladen“ als EINE ZIP-Datei je Tag (Nachtrag 36; vorher einzeln), gestaltete
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
const { readZip } = await import("../../public/zip.js");
/* Inhalt einer heruntergeladenen ZIP-Datei (rec.blobs-Eintrag [Blob, Name]) → [[Name, Text]] */
const zipOf = async ([blob]) => (await readZip(new Uint8Array(await blob.arrayBuffer()))).map((e) => [e.name, new TextDecoder().decode(e.data)]);

const id = (n) => String(n).padStart(16, "a");
const pfile = (n, name, extra = {}) => ({ id: id(n), area: "print", kind: "file", name, mime: "application/pdf", size: 2048, pages: 1, status: "ready", source: "upload", createdAt: n,
  print: { copies: 28, duplex: true, color: false }, printName: "28x - sw - beidseitig - PoWi8 - " + name.replace(/\.pdf$/, "") + ".pdf", ...extra });
const DATA = () => ({ ok: true, today: "2026-11-17", candidate: "2026-11-18", date: "2026-11-18", sessions: [
  { id: id("b1"), subject: "gs", klass: "gs1a2b3c4d", title: "Josef", date: "2026-11-18", startTime: "07:55", school: "gs", label: "Religion 2ab", subtitle: "Religion · Jahrgang 2", printCourse: "Reli2", course: { id: "gs1a2b3c4d", short: "Religion 2ab", label: "Religion · Jahrgang 2" },
    files: [pfile(1, "Arbeitsblatt Josef.pdf", { area: "student", print: { copies: 22, duplex: true, color: false }, printName: "22x - sw - beidseitig - Reli2 - Arbeitsblatt Josef.pdf" })] },
  { id: id("b2"), subject: "powi", klass: "8A", title: "Gewaltenteilung", date: "2026-11-18", startTime: "08:00", school: "gym", label: "PoWi 8A", subtitle: "Politik und Wirtschaft · 8A", printCourse: "PoWi8",
    files: [pfile(2, "AB Gewaltenteilung.pdf"), pfile(3, "Tafelbild", { kind: "text", size: 0, printName: "1x - sw - einseitig - PoWi8 - Tafelbild.pdf", print: { copies: 1, duplex: false, color: false } }),
      pfile(4, "Gestaltet.pdf", { status: "pending", source: "claude", design: { outdated: true, error: null, htmlAt: 5, pdfAt: null, text: "" }, printName: "2x - farbig - beidseitig - PoWi8 - Gestaltet.pdf" })] },
  { id: id("b3"), subject: "ethik", klass: "10C", title: "Glück", date: "2026-11-18", startTime: "11:30", school: "gym", label: "Ethik 10C", subtitle: "Ethik · 10C", printCourse: "Eth10", files: [] },
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
  Object.assign(PN.io, { url: (u, n) => rec.urls.push([u, n]), blob: (b, n) => rec.blobs.push([b, n]),
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
  // unterrichtsfreie Tage der Einstellungen (Nachtrag 24): der Grund steht im Satz – Eintrag und Schule; ohne passende Einträge wie bisher
  const HERBST = { from: "2026-11-09", to: "2026-11-13", label: "Herbstferien", scope: "both" };
  assert.equal(PN.dayText({ today: "2026-11-06", candidate: "2026-11-09", date: "2026-11-16", freeDays: [HERBST] }),
    "Von Montag, 09.11.2026, bis Freitag, 13.11.2026, ist unterrichtsfrei (Herbstferien, beide Schulen) – deshalb die Druckaufträge für Montag, 16.11.2026.");
  assert.equal(PN.dayText({ today: "2026-11-02", candidate: "2026-11-03", date: "2026-11-04", freeDays: [{ from: "2026-11-03", to: "2026-11-03", label: "Schulfest", scope: "gs" }] }),
    "Am Dienstag, 03.11.2026, ist unterrichtsfrei (Schulfest, Grundschule) – deshalb die Druckaufträge für Mittwoch, 04.11.2026.");
  assert.equal(PN.dayText({ today: "2026-11-02", candidate: "2026-11-03", date: "2026-11-05", freeDays: [{ from: "2026-11-03", to: "2026-11-03", label: "Schulfest", scope: "gs" },
    { from: "2026-11-04", to: "2026-11-04", label: "Pädagogischer Tag", scope: "gym" }] }),
    "Von Dienstag, 03.11.2026, bis Mittwoch, 04.11.2026, ist unterrichtsfrei (Schulfest, Grundschule; Pädagogischer Tag, Gymnasium) – deshalb die Druckaufträge für Donnerstag, 05.11.2026.");
  assert.equal(PN.dayText({ today: "2026-11-16", candidate: "2026-11-17", date: "2026-11-18", freeDays: [HERBST, { label: "x", scope: "alle", from: "2026-11-17", to: "2026-11-17" }] }),
    "Am Dienstag, 17.11.2026, ist laut Stundenplan kein Unterricht – deshalb die Druckaufträge für Mittwoch, 18.11.2026.", "Einträge außerhalb des übersprungenen Zeitraums bzw. ohne gültige Schule zählen nicht");
  const many = ["A", "B", "C", "D"].map((l, i) => ({ from: "2026-11-1" + (6 + i), to: "2026-11-1" + (6 + i), label: l, scope: "gym" }));
  assert.equal(PN.dayText({ today: "2026-11-13", candidate: "2026-11-16", date: "2026-11-20", freeDays: many }),
    "Von Montag, 16.11.2026, bis Donnerstag, 19.11.2026, ist unterrichtsfrei (A, Gymnasium; B, Gymnasium; C, Gymnasium; …) – deshalb die Druckaufträge für Freitag, 20.11.2026.", "höchstens drei");
  // nur ein Teil des übersprungenen Zeitraums ist unterrichtsfrei (die übrigen Tage ohne Unterricht laut Stundenplan): beides im Satz
  assert.equal(PN.dayText({ today: "2026-11-06", candidate: "2026-11-09", date: "2026-11-18", freeDays: [HERBST] }),
    "Von Montag, 09.11.2026, bis Dienstag, 17.11.2026, ist laut Stundenplan kein Unterricht (darin unterrichtsfrei: Herbstferien, beide Schulen) – deshalb die Druckaufträge für Mittwoch, 18.11.2026.");
  const f = (n) => ({ printName: n + ".pdf" });
  // Nachtrag 36: eine ZIP-Datei je Tag
  const Z = "Druckaufträge - Mittwoch, 18.11.2026.zip";
  assert.equal(PN.zipNameOf("2026-11-18"), Z);
  assert.equal(PN.doneText(3, [], [], false, [], Z), "Fertig: Alle 3 Dateien sind als eine ZIP-Datei „" + Z + "“ heruntergeladen.");
  assert.equal(PN.doneText(1, [f("Gestaltet")], [{ f: f("Kaputt"), msg: "Fehler 404" }], false, [], Z),
    "Fertig: Die Datei ist als ZIP-Datei „" + Z + "“ heruntergeladen. Noch nicht dabei (wird gerade als PDF gedruckt): „Gestaltet.pdf“. Nicht in der ZIP-Datei: „Kaputt.pdf“ (Fehler 404).");
  assert.equal(PN.doneText(2, [], [{ f: f("Kaputt"), msg: "Fehler 404" }], false, [], Z),
    "Fertig: 2 Dateien sind als eine ZIP-Datei „" + Z + "“ heruntergeladen. Nicht in der ZIP-Datei: „Kaputt.pdf“ (Fehler 404).", "mit Fehlern nicht „Alle“");
  assert.equal(PN.doneText(0, [], [{ f: f("Kaputt"), msg: "Fehler 404" }], false, [], Z), "Keine Datei heruntergeladen. Nicht heruntergeladen: „Kaputt.pdf“ (Fehler 404).");
  assert.equal(PN.doneText(1, [], [], true, [], Z), "Abgebrochen – keine ZIP-Datei heruntergeladen.");
  assert.equal(PN.printNameOf({ name: "AB.pdf", print: { copies: 3, duplex: false, color: true } }), "3x - farbig - einseitig - AB.pdf", "ohne printName und ohne Kurs: ohne diesen Teil");
  assert.equal(PN.printNameOf({ name: "AB.pdf", print: { copies: 3, duplex: false, color: true } }, "Eth10"), "3x - farbig - einseitig - Eth10 - AB.pdf", "ohne printName mit dem Kurs der Sitzung (Nachtrag 32)");
  assert.equal(PN.printNameOf({ name: "AB.pdf", printName: "Vom Server.pdf" }, "Eth10"), "Vom Server.pdf", "der Name des Servers gilt");
});

test("Aufbau: Überschrift mit Drucker, Tag, je Sitzung eine Gruppe (Link zur Sitzung, „In der Sitzung bearbeiten“), Namen wie in der Druckliste", async () => {
  let release;
  const printed = new Promise((r) => { release = r; });
  const card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText,
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, async () => { await printed; return { file: pfile(4, "Gestaltet.pdf", { status: "ready", source: "claude", pages: 2, design: { outdated: false, error: null, htmlAt: 5, pdfAt: 6, text: "" }, printName: "2x - farbig - beidseitig - PoWi8 - Gestaltet.pdf" }) }; }]]);
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
    ["22x - sw - beidseitig - Reli2 - Arbeitsblatt Josef.pdf", "28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf", "1x - sw - einseitig - PoWi8 - Tafelbild.pdf", "2x - farbig - beidseitig - PoWi8 - Gestaltet.pdf"]);
  assert.equal($(".pn-none", card).textContent, "Ohne Druckaufträge: 11:30 Ethik 10C.");
  // gestaltete Vorlage noch nicht gedruckt: kein Download, Stand wie in der Sitzung; die gemeinsame Warteschlange druckt sie
  const des = $$(".pn-row", card)[3];
  assert.equal($("button", des), null);
  assert.match($(".meta", des).textContent, /wird als PDF gedruckt …/);
  assert.ok(rec.calls.includes("POST /api/teacher/files/" + id(4) + "/render"), "Druck angestoßen");
  // Einzel-Download wie in der Sitzung: signierter Link unter dem Druck-Namen; Text als A4-PDF aus dem Text der Sitzung
  const b = $$(".pn-row", card)[1].querySelector("button");
  assert.equal(b.getAttribute("aria-label"), "Herunterladen – 28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf");
  D.userClick(b); await D.sleep(5);
  assert.deepEqual(rec.urls, [["/api/dl/" + id(2) + "?d=a&e=1&s=x", "28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf"]]);
  assert.equal(document.activeElement, b, "Fokus bleibt auf dem Knopf – " + desc(document.activeElement));
  D.userClick($$(".pn-row", card)[2].querySelector("button")); await until(() => rec.blobs.length === 1, "Text als PDF"); assert.equal(rec.blobs[0][1], "1x - sw - einseitig - PoWi8 - Tafelbild.pdf");
  assert.equal(new TextDecoder().decode(new Uint8Array(await rec.blobs[0][0].arrayBuffer()).subarray(0, 5)), "%PDF-");
  assert.ok(rec.calls.includes("GET /api/teacher/lessons/" + id("b2")), "Text aus der Sitzung geholt");
  // Arbeitsblatt der Kinder mit „Auch ausdrucken“: der Server nennt es wie im Material – auf GitHub Pages (andere Herkunft) zählt sein Name,
  // nicht das download-Attribut. Deshalb als Blob unter dem Druck-Namen, nie über den Link direkt
  D.userClick($$(".pn-row", card)[0].querySelector("button")); await until(() => rec.blobs.length === 2, "Arbeitsblatt der Kinder");
  assert.equal(rec.blobs[1][1], "22x - sw - beidseitig - Reli2 - Arbeitsblatt Josef.pdf");
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

test("„Alle Dateien herunterladen“ (Nachtrag 36): EINE ZIP-Datei des Tages mit den Druck-Namen, Fortschritt, gesperrt während des Packens, nicht gedruckte Vorlage genannt", async () => {
  const seen = [];
  const card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText,
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);   // der Drucker antwortet nicht
  const all = button(card, "Alle Dateien herunterladen");
  assert.ok(all && !all.classList.contains("hidden"));
  assert.equal(all.getAttribute("aria-describedby"), "pn-all-h");
  assert.equal($("#pn-all-h", card).textContent, "„Alle Dateien herunterladen“ lädt alle Dateien als eine ZIP-Datei herunter. Am iPad öffnen Sie sie in der App „Dateien“: Antippen entpackt sie in einen Ordner.");
  const status = $("#pn-status", card);
  assert.equal(status.getAttribute("role"), "status");
  let open, fetches = 0;
  const gate = new Promise((r) => { open = r; });
  const real = PN.io.fetch;
  PN.io.fetch = async (u) => { fetches++; seen.push(status.textContent); if (fetches === 1) await gate; return real(u); };   // die erste Datei hält an
  D.userClick(all);
  await until(() => fetches === 1, "erste Datei wird geholt");
  assert.equal(all.getAttribute("aria-disabled"), "true", "gesperrt, solange er packt");
  assert.equal(document.activeElement, all, "Fokus bleibt – " + desc(document.activeElement));
  assert.equal(rec.blobs.length, 0, "noch keine Datei heruntergeladen (erst die fertige ZIP-Datei)");
  D.userClick(all);   // zweiter Klick während des Laufs: wirkungslos
  open();
  await until(() => /^Fertig/.test(status.textContent), "Abschlussmeldung");
  assert.equal(rec.blobs.length, 1, "genau ein Download");
  const Z = "Druckaufträge - Mittwoch, 18.11.2026.zip";
  assert.equal(rec.blobs[0][1], Z);
  assert.equal(rec.blobs[0][0].type, "application/zip");
  const entries = await zipOf(rec.blobs[0]);
  assert.deepEqual(entries.map((e) => e[0]), ["22x - sw - beidseitig - Reli2 - Arbeitsblatt Josef.pdf", "28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf", "1x - sw - einseitig - PoWi8 - Tafelbild.pdf"]);
  assert.equal(entries[1][1], "%PDF-1.7 /api/dl/" + id(2) + "?d=a&e=1&s=x", "Inhalt über den signierten Link (apiUrl)");
  assert.equal(entries[2][1].slice(0, 5), "%PDF-", "Textmaterial als A4-PDF");
  assert.equal(rec.urls.length, 0);
  assert.deepEqual(seen, ["Packe 1 von 3: „22x - sw - beidseitig - Reli2 - Arbeitsblatt Josef.pdf“ …", "Packe 2 von 3: „28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf“ …"]);
  assert.equal(status.textContent, "Fertig: Alle 3 Dateien sind als eine ZIP-Datei „" + Z + "“ heruntergeladen. Noch nicht dabei (wird gerade als PDF gedruckt): „2x - farbig - beidseitig - PoWi8 - Gestaltet.pdf“.");
  assert.equal(all.getAttribute("aria-disabled"), null);
  // eine Datei lässt sich nicht laden: die übrigen kommen trotzdem in die ZIP-Datei, die Meldung nennt sie
  PN.io.fetch = async (u) => (u.includes(id(1)) ? { ok: false, status: 404 } : { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("%PDF-x").buffer });
  rec.blobs = [];
  D.userClick(all); await until(() => /^Fertig/.test(status.textContent) && rec.blobs.length === 1, "Abschlussmeldung");
  assert.deepEqual((await zipOf(rec.blobs[0])).map((e) => e[0]), ["28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf", "1x - sw - einseitig - PoWi8 - Tafelbild.pdf"]);
  assert.match(status.textContent, /^Fertig: 2 Dateien sind als eine ZIP-Datei „Druckaufträge - Mittwoch, 18\.11\.2026\.zip“ heruntergeladen\. .* Nicht in der ZIP-Datei: „22x - sw - beidseitig - Reli2 - Arbeitsblatt Josef\.pdf“ \(„Arbeitsblatt Josef\.pdf“ ließ sich nicht laden \(Fehler 404\)\.\)\.$/);
  // keine einzige Datei lässt sich laden: keine (leere) ZIP-Datei
  PN.io.fetch = async () => ({ ok: false, status: 500 });
  const only = DATA();
  only.sessions = [{ ...only.sessions[1], files: [only.sessions[1].files[0]] }];
  const c2 = await page([[/^GET \/api\/teacher\/print-next$/, () => only], link]);
  PN.io.fetch = async () => ({ ok: false, status: 500 });
  D.userClick(button(c2, "Alle Dateien herunterladen")); await until(() => /^Keine Datei/.test($("#pn-status", c2).textContent), "Abschlussmeldung ohne ZIP-Datei");
  assert.equal(rec.blobs.length, 0, "keine leere ZIP-Datei");
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Verlassen der Seite bricht „Alle Dateien herunterladen“ ab (keine ZIP-Datei); nur gestaltete, noch nicht gedruckte Vorlagen → Hinweis statt Download", async () => {
  let card = await page([[/^GET \/api\/teacher\/print-next$/, () => DATA()], link, lessonText, [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);
  let fetches = 0;
  const real = PN.io.fetch;
  PN.io.fetch = async (u) => { fetches++; if (fetches === 1) globalThis.__leave(); return real(u); };   // während der ersten Datei verlässt die Lehrkraft die Seite
  D.userClick(button(card, "Alle Dateien herunterladen")); await until(() => fetches === 1, "erste Datei"); await D.sleep(30);
  assert.equal(rec.blobs.length, 0, "nach dem Verlassen keine ZIP-Datei");
  assert.equal(fetches, 1, "keine weiteren Dateien geholt");
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
  assert.equal(status.textContent, "Fertig: Alle 3 Dateien sind als eine ZIP-Datei „Druckaufträge - Mittwoch, 18.11.2026.zip“ heruntergeladen. Nicht dabei, weil der PDF-Druck nicht geklappt hat (in der Sitzung „Erneut drucken“): „2x - farbig - beidseitig - PoWi8 - Gestaltet.pdf“.");
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
  two.sessions[1].files.push(pfile(5, "Zweite.pdf", { status: "pending", source: "claude", design: { outdated: true, error: null, htmlAt: 7, pdfAt: null, text: "" }, printName: "1x - sw - beidseitig - PoWi8 - Zweite.pdf" }));
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => two], link, lessonText,
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => { throw new ApiError("Das Tageskontingent für den PDF-Druck ist aufgebraucht.", 429, { code: "render_quota" }); }]]);
  await until(() => $$(".pn-row .meta", card).filter((m) => /^Noch nicht gedruckt: Das Tageskontingent/.test(m.textContent)).length === 2, "beide Zeilen: noch nicht gedruckt");
  D.userClick(button(card, "Alle Dateien herunterladen"));
  await until(() => /^Fertig/.test($("#pn-status", card).textContent), "Abschlussmeldung");
  assert.match($("#pn-status", card).textContent, /Nicht dabei, weil der PDF-Druck nicht geklappt hat \(in der Sitzung „Erneut drucken“\): „2x - farbig - beidseitig - PoWi8 - Gestaltet\.pdf“, „1x - sw - beidseitig - PoWi8 - Zweite\.pdf“\.$/);
  assert.doesNotMatch($("#pn-status", card).textContent, /wird gerade als PDF gedruckt/);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Nachtrag 32: dasselbe Arbeitsblatt für zwei Klassen desselben Jahrgangs (gleicher Kurs, gleicher Titel) – „Alle Dateien herunterladen“ überschreibt nichts („… (2).pdf“)", async () => {
  const two = DATA();
  const same = (n) => pfile(n, "Arbeitsblatt.pdf", { printName: "28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf" });
  two.sessions = [{ ...two.sessions[1], id: id("c1"), klass: "8A", label: "PoWi 8A", files: [same(11)] }, { ...two.sessions[1], id: id("c2"), klass: "8B", label: "PoWi 8B", startTime: "09:00", files: [same(12)] }];
  const card = await page([[/^GET \/api\/teacher\/print-next$/, () => two], link, lessonText]);
  // in der Liste steht bei beiden Sitzungen der Name der Druckliste (je Sitzung eine eigene Gruppe)
  assert.deepEqual($$(".pn-row .name", card).map((x) => x.textContent), ["28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf", "28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf"]);
  const status = $("#pn-status", card);
  D.userClick(button(card, "Alle Dateien herunterladen")); await until(() => /^Fertig/.test(status.textContent), "Abschlussmeldung");
  assert.equal(rec.blobs.length, 1);
  assert.deepEqual((await zipOf(rec.blobs[0])).map((e) => e[0]), ["28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf", "28x - sw - beidseitig - PoWi8 - Arbeitsblatt (2).pdf"], "eindeutig wie in der ZIP-Datei der Sitzung (uniqueNames)");
});

/* ---------- Nachtrag 33: heute bis zum Ende der jeweiligen Sitzung, daneben der nächste Arbeitstag ---------- */
// Uhr und Zeitgeber der Seite in der Hand des Tests; der Server (nachgebildet) entscheidet mit seiner Uhr, was noch läuft
const M0 = Date.UTC(2026, 10, 16, 7, 0);   // Montag, 16.11.2026, 8:00 in Berlin
const at = (hh, mm = 0) => Date.UTC(2026, 10, 16, hh - 1, mm);
const tf = (n, name, course) => pfile(n, name, { printName: "2x - sw - beidseitig - " + course + " - " + name.replace(/\.pdf$/, "") + ".pdf", print: { copies: 2, duplex: true, color: false } });
const S9 = () => ({ id: id("d1"), subject: "powi", klass: "8A", title: "Erste", date: "2026-11-16", startTime: "09:00", durationMin: 45, endsAt: at(9, 45), school: "gym", label: "PoWi 8A", subtitle: "Politik und Wirtschaft · 8A", printCourse: "PoWi8",
  files: [tf(21, "AB Erste.pdf", "PoWi8")], bring: [{ item: "Beutel", note: "Im Einstieg der 8A." }] });
const S11 = () => ({ id: id("d2"), subject: "ethik", klass: "7B", title: "Zweite", date: "2026-11-16", startTime: "11:00", durationMin: 45, endsAt: at(11, 45), school: "gym", label: "Ethik 7B", subtitle: "Ethik · 7B", printCourse: "Eth7",
  files: [tf(22, "AB Zweite.pdf", "Eth7")] });
const TUE = () => ({ id: id("d3"), subject: "powi", klass: "9D", title: "Dienstag", date: "2026-11-17", startTime: "08:00", school: "gym", label: "PoWi 9D", subtitle: "Politik und Wirtschaft · 9D", printCourse: "PoWi9",
  files: [tf(23, "AB Dienstag.pdf", "PoWi9"), tf(24, "Folie Dienstag.pdf", "PoWi9")], bring: [{ item: "Beutel", note: "Für die Lose der 9D." }] });
// Antwort des Servers zur Zeit now (wie routePrintNext: vorbei = Ende ≤ now; refreshAt = nächstes Ende, spätestens Mitternacht)
function server(now, todays = [S9(), S11()], next = [TUE()]) {
  const keep = todays.filter((s) => s.endsAt === null || s.endsAt > now);
  const refreshAt = Math.min(Date.UTC(2026, 10, 16, 23, 0), ...keep.filter((s) => s.endsAt).map((s) => s.endsAt));
  return { ok: true, today: "2026-11-16", candidate: "2026-11-17", date: "2026-11-17", sessions: next, now, refreshAt, todaySessions: keep };
}
let clock, timers;
function clockPage(getNow, more = []) {
  clock = M0; timers = [];
  const p = page([[/^GET \/api\/teacher\/print-next$/, () => server(getNow ? getNow() : clock)], link, lessonText, ...more]);
  return p;
}
const installClock = () => Object.assign(PN.io, { now: () => clock, timer: (fn, ms) => { const t = { fn, ms, due: clock + ms }; timers.push(t); return t; }, untimer: (t) => { t.off = true; } });
const live = () => timers.filter((t) => !t.off && !t.fired);
async function fireTimers() { for (const t of live()) if (t.due <= clock) { t.fired = true; t.fn(); } await D.sleep(10); }

test("Nachtrag 33 – Texte: Titel, Tagesüberschriften, Zeile mit heute, Wartezeit bis zum Neuladen (relativ zur Uhr des Servers, nie eine Schleife)", () => {
  assert.equal(PN.PN_TITLE, "Druckaufträge für den nächsten Arbeitstag");
  assert.equal(PN.PN_TITLE_TODAY, "Druckaufträge für heute und den nächsten Arbeitstag");
  assert.equal(PN.dayHead("2026-11-16", "2026-11-16"), "Heute, Montag, 16.11.2026");
  assert.equal(PN.dayHead("2026-11-17", "2026-11-16"), "Morgen, Dienstag, 17.11.2026");
  assert.equal(PN.dayHead("2026-11-23", "2026-11-20"), "Montag, 23.11.2026");
  assert.equal(PN.dayTextToday({ today: "2026-11-16", candidate: "2026-11-17", date: "2026-11-17" }), "Heute bis zum Ende der jeweiligen Sitzung, dazu für morgen, Dienstag, 17.11.2026");
  assert.equal(PN.dayTextToday({ today: "2026-11-16", candidate: "2026-11-17", date: "2026-11-18", freeDays: [{ from: "2026-11-17", to: "2026-11-17", label: "Studientag", scope: "both" }] }),
    "Heute bis zum Ende der jeweiligen Sitzung. Am Dienstag, 17.11.2026, ist unterrichtsfrei (Studientag, beide Schulen) – deshalb die Druckaufträge für Mittwoch, 18.11.2026.");
  assert.equal(PN.dayTextToday({ today: "2026-11-16", candidate: "2026-11-17", date: null }), "Heute bis zum Ende der jeweiligen Sitzung; danach ist in den nächsten Wochen kein Unterricht geplant.");
  const m = PN.REFRESH_MARGIN_MS;
  assert.equal(PN.refreshWait({ now: at(8), refreshAt: at(9, 45) }, 0), 105 * 60e3 + m, "relativ zur Uhr des Servers – die Uhr des Geräts zählt nicht");
  assert.equal(PN.refreshWait({ now: at(9, 45), refreshAt: at(9, 45) }, 0), 30e3 + m, "schon vorbei: 30 s, keine Schleife");
  assert.equal(PN.refreshWait({ now: 0, refreshAt: 400 * 3600e3 }, 0), 25 * 3600e3 + m, "höchstens 25 Stunden");
  assert.equal(PN.refreshWait({ ok: true }, at(23, 30)), 30 * 60e3 + m, "älterer Server ohne refreshAt: bis Mitternacht in Berlin");
});

test("Nachtrag 33 – 8:00: zwei Tagesabschnitte (heute mit beiden Stunden, morgen), Sitzungen eine Ebene tiefer, je Tag „Alle Dateien herunterladen“ nur mit seinen Dateien", async () => {
  installClock();
  const card = await clockPage();
  assert.equal($("#pn-h", card).textContent, "Druckaufträge für heute und den nächsten Arbeitstag");
  assert.equal($("#pn-day", card).textContent, "Heute bis zum Ende der jeweiligen Sitzung, dazu für morgen, Dienstag, 17.11.2026");
  const days = $$(".pn-dayg", card);
  assert.deepEqual(days.map((d) => [d.dataset.day, $("h3", d).textContent, d.getAttribute("aria-labelledby") === $("h3", d).id]),
    [["2026-11-16", "Heute, Montag, 16.11.2026", true], ["2026-11-17", "Morgen, Dienstag, 17.11.2026", true]]);
  assert.deepEqual(days.map((d) => $$(".pn-group h4", d).map((x) => x.textContent)), [["09:00–09:45 PoWi 8A – Erste", "11:00–11:45 Ethik 7B – Zweite"], ["08:00 PoWi 9D – Dienstag"]],
    "heute mit dem geplanten Ende (dann verschwindet sie), Sitzungen als h4 unter dem Tag");
  assert.equal($$(".pn-group h3", card).length, 0);
  // Kopf ohne eigenen Knopf; je Tag ein Knopf (sichtbarer Text im Namen – WCAG 2.5.3) und eine Statuszeile
  assert.ok($(".pn-head .pn-all", card).classList.contains("hidden") && !("day" in $(".pn-head .pn-all", card).dataset));
  const btns = days.map((d) => $("button.pn-all", d));
  assert.deepEqual(btns.map((b) => [b.textContent.trim(), b.getAttribute("aria-label"), b.dataset.day, b.getAttribute("aria-describedby")]),
    [["Alle Dateien herunterladen", "Alle Dateien herunterladen – Heute, Montag, 16.11.2026", "2026-11-16", "pn-all-h"], ["Alle Dateien herunterladen", "Alle Dateien herunterladen – Morgen, Dienstag, 17.11.2026", "2026-11-17", "pn-all-h"]]);
  assert.equal($("#pn-all-h", card).textContent, "„Alle Dateien herunterladen“ lädt alle Dateien des jeweiligen Tages als eine ZIP-Datei herunter. Am iPad öffnen Sie sie in der App „Dateien“: Antippen entpackt sie in einen Ordner.");
  D.userClick(btns[0]);
  const st0 = $(".pn-status", days[0]);
  await until(() => /^Fertig/.test(st0.textContent), "heute fertig");
  assert.deepEqual(rec.blobs.map((x) => x[1]), ["Druckaufträge - Montag, 16.11.2026.zip"], "eine ZIP-Datei für heute");
  assert.deepEqual((await zipOf(rec.blobs[0])).map((e) => e[0]), ["2x - sw - beidseitig - PoWi8 - AB Erste.pdf", "2x - sw - beidseitig - Eth7 - AB Zweite.pdf"], "nur die Dateien von heute");
  assert.equal(st0.getAttribute("role"), "status"); assert.equal($(".pn-status", days[1]).textContent, "");
  rec.blobs = [];
  D.userClick(btns[1]); await until(() => /^Fertig/.test($(".pn-status", days[1]).textContent), "morgen fertig");
  assert.deepEqual(rec.blobs.map((x) => x[1]), ["Druckaufträge - Dienstag, 17.11.2026.zip"]);
  assert.deepEqual((await zipOf(rec.blobs[0])).map((e) => e[0]), ["2x - sw - beidseitig - PoWi9 - AB Dienstag.pdf", "2x - sw - beidseitig - PoWi9 - Folie Dienstag.pdf"]);
  assert.equal($(".pn-status", days[1]).textContent, "Fertig: Alle 2 Dateien sind als eine ZIP-Datei „Druckaufträge - Dienstag, 17.11.2026.zip“ heruntergeladen.");
  assert.equal(document.activeElement, btns[1], "Fokus bleibt auf dem Knopf");
  // Zeitgeber bis zum ersten Ende (relativ zur Uhr des Servers, mit Sicherheitsabstand)
  assert.deepEqual(live().map((t) => t.ms), [105 * 60e3 + PN.REFRESH_MARGIN_MS]);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Nachtrag 33 – live: endet eine Sitzung, verschwinden ihre Einträge ohne Neuladen der Seite; übrige Zeilen bleiben dieselben Elemente, der Fokus bleibt bzw. geht an die Überschrift", async () => {
  installClock();
  const card = await clockPage();
  const tueRows = $$(".pn-dayg", card)[1].querySelectorAll(".pn-row"), keepRow = $$(".pn-group", card)[1];
  // Fokus auf „Herunterladen“ einer Datei von morgen
  const tueBtn = tueRows[1].querySelector("button");
  tueBtn.focus();
  const n0 = rec.calls.filter((c) => c === "GET /api/teacher/print-next").length;
  clock = at(9, 45) + PN.REFRESH_MARGIN_MS;
  await fireTimers();
  assert.equal(rec.calls.filter((c) => c === "GET /api/teacher/print-next").length, n0 + 1, "zum Ende der ersten Stunde neu geladen");
  assert.deepEqual($$(".pn-dayg", card)[0].querySelectorAll(".pn-group h4").map((x) => x.textContent), ["11:00–11:45 Ethik 7B – Zweite"], "9:00-Stunde weg");
  assert.equal($$(".pn-group", card)[0], keepRow, "die Gruppe der 11:00-Stunde ist dasselbe Element");
  assert.ok($$(".pn-dayg", card)[1].querySelectorAll(".pn-row")[1] === tueRows[1], "Zeilen von morgen nicht neu aufgebaut");
  assert.equal(document.activeElement, tueBtn, "Fokus bleibt – " + desc(document.activeElement));
  assert.deepEqual(live().map((t) => t.due), [at(11, 45) + PN.REFRESH_MARGIN_MS], "nächster Zeitgeber bis 11:45 (Uhr des Servers beim Laden + Sicherheitsabstand)");
  // Fokus in der Zeile der 11:00-Stunde, dann endet sie: Fokus an die Überschrift des Feldes; nur noch morgen (Titel wie bisher, Sitzungen wieder h3)
  const lastBtn = $$(".pn-dayg", card)[0].querySelector(".pn-row button");
  lastBtn.focus();
  clock = at(11, 45) + 2 * PN.REFRESH_MARGIN_MS;
  await fireTimers();
  assert.equal($$(".pn-dayg", card).length, 0);
  assert.equal($("#pn-h", card).textContent, "Druckaufträge für den nächsten Arbeitstag");
  assert.equal($("#pn-day", card).textContent, "für morgen, Dienstag, 17.11.2026");
  assert.deepEqual($$(".pn-group h3", card).map((x) => x.textContent), ["08:00 PoWi 9D – Dienstag"]);
  assert.equal($$(".pn-row", card)[1], tueRows[1], "Zeilen von morgen bleiben dieselben Elemente (nur umgehängt)");
  assert.equal(document.activeElement, $("#pn-h", card), "Fokus war im verschwundenen Eintrag → Überschrift – " + desc(document.activeElement));
  assert.ok(!$(".pn-head .pn-all", card).classList.contains("hidden") && $(".pn-head .pn-all", card).dataset.day === "2026-11-17", "Knopf wieder im Kopf");
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Nachtrag 33 – live: wechselt der Aufbau (letzte Stunde von heute vorbei), behält ein Knopf von morgen den Fokus; nach dem Ruhezustand prüft Tab-Wechsel bzw. Fokus nach", async () => {
  installClock();
  let card = await clockPage();
  const tueBtn = $$(".pn-dayg", card)[1].querySelector(".pn-row button");
  tueBtn.focus();
  // Ruhezustand: der Zeitgeber feuert nicht, die Uhr springt auf 12:00 – beim Zurückkehren (visibilitychange) wird nachgesehen
  clock = at(12, 0);
  D.fire(document, "visibilitychange"); await D.sleep(10);
  assert.equal($$(".pn-dayg", card).length, 0, "nur noch morgen");
  assert.equal(document.activeElement, tueBtn, "derselbe Knopf behält den Fokus – " + desc(document.activeElement));
  // noch nicht so weit: Fokus des Fensters lädt nicht neu
  card = await clockPage();
  const n0 = rec.calls.length;
  D.fire(window, "focus"); await D.sleep(5);
  assert.equal(rec.calls.length, n0, "vor dem nächsten Ende kein Neuladen");
  clock = at(10, 0);
  D.fire(window, "focus"); await D.sleep(10);
  assert.deepEqual($$(".pn-dayg", card)[0].querySelectorAll(".pn-group h4").map((x) => x.textContent), ["11:00–11:45 Ethik 7B – Zweite"], "Fokus des Fensters nach dem Ende: neu geladen");
  // nach dem Verlassen der Seite: kein Zeitgeber, keine Zuhörer mehr
  globalThis.__leave();
  assert.equal(live().length, 0);
  const n1 = rec.calls.length;
  clock = at(13, 0); D.fire(window, "focus"); D.fire(document, "visibilitychange"); await D.sleep(5);
  assert.equal(rec.calls.length, n1);
});

// Prüfbefund (S31 check): nach dem Aufwachen des Geräts ist das Netz oft noch nicht da – das Neuladen im Hintergrund scheiterte und ersetzte die ganze Liste
// (samt rotem Kasten) durch „Die Druckaufträge ließen sich nicht laden …“
test("Nachtrag 33 – live: scheitert das Neuladen im Hintergrund (kein Netz nach dem Ruhezustand), bleiben die Druckaufträge stehen; neuer Versuch bei „online“, Fokus bzw. später", async () => {
  installClock();
  if (globalThis.__leave) globalThis.__leave();
  resetPrintQueue();
  clock = M0; timers = [];
  rec = { calls: [], urls: [], blobs: [], sleeps: 0 };
  let offline = false;
  globalThis.__tapi = async (m, p) => {
    rec.calls.push(m + " " + p);
    if (m + " " + p !== "GET /api/teacher/print-next") throw new ApiError("nicht nachgebildet", 404, {});
    if (offline) throw new ApiError("Keine Verbindung zum Server. Bitte Internetverbindung prüfen.", 0, { code: "network" });
    return server(clock);
  };
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove();
  const { card, pack } = PN.printNextCards();
  app.append(card, pack); await D.sleep(5);
  const tueBtn = $$(".pn-dayg", card)[1].querySelector(".pn-row button");
  tueBtn.focus();
  const loads = () => rec.calls.filter((c) => c === "GET /api/teacher/print-next").length;
  // Ruhezustand bis 10:00, beim Aufwachen kein Netz
  offline = true; clock = at(10, 0);
  D.fire(document, "visibilitychange"); await D.sleep(10);
  assert.equal(loads(), 2, "nach dem Aufwachen nachgesehen");
  assert.equal($$(".pn-err", card).length, 0, "keine Fehlermeldung statt der Druckaufträge");
  assert.equal($$(".pn-dayg", card).length, 2, "der bisherige Stand bleibt stehen (beide Tage)");
  assert.ok(tueBtn.isConnected && document.activeElement === tueBtn, "derselbe Knopf, derselbe Fokus – " + desc(document.activeElement));
  assert.ok(!pack.classList.contains("hidden") && $$(".pk-dayg", pack).length === 2, "der rote Kasten bleibt ebenso");
  const w = live();
  assert.equal(w.length, 1, "ein Zeitgeber für den neuen Versuch");
  assert.equal(w[0].ms, PN.RETRY_MS, "neuer Versuch nach 30 s");
  // noch ohne Netz: der Zeitgeber versucht es erneut und wartet dann länger (höchstens 5 Minuten)
  clock += PN.RETRY_MS; await fireTimers();
  assert.equal(loads(), 3);
  assert.equal(live()[0].ms, 2 * PN.RETRY_MS);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(PN.retryWait), [30e3, 60e3, 120e3, 240e3, 300e3, 300e3]);
  // das Netz ist wieder da („online“): sofort neu geladen, die 9:00-Stunde ist vorbei
  offline = false;
  D.fire(window, "online"); await D.sleep(10);
  assert.equal(loads(), 4, "„online“ lädt sofort");
  assert.deepEqual($$(".pn-dayg", card)[0].querySelectorAll(".pn-group h4").map((x) => x.textContent), ["11:00–11:45 Ethik 7B – Zweite"]);
  assert.equal(document.activeElement, tueBtn, "Fokus bleibt – " + desc(document.activeElement));
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, at(11, 45) - clock + PN.REFRESH_MARGIN_MS, "danach wieder bis zum nächsten Ende");
  // ein Fehler beim ersten Laden (keine Daten) zeigt weiter die Meldung mit „Erneut versuchen“
  globalThis.__leave();
  offline = true;
  while (app.firstChild) app.firstChild.remove();
  const c2 = PN.printNextCard(); app.append(c2); await D.sleep(10);
  assert.equal($$(".pn-err", c2).length, 1, "erstes Laden ohne Netz: Fehlermeldung");
  assert.ok(button(c2, "Erneut versuchen"));
  // nach dem Verlassen der Seite hört auch „online“ nicht mehr zu
  globalThis.__leave();
  const n1 = loads(); offline = false;
  D.fire(window, "online"); await D.sleep(5);
  assert.equal(loads(), n1);
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Nachtrag 33 – live: während ein Download läuft, wartet das Neuladen; danach verschwindet die Sitzung", async () => {
  installClock();
  let release;
  const gate = new Promise((r) => { release = r; });
  const card = await clockPage(null, []);
  // Einzel-Download der 9:00-Stunde hängt (Link vom Server kommt erst später)
  globalThis.__tapi = ((orig) => async (m, p, o) => { if (m === "POST" && /files\/a+21\/link$/.test(p)) { await gate; } return orig(m, p, o); })(globalThis.__tapi);
  const b = $$(".pn-dayg", card)[0].querySelector(".pn-row button");
  D.userClick(b); await D.sleep(5);
  assert.equal(b.getAttribute("aria-busy"), "true");
  const n0 = rec.calls.filter((c) => c === "GET /api/teacher/print-next").length;
  clock = at(9, 46); await fireTimers();
  assert.equal(rec.calls.filter((c) => c === "GET /api/teacher/print-next").length, n0, "kein Neuladen unter dem laufenden Download");
  assert.ok(b.isConnected);
  release(); await until(() => rec.calls.filter((c) => c === "GET /api/teacher/print-next").length === n0 + 1, "gleich danach neu geladen");
  await D.sleep(10);
  assert.ok(!b.isConnected && $$(".pn-dayg", card)[0].querySelectorAll(".pn-group").length === 1, "danach ist die Stunde weg");
  assert.equal(rec.urls.length, 1, "der Download kam trotzdem an");
});

test("Nachtrag 33 – roter Kasten: Gegenstände für heute (noch laufende Sitzungen) und morgen, je Tag beschriftet; folgt dem Ende der Sitzungen", async () => {
  installClock();
  if (globalThis.__leave) globalThis.__leave();
  resetPrintQueue();
  clock = M0; timers = [];
  globalThis.__tapi = async (m, p) => { if (m + " " + p === "GET /api/teacher/print-next") return server(clock); throw new ApiError("nicht nachgebildet", 404, {}); };
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove();
  const { card, pack } = PN.printNextCards();
  app.append(card, pack); await D.sleep(5);
  assert.equal($("#pk-h", pack).textContent, "Für heute und den nächsten Arbeitstag einpacken");
  assert.equal($("#pk-day", pack).textContent, "Heute bis zum Ende der jeweiligen Sitzung, dazu für morgen, Dienstag, 17.11.2026");
  const groups = $$(".pk-dayg", pack);
  assert.deepEqual(groups.map((g) => [g.dataset.day, $("h3", g).textContent, $$("button.pk-item", g).map((b) => b.textContent)]),
    [["2026-11-16", "Heute, Montag, 16.11.2026", ["Beutel"]], ["2026-11-17", "Morgen, Dienstag, 17.11.2026", ["Beutel"]]], "derselbe Gegenstand an zwei Tagen: je Tag ein Stichpunkt");
  const tueItem = $("button.pk-item", groups[1]);
  D.userClick(tueItem);
  assert.equal(tueItem.getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById(tueItem.getAttribute("aria-controls")).textContent, "PoWi 9D, 08:00 Uhr: Für die Lose der 9D.");
  // 9:45: die 9:00-Stunde ist vorbei – heute ohne Gegenstände: nur noch morgen, wie bisher; der aufgeklappte Stichpunkt bleibt dasselbe Element mit dem Fokus
  clock = at(9, 50); await fireTimers();
  assert.equal($("#pk-h", pack).textContent, "Für den nächsten Arbeitstag einpacken");
  assert.equal($("#pk-day", pack).textContent, "für morgen, Dienstag, 17.11.2026");
  assert.equal($$(".pk-dayg", pack).length, 0);
  assert.deepEqual($$("button.pk-item", pack), [tueItem]);
  assert.equal(tueItem.getAttribute("aria-expanded"), "true", "bleibt aufgeklappt");
  assert.equal(document.activeElement, tueItem, "Fokus bleibt – " + desc(document.activeElement));
  // nur heute Gegenstände: „Für heute einpacken“
  clock = M0;
  const only = PN.packHead(PN.packDays({ ...server(M0), sessions: [] }), server(M0));
  assert.deepEqual(only, { title: "Für heute einpacken", day: "für heute, Montag, 16.11.2026 – bis zum Ende der jeweiligen Sitzung" });
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Nachtrag 33 – heute ohne Druckaufträge (nur Gegenstände bzw. Sitzungen ohne Dateien): das Feld zeigt wie bisher nur den nächsten Arbeitstag; ältere Antwort ohne todaySessions ebenso", async () => {
  installClock();
  const noFiles = () => { const s = S9(); s.files = []; return s; };
  clock = M0; timers = [];
  let card = await page([[/^GET \/api\/teacher\/print-next$/, () => server(M0, [noFiles()])], link]);
  assert.equal($("#pn-h", card).textContent, "Druckaufträge für den nächsten Arbeitstag");
  assert.equal($("#pn-day", card).textContent, "für morgen, Dienstag, 17.11.2026");
  assert.equal($$(".pn-dayg", card).length, 0);
  assert.deepEqual($$(".pn-group h3", card).map((x) => x.textContent), ["08:00 PoWi 9D – Dienstag"]);
  const old = server(M0); delete old.todaySessions; delete old.now; delete old.refreshAt;
  card = await page([[/^GET \/api\/teacher\/print-next$/, () => old], link]);
  assert.equal($$(".pn-dayg", card).length, 0);
  assert.equal($("#pn-h", card).textContent, "Druckaufträge für den nächsten Arbeitstag");
});

// Prüfbefund im echten Browser: die Startseite hängt das Feld erst ein, nachdem es geladen hat – gemerkte Abschnitte dürfen dann nicht als „weg“ gelten,
// und ein frühes „pageshow“ (beim ersten Laden) darf weder Zeitgeber noch Zuhörer abräumen
test("Nachtrag 33 – das Feld hängt erst nach dem Laden im Dokument (wie auf der Startseite): Tagesabschnitte, Knöpfe und Zeitgeber bleiben, ein frühes „pageshow“ räumt nichts ab", async () => {
  installClock();
  if (globalThis.__leave) globalThis.__leave();
  resetPrintQueue();
  clock = M0; timers = [];
  rec = { calls: [], urls: [], blobs: [], sleeps: 0 };
  globalThis.__tapi = async (m, p, o = {}) => { rec.calls.push(m + " " + p); if (m + " " + p === "GET /api/teacher/print-next") return server(clock); const x = link[0].exec(m + " " + p); if (x) return link[1](x, o.body || {}); throw new ApiError("nicht nachgebildet", 404, {}); };
  Object.assign(PN.io, { url: (u, n) => rec.urls.push([u, n]), blob: (b, n) => rec.blobs.push([b, n]), fetch: async (u) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7 " + u).buffer }) });
  const app = document.getElementById("app");
  app.replaceChildren();
  const { card, pack } = PN.printNextCards();
  await D.sleep(10);   // geladen und aufgebaut, aber noch nicht eingehängt
  D.fire(window, "pageshow"); D.fire(document, "visibilitychange");
  app.append(card, pack);
  assert.equal(live().length, 1, "Zeitgeber bis zum ersten Ende steht");
  const b = $$(".pn-dayg", card)[0].querySelector("button.pn-all");
  D.userClick(b);
  await until(() => /^Fertig/.test($$(".pn-dayg", card)[0].querySelector(".pn-status").textContent), "heute heruntergeladen");
  assert.equal(rec.blobs.length, 1, "eine ZIP-Datei");
  assert.equal((await zipOf(rec.blobs[0])).length, 2, "mit beiden Dateien von heute");
  const keep = $$(".pn-group", card)[1];
  clock = at(9, 46); await fireTimers();
  assert.equal($$(".pn-group", card)[0], keep, "die 11:00-Gruppe bleibt dasselbe Element (gemerkt, obwohl beim ersten Aufbau nicht im Dokument)");
});
