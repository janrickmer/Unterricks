// substitute.js – Krankheitsvertretung: Claude legt über den Connector einen Vorschlag ab (save_substitute_plan); die Lehrkraft prüft ihn
// und bestätigt im Browser. Dann archiviert die Plattform die ursprüngliche Planung (Schulportal-Eintrag, Hausaufgabe, Material,
// Feibeitsblätter), tauscht das Material aus und zeigt den Schüler:innen den Vertretungshinweis mit der chronologischen Anleitung.
import { HttpError, bad, json, readJson, randomId, isId } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { requireAccess } from "./student.js";
import { normalizeEscapeRoom } from "../public/escape-data.js";
import { getLesson, savePortal, insertDraft } from "./lessons.js";
import { insertTextMaterial, fileKey, checkStorage, deleteNotfallFiles } from "./files.js";
import { normalizeSubstitute } from "../public/planning.js";
import { isAnalogClass, normalizeCode, isValidCode, subjectName, classShort } from "../public/shared.js";

export const ESCAPE_ROOMS_AVAILABLE = true;   // Escape-Room-Vorlage der Plattform (public/escape.js, Finale im Feibeitsblatt)
const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
export async function getSubstitute(db, lessonId) {
  return db.prepare("SELECT * FROM substitutes WHERE lesson_id=?1").bind(lessonId).first();
}

/* Vorschlag ablegen (Connector) – ersetzt einen offenen Vorschlag, nie eine aktive Vertretung */
export async function saveProposal(db, lessonId, raw, now) {
  const l = await getLesson(db, lessonId);
  const cur = await getSubstitute(db, lessonId);
  if (cur && cur.status === "aktiv") throw new HttpError(409, "active", "Für diese Sitzung ist bereits eine Vertretung aktiv. Die Lehrkraft muss zuerst die ursprüngliche Planung wiederherstellen.");
  const p = normalizeSubstitute(raw);
  if (p.escape_room && !ESCAPE_ROOMS_AVAILABLE) throw bad("Escape-Rooms kann die Plattform noch nicht bereitstellen. Bitte ein Feibeitsblatt (bei einem Lernprodukt mit Foto-Abgabe) verwenden.");
  if (!p.schritte.length) throw bad("Der Vorschlag braucht eine chronologische Anleitung (schritte).");
  // Escape-Room: Inhalte streng prüfen (Fehlerliste geht an Claude zurück); das Finale ist ein Feibeitsblatt mit Escape-Kennung
  if (p.escape_room && !isAnalogClass(l.klass)) {
    try { p.escape_room = normalizeEscapeRoom(p.escape_room, { id: "unterricks-" + lessonId.slice(0, 8) + "-" + randomId(3), fach: subjectName(l.subject), klasse: classShort(l.klass) }); }
    catch (e) { throw bad(e.message); }
    p.feibeitsblatt = { titel: p.escape_room.feibeitsblatt.titel, aufgaben: p.escape_room.feibeitsblatt.aufgaben, escape: { id: p.escape_room.id, name: p.escape_room.name } };
  }
  if (isAnalogClass(l.klass) && (p.feibeitsblatt || p.escape_room)) throw bad("In den Jahrgängen 5 und 6 gibt es keine digitalen Formate (keine Feibeitsblätter/Escape-Rooms) – bitte analoges, ausdruckbares Material.");
  if (!isAnalogClass(l.klass) && !p.feibeitsblatt && !p.escape_room) throw bad("Jede Vertretungsstunde braucht eine Abgabe in der Plattform: ein Feibeitsblatt (ggf. mit Foto-Aufgabe) oder einen Escape-Room mit Feibeitsblatt-Finale.");
  // Feibeitsblatt als Entwurf: die Lehrkraft prüft ihn im bekannten Editor und legt ihn beim Bestätigen an
  let draftId = null;
  if (p.feibeitsblatt) {
    const fb = p.feibeitsblatt;
    const d = await insertDraft(db, lessonId, { title: fb.titel || fb.title, tasks: fb.aufgaben || fb.tasks, escape: fb.escape }, "vertretung", now);
    draftId = d.id;
  }
  const proposal = { ...p, draftId };
  await db.prepare("INSERT INTO substitutes(lesson_id, status, proposal, created_at, updated_at) VALUES(?1, 'vorschlag', ?2, ?3, ?3) " +
    "ON CONFLICT(lesson_id) DO UPDATE SET status='vorschlag', proposal=excluded.proposal, updated_at=excluded.updated_at").bind(lessonId, JSON.stringify(proposal), now).run();
  if (cur && cur.status === "vorschlag") {
    const old = parseJ(cur.proposal, {});
    if (old.draftId && old.draftId !== draftId) await db.prepare("DELETE FROM fb_drafts WHERE id=?1 AND status='draft'").bind(old.draftId).run();
  }
  return proposal;
}

/* Bestätigen: archivieren und austauschen */
export async function routeSubstituteConfirm(c, lessonId) {
  await requireTeacher(c);
  const l = await getLesson(c.db, lessonId);
  const s = await getSubstitute(c.db, lessonId);
  if (!s || s.status !== "vorschlag") throw bad("Es liegt kein Vertretungsvorschlag zur Bestätigung vor.");
  const p = parseJ(s.proposal, {});
  const body = await readJson(c.request, 20000);
  const sheet = body.sheet && isValidCode(normalizeCode(body.sheet.code)) ? { code: normalizeCode(body.sheet.code), title: String(body.sheet.title || "Feibeitsblatt").slice(0, 200) } : null;
  if (p.draftId && !sheet && !isAnalogClass(l.klass)) throw bad("Bitte zuerst das Feibeitsblatt der Vertretung anlegen (Verbindung zu Feibeitsblatt nötig).");
  const [files, sheets] = await c.db.batch([
    c.db.prepare("SELECT id, area FROM files WHERE lesson_id=?1 AND area IN ('student','teacher')").bind(lessonId),
    c.db.prepare("SELECT code, title FROM fb_sheets WHERE lesson_id=?1").bind(lessonId),
  ]);
  const archive = { portal: l.portal, homework: l.homework || "", files: (files.results || []).map((f) => ({ id: f.id, area: f.area })), sheets: sheets.results || [], at: c.now };
  // 1) ursprüngliche Dateien ins Archiv (für Schüler:innen unsichtbar), Feibeitsblatt-Verknüpfungen lösen, Hausaufgabe leeren
  await c.db.batch([
    c.db.prepare("UPDATE files SET area='archive', updated_at=?2 WHERE lesson_id=?1 AND area IN ('student','teacher')").bind(lessonId, c.now),
    c.db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1").bind(lessonId),
    c.db.prepare("UPDATE lessons SET homework='', updated_at=?2 WHERE id=?1").bind(lessonId, c.now),
  ]);
  // 2) Vertretungsmaterial: Anleitung (auch zum Ausdrucken), Materialien, Hinweise für die Vertretungslehrkraft
  const guide = "# Vertretungsstunde: " + l.title + "\n\n" + p.hinweis + "\n\n" + p.schritte.map((x, i) => "## " + (i + 1) + ". " + x.titel + (x.minuten ? " (ca. " + x.minuten + " Minuten)" : "") +
    "\n\n" + x.anleitung + (x.abgabe ? "\n\n**Abgabe:** " + (p.abgabe || "siehe Anleitung") : "")).join("\n\n") + (p.abgabe ? "\n\n---\n\n**Was du abgibst:** " + p.abgabe : "");
  await insertTextMaterial(c.db, lessonId, "student", "Anleitung zur Vertretungsstunde", guide, "vertretung", c.now);
  for (const m of p.materialien || []) await insertTextMaterial(c.db, lessonId, m.bereich, m.titel, m.markdown, "vertretung", c.now);
  if (p.vertretung) await insertTextMaterial(c.db, lessonId, "teacher", "Hinweise für die Vertretungslehrkraft", "# Hinweise für die Vertretungslehrkraft\n\n" + p.vertretung, "vertretung", c.now);
  // 3) Schulportal-Eintrag der Vertretung, Feibeitsblatt verknüpfen
  if (p.schulportal) await savePortal(c.db, lessonId, p.schulportal, null, "vertretung", Date.now());
  if (sheet) {
    await c.db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at, kind) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(lesson_id, code) DO UPDATE SET title=excluded.title, kind=excluded.kind")
      .bind(lessonId, sheet.code, sheet.title, c.now, p.escape_room ? "escape" : "").run();
    if (p.escape_room) p.escapeSheet = sheet.code;
    if (p.draftId) await c.db.prepare("UPDATE fb_drafts SET status='created', sheet_code=?2, updated_at=?3 WHERE id=?1").bind(p.draftId, sheet.code, c.now).run();
  }
  await c.db.prepare("UPDATE substitutes SET status='aktiv', proposal=?2, archive=?3, confirmed_at=?4, updated_at=?4 WHERE lesson_id=?1").bind(lessonId, JSON.stringify(p), JSON.stringify(archive), c.now).run();
  return json({ ok: true });
}

export async function routeSubstituteDiscard(c, lessonId) {
  await requireTeacher(c);
  const s = await getSubstitute(c.db, lessonId);
  if (!s || s.status !== "vorschlag") throw bad("Es liegt kein offener Vorschlag vor.");
  const p = parseJ(s.proposal, {});
  await c.db.batch([
    c.db.prepare("DELETE FROM substitutes WHERE lesson_id=?1").bind(lessonId),
    ...(p.draftId ? [c.db.prepare("DELETE FROM fb_drafts WHERE id=?1 AND status='draft'").bind(p.draftId)] : []),
  ]);
  return json({ ok: true });
}

/* Ursprüngliche Planung wiederherstellen (Vertretungsmaterial wird gelöscht) */
export async function routeSubstituteRestore(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  const s = await getSubstitute(c.db, lessonId);
  if (!s || s.status !== "aktiv") throw bad("Für diese Sitzung ist keine Vertretung aktiv.");
  const a = parseJ(s.archive, {}), p = parseJ(s.proposal, {});
  const stmts = [
    c.db.prepare("DELETE FROM files WHERE lesson_id=?1 AND source='vertretung' AND kind='text'").bind(lessonId),
    c.db.prepare("UPDATE lessons SET homework=?2, updated_at=?3 WHERE id=?1").bind(lessonId, a.homework || "", c.now),
    c.db.prepare("DELETE FROM substitutes WHERE lesson_id=?1").bind(lessonId),
  ];
  for (const f of (a.files || []).slice(0, 30)) stmts.push(c.db.prepare("UPDATE files SET area=?3 WHERE id=?1 AND lesson_id=?2 AND area='archive'").bind(f.id, lessonId, f.area === "teacher" ? "teacher" : "student"));
  await c.db.batch(stmts);
  const curSheets = await c.db.prepare("SELECT code FROM fb_sheets WHERE lesson_id=?1").bind(lessonId).all();
  const subCodes = (curSheets.results || []).map((x) => x.code);
  const re = [c.db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1").bind(lessonId)];
  for (const sh of (a.sheets || []).slice(0, 20)) re.push(c.db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at) VALUES(?1, ?2, ?3, ?4) ON CONFLICT(lesson_id, code) DO NOTHING").bind(lessonId, sh.code, sh.title, c.now));
  await c.db.batch(re);
  await savePortal(c.db, lessonId, a.portal || "", null, "lehrkraft", Date.now());
  const removedSheets = subCodes.filter((x) => !(a.sheets || []).some((y) => y.code === x));
  for (const code of removedSheets) await deleteNotfallFiles(c, lessonId, code);   // Notfall-Feibeitsblatt der Vertretung gehört nicht mehr dazu
  return json({ ok: true, removedSheets });
}

/* Archivierte ursprüngliche Planung (Schulportal-Eintrag + Material) in eine andere Sitzung übernehmen */
export async function routeSubstituteTransfer(c, lessonId) {
  await requireTeacher(c);
  const s = await getSubstitute(c.db, lessonId);
  if (!s || s.status !== "aktiv") throw bad("Für diese Sitzung gibt es keine archivierte Planung.");
  const body = await readJson(c.request, 10000);
  if (!isId(body.targetLessonId) || body.targetLessonId === lessonId) throw bad("Bitte eine andere Sitzung wählen.");
  const target = await getLesson(c.db, body.targetLessonId);
  const a = parseJ(s.archive, {});
  // in Stücken (höchstens 10 Dateien je Aufruf: Grenzen des Free-Plans für R2- und Datenbankaufrufe); der Browser ruft mit offset weiter auf
  const all = a.files || [], from = Math.max(0, Math.min(all.length, Number(body.offset) || 0)), chunk = all.slice(from, from + 10);
  const found = chunk.length ? await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND id IN (SELECT value FROM json_each(?2))").bind(lessonId, JSON.stringify(chunk.map((f) => f.id))).all() : { results: [] };
  const byId = new Map((found.results || []).map((f) => [f.id, f]));
  // Notfall-Feibeitsblätter nicht kopieren: Sie entstehen in der Zielsitzung neu, sobald dort das Feibeitsblatt verknüpft ist
  const files = chunk.map((f0) => ({ f0, f: byId.get(f0.id) })).filter((x) => x.f && x.f.source !== "notfall");
  await checkStorage(c, files.reduce((n, x) => n + (x.f.kind === "file" ? x.f.size || 0 : 0), 0));
  const ins = [];
  for (const { f0, f } of files) {
    const id = randomId(8);
    if (f.kind === "file") {
      const obj = await c.env.FILES.get(fileKey(f.lesson_id, f.id));
      if (!obj) continue;
      await c.env.FILES.put(fileKey(target.id, id), obj.body, { httpMetadata: { contentType: f.mime } });
    }
    ins.push(c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', 'uebernommen', ?9, ?9)")
      .bind(id, target.id, f0.area === "teacher" ? "teacher" : "student", f.kind, f.name, f.mime, f.size, f.text, c.now));
  }
  if (ins.length) await c.db.batch(ins);
  if (from === 0 && a.portal && body.portal !== false) {
    const merged = target.portal ? target.portal + "\n\n" + a.portal : a.portal;
    await savePortal(c.db, target.id, merged, null, "lehrkraft", Date.now());
  }
  const next = from + chunk.length < all.length ? from + chunk.length : null;
  return json({ ok: true, copied: ins.length, next, target: target.id });
}

export const substituteForStudents = (s) => {
  if (!s || s.status !== "aktiv") return null;
  const p = parseJ(s.proposal, {});
  return { hinweis: p.hinweis, schritte: (p.schritte || []).map((x) => ({ titel: x.titel, anleitung: x.anleitung, minuten: x.minuten, abgabe: !!x.abgabe })), abgabe: p.abgabe || "",
    escape: p.escape_room ? { name: p.escape_room.name, titel: p.escape_room.titel, untertitel: p.escape_room.untertitel, ready: !!p.escapeSheet } : null };
};

/* Escape-Room einer Sitzung: Schüler:innen nur bei aktiver Vertretung (mit Freischaltung der Sitzung), Lehrkraft auch als Vorschau */
function escapeOut(c, l, p, preview) {
  // Vorbelegung der Klasse im Escape-Room: bei Schüler:innen ihre eigene Klasse (bei Kursen über mehrere Klassen nicht die Kurskennung)
  return json({ ok: true, room: p.escape_room, sheetCode: preview ? "" : p.escapeSheet || "", preview, subject: l.subject, klass: !preview && c.student && c.student.klass ? c.student.klass : l.klass,
    feibeitsblattUrl: c.env.FEIBEITSBLATT_URL || "https://feibeitsblatt.janrickmer.de/" });
}
export async function routeStudentEscape(c, lessonId) {
  const { lesson } = await requireAccess(c, lessonId);
  const s = await getSubstitute(c.db, lessonId), p = s && s.status === "aktiv" ? parseJ(s.proposal, {}) : null;
  if (!p || !p.escape_room) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es keinen Escape-Room.");
  return escapeOut(c, lesson, p, false);
}
export async function routeTeacherEscape(c, lessonId) {
  await requireTeacher(c);
  const l = await getLesson(c.db, lessonId), s = await getSubstitute(c.db, lessonId), p = s ? parseJ(s.proposal, {}) : null;
  if (!p || !p.escape_room) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es keinen Escape-Room.");
  return escapeOut(c, l, p, true);
}
