// beamer.js – Beamer über ein zweites Gerät (Nachtrag 15 der Lehrkraft vom 13.11.2026). Ein Gerät am Beamer (z. B. ein Schul-iPad, das per
// AirPlay an Apple TV spiegelt, oder ein PC am Beamer) öffnet #/beamer und zeigt einen Beamer-Code; die Lehrkraft gibt ihn in der
// Präsentation unter „Beamer verbinden“ ein. Danach zeigt das Gerät über das Durable Object der Sitzung nur die aktuelle Folie, das Gerät der
// Lehrkraft weiter die aktuelle und die nächste. Ohne Anmeldung am Beamergerät:
//   1. POST /api/beamer/pair → Beamer-Code (6 Ziffern, 10 Minuten) und geheimer pairKey (in D1 nur dessen SHA-256)
//   2. die Lehrkraft koppelt: POST /api/teacher/lessons/:id/beamer {code} → Sitzung und Generation (beamerGen des Durable Objects) in der Zeile
//   3. das Gerät fragt alle 2 s nach (POST /api/beamer/pair/poll) und holt die Kopplung genau einmal ab (die Zeile wird gelöscht) – mit einem
//      signierten Beamer-Schlüssel (6 h) aus Sitzung und Generation
//   4. mit dem Schlüssel: Live-Ticket (WebSocket, Rolle „beamer“) bzw. Stand alle 2 s (Rückfall)
// „Beamer trennen“ erhöht die Generation im Durable Object: alle Schlüssel dieser Sitzung gelten nicht mehr, offene Verbindungen schließen.
import { HttpError, bad, json, readJson, isId, requireSecret, sha256Hex, timingSafeEqual, randomBytes, hex, signLink, checkLink, hitLimit, fmtWait } from "./lib.js";
import { BEAMER_PAIR_TTL_MS as PAIR_TTL, BEAMER_PAIR_KEEP_MS as PAIR_KEEP } from "./db.js";
import { requireTeacher } from "./auth.js";
import { liveTicket, stub } from "./live.js";
import { normBeamerCode, GS_SUBJECT } from "../public/shared.js";

export const BEAMER_TTL = 6 * 3600e3;                         // ein gekoppeltes Gerät bleibt 6 Stunden mit der Sitzung verbunden
export const PAIR_LIMIT = { max: 300, windowMs: 3600e3 };      // neue Beamer-Codes je IP und Stunde (Schulnetz: viele Geräte, eine IP)
export const BEAMER_CODE_GONE = "Diesen Beamer-Code gibt es nicht (mehr). Auf dem Beamer steht nach dem Neuladen ein neuer.";
const GONE = "Dieser Beamer-Code ist abgelaufen. Ein neuer wird geholt.";
const DISCONNECTED = "Dieses Gerät ist nicht mehr als Beamer verbunden.";

/* 6 Ziffern aus crypto.getRandomValues ohne Modulo-Verzerrung (Werte ab dem größten Vielfachen von 10^6 werden verworfen) */
export function pairCode(draw = () => crypto.getRandomValues(new Uint32Array(1))[0]) {
  const lim = Math.floor(2 ** 32 / 1e6) * 1e6;
  for (;;) { const x = draw(); if (x < lim) return String(x % 1e6).padStart(6, "0"); }
}
const pairHash = (pairKey) => sha256Hex("beamer-pair|v1|" + pairKey);
const isPairKey = (s) => typeof s === "string" && /^[a-f0-9]{32}$/.test(s);

/* Beamer-Schlüssel = Generation.Ablauf.Signatur (HMAC über „beamer|Sitzung|Generation|Ablauf“) – nie in Adressen außer im kurzlebigen Ticket */
export async function beamerKey(secret, lessonId, gen, now = Date.now()) {
  const { e, s } = await signLink(secret, ["beamer", lessonId, gen], BEAMER_TTL, now);
  return { key: gen + "." + e + "." + s, exp: e };
}
/* → Generation des Schlüssels oder null (falsch signiert, abgelaufen, andere Sitzung) */
export async function checkBeamerKey(secret, lessonId, key, now = Date.now()) {
  const m = /^(\d{1,9})\.(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/.exec(typeof key === "string" ? key : "");
  if (!m || !isId(lessonId)) return null;
  const gen = Number(m[1]);
  return (await checkLink(secret, ["beamer", lessonId, gen], m[2], m[3], now)) ? gen : null;
}
async function genOf(env, lessonId) {
  const r = await stub(env, lessonId).fetch("https://live/beamer-gen");
  const d = await r.json();
  return Number.isInteger(d && d.gen) ? d.gen : 0;
}
const gone403 = () => new HttpError(403, "beamer_gone", DISCONNECTED);

/* POST /api/beamer/pair (öffentlich): neuer Beamer-Code – 3 Anweisungen (Zähler je IP, abgelaufene Codes löschen, neuer Code) */
export async function routeBeamerPair(c) {
  await hitLimit(c.db, "bp:ip:" + (await sha256Hex("bpip|" + c.ip)), PAIR_LIMIT, c.now,
    (ms) => "Gerade wurden hier sehr viele Beamer-Codes abgerufen. Bitte warten Sie " + fmtWait(ms) + ".");
  const pairKey = hex(randomBytes(16)), kh = await pairHash(pairKey);
  for (let i = 0; i < 4; i++) {
    const code = pairCode();
    const [, ins] = await c.db.batch([
      c.db.prepare("DELETE FROM beamer_pairs WHERE created_at < ?1").bind(c.now - PAIR_KEEP),
      c.db.prepare("INSERT INTO beamer_pairs(code, key_hash, created_at) VALUES(?1, ?2, ?3) ON CONFLICT(code) DO NOTHING RETURNING code").bind(code, kh, c.now),
    ]);
    if (ins && ins.results && ins.results.length) return json({ ok: true, code, pairKey, expiresAt: c.now + PAIR_TTL, ttlMs: PAIR_TTL });
  }
  throw new HttpError(503, "busy", "Gerade ist kein Beamer-Code frei. Bitte gleich noch einmal versuchen.");
}

/* POST /api/beamer/pair/poll {code, pairKey} (öffentlich): {paired:false} bzw. einmal {paired:true, lessonId, key, exp}; sonst 404 pair_gone */
export async function routeBeamerPoll(c) {
  const body = await readJson(c.request, 2000);
  const code = normBeamerCode(body.code), pk = isPairKey(body.pairKey) ? body.pairKey : null;
  if (!code || !pk) throw new HttpError(404, "pair_gone", GONE);
  const row = await c.db.prepare("SELECT key_hash, created_at, lesson_id, beamer_gen FROM beamer_pairs WHERE code=?1").bind(code).first();
  const kh = await pairHash(pk);
  if (!row || !timingSafeEqual(row.key_hash, kh)) throw new HttpError(404, "pair_gone", GONE);
  if (!row.lesson_id) {
    if (row.created_at <= c.now - PAIR_TTL) throw new HttpError(404, "pair_gone", GONE);
    return json({ ok: true, paired: false, expiresInMs: row.created_at + PAIR_TTL - c.now });
  }
  if (row.created_at <= c.now - PAIR_KEEP) throw new HttpError(404, "pair_gone", GONE);
  // genau einmal: nur wer die Zeile löscht, bekommt den Schlüssel
  const del = await c.db.prepare("DELETE FROM beamer_pairs WHERE code=?1 AND key_hash=?2 AND lesson_id IS NOT NULL RETURNING lesson_id, beamer_gen").bind(code, kh).first();
  if (!del || !isId(del.lesson_id) || !Number.isInteger(del.beamer_gen)) throw new HttpError(404, "pair_gone", GONE);
  const k = await beamerKey(requireSecret(c.env), del.lesson_id, del.beamer_gen, c.now);
  return json({ ok: true, paired: true, lessonId: del.lesson_id, key: k.key, exp: k.exp });
}

/* POST /api/teacher/lessons/:id/beamer {code}: Beamer-Code eingeben – eine bedingte Anweisung (Code ≤ 10 Minuten alt, noch nicht gekoppelt) */
export async function routeTeacherBeamerPair(c, lessonId) {
  await requireTeacher(c);
  const body = await readJson(c.request, 2000);
  if (!isId(lessonId)) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
  const l = await c.db.prepare("SELECT subject FROM lessons WHERE id=?1").bind(lessonId).first();
  if (!l) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
  if (l.subject === GS_SUBJECT) throw bad("Sitzungen der Grundschule haben keine Präsentation.");
  const code = normBeamerCode(body.code);
  if (!code) throw bad("Bitte geben Sie die sechs Ziffern ein, die auf dem Beamer stehen.", "bad_code");
  const gen = await genOf(c.env, lessonId);
  const r = await c.db.prepare("UPDATE beamer_pairs SET lesson_id=?2, beamer_gen=?3, paired_at=?4 WHERE code=?1 AND lesson_id IS NULL AND created_at > ?5 RETURNING code")
    .bind(code, lessonId, gen, c.now, c.now - PAIR_TTL).first();
  if (!r) throw new HttpError(404, "beamer_code", BEAMER_CODE_GONE);
  return json({ ok: true });
}

/* POST /api/teacher/lessons/:id/beamer/disconnect: alle Beamergeräte dieser Sitzung trennen (ohne D1) */
export async function routeTeacherBeamerDisconnect(c, lessonId) {
  await requireTeacher(c);
  if (!isId(lessonId)) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
  await stub(c.env, lessonId).fetch("https://live/beamer-reset", { method: "POST" });
  return json({ ok: true });
}

async function beamerBody(c) {
  const body = await readJson(c.request, 2000);
  const lessonId = isId(body.lessonId) ? body.lessonId : null;
  const gen = lessonId ? await checkBeamerKey(requireSecret(c.env), lessonId, body.key, c.now) : null;
  if (gen === null) throw gone403();
  return { lessonId, gen };
}
/* POST /api/beamer/live-ticket {lessonId, key}: kurzlebiges WebSocket-Ticket (Rolle beamer) und das Fach (Farbe der Codefolie) */
export async function routeBeamerTicket(c) {
  const { lessonId, gen } = await beamerBody(c);
  const [l, cur] = await Promise.all([c.db.prepare("SELECT subject FROM lessons WHERE id=?1").bind(lessonId).first(), genOf(c.env, lessonId)]);
  if (!l || l.subject === GS_SUBJECT || cur !== gen) throw gone403();
  return json({ ok: true, fach: l.subject, ...(await liveTicket(c, lessonId, "beamer", String(gen))) });
}
/* POST /api/beamer/live {lessonId, key}: Stand der Präsentation (Rückfall, wenn der WebSocket ausfällt) – ohne D1 */
export async function routeBeamerLive(c) {
  const { lessonId, gen } = await beamerBody(c);
  const r = await stub(c.env, lessonId).fetch("https://live/state?role=beamer&gen=" + gen);
  if (r.status === 403) throw gone403();
  return json({ ok: true, live: await r.json() });
}
