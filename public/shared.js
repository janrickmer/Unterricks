// shared.js – gemeinsame Logik für Browser und Worker (ES-Modul, keine Abhängigkeiten, keine DOM-Zugriffe).
// Fächer, Klassen, Sitzungscodes, Schulportal-Format (Schulportal Hessen, Artikel 664) und die festen Prompt-Bausteine.

/* ---------- Fächer und Klassen ---------- */
export const SUBJECTS = [
  { id: "powi", name: "Politik und Wirtschaft", short: "PoWi" },
  { id: "evrel", name: "Evangelische Religion", short: "Ev. Religion" },
  { id: "ethik", name: "Ethik", short: "Ethik" },
];
const SUBJECT_IDS = new Set(SUBJECTS.map((s) => s.id));
export const isValidSubject = (id) => typeof id === "string" && SUBJECT_IDS.has(id);
export const subjectName = (id) => (SUBJECTS.find((s) => s.id === id) || {}).name || "";

/* je Jahrgang (5–10 und E-Phase = Jahrgang 11) acht Klassen: a bis h */
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
/* Qualifikationsphase: je Kurshalbjahr Grund- und Leistungskurs als eigene Kurse (KCGO/Abiturerlass unterscheiden die Niveaus) */
export const KURSARTEN = { GK: "Grundkurs", LK: "Leistungskurs" };
export const Q_COURSES = ["Q1", "Q2", "Q3", "Q4"].flatMap((q) => [q + "-GK", q + "-LK"]);
export const CLASS_GROUPS = [
  ...[5, 6, 7, 8, 9, 10].map((n) => ({ key: String(n), label: "Jahrgangsstufe " + n, classes: LETTERS.map((l) => n + l) })),
  { key: "E", label: "Einführungsphase (Jahrgangsstufe 11)", classes: LETTERS.map((l) => "E" + l) },
  { key: "Q", label: "Qualifikationsphase (Jahrgangsstufen 12 und 13)", classes: Q_COURSES },
];
/* Ev. Religion und Ethik: in den Jahrgängen 5–10 und in der E-Phase je Jahrgang EIN Kurs mit Schüler:innen aus mehreren Klassen.
 * Kennung „<Jahrgang>-K“ (z. B. „8-K“, „E-K“); welche Klassen dazugehören, legt die Lehrkraft fest (Fach-Einstellungen, courses).
 * Schüler:innen wählen weiter ihre eigene Klasse – die Plattform ordnet sie über diese Zuordnung dem Kurs zu. */
export const COURSE_SUBJECTS = ["evrel", "ethik"];
export const COURSE_GRADES = ["5", "6", "7", "8", "9", "10", "E"];
export const courseKey = (g) => g + "-K";
export const COURSE_CLASSES = COURSE_GRADES.map(courseKey);
export const isCourseClass = (k) => typeof k === "string" && COURSE_CLASSES.includes(k);
export const isCourseSubject = (s) => COURSE_SUBJECTS.includes(s);
export const ALL_CLASSES = [...CLASS_GROUPS.flatMap((g) => g.classes), ...COURSE_CLASSES];
const CLASS_SET = new Set(ALL_CLASSES);
export const isValidClass = (k) => typeof k === "string" && CLASS_SET.has(k);
export const GRADE_KEYS = CLASS_GROUPS.map((g) => g.key);
export const gradeKey = (k) => (/^\d+/.test(k) ? String(parseInt(k, 10)) : k ? k[0] : "");
/* Anzeige: „7B“, „EA“, „Q3 LK“, „Kurs Jg. 8“, „Kurs E-Phase“ */
export const classShort = (k) => (isCourseClass(k) ? "Kurs " + (k[0] === "E" ? "E-Phase" : "Jg. " + parseInt(k, 10)) : String(k || "").replace("-", " "));

/* Jahrgangsstufe zu einer Klasse – für die KI und die Prompts */
export function gradeInfo(k) {
  if (!isValidClass(k)) return { stufe: null, text: "", level: null, halfYear: null };
  if (isCourseClass(k)) {
    const multi = ", Kurs mit Schüler:innen aus mehreren Klassen des Jahrgangs";
    return k[0] === "E" ? { stufe: 11, text: "Einführungsphase der gymnasialen Oberstufe (Jahrgangsstufe 11)" + multi, level: null, halfYear: "E", course: true }
      : { stufe: parseInt(k, 10), text: "Jahrgangsstufe " + parseInt(k, 10) + " (Sekundarstufe I)" + multi, level: null, halfYear: null, course: true };
  }
  const m = /^(\d+)[A-H]$/.exec(k);
  if (m) return { stufe: Number(m[1]), text: "Jahrgangsstufe " + m[1] + " (Sekundarstufe I)", level: null, halfYear: null };
  if (k[0] === "E") return { stufe: 11, text: "Einführungsphase der gymnasialen Oberstufe (Jahrgangsstufe 11)", level: null, halfYear: "E" };
  const q = Number(k[1]), lvl = k.slice(3);
  const jg = q <= 2 ? 12 : 13, hj = q % 2 === 1 ? 1 : 2;
  return { stufe: jg, level: lvl, halfYear: "Q" + q,
    text: "Qualifikationsphase Q" + q + " der gymnasialen Oberstufe (Jahrgangsstufe " + jg + ", " + hj + ". Halbjahr), " + KURSARTEN[lvl] + " (" + (lvl === "LK" ? "erhöhtes" : "grundlegendes") + " Niveau)" };
}
export const classLabel = (k) => (isValidClass(k) ? (isCourseClass(k) ? "" : "Klasse/Kurs ") + classShort(k) + " – " + gradeInfo(k).text : "");
/* Jahrgänge 5 und 6 haben keine iPads: nur analoge, ausdruckbare Materialien (keine Feibeitsblätter, keine Escape-Rooms) */
export const isAnalogClass = (k) => { const s = gradeInfo(k).stufe; return s === 5 || s === 6; };
export const ANALOG_RULE = "In den Jahrgängen 5 und 6 haben die Schüler:innen an dieser Schule keine iPads und können nicht digital lernen: Entwickle KEINE digitalen Arbeitsformate " +
  "(keine Feibeitsblätter, keine Escape-Rooms, keine Online-Aufgaben), sondern analoges Arbeitsmaterial als ausdruckbare PDF-Arbeitsblätter.";

/* Fach-Einstellungen: in welchen Jahrgängen ein Fach unterrichtet wird, Hinweise je Jahrgang, Planungsregeln für die KI */
const ALL_GRADES = ["5", "6", "7", "8", "9", "10", "E", "Q"];
export const DEFAULT_SUBJECT_CONFIG = {
  powi: {
    grades: ["6", "8", "9", "10", "E", "Q"],
    gradeNotes: { "10": "In Jahrgang 10 wird Politik und Wirtschaft nur im ersten Schulhalbjahr unterrichtet; im zweiten Halbjahr tritt ein anderes Fach an seine Stelle." },
    rules: [
      "Klassen 5–10: Grundlage ist das Schulcurriculum des Fachs. Alles, was dort unter „Formate, Methoden, Medien“ steht, sind nur Ideen und Vorschläge, keine verpflichtenden Methoden – hier darf frei und kreativ geplant werden.",
      "Das Schulcurriculum (G9) ist nicht mehr ganz aktuell: Politik und Wirtschaft wird an dieser Schule nur in den Jahrgängen 6, 8, 9, 10 (nur 1. Halbjahr), 11, 12 und 13 unterrichtet. Die Inhalte des Jahrgangs 7 entfallen; maßgeblich sind die Inhalte ab Jahrgang 8. Für Jahrgang 6 gilt das eigene Fachcurriculum.",
      "E-Phase (Jahrgang 11): Grundlage sind das KCGO mit den dort vorgegebenen Schwerpunkten und das schulinterne E-Phasen-Curriculum.",
      "Q1–Q4 (Jahrgänge 12 und 13): Grundlage sind das KCGO für das jeweilige Kurshalbjahr und der geltende Abiturerlass des Kurses (Kursart Grund- oder Leistungskurs beachten).",
      "Ab der E-Phase müssen nicht alle Themen des KCGO verpflichtend unterrichtet werden; verbindlich sind die im KCGO bzw. im Abiturerlass festgelegten Themenfelder.",
    ].join("\n"),
  },
  evrel: { grades: ALL_GRADES, gradeNotes: {}, rules: "" },
  ethik: { grades: ALL_GRADES, gradeNotes: {}, rules: "" },
};
/* Klassen eines Kurses: nur echte Klassen genau dieses Jahrgangs, ohne Doppelte, sortiert */
export const courseMembersClean = (g, list) => [...new Set((Array.isArray(list) ? list : []).filter((k) => typeof k === "string" && /^(\d+|E)[A-H]$/.test(k) && isValidClass(k) && gradeKey(k) === g))].sort();
export function subjectConfig(all, subject) {
  const d = DEFAULT_SUBJECT_CONFIG[subject] || { grades: ALL_GRADES, gradeNotes: {}, rules: "" };
  const c = (all && all[subject]) || {};
  const courseMode = isCourseSubject(subject), courses = {};
  if (courseMode && c.courses && typeof c.courses === "object") for (const g of COURSE_GRADES) { const m = courseMembersClean(g, c.courses[g]); if (m.length) courses[g] = m; }
  return { grades: Array.isArray(c.grades) && c.grades.length ? c.grades.filter((g) => ALL_GRADES.includes(g)) : d.grades,
    gradeNotes: c.gradeNotes && typeof c.gradeNotes === "object" ? c.gradeNotes : d.gradeNotes, rules: typeof c.rules === "string" ? c.rules : d.rules, complete: !!c.complete,
    courseMode, courses };
}
export const classGroupsFor = (cfg) => CLASS_GROUPS.filter((g) => cfg.grades.includes(g.key));
/* Kurse (z. B. „8-K“) nur in Ev. Religion und Ethik; echte Klassen bleiben dort für die Schüler:innen wählbar */
export const classAllowed = (cfg, k) => isValidClass(k) && cfg.grades.includes(gradeKey(k)) && (!isCourseClass(k) || !!cfg.courseMode);
export const courseMembers = (cfg, k) => (isCourseClass(k) && cfg && cfg.courses ? cfg.courses[gradeKey(k)] || [] : []);
/* Kurs, zu dem eine echte Klasse gehört (z. B. 8B → „8-K“), sonst null */
export const courseOf = (cfg, k) => { const g = gradeKey(k); return cfg && cfg.courseMode && COURSE_GRADES.includes(g) && (cfg.courses[g] || []).includes(k) ? courseKey(g) : null; };

/* ---------- Datum (JJJJ-MM-TT, ohne Zeitzonen-Verschiebung) ---------- */
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const utcNoon = (iso) => Date.parse(iso + "T12:00:00Z");
export const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utcNoon(s)) && new Date(utcNoon(s)).toISOString().slice(0, 10) === s;
export function addDays(iso, n) { const d = new Date(utcNoon(iso)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const daysBetween = (a, b) => Math.round((utcNoon(b) - utcNoon(a)) / 86400e3);
export const weekday = (iso) => WD[new Date(utcNoon(iso)).getUTCDay()];
export const isWeekend = (iso) => { const d = new Date(utcNoon(iso)).getUTCDay(); return d === 0 || d === 6; };
/* Uhrzeit „HH:MM“ (24 Stunden) */
export const isClockTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/* Ortszeit der Schule (Europe/Berlin, mit Sommerzeit) → Zeitpunkt in ms */
const tzOffset = (ms) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => Number((parts.find((x) => x.type === t) || {}).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(ms / 1000) * 1000;
};
export function berlinTime(iso, hhmm) {
  if (!isIsoDate(iso) || !isClockTime(hhmm)) return null;
  const [y, m, d] = iso.split("-").map(Number), [hh, mm] = hhmm.split(":").map(Number), wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall - tzOffset(wall);
  t = wall - tzOffset(t);   // zweiter Schritt: richtig auch an den Tagen der Zeitumstellung
  return t;
}
/* Zeitpunkte einer Sitzung: Beginn, Ende, ab wann Schüler:innen die Hausaufgabe sehen (15 Minuten vor dem Ende) und die Präsentation
   selbst öffnen können (5 Minuten nach dem Ende). Ohne Datum, Startzeit oder Dauer: null (dann bleibt beides gesperrt). */
export const HOMEWORK_BEFORE_END_MIN = 15, PRESENTATION_AFTER_END_MIN = 5;
export function lessonTimes(l) {
  const start = l ? berlinTime(l.date, l.startTime) : null, dur = l ? Number(l.durationMin) : NaN;
  if (start === null || !Number.isInteger(dur) || dur < 1) return null;
  const end = start + dur * 60e3;
  return { start, end, homeworkAt: end - HOMEWORK_BEFORE_END_MIN * 60e3, presentationAt: end + PRESENTATION_AFTER_END_MIN * 60e3 };
}
/* KI-Begriffshilfe für Schüler:innen (während der Stunde): feste Regeln, Fach, Lerngruppe, Thema und – zur Orientierung – der Stundenverlauf */
export const STUDENT_HELP_LIMITS = { question: 300, answer: 1200, history: 3 };
export function studentHelpPrompt(l) {
  const portal = removeStops(String(l.portal || "")).trim();
  return [
    "Du bist die KI-Begriffshilfe der Unterrichtsplattform Unterricks. Du beantwortest Fragen von Schüler:innen während einer Unterrichtsstunde.",
    "Fach: " + subjectName(l.subject) + ". Lerngruppe: " + gradeInfo(l.klass).text + ". Thema der Stunde: " + (l.title || "(ohne Titel)") + (l.topic && l.topic !== l.title ? " – " + l.topic : "") + ".",
    ...(portal ? ["Geplanter Stundenverlauf (nur zur Orientierung, nicht vorlesen):\n" + clip(portal, 1500)] : []),
    "Regeln:",
    "1. Beantworte nur Fragen zu Fachbegriffen und zum Inhalt dieser Unterrichtsstunde bzw. dieses Fachs.",
    "2. Antworte kurz: höchstens vier kurze Sätze (etwa 80 Wörter), gern mit einem einfachen Beispiel.",
    "3. Verwende eine Sprache, die Schüler:innen dieser Jahrgangsstufe leicht verstehen: kurze Sätze, wenige Fremdwörter – erkläre sie, wenn du sie brauchst. Sprich die Person mit „du“ an.",
    "4. Löse keine Arbeitsaufträge, Aufgaben oder Feibeitsblätter und schreibe keine fertigen Antworten oder Texte zum Abgeben – erkläre nur Begriffe und Zusammenhänge, damit die Person selbst weiterarbeiten kann.",
    "5. Gehört eine Frage nicht zum Unterricht (z. B. Privates, andere Themen, Spiele) oder ist sie unangemessen, antworte in einem freundlichen Satz, dass du nur Fragen zum Unterrichtsthema und zu Fachbegriffen beantwortest.",
    "6. Frag nie nach persönlichen Daten und wiederhole keine. Bei persönlichen Sorgen oder Problemen empfiehl, mit der Lehrkraft oder einer Vertrauensperson zu sprechen.",
    "7. Bist du unsicher oder ist eine Frage umstritten, sag das ehrlich und empfiehl, die Lehrkraft zu fragen. Erfinde nichts.",
    "8. Antworte nur mit der Erklärung als Fließtext, ohne Überschriften.",
  ].join("\n");
}
/* Druckliste „Von der Lehrkraft auszudrucken“ (nur PDF, A4): Dateiname „28x - beidseitig - sw - Name.pdf“ (Vorgabe der Lehrkraft) */
export const PRINT_LIMITS = { copies: 500, name: 160 };
export const printBase = (name) => String(name == null ? "" : name).replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.\s-]+$/, "").slice(0, PRINT_LIMITS.name) || "Druckvorlage";
export const printFileName = (p) => (Number(p.copies) || 1) + "x - " + (p.duplex ? "beidseitig" : "einseitig") + " - " + (p.color ? "Farbe" : "sw") + " - " + printBase(p.name) + ".pdf";
export const cleanCopies = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= PRINT_LIMITS.copies ? n : null; };
/* „Folie 1–12“ bzw. „Folie 1“ (Präsentation bis zur letzten gezeigten Folie) */
export const slidesUpTo = (n) => (n === 1 ? "Folie 1" : "Folie 1–" + n);
export const fmtClockBerlin = (ms) => new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
export const fmtDayBerlin = (ms) => new Date(ms).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
export const fmtDay = (iso) => (isIsoDate(iso) ? weekday(iso) + ", " + iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");

/* ---------- Sitzungscodes (wie bei Feibeitsblatt: 6 Zeichen ohne I, L, O, 0, 1; Anzeige ABC-123) ---------- */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normalizeCode = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isValidCode = (c) => typeof c === "string" && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(c) && /[A-Z]/.test(c) && /[0-9]/.test(c);
/* Links als Material: nur http(s)-Adressen ohne Zugangsdaten; ohne Schema wird https:// ergänzt. Liefert die normalisierte Adresse oder null. */
export function cleanWebUrl(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > 2000 || /[\s<>"]/.test(s)) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s); } catch { return null; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname) return null;
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.href.length > 2000 ? null : u.href;
}
/* Anzeige einer Adresse: Host und Pfad ohne Schema, gekürzt */
export const webUrlLabel = (url) => { const s = String(url || "").replace(/^https?:\/\//, "").replace(/\/$/, ""); return s.length > 70 ? s.slice(0, 67) + "…" : s; };
export const formatCode = (c) => (c && c.length === 6 ? c.slice(0, 3) + "-" + c.slice(3) : String(c || ""));

/* Öffentliche Adresse der Oberfläche (GitHub Pages mit eigener Domain) – für Hinweise im Schulportal */
export const PUBLIC_URL = "https://unterricks.janrickmer.de";
export const subjectShort = (id) => (SUBJECTS.find((s) => s.id === id) || {}).short || "";
/* Lerngruppe kurz (Chat-Namen): Sek. I – Klasse oder Kurs – „Jg. 8“, E-Phase „E-Phase“, Qualifikationsphase „Q2 GK“ */
export function groupShort(k) {
  if (!isValidClass(k)) return "";
  const g = gradeKey(k);
  return g === "Q" ? classShort(k) : g === "E" ? "E-Phase" : "Jg. " + g;
}
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
/* „25. November 2026“ */
export const fmtLongDay = (iso) => (isIsoDate(iso) ? Number(iso.slice(8, 10)) + ". " + MONTHS[Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4) : "");
/* Hausaufgabe fürs Schulportal (Vorgabe der Lehrkraft):
 *   **Hausaufgabe zum 25. November 2026:**
 *   (Leerzeile)
 *   - Stichpunkt 1
 *   - …
 *   - Unter https://unterricks.janrickmer.de kannst du diese Sitzung mit dem Code ~~ABC-123~~ aufrufen, …
 * Jede Zeile der Hausaufgabe wird ein Stichpunkt (vorhandene „- “/„* “ werden übernommen); der letzte Stichpunkt – nur im Schulportal,
 * nicht in Unterricks – nennt den Weg zu dieser Sitzung. Datum = nächste Sitzung (Fälligkeit). Ohne Hausaufgabe nur dieser Hinweis.
 * Schulportal-Zeichen: **…** = fett, „- “ = Aufzählung, ~~…~~ = kursiv (wie die Codes in der Vorlage). */
export function homeworkForPortal(homework, code, dueDate) {
  const items = String(homework == null ? "" : homework).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/^\s*(?:[-*•–]\s+)?/, "").trim()).filter(Boolean);
  const hint = "Unter " + PUBLIC_URL + " kannst du diese Sitzung mit dem Code ~~" + formatCode(code) + "~~ aufrufen, um alle Materialien zu sehen und Abgaben eines Feibeitsblattes zu erledigen.";
  if (!items.length) return "- " + hint;
  return "**Hausaufgabe " + (isIsoDate(dueDate) ? "zum " + fmtLongDay(dueDate) : "zur nächsten Sitzung") + ":**\n\n" + [...items, hint].map((x) => "- " + x).join("\n");
}

/* ---------- Schulportal Hessen: Formatierung (support.schulportal.hessen.de, Artikel 664) ----------
 * **fett**  __unterstrichen__  ~~kursiv~~  --durchgestrichen--  `Quellcode`  Zeilen mit "- " = Aufzählung
 * ^1 / ^(123) hochgestellt, _1 / _(123) tiefgestellt, https://… wird anklickbar.
 * ACHTUNG: ~~…~~ ist im Schulportal KURSIV (nicht durchgestrichen wie in Markdown). */
export const PORTAL_RULES = [
  "**Text** = fett",
  "~~Text~~ = kursiv (nicht durchgestrichen!)",
  "__Text__ = unterstrichen",
  "--Text-- = durchgestrichen",
  "`Text` = Quellcode",
  "Zeilen, die mit \"- \" beginnen = Aufzählung",
  "Links mit https:// werden automatisch anklickbar",
];

/* Struktur nach dem Beispiel der Lehrkraft (verbindliche Vorlage) */
export const PORTAL_EXAMPLE = [
  "**1) TOP 10**",
  "",
  "**2) Blitzlicht ohne iPad**",
  "- Einstieg: ~~Wie kann man sich helfen, wenn Demokratiefeinde regieren?~~",
  "",
  "**3) Partnerarbeit**",
  "- Feibeitsblatt ~~Die wehrhafte Demokratie~~ mit dem Code ~~AEH-4VY~~",
  "- Aufgabe 4 besprechen",
  "",
  "**4) Video: Das Bundesverfassungsgericht**",
  "- ~~AB - Das Bundesverfassungsgericht~~",
  "- Video: https://www.youtube.com/watch?v=Fk1u8VKrJGA&feature=youtu.be",
  "",
  "--> Nächste Stunde",
  "",
  "**5) Diskussionsrunde**",
  "- Erst in Partnerarbeit Argumente zur Diskussionsfrage finden: ~~Ist das Bundesverfassungsgericht zu mächtig?~~ und auf der Argumentationswippe festhalten: https://argumentationswippe.de/",
  "- Während der Diskussion muss das weiter gefüllt werden.",
].join("\n");

/* Text aus der KI entschärfen: Zeichenfolgen, die im Schulportal ungewollt formatieren würden, ersetzen.
 * «…» bzw. »…« (Titel, Leitfragen, Codes) wird anschließend zu ~~…~~ (kursiv). */
export function portalSafe(s) {
  return String(s == null ? "" : s)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\*\*/g, "*")
    .replace(/~~/g, "~")
    .replace(/__/g, "_")
    .replace(/--+/g, "–")
    .replace(/`/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}
export function portalItalics(s) {
  // «x» oder »x« → ~~x~~ (Inhalt ohne äußere Leerzeichen)
  return s.replace(/«\s*([^«»]+?)\s*»/g, "~~$1~~").replace(/»\s*([^«»]+?)\s*«/g, "~~$1~~");
}
const portalItem = (s) => portalItalics(portalSafe(s));

/* Strukturierte Planung → fertiger Schulportal-Text.
 * data = { phasen: [{ titel, punkte: [string] }], naechsteStundeAb: Nummer der ersten Phase für die nächste Stunde | null } */
export function renderPortalEntry(data) {
  const phasen = Array.isArray(data && data.phasen) ? data.phasen : [];
  const next = Number(data && data.naechsteStundeAb) || 0;
  const out = [];
  phasen.forEach((p, i) => {
    const n = i + 1;
    if (next > 1 && n === next) out.push("--> Nächste Stunde", "");
    const titel = portalItem(p && p.titel) || "Phase " + n;
    out.push("**" + n + ") " + titel + "**");
    const punkte = Array.isArray(p && p.punkte) ? p.punkte : [];
    for (const pt of punkte) { const t = portalItem(pt); if (t) out.push("- " + t); }
    out.push("");
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/* JSON-Antwort der KI für den Schulportal-Eintrag prüfen (wirft Error mit deutscher Meldung) */
export function validatePortalData(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.phasen) || !obj.phasen.length)
    throw new Error("Die KI hat keinen verwertbaren Stundenverlauf geliefert. Bitte noch einmal versuchen.");
  const phasen = obj.phasen.slice(0, 20).map((p) => ({
    titel: String((p && (p.titel || p.title)) || "").slice(0, 200),
    punkte: (Array.isArray(p && (p.punkte || p.items)) ? (p.punkte || p.items) : []).slice(0, 20).map((x) => String(typeof x === "string" ? x : (x && x.text) || "").slice(0, 600)),
  }));
  const next = Number(obj.naechsteStundeAb);
  return { phasen, naechsteStundeAb: Number.isInteger(next) && next > 1 && next <= phasen.length ? next : null };
}

/* ---------- Zwischenstopp (nur intern): markiert, bis wohin eine Stunde tatsächlich gekommen ist ----------
 * Eigene Zeile „⏸ Zwischenstopp“ VOR dem ersten Punkt, der nicht mehr geschafft wurde. Beim Kopieren ins Schulportal und im
 * Präsentations-Prompt wird sie entfernt. Je Eintrag höchstens ein Zwischenstopp (Einfügen verschiebt ihn). */
export const STOP_LINE = "⏸ Zwischenstopp";
const STOP_RE = /^\s*⏸\s*Zwischenstopp\b.*$/;
export const isStopLine = (l) => STOP_RE.test(String(l));
export const hasStop = (text) => String(text == null ? "" : text).split("\n").some(isStopLine);
const splitLines = (text) => String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
/* vor Zeile lineIndex (0-basiert, bezogen auf den bisherigen Text) einfügen → {text, line: Index der Stopp-Zeile} */
export function insertStop(text, lineIndex) {
  const out = [];
  let target = null;
  splitLines(text).forEach((l, i) => { if (i === lineIndex) target = out.length; if (!isStopLine(l)) out.push(l); });
  if (target === null) target = out.length;
  out.splice(target, 0, STOP_LINE);
  return { text: out.join("\n"), line: target };
}
export const removeStops = (text) => splitLines(text).filter((l) => !isStopLine(l)).join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
/* Text für das Schulportal (ohne interne Markierungen) */
export const portalForCopy = (text) => removeStops(text);

/* Schulportal-Markup für die Vorschau zerlegen: Zeilen → {type: "li"|"p"|"blank"|"stop", runs: [{text, b, i, u, s, code, sup, sub, href}]} */
export function parsePortalMarkup(text) {
  const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => {
    if (isStopLine(line)) return { type: "stop", runs: [] };
    if (!line.trim()) return { type: "blank", runs: [] };
    const li = /^- /.test(line);
    return { type: li ? "li" : "p", runs: parseRuns(li ? line.slice(2) : line) };
  });
}
const MARKS = [["**", "b"], ["__", "u"], ["~~", "i"], ["--", "s"]];
function parseRuns(s) {
  const runs = [], st = { b: false, u: false, i: false, s: false };
  let buf = "";
  const flush = (extra) => { if (buf) runs.push({ text: buf, ...st, ...(extra || {}) }); buf = ""; };
  for (let k = 0; k < s.length;) {
    const url = /^https?:\/\/[^\s<>"]+/.exec(s.slice(k));
    if (url) { flush(); runs.push({ text: url[0], ...st, href: url[0] }); k += url[0].length; continue; }
    if (s[k] === "`") {
      const end = s.indexOf("`", k + 1);
      if (end > k) { flush(); runs.push({ text: s.slice(k + 1, end), ...st, code: true }); k = end + 1; continue; }
    }
    if ((s[k] === "^" || s[k] === "_") && s[k + 1] !== "_") {
      const kind = s[k] === "^" ? "sup" : "sub";
      const paren = /^\(([^)]*)\)/.exec(s.slice(k + 1)), word = /^([^\s()]+) /.exec(s.slice(k + 1));
      if (paren) { flush(); runs.push({ text: paren[1], ...st, [kind]: true }); k += 1 + paren[0].length; continue; }
      if (word && k > 0 && s[k - 1] !== " ") { flush(); runs.push({ text: word[1], ...st, [kind]: true }); k += 1 + word[1].length; continue; }
    }
    let hit = null;
    for (const [m, key] of MARKS) {
      if (s.startsWith(m, k)) {
        // öffnen nur, wenn die Marke in derselben Zeile wieder geschlossen wird ("--> Nächste Stunde" bleibt Text)
        if (st[key] || s.indexOf(m, k + m.length) > k + m.length) { hit = [m, key]; break; }
      }
    }
    if (hit) { flush(); st[hit[1]] = !st[hit[1]]; k += hit[0].length; continue; }
    buf += s[k]; k++;
  }
  flush();
  return runs;
}

/* ---------- Feste Rolle des Chatbots (Vorgabe der Lehrkraft, wörtlich) ---------- */
export const SYSTEM_PROMPT_ROLE = "Du bist ein leistungsfähiger didaktischer Assistent, der eine Lehrkraft bei der Planung und Vorbereitung von Unterricht unterstützt. Du berücksichtigst das ausgewählte Unterrichtsfach sowie den jeweiligen Jahrgang und entwickelst fachlich fundierte, didaktisch sinnvolle und abwechslungsreiche Unterrichtskonzepte.\n\n" +
  "Zu Beginn der Planung fragst du die Lehrkraft, wie viele Minuten die Unterrichtssitzung dauert und ob bestimmte Ideen, Themen, Materialien oder didaktische Wünsche berücksichtigt werden sollen.\n\n" +
  "Anschließend begleitest du die Lehrkraft dialogisch durch den Planungsprozess. Du entwickelst konkrete Unterrichtsideen, schlägst passende Methoden und Sozialformen vor und hilfst bei der Erstellung geeigneter Unterrichtsmaterialien.";

/* Erste Nachricht jeder neuen Sitzung (ohne KI-Aufruf, damit die Planung immer mit diesen Fragen beginnt) */
export function greetingText(ctx) {
  const dauer = ctx && ctx.durationMin ? "Eingetragen sind " + ctx.durationMin + " Minuten – stimmt das? " : "Wie viele Minuten dauert die Unterrichtssitzung? ";
  return "Hallo! Ich unterstütze Sie bei der Planung dieser Sitzung (" + subjectName(ctx && ctx.subject) + ", " + classShort((ctx && ctx.klass) || "") + ").\n\n" +
    "1. " + dauer + "\n2. Sollen bestimmte Ideen, Themen, Materialien oder didaktische Wünsche berücksichtigt werden?";
}

export const FEIBEITSBLATT_INFO = "Feibeitsblatt ist das digitale Arbeitsblatt-Werkzeug der Lehrkraft: Die Lehrkraft legt Aufgaben (Aufgabenstellung, optional Material) " +
  "und je Aufgabe einen „Auftrag an die KI“ an (worauf die KI beim Feedback achten soll, z. B. erwartete Inhalte und Kriterien). Die Schüler:innen öffnen das Blatt mit einem Code, " +
  "schreiben ihre Antworten (Textfeld oder Tabelle), können einmal freiwillig KI-Feedback zu ihren Antworten erhalten, überarbeiten und geben verschlüsselt ab; " +
  "die Lehrkraft sieht alle Abgaben. Ein Feibeitsblatt ersetzt ein klassisches Arbeitsblatt, besonders bei Schreib-, Analyse- und Urteilsaufgaben.";

const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + " […gekürzt]" : s; };
const areaLabel = (a) => (a === "student" ? "für Schüler:innen" : a === "teacher" ? "nur Lehrkraft" : a === "presentation" ? "Präsentation" : a === "print" ? "von der Lehrkraft auszudrucken" : a);

/* Kontextblock zur aktuellen Sitzung (für Chatbot, Schulportal-Prompt und Claude-Prompts)
 * ctx = { subject, klass, lesson: {title, topic, durationMin, date, ideas}, materials: [{name, area, kind, text?}], portal, sheets: [{title, code}], drafts } */
export function lessonContext(ctx, opt = {}) {
  const L = ctx.lesson || {};
  const lines = [
    "Unterrichtsfach: " + subjectName(ctx.subject),
    "Klasse/Kurs: " + classShort(ctx.klass) + " – " + gradeInfo(ctx.klass).text,
    "Unterrichtssitzung: " + (L.title || "(noch ohne Titel)"),
    "Thema: " + (L.topic || "(noch nicht festgelegt)"),
    "Dauer: " + (L.durationMin ? L.durationMin + " Minuten" : "(noch nicht angegeben – bitte erfragen)"),
    ...(L.date ? ["Datum: " + fmtDay(L.date) + (L.startTime ? ", Beginn " + L.startTime + " Uhr" : "")] : []),
  ];
  if (L.ideas) lines.push("Ideen und Wünsche der Lehrkraft (Notizfeld):\n" + clip(L.ideas, opt.ideasMax || 4000));
  const mats = (ctx.materials || []).filter((m) => m.area !== "presentation");
  if (mats.length) {
    lines.push("Vorhandene Materialien:");
    for (const m of mats) {
      lines.push("- " + m.name + " (" + areaLabel(m.area) + (m.kind === "text" ? ", Text" : m.kind === "link" ? ", Link: " + clip(m.text, 300) : "") + ")");
      if (opt.materialText && m.kind === "text" && m.text) lines.push("  Inhalt:\n" + clip(m.text, opt.materialMax || 3000).replace(/^/gm, "  "));
    }
  }
  const pres = (ctx.materials || []).find((m) => m.area === "presentation");
  if (pres) lines.push("Präsentation hochgeladen: " + pres.name + (pres.pages ? " (" + pres.pages + " Folien)" : ""));
  if ((ctx.sheets || []).length) {
    lines.push("Feibeitsblätter dieser Sitzung:");
    for (const s of ctx.sheets) lines.push("- „" + s.title + "“ mit dem Code " + formatCode(s.code));
  }
  if (ctx.gradeNote) lines.push("Hinweis zum Jahrgang: " + ctx.gradeNote);
  if (ctx.unitText) lines.push(ctx.unitText);
  if (L.homework) lines.push("Hausaufgabe aus dieser Sitzung (bis zur nächsten Sitzung): " + clip(L.homework, 3000));
  if (opt.portal !== false && ctx.portal) lines.push("Aktueller Schulportal-Eintrag (Stundenverlauf):\n" + clip(ctx.portal, 6000) +
    (hasStop(ctx.portal) ? "\n(„" + STOP_LINE + "“ markiert, bis wohin die Stunde tatsächlich gekommen ist; alles danach ist noch offen.)" : ""));
  return lines.join("\n");
}

/* Regel für Stunden, die zu einer Unterrichtseinheit gehören (Vorgabe der Lehrkraft) */
export const UNIT_RULE_BASE = "Beziehe dich immer auf die in der Unterrichtseinheit festgelegten Aspekte (Lernaufgabe, Lernschritt, Stundenfrage). Die Stichpunkte zum Ablauf dienen nur als Inspiration: " +
  "Liegt inzwischen ein besserer Vorschlag vor, darfst du abweichen und erläuterst, warum er besser passt.";
export const UNIT_RULE = UNIT_RULE_BASE + " Schlägst du eine geänderte Stundenfrage oder einen geänderten groben Ablauf für diese Stunde vor, " +
  "gib am Ende deiner Antwort zusätzlich genau diesen Block aus, damit die Lehrkraft die Änderung mit einem Klick in die Tabelle der Einheit übernehmen kann:\n" +
  "```einheit\n{\"stundenfrage\": \"…\", \"ablauf\": [\"…\", \"…\"], \"begruendung\": \"…\"}\n```";


/* System-Prompt des Chatbots: feste Rolle + Werkzeug-Hinweise + Sitzungskontext */
export function planningSystemPrompt(ctx) {
  return SYSTEM_PROMPT_ROLE + "\n\n" +
    "Weitere feste Hinweise:\n" +
    "- Antworte auf Deutsch, siezend, klar gegliedert (Markdown erlaubt: Überschriften, Listen, Tabellen, **fett**).\n" +
    "- Plane mit Minutenangaben je Phase, die zusammen die Dauer der Sitzung ergeben, und nenne Methode und Sozialform.\n" +
    "- Formuliere Materialien (Arbeitsaufträge, Texte, Tafelbilder) vollständig aus, wenn die Lehrkraft das möchte, damit sie direkt übernommen werden können.\n" +
    (isAnalogClass(ctx.klass) ? "- " + ANALOG_RULE + "\n" :
    "- Schlage bewusst auch vor, statt eines klassischen Arbeitsblatts ein Feibeitsblatt zu erstellen, wenn es didaktisch passt. " + FEIBEITSBLATT_INFO + " " +
    "Stimmt die Lehrkraft zu, entwirf die Aufgaben samt „Auftrag an die KI“; die Lehrkraft kann daraus in der Plattform mit „Feibeitsblatt-Entwurf aus dem Chat“ einen Entwurf erzeugen, prüfen und anlegen.\n") +
    (ctx.unitText ? "- " + UNIT_RULE + "\n" : "") +
    "- Erfinde keine Quellen, Links oder Videos; kennzeichne Vorschläge, die die Lehrkraft prüfen sollte.\n\n" +
    "Aktuelle Unterrichtssitzung (automatisch übermittelt):\n" + lessonContext(ctx, { materialText: true, materialMax: 1500 });
}

/* Prompt für den Schulportal-Eintrag (die KI liefert JSON, die Plattform setzt das Format) */
export function portalMessages(ctx, chatText) {
  const system = "Du erstellst aus einer Unterrichtsplanung den Eintrag für das Schulportal Hessen („Mein Unterricht“). " +
    "Antworte ausschließlich mit einem JSON-Objekt der Form {\"phasen\": [{\"titel\": \"…\", \"punkte\": [\"…\"]}], \"naechsteStundeAb\": null}. " +
    "Regeln: Jede Phase ist ein Unterrichtsschritt in der geplanten Reihenfolge; „titel“ ist kurz und nennt Methode/Sozialform oder Inhalt " +
    "(z. B. „Blitzlicht ohne iPad“, „Partnerarbeit“, „Video: Das Bundesverfassungsgericht“). „punkte“ sind knappe Stichpunkte (0–4) mit dem, was passiert. " +
    "Setze Titel von Materialien und Arbeitsblättern, Leitfragen/Diskussionsfragen und Codes in «» (sie werden kursiv), z. B. „Einstieg: «Wie kann man sich helfen, wenn Demokratiefeinde regieren?»“ " +
    "oder „Feibeitsblatt «Die wehrhafte Demokratie» mit dem Code «AEH-4VY»“. Links nur, wenn sie in der Planung wörtlich stehen, als vollständige https://-Adresse. " +
    "Keine Minutenangaben, keine Markdown-Zeichen (*, _, ~, #), keine Nummerierung im Titel. " +
    "„naechsteStundeAb“: Nummer der ersten Phase, die laut Planung erst in der nächsten Stunde drankommt, sonst null.";
  const user = "Formatvorlage der Lehrkraft (so sieht der fertige Eintrag aus):\n<<<\n" + PORTAL_EXAMPLE + "\n>>>\n\n" +
    "Sitzung:\n" + lessonContext(ctx, { portal: false, materialText: false }) + "\n\n" +
    "Bisherige Planung (Chatverlauf, neueste Fassung zählt):\n<<<\n" + clip(chatText, 30000) + "\n>>>\n\nGib jetzt nur das JSON-Objekt aus.";
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/* Prompt für einen Feibeitsblatt-Entwurf aus dem Chat */
export function feibeitsblattMessages(ctx, chatText, wish) {
  const system = "Du entwirfst ein Feibeitsblatt für den Unterricht. " + FEIBEITSBLATT_INFO + " " +
    "Antworte ausschließlich mit einem JSON-Objekt der Form {\"title\": \"…\", \"tasks\": [{\"text\": \"Aufgabenstellung\", \"material\": \"optionaler Materialtext oder leer\", " +
    "\"ki_auftrag\": \"Auftrag an die KI für das Feedback\", \"antwort\": \"text\" oder {\"tabelle\": [\"Spalte 1\", \"Spalte 2\"], \"zeilen\": 3}}]}. " +
    "Regeln: 1–6 Aufgaben mit Operatoren passend zur Jahrgangsstufe; der „ki_auftrag“ beschreibt konkret, welche Inhalte, Kriterien und Fehler die KI beim Feedback beachten soll, " +
    "ohne den Schüler:innen die Lösung vorzusagen; Material nur als Text (keine Bilder, keine erfundenen Quellen). Antwortart „text“ ist der Normalfall; eine Tabelle nur, wenn sie didaktisch sinnvoll ist (höchstens 8 Spalten, 30 Zeilen).";
  const user = "Sitzung:\n" + lessonContext(ctx, { materialText: true, materialMax: 2000 }) + "\n\n" +
    (wish ? "Wunsch der Lehrkraft zum Feibeitsblatt: " + clip(wish, 2000) + "\n\n" : "") +
    "Bisherige Planung (Chatverlauf):\n<<<\n" + clip(chatText, 30000) + "\n>>>\n\nGib jetzt nur das JSON-Objekt aus.";
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/* Prompt für Material aus einer Chat-Nachricht ist nicht nötig: Material wird direkt aus der Antwort übernommen. */

/* Chatverlauf als Text */
export function chatTranscript(messages, max = 40000) {
  const parts = [];
  for (const m of messages || []) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    parts.push((m.role === "user" ? "Lehrkraft: " : "Assistent: ") + String(m.content || "").trim());
  }
  let t = parts.join("\n\n");
  if (t.length > max) t = "[…ältere Nachrichten gekürzt…]\n\n" + t.slice(t.length - max);
  return t;
}
export function teacherWishes(messages, max = 8000) {
  const t = (messages || []).filter((m) => m.role === "user").map((m) => "- " + String(m.content || "").trim().replace(/\n+/g, " ")).join("\n");
  return t.length > max ? t.slice(0, max) + " […gekürzt]" : t;
}

/* ---------- Prompts für Claude (claude.ai, Pro-Abo – Kopieren & Einfügen) ---------- */
const connectorHint = (ctx) => ctx.lessonId
  ? "\n\nFalls in diesem Chat der Connector „Unterricks“ verfügbar ist: Rufe zuerst `get_lesson` mit der Sitzungs-ID " + ctx.lessonId +
    " auf (dort stehen alle aktuellen Daten), und speichere deine Ergebnisse auf Wunsch der Lehrkraft direkt mit `save_schulportal_entry`, `add_text_material` bzw. `propose_feibeitsblatt` in der Plattform."
  : "";

export function claudePresentationPrompt(ctx, portalText, messages) {
  const L = ctx.lesson || {};
  const developed = (messages || []).filter((m) => m.role === "assistant").slice(-3).map((m) => String(m.content || "").trim()).join("\n\n---\n\n");
  return [
    "Erstelle eine vollständige PowerPoint-Präsentation (.pptx, 16:9) für die folgende Unterrichtsstunde. Die Präsentation läuft während des Unterrichts am Beamer und führt " +
      "die Lehrkraft und die Schülerinnen und Schüler Schritt für Schritt durch die gesamte Stunde. Exportiere die fertige Präsentation zusätzlich als PDF-Datei " +
      "(eine Seite je Folie, ohne Notizenseiten) – die PDF-Fassung wird in der Unterrichtsplattform live und synchron auf den Geräten der Schüler:innen angezeigt. Stelle mir beide Dateien zum Herunterladen bereit.",
    "",
    "## Rahmendaten",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + classShort(ctx.klass) + " – " + gradeInfo(ctx.klass).text,
    "- Thema: " + (L.topic || L.title || "(siehe Stundenverlauf)"),
    "- Dauer: " + (L.durationMin ? L.durationMin + " Minuten" : "(nicht angegeben)"),
    L.date ? "- Datum: " + fmtDay(L.date) : "",
    "",
    "## Verbindlicher Stundenverlauf (aktueller Schulportal-Eintrag der Lehrkraft – genau diese Fassung gilt, auch wenn ältere Planungen abweichen)",
    "Formatierung im Text: **…** = fett, ~~…~~ = kursiv (Titel, Leitfragen, Codes), Zeilen mit „- “ = Stichpunkte, „--> Nächste Stunde“ = ab hier folgt der Teil für die nächste Stunde.",
    "<<<",
    removeStops(portalText).trim(),
    ">>>",
    L.homework ? "\nHausaufgabe bis zur nächsten Sitzung (als letzte Folie zeigen): " + clip(L.homework, 3000) : "",
    "",
    "## Materialien und weitere Informationen",
    lessonContext(ctx, { portal: false, materialText: true, materialMax: 5000 }).split("\n").filter((l) => /^(- |  |Vorhandene|Feibeitsbl|Ideen|Präsentation)/.test(l)).join("\n") || "(keine)",
    "",
    ctx.unitText ? "## Einordnung in die Unterrichtseinheit\n" + ctx.unitText + "\n" : "",
    "## Didaktische und methodische Überlegungen aus der Planung",
    developed ? clip(developed, 20000) : "(keine weiteren)",
    "",
    "## Anforderungen an die Präsentation",
    "- Aufbau genau entlang des verbindlichen Stundenverlaufs: Titelfolie, kurze Stundenübersicht (Agenda), dann für jede Phase mindestens eine Folie in derselben Reihenfolge und Nummerierung; Phasen nach „--> Nächste Stunde“ als eigener, klar markierter Abschnitt am Ende.",
    "- Jede Arbeitsphase bekommt eine Auftragsfolie: Arbeitsauftrag mit Operatoren, Sozialform (Einzel-, Partner-, Gruppenarbeit, Plenum) als Symbol und Wort, Zeitvorgabe in Minuten, benötigtes Material, erwartetes Ergebnis.",
    "- Leitfragen, Diskussionsfragen und Impulse groß und gut lesbar; Feibeitsblätter mit Titel und Code (groß, gut abschreibbar); Links als kurze Adresse und QR-Code.",
    "- Sicherungsfolien (Tafelbild/Ergebnis), die zunächst leer bzw. mit Platzhaltern beginnen und auf einer Folgefolie die Musterlösung zeigen – keine Lösungen vor den Arbeitsphasen.",
    "- Gestaltung für den Beamer: hoher Kontrast, Schrift mindestens 24 pt (Fließtext) bzw. 36 pt (Überschriften), höchstens 6 Zeilen pro Folie, ruhiges einheitliches Layout, keine Animationen, die für den Inhalt nötig sind (die PDF-Fassung zeigt keine Animationen).",
    "- Altersgerechte Sprache für " + gradeInfo(ctx.klass).text + "; fachlich korrekt; keine erfundenen Quellen, Zitate oder Statistiken (wo nötig: Platzhalter mit Hinweis für die Lehrkraft).",
    "- Sprechernotizen in jeder Folie mit Hinweisen für die Lehrkraft (Impulse, Zeit, Erwartungen).",
    "- Benenne die Dateien sinnvoll, z. B. „" + (ctx.klass || "Klasse") + "_" + subjectName(ctx.subject).replace(/\s+/g, "-") + "_" + (L.topic || L.title || "Stunde").replace(/[^\wÄÖÜäöüß-]+/g, "-").slice(0, 40) + ".pptx“ und dieselbe Bezeichnung als .pdf." +
      connectorHint(ctx).replace("speichere deine Ergebnisse auf Wunsch der Lehrkraft direkt mit `save_schulportal_entry`, `add_text_material` bzw. `propose_feibeitsblatt` in der Plattform", "verändere den Schulportal-Eintrag dabei nicht"),
  ].filter((l) => l !== null && l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- JSON aus KI-Antworten herauslösen ---------- */
export function extractJsonObject(text) {
  const s = String(text == null ? "" : text);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const cand = fence ? fence[1] : s;
  const start = cand.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cand.length; i++) {
    const ch = cand[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") inStr = false; continue; }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(cand.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/* Feibeitsblatt-Entwurf (aus KI oder Connector) in eine einheitliche Form bringen */
export function normalizeFbDraft(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Der Entwurf ist leer.");
  const tasks = (Array.isArray(obj.tasks) ? obj.tasks : Array.isArray(obj.aufgaben) ? obj.aufgaben : []).slice(0, 20).map((t) => {
    const ans = t && (t.antwort || t.answer);
    let answer = { type: "text" };
    if (ans === "foto" || ans === "photo" || (ans && typeof ans === "object" && (ans.type === "photo" || ans.foto === true))) answer = { type: "photo" };
    else if (ans && typeof ans === "object") {
      const cols = (ans.tabelle || ans.columns || []).map((c) => String(c || "").slice(0, 60)).filter(Boolean).slice(0, 8);
      const rows = Math.min(30, Math.max(1, Number(ans.zeilen || ans.rows) || 3));
      if (cols.length) answer = { type: "table", columns: cols, rows };
    }
    return {
      text: String((t && (t.text || t.aufgabe)) || "").slice(0, 4000),
      material: String((t && t.material) || "").slice(0, 20000),
      solution: answer.type === "photo" ? "" : String((t && (t.ki_auftrag || t.solution || t.auftrag)) || "").slice(0, 4000),   // Fotos ohne KI-Feedback
      answer,
    };
  }).filter((t) => t.text.trim());
  if (!tasks.length) throw new Error("Der Entwurf enthält keine Aufgabe.");
  const esc = obj.escape && typeof obj.escape === "object" ? { id: String(obj.escape.id || "").trim().toLowerCase(), name: String(obj.escape.name || "").replace(/\s+/g, " ").trim().slice(0, 80) } : null;
  return { title: String(obj.title || obj.titel || "Feibeitsblatt").slice(0, 120), tasks, ...(esc && /^[a-z0-9-]{3,60}$/.test(esc.id) && esc.name ? { escape: esc } : {}) };
}
