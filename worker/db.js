// db.js – D1-Schema (beim ersten Request je Isolate per CREATE TABLE IF NOT EXISTS; Änderungen nur additiv).
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  // genau eine Lehrkraft (id = 1); auth_hash = SHA-256 des im Browser per PBKDF2 abgeleiteten Schlüssels
  "CREATE TABLE IF NOT EXISTS teacher (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, auth_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS teacher_tokens (token_hash TEXT PRIMARY KEY, device_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS trusted_devices (device_hash TEXT PRIMARY KEY, label TEXT, created_at INTEGER NOT NULL, last_login INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS locks (k TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0)",
  // Unterrichtssitzungen
  "CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, subject TEXT NOT NULL, klass TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL DEFAULT '', " +
    "duration_min INTEGER, lesson_date TEXT, ideas TEXT NOT NULL DEFAULT '', code TEXT NOT NULL UNIQUE, portal TEXT NOT NULL DEFAULT '', portal_version INTEGER NOT NULL DEFAULT 0, " +
    "portal_updated_at INTEGER, portal_source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS lessons_sk ON lessons(subject, klass, created_at)",
  "CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, lesson_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, mode TEXT, created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS chat_lesson ON chat(lesson_id, id)",
  // Dateien: area = student | teacher | presentation; kind = file (R2) | text (Markdown in D1, Download als PDF im Browser)
  "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, area TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', " +
    "size INTEGER NOT NULL DEFAULT 0, text TEXT, pages INTEGER, status TEXT NOT NULL DEFAULT 'ready', source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS files_lesson ON files(lesson_id, area, created_at)",
  "CREATE TABLE IF NOT EXISTS slides (file_id TEXT NOT NULL, n INTEGER NOT NULL, size INTEGER NOT NULL, w INTEGER, h INTEGER, PRIMARY KEY (file_id, n))",
  // Schüler-Geräte (ohne Personendaten) und freigeschaltete Sitzungen (joined_at = erstes Betreten, Grundlage der 90-Minuten-Frist)
  "CREATE TABLE IF NOT EXISTS student_devices (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, klass TEXT, subject TEXT, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS student_access (device_id TEXT NOT NULL, lesson_id TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (device_id, lesson_id))",
  "CREATE INDEX IF NOT EXISTS access_lesson ON student_access(lesson_id)",
  // Feibeitsblätter einer Sitzung und Entwürfe (aus dem Chat oder von Claude über den Connector)
  "CREATE TABLE IF NOT EXISTS fb_sheets (lesson_id TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (lesson_id, code))",
  "CREATE TABLE IF NOT EXISTS fb_drafts (id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', sheet_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS drafts_lesson ON fb_drafts(lesson_id, created_at)",
];

// Nachträglich ergänzte Spalten (bestehende Datenbanken bekommen sie per ALTER TABLE, nur additiv)
export const COLUMNS = [
  ["lessons", "homework", "TEXT NOT NULL DEFAULT ''"],
];

let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = (async () => {
    await db.batch(SCHEMA.map((s) => db.prepare(s)));
    for (const table of [...new Set(COLUMNS.map((c) => c[0]))]) {
      const info = await db.prepare("PRAGMA table_info(" + table + ")").all();
      const have = new Set((info.results || []).map((r) => r.name));
      for (const [t, col, def] of COLUMNS) {
        if (t !== table || have.has(col)) continue;
        try { await db.prepare("ALTER TABLE " + t + " ADD COLUMN " + col + " " + def).run(); }
        catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; }   // gleichzeitig von einer anderen Instanz angelegt
      }
    }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function getSetting(db, key) {
  const r = await db.prepare("SELECT value FROM settings WHERE key=?1").bind(key).first();
  if (!r) return null;
  try { return JSON.parse(r.value); } catch { return null; }
}
export const setSettingStmt = (db, key, value) =>
  db.prepare("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, JSON.stringify(value));
export const setSetting = (db, key, value) => setSettingStmt(db, key, value).run();

/* Aufräumen: abgelaufene Anmeldungen und alte Sperr-Zähler */
export function cleanupStatements(db, now) {
  return [
    db.prepare("DELETE FROM teacher_tokens WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM locks WHERE locked_until < ?1 AND window_start < ?2").bind(now, now - 2 * 86400e3),
  ];
}
