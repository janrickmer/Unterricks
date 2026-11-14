// unitfile.js – Unterrichtseinheit als Datei und die Ordner der großen Sicherung (Wunsch der Lehrkraft vom 11.11.2026). Nur reine Funktionen
// (ohne Netz und DOM) – Herunterladen, Laden und Sichern steuert backup.js.
//   Einheitsdatei (JSON): „Unterrichtseinheit - PoWi - Jg. 8 - <Titel>.json“ = Rahmendaten (nur zur Information), Leupold-Schema und Ablauf;
//   jede Zeile nennt den Pfad ihrer gesicherten Sitzung (relativ zur Einheitsdatei) oder null.
//   Einheit als Datei (ZIP): die Einheitsdatei + je Sitzung ein Ordner „01 - 12.11.2026 - <Stundenfrage>“ mit der Sitzungsdatei (sessionfile.js),
//   chronologisch nummeriert. Die große Sicherung legt genau diese Ordner unter Fach/Einheit ab.
import { SUBJECTS, subjectName, subjectShort, groupShort, classShort, isIsoDate, isValidSubject, isValidClass, GS_SUBJECT, isGsCourseId } from "./shared.js";
import { normalizePlan, normalizeRows, storeParams } from "./planning.js";
import { zipPath } from "./zip.js";

export const UNIT_FILE = { kind: "unterricks-einheit", v: 1 };
export const BACKUP_FILE = { kind: "unterricks-sicherung", v: 1, json: "unterricks-sicherung.json" };
const clean = (s) => String(s == null ? "" : s).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
/* Teil eines Pfades: gekürzt (Windows kann Pfade über 260 Zeichen beim Entpacken nicht anlegen), ohne Punkt oder Leerzeichen am Ende
   (entfernt Windows bei Ordnern – die Pfade in der Einheitsdatei passten dann nicht mehr) */
const part = (s, max) => {
  const c = clean(s);
  let t = c.slice(0, max);
  if (c.length > max) { const i = t.lastIndexOf(" "); if (i > max * 0.5) t = t.slice(0, i); }   // möglichst an einer Wortgrenze
  return t.replace(/[\s.,;:\u2013-]+$/, "");
};
const dmy = (iso) => (isIsoDate(iso) ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");

/* „Unterrichtseinheit - PoWi - Jg. 8 - Gewaltenteilung“ (ohne Endung); Grundschule (gsShort = Kurzname des Kurses, z. B. „Religion 2ab“):
   „Unterrichtseinheit - Grundschule - Religion 2ab - Josef“ */
export function unitBaseName({ subject, klass, title }, max = 80, gsShort = null) {
  if (subject === GS_SUBJECT) return ["Unterrichtseinheit", "Grundschule", part(gsShort, 40) || "Kurs", part(title, max) || "ohne Titel"].join(" - ");
  return ["Unterrichtseinheit", subjectShort(subject) || subjectName(subject) || "Fach", groupShort(klass) || "Lerngruppe", part(title, max) || "ohne Titel"].join(" - ");
}
/* Einheitsdatei im Einheitsordner (kürzer – der Ordner nennt Klasse und Titel schon) */
export const unitJsonName = (u, gsShort = null) => unitBaseName(u, 40, gsShort) + ".json";
/* Sitzungsdatei im Sitzungsordner (kurz – Fach, Einheit, Nummer, Datum und Stundenfrage nennen die Ordner) */
export const SESSION_IN_FOLDER = "Unterrickssitzung.zip";
/* Ordner einer Einheit in der Sicherung: „8B - Gewaltenteilung“ (Klasse bzw. Kurs, damit gleiche Titel verschiedener Klassen getrennt bleiben) */
// Grundschule: der Kurzname des Kurses statt der Klasse („Religion 2ab - Josef“)
const groupOf = (klass, gsShort) => (isGsCourseId(klass) ? part(gsShort, 40) || "Kurs" : classShort(klass) || "Lerngruppe");
export const unitFolderName = ({ klass, title }, gsShort = null) => groupOf(klass, gsShort) + " - " + (part(title, 40) || "ohne Titel");
export const looseFolderName = (klass, gsShort = null) => groupOf(klass, gsShort) + " - Sitzungen ohne Einheit";
/* Ordner einer Sitzung: „03 - 12.11.2026 - Wer kontrolliert wen“ (n = chronologische Nummer, width = Stellen) */
export function sessionFolderName(n, { date, title }, width = 2) {
  return String(n).padStart(width, "0") + " - " + (dmy(date) || "ohne Datum") + (part(title, 30) ? " - " + part(title, 30) : "");
}
export const backupFileName = (iso) => "Unterricks-Sicherung - " + (isIsoDate(iso) ? iso : "ohne Datum") + ".zip";
export const subjectFolderName = (id) => (id === GS_SUBJECT ? "Grundschule" : clean(subjectName(id)) || "Fach");
export const subjectOrder = (id) => { const i = SUBJECTS.findIndex((s) => s.id === id); return i < 0 ? (id === GS_SUBJECT ? 50 : 99) : i; };

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
    // Rahmendaten der Einheit – ohne die unterrichtsfreien Tage der Schule (Einstellungen, nie Teil der Einheit)
    source: { subject: unit.subject, klass: unit.klass, title: unit.title || "", status: unit.status || "", params: storeParams(unit.params || {}) },
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
    const p = r && typeof r.session === "string" && r.session.length <= 400 && /\.zip$/i.test(r.session) ? zipPath(r.session.normalize("NFC")) : null;
    sessions.push(p && p !== "Datei" ? p : null);
  }
  return { source: { subject: isValidSubject(src.subject) ? src.subject : null, klass: isValidClass(src.klass) ? src.klass : null, title: clean(src.title).slice(0, 200) },
    title: clean(u.title).slice(0, 200) || plan.titel, plan, rows, sessions };
}

/* In einer ZIP-Datei die Einheitsdatei finden (auch ein gepackter Ordner aus der großen Sicherung): die am wenigsten tief liegende
   JSON-Datei mit kind „unterricks-einheit“. → {data (roh), base: Ordner der Datei („“ = oben), count: Zahl der Einheitsdateien} oder null
   (count > 1 bzw. backup: das ist eine ganze Sicherung, keine einzelne Einheit) */
export function findUnitEntry(entries, decode = (u8) => new TextDecoder().decode(u8)) {
  const cands = (entries || []).filter((e) => /\.json$/i.test(e.name) && e.data && e.data.length <= 4e6)
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length || a.name.length - b.name.length);
  let found = null, count = 0, backup = false;
  for (const e of cands) {
    let raw; try { raw = JSON.parse(decode(e.data)); } catch { continue; }
    if (raw && raw.kind === BACKUP_FILE.kind) backup = true;
    if (raw && raw.kind === UNIT_FILE.kind) { count++; if (!found) { const i = e.name.lastIndexOf("/"); found = { data: raw, base: i < 0 ? "" : e.name.slice(0, i), name: e.name }; } }
  }
  return found ? { ...found, count, backup } : null;
}
/* Pfad der Sitzungsdatei relativ zur Einheitsdatei → Name in der ZIP-Datei */
export const joinPath = (base, p) => zipPath((base ? base + "/" : "") + p);
/* Sitzungsdatei zu einem Pfad finden: genau, sonst (neu gepackt: andere Schreibweise des Ordners) über die Nummer des Sitzungsordners
   („03 - “) im selben Einheitsordner. names = Namen aller Einträge (NFC) */
export function findSessionEntry(names, base, p) {
  const want = joinPath(base, p).normalize("NFC");
  if (names.includes(want)) return want;
  const m = /^(\d{2,}) - /.exec(p.split("/")[0] || "");
  if (!m) return null;
  const pre = (base ? base.normalize("NFC") + "/" : ""), hits = names.filter((n) => n.startsWith(pre) && /\.zip$/i.test(n) && n.slice(pre.length).split("/").length === 2 && n.slice(pre.length).startsWith(m[1] + " - "));
  return hits.length === 1 ? hits[0] : null;
}
