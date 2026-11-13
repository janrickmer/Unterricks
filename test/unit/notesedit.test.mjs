// Notizen der Lehrkraft in der Sitzung bearbeiten (Nachtrag 20, public/notesedit.js) im Browser-Ersatz (fake-dom.mjs) – Ablaufprüfung:
// was beim Speichern gekürzt würde, sagt das Feld vorher und die Meldung danach (nie still); nach dem Speichern – auch nach der Rückfrage bei 409 –
// steht der Fokus wieder auf „Notizen speichern“ statt auf body.
import test from "node:test";
import assert from "node:assert/strict";
const { installDom } = await import("./fake-dom.mjs");
const D = installDom({ hash: "#/" });
const S = await import("../../public/shared.js");
const { notesPanel, notesCutNote, NOTES_UNREADABLE, NOTES_DELETE_TEXT, NOTES_REPLACE_HINT } = await import("../../public/notesedit.js");

const P = { id: "pres1", pages: 2, notes: 1 };
const SLIDES = { urls: ["/f/1", "/f/2"], notes: [{ n: 1, items: ["Einstieg"] }], notesRev: 1, codeSlides: [] };
const conflictErr = (cur) => Object.assign(new Error("Die Notizen wurden inzwischen an anderer Stelle geändert."), { status: 409, data: { current: cur } });

// Server-Ersatz: PUT prüft den Stand wie routeNotesPut (cleanSlideNotes), conflictOnce = erste Anfrage 409
function mount({ conflictOnce = null } = {}) {
  const puts = [];
  let rev = 1, pending = conflictOnce;
  const request = async (method, path, o = {}) => {
    if (method === "PUT") {
      puts.push(o.body);
      if (pending) { const c = pending; pending = null; rev = c.rev; throw conflictErr(c); }
      if (o.body.rev !== rev) throw conflictErr({ notes: [], rev });
      rev++;
      return { ok: true, notes: S.cleanSlideNotes(o.body.notes, P.pages), rev, removed: [], file: { notes: 1 } };
    }
    return { ok: true, notes: SLIDES.notes, rev };
  };
  const ui = { open: false, base: null, draft: null };
  const box = notesPanel({ p: { ...P }, slides: structuredClone(SLIDES), ui, request, toastErr: (e) => { throw e; },
    onSaved: async (r, say) => { say("Gespeichert. Die „Präsentation mit Anmerkungen“ unter „Material nur für die Lehrkraft“ ist erneuert.", "ok"); } });
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(box);
  const btn = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent === t);
  return { box, puts, ui, btn, field: (n) => document.getElementById("nt-pres1-" + n), warn: (n) => document.getElementById("nt-pres1-" + n + "-w"),
    status: () => box.querySelector(".notes-status").textContent };
}
const until = async (fn, ms = 2000) => { for (let i = 0; i < ms / 5; i++) { if (fn()) return true; await D.sleep(5); } return false; };

test("Feld mit mehr als 12 Stichpunkten bzw. einem über 300 Zeichen: Hinweis unter dem Feld, nach dem Speichern sagt die Meldung, was gekürzt wurde", async () => {
  assert.equal(S.noteFieldIssue("a\nb\n\n- c"), "");
  assert.equal(S.noteFieldIssue(Array.from({ length: 13 }, (_, i) => "Punkt " + i).join("\n")), "Mehr als 12 Stichpunkte – gespeichert werden nur die ersten 12.");
  assert.equal(S.noteFieldIssue("ä".repeat(301)), "Mindestens ein Stichpunkt hat mehr als 300 Zeichen – er wird beim Speichern gekürzt.");
  assert.equal(S.noteFieldIssue("- " + "ä".repeat(300)), "", "Aufzählungszeichen zählt nicht mit (wie beim Speichern)");
  assert.match(S.noteFieldIssue(Array.from({ length: 13 }, () => "x".repeat(400)).join("\n")), /^Mehr als 12 Stichpunkte, und mindestens einer hat mehr als 300 Zeichen/);
  const M = mount();
  D.userClick(M.btn("Notizen ansehen und bearbeiten"));
  await until(() => M.field(2));
  assert.equal(M.warn(2).textContent, "");
  assert.ok(M.field(2).getAttribute("aria-describedby").split(" ").includes("nt-pres1-2-w"), "der Hinweis gehört zum Feld (aria-describedby)");
  M.field(2).value = Array.from({ length: 14 }, (_, i) => (i === 0 ? "Lang " + "ü".repeat(320) : "Zeile " + (i + 1))).join("\n");
  D.fire(M.field(2), "input");
  assert.match(M.warn(2).textContent, /^Mehr als 12 Stichpunkte, und mindestens einer hat mehr als 300 Zeichen/);
  D.userClick(M.btn("Notizen speichern"));
  assert.ok(await until(() => M.status().includes("ist erneuert")), M.status());
  assert.ok(M.status().endsWith(notesCutNote([2])) && notesCutNote([2]) === "Gekürzt bei Folie 2 – je Folie höchstens 12 Stichpunkte mit je höchstens 300 Zeichen.", M.status());
  assert.equal(M.field(2).value.split("\n").length, 12, "das Feld zeigt den gespeicherten (gekürzten) Stand");
  assert.equal(M.warn(2).textContent, "", "… und der Hinweis ist weg");
  assert.equal(notesCutNote([2, 5, 7]), "Gekürzt bei Folie 2, 5 und 7 – je Folie höchstens 12 Stichpunkte mit je höchstens 300 Zeichen.");
});

test("409 beim Speichern: nach „Meine Fassung speichern“ bzw. „Neuen Stand laden“ steht der Fokus wieder auf „Notizen speichern“ (nicht auf body)", async () => {
  for (const choice of ["Meine Fassung speichern", "Neuen Stand laden"]) {
    const M = mount({ conflictOnce: { notes: [{ n: 2, items: ["ANDERSWO"] }], rev: 5 } });
    D.userClick(M.btn("Notizen ansehen und bearbeiten"));
    await until(() => M.field(1));
    M.field(1).value = "Meine Fassung"; D.fire(M.field(1), "input");
    const save = M.btn("Notizen speichern");
    D.userClick(save);
    assert.ok(await until(() => document.querySelector(".modal")), "Rückfrage bei 409");
    await D.sleep(40);
    D.userClick([...document.querySelectorAll(".modal button")].find((b) => b.textContent === choice));
    if (choice === "Meine Fassung speichern") assert.ok(await until(() => M.status().includes("ist erneuert")), M.status());
    else assert.ok(await until(() => M.field(2).value === "ANDERSWO"));
    assert.ok(await until(() => document.activeElement === save), choice + ": Fokus auf „Notizen speichern“, nicht " + document.activeElement.tagName);
    if (choice === "Meine Fassung speichern") assert.deepEqual(M.puts.at(-1), { notes: [{ n: 1, items: ["Meine Fassung"] }], rev: 5 }, "bewusst über den neuen Stand");
  }
});

test("Hinweise beim Hochladen, Löschen und Ersetzen nennen die Notizen", () => {
  assert.ok(NOTES_UNREADABLE.includes("„unterricks-notizen.json“") && NOTES_UNREADABLE.includes("„JSON aus dem Chat einfügen“"));
  assert.ok(NOTES_DELETE_TEXT.startsWith("Präsentation, Folienbilder und Ihre Notizen zu den Folien") && NOTES_DELETE_TEXT.includes("„Präsentation mit Anmerkungen“"));
  assert.ok(NOTES_REPLACE_HINT.includes("Unterricks übernimmt die Notizen der neuen PDF"));
});
