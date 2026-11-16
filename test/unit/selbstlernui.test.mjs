// Nachtrag 29 (15.11.2026): Selbstlern-Phase – Lehrkraft-Seite (public/substitute.js) im nachgebildeten DOM: Karte, Stationen, Verweise, Feibeitsblatt anlegen,
// Knopf an der Seite, Wiederherstellen; ältere Vertretungen nur lesbar. Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { stubs, installDom } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk/s/x" });
const SL = await import("../../public/selbstlern.js");
const SEK = { lessonId: "0123456789abcdef", code: "K7QM4X", subject: "powi", klass: "8B", lesson: { title: "Gewaltenteilung", durationMin: 45, date: "2026-11-17", startTime: "08:00" } };

/* ---------- Lehrkraft-Seite (public/substitute.js) ---------- */
const UI = await import("../../public/substitute.js");
function mountCards(sub, extra = {}) {
  const calls = [], drafts = [{ id: "b".repeat(16), status: "draft", sheetCode: null, data: { title: "Selbstlern-Blatt", tasks: [{ text: "Erkläre." }] } }];
  globalThis.__tapi = async (method, path, o = {}) => { calls.push({ method, path, body: o.body }); return { ok: true, removedSheets: [] }; };
  const st = { lesson: { id: "l1", subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-17", homework: "Erledige alle Stationen." },
    files: [{ id: "5".repeat(16), name: "Selbstlern-Präsentation.pdf", area: "student", status: "ready", source: "selbstlern" }, { id: "1".repeat(16), name: "Original-Arbeitsblatt.pdf", area: "archive", status: "ready", source: "claude" },
      { id: "7".repeat(16), name: "Übrig.pdf", area: "student", status: "ready", source: "selbstlern" }],
    drafts, sheets: [], sub, ...extra };
  const opened = [], reloads = [];
  const cards = UI.substituteCards({ id: "l1", st, L: () => st.lesson, ctx: () => ({ ...SEK, lessonId: "l1" }), analog: false, reload: () => reloads.push(1), openDraft: (d, o) => opened.push({ d, o }),
    flushPortal: () => {}, teacherNext: () => "2026-11-19" });
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(cards.main, cards.side);
  const btn = (t) => [...document.querySelectorAll("#app button")].find((b) => b.textContent === t);
  return { cards, st, calls, opened, reloads, btn };
}
const STORED = { kind: "selbstlern", v: 1, analog: false, einleitung: "Ziel: Du kannst die Gewaltenteilung erklären.", hinweisAufsicht: "Bitte nur für Ruhe sorgen.", material: [], hausaufgabe: "Erledige alle Stationen.",
  stationen: [{ nr: 1, id: "11111111", titel: "Präsentation", typ: "praesentation", anleitung: "Klicke dich **durch**.", minuten: 10, fileId: "5".repeat(16) },
    { nr: 2, id: "22222222", titel: "Video", typ: "video", anleitung: "Schau das Video.", minuten: 8, video: { id: "Fk1u8VKrJGA", start: 45 } },
    { nr: 3, id: "33333333", titel: "Feibeitsblatt", typ: "feibeitsblatt", anleitung: "Bearbeite es.", minuten: 15, draftId: "b".repeat(16) },
    { nr: 4, id: "44444444", titel: "Erkläre es dem Chatbot", typ: "erklaer_chatbot", anleitung: "Erkläre es.", minuten: 10, bot: { erklaeren: "Erkläre die Gewaltenteilung.", kernpunkte: ["drei Gewalten"], fehlvorstellungen: [] } }] };

test("Lehrkraft-Seite: Karte „Selbstlern-Phase“ mit Vorschau oben, Stationen, Verweisen, Hausaufgabe, Archiv; Feibeitsblatt anlegen; Knopf an der Seite; Wiederherstellen", async () => {
  const m = mountCards({ status: "selbstlern", proposal: STORED, archive: { portal: "**1) Einstieg**", homework: "Lies M2.", sheets: [{ code: "AEH4VY", title: "Original-Blatt" }] }, confirmedAt: Date.parse("2026-11-16T09:00:00Z"), updatedAt: 1 });
  const card = document.querySelector(".substitute.selbstlern");
  assert.equal(document.querySelector("#sl-h").textContent, "Selbstlern-Phase");
  assert.equal(card.getAttribute("aria-labelledby"), "sl-h");
  const t = card.textContent;
  for (const s of [SL.SELBSTLERN_INTRO, "Ziel: Du kannst die Gewaltenteilung erklären.", "Ablaufplan: 4 Stationen (ca. 43 Minuten)", "Präsentation zum Durchklicken", "Datei: „Selbstlern-Präsentation.pdf“",
    "YouTube-Video ab 0:45", "auf YouTube ansehen", "ist noch nicht angelegt", "Die Schüler:innen erklären dem Chatbot: Erkläre die Gewaltenteilung.", "drei Gewalten",
    "Material der Selbstlern-Phase ohne Station (die Schüler:innen sehen es trotzdem): „Übrig.pdf“", "Hausaufgabe (für die Schüler:innen von Anfang an sichtbar)", "Bis zur nächsten Sitzung mit Ihnen am Do, 19.11.2026:",
    "Hinweis für die Aufsicht", "Ursprüngliche Planung (archiviert)", "Original-Arbeitsblatt.pdf", "Original-Blatt (AEH-4VY)"]) assert.ok(t.includes(s), s);
  const yt = card.querySelector('a[href^="https://www.youtube.com/watch"]');
  assert.deepEqual([yt.getAttribute("href"), yt.getAttribute("target"), yt.getAttribute("rel")], ["https://www.youtube.com/watch?v=Fk1u8VKrJGA&t=45s", "_blank", "noopener noreferrer"]);
  assert.ok(!card.querySelector("iframe"), "nie ein eingebettetes Video auf der Lehrkraft-Seite");
  assert.ok(!t.includes("Bestätigen"), "kein „Vorschlag bestätigen“ mehr");
  m.btn("Feibeitsblatt prüfen und anlegen").click();
  assert.equal(m.opened[0].d.id, "b".repeat(16));
  // angelegt → Code statt Knopf
  m.st.drafts[0].status = "created"; m.st.drafts[0].sheetCode = "SQB234"; m.opened[0].o.onCreated();
  assert.ok(document.querySelector(".selbstlern").textContent.includes("„Selbstlern-Blatt“, Code SQB-234") && !m.btn("Feibeitsblatt prüfen und anlegen"));
  // Seitenkarte: Knopf mit dem Wortlaut der Lehrkraft, Stand
  const side = document.querySelector(".selfside");
  assert.equal(side.querySelector("h2").textContent, "Ohne Lehrkraft");
  assert.ok(side.textContent.includes("Selbstlern-Phase aktiv") && m.btn(SL.SELBSTLERN_BUTTON));
  // Wiederherstellen: Rückfrage nennt das Material, das gelöscht wird
  m.btn("Wiederherstellen – zurück zur normalen Sitzung").click(); await D.sleep(5);
  const dlg = document.querySelector(".modal");
  assert.ok(dlg.textContent.includes("Zurück zur normalen Sitzung?") && dlg.textContent.includes("Das Material der Selbstlern-Phase wird gelöscht („Selbstlern-Präsentation.pdf“, „Übrig.pdf“)"));
  [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Wiederherstellen").click(); await D.sleep(15);
  assert.ok(m.calls.some((x) => x.method === "POST" && x.path === "/api/teacher/lessons/l1/substitute/restore") && m.reloads.length === 1);
});

test("Lehrkraft-Seite: älterer Vertretungsvorschlag nur lesbar (verwerfen, nicht bestätigen); ältere aktive Vertretung mit Wiederherstellen; Knopf mit älterer aktiver Vertretung meldet es", async () => {
  let m = mountCards({ status: "vorschlag", proposal: { analyse: { kompetenz: "Urteilen", stundenfrage: "Wie?", inhalte: ["A"] }, hinweis: "Alt.", schritte: [{ titel: "Lesen", anleitung: "Lies." }], materialien: [{ titel: "M1" }] }, updatedAt: 1 });
  const t = document.querySelector("#app").textContent;
  assert.ok(t.includes("Älterer Vertretungsvorschlag") && t.includes("lassen sich nicht mehr bestätigen") && t.includes("Material: M1") && m.btn("Vorschlag verwerfen"));
  assert.ok(![...document.querySelectorAll("#app button")].some((b) => /Bestätigen/.test(b.textContent)));
  m = mountCards({ status: "aktiv", proposal: { hinweis: "Alt.", schritte: [{ titel: "Lesen", anleitung: "Lies." }] }, archive: { portal: "x", sheets: [] }, confirmedAt: 1, updatedAt: 1 });
  assert.ok(document.querySelector("#sub-act-h").textContent === "Vertretung aktiv" && m.btn("Ursprüngliche Planung wiederherstellen") && m.btn("Ursprüngliche Planung in eine andere Sitzung übernehmen"));
  m.btn(SL.SELBSTLERN_BUTTON).click(); await D.sleep(5);
  assert.ok(!document.querySelector(".modal"), "kein Dialog (kein Prompt)");
  assert.ok([...document.querySelectorAll(".toast")].some((x) => x.textContent.includes("Für diese Sitzung ist noch eine ältere Vertretung aktiv – stellen Sie oben zuerst die ursprüngliche Planung wieder her.")));
});
