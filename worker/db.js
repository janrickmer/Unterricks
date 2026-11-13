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
  // Planungsgrundlagen (Schulcurriculum, KCGO, E-Phasen-Curriculum, Abiturerlass …): Text je Seite, im Browser aus der PDF gezogen
  "CREATE TABLE IF NOT EXISTS bases (id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '[]', " +
    "note TEXT NOT NULL DEFAULT '', file_name TEXT, pages INTEGER NOT NULL DEFAULT 0, sections TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS bases_subject ON bases(subject, kind)",
  "CREATE TABLE IF NOT EXISTS base_pages (base_id TEXT NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (base_id, n))",
  // Unterrichtseinheiten: Rahmendaten, Plan (Leupold-Schema) und Zeilen des Ablaufs (Stundenfrage, Ablauf, Lernschritt, Datum)
  "CREATE TABLE IF NOT EXISTS units (id TEXT PRIMARY KEY, subject TEXT NOT NULL, klass TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'entwurf', " +
    "params TEXT NOT NULL DEFAULT '{}', plan TEXT NOT NULL DEFAULT '{}', rows TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 0, source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS units_sk ON units(subject, klass, created_at)",
  // Krankheitsvertretung: Vorschlag (von Claude über den Connector), nach Bestätigung aktiv; archive = ursprüngliche Planung
  "CREATE TABLE IF NOT EXISTS substitutes (lesson_id TEXT PRIMARY KEY, status TEXT NOT NULL, proposal TEXT NOT NULL, archive TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, confirmed_at INTEGER)",
  // Zurücksetzen (reset.js): Kennungen gelöschter Sitzungen, deren Dateien in R2 und Live-Zustand noch zu löschen sind
  "CREATE TABLE IF NOT EXISTS reset_queue (lesson_id TEXT PRIMARY KEY, queued_at INTEGER NOT NULL)",
  // PDF-Druck von Claudes Gestaltung (render.js): k = 'slot' (nächster freier Auftrag – Cloudflare erlaubt kostenlos 1 je 10 s) bzw.
  // 'quota' (Tageskontingent aufgebraucht bis …); Verbrauch je UTC-Tag (Browserzeit in ms, Zahl der PDFs)
  "CREATE TABLE IF NOT EXISTS render_gate (k TEXT PRIMARY KEY, until INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS render_usage (day TEXT PRIMARY KEY, ms INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0)",
  // Kurseinstellungen aller Kurse (Gymnasium: Fach|Klasse/Kurs, z. B. powi|8A, evrel|8-K, powi|Q2-GK; Grundschule: gs|<Kurs-ID>):
  // Stundenplan [{day 1–5, minutes, time "HH:MM"|null}] und Schülerzahl (1–60, NULL = nicht eingetragen)
  "CREATE TABLE IF NOT EXISTS course_settings (subject TEXT NOT NULL, klass TEXT NOT NULL, weekdays TEXT NOT NULL DEFAULT '[]', " +
    "class_size INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (subject, klass))",
  // Grundschulkurse: id = "gs" + 8 Hex = lessons.klass = units.klass = bases.subject der kurseigenen Planungsgrundlagen; classes = ["a","b"…]
  // (1–3, sortiert); religion 1 = Religion (Planungsgrundlage Ev. Religion Jg. 1–4), 0 = anderes Fach (subject_name); description nur für Claude
  "CREATE TABLE IF NOT EXISTS gs_courses (id TEXT PRIMARY KEY, grade INTEGER NOT NULL, classes TEXT NOT NULL DEFAULT '[]', " +
    "religion INTEGER NOT NULL DEFAULT 1, subject_name TEXT NOT NULL DEFAULT 'Religion', description TEXT NOT NULL DEFAULT '', " +
    "school_year TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  // Beamer über ein zweites Gerät (Nachtrag 15): Beamer-Code (6 Ziffern, 10 Minuten gültig) des Geräts am Beamer; key_hash = SHA-256 seines
  // geheimen pairKey (nur er holt die Kopplung ab). Gibt die Lehrkraft den Code ein, stehen hier Sitzung und Generation (beamerGen im Durable
  // Object); das Gerät holt sie einmal ab (die Zeile wird dabei gelöscht) und bekommt dann seinen signierten Beamer-Schlüssel (6 h).
  "CREATE TABLE IF NOT EXISTS beamer_pairs (code TEXT PRIMARY KEY, key_hash TEXT NOT NULL, created_at INTEGER NOT NULL, lesson_id TEXT, beamer_gen INTEGER, paired_at INTEGER)",
];

// Nachträglich ergänzte Spalten (bestehende Datenbanken bekommen sie per ALTER TABLE, nur additiv)
export const COLUMNS = [
  ["lessons", "homework", "TEXT NOT NULL DEFAULT ''"],
  ["lessons", "unit_id", "TEXT"],
  ["lessons", "unit_row", "TEXT"],
  ["fb_sheets", "kind", "TEXT NOT NULL DEFAULT ''"],   // 'escape' = Finale eines Escape-Rooms (Schüler:innen erreichen es über den Tunnel)
  ["files", "fb_code", "TEXT"],   // Notfall-Feibeitsblatt: Code des Feibeitsblatts, dessen analoges Arbeitsblatt diese PDF ist
  ["files", "fb_sig", "TEXT"],    // … und ihr Stand (mit/ohne QR-Code zur Checkliste, mit/ohne KI-Satz) – ändert er sich, wird sie erneuert
  ["lessons", "start_time", "TEXT"],   // Beginn der Sitzung „HH:MM“ (Ortszeit): Hausaufgabe ab 15 min vor dem Ende, Präsentation ab 5 min nach dem Ende
  ["files", "shown_until", "INTEGER"], // Präsentation: letzte im Unterricht gezeigte Folie (Schüler:innen bekommen nur Folie 1 bis hier)
  ["files", "cut_size", "INTEGER"],    // … Größe der gekürzten PDF (in R2 unter fileKey + "-bis"), NULL = keine
  ["files", "code_slides", "TEXT"],  // Präsentation: Platzhalterfolien für die Codefolie [{n, lines}] als JSON (cleanCodeSlides), NULL = keine
  ["lessons", "student_ai", "INTEGER NOT NULL DEFAULT 1"],   // KI-Begriffshilfe für Schüler:innen während der Stunde (1 = angeboten)
  // Druckliste „Von der Lehrkraft auszudrucken“ (area = 'print'): Anzahl, beidseitig (1) / einseitig (0), Farbe (1) / schwarz-weiß (0)
  ["files", "print_copies", "INTEGER"],
  ["files", "print_duplex", "INTEGER"],
  ["files", "print_color", "INTEGER"],
  ["student_devices", "auth_until", "INTEGER"],   // Anmeldung gilt bis hier (90 min nach der Passworteingabe); NULL = Passwort nötig
  // Von Claude gestaltetes Material (kind 'file', PDF in R2): html = Claudes Gestaltung, html_at = ihr Stand, pdf_at = Stand der gedruckten
  // PDF (fehlt oder älter = noch nicht bzw. veraltet gedruckt), render_error = letzte Meldung des Druckers
  ["files", "html", "TEXT"],
  ["files", "html_at", "INTEGER"],
  ["files", "pdf_at", "INTEGER"],
  ["files", "render_error", "TEXT"],
  // Grundschule: „Inhalt der Unterrichtsstunde“ und „Hinweis der Lehrkraft“ für die Elternansicht; Elternlink (nur SHA-256 von
  // "eltern|v1|" + Token zum Nachschlagen und eine mit SETTINGS_SECRET versiegelte Kopie zum erneuten Kopieren); 1 = Ausfall-Eintrag
  ["lessons", "parent_summary", "TEXT NOT NULL DEFAULT ''"],
  ["lessons", "parent_note", "TEXT NOT NULL DEFAULT ''"],
  ["lessons", "parent_hash", "TEXT"],
  ["lessons", "parent_sealed", "TEXT"],
  ["lessons", "cancelled", "INTEGER NOT NULL DEFAULT 0"],
  ["units", "revise", "TEXT"],         // Grundschule: Ausfälle (Krankmeldung) und Überarbeitungshinweis als JSON; NULL = nie ausgefallen
  // Bildkarten (Grundschule): {v:1, texts, share, rev} als JSON, NULL = keine Bildkarten; Zahl der Kartenbilder in slides und der Stand der
  // PDF, aus dem sie erstellt wurden
  ["files", "cards", "TEXT"],
  ["files", "card_pages", "INTEGER"],
  ["files", "card_img_at", "INTEGER"],
  // Planungsgrundlagen: Original-PDF in R2 unter b/<id>.pdf (NULL = nur Text) und wann sie gespeichert wurde
  ["bases", "pdf_size", "INTEGER"],
  ["bases", "pdf_at", "INTEGER"],
  // Entscheidung der Lehrkraft (mit Claude) zum offenen Teil der vorigen Sitzung nach einem Zwischenstopp: {v:1, choice "uebernehmen"|"verzichten",
  // prevId, prevVersion, at} als JSON; gilt nur, solange die vorige Sitzung dieselbe ist und ihr Eintrag dieselbe Version hat (stopDecision)
  ["lessons", "stop_decision", "TEXT"],
];

// Indizes über nachträglich ergänzte Spalten (nach den Spalten angelegt; ein Fehler – z. B. alte Doppelungen – hält den Betrieb nicht auf)
export const INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS lessons_unit_row ON lessons(unit_id, unit_row) WHERE unit_id IS NOT NULL AND unit_row IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS lessons_parent_hash ON lessons(parent_hash) WHERE parent_hash IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS lessons_date ON lessons(subject, klass, lesson_date)",
  "CREATE INDEX IF NOT EXISTS files_cards ON files(updated_at) WHERE cards IS NOT NULL",   // Bildkarten, deren Bilder noch fehlen (cards/pending)
  // Druckaufträge für den nächsten Arbeitstag (printjobs.js, bei jedem Aufruf einer Startseite): Sitzungen eines Tages ohne Durchsuchen aller Sitzungen
  "CREATE INDEX IF NOT EXISTS lessons_day ON lessons(lesson_date)",
];

let ready = null, warm = false;
/* true, sobald das Schema in diesem Isolate angelegt ist – vor ensureSchema abgefragt: false heißt, diese Anfrage legt es gerade an (bis zu 41
   Anweisungen), lange Abfragen (Beamer-Code) halten dann nicht (höchstens 50 D1-Anweisungen je Aufruf im Free-Plan) */
export const schemaWarm = () => warm;
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
    try { await db.batch(INDEXES.map((s) => db.prepare(s))); } catch (e) { console.warn("Index nicht angelegt:", e && e.message); }
    warm = true;
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

/* Beamer-Codes gelten 10 Minuten; eine Kopplung kurz vor dem Ablauf kann das Gerät noch bis 12 Minuten nach dem Erzeugen abholen */
export const BEAMER_PAIR_TTL_MS = 10 * 60e3, BEAMER_PAIR_KEEP_MS = 12 * 60e3;
/* Aufräumen: abgelaufene Anmeldungen, alte Sperr-Zähler und Beamer-Codes */
export function cleanupStatements(db, now) {
  return [
    db.prepare("DELETE FROM teacher_tokens WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM locks WHERE locked_until < ?1 AND window_start < ?2").bind(now, now - 2 * 86400e3),
    db.prepare("DELETE FROM render_usage WHERE day < ?1").bind(new Date(now - 30 * 86400e3).toISOString().slice(0, 10)),
    db.prepare("DELETE FROM beamer_pairs WHERE created_at < ?1").bind(now - BEAMER_PAIR_KEEP_MS),   // abgelaufene Beamer-Codes
  ];
}
