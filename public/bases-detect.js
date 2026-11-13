// bases-detect.js – Abschnitte in Planungsgrundlagen erkennen (läuft im Browser beim Hochladen; ohne DOM, auch in Node testbar).
// pages = Text je Seite (Index 0 = Seite 1). Ergebnis: { abschnitt: [Seitennummern ab 1] }; die Lehrkraft kann alles korrigieren.

const lines = (t) => String(t || "").split("\n").map((l) => l.trim()).filter(Boolean);
const isToc = (t) => (String(t).match(/\.{6,}/g) || []).length >= 3;   // Inhaltsverzeichnis mit Punktlinien
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

/* Hessische KCGO-Vorlage: 2 Bildungsbeitrag …, 3.2 Bildungsstandards, 3.3 Kurshalbjahre und Themenfelder, dann E1, E2, Q1–Q4 */
export function detectKcgo(pages) {
  const n = pages.length, find = (re, from = 0) => { for (let i = from; i < n; i++) if (!isToc(pages[i]) && lines(pages[i]).some((l) => re.test(l))) return i; return -1; };
  const out = {};
  const ch2 = find(/^2\s+[A-ZÄÖÜ]/), ch3 = find(/^3\s+[A-ZÄÖÜ]/, ch2 + 1), s32 = find(/^3\.2\s+[A-ZÄÖÜ]/), s33 = find(/^3\.3\s+[A-ZÄÖÜ]/);
  if (ch2 >= 0 && ch3 > ch2) out.grundlagen = range(ch2 + 1, ch3);
  if (s32 >= 0 && s33 > s32) out.standards = range(s32 + 1, s33);
  if (s33 >= 0) out.regeln = [s33 + 1];
  // Beginn je Kurshalbjahr: erste Seite mit eigener Überschrift „E1 …“ nach 3.3, Übersichtsseiten (mehrere Halbjahre) überspringen
  const heads = ["E1", "E2", "Q1", "Q2", "Q3", "Q4"], start = {};
  for (let i = Math.max(0, s33); i < n; i++) {
    if (isToc(pages[i])) continue;
    const hy = heads.filter((h) => lines(pages[i]).some((l) => new RegExp("^" + h + "\\s+[A-ZÄÖÜ]").test(l)));
    if (hy.length >= 3) continue;   // Übersicht über alle Kurshalbjahre
    for (const h of hy) if (start[h] === undefined) start[h] = i;
  }
  const found = heads.filter((h) => start[h] !== undefined).sort((a, b) => start[a] - start[b]);
  found.forEach((h, k) => { const end = k + 1 < found.length ? start[found[k + 1]] - 1 : n - 1; out[h] = range(start[h] + 1, Math.max(start[h], end) + 1); });
  return out;
}

/* Abiturerlass: Fachteil beginnt mit einer Zeile „<Fach>“, direkt gefolgt von „N.1 Kursart“, und endet beim nächsten „(N+1).1 Kursart“ */
export function detectErlass(pages, subjectName) {
  const n = pages.length, norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim(), want = norm(subjectName);
  for (let i = 0; i < n; i++) {
    const L = lines(pages[i]);
    if (L.filter((l) => /^\d+\.1\s+Kursart/.test(l)).length > 2) continue;   // Inhaltsverzeichnis
    for (let k = 0; k < L.length - 1; k++) {
      const m = /^(\d+)\.1\s+Kursart/.exec(L[k + 1]);
      if (norm(L[k]) === want && m) {
        const nr = Number(m[1]) + 1, re = new RegExp("^" + nr + "\\.1\\s+Kursart");
        let end = n - 1;
        for (let j = i + 1; j < n; j++) if (lines(pages[j]).some((l) => re.test(l))) { end = j; break; }
        return { fach: range(i + 1, end + 1) };
      }
    }
  }
  return {};
}

/* Schulcurriculum Sek I: Jahrgang je Seite („(8_1) Unterrichtseinheit“, „Jahrgang 6“, „Klasse 9“) – Seiten ohne Angabe gehören zum vorigen Jahrgang */
export function detectCurriculum(pages) {
  const out = {};
  let cur = null;
  pages.forEach((t, i) => {
    const head = lines(t).slice(0, 8).join(" ");
    const m = /\((\d{1,2})_\d+\)/.exec(head) || /\b(?:Jahrgang|Jahrgangsstufe|Klasse|Jg\.)\s*(\d{1,2})\b/.exec(head);
    const g = m && Number(m[1]) >= 5 && Number(m[1]) <= 10 ? String(Number(m[1])) : null;
    // Übersichtsseiten mit mehreren Jahrgängen nicht einem einzelnen Jahrgang zuordnen
    const many = new Set((head.match(/\bJahrgang\s*(\d{1,2})\b/g) || []).map((x) => x.replace(/\D/g, ""))).size > 1;
    if (many) { (out.allgemein = out.allgemein || []).push(i + 1); cur = null; return; }
    if (g) cur = g;
    if (cur) (out[cur] = out[cur] || []).push(i + 1); else (out.allgemein = out.allgemein || []).push(i + 1);
  });
  return out;
}

/* Schulinternes E-Phasen-Curriculum: E1.x / E2.x je Seite */
export function detectECurriculum(pages) {
  const out = {};
  pages.forEach((t, i) => {
    const m = /\bE([12])\.\d\b/.exec(t);
    const k = m ? "E" + m[1] : "alle";
    (out[k] = out[k] || []).push(i + 1);
  });
  return out;
}

/* Schulcurriculum Grundschule (Jahrgänge 1–4): „Jahrgang 2“, „Jahrgangsstufe 3/4“ (dann für 3 und 4), „Klasse 1“, „(2_1)“ –
   Seiten ohne Angabe gehören zum vorigen Jahrgang; Seiten, deren Kopf mehr als zwei Jahrgänge nennt, sind Übersicht (allgemein) */
const GS_HEAD = /\b(?:Jahrgangsstufen?|Jahrgang|Klasse|Jg\.)\s*([1-4])(?:\s*(?:\/|–|-|und)\s*([1-4]))?(?!\d)/;
export function detectGsCurriculum(pages) {
  const out = {}, add = (k, n) => (out[k] = out[k] || []).push(n);
  let cur = null;
  pages.forEach((t, i) => {
    const head = lines(t).slice(0, 8).join(" ");
    const named = new Set();
    for (const m of head.matchAll(new RegExp(GS_HEAD.source, "g"))) { named.add(m[1]); if (m[2]) named.add(m[2]); }
    if (named.size > 2) { add("allgemein", i + 1); cur = null; return; }
    const m = GS_HEAD.exec(head), u = !m && /\(([1-4])_\d+\)/.exec(head);
    if (m) cur = [...new Set([m[1], m[2]].filter(Boolean))].sort();
    else if (u) cur = [u[1]];
    if (cur) cur.forEach((g) => add(g, i + 1)); else add("allgemein", i + 1);
  });
  return out;
}

export function detectSections(kind, subjectName, pages) {
  if (kind === "kcgo") return detectKcgo(pages);
  if (kind === "gs-curriculum") return detectGsCurriculum(pages);
  if (kind === "abiturerlass") return detectErlass(pages, subjectName);
  if (kind === "schulcurriculum") return detectCurriculum(pages);
  if (kind === "e-curriculum") return detectECurriculum(pages);
  return { alle: range(1, pages.length) };
}

/* Seitenangaben „12–24, 31“ ⇄ [12, …, 24, 31] */
export function parseRanges(s, max) {
  const out = new Set();
  for (const part of String(s || "").split(/[,;]+/)) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let k = Math.min(a, b); k <= Math.max(a, b) && k <= (max || 9999); k++) if (k >= 1) out.add(k);
  }
  return [...out].sort((x, y) => x - y);
}
export function formatRanges(nums) {
  const s = [...(nums || [])].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(i === j ? String(s[i]) : s[i] + "–" + s[j]); i = j; }
  return out.join(", ");
}
export const SECTION_LABELS = {
  grundlagen: "Didaktische Grundlagen (Kap. 2)", standards: "Bildungsstandards (3.2)", regeln: "Verbindliche Regelungen (3.3)",
  E1: "E1", E2: "E2", Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4", fach: "Fachteil", allgemein: "Allgemein/Übersicht", alle: "Ganzes Dokument",
};
export const sectionLabel = (k) => SECTION_LABELS[k] || (/^\d+$/.test(k) ? "Jahrgang " + k : k);

/* ---------- Text einer PDF-Seite aus den PDF.js-Textstücken (Zeilenwechsel, wenn sich die Grundlinie ändert) ---------- */
export function pageText(items) {
  let line = "", lastY = null, txt = "";
  for (const it of items || []) {
    if (typeof it.str !== "string") continue;
    const y = it.transform ? Math.round(it.transform[5]) : lastY;
    if (lastY !== null && y !== lastY) { txt += line.trimEnd() + "\n"; line = ""; }
    line += it.str + (it.hasEOL ? "\n" : "");
    lastY = y;
  }
  return (txt + line).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- Arten von Planungsgrundlagen ---------- */
export const BASE_KINDS = {
  schulcurriculum: { label: "Schulcurriculum (Sekundarstufe I)", hint: "Fachcurriculum der Schule für die Jahrgänge 5–10. Die Plattform ordnet die Seiten den Jahrgängen zu (z. B. „(8_1)“ oder „Jahrgang 6“)." },
  kcgo: { label: "Kerncurriculum gymnasiale Oberstufe (KCGO)", hint: "Gilt für E-Phase und Q1–Q4. Die Plattform erkennt Grundlagen, Bildungsstandards, verbindliche Regelungen und die Kurshalbjahre E1–Q4." },
  "e-curriculum": { label: "Schulinternes E-Phasen-Curriculum", hint: "Gilt für die Einführungsphase (E1/E2)." },
  abiturerlass: { label: "Abiturerlass", hint: "Gilt für die Q-Kurse, denen Sie ihn zuordnen (je Abiturjahrgang ein eigener Erlass). Die Plattform sucht den Fachteil heraus; der Erlass darf alle Fächer enthalten." },
  "gs-curriculum": { label: "Schulcurriculum Grundschule (Jahrgänge 1–4)", hint: "Fachcurriculum der Grundschule für die Jahrgänge 1–4. Die Plattform ordnet die Seiten den Jahrgängen zu (z. B. „Jahrgang 2“ oder „Jahrgangsstufe 3/4“ – dann für 3 und 4)." },
  sonstiges: { label: "Sonstige Vorgabe", hint: "z. B. Fachkonferenzbeschluss oder Lehrplan eines anderen Fachs – gilt für die Jahrgänge/Kurse, die Sie auswählen." },
};
export const baseKindLabel = (k) => (BASE_KINDS[k] || {}).label || k;

/* ---------- Welche Seiten einer Grundlage gelten für eine Klasse bzw. einen Kurs? ---------- */
// b = { kind, pages, sections, scope } (sections/scope als Objekt/Array oder JSON-Text, wie in der Datenbank)
const obj = (v, d) => { if (typeof v !== "string") return v == null ? d : v; try { return JSON.parse(v) ?? d; } catch { return d; } };
const gkey = (k) => (/^\d+/.test(k) ? String(parseInt(k, 10)) : k ? k[0] : "");
const halfOf = (k) => (/^Q[1-4]-/.test(k) ? k.slice(0, 2) : k && k[0] === "E" ? "E" : null);
export function wantedSections(b, klass) {
  if (b.kind === "gs-curriculum") return [];   // gilt nur für die Grundschule (wantedGsSections), nie für Klassen des Gymnasiums
  const key = gkey(klass), sec = obj(b.sections, {}), scope = obj(b.scope, []);
  const all = () => range(1, b.pages).map((n) => ({ n, part: "alle" }));
  const pick = (...keys) => keys.flatMap((k) => (sec[k] || []).map((n) => ({ n, part: k })));
  if (b.kind === "schulcurriculum") {
    if (key === "E" || key === "Q") return [];
    if (scope.length && !scope.includes(key)) return [];
    if (sec[key]) return pick(key, "allgemein");
    return Object.keys(sec).some((k) => /^\d+$/.test(k)) ? [] : all();
  }
  if (b.kind === "kcgo") {
    if (key !== "E" && key !== "Q") return [];
    return [...pick("regeln", ...(key === "E" ? ["E1", "E2"] : [halfOf(klass)])), ...pick("grundlagen", "standards")];
  }
  if (b.kind === "e-curriculum") return key === "E" ? (Object.keys(sec).length ? pick("E1", "E2", "alle") : all()) : [];
  if (b.kind === "abiturerlass") {
    if (key !== "Q" || !scope.includes(klass)) return [];
    return sec.fach ? pick("fach") : all();
  }
  return scope.includes(key) || scope.includes(klass) ? all() : [];
}
// Was fehlt für eine Klasse/einen Kurs? (Texte für die Lehrkraft)
export function missingFor(bases, subject, subjectLabel, klass) {
  const key = gkey(klass), out = [], short = String(klass || "").replace("-", " ");
  const has = (kind, f) => bases.some((b) => b.kind === kind && (!f || f(b)));
  if (key === "E" || key === "Q") {
    if (!has("kcgo")) out.push("KCGO " + subjectLabel);
    if (key === "E" && subject === "powi" && !has("e-curriculum")) out.push("schulinternes E-Phasen-Curriculum");
    if (key === "Q" && !has("abiturerlass", (b) => obj(b.scope, []).includes(klass))) out.push("Abiturerlass für den Kurs " + short);
  } else if (!bases.some((b) => b.kind === "schulcurriculum" && wantedSections(b, klass).length)) out.push("Schulcurriculum " + subjectLabel + " für Jahrgang " + key);
  return out;
}
/* Grundschule: welche Seiten eines Curriculums (Jahrgänge 1–4) gelten für einen Jahrgang (grade = "1" … "4")? */
export function wantedGsSections(b, grade) {
  const g = String(grade), sec = obj(b.sections, {}), scope = obj(b.scope, []);
  if (scope.length && !scope.includes(g)) return [];
  if (sec[g]) return [g, "allgemein"].flatMap((k) => (sec[k] || []).map((n) => ({ n, part: k })));
  if (Object.keys(sec).some((k) => /^\d+$/.test(k))) return [];
  return range(1, b.pages).map((n) => ({ n, part: "alle" }));
}
// Was fehlt einem Grundschulkurs? Religion: das Schulcurriculum Ev. Religion (Grundschule) für seinen Jahrgang
export function missingForGs(bases, course) {
  if (!course || !course.religion) return [];
  const grade = String(course.grade);
  const has = (bases || []).some((b) => b.kind === "gs-curriculum" && (b.subject === undefined || b.subject === "evrel") && wantedGsSections(b, grade).length);
  return has ? [] : ["Schulcurriculum Ev. Religion (Grundschule) für Jahrgang " + grade];
}
// Gibt es im laufenden (z. B. „2026/27“) oder einem schon angelegten späteren Schuljahr einen Religionskurs dieses Jahrgangs? Nur dann meldet
// die Status-Tabelle bei Ev. Religion „fehlt“ – Kurse früherer Schuljahre zählen nicht (wie „Ihre Kurse“ / „Frühere Schuljahre“ der Übersicht);
// ein Kurs ohne eingetragenes Schuljahr zählt als laufend.
export function gsReligionCourseIn(courses, grade, schoolYear) {
  return (courses || []).some((k) => k && k.religion && String(k.grade) === String(grade) && (!k.schoolYear || !schoolYear || String(k.schoolYear) >= schoolYear));
}
