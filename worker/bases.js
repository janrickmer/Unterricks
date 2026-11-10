// bases.js – Fach-Einstellungen und Planungsgrundlagen (Schulcurriculum, KCGO, E-Phasen-Curriculum, Abiturerlass je Q-Kurs, Sonstiges).
// Der Text je Seite wird im Browser der Lehrkraft aus der PDF gezogen (PDF.js) und hier gespeichert; die Abschnitte (Kurshalbjahre,
// Jahrgänge, Fachteil des Erlasses) erkennt ebenfalls der Browser (public/bases-detect.js), die Lehrkraft kann sie korrigieren.
import { HttpError, bad, json, readJson, randomId, cleanText, cleanLine, isId, isObj } from "./lib.js";
import { getSetting, setSetting } from "./db.js";
import { requireTeacher } from "./auth.js";
import { SUBJECTS, isValidSubject, subjectName, subjectConfig, isValidClass, gradeKey, Q_COURSES, GRADE_KEYS, COURSE_GRADES, courseKey, courseMembersClean, isCourseSubject, classShort } from "../public/shared.js";
import { BASE_KINDS, wantedSections, missingFor as missingForLabel } from "../public/bases-detect.js";

export const KINDS = Object.fromEntries(Object.entries(BASE_KINDS).map(([k, v]) => [k, v.label]));
const MAX_PAGES = 600, MAX_PAGE_CHARS = 20000, MAX_BASIS_CHARS = 180000;

/* ---------- Fach-Einstellungen ---------- */
export async function loadSubjectConfigs(db) {
  const all = (await getSetting(db, "subjects")) || {};
  return Object.fromEntries(SUBJECTS.map((s) => [s.id, subjectConfig(all, s.id)]));
}
export async function routeSubjectsPublic(c) {
  const cfg = await loadSubjectConfigs(c.db);
  return json({ ok: true, subjects: Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, { grades: v.grades }])) });
}
export async function routeSubjectsGet(c) {
  await requireTeacher(c);
  return json({ ok: true, subjects: await loadSubjectConfigs(c.db) });
}
export async function routeSubjectPut(c, subject) {
  await requireTeacher(c);
  if (!isValidSubject(subject)) throw bad("Unbekanntes Fach.");
  const body = await readJson(c.request, 60000);
  const all = (await getSetting(c.db, "subjects")) || {};
  const cur = subjectConfig(all, subject);
  const next = { ...cur };
  if (Array.isArray(body.grades)) {
    const g = body.grades.filter((x) => GRADE_KEYS.includes(x));
    if (!g.length) throw bad("Bitte mindestens einen Jahrgang wählen.");
    next.grades = GRADE_KEYS.filter((k) => g.includes(k));
  }
  if (isObj(body.gradeNotes)) next.gradeNotes = Object.fromEntries(Object.entries(body.gradeNotes).filter(([k]) => GRADE_KEYS.includes(k)).map(([k, v]) => [k, cleanText(v, 1000).trim()]).filter(([, v]) => v));
  if (typeof body.rules === "string") next.rules = cleanText(body.rules, 8000).trim();
  if (typeof body.complete === "boolean") next.complete = body.complete;
  // Kurse (Ev. Religion, Ethik; Jg. 5–10 und E-Phase): welche Klassen im Kurs des Jahrgangs vertreten sind
  const moved = { lessons: 0, units: 0 }, moves = [];
  if (isObj(body.courses)) {
    if (!isCourseSubject(subject)) throw bad("Kurse über mehrere Klassen gibt es nur in Ev. Religion und Ethik.");
    next.courses = { ...(cur.courses || {}) };
    for (const [g, list] of Object.entries(body.courses)) {
      if (!COURSE_GRADES.includes(g)) throw bad("Kurse über mehrere Klassen gibt es nur in den Jahrgängen 5–10 und in der E-Phase.");
      const members = courseMembersClean(g, list);
      if (!members.length) throw bad("Bitte mindestens eine Klasse für den " + classShort(courseKey(g)) + " wählen.");
      next.courses[g] = members;
      moves.push([courseKey(g), members]);
    }
  }
  delete next.courseMode;   // wird beim Lesen aus dem Fach abgeleitet
  all[subject] = next;
  await setSetting(c.db, "subjects", all);
  // Sitzungen und Einheiten, die bisher in einer dieser Klassen lagen, gehören jetzt zum Kurs (es gibt je Jahrgang nur einen Kurs)
  if (moves.length) {
    const st = moves.flatMap(([k, members]) => [
      c.db.prepare("UPDATE lessons SET klass=?1, updated_at=?4 WHERE subject=?2 AND klass IN (SELECT value FROM json_each(?3))").bind(k, subject, JSON.stringify(members), c.now),
      c.db.prepare("UPDATE units SET klass=?1, updated_at=?4 WHERE subject=?2 AND klass IN (SELECT value FROM json_each(?3))").bind(k, subject, JSON.stringify(members), c.now)]);
    const res = await c.db.batch(st);
    res.forEach((r, i) => { moved[i % 2 ? "units" : "lessons"] += (r.meta && r.meta.changes) || 0; });
  }
  return json({ ok: true, subject: subjectConfig(all, subject), moved });
}

/* ---------- Planungsgrundlagen ---------- */
const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
const baseOut = (b) => ({ id: b.id, subject: b.subject, kind: b.kind, kindLabel: KINDS[b.kind] || b.kind, title: b.title, scope: parseJ(b.scope, []), note: b.note,
  fileName: b.file_name || null, pages: b.pages, sections: parseJ(b.sections, {}), createdAt: b.created_at, updatedAt: b.updated_at });
function cleanScope(kind, raw) {
  const arr = Array.isArray(raw) ? raw.map(String) : [];
  const allowed = kind === "abiturerlass" ? Q_COURSES : [...GRADE_KEYS, ...Q_COURSES];
  return [...new Set(arr.filter((x) => allowed.includes(x)))];
}
function cleanSections(raw, pages) {
  if (!isObj(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    if (!/^[A-Za-z0-9-]{1,20}$/.test(k) || !Array.isArray(v)) continue;
    const nums = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= pages))].sort((a, b) => a - b).slice(0, MAX_PAGES);
    if (nums.length) out[k] = nums;
  }
  return out;
}
async function getBase(db, id) {
  if (!isId(id)) throw new HttpError(404, "not_found", "Diese Planungsgrundlage gibt es nicht (mehr).");
  const b = await db.prepare("SELECT * FROM bases WHERE id=?1").bind(id).first();
  if (!b) throw new HttpError(404, "not_found", "Diese Planungsgrundlage gibt es nicht (mehr).");
  return b;
}
export async function routeBasesList(c) {
  await requireTeacher(c);
  const subject = new URL(c.request.url).searchParams.get("subject");
  const r = subject
    ? await c.db.prepare("SELECT * FROM bases WHERE subject=?1 ORDER BY kind, created_at").bind(subject).all()
    : await c.db.prepare("SELECT * FROM bases ORDER BY subject, kind, created_at").all();
  return json({ ok: true, bases: (r.results || []).map(baseOut) });
}
export async function routeBaseCreate(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 100000);
  if (!isValidSubject(body.subject)) throw bad("Unbekanntes Fach.");
  if (!KINDS[body.kind]) throw bad("Bitte die Art der Planungsgrundlage wählen.");
  const pages = Number(body.pages);
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) throw bad("Die Datei hat keine lesbaren Seiten (oder mehr als " + MAX_PAGES + ").");
  const id = randomId(8);
  await c.db.prepare("INSERT INTO bases(id, subject, kind, title, scope, note, file_name, pages, sections, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)")
    .bind(id, body.subject, body.kind, cleanLine(body.title, 200) || KINDS[body.kind], JSON.stringify(cleanScope(body.kind, body.scope)), cleanText(body.note, 3000).trim(),
      cleanLine(body.fileName, 200) || null, pages, JSON.stringify(cleanSections(body.sections, pages)), c.now).run();
  return json({ ok: true, base: baseOut(await getBase(c.db, id)) });
}
// Seitentexte in Stücken (eine Anfrage bleibt unter 1 MB)
export async function routeBasePages(c, id) {
  await requireTeacher(c);
  const b = await getBase(c.db, id);
  const body = await readJson(c.request, 1000000);
  const from = Number(body.from), texts = Array.isArray(body.texts) ? body.texts : [];
  if (!Number.isInteger(from) || from < 1 || from + texts.length - 1 > b.pages || texts.length > 100) throw bad("Ungültige Seitenangaben.");
  // eine einzige Anweisung für alle Seiten des Stücks (json_each), statt einer Abfrage je Seite
  await c.db.prepare("INSERT INTO base_pages(base_id, n, text) SELECT ?1, ?2 + CAST(key AS INTEGER), value FROM json_each(?3) WHERE true " +
    "ON CONFLICT(base_id, n) DO UPDATE SET text=excluded.text").bind(b.id, from, JSON.stringify(texts.map((t) => cleanText(t, MAX_PAGE_CHARS)))).run();
  return json({ ok: true });
}
export async function routeBasePatch(c, id) {
  await requireTeacher(c);
  const b = await getBase(c.db, id);
  const body = await readJson(c.request, 100000);
  const title = body.title !== undefined ? cleanLine(body.title, 200) || b.title : b.title;
  const scope = body.scope !== undefined ? JSON.stringify(cleanScope(b.kind, body.scope)) : b.scope;
  const note = body.note !== undefined ? cleanText(body.note, 3000).trim() : b.note;
  const sections = body.sections !== undefined ? JSON.stringify(cleanSections(body.sections, b.pages)) : b.sections;
  await c.db.prepare("UPDATE bases SET title=?2, scope=?3, note=?4, sections=?5, updated_at=?6 WHERE id=?1").bind(id, title, scope, note, sections, c.now).run();
  return json({ ok: true, base: baseOut(await getBase(c.db, id)) });
}
export async function routeBaseDelete(c, id) {
  await requireTeacher(c);
  await getBase(c.db, id);
  await c.db.batch([c.db.prepare("DELETE FROM base_pages WHERE base_id=?1").bind(id), c.db.prepare("DELETE FROM bases WHERE id=?1").bind(id)]);
  return json({ ok: true });
}
export async function routeBaseText(c, id) {
  await requireTeacher(c);
  const b = await getBase(c.db, id);
  const u = new URL(c.request.url);
  const from = Math.max(1, Number(u.searchParams.get("from")) || 1), to = Math.min(b.pages, Number(u.searchParams.get("to")) || from + 4);
  const r = await c.db.prepare("SELECT n, text FROM base_pages WHERE base_id=?1 AND n BETWEEN ?2 AND ?3 ORDER BY n").bind(id, from, Math.min(to, from + 30)).all();
  return json({ ok: true, pages: (r.results || []).map((p) => ({ n: p.n, text: p.text })) });
}

/* ---------- Was gilt für eine Klasse bzw. einen Kurs? (Regeln gemeinsam mit dem Browser: public/bases-detect.js) ---------- */
export { wantedSections };
export const missingFor = (bases, subject, klass) => missingForLabel(bases, subject, subjectName(subject), klass);
export async function planningBasis(db, subject, klass, maxChars = MAX_BASIS_CHARS) {
  const r = await db.prepare("SELECT * FROM bases WHERE subject=?1 ORDER BY kind, created_at").bind(subject).all();
  const bases = r.results || [], cfgs = await loadSubjectConfigs(db), cfg = cfgs[subject];
  const docs = [];
  for (const b of bases) {
    const want = wantedSections(b, klass);
    if (want.length) docs.push({ base: b, want });
  }
  // Vorrang: Erlass > Kurshalbjahr/Jahrgang > Regeln > Grundlagen/Standards
  const prio = (part) => (part === "fach" ? 0 : /^(E1|E2|Q[1-4]|\d+|alle)$/.test(part) ? 1 : part === "regeln" ? 2 : 3);
  const pageReqs = docs.flatMap((d) => d.want.map((w) => ({ id: d.base.id, n: w.n, part: w.part, prio: prio(w.part) })));
  // eine Abfrage je Dokument (Free-Plan: höchstens 50 Abfragen je Aufruf)
  const texts = new Map();
  if (docs.length) {
    const res = await db.batch(docs.map((d) => db.prepare("SELECT base_id, n, text FROM base_pages WHERE base_id=?1 AND n IN (SELECT value FROM json_each(?2))")
      .bind(d.base.id, JSON.stringify([...new Set(d.want.map((w) => w.n))]))));
    res.forEach((x) => (x.results || []).forEach((row) => texts.set(row.base_id + ":" + row.n, row.text)));
  }
  let used = 0, truncated = false;
  const included = new Set();
  for (const q of [...pageReqs].sort((a, b) => a.prio - b.prio)) {
    const t = texts.get(q.id + ":" + q.n) || "";
    if (used + t.length > maxChars) { truncated = true; continue; }
    used += t.length; included.add(q.id + ":" + q.n);
  }
  const parts = [];
  for (const d of docs) {
    const pages = [...new Set(d.want.map((w) => w.n))].filter((n) => included.has(d.base.id + ":" + n));
    if (!pages.length) continue;
    parts.push("### " + d.base.title + " (" + (KINDS[d.base.kind] || d.base.kind) + ", Seiten " + rangeText(pages) + ")" + (d.base.note ? "\nHinweis der Lehrkraft: " + d.base.note : "") +
      "\n" + pages.map((n) => "[Seite " + n + "]\n" + (texts.get(d.base.id + ":" + n) || "").trim()).join("\n\n"));
  }
  return {
    rules: cfg.rules || "", gradeNote: (cfg.gradeNotes || {})[gradeKey(klass)] || "", complete: cfg.complete,
    docs: docs.map((d) => ({ id: d.base.id, title: d.base.title, kind: d.base.kind, pages: rangeText([...new Set(d.want.map((w) => w.n))]) })),
    missing: missingFor(bases, subject, klass), truncated, text: parts.join("\n\n"),
  };
}
export function rangeText(nums) {
  const s = [...nums].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? String(s[i]) : s[i] + "–" + s[j]); i = j;
  }
  return out.join(", ");
}
export async function routeBasisPreview(c) {
  await requireTeacher(c);
  const u = new URL(c.request.url), subject = u.searchParams.get("subject"), klass = u.searchParams.get("klass");
  if (!isValidSubject(subject) || !isValidClass(klass)) throw bad("Fach oder Klasse ungültig.");
  const b = await planningBasis(c.db, subject, klass, 60000);
  return json({ ok: true, rules: b.rules, gradeNote: b.gradeNote, complete: b.complete, docs: b.docs, missing: b.missing, truncated: b.truncated, chars: b.text.length });
}
