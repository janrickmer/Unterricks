// D1 und R2 auf SQLite bzw. einer Map für Unit-Tests des Workers (Kopie der Nachbildung aus render.test.mjs, nur was der Worker braucht).
// Keine *.test-Datei: wird von den Tests importiert. countD1 zählt die Anweisungen (eine Anweisung in einem batch zählt einzeln).
import { DatabaseSync } from "node:sqlite";
import { SCHEMA, COLUMNS, INDEXES } from "../../worker/db.js";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const vals = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  const plain = (r) => (r ? { ...r } : null);
  const counter = { n: 0 };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async (col) => { counter.n++; const r = plain(db.prepare(sql).get(...vals(args))); return r && col ? r[col] : r; },
    all: async () => { counter.n++; return { results: db.prepare(sql).all(...vals(args)).map(plain) }; },
    run: async () => {
      counter.n++;
      if (/\bRETURNING\b/i.test(sql)) { const rows = db.prepare(sql).all(...vals(args)); return { results: rows.map(plain), meta: { changes: rows.length } }; }
      const r = db.prepare(sql).run(...vals(args)); return { meta: { changes: Number(r.changes) } };
    },
  });
  return { raw: db, counter, prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.all()); return out; } };
}

export function fakeR2() {
  const m = new Map();
  return { m, put: async (k, v) => { m.set(k, v instanceof Uint8Array ? v : new Uint8Array(await new Response(v).arrayBuffer())); }, get: async (k) => (m.has(k) ? { body: m.get(k) } : null),
    delete: async (k) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); } };
}

// frisches Schema direkt anlegen (ensureSchema merkt sich das Anlegen je Isolate)
export function schema(db) {
  for (const q of SCHEMA) db.raw.exec(q);
  for (const [t, col, def] of COLUMNS) db.raw.exec("ALTER TABLE " + t + " ADD COLUMN " + col + " " + def);
  for (const q of INDEXES) db.raw.exec(q);
}

// Kontext wie im Worker (c.db, c.env, c.now)
export function fakeCtx(extraEnv = {}) {
  const db = fakeD1();
  schema(db);
  return { db, now: Date.now(), env: { DB: db, FILES: fakeR2(), SETTINGS_SECRET: "nur-test", ...extraEnv } };
}
