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
/* ---------- Sitzungscode auf den Folien einer Präsentation (Wunsch der Lehrkraft vom 11.11.2026) ----------
 * Präsentationen sind zeitlos und werden in späteren Sitzungen wiederverwendet. Seit dem 11.11.2026 steht der Sitzungscode nicht mehr auf
 * den Folien: Unterricks zeigt ihn live auf einer eigenen Codefolie (vor Folie 1 und an Platzhalterfolien, siehe codeSlideLines). Für ältere
 * Präsentationen mit dem Code auf den Folien bleibt der stille Rückfall: Beim Erzeugen der Folienbilder (presenter.js) findet Unterricks den
 * Code auf Folie 1 (den größten dort) und ersetzt ihn auf allen Folien durch den Code der aktuellen Sitzung.
 * codesInText: Codes wie formatCode („AEH-4VY“, Bindestrich oder Gedankenstrich), nicht mitten in Wörtern. */
/* auch gesperrt gesetzt: PDF.js fügt bei erweitertem Zeichenabstand (ab etwa 0,1 em) Leerzeichen ein – „A E H - 4 V Y“ */
const CODE_IN_TEXT = /(^|[^A-Za-z0-9])(?:([A-Z0-9]{3})[-\u2010\u2011\u2013\u2014]([A-Z0-9]{3})|([A-Z0-9]) ([A-Z0-9]) ([A-Z0-9]) [-\u2010\u2011\u2013\u2014] ([A-Z0-9]) ([A-Z0-9]) ([A-Z0-9]))(?![A-Za-z0-9])/g;
export function codesInText(s) {
  const out = [];
  for (const m of String(s == null ? "" : s).matchAll(CODE_IN_TEXT)) {
    const code = m[2] ? m[2] + m[3] : m.slice(4, 10).join(""), start = m.index + m[1].length;
    if (isValidCode(code)) out.push({ start, end: m.index + m[0].length, code });
  }
  return out;
}
/* Zeilen einer Seite aus den Textstücken ({str, x, base, w, h, eol, family, font?, mf?}): Stücke auf derselben Grundlinie werden verbunden
   (Leerzeichen bei einer Lücke); je Zeile {base, end, h (größte Schrift), text, map (je Zeichen {x0, x1, h, base, family, font} bzw. null)} –
   in der Reihenfolge des PDF. advance wie bei slideCodeBoxes. */
export function slideTextLines(items, advance) {
  const lines = []; let cur = null;
  for (const it of items || []) {
    if (!it || !it.str || !(it.h > 0) || !Number.isFinite(it.x) || !Number.isFinite(it.base) || !(it.w >= 0)) { if (!it || it.eol || !it.str) cur = null; continue; }
    if (!cur || Math.abs(it.base - cur.base) > it.h * 0.25 || it.x < cur.end - it.h * 0.5) { cur = { base: it.base, end: it.x, h: 0, text: "", map: [] }; lines.push(cur); }
    else if (it.x - cur.end > it.h * 0.2) { cur.text += " "; cur.map.push(null); }
    const n = it.str.length, ws = [];
    for (let i = 0; i < n; i++) { const a = advance ? Number(advance(it.str[i], it.family || "", it.mf || "")) : 1; ws.push(Number.isFinite(a) && a > 0 ? a : 0); }
    let tot = ws.reduce((a, b) => a + b, 0);
    if (!(tot > 0)) { ws.fill(1); tot = n; }
    for (let i = 0, acc = 0; i < n; i++) { const x0 = it.x + (it.w * acc) / tot; acc += ws[i]; cur.text += it.str[i]; cur.map.push({ x0, x1: it.x + (it.w * acc) / tot, h: it.h, base: it.base, family: it.family || "", font: it.font || null }); }
    cur.end = it.x + it.w; cur.h = Math.max(cur.h, it.h);
    if (it.eol) cur = null;
  }
  return lines;
}
/* Textstücke einer Seite in Gerätekoordinaten ({str, x, base, w, h, eol, family}; Reihenfolge wie im PDF) → Zeilen → je Code ein Kasten
   {code, x0, x1, base, h, family}. Stücke auf derselben Grundlinie werden verbunden (ein Code kann in mehreren Stücken stehen).
   advance(Zeichen, family) = relative Breite eines Zeichens (im Browser gemessen) – so liegt der Kasten auch mitten in einem Satz in
   Proportionalschrift richtig; ohne advance gelten alle Zeichen als gleich breit. */
export function slideCodeBoxes(items, advance) {
  const lines = slideTextLines(items, advance);
  const out = [];
  for (const l of lines) for (const c of codesInText(l.text)) {
    const cs = l.map.slice(c.start, c.end).filter(Boolean);
    if (cs.length) out.push({ code: c.code, x0: Math.min(...cs.map((q) => q.x0)), x1: Math.max(...cs.map((q) => q.x1)), base: cs[0].base, h: Math.max(...cs.map((q) => q.h)), family: cs[0].family, font: cs[0].font });
  }
  return out;
}
/* Wo genau steht der alte Code im Bild? d = RGBA-Pixel eines Ausschnitts (Breite rw, Höhe rh), b = Kasten im Ausschnitt {x0, x1, base, h}.
   Hintergrund und Schrift = die zwei Hauptfarben im Band der Großbuchstaben (mit Toleranz zusammengefasst, damit auch ein Verlauf eine
   Gruppe bildet); welche der Hintergrund ist, entscheiden schmale Streifen links, rechts und über dem Code per Mehrheit (stimmt auch in
   knappen Kästchen, auf Verläufen und mitten im Satz). Übermalt werden nur die Buchstaben des Codes: zusammenhängende Schriftflächen, die das mittlere Band
   (0,2–0,45 Schriftgrößen über der Grundlinie) erreichen und deren Mitte im Kasten liegt – Satzzeichen daneben (auch unterschnitten),
   Text darüber, ein Unterstrich und die nächste Zeile bleiben stehen. Ergebnis {bg, fg, thr, share, x, y, w, h (Rechteck um die Maske),
   mask (w × h, 1 = übermalen), inkX, inkW (die Schrift selbst)}; null = an dieser Stelle nicht sicher (Folie bleibt, die Lehrkraft erfährt es). */
export function codeCover(d, rw, rh, b) {
  const h = b.h, base = Math.round(b.base), cx0 = Math.max(0, Math.floor(b.x0)), cx1 = Math.min(rw - 1, Math.ceil(b.x1) - 1);
  const fy0 = Math.max(0, Math.round(base - 0.5 * h)), fy1 = Math.min(rh - 1, Math.round(base - 0.05 * h));
  if (cx1 - cx0 < 2 || fy1 - fy0 < 2) return null;
  const at = (x, y) => (y * rw + x) * 4;
  const dist = (i, c) => Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]);
  // die zwei Hauptfarben im Band der Großbuchstaben (Farben mit Toleranz zusammengefasst – auch ein Verlauf bildet eine Gruppe)
  const band = [];
  for (let y = fy0; y <= fy1; y++) for (let x = cx0; x <= cx1; x++) band.push(at(x, y));
  const groupOf = (pix) => {
    const fach = new Map();
    for (const i of pix) { const k = (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4), e = fach.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += d[i]; e[2] += d[i + 1]; e[3] += d[i + 2]; fach.set(k, e); }
    let best = null;
    for (const e of [...fach.values()].sort((p, q) => q[0] - p[0]).slice(0, 8)) {
      const c = [e[1] / e[0], e[2] / e[0], e[3] / e[0]], near = pix.filter((i) => dist(i, c) <= 40);
      if (!best || near.length > best.length) best = near;
    }
    return best && best.length ? [0, 1, 2].map((k) => best.reduce((s2, i) => s2 + d[i + k], 0) / best.length) : null;
  };
  const A = groupOf(band);
  const B = A && groupOf(band.filter((i) => dist(i, A) > 80));
  if (!B) return null;   // nur eine Farbe: keine erkennbare Schrift (z. B. Code nur in der Textebene)
  // welche ist der Hintergrund? Abstimmung dreier Stellen ohne Schrift: schmale Streifen links und rechts des Codes und einer über
  // den Großbuchstaben (in einem knappen Kästchen liegt einer davon schon draußen – dann entscheiden die anderen)
  const vote = (pix) => { let a = 0, bb = 0; for (const i of pix) { const da = dist(i, A), db = dist(i, B); if (da <= 40 && da < db) a++; else if (db <= 40) bb++; } return a > bb ? 1 : bb > a ? -1 : 0; };
  const strip = (xa, xb, ya, yb) => { const out = []; for (let y = Math.max(0, ya); y <= Math.min(rh - 1, yb); y++) for (let x = Math.max(0, xa); x <= Math.min(rw - 1, xb); x++) out.push(at(x, y)); return out; };
  const g1 = Math.max(1, Math.round(0.02 * h)), g2 = Math.max(g1 + 1, Math.round(0.08 * h));
  const votes = vote(strip(cx0 - g2, cx0 - g1, fy0, fy1)) + vote(strip(cx1 + g1, cx1 + g2, fy0, fy1)) + vote(strip(cx0, cx1, Math.round(base - 0.9 * h), Math.round(base - 0.78 * h)));
  const aShare = band.filter((i) => dist(i, A) <= 40).length, bShare = band.filter((i) => dist(i, B) <= 40).length;
  const first = votes > 0 || (votes === 0 && aShare >= bShare) ? A : B;
  // Buchstaben unter einer Annahme (bg, fg): zusammenhängende Schriftflächen im Suchfenster (8er-Nachbarschaft), die das mittlere Band
  // (0,2–0,45 Schriftgrößen über der Grundlinie) erreichen und deren Mitte im Kasten liegt
  // Suchfenster mit Platz für Schein oder Schatten ringsum (der Ausschnitt aus paintCode reicht 0,6 Schriftgrößen weiter)
  const wx0 = Math.max(0, cx0 - Math.round(0.55 * h)), wx1 = Math.min(rw - 1, cx1 + Math.round(0.55 * h)), wy0 = Math.max(0, Math.round(base - 1.35 * h)), wy1 = Math.min(rh - 1, Math.round(base + 0.65 * h));
  const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1, midA = base - 0.45 * h - wy0, midB = base - 0.2 * h - wy0;
  const glyphs = (bg, fg) => {
    const far = Math.hypot(fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]);
    if (far < 40) return null;
    const thr = Math.max(30, far * 0.35);
    const isInkAt = (i) => { const a2 = dist(i, bg); return a2 > thr && dist(i, fg) < a2; };
    let ink = 0, third = 0;
    for (let y = fy0; y <= fy1; y++) for (let x = cx0; x <= cx1; x++) { const i = at(x, y); if (isInkAt(i)) ink++; else if (dist(i, bg) > thr) third++; }
    const all = (fy1 - fy0 + 1) * (cx1 - cx0 + 1), share = ink / all;
    // eine dritte Farbe hinter der Schrift (z. B. Textmarker nur unten, zweifarbiger Grund) – dann ist der Grund nicht ruhig: lieber nicht
    if (share < 0.03 || share > 0.6 || third / all > 0.12) return null;
    const lab = new Int32Array(ww * wh), inkW = new Uint8Array(ww * wh), keep = [], stack = [];
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) if (isInkAt(at(wx0 + x, wy0 + y))) inkW[y * ww + x] = 1;
    let n = 0;
    for (let s0 = 0; s0 < ww * wh; s0++) {
      if (!inkW[s0] || lab[s0]) continue;
      n++; lab[s0] = n; stack.push(s0);
      let minx = ww, maxx = -1, miny = wh, maxy = -1, mid = false;
      const px = [];
      while (stack.length) {
        const q = stack.pop(), qx = q % ww, qy = (q - qx) / ww; px.push(q);
        if (qx < minx) minx = qx; if (qx > maxx) maxx = qx; if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
        if (qy >= midA && qy <= midB) mid = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
          const r2 = ny * ww + nx; if (inkW[r2] && !lab[r2]) { lab[r2] = n; stack.push(r2); }
        }
      }
      const mx = wx0 + (minx + maxx) / 2;
      // ein Buchstabe des Codes ist höchstens etwa eine Schriftgröße hoch und reicht nie bis an den oberen oder unteren Rand des
      // Suchfensters (sonst: Rahmen, Kachel- oder Tabellenlinie, Bild)
      if (mid && mx >= cx0 - 0.1 * h && mx <= cx1 + 0.1 * h && maxy - miny < 1.0 * h && miny > 0 && maxy < wh - 1 && maxx - minx <= cx1 - cx0 + 0.4 * h) keep.push({ minx, maxx, miny, maxy, px });
    }
    // dünne Rahmen und Linien um bzw. unter dem Code (breit oder um einen Buchstaben herum, aber kaum gefüllt) bleiben stehen
    const holds = (q) => keep.some((o) => o !== q && (o.minx + o.maxx) / 2 > q.minx && (o.minx + o.maxx) / 2 < q.maxx && (o.miny + o.maxy) / 2 > q.miny && (o.miny + o.maxy) / 2 < q.maxy);
    for (let k = keep.length - 1; k >= 0; k--) {
      const q = keep[k], bw = q.maxx - q.minx + 1, fill = q.px.length / (bw * (q.maxy - q.miny + 1));
      if ((bw > 1.3 * h && fill < 0.2) || (fill < 0.12 && holds(q))) keep.splice(k, 1);
    }
    if (!keep.length) return null;
    // sieht das wie Buchstaben aus? mehrere Teile, keins breiter als zwei Zeichen (sonst ist es ein Kästchen, ein Balken oder die
    // Annahme ist vertauscht)
    const widest = Math.max(...keep.map((k) => k.maxx - k.minx + 1));
    const letters = keep.length >= 3 && widest <= Math.max(1.3 * h, 0.4 * (cx1 - cx0 + 1));
    return { bg, fg, thr, share, keep, letters, isInkAt };
  };
  const second = first === A ? B : A;
  let g = glyphs(first, second.map(Math.round));
  if (!g || !g.letters) { const g2 = glyphs(second, first.map(Math.round)); if (g2 && g2.letters) g = g2; }
  if (!g || !g.letters) return null;   // weder so noch vertauscht Buchstaben – lieber nicht übermalen
  const { fg, thr, share, keep, isInkAt } = g;
  // echter Hintergrund weiter außen (über und unter dem Code, Median): Leuchten oder Schatten färben die Lücken zwischen den Buchstaben,
  // dann wäre der Schein selbst „Hintergrund“ und bliebe als Geisterschrift stehen
  let bg = g.bg;
  {
    const far0 = Math.hypot(fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]), outer = [];
    for (const [ya, yb] of [[base - 1.2 * h, base - 1.05 * h], [base + 0.3 * h, base + 0.45 * h]])
      for (let y = Math.max(wy0, Math.round(ya)); y <= Math.min(wy1, Math.round(yb)); y++) for (let x = cx0; x <= cx1; x += 3) outer.push(at(x, y));
    if (outer.length >= 20) {
      const med = [0, 1, 2].map((k) => { const v = outer.map((i) => d[i + k]).sort((p, q) => p - q); return v[v.length >> 1]; });
      if (Math.hypot(med[0] - bg[0], med[1] - bg[1], med[2] - bg[2]) < far0 * 0.25) bg = med;   // nur eine leichte Abweichung (Schein), kein anderer Grund (Kästchen)
    }
  }
  const kx0 = wx0 + Math.min(...keep.map((k) => k.minx)), kx1 = wx0 + Math.max(...keep.map((k) => k.maxx));
  if (kx1 - kx0 < (cx1 - cx0) * 0.5) return null;   // nur ein Teil des Codes gefunden – lieber nicht
  // Maske im Suchfenster: die Buchstaben, 2 px Rand (Kantenglättung) und weicher Schein oder Schatten, der an ihnen hängt (deutlich anders
  // als der Hintergrund, aber keine Schrift – so bleibt Text daneben stehen), höchstens 0,15 Schriftgrößen weit
  const far = Math.hypot(fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]), soft = Math.max(18, far * 0.12);
  const grow = (reach) => {
    const m2 = new Uint8Array(ww * wh), seen = new Int16Array(ww * wh).fill(-1), queue = [];
    for (const k of keep) for (const q of k.px) { m2[q] = 1; seen[q] = 0; queue.push(q); }
    for (let qi = 0; qi < queue.length; qi++) {
      const q = queue[qi], qx = q % ww, qy = (q - qx) / ww, dd = seen[q];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
        const r2 = ny * ww + nx; if (seen[r2] >= 0) continue;
        const i = at(wx0 + nx, wy0 + ny), near = dd + 1 <= 2, glow = dd + 1 <= reach && dist(i, bg) > soft && !isInkAt(i);
        if (near || glow) { seen[r2] = dd + 1; m2[r2] = 1; queue.push(r2); }
      }
    }
    return m2;
  };
  // Geht der Schein über die Grenze hinaus weiter (Leuchten)? Dann ist das Pixel direkt über der Maske noch kein Hintergrund und wird nach
  // außen hin weiter schwächer – bei einem Verlauf ändert es sich dort kaum, eine Zeile darüber liegt hinter Hintergrund. Dann ausdehnen.
  const haloOut = (m2) => {
    let cols = 0, halo = 0;
    for (let xx = 0; xx < ww; xx++) {
      let t = -1; for (let yy = 0; yy < wh; yy++) if (m2[yy * ww + xx]) { t = yy; break; }
      if (t < 8) continue;
      cols++;
      const p1 = at(wx0 + xx, wy0 + t - 1), p4 = at(wx0 + xx, wy0 + t - 4);
      if (dist(p1, bg) > soft && Math.hypot(d[p1] - d[p4], d[p1 + 1] - d[p4 + 1], d[p1 + 2] - d[p4 + 2]) > soft / 3) halo++;
    }
    return cols > 0 && halo > cols * 0.3;
  };
  let m = grow(Math.max(2, Math.round(0.15 * h)));
  if (haloOut(m)) { m = grow(Math.max(2, Math.round(0.45 * h))); if (haloOut(m)) return null; }   // Schein ohne Ende (z. B. auf einem Verlauf) – lieber nicht
  let mx0 = ww, mx1 = -1, my0 = wh, my1 = -1;
  for (let q = 0; q < m.length; q++) if (m[q]) { const qx = q % ww, qy = (q - qx) / ww; if (qx < mx0) mx0 = qx; if (qx > mx1) mx1 = qx; if (qy < my0) my0 = qy; if (qy > my1) my1 = qy; }
  const x = wx0 + mx0, y = wy0 + my0, w = mx1 - mx0 + 1, hh = my1 - my0 + 1, mask = new Uint8Array(w * hh);
  for (let yy = 0; yy < hh; yy++) for (let xx = 0; xx < w; xx++) mask[yy * w + xx] = m[(my0 + yy) * ww + mx0 + xx];
  return { bg, fg, thr, share, x, y, w, h: hh, mask, inkX: kx0, inkW: kx1 - kx0 + 1 };
}
/* Füllung für die Maske aus codeCover: je Spalte zwischen Hintergrundpixeln darüber und darunter verlaufend (auch Farbverläufe und
   Bilder bleiben ruhig). Stützpunkte = Median einiger Zeilen mit Abstand zur Schrift (keine Kantenglättung), nur Pixel nahe am Hintergrund,
   waagerecht geglättet. Pixel außerhalb der Maske bleiben, wie sie sind. → RGBA-Pixel des Rechtecks (c.w × c.h). */
export function coverFill(d, rw, rh, c) {
  const out = new Uint8ClampedArray(c.w * c.h * 4);
  for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) { const o = (yy * c.w + xx) * 4, i = ((c.y + yy) * rw + c.x + xx) * 4; out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; out[o + 3] = 255; }
  // Toleranz wie die Schwelle zur Schrift: Bei Leuchten ist der geschätzte Hintergrund zu hell, die Pixel ringsum sind der echte
  const tol = Math.max(14, c.thr), med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const anchor = (x, y0, dir) => {
    const r = [], g = [], bl = [];
    for (let k = 3; k <= 8; k++) {
      const y = y0 + dir * k; if (y < 0 || y >= rh) continue;
      const i = (y * rw + x) * 4;
      if (Math.hypot(d[i] - c.bg[0], d[i + 1] - c.bg[1], d[i + 2] - c.bg[2]) <= tol) { r.push(d[i]); g.push(d[i + 1]); bl.push(d[i + 2]); }
    }
    return r.length >= 2 ? [med(r), med(g), med(bl)] : null;
  };
  const cols = [];
  for (let xx = 0; xx < c.w; xx++) {
    let t = -1, bo = -1;
    for (let yy = 0; yy < c.h; yy++) if (c.mask[yy * c.w + xx]) { if (t < 0) t = yy; bo = yy; }
    cols.push(t < 0 ? null : { t, bo, top: anchor(c.x + xx, c.y + t, -1), bot: anchor(c.x + xx, c.y + bo, 1) });
  }
  const smooth = (xx, key) => {
    const r = [], g = [], bl = [];
    for (let k = Math.max(0, xx - 3); k <= Math.min(c.w - 1, xx + 3); k++) { const v = cols[k] && cols[k][key]; if (v) { r.push(v[0]); g.push(v[1]); bl.push(v[2]); } }
    return r.length ? [med(r), med(g), med(bl)] : null;
  };
  for (let xx = 0; xx < c.w; xx++) {
    const col = cols[xx]; if (!col) continue;
    const top = smooth(xx, "top"), bot = smooth(xx, "bot"), A = top || bot || c.bg, B = bot || top || c.bg, span = col.bo - col.t + 1;
    for (let yy = col.t; yy <= col.bo; yy++) {
      if (!c.mask[yy * c.w + xx]) continue;
      const f = (yy - col.t + 0.5) / span, o = (yy * c.w + xx) * 4;
      out[o] = A[0] + (B[0] - A[0]) * f; out[o + 1] = A[1] + (B[1] - A[1]) * f; out[o + 2] = A[2] + (B[2] - A[2]) * f;
    }
  }
  return out;
}
/* Schrift des alten Codes (Angaben von PDF.js: Name, fett, kursiv, Ersatzfamilie) → {mono, serif, bold, italic}; bold null = unbekannt */
export function codeFontStyle(f) {
  const name = String((f && (f.name || f.loadedName)) || ""), fam = String((f && (f.fallbackName || f.family)) || "");
  const mono = /mono|courier|consol|menlo|code|typewriter/i.test(name) || /mono/i.test(fam);
  const serif = !mono && (/serif|times|georgia|cambria|caladea|garamond|palatino|book|roman/i.test(name.replace(/sans/gi, "")) && !/sans/i.test(name) || (/serif/i.test(fam) && !/sans/i.test(fam)));
  const bold = f && (f.bold || f.black || /bold|black|heavy|extrabold|semibold|demi/i.test(name)) ? true : f && (f.name || f.loadedName) ? false : null;
  return { mono, serif, bold, italic: !!(f && (f.italic || /italic|oblique/i.test(name))) };
}
/* der Sitzungscode einer älteren Präsentation: der größte Code auf Folie 1 (laut Prompt vor dem 11.11.2026 die Einstiegsfolie, mindestens 96 pt ≈ 18 % der Höhe);
   opt.exclude = Codes, die es sicher nicht sind (verknüpfte Feibeitsblätter), opt.minH = Mindesthöhe (kleine Codes sind es nicht); "" = keiner */
export function slideSessionCode(boxes, opt = {}) {
  const ex = new Set(opt.exclude || []), minH = Number(opt.minH) || 0;
  let b = null;
  for (const x of boxes || []) if (!ex.has(x.code) && x.h >= minH && (!b || x.h > b.h)) b = x;
  return b ? b.code : "";
}

/* ---------- Codefolien (Wunsch der Lehrkraft vom 11.11.2026) ----------
 * Den Sitzungscode zeigt Unterricks live auf einer eigenen Folie (wie „Für den Beamer zeigen“: Code + QR-Code der aktuellen Sitzung) – beim
 * Start der Präsentation vor Folie 1 und überall, wo die PDF eine Platzhalterfolie hat: eine Folie mit der Zeile CODE_SLIDE_MARK. Ihr
 * übriger großer Text (Aufforderung, Materialtitel) wird zur Überschrift der Codefolie; kleine Zeilen (Fußzeile, Seitenzahl), Codes und
 * der Erklärsatz zur Marke entfallen; die Zeilen bleiben, wie sie auf der Folie umbrochen sind. lines = slideTextLines(…) einer Seite, pageH =
 * Höhe der Seite in denselben Einheiten → null (keine Platzhalterfolie) oder die Überschrift (0–4 Zeilen, von oben nach unten). */
export const CODE_SLIDE_MARK = "Unterricks-Codefolie";
export const CODE_SLIDE_LINE = CODE_SLIDE_MARK + ": Hier zeigt Unterricks den QR-Code und den Sitzungscode.";   // so steht sie laut Prompt auf der Folie
export const CODE_SLIDE_LIMITS = { slides: 60, lines: 4, line: 160 };   // Prompt: höchstens drei Zeilen – eine umbrochene mehr geht noch
const MARK_SRC = "u\\s?n\\s?t\\s?e\\s?r\\s?r\\s?i\\s?c\\s?k\\s?s\\s?[-\\u2010\\u2011\\u2013\\u2014]?\\s?c\\s?o\\s?d\\s?e\\s?f\\s?o\\s?l\\s?i\\s?e";   // auch gesperrt gesetzt (PDF.js fügt Leerzeichen ein)
const MARK_RE = new RegExp(MARK_SRC, "i");
const cleanSlideLine = (s, max) => String(s == null ? "" : s).normalize("NFC").replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, " ")
  .replace(/\s+/g, " ").trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, "").trim();
// Erklärsatz zur Marke („Hier zeigt Unterricks den QR-Code und den Sitzungscode.“) – auch umbrochen: Zeilen, die nur ein Stück davon sind
const EXPLAIN = " " + CODE_SLIDE_LINE.slice(CODE_SLIDE_MARK.length).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
const explains = (t) => { const n = String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return n.length > 0 && EXPLAIN.includes(" " + n + " "); };
// gesperrt gesetzt („B E A R B E I T E T  I N …“): PDF.js fügt zwischen den Buchstaben Leerzeichen ein – zusammenziehen, Wortlücken bleiben
const unspace = (t) => {
  const tok = t.trim().split(" ").filter(Boolean);
  if (tok.length < 4 || tok.filter((w) => [...w].length === 1).length < tok.length * 0.7) return t;
  return /\s{2,}/.test(t.trim()) ? t.trim().split(/\s{2,}/).map((w) => w.replace(/\s+/g, "")).join(" ") : t;   // ohne erkennbare Wortlücken bleibt die Sperrung
};
export function codeSlideLines(lines, pageH) {
  const all = (lines || []).filter((l) => l && typeof l.text === "string");
  if (!all.some((l) => MARK_RE.test(l.text))) return null;
  const keep = [];
  for (const l of all) {
    let t = unspace(l.text);
    if (MARK_RE.test(t)) {
      t = t.replace(new RegExp(MARK_SRC, "gi"), " ").replace(/^[\s:·|–—-]+|[\s:·|–—-]+$/g, "");
      if (t.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < 2 || explains(t)) continue;   // Marke allein bzw. mit Erklärsatz
    }
    if ((t.match(/\p{L}/gu) || []).length < 2 || codesInText(t).length || explains(t)) continue;   // Seitenzahl, Code, Stück des Erklärsatzes
    if (/^\s*[„“”"‚‘’'«»]/.test(t) && /[„“”"‚‘’'«»]\s*$/.test(t)) t = t.replace(/^\s*[„“”"‚‘’'«»]+|[„“”"‚‘’'«»]+\s*$/g, "");   // ganz in Anführungszeichen
    const text = cleanSlideLine(t, CODE_SLIDE_LIMITS.line), h = Number(l.h) || 0;
    // doppelt gezeichnet (Schatten, Kontur): dieselbe Zeile fast an derselben Stelle nur einmal
    if (text && !keep.some((k) => k.text === text && Math.abs(k.base - l.base) < 0.35 * Math.max(h, k.h) && Math.abs(k.h - h) < 0.2 * Math.max(h, k.h))) keep.push({ text, base: l.base, h });
  }
  // klein = Fußzeile, Seitenzahl, Quellenangabe: unter 3,2 % der Seitenhöhe (17 pt auf einer 540 pt hohen 16:9-Folie; Fließtext ab 24 pt sind 4,4 %)
  // oder unter 30 % der größten Zeile – nie allein an der größten Zeile gemessen, sonst entfiele die Aufforderung neben einem sehr großen
  // Materialtitel (und auf einer Codefolie ohne Überschrift würde die Fußzeile dazu); ohne Seitenhöhe gilt ein Drittel der größten Zeile
  const maxH = Math.max(0, ...keep.map((l) => l.h));
  const big = keep.filter((l) => (Number(pageH) > 0 ? l.h >= pageH * 0.032 && l.h >= maxH * 0.3 : !(maxH > 0) || l.h >= maxH / 3)).sort((a, b) => a.base - b.base);
  // umbrochene Zeile (gleiche Schriftgröße, direkt darunter, kein Satzende davor) wieder zu einer Zeile zusammenfügen
  const out = [];
  for (const l of big) {
    const p = out[out.length - 1];
    if (p && Math.abs(p.h - l.h) <= 0.1 * Math.max(p.h, l.h) && l.base - p.base > 0 && l.base - p.base <= 1.6 * Math.max(p.h, l.h) && !/[.!?:;]$/.test(p.text))
      Object.assign(p, { text: cleanSlideLine(p.text + " " + l.text, CODE_SLIDE_LIMITS.line), base: l.base });
    else out.push({ ...l });
  }
  return out.slice(0, CODE_SLIDE_LIMITS.lines).map((l) => l.text);
}
/* Codefolien aus fremden Daten (Browser → Server, Server → DO): [{n (1…pages, eindeutig), lines (0–3 Zeilen ≤ 160 Zeichen)}], nach n sortiert */
export function cleanCodeSlides(raw, pages) {
  if (!Array.isArray(raw) || !Number.isInteger(pages) || pages < 1) return [];
  const seen = new Set(), out = [];
  for (const x of raw.slice(0, 300)) {
    const n = x && typeof x === "object" ? x.n : NaN;
    if (!Number.isInteger(n) || n < 1 || n > pages || seen.has(n)) continue;
    const lines = (Array.isArray(x.lines) ? x.lines.slice(0, 10) : []).filter((t) => typeof t === "string").map((t) => cleanSlideLine(t, CODE_SLIDE_LIMITS.line)).filter(Boolean).slice(0, CODE_SLIDE_LIMITS.lines);
    seen.add(n); out.push({ n, lines });
    if (out.length >= CODE_SLIDE_LIMITS.slides) break;
  }
  return out.sort((a, b) => a.n - b.n);
}

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

/* Schüler:innen-Anmeldung: gilt höchstens so lange nach der Passworteingabe (Wunsch der Lehrkraft vom 10.11.2026) – danach erneut das
   Passwort; das Gerät bleibt dasselbe (freigeschaltete Sitzungen, Fach und Klasse und im Browser Gespeichertes bleiben). */
export const STUDENT_LOGIN_MIN = 90;

export const FEIBEITSBLATT_INFO = "Feibeitsblatt ist das digitale Arbeitsblatt-Werkzeug der Lehrkraft: Die Lehrkraft legt Aufgaben (Aufgabenstellung, optional Material) " +
  "und je Aufgabe einen „Auftrag an die KI“ an. Der Auftrag ist KEINE Musterlösung, sondern die Anweisung an die korrigierende KI, worauf sie beim Lesen der Schülerantwort " +
  "achten soll (z. B. erwartete Inhalte, Kriterien, typische Fehler, worauf es nicht ankommt) – damit ihre Rückmeldung den Schüler:innen zeigt, was an ihrer Antwort schon gut ist " +
  "und was sie noch verbessern können. Formuliere ihn als Anweisung („Achte darauf, ob …“, „Weise darauf hin, wenn …“) und miss die Erwartungen an der Jahrgangsstufe " +
  "(z. B. genügen in Jahrgang 7 und 8 einfache, richtige Aussagen in eigenen Worten – keine perfekt differenzierte Lösung); Unterricks ergänzt jeden Auftrag um einen Absatz " +
  "zur altersgemäßen Erwartung der Lerngruppe. Die Schüler:innen öffnen das Blatt mit einem Code, " +
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
    "Regeln: 1–6 Aufgaben mit Operatoren passend zur Jahrgangsstufe; der „ki_auftrag“ ist keine Musterlösung, sondern ein Auftrag an die korrigierende KI: Er beschreibt konkret, " +
    "welche Inhalte, Kriterien und typischen Fehler sie beim Lesen der Antwort beachten soll (als Anweisung formuliert, z. B. „Achte darauf, ob …“), damit ihre Rückmeldung zeigt, " +
    "was schon gut ist und was verbessert werden sollte – ohne den Schüler:innen die Lösung vorzusagen. Die Erwartungen passen zur Jahrgangsstufe (siehe Sitzung): " +
    "z. B. in Jahrgang 7 eine kurze, richtige Antwort in eigenen Worten statt einer fachlich ausdifferenzierten Lösung. Material nur als Text (keine Bilder, keine erfundenen Quellen). Antwortart „text“ ist der Normalfall; eine Tabelle nur, wenn sie didaktisch sinnvoll ist (höchstens 8 Spalten, 30 Zeilen).";
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
  // Der Sitzungscode steht nie im Prompt und nie auf den Folien: Unterricks zeigt ihn selbst auf seiner Codefolie (vor Folie 1 und an jeder
  // Unterricks-Codefolie der PDF, CODE_SLIDE_LINE) – so bleibt die Präsentation zeitlos und zeigt in jeder Sitzung deren Code.
  // Jahrgang 5/6: im Unterricht keine iPads – Material kommt auf Papier (ANALOG_RULE), Materialfolien sind gewöhnliche Folien; die Codefolie
  // vor Folie 1 zeigt Unterricks trotzdem (Sitzung zu Hause finden).
  const analog = isAnalogClass(ctx.klass);
  const where = analog ? "am Beamer" : "am Beamer und live auf den Geräten der Schüler:innen";
  // Beispiel für den Materialtitel: möglichst ein echtes Material dieser Sitzung (kein Notfall-Feibeitsblatt), ohne Dateiendung
  const matName = (area) => { const m = (ctx.materials || []).find((x) => x.area === area && !/^Notfall-Feibeitsblatt/.test(String(x.name || ""))); return m ? String(m.name).replace(/\.[a-z0-9]{2,4}$/i, "") : ""; };
  const exTitle = analog ? (matName("print") || matName("student") || "Arbeitsblatt: <Titel des Arbeitsblatts>") + " (auf Papier)"
    : (ctx.sheets || [])[0] ? "Feibeitsblatt: " + ctx.sheets[0].title : matName("student") || "Arbeitsblatt: <Titel des Arbeitsblatts>";
  return [
    "Erstelle eine vollständige Präsentation (16:9) für die folgende Unterrichtsstunde – direkt als **PDF-Datei**, eine Seite je Folie. Eine PowerPoint-Datei brauche ich nicht: " +
      "Die PDF lade ich in der Unterrichtsplattform Unterricks hoch. Dort läuft sie während des Unterrichts am Beamer" +
      (analog ? " (die Schüler:innen dieser Jahrgangsstufe haben im Unterricht keine iPads)" : " und gleichzeitig live und synchron auf den Geräten der Schüler:innen") + "; " +
      "sie führt die Lehrkraft und die Schülerinnen und Schüler Schritt für Schritt durch die gesamte Stunde. Stelle mir die PDF-Datei zum Herunterladen bereit " +
      "(Text als echter Text, nicht als Bild; Querformat, z. B. 33,867 × 19,05 cm). " +
      "Sitzungscode und QR-Code zu Unterricks gehören nicht in die PDF: Unterricks zeigt beides selbst, immer mit dem Code der Sitzung, in der die Präsentation gerade läuft (siehe „Unterricks-Codefolie“).",
    "",
    "## Folie 1: gestaltete Titelfolie – ohne Sitzungscode und ohne QR-Code",
    "Startet die Lehrkraft die Präsentation, zeigt Unterricks vor Folie 1 automatisch seine Codefolie mit dem Titel der Sitzung, dem Sitzungscode der aktuellen Sitzung und dem QR-Code zu Unterricks – " +
      where + (analog ? " (in dieser Jahrgangsstufe, damit die Schüler:innen die Sitzung zu Hause finden)" : "") + ". Lege dafür keine eigene Folie an. Folie 1 ist die gestaltete Titelfolie der Stunde:",
    "- das Thema bzw. die Leitfrage der Stunde groß, darunter klein das Fach (ohne Klasse und ohne Datum, siehe „Zeitlos gestalten“);",
    "- ein ruhiges, zum Thema passendes Gestaltungselement im Layout der übrigen Folien (z. B. ein Symbol, eine Illustration oder eine Farbfläche);",
    "- kein Sitzungscode, kein QR-Code, keine Adresse von Unterricks und keine Aufforderung, einen Code einzugeben.",
    "",
    "## Sitzungscode noch einmal zeigen: Unterricks-Codefolie",
    "Der Sitzungscode ändert sich mit jeder Sitzung; die Codefolie von Unterricks gibt es in jeder Sitzung und zeigt immer deren Code. Schreibe den Sitzungscode deshalb auf keine Folie – " +
      "auch nicht, wenn du ihn kennst (z. B. aus `get_lesson`) – und zeichne keinen QR-Code zu Unterricks. Wo die Schüler:innen den Sitzungscode noch einmal sehen sollen, setzt du eine " +
      "Unterricks-Codefolie ein: Unterricks erkennt sie beim Hochladen und zeigt im Unterricht an ihrer Stelle – " + where + " – seine Codefolie mit dem Sitzungscode und dem QR-Code der aktuellen Sitzung. " +
      "Eine Unterricks-Codefolie enthält:",
    "- genau diese Zeile als echten Text – unverändert, ohne Anführungszeichen und in einer einzigen Zeile (kein Umbruch, keine Silbentrennung; klein am unteren Rand genügt, im Unterricht ist sie nicht zu sehen): " + CODE_SLIDE_LINE,
    "- darüber höchstens drei kurze Zeilen, die Unterricks wörtlich als Überschrift über den Sitzungscode und den QR-Code setzt (bei Materialfolien die Aufforderung und den Titel des Materials, siehe unten); " +
      "ohne solche Zeilen zeigt Unterricks dort den Titel der Sitzung;",
    "- sonst keinen Text und keine Schrift in Bildern: keine Fußzeile, keine Foliennummer, keinen Code und keinen QR-Code – weiterer Text würde Teil der Überschrift. " +
      "Gestalte die Folie trotzdem im Layout der übrigen Folien: In der PDF, die die Schüler:innen nach der Stunde selbst öffnen können, bleibt sie so stehen.",
    analog ? "In dieser Jahrgangsstufe brauchen die Schüler:innen den Code nur zu Hause: Setze höchstens nach der Hausaufgabe eine Unterricks-Codefolie mit der Überschrift „Zu Hause findest du diese Sitzung in Unterricks.“ ein – Materialfolien sind hier gewöhnliche Folien."
      : "Vor Folie 1 brauchst du keine (die zeigt Unterricks ohnehin). Jede Materialfolie mit Material aus Unterricks ist eine Unterricks-Codefolie (siehe unten); weitere setzt du nur dort ein, " +
        "wo der Code wirklich gebraucht wird – z. B. nach der Hausaufgabe mit der Überschrift „Die Hausaufgabe und das Material findest du in Unterricks.“",
    "",
    "## Materialfolien: " + (analog ? "Aufforderung und Titel des Materials (auf Papier)" : "Unterricks-Codefolie mit Aufforderung und Titel des Materials"),
    "Immer wenn die Schüler:innen laut Stundenverlauf mit einem Material arbeiten sollen (Feibeitsblatt, Arbeitsblatt, Text, Link o. Ä.), bekommt dieser Schritt eine Materialfolie. " +
      (analog ? "In dieser Jahrgangsstufe haben die Schüler:innen im Unterricht keine iPads und bekommen das Material auf Papier – die Materialfolie ist deshalb eine gewöhnliche Folie (keine Unterricks-Codefolie) und zeigt nur:"
        : "Das Material finden die Schüler:innen in Unterricks – die Materialfolie ist deshalb eine Unterricks-Codefolie (siehe oben) und enthält außer der Zeile „" + CODE_SLIDE_MARK + ": …“ nur:"),
    "- die Aufforderung, mit dem Material zu arbeiten, in ein bis zwei kurzen Sätzen an die Schüler:innen gerichtet (mit Sozialform und – wenn der Stundenverlauf sie nennt – den Aufgaben und der Zeit), " +
      "z. B. „Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.“;",
    "- den Titel des Materials groß und genau so, wie das Material in Unterricks heißt (siehe „Materialien und weitere Informationen“ unten; ohne Dateiendung wie „.pdf“), mit der Art davor, z. B. „" + exTitle + "“" +
      (analog ? " – ohne QR-Code, ohne Sitzungscode und ohne Hinweis auf Unterricks." : "."),
    ...(analog ? [] : [
      "Unterricks zeigt Aufforderung und Titel dann als Überschrift über dem Sitzungscode und dem QR-Code der aktuellen Sitzung.",
      "Material, das unten als „von der Lehrkraft auszudrucken“ steht, teilt die Lehrkraft auf Papier aus – in Unterricks sehen die Schüler:innen es nicht. Arbeiten sie in einem Schritt nur mit solchem Material, " +
        "ist die Materialfolie eine gewöhnliche Folie (keine Unterricks-Codefolie): Aufforderung und Titel mit „(auf Papier)“ dahinter, ohne Hinweis auf Unterricks; kommt in Unterricks bereitgestelltes Material dazu, " +
        "bleibt es eine Unterricks-Codefolie, und nur beim ausgedruckten Material steht „(auf Papier)“.",
    ]),
    "Nicht auf die Materialfolie gehören die Aufgaben, Texte und Inhalte des Materials (sie stehen im Material selbst) und Lösungen" + (analog ? "." : " – und auch nicht der Code eines Feibeitsblatts, auch wenn der Stundenverlauf ihn nennt: " +
      "Die Schüler:innen öffnen das Feibeitsblatt in Unterricks, das den Code dabei selbst kopiert; neben dem Sitzungscode, den Unterricks auf der Codefolie zeigt, würden sie zwei Codes leicht verwechseln. " +
      "Notfall-Feibeitsblätter (nur für technische Probleme) nennst du nicht als Material – gemeint ist immer das Feibeitsblatt selbst."),
    analog ? "Steht ein Material, mit dem die Schüler:innen arbeiten sollen, unten nicht als „von der Lehrkraft auszudrucken“, nenne es mir zusätzlich im Chat – dann lege ich es zum Ausdrucken an."
      : "Steht ein Material, mit dem die Schüler:innen arbeiten sollen, unten gar nicht oder nur als Material „nur Lehrkraft“, nenne es mir zusätzlich im Chat – dann stelle ich es in Unterricks bereit.",
    "",
    "## Zeitlos gestalten",
    "Ziel ist eine zeitlose Präsentation: Sie soll auch in ein paar Jahren noch passen, wenn eine andere Klasse dieses Jahrgangs das Thema lernt. Deshalb steht auf den Folien:",
    "- kein Datum, das sich auf diese Lerngruppe bezieht – kein Datum der Stunde, keine Abgabe- oder Prüfungstermine, keine Wochentage („bis Donnerstag“), kein Schuljahr oder Halbjahr mit Jahreszahl; " +
      "Termine nur bezogen auf den Unterricht: Die Hausaufgabe ist „bis zur nächsten Unterrichtssitzung“ zu erledigen, auch wenn im Stundenverlauf oder bei der Hausaufgabe ein Datum steht;",
    "- nicht die Klasse (z. B. „" + (classShort(ctx.klass) || "8c") + "“) und keine Namen von Schüler:innen oder Lehrkräften – wo eine Angabe nötig ist, nur die Lerngruppe allgemein („" + (groupShort(ctx.klass) || "Jg. 8") + "“);",
    "- Zeitgebundenes (z. B. wer gerade regiert, neueste Zahlen) nicht als „aktuell“ oder „derzeit“, sondern mit Jahreszahl und Quelle („Stand " + new Date().getFullYear() + ": …“); fachliche Jahreszahlen und Daten (z. B. historische Ereignisse) bleiben selbstverständlich;",
    "- kein Sitzungscode und kein QR-Code zu Unterricks: Beides gehört zu einer einzigen Sitzung. Unterricks zeigt es selbst – vor Folie 1 und auf jeder Unterricks-Codefolie, immer mit dem Code der aktuellen Sitzung –, " +
      "so passt die Präsentation unverändert in jede spätere Sitzung.",
    "",
    "## Rahmendaten",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + classShort(ctx.klass) + " – " + gradeInfo(ctx.klass).text,
    "- Thema: " + (L.topic || L.title || "(siehe Stundenverlauf)"),
    "- Dauer: " + (L.durationMin ? L.durationMin + " Minuten" : "(nicht angegeben)"),
    "",
    "## Verbindlicher Stundenverlauf (aktueller Schulportal-Eintrag der Lehrkraft – genau diese Fassung gilt, auch wenn ältere Planungen abweichen)",
    "Formatierung im Text: **…** = fett, ~~…~~ = kursiv (Titel, Leitfragen, Codes), Zeilen mit „- “ = Stichpunkte, „--> Nächste Stunde“ = ab hier folgt der Teil für die nächste Stunde.",
    "<<<",
    removeStops(portalText).trim(),
    ">>>",
    L.homework ? "\nHausaufgabe (als letzte Inhaltsfolie zeigen – zu erledigen „bis zur nächsten Unterrichtssitzung“, ohne Datum; danach darf eine Unterricks-Codefolie folgen): " + clip(L.homework, 3000) : "",
    "",
    "## Materialien und weitere Informationen",
    lessonContext(ctx, { portal: false, materialText: true, materialMax: 5000 }).split("\n").filter((l) => /^(- |  |Vorhandene|Feibeitsbl|Ideen|Präsentation)/.test(l)).join("\n") || "(keine)",
    "",
    ctx.unitText ? "## Einordnung in die Unterrichtseinheit\n" + ctx.unitText + "\n" : "",
    "## Didaktische und methodische Überlegungen aus der Planung",
    developed ? clip(developed, 20000) : "(keine weiteren)",
    "",
    "## Anforderungen an die Präsentation",
    "- Aufbau genau entlang des verbindlichen Stundenverlaufs: Folie 1 ist die Titelfolie (siehe oben; die Codefolie davor zeigt Unterricks), dann eine kurze Stundenübersicht (Agenda), dann für jede Phase mindestens eine Folie in derselben Reihenfolge und Nummerierung; Phasen nach „--> Nächste Stunde“ als eigener, klar markierter Abschnitt am Ende.",
    "- Jede Arbeitsphase bekommt eine Auftragsfolie: Arbeiten die Schüler:innen dabei mit Material, ist das die Materialfolie (siehe oben); sonst Arbeitsauftrag mit Operatoren, " +
      "Sozialform (Einzel-, Partner-, Gruppenarbeit, Plenum) als Symbol und Wort, Zeitvorgabe in Minuten und erwartetes Ergebnis.",
    "- Leitfragen, Diskussionsfragen und Impulse groß und gut lesbar; Feibeitsblätter und anderes Material nur mit ihrem Titel auf der Materialfolie; Links, die nicht als Material in Unterricks stehen, " +
      "als kurze Adresse (einen eigenen QR-Code dazu nur deutlich getrennt und mit seinem Ziel beschriftet – nie auf einer Unterricks-Codefolie –, damit ihn niemand mit dem QR-Code zu Unterricks verwechselt).",
    "- Sicherungsfolien (Tafelbild/Ergebnis), die zunächst leer bzw. mit Lücken beginnen und auf einer Folgefolie die Musterlösung zeigen – keine Lösungen vor den Arbeitsphasen.",
    "- Gestaltung für den Beamer: hoher Kontrast, Schrift mindestens 24 pt (Fließtext) bzw. 36 pt (Überschriften), höchstens 6 Zeilen pro Folie (die Zeile „" + CODE_SLIDE_MARK + ": …“ zählt nicht mit und darf kleiner sein), " +
      "ruhiges einheitliches Layout; keine Animationen oder Übergänge (PDF) – was nacheinander erscheinen soll, kommt auf aufeinanderfolgende Folien.",
    "- Altersgerechte Sprache für " + gradeInfo(ctx.klass).text + "; fachlich korrekt; keine erfundenen Quellen, Zitate oder Statistiken (wo nötig: eine gekennzeichnete Lücke mit Hinweis für die Lehrkraft).",
    "- Hinweise für die Lehrkraft (Impulse, Zeit, Erwartungen) je Folie gibst du mir zusätzlich hier im Chat als kurze Liste – eine PDF hat keine Sprechernotizen.",
    "- Benenne die Datei sinnvoll und ebenfalls ohne Klasse und Datum, z. B. „" + (groupShort(ctx.klass) || "Jahrgang").replace(/\.?\s+/g, "-") + "_" + subjectName(ctx.subject).replace(/\s+/g, "-") + "_" + (L.topic || L.title || "Stunde").replace(/[^\wÄÖÜäöüß-]+/g, "-").slice(0, 40) + ".pdf“." +
      connectorHint(ctx).replace("speichere deine Ergebnisse auf Wunsch der Lehrkraft direkt mit `save_schulportal_entry`, `add_text_material` bzw. `propose_feibeitsblatt` in der Plattform",
        "verändere den Schulportal-Eintrag dabei nicht; die Hinweise für die Lehrkraft kannst du auf Wunsch mit `add_text_material` (bereich „lehrkraft“) in der Sitzung ablegen"),
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

/* ---------- Auftrag an die KI (intern „solution“, so heißt das Feld im Feibeitsblatt) ----------
 * Er ist keine Musterlösung, sondern sagt der korrigierenden KI des Feibeitsblatts, worauf sie bei der Rückmeldung achten soll. Das
 * Feibeitsblatt kennt den Jahrgang nicht – deshalb steht die altersgemäße Erwartung im Auftrag selbst (Wunsch der Lehrkraft vom 10.11.2026). */
export const AGE_MARK = "Altersgemäße Erwartung";
export const KI_AUFTRAG_MAX = 8000;   // Grenze des Feibeitsblatts für den Auftrag an die KI
/* Nur ein Maßstab, keine zusätzliche Anforderung: maßgeblich bleibt, was Aufgabe und Operator verlangen (sonst verlangte die KI z. B. eine
   Begründung, wo nur „nennen“ gefragt ist, oder die Checkliste bekäme Punkte wie „Du antwortest in eigenen Worten“). */
export function ageExpectation(klass) {
  const g = gradeInfo(klass);
  if (!g.stufe) return "";
  const who = g.halfYear === "E" ? "Einführungsphase, Jahrgangsstufe 11" : g.halfYear ? g.halfYear + ", " + (g.level === "LK" ? "Leistungskurs" : "Grundkurs") : "Jahrgangsstufe " + g.stufe;
  const age = (a) => "Die Schüler:innen sind etwa " + a + " bis " + (a + 1) + " Jahre alt: ";
  const t = g.stufe <= 6 ? age(g.stufe + 5) + "Einfache, richtige Aussagen in eigenen Worten sind hier eine gute Leistung; erwarte keine Fachsprache."
    : g.stufe <= 8 ? age(g.stufe + 5) + "Einfache, richtige Aussagen in eigenen Worten sind eine gute Leistung; wo eine Begründung oder ein Urteil verlangt ist, genügt ein nachvollziehbarer Grund. " +
      "Erwarte keine vollständige, fachlich ausdifferenzierte Lösung und keine Fachsprache der Oberstufe, und nenne nur Verbesserungen, die in diesem Alter erreichbar sind."
    : g.stufe <= 10 ? age(g.stufe + 5) + "Erste Fachbegriffe und – wo verlangt – nachvollziehbare Begründungen sind eine gute Leistung; Abwägen und Differenzieren genügen in Ansätzen. Lege keine Maßstäbe der Oberstufe an."
    : g.halfYear === "E" ? "Fachbegriffe und – wo verlangt – begründete Zusammenhänge und eigene Urteile in Ansätzen sind eine gute Leistung; das Abiturniveau ist noch nicht der Maßstab."
    : g.level === "LK" ? "Maßstab ist das erhöhte Niveau der Abiturprüfung: fachsprachlich präzise und differenziert; wo ein Urteil verlangt ist, ein eigenständiges, begründetes Urteil."
    : "Maßstab ist das grundlegende Niveau der Abiturprüfung: fachlich korrekt, strukturiert und – wo verlangt – begründet; verlange keine Tiefe auf Leistungskurs-Niveau.";
  return AGE_MARK + " (" + who + "): Das legt nur das Anspruchsniveau fest und ist keine zusätzliche Anforderung und kein eigener Prüfpunkt – maßgeblich ist, " +
    "was Aufgabe und Operator verlangen. " + t;
}
let autoAge = null;   // alle automatisch erzeugten Absätze (jeder Lerngruppe) – sie werden beim Wiederverwenden durch den passenden ersetzt
const isAutoAge = (p) => (autoAge ||= new Set(ALL_CLASSES.map(ageExpectation).filter(Boolean))).has(String(p).trim());
/* Auftrag + altersgemäße Erwartung der Lerngruppe, genau ein Absatz: ein automatisch erzeugter (auch einer anderen Lerngruppe, z. B. aus
   einer Sitzungsdatei) wird ersetzt, einer, den die Lehrkraft geändert hat, bleibt. Leer – oder nur noch der automatische Absatz – bleibt
   leer (= kein KI-Feedback zu dieser Aufgabe). Höchstens KI_AUFTRAG_MAX Zeichen (gekürzt wird der Text der Lehrkraft, nie der Absatz). */
export function withAgeExpectation(solution, klass) {
  let body = String(solution == null ? "" : solution).split(/\n[ \t]*\n/).filter((p) => !isAutoAge(p)).join("\n\n").trim();
  const a = ageExpectation(klass);
  if (!body) return "";
  if (!a || body.includes(AGE_MARK)) return body.slice(0, KI_AUFTRAG_MAX);
  const room = KI_AUFTRAG_MAX - a.length - 2;
  if (body.length > room) body = body.slice(0, room).trimEnd();
  return body + "\n\n" + a;
}
/* liefert eine KI trotzdem eine Musterlösung („Musterlösung: …“), wird daraus ein Auftrag: sinngemäß statt wörtlich.
   Nur für Entwürfe von KI und Connector – was die Lehrkraft schreibt, wird nie umgeschrieben (der Editor warnt nur). */
const SOLUTION_RE = /^\s*(?:mögliche\s+|beispielhafte\s+)?(?:muster)?(?:lösung|antwort)(?:svorschlag)?\s*:\s*/i;
export const looksLikeSolution = (text) => SOLUTION_RE.test(String(text || "")) && !/nicht\s+(?:verraten|vorsagen|nennen)/i.test(String(text || ""));
export function kiAuftragText(text) {
  const t = String(text == null ? "" : text).trim(), m = SOLUTION_RE.exec(t);
  return m && looksLikeSolution(t) && t.length > m[0].length ? "Achte darauf, ob die Antwort diese Inhalte sinngemäß enthält – eigene Worte genügen, nicht wörtlich: " + t.slice(m[0].length) : t;
}

/* Feibeitsblatt-Entwurf (aus KI oder Connector) in eine einheitliche Form bringen */
/* opt.fromAi: Entwurf von einer KI oder vom Connector – eine als „Musterlösung: …“ gelieferte Antwort wird zum Auftrag (kiAuftragText) */
export function normalizeFbDraft(obj, opt = {}) {
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
      solution: answer.type === "photo" ? "" : ((r) => (opt.fromAi ? kiAuftragText(r) : String(r)).slice(0, KI_AUFTRAG_MAX))((t && (t.ki_auftrag || t.solution || t.auftrag)) || ""),   // Fotos ohne KI-Feedback
      answer,
    };
  }).filter((t) => t.text.trim());
  if (!tasks.length) throw new Error("Der Entwurf enthält keine Aufgabe.");
  const esc = obj.escape && typeof obj.escape === "object" ? { id: String(obj.escape.id || "").trim().toLowerCase(), name: String(obj.escape.name || "").replace(/\s+/g, " ").trim().slice(0, 80) } : null;
  return { title: String(obj.title || obj.titel || "Feibeitsblatt").slice(0, 120), tasks, ...(esc && /^[a-z0-9-]{3,60}$/.test(esc.id) && esc.name ? { escape: esc } : {}) };
}
