// Schüler:innen-Anmeldung: höchstens 90 Minuten nach der Passworteingabe, danach 403 session_expired (das Gerät bleibt)
import test from "node:test";
import assert from "node:assert/strict";
import { requireStudent, STUDENT_LOGIN_MS } from "../../worker/auth.js";
import { STUDENT_LOGIN_MIN } from "../../public/shared.js";

const ctx = (row, now, runs = []) => ({ now, waitUntil: () => {}, request: new Request("https://x/api/student/me", { headers: { Authorization: "Bearer tok-123" } }),
  db: { prepare: (sql) => ({ bind: (...a) => ({ first: async () => row, run: async () => { runs.push([sql, a]); return {}; } }) }) } });

test("90 Minuten", () => { assert.equal(STUDENT_LOGIN_MIN, 90); assert.equal(STUDENT_LOGIN_MS, STUDENT_LOGIN_MIN * 60e3); });

test("gültig bis zur Frist, mit Restzeit", async () => {
  const now = 1_800_000_000_000, c = ctx({ id: "d1", klass: "7B", subject: "powi", last_seen: now, auth_until: now + 60e3 }, now);
  const s = await requireStudent(c);
  assert.equal(s.id, "d1"); assert.equal(c.authLeftMs, 60e3);
});

test("abgelaufen → 403 session_expired (nicht 401: ältere Seiten löschten sonst den Token)", async () => {
  const now = 1_800_000_000_000;
  for (const auth_until of [now, now - 1]) {
    await assert.rejects(requireStudent(ctx({ id: "d1", last_seen: now, auth_until }, now)), (e) => e.status === 403 && e.code === "session_expired" && /90 Minuten/.test(e.message));
  }
});

test("Gerät von vor der Regel (ohne Frist): bekommt beim ersten Kontakt die 90 Minuten", async () => {
  const now = 1_800_000_000_000, runs = [], c = ctx({ id: "d1", last_seen: now, auth_until: null }, now, runs);
  await requireStudent(c);
  assert.equal(c.authLeftMs, STUDENT_LOGIN_MS);
  assert.ok(runs.some(([sql, a]) => /SET auth_until=\?2 WHERE id=\?1 AND auth_until IS NULL/.test(sql) && a[1] === now + STUDENT_LOGIN_MS));
});

test("unbekanntes Gerät → 401 unauthorized", async () => {
  await assert.rejects(requireStudent(ctx(null, Date.now())), (e) => e.status === 401 && e.code === "unauthorized");
});
