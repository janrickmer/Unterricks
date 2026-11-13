// parents.js – Elternansicht der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): ein geheimer, unerratbarer Link je Sitzung. Wer ihn hat,
// sieht diese Sitzung und die vorherigen Sitzungen desselben Kurses im Schuljahr – jede erst nach ihrem geplanten Ende („noch nicht
// stattgefunden“ vorher). Gespeichert wird nur der SHA-256-Wert des Tokens (zum Nachschlagen) und eine mit SETTINGS_SECRET verschlüsselte
// Kopie (damit die Lehrkraft denselben Link noch einmal kopieren kann). Das Token steht nur im Hash der Adresse und in POST-Rümpfen, nie in
// einem Pfad. Eltern sehen nie Ideen, Verlaufsplan, Chat, Code, Beschreibung des Kurses, Material der Lehrkraft oder Druckvorlagen.
import { HttpError, bad, json, readJson, randomToken, sha256Hex, sealSecret, openSecret, requireSecret, isId, LOCKS, lockedFor, registerFail } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { getLesson } from "./lessons.js";
import { getGsCourse, gsCourseOut } from "./gs.js";
import { downloadUrl } from "./files.js";
import { cardSetUrl } from "./cards.js";
import { GS_SUBJECT, schoolYearOf, parentOpensAt, parentMaterial, planRefs, berlinToday } from "../public/shared.js";

export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const parentHash = (token) => sha256Hex("eltern|v1|" + token);
// Kopfzeilen aller Antworten an Eltern (auch Fehler – index.js setzt sie dort zusätzlich): nie zwischenspeichern, nie in Suchmaschinen
export const PARENT_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const INVALID = "Dieser Link ist ungültig oder wurde von der Lehrkraft erneuert. Bitte fragen Sie die Lehrkraft nach dem aktuellen Link.";
const NOT_ALLOWED = "Diese Unterrichtssitzung gehört nicht zu diesem Link.";
const LOCKED = "Zu viele ungültige Links. Bitte warten Sie 10 Minuten.";
const CARD_TTL = 2 * 3600e3;   // Kartenbilder: Signatur für zwei Stunden (der Betrachter holt bei einem Ladefehler einmal neu)
const MAX_CARD_SETS = 10, MAX_FILES = 40;
const out = (data) => json({ ok: true, ...data }, 200, PARENT_HEADERS);

/* ---------- Zeitliche Reihenfolge der Sitzungen eines Kurses ----------
   a liegt vor b: früheres Datum; am selben Tag frühere Startzeit (wenn beide eine haben), sonst früher angelegt */
function before(a, b) {
  if (a.lesson_date !== b.lesson_date) return String(a.lesson_date || "") < String(b.lesson_date || "");
  if (a.start_time && b.start_time && a.start_time !== b.start_time) return a.start_time < b.start_time;
  return a.created_at < b.created_at;
}
const opensAtOf = (l) => parentOpensAt({ date: l.lesson_date || null, startTime: l.start_time || null, durationMin: l.duration_min });
const isOpen = (l, now) => { const t = opensAtOf(l); return t != null && t <= now; };
// Schuljahr des Ankers (ohne Datum: nur der Anker selbst)
const horizonOf = (anchor) => (anchor.lesson_date ? { from: schoolYearOf(anchor.lesson_date).from, to: anchor.lesson_date } : null);
// gehört t zum Link des Ankers a? (gleicher Kurs, Schuljahr von a, nicht nach a)
function inScope(a, t) {
  if (t.id === a.id) return true;
  if (t.subject !== GS_SUBJECT || t.klass !== a.klass || !t.lesson_date) return false;
  const hz = horizonOf(a);
  return !!hz && t.lesson_date >= hz.from && t.lesson_date <= hz.to && before(t, a);
}
const courseOfRow = (r) => gsCourseOut({ id: r.klass, grade: r.c_grade, classes: r.c_classes, religion: r.c_religion, subject_name: r.c_subject_name });

/* ---------- Dateien, die Eltern zu einer Sitzung sehen (die einzige Prüfung: Nutzlast und /datei) ----------
   PDFs der Kinder und Bildkarten dieser Sitzung und die, auf die ihr Verlaufsplan verweist – Verweise nur auf Dateien früherer Sitzungen
   desselben Kurses (nie auf spätere). Dazu in derselben Runde: Datum der nächsten Sitzung (Hausaufgabe) und ob es vorherige Sitzungen gibt. */
// gilt ein Verweis auf eine Datei der Sitzung t (Datum, Beginn, Anlegezeit) für die Sitzung l? – dieselbe Regel wie die Abfrage in parentFiles
// (für die Antworten des Connectors; Abschlussprüfung F01/F18/F19)
export const refCounts = (t, l) => !!t.lesson_date && !!l.lesson_date && (t.lesson_date !== l.lesson_date ? t.lesson_date < l.lesson_date
  : t.start_time && l.start_time && t.start_time !== l.start_time ? t.start_time < l.start_time : t.created_at < l.created_at);
export async function parentFiles(c, lesson, { prevTo = null } = {}) {
  const refs = planRefs(lesson.portal).all.slice(0, 200);
  const hz = lesson.lesson_date ? schoolYearOf(lesson.lesson_date) : null;
  const [fr, nr] = await c.db.batch([
    c.db.prepare("SELECT f.id, f.lesson_id, f.name, f.area, f.kind, f.mime, f.status, f.source, f.pages, f.size, f.cards, f.card_pages, f.card_img_at, f.pdf_at, f.html_at, f.created_at, " +
      "s.w AS cw, s.h AS ch FROM files f JOIN lessons l ON l.id = f.lesson_id LEFT JOIN slides s ON s.file_id = f.id AND s.n = 1 " +
      "WHERE l.subject='gs' AND l.klass=?1 AND f.kind='file' AND f.mime='application/pdf' AND (f.area='student' OR f.cards IS NOT NULL) " +
      "AND (f.lesson_id=?2 OR (f.id IN (SELECT value FROM json_each(?3)) AND l.lesson_date IS NOT NULL AND (l.lesson_date < ?4 OR (l.lesson_date = ?4 AND " +
      // am selben Tag wie before(): frühere Startzeit, wenn beide eine haben, sonst früher angelegt
      "CASE WHEN COALESCE(l.start_time, '') <> '' AND ?6 <> '' AND l.start_time <> ?6 THEN l.start_time < ?6 ELSE l.created_at < ?5 END)))) " +
      "ORDER BY f.created_at LIMIT 300").bind(lesson.klass, lesson.id, JSON.stringify(refs), lesson.lesson_date || "", lesson.created_at, lesson.start_time || ""),
    c.db.prepare("SELECT (SELECT lesson_date FROM lessons WHERE subject='gs' AND klass=?1 AND id<>?2 AND cancelled=0 AND lesson_date > ?3 ORDER BY lesson_date LIMIT 1) AS next, " +
      "EXISTS(SELECT 1 FROM lessons WHERE subject='gs' AND klass=?1 AND id<>?2 AND lesson_date >= ?4 AND lesson_date <= ?5) AS prev")
      .bind(lesson.klass, lesson.id, lesson.lesson_date || "9999-12-31", hz ? hz.from : "9999-12-31", prevTo || ""),
  ]);
  const rows = fr.results || [], n = (nr.results || [])[0] || {};
  const pm = parentMaterial(lesson.portal, rows, lesson.id);
  const byId = new Map(rows.map((f) => [f.id, f]));
  return { files: pm.files.map((id) => byId.get(id)).slice(0, MAX_FILES), cards: pm.cards.map((id) => byId.get(id)).slice(0, MAX_CARD_SETS), next: n.next || null, hasPrevious: !!n.prev };
}

/* ---------- Nutzlast (öffentlich und Vorschau der Lehrkraft) ---------- */
export async function parentView(c, lesson, course, { preview = false, anchor = lesson } = {}) {
  const opensAt = opensAtOf(lesson);
  const base = { state: "open", ...(preview ? { preview: true } : {}), now: c.now, opensAt,
    ...(anchor.id !== lesson.id ? { anchor: { id: anchor.id, date: anchor.lesson_date || null } } : {}) };
  const lessonInfo = { id: lesson.id, date: lesson.lesson_date || null, startTime: lesson.start_time || null, title: lesson.title || "" };
  // vorherige Sitzungen bis zum Anker – für Eltern höchstens bis heute (spätere sind noch nicht freigeschaltet)
  const today = berlinToday(c.now);
  const prevTo = anchor.lesson_date ? (preview || anchor.lesson_date < today ? anchor.lesson_date : today) : null;
  if (!preview && !isOpen(lesson, c.now)) {
    const pf = prevTo ? await parentFiles(c, { ...lesson, portal: "" }, { prevTo }) : { hasPrevious: false };
    return { ...base, state: "pending", lesson: { id: lesson.id, date: lesson.lesson_date || null }, hasPrevious: pf.hasPrevious };
  }
  const note = String(lesson.parent_note || "").trim();
  if (lesson.cancelled) {
    const pf = await parentFiles(c, { ...lesson, portal: "" }, { prevTo });
    return { ...base, state: "cancelled", course: { label: course.label }, lesson: lessonInfo, ...(note ? { note } : {}), hasPrevious: pf.hasPrevious };
  }
  const pf = await parentFiles(c, lesson, { prevTo });
  const secret = pf.cards.length ? requireSecret(c.env) : null;
  const cards = [];
  for (const f of pf.cards) {
    let texts = [];
    try { const o = typeof f.cards === "string" ? JSON.parse(f.cards) : f.cards; texts = Array.isArray(o && o.texts) ? o.texts.slice(0, 40).map((t) => String(t == null ? "" : t).slice(0, 1200)) : []; } catch {}
    cards.push({ fileId: f.id, name: f.name, img: await cardSetUrl(secret, f.id, CARD_TTL, c.now), w: f.cw || null, h: f.ch || null, pages: f.card_pages || 0, texts });
  }
  const summary = String(lesson.parent_summary || "").trim(), hw = String(lesson.homework || "").trim();
  return { ...base, course: { label: course.label }, lesson: lessonInfo, ...(note ? { note } : {}), ...(summary ? { summary } : {}),
    ...(hw ? { homework: { text: hw, dueDate: pf.next } } : {}), ...(cards.length ? { cards } : {}),
    ...(pf.files.length ? { files: pf.files.map((f) => ({ id: f.id, name: f.name, pages: f.pages ?? null, size: f.size ?? null })) } : {}), hasPrevious: pf.hasPrevious };
}

/* Liste der Sitzungen des Links (neueste zuerst): für Eltern nur freigeschaltete; Vorschau der Lehrkraft ohne Zeitsperre */
async function previousList(c, anchor, course, { preview = false } = {}) {
  const hz = horizonOf(anchor);
  let rows = [anchor];
  if (hz) {
    const r = await c.db.prepare("SELECT id, subject, klass, title, lesson_date, start_time, duration_min, created_at, cancelled FROM lessons WHERE subject='gs' AND klass=?1 " +
      "AND lesson_date >= ?2 AND lesson_date <= ?3 ORDER BY lesson_date DESC, start_time DESC, created_at DESC LIMIT 400").bind(anchor.klass, hz.from, hz.to).all();
    rows = (r.results || []).filter((l) => inScope(anchor, l));
    if (!rows.some((l) => l.id === anchor.id)) rows.unshift(anchor);
  }
  const list = rows.filter((l) => preview || isOpen(l, c.now)).sort((a, b) => (before(a, b) ? 1 : before(b, a) ? -1 : 0));
  return { course: { label: course.label }, schoolYear: anchor.lesson_date ? schoolYearOf(anchor.lesson_date).label : (schoolYearOf(berlinToday(c.now)) || {}).label || null,
    lessons: list.map((l) => ({ id: l.id, date: l.lesson_date || null, startTime: l.start_time || null, title: l.title || "", cancelled: !!l.cancelled, current: l.id === anchor.id })) };
}

/* ---------- Öffentlich: Link prüfen (Sperre je IP vor dem Nachschlagen, nur Fehlversuche zählen) ---------- */
const ANCHOR_SQL = "SELECT l.*, g.grade AS c_grade, g.classes AS c_classes, g.religion AS c_religion, g.subject_name AS c_subject_name FROM lessons l " +
  "JOIN gs_courses g ON g.id = l.klass WHERE l.parent_hash=?1 AND l.subject='gs'";
async function resolveLink(c, body, lessonId = null) {
  const key = "el:ip:" + (await sha256Hex("elip|" + c.ip));
  const ms = await lockedFor(c.db, key, c.now);
  if (ms) throw new HttpError(429, "locked", LOCKED, { retryAfter: Math.ceil(ms / 1000) });
  const token = typeof body.token === "string" ? body.token : "";
  let anchor = null, target = null;
  if (TOKEN_RE.test(token)) {
    const hash = await parentHash(token);
    if (lessonId && lessonId !== "") {
      const [a, t] = await c.db.batch([c.db.prepare(ANCHOR_SQL).bind(hash), c.db.prepare("SELECT * FROM lessons WHERE id=?1").bind(lessonId)]);
      anchor = (a.results || [])[0] || null; target = (t.results || [])[0] || null;
    } else anchor = await c.db.prepare(ANCHOR_SQL).bind(hash).first();
  }
  if (!anchor) {
    const f = await registerFail(c.db, key, LOCKS.parentIp, c.now);
    if (f.locked) throw new HttpError(429, "locked", LOCKED, { retryAfter: Math.ceil(LOCKS.parentIp.lockMs / 1000) });
    throw new HttpError(404, "invalid_link", INVALID);
  }
  const course = courseOfRow(anchor);
  if (lessonId) {
    if (!target || !inScope(anchor, target)) throw new HttpError(403, "not_allowed", NOT_ALLOWED);
  } else target = anchor;
  return { anchor, target, course };
}
const lessonIdOf = (body) => {
  const v = body.lessonId;
  if (v === undefined || v === null || v === "") return null;
  if (!isId(v)) throw new HttpError(403, "not_allowed", NOT_ALLOWED);
  return v;
};
export async function routeParentLesson(c) {
  const body = await readJson(c.request, 2000);
  const lid = lessonIdOf(body);
  const { anchor, target, course } = await resolveLink(c, body, lid);
  return out(await parentView(c, target, course, { anchor }));
}
export async function routeParentPrevious(c) {
  const body = await readJson(c.request, 2000);
  const { anchor, course } = await resolveLink(c, body);
  return out(await previousList(c, anchor, course));
}
export async function routeParentFile(c) {
  const body = await readJson(c.request, 2000);
  const lid = lessonIdOf(body);
  const { target } = await resolveLink(c, body, lid);
  if (!isId(body.fileId) || !isOpen(target, c.now) || target.cancelled) throw new HttpError(404, "not_found", "Diese Datei ist hier nicht (mehr) zu sehen.");
  const pf = await parentFiles(c, target);
  const f = pf.files.find((x) => x.id === body.fileId);
  if (!f) throw new HttpError(404, "not_found", "Diese Datei ist hier nicht (mehr) zu sehen.");
  return out({ url: await downloadUrl(requireSecret(c.env), f, true, 10 * 60e3, c.now) });
}

/* ---------- Lehrkraft: Link holen, anlegen, erneuern; Vorschau ohne Zeitsperre ---------- */
async function gsLesson(c, id) {
  await requireTeacher(c);
  const l = await getLesson(c.db, id);
  if (l.subject !== GS_SUBJECT) throw bad("Nur bei Sitzungen der Grundschule.");
  return l;
}
async function openToken(c, l) {
  if (!l.parent_hash || !l.parent_sealed) return null;
  try {
    const t = await openSecret(requireSecret(c.env), l.parent_sealed);
    return TOKEN_RE.test(t) && (await parentHash(t)) === l.parent_hash ? t : null;
  } catch { return null; }
}
export async function routeTeacherParentLink(c, id) {
  const l = await gsLesson(c, id);
  const opensAt = opensAtOf(l);
  if (c.request.method === "GET") return json({ ok: true, token: await openToken(c, l), opensAt });
  const body = await readJson(c.request, 1000);
  if (body.renew !== true) {
    const t = await openToken(c, l);
    if (t) return json({ ok: true, token: t, opensAt, created: false });
  }
  const secret = requireSecret(c.env);
  const token = randomToken(24), hash = await parentHash(token), sealed = await sealSecret(secret, token);
  // ohne „erneuern“ nur, wenn es noch keinen (lesbaren) Link gab – zwei Klicks gleichzeitig ergeben denselben Link
  const r = await c.db.prepare("UPDATE lessons SET parent_hash=?2, parent_sealed=?3 WHERE id=?1 AND subject='gs' AND (?4 = 1 OR parent_hash IS NULL OR parent_hash=?5)")
    .bind(id, hash, sealed, body.renew === true ? 1 : 0, l.parent_hash || "").run();
  if (!r.meta || !r.meta.changes) {
    const t = await openToken(c, await getLesson(c.db, id));
    if (t) return json({ ok: true, token: t, opensAt, created: false });
    throw new HttpError(409, "link_conflict", "Der Link wurde gerade an anderer Stelle geändert. Bitte noch einmal versuchen.");
  }
  return json({ ok: true, token, opensAt, created: true });
}
// ?anchor=<Sitzung>: Vorschau einer vorherigen Sitzung, aufgerufen aus der Vorschau dieser Sitzung (für „← Zur Sitzung vom …“)
export async function routeTeacherParentPreview(c, id) {
  const l = await gsLesson(c, id);
  const course = gsCourseOut(await getGsCourse(c.db, l.klass));
  const aid = new URL(c.request.url).searchParams.get("anchor");
  let anchor = l;
  if (isId(aid) && aid !== id) {
    const a = await c.db.prepare("SELECT id, subject, klass, lesson_date, start_time, created_at FROM lessons WHERE id=?1").bind(aid).first();
    if (a && a.subject === GS_SUBJECT && a.klass === l.klass) anchor = a;
  }
  return json({ ok: true, ...(await parentView(c, l, course, { preview: true, anchor })) });
}
export async function routeTeacherParentPrevious(c, id) {
  const l = await gsLesson(c, id);
  const course = gsCourseOut(await getGsCourse(c.db, l.klass));
  return json({ ok: true, ...(await previousList(c, l, course, { preview: true })) });
}
