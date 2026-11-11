// reset.js – „Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen“ (Einstellungen) und die Übersicht für die Sicherung.
// Gelöscht werden alle Unterrichtseinheiten und Sitzungen mit allem, was an ihnen hängt (Materialien, Präsentationen, Planungschats,
// Schulportal-Einträge, Drucklisten, Feibeitsblatt-Verknüpfungen und -Entwürfe, Vertretungen, Freischaltungen der Schüler:innen).
// Es bleiben: Zugang und Geräte der Lehrkraft, Planungsgrundlagen, Fach-Einstellungen mit Kursen, KI, Connector, Feibeitsblatt-Verbindung,
// Schülerpasswort und Schülergeräte; die Feibeitsblätter selbst bleiben im Feibeitsblatt (Entscheidung der Lehrkraft vom 11.11.2026).
// Ablauf: D1 in EINEM Batch (danach ist alles weg, für Unterricks sofort konsistent); die Dateien in R2 (Präfix l/<Sitzung>/) und der
// Live-Zustand je Sitzung folgen in Runden über die Warteschlange reset_queue – der Browser ruft /reset/cleanup, bis nichts mehr offen ist
// (Grenzen des Free-Plans: wenige Aufrufe je Anfrage). Neue Sitzungen sind nie betroffen: gelöscht wird nur unter den gemerkten Kennungen.
import { json, readJson, isId } from "./lib.js";
import { requireTeacher, checkTeacherPassword } from "./auth.js";
import { unitOut } from "./units.js";

const ROUND_CALLS = 36;   // R2-/Durable-Object-Aufrufe je Anfrage (Free-Plan: höchstens 50 Unteranfragen)

async function pendingCount(db) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM reset_queue").first();
  return (r && r.n) || 0;
}
/* Eine Runde: Dateien gemerkter Sitzungen löschen, Live-Zustand zurücksetzen; fertig bearbeitete Sitzungen verlassen die Warteschlange */
export async function cleanupRound(c, budget = ROUND_CALLS) {
  const q = await c.db.prepare("SELECT lesson_id FROM reset_queue ORDER BY queued_at, lesson_id LIMIT 12").all();
  const done = [];
  let calls = 0;
  for (const { lesson_id: id } of q.results || []) {
    if (!isId(id)) { done.push(id); continue; }
    let cursor, complete = false;
    while (calls + 3 <= budget) {
      const list = await c.env.FILES.list({ prefix: "l/" + id + "/", cursor, limit: 1000 }); calls++;
      if (list.objects.length) { await c.env.FILES.delete(list.objects.map((o) => o.key)); calls++; }
      if (list.truncated) { cursor = list.cursor; continue; }
      complete = true; break;
    }
    if (!complete) break;   // Rest dieser Sitzung in der nächsten Runde (erneutes Auflisten ist unschädlich)
    try { await c.env.LIVE.get(c.env.LIVE.idFromName(id)).fetch("https://live/reset", { method: "POST" }); } catch {}
    calls++;
    done.push(id);
    if (calls + 3 > budget) break;
  }
  if (done.length) await c.db.batch(done.map((id) => c.db.prepare("DELETE FROM reset_queue WHERE lesson_id=?1").bind(id)));
  return pendingCount(c.db);
}

/* GET /api/teacher/reset – was gelöscht würde und ob vom letzten Zurücksetzen noch Dateien zu löschen sind */
export async function routeResetStatus(c) {
  await requireTeacher(c);
  const [u, l, f, p] = await c.db.batch([
    c.db.prepare("SELECT COUNT(*) AS n FROM units"),
    c.db.prepare("SELECT COUNT(*) AS n FROM lessons"),
    c.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) + COALESCE(SUM(cut_size),0) AS bytes FROM files"),
    c.db.prepare("SELECT COUNT(*) AS n FROM reset_queue"),
  ]);
  const first = (r) => (r.results && r.results[0]) || {};
  return json({ ok: true, units: first(u).n || 0, lessons: first(l).n || 0, files: first(f).n || 0, bytes: first(f).bytes || 0, pending: first(p).n || 0 });
}

/* POST /api/teacher/reset {authKey} – Passwort prüfen (Sperren wie bei der Anmeldung), alles in einem Batch löschen, erste Aufräumrunde */
export async function routeReset(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 2000);
  await checkTeacherPassword(c, body.authKey);
  const db = c.db;
  const res = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM units"),
    db.prepare("SELECT COUNT(*) AS n FROM lessons"),
    db.prepare("INSERT OR IGNORE INTO reset_queue(lesson_id, queued_at) SELECT id, ?1 FROM lessons").bind(c.now),
    db.prepare("DELETE FROM slides"),
    db.prepare("DELETE FROM files"),
    db.prepare("DELETE FROM chat"),
    db.prepare("DELETE FROM student_access"),
    db.prepare("DELETE FROM fb_sheets"),
    db.prepare("DELETE FROM fb_drafts"),
    db.prepare("DELETE FROM substitutes"),
    db.prepare("DELETE FROM lessons"),
    db.prepare("DELETE FROM units"),
  ]);
  const n = (i) => ((res[i].results && res[i].results[0]) || {}).n || 0;
  const pending = await cleanupRound(c);
  return json({ ok: true, deleted: { units: n(0), lessons: n(1) }, pending });
}

/* POST /api/teacher/reset/cleanup – nächste Aufräumrunde (der Browser ruft, bis pending 0 ist; ohne Passwort: es wird nur Gemerktes gelöscht) */
export async function routeResetCleanup(c) {
  await requireTeacher(c);
  return json({ ok: true, pending: await cleanupRound(c) });
}

/* GET /api/teacher/backup – Übersicht für die große Sicherung: alle Einheiten (mit Plan und Zeilen) und alle Sitzungen (mit Zeile) */
export async function routeBackupIndex(c) {
  await requireTeacher(c);
  const [u, l] = await c.db.batch([
    c.db.prepare("SELECT * FROM units ORDER BY subject, klass, created_at LIMIT 2000"),
    c.db.prepare("SELECT id, subject, klass, title, lesson_date, start_time, duration_min, unit_id, unit_row, code, created_at FROM lessons ORDER BY COALESCE(lesson_date,''), created_at LIMIT 5000"),
  ]);
  const lessons = (l.results || []).map((x) => ({ id: x.id, subject: x.subject, klass: x.klass, title: x.title, date: x.lesson_date || null, time: x.start_time || null,
    durationMin: x.duration_min ?? null, unitId: x.unit_id || null, unitRow: x.unit_row || null, code: x.code, createdAt: x.created_at }));
  return json({ ok: true, units: (u.results || []).map((x) => unitOut(x)), lessons });
}
