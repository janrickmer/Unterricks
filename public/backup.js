// backup.js – Einheit als Datei (Planungsseite der Einheit) und die große Sicherung vor dem Zurücksetzen (Einstellungen).
//   Einheit als Datei: ZIP mit der Einheitsdatei und je Sitzung einem chronologisch nummerierten Ordner mit der Sitzungsdatei (unitfile.js).
//   Laden in eine Einheit ohne Sitzungen: Leupold-Schema, Ablauf und Titel kommen aus der Datei, die Rahmendaten bleiben, die Termine werden
//   neu verteilt; die gesicherten Sitzungen warten auf diesem Gerät (IndexedDB) und füllen beim „Einheit festlegen und Sitzungen anlegen“
//   die neuen Sitzungen (Datumsangaben angepasst).
//   Große Sicherung: Fach / Einheit / Sitzungen – dieselben Einheitsordner; Sitzungen ohne Einheit je Klasse in einem eigenen Ordner.
import { T, tapi, fbAutoConnect } from "./teacher.js";
import { readZip, ZipBlob } from "./zip.js";
import { berlinToday } from "./shared.js";
import * as UF from "./unitfile.js";
import { buildSessionZip, readSessionZip, planSessionImport, applySessionImport, retry } from "./sessionio.js";

const te = new TextEncoder();
export class Cancelled extends Error { constructor() { super("Abgebrochen."); this.cancelled = true; } }

/* Feibeitsblatt-Verbindung (für die Inhalte der Feibeitsblätter) – ohne Verbindung kommen nur die Codes mit */
async function fbReady() { try { await fbAutoConnect(); } catch {} return T.fb; }

/* Sitzungen einer Einheit als Liste wie in der großen Sicherung: {id, date, unitRow, title, createdAt} */
const unitLessons = (unit) => (unit.lessons || []).map((l) => ({ id: l.id, date: l.date || null, unitRow: l.row || l.unitRow || null, title: l.title || "", createdAt: l.createdAt || 0 }));

/* Einheitsordner in eine ZIP-Datei schreiben (prefix = Ordner, "" = oben): Sitzungen chronologisch, dann die Einheitsdatei.
   → {sessions, notes, missing} */
async function addUnit(zip, prefix, unit, lessons, { fb, onStep = () => {}, cancelled = () => false, full = true } = {}) {
  const list = UF.chronoLessons(lessons, unit.rows || []), width = Math.max(2, String(list.length).length), paths = new Map();
  const notes = [], missing = [], at = (p) => (prefix ? prefix + "/" : "") + p;
  let n = 0;
  for (const l of list) {
    if (cancelled()) throw new Cancelled();
    n++;
    const label = "Sitzung " + n + " von " + list.length + (unit.title ? " („" + unit.title + "“)" : "");
    onStep(label + " …");
    const detail = await retry(() => tapi("GET", "/api/teacher/lessons/" + l.id + "?full=1"));
    const s = await buildSessionZip(detail, { fb, full, cancelled, fileName: UF.SESSION_IN_FOLDER, onStep: (m) => onStep(label + ": " + m) });
    const folder = UF.sessionFolderName(n, { date: detail.lesson.date, title: detail.lesson.title }, width);
    const rel = zip.add(at(folder + "/" + s.name), s.bytes).slice(prefix ? prefix.length + 1 : 0);
    if (l.unitRow) paths.set(l.unitRow, rel);
    notes.push(...s.notes.map((x) => folder + ": " + x)); missing.push(...s.missing.map((x) => folder + ": " + x));
  }
  if (cancelled()) throw new Cancelled();
  if (unit.id) zip.add(at(UF.unitJsonName(unit)), te.encode(JSON.stringify(UF.unitFileData(unit, paths), null, 1)));
  return { sessions: list.length, notes, missing };
}

/* Einheit als Datei: unit = unitFull (mit lessons) → {blob, name, sessions, notes, missing} */
export async function buildUnitZip(unit, { onStep, cancelled } = {}) {
  const zip = new ZipBlob(), fb = await fbReady();
  const r = await addUnit(zip, "", unit, unitLessons(unit), { fb, onStep, cancelled, full: false });
  return { blob: zip.finish(), name: UF.unitBaseName(unit) + ".zip", ...r };
}

/* ---------- Gesicherte Sitzungen bis zum Anlegen der Sitzungen (IndexedDB, nur auf diesem Gerät) ---------- */
const DB = "unterricks-einheiten", STORE = "pending";
function idb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("Dieser Browser kann keine Dateien zwischenspeichern.")); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "unitId" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error("Zwischenspeicher nicht verfügbar."));
  });
}
async function tx(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE); let out;
      const q = fn(st); if (q) q.onsuccess = () => { out = q.result; };
      t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error || new Error("Zwischenspeicher nicht verfügbar."));
    });
  } finally { db.close(); }
}
/* {unitId, file, at, rows: {uid: Blob}} | null */
export const loadPending = (unitId) => tx("readonly", (s) => s.get(unitId)).then((x) => x || null, () => null);
export const savePending = (rec) => tx("readwrite", (s) => s.put(rec));
export async function dropPending(unitId, uids = null) {
  const rec = await loadPending(unitId);
  if (!rec) return;
  if (uids) for (const u of uids) delete rec.rows[u];
  if (!uids || !Object.keys(rec.rows).length) await tx("readwrite", (s) => s.delete(unitId)).catch(() => {});
  else await savePending(rec).catch(() => {});
}
export function clearAllPending() {
  return new Promise((res) => { try { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
}

/* ---------- Einheit aus Datei lesen ---------- */
/* file = ZIP (Einheit als Datei, gepackter Einheitsordner der großen Sicherung) oder JSON (Einheitsdatei) →
   {unit (cleanUnitFile), sessions: [Uint8Array | null je Zeile], missing: Anzahl fehlender Sitzungsdateien} */
export async function readUnitFile(file) {
  if (file.size > 1.5e9) throw new Error("Diese Datei ist zu groß für eine Unterrichtseinheit. Ist es eine ganze Sicherung? Dann bitte den Ordner der gewünschten Einheit als ZIP-Datei packen oder ihre Einheitsdatei (.json) wählen.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw, entries = null, base = "";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try { entries = await readZip(bytes); } catch { throw new Error("Die Datei ist beschädigt oder keine ZIP-Datei."); }
    const f = UF.findUnitEntry(entries);
    if (!f) throw new Error(entries.some((e) => e.name === "sitzung.json") ? "Das ist eine Sitzungsdatei – sie lässt sich in einer Sitzung unter „Sitzung aus Datei laden“ übernehmen." : "In dieser Datei steckt keine Unterrichtseinheit aus Unterricks.");
    if (f.backup || f.count > 1) throw new Error("Das ist eine Sicherung mit " + f.count + " Unterrichtseinheiten. Bitte den Ordner der gewünschten Einheit als ZIP-Datei packen (oder nur ihre Einheitsdatei wählen) und diese Datei laden.");
    raw = f.data; base = f.base;
  } else {
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("In dieser Datei steckt keine Unterrichtseinheit aus Unterricks."); }
  }
  const unit = UF.cleanUnitFile(raw), byName = new Map((entries || []).map((e) => [e.name, e.data])), names = [...byName.keys()];
  let missing = 0;
  const sessions = unit.sessions.map((p) => { if (!p) return null; const k = UF.findSessionEntry(names, base, p), b = k ? byName.get(k) : null; if (!b) missing++; return b || null; });
  return { unit, sessions, missing, fromZip: !!entries };
}

/* Gesicherte Inhalte in Sitzungen übernehmen: lessons = [{id, row}] der Einheit, rec = loadPending(…) → Bericht */
export async function applyPending(unitId, lessons, rec, { onStep = () => {} } = {}) {
  const todo = lessons.filter((l) => rec && rec.rows && rec.rows[l.row]);
  const report = { done: 0, failed: [], replaced: [], unknown: [], missing: [], notes: [], drafts: 0 };
  let k = 0;
  for (const l of todo) {
    k++;
    const label = "Sitzung " + k + " von " + todo.length;
    try {
      onStep(label + ": lese die gesicherte Sitzung …");
      const blob = rec.rows[l.row], { data, byPath } = await readSessionZip(new Uint8Array(await blob.arrayBuffer()));
      const target = (await tapi("GET", "/api/teacher/lessons/" + l.id)).lesson;
      const plan = planSessionImport(data, target);
      const r = await applySessionImport(l.id, plan, data, byPath, { target, onStep: (m) => onStep(label + ": " + m) });
      const tag = "„" + (target.title || "Sitzung") + "“: ";
      report.replaced.push(...plan.replaced.map(([a, b]) => tag + a + " → " + b)); report.unknown.push(...plan.unknown.map((x) => tag + x));
      report.missing.push(...r.missing.map((x) => tag + x)); report.notes.push(...data.notes.map((x) => tag + x)); report.drafts += data.drafts.length;
      report.done++;
      await dropPending(unitId, [l.row]);
    } catch (e) { report.failed.push("„" + (l.title || "Sitzung") + "“: " + e.message); }
  }
  return report;
}

/* ---------- Große Sicherung: alle Einheiten und Sitzungen ---------- */
const README = (when, counts) => [
  "Sicherung aus Unterricks vom " + when + ".",
  "",
  "Aufbau: Fach / Unterrichtseinheit / Sitzungen (chronologisch nummeriert).",
  "- Im Ordner einer Einheit liegt die Einheitsdatei („Unterrichtseinheit - … .json“): Rahmendaten, Leupold-Schema und Ablauf.",
  "- Jeder Sitzungsordner enthält die Sitzungsdatei („Unterrickssitzung.zip“) mit Planung, Schulportal-Eintrag, Hausaufgabe,",
  "  Planungsverlauf, Materialien, Präsentation, Druckliste und Feibeitsblättern (als Entwürfe).",
  "- „… - Sitzungen ohne Einheit“: ältere Sitzungen, die zu keiner Einheit gehören.",
  "- Vertretene Sitzungen: Die ursprüngliche Planung steht in der Sitzungsdatei unter „archive“ (sitzung.json) und im Ordner „archiv/“.",
  "",
  "Wiederverwenden:",
  "- Eine Sitzung: in Unterricks eine Sitzung öffnen → „Sitzung aus Datei laden“ → die Sitzungsdatei wählen.",
  "- Eine Einheit: den Ordner der Einheit als ZIP-Datei packen (oder nur die Einheitsdatei wählen) und auf der Planungsseite einer neuen",
  "  Einheit „Einheit aus Datei laden“ nutzen. Mit der ZIP-Datei bekommen die Sitzungen beim Anlegen ihre gesicherten Inhalte.",
  "",
  "Inhalt: " + counts.units + " Unterrichtseinheiten, " + counts.lessons + " Sitzungen.",
].join("\r\n");

/* → {blob, name, counts {units, lessons}, notes, missing} */
export async function buildBackup({ onStep = () => {}, onProgress = () => {}, cancelled = () => false } = {}) {
  onStep("Lese die Übersicht …");
  const idx = await retry(() => tapi("GET", "/api/teacher/backup")), fb = await fbReady();
  const units = idx.units || [], lessons = idx.lessons || [], unitIds = new Set(units.map((u) => u.id));
  const zip = new ZipBlob(), notes = [], missing = [], total = lessons.length, tot = idx.totals || {};
  if ((tot.units || 0) > units.length) missing.push((tot.units - units.length) + " Unterrichtseinheiten (zu viele für eine Sicherung)");
  if ((tot.lessons || 0) > lessons.length) missing.push((tot.lessons - lessons.length) + " Sitzungen (zu viele für eine Sicherung)");
  let done = 0;
  const step = (m) => onStep(m);
  const track = (r) => { done += r.sessions; notes.push(...r.notes); missing.push(...r.missing); onProgress(done, total); };
  const order = (a, b) => UF.subjectOrder(a.subject) - UF.subjectOrder(b.subject) || String(a.klass).localeCompare(String(b.klass), "de", { numeric: true });
  // Einheiten: Fach / „8B - Titel“
  for (const u of [...units].sort((a, b) => order(a, b) || String((a.params || {}).start || "").localeCompare(String((b.params || {}).start || "")) || String(a.title).localeCompare(String(b.title), "de"))) {
    if (cancelled()) throw new Cancelled();
    const prefix = zip.unique(UF.subjectFolderName(u.subject) + "/" + UF.unitFolderName(u), true);
    const mine = lessons.filter((l) => l.unitId === u.id);
    const fullU = (await retry(() => tapi("GET", "/api/teacher/units/" + u.id))).unit;   // Plan und Zeilen je Einheit (die Übersicht bleibt klein)
    const r = await addUnit(zip, prefix, fullU, mine, { fb, cancelled, onStep: (m) => step(UF.subjectFolderName(u.subject) + " · " + m) });
    track(r);
  }
  // Sitzungen ohne (vorhandene) Einheit: Fach / „8B - Sitzungen ohne Einheit“
  const loose = lessons.filter((l) => !l.unitId || !unitIds.has(l.unitId)), groups = new Map();
  for (const l of loose) { const k = l.subject + "|" + l.klass; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  for (const g of [...groups.values()].sort((a, b) => order(a[0], b[0]))) {
    const prefix = zip.unique(UF.subjectFolderName(g[0].subject) + "/" + UF.looseFolderName(g[0].klass), true);
    track(await addUnit(zip, prefix, { title: "", rows: [] }, g, { fb, cancelled, onStep: (m) => step(UF.subjectFolderName(g[0].subject) + " · " + m) }));
  }
  if (cancelled()) throw new Cancelled();
  const today = berlinToday();
  zip.add("Lies mich.txt", te.encode(README(today.slice(8, 10) + "." + today.slice(5, 7) + "." + today.slice(0, 4), { units: units.length, lessons: lessons.length })));
  zip.add(UF.BACKUP_FILE.json, te.encode(JSON.stringify({ kind: UF.BACKUP_FILE.kind, v: UF.BACKUP_FILE.v, exportedAt: Date.now(), units: units.length, lessons: lessons.length, notes, missing }, null, 1)));
  return { blob: zip.finish(), name: UF.backupFileName(today), counts: { units: units.length, lessons: lessons.length }, notes, missing, mark: idx.mark || null };
}
