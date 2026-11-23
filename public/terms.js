// terms.js – „Fachbegriffe dieser Sitzung“ (Nachtrag 44, Teil 3 vom 23.11.2026; nur Oberstufe: E-Phase und Q1–Q4): 3 bis 8 Fachbegriffe je Sitzung mit je
// einer kurzen Definition. Claude schreibt sie beim Planen (update_lesson mit fachbegriffe), die Lehrkraft sieht und ändert sie auf der Sitzungsseite
// (termsedit.js); Schüler:innen sehen sie ab 2 Minuten vor dem Ende der Sitzung als Karteikarten (termcards.js) – den Zeitpunkt prüft der Server
// (worker/student.js), vorher liefert er sie nie aus. Reine Funktionen für Browser und Worker: Prüfen, Speicherform, Bausteine für Prompt und get_lesson.
// Eigene Namen (terms, Fachbegriffe): nicht zu verwechseln mit den Bildkarten der Grundschule (cards) und der KI-Begriffshilfe (aiHelp).
import { TERMS_BEFORE_END_MIN, isOberstufe } from "./shared.js";

export const TERMS_LIMITS = { min: 3, max: 8, term: 60, def: 300 };
export const TERMS_TITLE = "Fachbegriffe dieser Sitzung";
export const TERMS_ONLY_OBERSTUFE = "Fachbegriffe dieser Sitzung (Karteikarten) gibt es nur in der Oberstufe (E-Phase, Q1–Q4).";

// Steuer- und unsichtbare Formatzeichen entfernen, Leerraum (auch Zeilenumbrüche) zu einem Leerzeichen – Begriff und Definition sind einzeilig
const strip = (v) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
export const termsLine = (v) => strip(v).replace(/\s+/g, " ").trim();
/* Vergleichsschlüssel eines Begriffs (ohne Groß-/Kleinschreibung): „Gewaltenteilung“ und „gewaltenteilung“ sind derselbe */
export const termsKey = (t) => termsLine(t).toLocaleLowerCase("de-DE");
/* höchstens n UTF-16-Einheiten, ohne ein Ersatzzeichen-Paar zu zerschneiden */
const cut = (s, n) => { if (s.length <= n) return s; let k = n; const c = s.charCodeAt(k - 1); if (c >= 0xd800 && c <= 0xdbff) k--; return s.slice(0, k); };

/* ---------- Prüfen ----------
 * Eingaben (Lehrkraft auf der Sitzungsseite, Claude über den Connector): [{term, definition}] → bereinigte Liste; wirft einen Fehler mit deutscher Meldung
 * (keine Liste, zu wenige oder zu viele, leer, zu lang, doppelt) – nie still gekürzt. null, undefined und [] = leere Liste (löschen); sonst 3 bis 8. */
export function validateTerms(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Die Fachbegriffe müssen eine Liste sein.");
  if (!raw.length) return [];
  if (raw.length < TERMS_LIMITS.min) throw new Error("Bitte mindestens " + TERMS_LIMITS.min + " Fachbegriffe angeben (höchstens " + TERMS_LIMITS.max + ") – oder die Liste ganz leeren.");
  if (raw.length > TERMS_LIMITS.max) throw new Error("Höchstens " + TERMS_LIMITS.max + " Fachbegriffe je Sitzung.");
  const out = [], seen = new Set();
  raw.forEach((x, i) => {
    const n = i + 1;
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Fachbegriff " + n + " ist ungültig.");
    if (typeof x.term !== "string" || !termsLine(x.term)) throw new Error("Fachbegriff " + n + ": Bitte den Begriff angeben.");
    const term = termsLine(x.term);
    if (term.length > TERMS_LIMITS.term) throw new Error("Fachbegriff " + n + " („" + cut(term, 40) + "…“) ist zu lang (höchstens " + TERMS_LIMITS.term + " Zeichen).");
    if (typeof x.definition !== "string" || !termsLine(x.definition)) throw new Error("Fachbegriff " + n + " („" + term + "“): Bitte die Definition angeben.");
    const definition = termsLine(x.definition);
    if (definition.length > TERMS_LIMITS.def) throw new Error("Die Definition zu „" + term + "“ ist zu lang (" + definition.length + " Zeichen, höchstens " + TERMS_LIMITS.def + ") – bitte kürzer fassen.");
    const k = termsKey(term);
    if (seen.has(k)) throw new Error("„" + term + "“ steht doppelt in der Liste.");
    seen.add(k);
    out.push({ term, definition });
  });
  return out;
}
/* Fremde bzw. gespeicherte Daten (Sitzungsdatei, Spalte lessons.terms): nie ein Fehler – Ungültiges (ohne Begriff oder Definition) und Doppeltes entfällt,
   Zu-Langes wird gekürzt, höchstens 8; weniger als 3 bleiben erhalten (Karteikarten gibt es dann eben weniger) */
export function cleanTerms(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= TERMS_LIMITS.max) break;
    if (!x || typeof x !== "object" || typeof x.term !== "string" || typeof x.definition !== "string") continue;
    const term = cut(termsLine(x.term), TERMS_LIMITS.term).trim(), k = termsKey(term);
    let definition = termsLine(x.definition);
    if (!term || !definition || seen.has(k)) continue;
    seen.add(k);
    if (definition.length > TERMS_LIMITS.def) definition = cut(definition, TERMS_LIMITS.def - 1).trimEnd() + "…";
    out.push({ term, definition });
  }
  return out;
}

/* ---------- Speicherform (Spalte lessons.terms, JSON) ----------
 * {v:1, rev, items:[{t, d}]} – rev zählt jede Speicherung (der Worker erhöht ihn in derselben Anweisung, TERMS_REV_SQL); die Sitzungsseite schickt den
 * Stand mit, auf dem ihre Änderung beruht (termsBase), sonst 409. Eine geleerte Liste bleibt als {items: []} stehen (der Stand zählt weiter). NULL = nie gesetzt. */
export const TERMS_REV_SQL = "COALESCE(CASE WHEN json_valid(terms) THEN json_extract(terms, '$.rev') END, 0)";
export const termsStore = (items) => JSON.stringify({ v: 1, rev: 0, items: (items || []).map((x) => ({ t: x.term, d: x.definition })) });
export function termsRead(raw) {
  let o = null;
  try { o = typeof raw === "string" && raw ? JSON.parse(raw) : null; } catch {}
  if (!o || typeof o !== "object" || Array.isArray(o)) return { rev: 0, items: [] };
  return { rev: Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0, items: cleanTerms((Array.isArray(o.items) ? o.items : []).map((x) => ({ term: x && x.t, definition: x && x.d }))) };
}

/* ---------- Sitzung aus Datei laden: was mit den Fachbegriffen geschieht (Satz im Dialog der Sitzungsseite; "" = nichts zu sagen) ----------
 * plan = planSessionImport(…) (lesson.terms, termsDropped), target = Zielsitzung (klass, terms) */
export function termsImportText(plan, target) {
  const xs = plan && plan.lesson && Array.isArray(plan.lesson.terms) ? plan.lesson.terms : [], dropped = plan && plan.termsDropped ? plan.termsDropped : 0;
  if (dropped) return (dropped === 1 ? "Der Fachbegriff aus der Datei wird" : "Die " + dropped + " Fachbegriffe aus der Datei werden") + " nicht übernommen – Karteikarten gibt es nur in der Oberstufe.";
  if (!target || !isOberstufe(target.klass)) return "";
  if (xs.length) return TERMS_TITLE + " (" + xs.map((x) => x.term).join(", ") + ") ersetzen die Liste dieser Sitzung.";
  return Array.isArray(target.terms) && target.terms.length ? "Die Datei enthält keine Fachbegriffe – die bisherigen dieser Sitzung werden gelöscht." : "";
}

/* ---------- Claude: Prompt „Stunde mit Claude planen“ (nur Oberstufe) und get_lesson ---------- */
const HOW = "je `begriff` (höchstens " + TERMS_LIMITS.term + " Zeichen) und `definition`: eine kurze, fachlich korrekte Erklärung in ein bis zwei Sätzen (höchstens " + TERMS_LIMITS.def +
  " Zeichen), verständlich für diese Lerngruppe, als schlichter Text ohne Schulportal-Zeichen";
const SHOWN = "Unterricks zeigt sie den Schüler:innen ab " + TERMS_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung als Karteikarten (vorne der Begriff, hinten die Definition)";
/* Speicherschritt im Prompt „Stunde mit Claude planen“ – nur für Sitzungen der Oberstufe (planning.js prüft die Klasse) */
export const termsSaveStep = () => "   - „" + TERMS_TITLE + "“ → `update_lesson` mit `fachbegriffe`: " + TERMS_LIMITS.min + " bis " + TERMS_LIMITS.max +
  " zentrale Fachbegriffe, die in dieser Stunde eingeführt oder gebraucht werden, " + HOW + "; die Liste ersetzt die bisherige aus `get_lesson`. " + SHOWN +
  ". Ändern wir die Planung später, passe auch die Fachbegriffe an.";
/* Abschnitt „Fachbegriffe dieser Sitzung“ von get_lesson (nur Oberstufe); when = Satz, ab wann die Schüler:innen sie sehen (aus Datum, Beginn und Dauer) */
export function termsSection(items, when = "") {
  const xs = cleanTerms(items);
  const out = ["", "## " + TERMS_TITLE + " (Karteikarten für die Schüler:innen, sichtbar ab " + TERMS_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung)"];
  if (!xs.length) return [...out, "(noch keine – schreibe nach der Freigabe der Lehrkraft " + TERMS_LIMITS.min + " bis " + TERMS_LIMITS.max + " zentrale Fachbegriffe dieser Stunde mit update_lesson und fachbegriffe: " + HOW + ")"];
  return [...out, ...xs.map((x) => "- " + x.term + ": " + x.definition), ...(when ? [when] : []),
    "(Ändern mit update_lesson und fachbegriffe – die Liste ersetzt die bisherige, [] leert sie.)"];
}
