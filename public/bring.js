// bring.js – „Gegenstände zum Mitbringen“ (Nachtrag 28 vom 15.11.2026, Gymnasium und Grundschule): Gegenstände, die die Lehrkraft für eine Sitzung
// von zu Hause oder aus dem Lehrerzimmer mitbringen muss (z. B. eine Bibel oder einen Beutel), je mit einem Hinweis in höchstens zwei Sätzen, wo in der
// Stunde (Phase) und in welcher Lerngruppe er gebraucht wird. Claude trägt sie beim Planen mit update_lesson (mitbringen) ein, die Lehrkraft auf der
// Sitzungsseite (bringcard.js); die Startseite zeigt die Gegenstände der Sitzungen des nächsten Arbeitstags (und – Nachtrag 33 – der heute noch laufenden
// Sitzungen, je Tag beschriftet) im roten Kasten „Für den nächsten Arbeitstag einpacken“ direkt unter den Druckaufträgen (printnext.js). Reine Funktionen für Browser und Worker: Prüfen, Speicherform, Zusammenfassen für die
// Startseite, Bausteine für Prompt und get_lesson. Nie Daten von Schüler:innen – nur, was die Lehrkraft mitbringt.

export const BRING_LIMITS = { items: 10, item: 60, note: 200, sentences: 2 };
export const BRING_BOX_TITLE = "Für den nächsten Arbeitstag einpacken";
export const BRING_CARD_TITLE = "Mitbringen";

// Steuer- und unsichtbare Formatzeichen entfernen, Leerraum (auch Zeilenumbrüche) zu einem Leerzeichen
const strip = (v) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
export const bringLine = (v) => strip(v).replace(/\s+/g, " ").trim();
/* Vergleichsschlüssel eines Gegenstands (ohne Groß-/Kleinschreibung): „Bibel“ und „bibel“ sind derselbe */
export const bringKey = (item) => bringLine(item).toLocaleLowerCase("de-DE");
/* höchstens n UTF-16-Einheiten, ohne ein Ersatzzeichen-Paar zu zerschneiden */
const cut = (s, n) => { if (s.length <= n) return s; let k = n; const c = s.charCodeAt(k - 1); if (c >= 0xd800 && c <= 0xdbff) k--; return s.slice(0, k); };

/* ---------- Sätze zählen ----------
 * Robuste Regel für „höchstens zwei Sätze“: Satzende ist „!“ oder „?“ bzw. ein Punkt (auch „…“) vor Leerraum und einem Großbuchstaben, einer Ziffer oder
 * dem Textende – nicht nach einer ein- oder zweistelligen Zahl („in der 3. Phase“), einem einzelnen Buchstaben („z. B.“, „S. 12“), einer Abkürzung aus
 * Einzelbuchstaben („z.B.“, „d.h.“) oder einer gängigen Abkürzung („ca.“, „Nr.“, „Mt.“); ein Datum („am 10.11.2026.“) beendet den Satz; ein klein
 * geschriebenes Wort danach („Std. vor“) nie. Folgt eine Zahl, endet der Satz nur nach einem Wort mit Ziffer („8B. 5 Kinder“) – sonst ist es fast
 * immer eine Abkürzung vor einer Nummer („1. Sam. 17“, „Aufg. 3“, „Kap. 2“; Prüfbefund: solche Hinweise wurden als drei Sätze abgewiesen). Text nach
 * dem letzten Satzende zählt als weiterer Satz. Im Zweifel
 * zählt die Regel eher zu wenig als zu viel (sie soll Claude und die Lehrkraft nicht wegen einer Abkürzung abweisen); zusätzlich gilt die Länge. */
const ABBR = new Set(["bzw", "ca", "evtl", "ggf", "usw", "vgl", "nr", "std", "jg", "kl", "kap", "abb", "tab", "bspw", "inkl", "insb", "sog", "dr", "hr", "fr", "min", "max",
  "mo", "di", "mi", "do", "sa", "so", "gen", "ex", "lk", "mt", "mk", "joh", "röm", "kor", "ps", "jes", "apg", "st", "ev", "kath", "rel", "ggü", "zzgl", "ff", "bd", "aufl", "hrsg"]);
export function sentenceEnds(text) {
  const s = bringLine(text), ends = [], re = /[.!?…]+/g;
  for (let m; (m = re.exec(s)); ) {
    let end = m.index + m[0].length;
    while (end < s.length && /["“”„»«’')\]]/.test(s[end])) end++;   // schließende Anführungszeichen und Klammern gehören zum Satz
    const rest = s.slice(end);
    if (rest && !/^\s/.test(rest)) continue;   // „8.30 Uhr“, „z.B.“: mitten im Wort kein Satzende
    const next = rest.trimStart();
    if (!next) { ends.push(end); continue; }
    if (/^\p{Ll}/u.test(next)) continue;   // klein geschrieben weiter: kein Satzende
    if (/[!?]/.test(m[0])) { ends.push(end); continue; }
    // das Wort davor (ohne Klammern und Anführungszeichen): „3“, „z“, „z.B“, „ca“ – kein Satzende; „2026“ (Datum), „8B“, „Erzählung“ – Satzende
    const w = ((s.slice(0, m.index).match(/(\S+)$/) || [])[1] || "").replace(/^[("„“»«'\[]+|[)"“”»«'\]]+$/g, "");
    if (/^\p{N}{1,2}$/u.test(w) || /^\p{L}$/u.test(w) || /^\p{L}(?:\.\p{L})+$/u.test(w) || ABBR.has(w.toLocaleLowerCase("de-DE"))) continue;
    if (/^\p{N}/u.test(next) && !/\p{N}/u.test(w)) continue;   // „Sam. 17“, „Aufg. 3“: Abkürzung vor einer Nummer
    ends.push(end);
  }
  return ends;
}
export function sentenceCount(text) {
  const s = bringLine(text);
  if (!s) return 0;
  const ends = sentenceEnds(s), tail = s.slice(ends.length ? ends[ends.length - 1] : 0);
  return ends.length + (/[\p{L}\p{N}]/u.test(tail) ? 1 : 0);
}
/* die ersten n Sätze (für Daten aus einer Datei: lieber kürzen als ablehnen) */
export function firstSentences(text, n) {
  const s = bringLine(text);
  if (sentenceCount(s) <= n) return s;
  return s.slice(0, sentenceEnds(s)[n - 1]).trim();
}

/* ---------- Prüfen ----------
 * Eingaben (Lehrkraft auf der Sitzungsseite, Claude über den Connector): [{item, note}] → bereinigte Liste; wirft einen Fehler mit deutscher Meldung
 * (Liste, Anzahl, leer, zu lang, mehr als zwei Sätze, doppelt). null/undefined = leere Liste (löschen). */
export function validateBring(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Die Gegenstände zum Mitbringen müssen eine Liste sein.");
  if (raw.length > BRING_LIMITS.items) throw new Error("Höchstens " + BRING_LIMITS.items + " Gegenstände zum Mitbringen je Sitzung.");
  const out = [], seen = new Set();
  raw.forEach((x, i) => {
    const n = i + 1;
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Gegenstand " + n + " ist ungültig.");
    if (typeof x.item !== "string" || !bringLine(x.item)) throw new Error("Gegenstand " + n + ": Bitte angeben, was mitgebracht werden soll.");
    if (x.note != null && typeof x.note !== "string") throw new Error("Gegenstand " + n + ": Der Hinweis muss ein Text sein.");
    const item = bringLine(x.item), note = bringLine(x.note);
    if (item.length > BRING_LIMITS.item) throw new Error("Gegenstand " + n + " („" + cut(item, 40) + "…“) ist zu lang (höchstens " + BRING_LIMITS.item + " Zeichen) – bitte kürzer benennen.");
    if (note.length > BRING_LIMITS.note) throw new Error("Der Hinweis zu „" + item + "“ ist zu lang (" + note.length + " Zeichen, höchstens " + BRING_LIMITS.note + ").");
    if (sentenceCount(note) > BRING_LIMITS.sentences) throw new Error("Der Hinweis zu „" + item + "“ hat mehr als zwei Sätze – bitte in höchstens zwei Sätzen sagen, wo und in welcher Lerngruppe er gebraucht wird.");
    const k = bringKey(item);
    if (seen.has(k)) throw new Error("„" + item + "“ steht doppelt in der Liste.");
    seen.add(k);
    out.push({ item, note });
  });
  return out;
}
/* Fremde bzw. gespeicherte Daten (Sitzungsdatei, Spalte lessons.bring): nie ein Fehler – Ungültiges entfällt, Zu-Langes wird gekürzt (Hinweis auf zwei Sätze) */
export function cleanBring(raw) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= BRING_LIMITS.items) break;
    if (!x || typeof x !== "object" || typeof x.item !== "string") continue;
    const item = cut(bringLine(x.item), BRING_LIMITS.item).trim(), k = bringKey(item);
    if (!item || seen.has(k)) continue;
    seen.add(k);
    let note = firstSentences(typeof x.note === "string" ? x.note : "", BRING_LIMITS.sentences);
    if (note.length > BRING_LIMITS.note) note = cut(note, BRING_LIMITS.note - 1).trimEnd() + "…";
    out.push({ item, note });
  }
  return out;
}

/* ---------- Speicherform (Spalte lessons.bring, JSON) ----------
 * {v:1, rev, items:[{t, w}]} – rev zählt jede Speicherung (der Worker erhöht ihn in derselben Anweisung, BRING_REV_SQL); die Sitzungsseite schickt den
 * Stand mit, auf dem ihre Änderung beruht (bringBase), sonst 409. NULL = nie gesetzt (wie leer, rev 0). */
export const BRING_REV_SQL = "COALESCE(CASE WHEN json_valid(bring) THEN json_extract(bring, '$.rev') END, 0)";
export const bringStore = (items) => JSON.stringify({ v: 1, rev: 0, items: (items || []).map((x) => ({ t: x.item, w: x.note || "" })) });
export function bringRead(raw) {
  let o = null;
  try { o = typeof raw === "string" && raw ? JSON.parse(raw) : null; } catch {}
  if (!o || typeof o !== "object" || Array.isArray(o)) return { rev: 0, items: [] };
  return { rev: Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0, items: cleanBring((Array.isArray(o.items) ? o.items : []).map((x) => ({ item: x && x.t, note: x && x.w }))) };
}

/* ---------- Startseite: Gegenstände der Sitzungen eines Tages ----------
 * sessions wie GET /api/teacher/print-next (in der Reihenfolge der Sitzungen; je Sitzung bring: [{item, note}]). Derselbe Gegenstand in mehreren
 * Sitzungen ergibt EINEN Stichpunkt mit je einem Eintrag pro Sitzung (jeder Hinweis bleibt höchstens zwei Sätze): {key, item, places: [{id, group,
 * time, title, note}]}. group = Lerngruppe wie im Feld der Druckaufträge („PoWi 9D“, „Grundschule Religion 2ab“). */
export function packList(sessions) {
  const map = new Map();
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || typeof s !== "object") continue;
    for (const x of cleanBring(s.bring)) {
      const k = bringKey(x.item);
      if (!map.has(k)) map.set(k, { key: k, item: x.item, places: [] });
      map.get(k).places.push({ id: s.id, group: (s.school === "gs" ? "Grundschule " : "") + bringLine(s.label), time: typeof s.startTime === "string" ? s.startTime : null,
        title: bringLine(s.title), note: x.note });
    }
  }
  return [...map.values()];
}
/* Beschriftung einer Stelle („PoWi 9D, 07:50 Uhr“) und ihr Text (der Hinweis; ohne Hinweis ein Satz mit dem Titel der Sitzung) */
export const placeLabel = (p) => p.group + (p.time ? ", " + p.time + " Uhr" : "");
export const placeText = (p) => p.note || (p.title ? "Gebraucht in der Stunde „" + p.title + "“." : "Gebraucht in dieser Stunde.");

/* ---------- Claude: Prompt „Stunde mit Claude planen“ und get_lesson ---------- */
const WHAT = "Gegenstände, die ich für diese Stunde mitbringen muss – nur, was ich von zu Hause oder aus dem Lehrerzimmer mitnehme (z. B. eine Bibel oder einen Beutel), " +
  "nicht die übliche Ausstattung des Klassenraums";
const HOW = "je Gegenstand `gegenstand` und `wofuer`: in höchstens zwei Sätzen, an welcher Stelle der Stunde (Phase) und in welcher Lerngruppe er gebraucht wird; " +
  "die Liste ersetzt die bisherige aus `get_lesson`";
/* Speicherschritt (Gymnasium in der Form „… → `werkzeug`“, Grundschule „… speicherst du mit …“) – ohne Gegenstände bleibt die Liste leer */
export const bringSaveStep = (gs) => gs
  ? "   - " + WHAT + " (Tafel, Stifte, Scheren, Kleber) und nicht das Material auf meiner Druckliste, speicherst du mit `update_lesson` und `mitbringen` (" + HOW + "). Unterricks zeigt sie mir am Vortag auf der Startseite; braucht die Stunde nichts davon, lass `mitbringen` weg."
  : "   - " + WHAT + " (Tafel, Beamer, iPads) und nicht das Material auf meiner Druckliste → `update_lesson` mit `mitbringen` (" + HOW + "). Unterricks zeigt sie mir am Vortag auf der Startseite; braucht die Stunde nichts davon, lass `mitbringen` weg.";
/* Abschnitt „Mitbringen“ von get_lesson (beide Schulformen; nicht bei einem Ausfall-Eintrag) */
export function bringSection(items) {
  const xs = cleanBring(items);
  const out = ["", "## Mitbringen (Gegenstände, die die Lehrkraft für diese Stunde mitbringen muss)"];
  if (!xs.length) return [...out, "(keine – braucht die Stunde etwas, das die Lehrkraft von zu Hause oder aus dem Lehrerzimmer mitbringen muss (z. B. eine Bibel oder einen Beutel; nicht die übliche Ausstattung des Klassenraums und nicht das Material ihrer Druckliste), " +
    "trage es nach ihrer Freigabe mit update_lesson und mitbringen ein: je Gegenstand in höchstens zwei Sätzen, an welcher Stelle der Stunde (Phase) und in welcher Lerngruppe er gebraucht wird)"];
  return [...out, ...xs.map((x) => "- " + x.item + (x.note ? ": " + x.note : " (ohne Hinweis)")),
    "(Unterricks zeigt sie der Lehrkraft am Vortag auf der Startseite. Ändern mit update_lesson und mitbringen – die Liste ersetzt die bisherige, [] leert sie.)"];
}
