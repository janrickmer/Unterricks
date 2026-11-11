// Einheit als Datei und große Sicherung: Namen, chronologische Ordnung, Einheitsdatei (Schreiben, Prüfen), Fundort in der ZIP, ZipBlob mit ZIP64
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as UF from "../../public/unitfile.js";
import { ZipBlob, readZip, makeZip } from "../../public/zip.js";

test("Namen: Einheitsdatei, Einheits- und Sitzungsordner, Sicherung", () => {
  assert.equal(UF.unitBaseName({ subject: "powi", klass: "8C", title: "Gewaltenteilung: Wer kontrolliert wen?" }), "Unterrichtseinheit - PoWi - Jg. 8 - Gewaltenteilung Wer kontrolliert wen");
  assert.equal(UF.unitBaseName({ subject: "ethik", klass: "Q2-GK", title: "" }), "Unterrichtseinheit - Ethik - Q2 GK - ohne Titel");
  assert.equal(UF.unitFolderName({ klass: "8C", title: "Wahlen / Parteien." }), "8C - Wahlen Parteien");
  // kurz genug für Windows (Pfade unter 260 Zeichen beim Entpacken) und ohne Punkt am Ende (entfernt Windows bei Ordnern)
  const long = "Gewaltenteilung und die Kontrolle der Verfassungsorgane in der Bundesrepublik Deutschland";
  assert.equal(UF.unitFolderName({ klass: "8B", title: long }), "8B - Gewaltenteilung und die Kontrolle der");
  assert.equal(UF.unitFolderName({ klass: "8B", title: "Wahlen u. Demokratie in Europa sind wichtig." }).endsWith("."), false);
  assert.equal(UF.sessionFolderName(3, { date: "2026-11-12", title: "Wer kontrolliert eigentlich die Bundesregierung im politischen System?" }), "03 - 12.11.2026 - Wer kontrolliert eigentlich");
  assert.equal(UF.unitJsonName({ subject: "powi", klass: "8B", title: long }), "Unterrichtseinheit - PoWi - Jg. 8 - Gewaltenteilung und die Kontrolle der.json");
  assert.equal(UF.SESSION_IN_FOLDER, "Unterrickssitzung.zip");
  const path = ["Politik und Wirtschaft", UF.unitFolderName({ klass: "Q3-LK", title: long }), UF.sessionFolderName(12, { date: "2026-11-12", title: long }), UF.SESSION_IN_FOLDER].join("\\");
  assert.ok(path.length <= 150, "Pfad in der Sicherung höchstens 150 Zeichen (" + path.length + ")");
  assert.equal(UF.unitFolderName({ klass: "Q3-LK", title: "Markt" }), "Q3 LK - Markt");
  assert.equal(UF.looseFolderName("8-K"), "Kurs Jg. 8 - Sitzungen ohne Einheit");
  assert.equal(UF.sessionFolderName(3, { date: "2026-11-12", title: "Wer kontrolliert wen?" }), "03 - 12.11.2026 - Wer kontrolliert wen");
  assert.equal(UF.sessionFolderName(12, { date: null, title: "" }, 3), "012 - ohne Datum");
  assert.equal(UF.backupFileName("2026-11-11"), "Unterricks-Sicherung - 2026-11-11.zip");
  assert.deepEqual(["ethik", "powi", "evrel"].sort((a, b) => UF.subjectOrder(a) - UF.subjectOrder(b)), ["powi", "evrel", "ethik"]);
  assert.equal(UF.subjectFolderName("evrel"), "Evangelische Religion");
});

test("Sitzungen chronologisch: Datum, ohne Datum zuletzt, bei gleichem Datum die Lage der Zeile", () => {
  const rows = [{ uid: "aaaaaaaa" }, { uid: "bbbbbbbb" }, { uid: "cccccccc" }];
  const ls = [{ id: "1", date: "2026-11-20", unitRow: "aaaaaaaa" }, { id: "2", date: null, unitRow: "bbbbbbbb" }, { id: "3", date: "2026-11-13", unitRow: "cccccccc" },
    { id: "4", date: "2026-11-20", unitRow: "bbbbbbbb", createdAt: 5 }, { id: "5", date: "2026-11-13", unitRow: null }];
  assert.deepEqual(UF.chronoLessons(ls, rows).map((l) => l.id), ["3", "5", "1", "4", "2"]);
});

test("Einheitsdatei: schreiben und prüfen – Planung bleibt, Termine, Zeilen-Kennungen und Dauer kommen aus der Ziel-Einheit", () => {
  const unit = { subject: "powi", klass: "8C", title: "Wahlen", status: "geplant", params: { start: "2026-11-01" },
    plan: { titel: "Wahlen", lernaufgabe: "Eine Wahlempfehlung schreiben", schritte: [{ titel: "Einstieg", beschreibung: "…" }] },
    rows: [{ uid: "aaaaaaaa", stundenfrage: "Warum wählen?", ablauf: ["Einstieg", "Text"], schritt: 0, date: "2026-11-03", minutes: 90, time: "08:00" },
      { uid: "bbbbbbbb", stundenfrage: "", ablauf: [], schritt: null }, { uid: "cccccccc", stundenfrage: "Wie wählen?", ablauf: "- a\n- b", schritt: 7 }] };
  const data = UF.unitFileData(unit, new Map([["aaaaaaaa", "01 - 03.11.2026 - Warum wählen/S.zip"], ["cccccccc", "02 - x/T.zip"]]), 1);
  assert.equal(data.kind, "unterricks-einheit"); assert.equal(data.v, 1);
  assert.equal(data.unit.rows[0].session, "01 - 03.11.2026 - Warum wählen/S.zip"); assert.equal(data.unit.rows[1].session, null);
  const back = UF.cleanUnitFile(JSON.parse(JSON.stringify(data)));
  assert.equal(back.title, "Wahlen"); assert.equal(back.plan.lernaufgabe, "Eine Wahlempfehlung schreiben"); assert.equal(back.source.klass, "8C");
  assert.deepEqual(back.rows, [{ stundenfrage: "Warum wählen?", ablauf: ["Einstieg", "Text"], schritt: 0, date: null, minutes: null, time: null },
    { stundenfrage: "Wie wählen?", ablauf: ["a", "b"], schritt: null, date: null, minutes: null, time: null }], "leere Zeile entfällt samt Sitzung, ungültiger Lernschritt wird leer");
  assert.deepEqual(back.sessions, ["01 - 03.11.2026 - Warum wählen/S.zip", "02 - x/T.zip"]);
  assert.throws(() => UF.cleanUnitFile({ kind: "unterricks-sitzung", v: 1 }), /keine Unterrichtseinheit/);
  assert.throws(() => UF.cleanUnitFile({ kind: "unterricks-einheit", v: 2 }), /neueren Fassung/);
  const evil = UF.cleanUnitFile({ kind: "unterricks-einheit", v: 1, unit: { rows: [{ stundenfrage: "x", session: "../../etc/passwd.zip" }, { stundenfrage: "y", session: "a.exe" }] } });
  assert.deepEqual(evil.sessions, ["etc/passwd.zip", null], "Pfade nie außerhalb, nur Sitzungsdateien (.zip)");
});

test("Einheitsdatei in der ZIP-Datei finden – auch in einem gepackten Ordner der Sicherung – und Pfade relativ dazu", () => {
  const te = new TextEncoder(), j = (o) => te.encode(JSON.stringify(o));
  const entries = [{ name: "8C - Wahlen/01 - x/S.zip", data: new Uint8Array(3) }, { name: "8C - Wahlen/Unterrichtseinheit - PoWi.json", data: j({ kind: "unterricks-einheit", v: 1 }) },
    { name: "8C - Wahlen/01 - x/andere.json", data: j({ kind: "unterricks-einheit", v: 1, tief: true }) }, { name: "kaputt.json", data: te.encode("{") }];
  const f = UF.findUnitEntry(entries);
  assert.equal(f.base, "8C - Wahlen"); assert.ok(!f.data.tief); assert.equal(f.count, 2);
  assert.equal(UF.findUnitEntry([{ name: "unterricks-sicherung.json", data: j({ kind: "unterricks-sicherung" }) }, entries[1]]).backup, true, "eine ganze Sicherung wird erkannt");
  // Sitzungsdatei zu einem Pfad: genau, sonst über die Nummer des Ordners (neu gepackt, andere Schreibweise)
  const names = ["8C - Wählen/01 - 03.11.2026 - Prüfung/Unterrickssitzung.zip", "8C - Wählen/02 - x/Unterrickssitzung.zip", "8C - Wählen/Unterrichtseinheit.json"];
  assert.equal(UF.findSessionEntry(names, "8C - Wählen", "01 - 03.11.2026 - Prüfung/Unterrickssitzung.zip"), names[0]);
  assert.equal(UF.findSessionEntry(names, "8C - Wählen", "02 - anders/Unterrickssitzung.zip"), names[1], "über die Nummer des Sitzungsordners");
  assert.equal(UF.findSessionEntry(names, "8C - Wählen", "03 - x/Unterrickssitzung.zip"), null);
  assert.equal(UF.findSessionEntry(names, "8C - Wa\u0308hlen", "01 - 03.11.2026 - Pru\u0308fung/Unterrickssitzung.zip"), names[0], "zerlegte Umlaute (macOS) passen auch");
  assert.equal(UF.joinPath(f.base, "01 - x/S.zip"), "8C - Wahlen/01 - x/S.zip");
  assert.equal(UF.joinPath("", "01 - x/S.zip"), "01 - x/S.zip");
  assert.equal(UF.findUnitEntry([{ name: "sitzung.json", data: j({ kind: "unterricks-sitzung" }) }]), null);
});

test("ZipBlob: Ordner, eindeutige Namen (Dateien und Ordner), wieder lesbar; ZIP64 ab der Grenze (geprüft mit Python zipfile)", async () => {
  const te = new TextEncoder();
  for (const limit64 of [0xffffffff, 50]) {
    const z = new ZipBlob({ limit64 });
    const inner = makeZip([{ name: "sitzung.json", data: te.encode("{}") }]);
    z.add("Politik und Wirtschaft/8C - Wahlen/01 - 03.11.2026 - Warum/Unterrickssitzung.zip", inner);
    const f2 = z.unique("Politik und Wirtschaft/8C - Wahlen", true);
    assert.equal(f2, "Politik und Wirtschaft/8C - Wahlen");
    assert.equal(z.unique("Politik und Wirtschaft/8C - Wahlen", true), "Politik und Wirtschaft/8C - Wahlen (2)", "zweite Einheit gleichen Namens: eigener Ordner");
    assert.equal(z.unique("Politik und Wirtschaft/8C - Wahl u. Demokratie", true), "Politik und Wirtschaft/8C - Wahl u. Demokratie");
    assert.equal(z.unique("Politik und Wirtschaft/8C - Wahl u. Demokratie", true), "Politik und Wirtschaft/8C - Wahl u. Demokratie (2)", "Punkt im Ordnernamen ist keine Endung");
    z.add("Lies mich.txt", te.encode("Hallo"));
    assert.equal(z.add("lies mich.txt", te.encode("x")), "lies mich (2).txt");
    const bytes = new Uint8Array(await z.finish().arrayBuffer());
    const back = await readZip(bytes);   // auch ZIP64
    assert.deepEqual(back.map((e) => e.name), ["Politik und Wirtschaft/8C - Wahlen/01 - 03.11.2026 - Warum/Unterrickssitzung.zip", "Lies mich.txt", "lies mich (2).txt"]);
    assert.equal((await readZip(back[0].data))[0].name, "sitzung.json", "Sitzungsdatei in der Sicherung bleibt eine lesbare ZIP-Datei");
    assert.equal(new TextDecoder().decode(back[1].data), "Hallo");
    let py = null;
    try { execFileSync("python3", ["--version"]); py = true; } catch { py = false; }
    if (py) {
      const dir = mkdtempSync(join(tmpdir(), "zipblob-")), p = join(dir, "t.zip");
      writeFileSync(p, bytes);
      const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('|'.join(i.filename + ':' + str(i.file_size) for i in z.infolist()))", p]).toString().trim();
      assert.equal(out.split("|").length, 3, "Python liest alle Einträge (" + (limit64 < 1e6 ? "ZIP64" : "normal") + ")");
      if (limit64 < 1e6) assert.ok(new DataView(bytes.buffer).getUint32(bytes.length - 22 - 20 - 56, true) === 0x06064b50, "ZIP64-Abschluss vorhanden");
    }
  }
});

test("ZIP lesen: Namen ohne UTF-8-Kennzeichen in Codepage 437 (Windows „ZIP-komprimierter Ordner“), immer NFC", async () => {
  const z = makeZip([{ name: "Wählen.txt", data: new Uint8Array([1]) }, { name: "Prüfung/ä.zip", data: new Uint8Array([2]) }]);
  // wie Windows: Bit 11 löschen und die Namen in CP437 schreiben (ä = 0x84, ü = 0x81) – gleiche Länge, also an Ort und Stelle
  const dv = new DataView(z.buffer), cp = { "ä": 0x84, "ü": 0x81 };
  const rewrite = (at, len) => { const nm = new TextDecoder().decode(z.subarray(at, at + len)); const out = [...nm].flatMap((ch) => (cp[ch] ? [cp[ch]] : [...new TextEncoder().encode(ch)])); return out; };
  for (let p = 0; p < z.length - 4; p++) {
    const sig = dv.getUint32(p, true);
    if (sig === 0x04034b50 || sig === 0x02014b50) {
      const nl = dv.getUint16(p + (sig === 0x04034b50 ? 26 : 28), true), at = p + (sig === 0x04034b50 ? 30 : 46);
      dv.setUint16(p + (sig === 0x04034b50 ? 6 : 8), 0, true);
      const b = rewrite(at, nl);
      z.set(b, at); for (let i = b.length; i < nl; i++) z[at + i] = 0x20;   // kürzer: mit Leerzeichen auffüllen (Test)
    }
  }
  const back = await readZip(z);
  assert.equal(back[0].name.trim(), "Wählen.txt"); assert.equal(back[1].name.trim(), "Prüfung/ä.zip");
});
