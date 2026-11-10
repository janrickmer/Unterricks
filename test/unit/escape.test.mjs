import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEscapeRoom, gradePart, missingOf, wordMatches, numberMatches, fbEscapeHash, escapeRecord, saveEncode, saveDecode, SAVE_BEGIN, SAVE_END, confirmCode, tunnelUrl, b64url } from "../../public/escape-data.js";

const sec = (k) => ({ ueberschrift: "Thema " + k, text: "Text " + k });
const station = (i, teile) => ({ titel: "S" + i, ort: "Ort", bibliothek: { abschnitte: [sec(1), sec(2)] }, raetsel: { auftrag: "A", teile, erfolg: "Gut" }, erlaeuterung: "E" + i });
const ew = { typ: "einfachwahl", frage: "F?", optionen: [{ text: "ja", richtig: true }, { text: "nein" }], abschnitt: 2, anfang: "j" };
const raw = () => ({ name: "Raum", loesungswort: "Gerich", rahmen: { sprecher: "S", auftrag: "A" }, stationen: [1, 2, 3, 4, 5].map((i) => station(i, [ew])).concat(station(6, [{ typ: "schlussstein", frage: "Wort?", loesungen: ["GERICH"] }])),
  finale: { rueckblick: ["a"] }, feibeitsblatt: { titel: "Finale", aufgaben: [{ text: "Beurteile …", ki_auftrag: "K" }] } });

test("Escape-Room: Inhalte prüfen und normalisieren (Lösungswort, 6 Stationen, Buchstaben, Kennung)", () => {
  const r = normalizeEscapeRoom(raw(), { id: "unterricks-abc" });
  assert.equal(r.wort, "GERICH");
  assert.deepEqual(r.stationen.map((s) => s.buchstabe).join(""), "GERICH");
  assert.equal(r.stationen[0].label, "Station 1 · S1");
  assert.equal(r.id, "unterricks-abc");
  assert.ok(r.magic >= 100 && r.magic < 1000);
  assert.throws(() => normalizeEscapeRoom({ ...raw(), loesungswort: "GERICHT" }), /genau 6 Buchstaben/);
  assert.throws(() => normalizeEscapeRoom({ ...raw(), stationen: raw().stationen.slice(0, 5) }), /genau 6 Stationen/);
  const bad = raw(); bad.stationen[0].raetsel.teile = [{ typ: "einfachwahl", frage: "F", optionen: [{ text: "a", richtig: true }, { text: "b", richtig: true }] }, { typ: "schlussstein", loesungen: ["x"] }];
  assert.throws(() => normalizeEscapeRoom(bad), /Station 1, Teil A \(einfachwahl\): genau eine Option[\s\S]*Station 1, Teil B: einen Schlussstein gibt es nur in der letzten Station/);
  const z = raw(); z.stationen[1].raetsel.teile = [{ typ: "zuordnung", frage: "Ordne", optionen: ["x", "y"], zeilen: [{ text: "A", antwort: "x" }, { text: "B", antwort: "z" }] }];
  assert.throws(() => normalizeEscapeRoom(z), /die Antwort „z“ .* steht nicht wörtlich in den optionen/);
  const l = raw(); l.stationen[2].raetsel.teile = [{ typ: "luecken", text: "Die [[1]] und [[1]].", luecken: [{ nr: 1, loesungen: ["Legislative"] }] }];
  assert.throws(() => normalizeEscapeRoom(l), /kommt mehrfach vor/);
  assert.throws(() => normalizeEscapeRoom({ ...raw(), feibeitsblatt: { aufgaben: [] } }), /feibeitsblatt: das Finale braucht/);
});

test("Escape-Room: Bewerten mit Hilfe in drei Stufen (wo – Anfang – Lösung) und Fehlern für den Datensatz", () => {
  const r = normalizeEscapeRoom(raw());
  const st = r.stationen[0], p = st.raetsel.teile[0];
  assert.equal(missingOf(p, null), 1);
  const g = gradePart(st, p, 1, "A");
  assert.equal(g.n, 1);
  assert.deepEqual(g.errors, [{ kind: "mc", item: "F?", wrong: "nein", right: "ja" }]);
  assert.deepEqual(g.helps[0], { name: "Teil A: Frage", s1: "Abschnitt 2 – Thema 2", s2: "Die richtige Antwort beginnt mit „j …“.", s3: "Lösung: ja" });
  assert.equal(gradePart(st, p, 0, "A").errors.length, 0);
  // Mehrfachwahl: nur ausgewählte Aussagen markiert, Hilfe ohne Vorwegnahme
  const mw = normalizeEscapeRoom({ ...raw(), stationen: raw().stationen.map((s, i) => (i === 0 ? station(1, [{ typ: "mehrfachwahl", frage: "Was stimmt?", optionen: [{ text: "A", richtig: true }, { text: "B" }, { text: "C", richtig: true }] }]) : s)) }).stationen[0];
  const m = gradePart(mw, mw.raetsel.teile[0], [1], "");
  assert.deepEqual(Object.keys(m.marks), ["o1"]);
  assert.equal(m.errors.length, 3);
  assert.match(m.helps[0].s1, /1 ausgewählte Aussage stimmt nicht, 2 richtige Aussagen fehlen noch/);
  assert.ok(!m.helps[0].s1.includes("„A“") && m.helps[0].s3.includes("„A“, „C“"));
  // Körbe, Zuordnung, Lücken, Zahl, Schlussstein
  const all = raw();
  all.stationen[0].raetsel.teile = [{ typ: "koerbe", frage: "Sortiere", koerbe: [{ name: "Legislative", anfang: "Leg" }, { name: "Judikative" }], karten: [{ text: "Bundestag", korb: 1 }, { text: "Gericht", korb: 2 }, { text: "Bundesrat", korb: 1 }, { text: "BVerfG", korb: 2 }] },
    { typ: "luecken", text: "Die [[2]] beschließt, die [[1]] urteilt.", luecken: [{ nr: 1, loesungen: ["Judikative"], abschnitt: 1 }, { nr: 2, loesungen: ["Legislative", "Gesetzgebung"] }] },
    { typ: "zahl", frage: "Wie viele?", einheit: "Richter", min: 16, max: 16, woerter: ["sechzehn"] }];
  const rs = normalizeEscapeRoom(all).stationen[0], [kb, lk, zl] = rs.raetsel.teile;
  assert.equal(missingOf(kb, { 0: 0, 1: 1 }), 2);
  assert.equal(gradePart(rs, kb, { 0: 0, 1: 1, 2: 0, 3: 0 }, "A").errors[0].right, "Judikative");
  assert.deepEqual(lk.luecken.map((x) => x.nr), [2, 1], "Lücken in der Reihenfolge des Textes");
  const lg = gradePart(rs, lk, { 1: "judikative", 2: "Gesetz-gebung" }, "B");
  assert.equal(lg.errors.length, 0);
  assert.match(gradePart(rs, lk, { 1: "", 2: "Exekutive" }, "B").errors[0].item, /^Lücke 1: Die ___ beschließt/);
  for (const v of ["16", "sechzehn", "ca. 16 Richter", "16,0"]) assert.equal(gradePart(rs, zl, v, "C").errors.length, 0, v);
  assert.equal(gradePart(rs, zl, "1.600", "C").errors.length, 1);
  assert.ok(wordMatches(" Bundesverfassungs-gericht! ", ["Bundesverfassungsgericht"]) && wordMatches("Grundsaetze", ["Grundsätze"]) && !wordMatches("", ["x"]));
  assert.ok(numberMatches("rund 80 %", { min: 75, max: 85, einheiten: ["%"], woerter: [] }));
});

test("Escape-Room: Datensatz für das Feibeitsblatt (Hülle v1, Prüfsumme wie im Feibeitsblatt)", () => {
  assert.equal(fbEscapeHash("FbEscape|v1|{}"), "0bdda452e8d9ff95");
  assert.equal(fbEscapeHash('FbEscape|v1|{"a":"Größe – „x“"}'), "6721119dc06e029b");
  const r = normalizeEscapeRoom(raw(), { id: "unterricks-abc" });
  const st = { firstName: "Anna", lastName: "Muster", birthDate: "07.03.2006", klasse: "Q2 GK", attempts: [2, 1, 1, 1, 1, 1], mistakes: [{ errors: [{ item: "F?", wrong: "nein", right: "ja" }] }], completedAt: "2026-11-10T10:00:00Z", resumeLog: [] };
  const hull = escapeRecord(r, st, "MCK222", "https://x/");
  assert.equal(hull.kind, "feibeitsblatt-escape");
  assert.equal(hull.s, fbEscapeHash("FbEscape|v1|" + hull.d));
  const d = JSON.parse(hull.d);
  assert.equal(d.code, "MCK222"); assert.equal(d.room.id, "unterricks-abc"); assert.equal(d.person.klasse, "Q2GK");
  assert.equal(d.confirm, confirmCode("07.03.2006", r.magic)); assert.equal(confirmCode("07.03.2006", 12), "7763334636");
  assert.deepEqual(d.stations[0], { label: "Station 1 · S1", attempts: 2, errors: [{ item: "F?", wrong: "nein", right: "ja" }] });
  assert.equal(d.notes.length, 6);
  const url = tunnelUrl("https://feibeitsblatt.janrickmer.de/", hull);
  assert.ok(url.startsWith("https://feibeitsblatt.janrickmer.de/#escape=") && !url.includes("=", url.indexOf("#escape=") + 8));
  assert.equal(b64url("ä"), "w6Q");
});

test("Escape-Room: Zwischenstand-Datei (verschleiert, Prüfsumme, nur für diesen Raum)", () => {
  const data = { v: 1, game: "Raum", savedAt: "2026-11-10T10:00:00Z", screen: "lib3", place: "Bibliothek 3", state: { firstName: "Anna", solved: [true, true, false, false, false, false] } };
  const txt = "Kopf\r\n" + SAVE_BEGIN + "\r\n" + saveEncode("unterricks-abc", data) + "\r\n" + SAVE_END + "\r\n";
  assert.ok(!txt.includes("Anna"), "Inhalt ist nicht im Klartext lesbar");
  assert.deepEqual(saveDecode("unterricks-abc", "Raum", txt), data);
  assert.throws(() => saveDecode("unterricks-xyz", "Raum", txt), /anderen Escape-Room/);
  const broken = txt.replace(/[A-Za-z0-9+/]{20}/, (m) => m.split("").reverse().join(""));
  assert.throws(() => saveDecode("unterricks-abc", "Raum", broken), /verändert oder ist beschädigt/);
  assert.throws(() => saveDecode("unterricks-abc", "Raum", "irgendwas"), /keine Zwischenstand-Datei/);
});
