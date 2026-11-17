// „Videofolien“ der Sitzungsseite (Nachtrag 38, public/videopanel.js): eine Zeile des Formulars lesen (Folie, Link, Start, Ende, Titel) mit Meldungen,
// die sagen, was fehlt, und dem Feld, das den Fokus bekommt; Zusammenfassung im Kopf des Feldes. Den Ablauf im Browser prüft E2E (videoslides.mjs).
import test from "node:test";
import assert from "node:assert/strict";
const { installDom } = await import("./fake-dom.mjs");
installDom({ hash: "#/" });
const { readVideoRow, videosSummary, VIDEOS_HINT } = await import("../../public/videopanel.js");
const ID = "Fk1u8VKrJGA";

test("Videofolie aus dem Formular: Link (auch youtu.be, mit Startzeit), Start/Ende als m:ss, Titel; Meldungen mit dem betroffenen Feld", () => {
  assert.deepEqual(readVideoRow({ slide: "3", link: "https://www.youtube.com/watch?v=" + ID, start: "1:30", end: "4:05", title: "  Das   BVerfG " }, 1),
    { v: { n: 3, id: ID, start: 90, end: 245, title: "Das BVerfG" } });
  assert.deepEqual(readVideoRow({ slide: "2", link: "youtu.be/" + ID + "?t=42", start: "", end: "", title: "" }, 1), { v: { n: 2, id: ID, start: 42 } }, "Start aus dem Link");
  assert.deepEqual(readVideoRow({ slide: "2", link: "https://youtu.be/" + ID + "?t=42", start: "0:00", end: "", title: "" }, 1), { v: { n: 2, id: ID } }, "0:00 = von vorn");
  const err = (row, field, re) => { const r = readVideoRow({ slide: "2", link: "https://youtu.be/" + ID, start: "", end: "", title: "", ...row }, 4); assert.equal(r.field, field, JSON.stringify(row)); assert.match(r.error, re); };
  err({ slide: "" }, "sel", /^Video 4: Bitte eine Folie wählen\.$/);
  err({ link: "" }, "link", /^Video 4: Bitte den Link des YouTube-Videos eingeben\.$/);
  err({ link: "https://vimeo.com/1" }, "link", /kein Link zu einem YouTube-Video/);
  err({ link: "https://www.youtube.com/playlist?list=PL1" }, "link", /Playlists lassen sich nicht einbetten/);
  err({ start: "später" }, "start", /Startzeit verstehe ich nicht/);
  err({ end: "bald" }, "end", /Ende verstehe ich nicht/);
  err({ start: "2:00", end: "1:00" }, "end", /Das Ende muss hinter dem Start liegen/);
  assert.equal(readVideoRow({ slide: "2", link: "https://youtu.be/" + ID, title: "x".repeat(300) }, 1).v.title.length, 160);
});

test("Kopf des Feldes: woher die Videofolien kommen und auf welchen Folien sie stehen", () => {
  assert.equal(videosSummary({ videos: { pdf: [{ n: 2, id: ID }, { n: 5, id: ID }], hand: null } }), "aus der PDF: Folien 2, 5");
  assert.equal(videosSummary({ videos: { pdf: null, hand: [{ n: 4, id: ID }] } }), "von Ihnen festgelegt: Folie 4");
  assert.equal(videosSummary({ videos: { pdf: [{ n: 2, id: ID }], hand: [] } }), "keine (von Ihnen festgelegt)");
  assert.equal(videosSummary({ videos: { pdf: null, hand: null } }), "keine");
  assert.match(VIDEOS_HINT, /die Schüler:innen sehen live nur die Folie|Die Schüler:innen sehen live nur die Folie/);
});
