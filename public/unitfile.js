// unitfile.js – Unterrichtseinheit als Datei und die Ordner der großen Sicherung (Wunsch der Lehrkraft vom 11.11.2026). Nur reine Funktionen
// (ohne Netz und DOM) – Herunterladen, Laden und Sichern steuert backup.js.
//   Einheitsdatei (JSON): „Unterrichtseinheit - PoWi - Jg. 8 - <Titel>.json“ = Rahmendaten (nur zur Information), Leupold-Schema und Ablauf;
//   jede Zeile nennt den Pfad ihrer gesicherten Sitzung (relativ zur Einheitsdatei) oder null.
//   Einheit als Datei (ZIP): die Einheitsdatei + je Sitzung ein Ordner „01 - 12.11.2026 - <Stundenfrage>“ mit der Sitzungsdatei (sessionfile.js),
//   chronologisch nummeriert. Die große Sicherung legt genau diese Ordner unter Fach/Einheit ab.
import { SUBJECTS, subjectName, subjectShort, groupShort, classShort, isIsoDate, isValidSubject, isValidClass } from "./shared.js";
import { normalizePlan, normalizeRows } from "./planning.js";
import { zipPath } from "./zip.js";

export const UNIT_FILE = { kind: "unterricks-einheit", v: 1 };
export const BACKUP_FILE = { kind: "unterricks-sicherung", v: 1, json: "unterricks-sicherung.json" };
const clean = (s) => String(s == null ? "" : s).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
const dmy = (iso) => (isIsoDate(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");

/* „Unterrichtseinheit - PoWi - Jg. 8 - Gewaltenteilung“ (ohne Endung) */
export function unitBaseName({ subject, klass, title }) {
  return ["Unterrichtseinheit", subjectShort(subject) || subjectName(subject) || "Fach", groupShort(klass) || "Lerngruppe", clean(title).slice(0, 80) || "ohne Titel"].join(" - ");
}
/* Ordner einer Einheit in der Sicherung: „8B - Gewaltenteilung“ (Klasse bzw. Kurs, damit gleiche Titel verschiedener Klassen getrennt bleiben) */
export const unitFolderName = ({ klass, title }) => (classShort(klass) || "Lerngruppe") + " - " + (clean(title).slice(0, 80) || "ohne Titel");
export const looseFolderName = (klass) => (classShort(klass) || "Lerngruppe") + " - Sitzungen ohne Einheit";
/* Ordner einer Sitzung: „03 - 12.11.2026 - Wer kontrolliert wen“ (n = chronologische Nummer, width = Stellen) */
export function sessionFolderName(n, { date, title }, width = 2) {
  return String(n).padStart(width, "0") + " - " + (dmy(date) || "ohne Datum") + (clean(title) ? " - " + clean(title).slice(0, 60) : "");
}
export const backupFileName = (iso) => "Unterricks-Sicherung - " + (isIsoDate(iso) ? iso : "ohne Datum") + ".zip";
export const subjectFolderName = (id) => clean(subjectName(id)) || "Fach";
export const subjectOrder = (id) => { const i = SUBJECTS.findIndex((s) => s.id === id); return i < 0 ? 99 : i; };

/* Sitzungen chronologisch: Datum (ohne Datum zuletzt), dann Lage der Zeile in der Einheit, dann Anlage */
export function chronoLessons(lessons, rows = []) {
  const pos = new Map((rows || []).map((r, i) => [r.uid, i]));
  return [...(lessons || [])].sort((a, b) => {
    const da = a.date || "￿", db = b.date || "￿";
    if (da !== db) return da < db ? -1 : 1;
    const pa = pos.has(a.unitRow) ? pos.get(a.unitRow) : 1e6, pb = pos.has(b.unitRow) ? pos.get(b.unitRow) : 1e6;
    if (pa !== pb) return pa - pb;
    return (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));
  });
}

/* Inhalt der Einheitsdatei: sessionPath = Map Zeilen-uid → Pfad der Sitzungsdatei (relativ zur Einheitsdatei) */
export function unitFileData(unit, sessionPath = new Map(), now = Date.now()) {
  const plan = normalizePlan(unit.plan || {});
  return { kind: UNIT_FILE.kind, v: UNIT_FILE.v, exportedAt: now,
    source: { subject: unit.subject, klass: unit.klass, title: unit.title || "", status: unit.status || "", params: unit.params || {} },
    unit: { title: unit.title || plan.titel || "", plan,
      rows: (unit.rows || []).map((r) => ({ stundenfrage: r.stundenfrage || "", ablauf: r.ablauf || [], schritt: r.schritt ?? null, date: r.date || null, minutes: r.minutes || null,
        time: r.time || null, session: sessionPath.get(r.uid) || null })) } };
}

/* Einheitsdatei aus fremden Daten prüfen → {source, title, plan, rows (ohne uid, Datum, Dauer, Beginn – die kommen aus der geöffneten
   Einheit), sessions: [Pfad | null je Zeile]}. Zeilen ohne Stundenfrage und Ablauf entfallen wie beim Speichern – mit ihrer Sitzung. */
export function cleanUnitFile(raw) {
  if (!raw || typeof raw !== "object" || raw.kind !== UNIT_FILE.kind) throw new Error("Diese Datei ist keine Unterrichtseinheit aus Unterricks.");
  if (raw.v !== UNIT_FILE.v) throw new Error("Diese Einheit stammt aus einer neueren Fassung von Unterricks und lässt sich hier nicht laden.");
  const src = raw.source && typeof raw.source === "object" ? raw.source : {}, u = raw.unit && typeof raw.unit === "object" ? raw.unit : {};
  const plan = normalizePlan(u.plan || {});
  const rows = [], sessions = [];
  for (const r of (Array.isArray(u.rows) ? u.rows : []).slice(0, 150)) {
    const [n] = normalizeRows([r && typeof r === "object" ? { ...r, uid: undefined } : {}], () => "00000000");
    if (!n) continue;
    rows.push({ stundenfrage: n.stundenfrage, ablauf: n.ablauf, schritt: n.schritt !== null && n.schritt < plan.schritte.length ? n.schritt : null, date: null, minutes: null, time: null });
    const p = r && typeof r.session === "string" && r.session.length <= 400 && /\.zip$/i.test(r.session) ? zipPath(r.session) : null;
    sessions.push(p && p !== "Datei" ? p : null);
  }
  return { source: { subject: isValidSubject(src.subject) ? src.subject : null, klass: isValidClass(src.klass) ? src.klass : null, title: clean(src.title).slice(0, 200) },
    title: clean(u.title).slice(0, 200) || plan.titel, plan, rows, sessions };
}

/* In einer ZIP-Datei die Einheitsdatei finden (auch ein gepackter Ordner aus der großen Sicherung): die am wenigsten tief liegende
   JSON-Datei mit kind „unterricks-einheit“. → {data (roh), base: Ordner der Datei („“ = oben)} oder null */
export function findUnitEntry(entries, decode = (u8) => new TextDecoder().decode(u8)) {
  const cands = (entries || []).filter((e) => /\.json$/i.test(e.name) && e.data && e.data.length <= 4e6)
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length || a.name.length - b.name.length);
  for (const e of cands) {
    let raw; try { raw = JSON.parse(decode(e.data)); } catch { continue; }
    if (raw && raw.kind === UNIT_FILE.kind) { const i = e.name.lastIndexOf("/"); return { data: raw, base: i < 0 ? "" : e.name.slice(0, i), name: e.name }; }
  }
  return null;
}
/* Pfad der Sitzungsdatei relativ zur Einheitsdatei → Name in der ZIP-Datei */
export const joinPath = (base, p) => zipPath((base ? base + "/" : "") + p);
