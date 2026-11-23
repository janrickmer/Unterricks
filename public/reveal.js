// reveal.js – Material erscheint live mit seiner Materialfolie (Nachtrag 44, Teil 1 vom 23.11.2026): reine Funktionen ohne Netz und DOM, gemeinsam für
// den Server (worker/student.js filtert das Material der Schüler:innen, worker/live.js vermerkt gezeigte Materialfolien, worker/lessons.js die Freigaben von
// Hand) und die Seiten der Lehrkraft (session.js, materialbox.js, inclass.js zeigen, was noch wartet).
//
// Wunsch der Lehrkraft: Material, mit dem die Schüler:innen arbeiten sollen, wird in ihrer Ansicht erst sichtbar und anklickbar, wenn die
// Live-Präsentation die Folie erreicht, auf der sie dazu aufgefordert werden – ohne Neuladen. Rückfragen beantwortet: Material ohne eigene
// Materialfolie und Sitzungen ohne Live-Präsentation wie bisher sofort; einmal freigegeben bleibt es sichtbar, auch nach der Stunde.
// Entscheidung (Claude): Wird die Folie nie live gezeigt, wird das Material spätestens mit der Präsentation frei (5 Minuten nach dem Ende der Sitzung) –
// wie die Präsentation selbst nur bis zur markierten letzten gezeigten Folie („Bis hier gezeigt“). Dazu kann die Lehrkraft ein wartendes Material jederzeit
// von Hand freigeben (z. B. wenn der Beamer streikt oder sie die Präsentation nicht live zeigt).
//
// Materialfolie = Unterricks-Codefolie der Präsentation (files.code_slides: Folie n und ihre Überschrift), deren Überschrift den Titel eines Materials
// nennt (Präsentations-Prompt: „genau so, wie das Material in Unterricks heißt“). Gezählt werden Material für Schüler:innen (Dateien, Links, Texte) und
// Feibeitsblätter (nicht das Finale eines Escape-Rooms); ein Notfall-Feibeitsblatt folgt seinem Feibeitsblatt. Gezeigte Materialfolien vermerkt das
// Durable Object als Überschrift (lessons.reveals.seen) – zugeordnet wird erst beim Lesen, so passt es auch nach einer neuen Präsentation und für Material,
// das später dazukommt. Freigaben von Hand stehen als Verweis auf das Material in lessons.reveals.refs.
import { normWords, GENERIC_TITLES } from "./sharelib.js";
import { isAnalogClass, lessonTimes, fmtClockBerlin, fmtDayBerlin } from "./shared.js";

// seen/refs: höchstens so viele Einträge je Sitzung (eine Präsentation hat höchstens 60 Codefolien); key: Länge einer Überschrift (4 Zeilen à 160 Zeichen)
export const REVEAL_LIMITS = { seen: 200, refs: 200, key: 700 };
// Verweis auf ein Material: „f:<Datei>“ (Material für Schüler:innen) bzw. „s:<Code>“ (Feibeitsblatt; sein Notfall-Feibeitsblatt folgt ihm)
export const REVEAL_REF_RE = /^(f:[a-f0-9]{16}|s:[A-Z0-9]{6})$/;
// Lehrkraft ohne Schüler:innen in der Sitzung (Selbstlern-Phase, laufende ältere Vertretung): kein Warten – die Lehrkraft zeigt dann keine Präsentation
export const REVEAL_ABSENT = ["aktiv", "selbstlern"];

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/* Überschrift einer Codefolie (Zeilen bzw. Text) → Schlüssel: klein, ohne Satzzeichen, Wörter durch ein Leerzeichen getrennt ("" ohne Text) */
export function revealKeyOf(lines) {
  const t = (Array.isArray(lines) ? lines : [lines]).filter((x) => typeof x === "string").join(" ");
  return normWords(t).trim().slice(0, REVEAL_LIMITS.key).trim();
}

/* lessons.reveals ({v:1, seen:[{k, at}], refs:[{r, at}]} als JSON) tolerant gelesen → {seen, refs} (ungültige und doppelte Einträge entfallen; der frühere gilt) */
export function revealsOf(raw) {
  let o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  const ok = o && typeof o === "object" && !Array.isArray(o);
  const seen = [], keys = new Set(), refs = [], rs = new Set();
  for (const x of ok && Array.isArray(o.seen) ? o.seen.slice(0, REVEAL_LIMITS.seen) : []) {
    const k = x && typeof x.k === "string" ? revealKeyOf(x.k) : "";
    if (!k || keys.has(k) || !Number.isFinite(x.at)) continue;
    keys.add(k); seen.push({ k, at: x.at });
  }
  for (const x of ok && Array.isArray(o.refs) ? o.refs.slice(0, REVEAL_LIMITS.refs) : []) {
    const r = x && typeof x.r === "string" ? x.r : "";
    if (!REVEAL_REF_RE.test(r) || rs.has(r) || !Number.isFinite(x.at)) continue;
    rs.add(r); refs.push({ r, at: x.at });
  }
  return { seen, refs };
}
/* zuletzt freigegeben (gezeigte Materialfolie bzw. von Hand, ms) – 0 ohne. Die Schüler:innen-Seite vergleicht ihn mit revealAt des Durable Objects */
export const revealLast = (raw) => { const r = revealsOf(raw); return [...r.seen, ...r.refs].reduce((m, x) => Math.max(m, x.at), 0); };

/* D1: einen Eintrag an lessons.reveals anhängen – in EINER Anweisung (das Durable Object liest vorher nichts): nur, wenn es ihn dort noch nicht gibt und
   weniger als die Höchstzahl da sind. ?1 = Sitzung, ?2 = Eintrag als JSON, ?3 = Schlüssel bzw. Verweis, ?4 = Höchstzahl. Ein ungültiger bzw. fehlender
   Wert wird dabei zu {v:1}, der jeweils andere Teil (seen bzw. refs) bleibt. RETURNING id: eine Zeile = neu vermerkt, keine = schon da bzw. voll. */
const BASE = (c) => "(CASE WHEN json_valid(" + c + ") AND json_type(" + c + ") = 'object' THEN " + c + " ELSE '{\"v\":1}' END)";
const ARR = (c, p) => "(CASE WHEN json_type(" + BASE(c) + ", '$." + p + "') = 'array' THEN json_extract(" + BASE(c) + ", '$." + p + "') ELSE '[]' END)";
const appendSql = (p, field) => "UPDATE lessons SET reveals = json_set(" + BASE("reveals") + ", '$.v', 1, '$." + p + "', json(" + ARR("reveals", p) + "), '$." + p + "[#]', json(?2)) " +
  "WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM json_each(" + ARR("lessons.reveals", p) + ") WHERE json_extract(value, '$." + field + "') = ?3) " +
  "AND (SELECT COUNT(*) FROM json_each(" + ARR("lessons.reveals", p) + ")) < ?4 RETURNING id";
export const REVEAL_SEEN_SQL = appendSql("seen", "k");   // gezeigte Materialfolie (Durable Object)
export const REVEAL_REF_SQL = appendSql("refs", "r");     // Freigabe von Hand (Lehrkraft)

/* ---------- Zuordnung Überschrift → Material ---------- */
const stripExt = (t) => str(t).replace(/\.(pdf|docx?|pptx?|odt|png|jpe?g|txt|html?)$/i, "");
/* Material, das auf seine Materialfolie warten kann: [{ref, n}] – n = Titel normalisiert. Nie: Finale eines Escape-Rooms, Notfall-Feibeitsblatt (folgt
   seinem Blatt), Material einer Selbstlern-Phase, Anmerkungs-PDF, Material, das (noch) nicht fertig ist. Dateien aus der Datenbank (source, fb_code,
   notes_of) und aus fileOut (source, fbCode, notesOf) gleichermaßen; ohne status gilt „fertig“. */
export function revealItems(files, sheets) {
  const out = [];
  for (const s of Array.isArray(sheets) ? sheets : []) if (s && typeof s.code === "string" && s.code && s.kind !== "escape") out.push({ ref: "s:" + s.code, n: normWords(s.title).trim() });
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f.id !== "string" || f.area !== "student" || f.source === "notfall" || f.source === "selbstlern" || f.notesOf || f.notes_of) continue;
    if (f.status !== undefined && f.status !== null && f.status !== "ready") continue;
    out.push({ ref: "f:" + f.id, n: normWords(stripExt(f.name)).trim() });
  }
  return out;
}
/* Welches Material nennt diese Überschrift (Schlüssel)? Wie isMaterialSlide (sharelib.js): der Titel wörtlich (ab 4 Zeichen) oder alle seine Wörter (mindestens
   zwei) in beliebiger Reihenfolge; allgemeine Titel („Material“, „Aufgaben“ …) nie. Nennt sie mehrere, deren Titel einander enthalten, gilt nur der längste
   („Quelle 2“ ist nicht auch „Quelle“); gleiche Titel (Feibeitsblatt und Datei gleichen Namens) gelten beide. → [{ref, n}] */
export function revealMatches(key, items) {
  const k = revealKeyOf(key);
  if (!k) return [];
  const hay = " " + k + " ", words = new Set(k.split(" "));
  const hit = (Array.isArray(items) ? items : []).filter((it) => {
    if (!it || !it.n || GENERIC_TITLES.has(it.n)) return false;
    if (it.n.replace(/\s/g, "").length >= 4 && hay.includes(" " + it.n + " ")) return true;
    const tok = it.n.split(" ").filter((w) => w.length >= 2);
    return tok.length >= 2 && tok.every((w) => words.has(w));
  });
  return hit.filter((a) => !hit.some((b) => b.n !== a.n && (" " + b.n + " ").includes(" " + a.n + " ")));
}
/* Verweis eines Eintrags der Materialliste: ein Notfall-Feibeitsblatt folgt seinem Feibeitsblatt (files.fb_code bzw. fbCode) */
export const revealRefOf = (f) => (f && f.source === "notfall" ? "s:" + str(f.fbCode || f.fb_code) : "f:" + (f && f.id));

/* ---------- Was die Schüler:innen gerade sehen ----------
   input: klass, absent (Selbstlern-Phase oder laufende ältere Vertretung: die Lehrkraft ist nicht da), times (lessonTimes – ohne Beginn oder Dauer null),
   codeSlides [{n, lines}] der fertigen Präsentation, upTo (markierte letzte gezeigte Folie oder null), files und sheets der Sitzung, reveals
   (lessons.reveals), now.
   → {on, items: Map(ref → {slides: [n], at: ms|null, how: "live"|"hand"|"end"|null, late}), hidden: Set(ref), revealAt}
   on = false (nichts wartet, alles wie bisher): Lehrkraft nicht da, Jahrgang 5/6 (Material auf Papier), ohne Beginn oder Dauer (sonst bliebe es womöglich
   für immer verborgen), ohne Präsentation bzw. ohne Codefolie mit Überschrift. Wartet ein Material, ist es frei, sobald die Lehrkraft es freigibt (how
   "hand") oder eine gezeigte Überschrift es nennt (how "live", at = Zeitpunkt), sonst ab der Freigabe der Präsentation (how "end", 5 Minuten nach dem Ende) –
   aber nur, wenn eine seiner Folien in der freigegebenen Präsentation liegt (bis zur Markierung); bis dahin steht es in hidden (late = die Freigabe der
   Präsentation ist vorbei, das Material bleibt trotzdem verborgen). revealAt = zuletzt freigegeben (0 = nie). */
export function materialGate({ klass, absent = false, times = null, codeSlides = [], upTo = null, files = [], sheets = [], reveals = null, now = Date.now() } = {}) {
  const rv = revealsOf(reveals), revealAt = [...rv.seen, ...rv.refs].reduce((m, x) => Math.max(m, x.at), 0);
  const off = { on: false, items: new Map(), hidden: new Set(), revealAt };
  if (absent || isAnalogClass(klass) || !times || !Number.isFinite(times.presentationAt)) return off;
  const slides = (Array.isArray(codeSlides) ? codeSlides : []).map((c) => ({ n: c && c.n, k: revealKeyOf(c && c.lines) })).filter((c) => Number.isInteger(c.n) && c.k);
  if (!slides.length) return off;
  const items = revealItems(files, sheets), info = new Map();
  for (const c of slides) for (const it of revealMatches(c.k, items)) {
    const x = info.get(it.ref) || { slides: [], at: null, how: null, late: false };
    if (!x.slides.includes(c.n)) x.slides.push(c.n);
    info.set(it.ref, x);
  }
  if (!info.size) return off;
  const earlier = (x, at, how) => { if (x.at === null || at < x.at) { x.at = at; x.how = how; } };
  for (const s of rv.seen) for (const it of revealMatches(s.k, items)) { const x = info.get(it.ref); if (x) earlier(x, s.at, "live"); }
  for (const r of rv.refs) { const x = info.get(r.r); if (x) earlier(x, r.at, "hand"); }
  const hidden = new Set(), ended = now >= times.presentationAt;
  for (const [ref, x] of info) {
    x.slides.sort((a, b) => a - b);
    if (x.at !== null) continue;
    if (ended && x.slides.some((n) => !Number.isInteger(upTo) || n <= upTo)) { x.at = times.presentationAt; x.how = "end"; continue; }
    x.late = ended;
    hidden.add(ref);
  }
  return { on: true, items: info, hidden, revealAt };
}
/* Listen der Schüler:innen ohne das wartende Material (Dateien bzw. Feibeitsblätter) */
export const revealFilterFiles = (files, gate) => (Array.isArray(files) ? files : []).filter((f) => !gate.hidden.has(revealRefOf(f)));
export const revealFilterSheets = (sheets, gate) => (Array.isArray(sheets) ? sheets : []).filter((s) => !gate.hidden.has("s:" + (s && s.code)));

/* Seiten der Lehrkraft: dasselbe aus den Daten von GET …/lessons/:id (lessonOut, fileOut, Feibeitsblätter, Vertretung) – wie der Server es für die
   Schüler:innen rechnet. Ohne Beginn bzw. Dauer, in einer Selbstlern-Phase usw. ist on = false (kein Hinweis). */
export function teacherGate({ lesson, files, sheets, sub = null, now = Date.now() } = {}) {
  const l = lesson || {}, fs = Array.isArray(files) ? files : [];
  const p = fs.find((f) => f && f.area === "presentation" && f.status === "ready") || null;
  const upTo = p && Number.isInteger(p.shownUntil) && p.shownUntil < (p.pages || 0) ? p.shownUntil : null;
  return materialGate({ klass: l.klass, absent: !!sub && REVEAL_ABSENT.includes(sub.status),
    times: lessonTimes({ date: l.date, startTime: l.startTime, durationMin: l.durationMin }), codeSlides: p ? p.codeSlides || [] : [], upTo,
    files: fs, sheets, reveals: l.reveals || null, now });
}

/* ---------- Texte für die Lehrkraft ---------- */
const slideList = (ns) => (ns.length === 1 ? "Folie " + ns[0] : "Folie " + ns.slice(0, -1).join(", ") + " oder " + ns[ns.length - 1]);
const when = (at, now) => (fmtDayBerlin(at) === fmtDayBerlin(now) ? "" : fmtDayBerlin(at) + ", ") + fmtClockBerlin(at) + " Uhr";
/* Stand eines Materials mit Materialfolie (Eintrag aus gate.items) → {text, waiting} oder null (ohne Materialfolie) */
export function revealNote(x, now = Date.now()) {
  if (!x || !Array.isArray(x.slides) || !x.slides.length) return null;
  if (x.how === "live" && Number.isFinite(x.at)) return { text: "Für Schüler:innen sichtbar seit " + when(x.at, now) + " – Materialfolie live gezeigt", waiting: false };
  if (x.how === "hand" && Number.isFinite(x.at)) return { text: "Für Schüler:innen sichtbar seit " + when(x.at, now) + " – von Ihnen freigegeben", waiting: false };
  if (x.how === "end") return { text: "Für Schüler:innen sichtbar seit der Freigabe der Präsentation – die Materialfolie wurde nicht live gezeigt", waiting: false };
  if (x.late) return { text: "Für Schüler:innen verborgen: " + slideList(x.slides) + " (Materialfolie) wurde nicht live gezeigt und liegt hinter der letzten gezeigten Folie", waiting: true };
  return { text: "Erscheint bei den Schüler:innen erst, wenn " + slideList(x.slides) + " (Materialfolie) live gezeigt wird", waiting: true };
}
export const REVEAL_RELEASE = "Jetzt freigeben";
/* Schlüssel des Stands (die kompakte Ansicht zeichnet das Material neu, wenn er sich ändert) */
export const revealStateKey = (gate) => (gate && gate.on ? [...gate.items].map(([ref, x]) => ref + ":" + (x.how || (x.late ? "late" : "-")) + ":" + x.slides.join(",")).sort().join("|") : "");
