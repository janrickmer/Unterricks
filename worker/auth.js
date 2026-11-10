// auth.js – Anmeldung der Lehrkraft (Benutzername + Passwort, PBKDF2 im Browser) und der Schüler:innen (gemeinsames Passwort).
// Sperren laut Vorgabe: Lehrkraft 2 Fehlversuche → 30 min je Gerät (eigene, bekannte Geräte bleiben nutzbar; unbekannte Geräte
// zusammen höchstens 20 Fehlversuche/Stunde), Schüler:innen 10 Fehlversuche → 1 min je Gerät.
import {
  HttpError, bad, json, readJson, sha256Hex, timingSafeEqual, hmac, randomToken, randomId, unb64u, isDeviceId,
  cleanLine, clientIp, LOCKS, lockedFor, registerFail, clearFails, lockedError, fmtWait, requireSecret,
} from "./lib.js";
import { getSetting, setSetting, setSettingStmt } from "./db.js";
import { isValidClass, isValidSubject, classAllowed, subjectName, classShort } from "../public/shared.js";
import { loadSubjectConfigs } from "./bases.js";

export const TOKEN_TTL = 30 * 86400e3;
const ITER = 600000;
export const DEFAULT_STUDENT_PASSWORD = "Feindt";

const isAuthKey = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
const isSalt = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{22,88}$/.test(s);
const normUser = (s) => cleanLine(s, 60).toLowerCase();
const bearer = (request) => { const m = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") || ""); return m ? m[1] : null; };
const authHash = async (authKey) => sha256Hex(unb64u(authKey));
const deviceHash = (deviceId) => sha256Hex("tdev|" + deviceId);

async function teacherRow(db) {
  return db.prepare("SELECT username, salt, iterations, auth_hash FROM teacher WHERE id=1").first();
}

/* ---------- Lehrkraft ---------- */
export async function routeTeacherStatus(c) {
  const t = await teacherRow(c.db);
  return json({ ok: true, setup: !!t, setupCodeRequired: !t && !!c.env.SETUP_CODE });
}

// Salz zum Benutzernamen; bei unbekanntem Namen ein gleichbleibendes Schein-Salz (keine Auskunft, ob der Name stimmt)
export async function routeTeacherSalt(c) {
  const body = await readJson(c.request);
  const user = normUser(body.username);
  const t = await teacherRow(c.db);
  if (t && user && timingSafeEqual(user, t.username)) return json({ ok: true, salt: t.salt, iterations: t.iterations });
  const fake = (await hmac(requireSecret(c.env), "salt|" + user)).slice(0, 22);
  return json({ ok: true, salt: fake, iterations: ITER });
}

export async function routeTeacherSetup(c) {
  const body = await readJson(c.request);
  if (await teacherRow(c.db)) throw new HttpError(409, "already_setup", "Der Lehrkraft-Zugang ist bereits eingerichtet.");
  if (c.env.SETUP_CODE) {
    const key = "setup:" + (await sha256Hex(c.ip));
    const ms = await lockedFor(c.db, key, c.now);
    if (ms) throw lockedError(ms);
    if (!timingSafeEqual(String(body.setupCode || ""), String(c.env.SETUP_CODE))) {
      await registerFail(c.db, key, LOCKS.setup, c.now);
      throw new HttpError(403, "wrong_setup_code", "Der Einrichtungscode ist falsch.");
    }
  }
  const user = normUser(body.username);
  if (!user || user.length < 3) throw bad("Bitte einen Benutzernamen mit mindestens 3 Zeichen wählen.");
  if (!isSalt(body.salt) || !isAuthKey(body.authKey) || Number(body.iterations) !== ITER) throw bad("Ungültige Anmeldedaten.");
  if (!isDeviceId(body.deviceId)) throw bad("Ungültige Gerätekennung.");
  const r = await c.db.prepare("INSERT INTO teacher(id, username, salt, iterations, auth_hash, created_at, updated_at) VALUES(1, ?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(id) DO NOTHING")
    .bind(user, body.salt, ITER, await authHash(body.authKey), c.now).run();
  if (!r.meta || !r.meta.changes) throw new HttpError(409, "already_setup", "Der Lehrkraft-Zugang ist bereits eingerichtet.");
  return json({ ok: true, ...(await issueToken(c, body.deviceId)) });
}

async function issueToken(c, deviceId) {
  const dh = await deviceHash(deviceId), token = randomToken(32), exp = c.now + TOKEN_TTL;
  await c.db.batch([
    c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, ?2, ?3, ?4, ?3)").bind(await sha256Hex(token), dh, c.now, exp),
    c.db.prepare("INSERT INTO trusted_devices(device_hash, label, created_at, last_login) VALUES(?1, ?2, ?3, ?3) ON CONFLICT(device_hash) DO UPDATE SET last_login=excluded.last_login, label=excluded.label")
      .bind(dh, cleanLine(c.request.headers.get("user-agent") || "", 160), c.now),
  ]);
  return { token, expiresAt: exp };
}

export async function routeTeacherLogin(c) {
  const body = await readJson(c.request);
  if (!isDeviceId(body.deviceId)) throw bad("Ungültige Gerätekennung. Bitte die Seite neu laden.");
  const dh = await deviceHash(body.deviceId), devKey = "t:dev:" + dh;
  let ms = await lockedFor(c.db, devKey, c.now);
  if (ms) throw lockedError(ms, "Nach zwei Fehlversuchen ist die Anmeldung auf diesem Gerät gesperrt. Bitte warten Sie noch " + fmtWait(ms) + ".");
  const trusted = !!(await c.db.prepare("SELECT 1 AS x FROM trusted_devices WHERE device_hash=?1").bind(dh).first());
  if (!trusted) {
    ms = await lockedFor(c.db, "t:unknown", c.now);
    if (ms) throw lockedError(ms, "Von unbekannten Geräten gab es zu viele Fehlversuche. Bitte melden Sie sich von einem Gerät an, auf dem Sie schon angemeldet waren, oder warten Sie " + fmtWait(ms) + ".");
  }
  const t = await teacherRow(c.db);
  if (!t) throw new HttpError(409, "not_setup", "Der Lehrkraft-Zugang ist noch nicht eingerichtet.");
  const ok = isAuthKey(body.authKey) && timingSafeEqual(normUser(body.username), t.username) && timingSafeEqual(await authHash(body.authKey), t.auth_hash);
  if (!ok) {
    const r = await registerFail(c.db, devKey, LOCKS.teacherDevice, c.now);
    if (!trusted) await registerFail(c.db, "t:unknown", LOCKS.teacherUnknown, c.now);
    if (r.locked) throw lockedError(r.lockMs, "Benutzername oder Passwort falsch. Die Anmeldung ist auf diesem Gerät jetzt für 30 Minuten gesperrt.");
    throw new HttpError(401, "wrong_credentials", "Benutzername oder Passwort falsch. Noch " + r.left + " Versuch" + (r.left === 1 ? "" : "e") + ", dann wird dieses Gerät für 30 Minuten gesperrt.", { left: r.left });
  }
  await clearFails(c.db, devKey);
  return json({ ok: true, username: t.username, ...(await issueToken(c, body.deviceId)) });
}

export async function requireTeacher(c) {
  const tok = bearer(c.request);
  if (!tok || tok.length > 100) throw new HttpError(401, "unauthorized", "Bitte melden Sie sich an.");
  const h = await sha256Hex(tok);
  const r = await c.db.prepare("SELECT device_hash, expires_at, last_used FROM teacher_tokens WHERE token_hash=?1").bind(h).first();
  if (!r || r.expires_at < c.now) throw new HttpError(401, "unauthorized", "Ihre Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.");
  if (c.now - r.last_used > 3600e3) c.waitUntil(c.db.prepare("UPDATE teacher_tokens SET last_used=?2 WHERE token_hash=?1").bind(h, c.now).run());
  c.teacher = { tokenHash: h, deviceHash: r.device_hash };
  return c.teacher;
}

export async function routeTeacherLogout(c) {
  const t = await requireTeacher(c);
  await c.db.prepare("DELETE FROM teacher_tokens WHERE token_hash=?1").bind(t.tokenHash).run();
  return json({ ok: true });
}

export async function routeTeacherMe(c) {
  const me = await requireTeacher(c);
  const [t, dev] = await c.db.batch([
    c.db.prepare("SELECT username FROM teacher WHERE id=1"),
    c.db.prepare("SELECT device_hash, label, created_at, last_login FROM trusted_devices ORDER BY last_login DESC LIMIT 50"),
  ]);
  return json({ ok: true, username: (t.results[0] || {}).username || "",
    devices: (dev.results || []).map((d) => ({ id: d.device_hash.slice(0, 16), label: d.label || "", createdAt: d.created_at, lastLogin: d.last_login, current: d.device_hash === me.deviceHash })) });
}

// Alle anderen Geräte vergessen und abmelden (das aktuelle bleibt)
export async function routeTeacherForgetDevices(c) {
  const me = await requireTeacher(c);
  await c.db.batch([
    c.db.prepare("DELETE FROM trusted_devices WHERE device_hash<>?1").bind(me.deviceHash),
    c.db.prepare("DELETE FROM teacher_tokens WHERE device_hash<>?1").bind(me.deviceHash),
  ]);
  return json({ ok: true });
}

export async function routeTeacherPassword(c) {
  const me = await requireTeacher(c);
  const body = await readJson(c.request, 20000);
  const t = await teacherRow(c.db);
  if (!isAuthKey(body.oldAuthKey) || !timingSafeEqual(await authHash(body.oldAuthKey), t.auth_hash))
    throw new HttpError(403, "wrong_credentials", "Das bisherige Passwort ist falsch.");
  if (!isSalt(body.salt) || !isAuthKey(body.authKey)) throw bad("Ungültige Anmeldedaten.");
  const user = body.username != null ? normUser(body.username) : t.username;
  if (user.length < 3) throw bad("Bitte einen Benutzernamen mit mindestens 3 Zeichen wählen.");
  // gespeicherte Feibeitsblatt-Verbindung: der Browser hat sie mit dem Schlüssel aus dem neuen Passwort neu verschlüsselt (fbLink);
  // ohne neuen Umschlag ließe sie sich nicht mehr öffnen und wird gelöscht
  const link = cleanFbLink(body.fbLink);
  await c.db.batch([
    c.db.prepare("UPDATE teacher SET username=?1, salt=?2, auth_hash=?3, updated_at=?4 WHERE id=1").bind(user, body.salt, await authHash(body.authKey), c.now),
    c.db.prepare("DELETE FROM teacher_tokens WHERE token_hash<>?1").bind(me.tokenHash),
    link ? setSettingStmt(c.db, FB_LINK_KEY, { ...link, at: c.now }) : c.db.prepare("DELETE FROM settings WHERE key=?1").bind(FB_LINK_KEY),
  ]);
  return json({ ok: true, username: user, fbLink: !!link });
}

/* ---------- Gespeicherte Feibeitsblatt-Verbindung (Ende-zu-Ende verschlüsselt, public/fblink.js) ----------
 * Der Browser verschlüsselt den Feibeitsblatt-Schlüssel mit einem Schlüssel aus dem Unterricks-Passwort, den der Server nie sieht
 * (zweiter PBKDF2-Block). Hier liegt nur der Umschlag {v, iv, ct}; öffnen kann ihn nur der Browser der Lehrkraft. */
export const FB_LINK_KEY = "fb_link";
const isB64 = (s, min, max) => typeof s === "string" && s.length >= min && s.length <= max && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
export const cleanFbLink = (x) => (x && typeof x === "object" && x.v === 1 && isB64(x.iv, 16, 16) && isB64(x.ct, 24, 4000) ? { v: 1, iv: x.iv, ct: x.ct } : null);
export async function routeFbLinkGet(c) {
  await requireTeacher(c);
  const l = await getSetting(c.db, FB_LINK_KEY), link = cleanFbLink(l);
  return json({ ok: true, link: link ? { ...link, at: Number(l.at) || null } : null });
}
export async function routeFbLinkPut(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 10000);
  const link = cleanFbLink(body.link);
  if (!link) throw bad("Ungültige Verbindungsdaten.");
  await setSetting(c.db, FB_LINK_KEY, { ...link, at: c.now });
  return json({ ok: true, at: c.now });
}
export async function routeFbLinkDelete(c) {
  await requireTeacher(c);
  await c.db.prepare("DELETE FROM settings WHERE key=?1").bind(FB_LINK_KEY).run();
  return json({ ok: true });
}

/* ---------- Schüler:innen ---------- */
export async function studentPassword(db) {
  const s = await getSetting(db, "student");
  return (s && typeof s.password === "string" && s.password) || DEFAULT_STUDENT_PASSWORD;
}

export async function routeStudentLogin(c) {
  const body = await readJson(c.request, 20000);
  if (!isDeviceId(body.deviceId)) throw bad("Ungültige Gerätekennung. Bitte die Seite neu laden.");
  const devKey = "s:dev:" + (await sha256Hex("sdev|" + body.deviceId)), ipKey = "s:ip:" + (await sha256Hex("sip|" + c.ip));
  let ms = await lockedFor(c.db, devKey, c.now);
  if (ms) throw lockedError(ms, "Zu viele falsche Versuche. Bitte warte " + fmtWait(ms) + ".");
  ms = await lockedFor(c.db, ipKey, c.now);
  if (ms) throw lockedError(ms, "Gerade gab es sehr viele falsche Versuche. Bitte warte " + fmtWait(ms) + ".");
  const pw = await studentPassword(c.db);
  const given = String(body.password || "").trim();
  // Groß-/Kleinschreibung egal (Tablet-Tastaturen schreiben das erste Zeichen oft groß bzw. klein)
  if (!given || !timingSafeEqual(given.toLowerCase(), pw.toLowerCase())) {
    const r = await registerFail(c.db, devKey, LOCKS.studentDevice, c.now);
    await registerFail(c.db, ipKey, LOCKS.studentIp, c.now);
    if (r.locked) throw lockedError(r.lockMs, "Das Passwort ist falsch. Nach zehn falschen Versuchen musst du jetzt eine Minute warten.");
    throw new HttpError(401, "wrong_password", "Das Passwort ist leider falsch. Versuch es noch einmal.", { left: r.left });
  }
  await clearFails(c.db, devKey);
  // vorhandenes Gerät weiterverwenden (Freischaltungen bleiben), sonst neu anlegen
  const old = typeof body.token === "string" && body.token.length <= 100 ? await studentByToken(c.db, body.token) : null;
  if (old) return json({ ok: true, token: body.token, profile: { klass: old.klass, subject: old.subject } });
  const token = randomToken(32), id = randomId(8);
  await c.db.prepare("INSERT INTO student_devices(id, token_hash, created_at, last_seen) VALUES(?1, ?2, ?3, ?3)").bind(id, await sha256Hex(token), c.now).run();
  return json({ ok: true, token, profile: { klass: null, subject: null } });
}

async function studentByToken(db, token) {
  return db.prepare("SELECT id, klass, subject, last_seen FROM student_devices WHERE token_hash=?1").bind(await sha256Hex(token)).first();
}

export async function requireStudent(c) {
  const tok = bearer(c.request);
  const s = tok && tok.length <= 100 ? await studentByToken(c.db, tok) : null;
  if (!s) throw new HttpError(401, "unauthorized", "Bitte gib zuerst das Passwort ein.");
  if (c.now - s.last_seen > 6 * 3600e3) c.waitUntil(c.db.prepare("UPDATE student_devices SET last_seen=?2 WHERE id=?1").bind(s.id, c.now).run());
  c.student = s;
  return s;
}

export async function routeStudentProfile(c) {
  const s = await requireStudent(c);
  const body = await readJson(c.request, 10000);
  if (!isValidClass(body.klass)) throw bad("Bitte wähle eine gültige Klasse.");
  if (!isValidSubject(body.subject)) throw bad("Bitte wähle eines der drei Fächer.");
  const cfg = (await loadSubjectConfigs(c.db))[body.subject];
  if (!classAllowed(cfg, body.klass)) throw bad(subjectName(body.subject) + " gibt es in " + classShort(body.klass) + " nicht. Bitte prüfe deine Auswahl.");
  await c.db.prepare("UPDATE student_devices SET klass=?2, subject=?3 WHERE id=?1").bind(s.id, body.klass, body.subject).run();
  return json({ ok: true, profile: { klass: body.klass, subject: body.subject } });
}

/* ---------- Einstellungen zum Schülerzugang (Lehrkraft) ---------- */
export async function routeStudentSettingsGet(c) {
  await requireTeacher(c);
  return json({ ok: true, password: await studentPassword(c.db) });
}
export async function routeStudentSettingsPut(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 10000);
  const pw = cleanLine(body.password, 60);
  if (pw.length < 4) throw bad("Das Schülerpasswort muss mindestens 4 Zeichen lang sein.");
  await setSetting(c.db, "student", { password: pw });
  return json({ ok: true, password: pw });
}
