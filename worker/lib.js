// lib.js – Hilfsfunktionen des Unterricks-Workers (ohne Abhängigkeiten): Antworten, Fehler, Kodierung, Krypto, Sperren.
import { CODE_ALPHABET } from "../public/shared.js";

export const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const bad = (msg, code = "bad_request") => new HttpError(400, code, msg);

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, ...headers } });
}
export function fail(status, code, error, extra = {}) {
  const h = {};
  if (extra.retryAfter) h["Retry-After"] = String(Math.ceil(extra.retryAfter));
  return json({ ok: false, error, code, ...extra }, status, h);
}

export async function readJson(request, max = 1_000_000) {
  const len = Number(request.headers.get("content-length"));
  if (len > max) throw new HttpError(413, "too_large", "Die Anfrage ist zu groß.");
  let text;
  try { text = await request.text(); } catch { throw bad("Die Anfrage konnte nicht gelesen werden."); }
  if (text.length > max) throw new HttpError(413, "too_large", "Die Anfrage ist zu groß.");
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { throw bad("Ungültiges JSON."); }
}

/* ---------- Kodierung ---------- */
const TE = new TextEncoder();
export const utf8 = (s) => TE.encode(String(s));
export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const hex = (bytes) => Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomToken = (n = 32) => b64u(randomBytes(n));
export const randomId = (n = 8) => hex(randomBytes(n));

/* Sitzungscode ohne Modulo-Verzerrung, mindestens ein Buchstabe und eine Ziffer */
export function generateCode() {
  const A = CODE_ALPHABET, lim = 256 - (256 % A.length);
  for (;;) {
    let c = "";
    while (c.length < 6) { for (const b of randomBytes(12)) { if (b < lim && c.length < 6) c += A[b % A.length]; } }
    if (/[A-Z]/.test(c) && /[0-9]/.test(c)) return c;
  }
}

/* ---------- Krypto ---------- */
export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}
export function timingSafeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
const keyCache = new Map();
async function hmacKey(secret) {
  let k = keyCache.get(secret);
  if (!k) { k = await crypto.subtle.importKey("raw", utf8("unterricks/hmac/v1|" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); keyCache.set(secret, k); }
  return k;
}
export async function hmac(secret, msg) {
  return b64u(await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(msg)));
}
export async function hmacOk(secret, msg, sig) {
  return typeof sig === "string" && sig.length > 0 && timingSafeEqual(await hmac(secret, msg), sig);
}
async function aesKey(secret) {
  const raw = await crypto.subtle.digest("SHA-256", utf8("unterricks/keys/v1|" + secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/* API-Schlüssel der KI-Anbieter verschlüsselt ablegen (SETTINGS_SECRET bleibt im Worker) */
export async function sealSecret(secret, plain) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), utf8(plain));
  return b64u(iv) + "." + b64u(ct);
}
export async function openSecret(secret, sealed) {
  const [iv, ct] = String(sealed || "").split(".");
  if (!iv || !ct) throw new Error("sealed");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(secret), unb64u(ct));
  return new TextDecoder().decode(pt);
}
export function requireSecret(env) {
  const s = env.SETTINGS_SECRET;
  if (!s || String(s).length < 16) throw new HttpError(503, "server_not_configured", "Der Server ist noch nicht vollständig eingerichtet (SETTINGS_SECRET fehlt).");
  return String(s);
}

/* Signierte, kurzlebige Links (Downloads, Folienbilder, Live-Tickets) */
export async function signLink(secret, parts, ttlMs, now = Date.now()) {
  const e = now + ttlMs;
  return { e, s: await hmac(secret, parts.join("|") + "|" + e) };
}
export async function checkLink(secret, parts, e, s, now = Date.now()) {
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < now) return false;
  return hmacOk(secret, parts.join("|") + "|" + exp, s);
}

/* ---------- Eingaben ---------- */
export const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function cleanText(s, max) {
  const t = String(s == null ? "" : s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return max && t.length > max ? t.slice(0, max) : t;
}
export const cleanLine = (s, max) => cleanText(s, max).replace(/\s+/g, " ").trim();
export const isDeviceId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{22,64}$/.test(s);
export const isId = (s) => typeof s === "string" && /^[a-f0-9]{16}$/.test(s);
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function clientIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  if (ip.includes(":")) return ip.split(":").slice(0, 4).join(":") + "::/64";   // IPv6: /64 bündeln
  return ip;
}

/* ---------- Sperren und Fehlversuche (Tabelle locks) ----------
 * Zählt Fehlversuche je Schlüssel in einem festen Fenster; ab `max` wird der Schlüssel für `lockMs` gesperrt. */
export const LOCKS = {
  teacherDevice: { max: 2, windowMs: 24 * 3600e3, lockMs: 30 * 60e3 },          // 2 Fehlversuche → 30 min (Vorgabe)
  teacherUnknown: { max: 20, windowMs: 3600e3, lockMs: 3600e3 },                // alle unbekannten Geräte zusammen
  studentDevice: { max: 10, windowMs: 3600e3, lockMs: 60e3 },                   // 10 Fehlversuche → 1 min (Vorgabe)
  studentIp: { max: 300, windowMs: 10 * 60e3, lockMs: 10 * 60e3 },              // Schulnetz: viele teilen eine IP
  joinDevice: { max: 15, windowMs: 10 * 60e3, lockMs: 5 * 60e3 },               // falsche Sitzungscodes
  joinIp: { max: 300, windowMs: 10 * 60e3, lockMs: 10 * 60e3 },
  mcp: { max: 30, windowMs: 10 * 60e3, lockMs: 10 * 60e3 },
  askDevice: { max: 12, windowMs: 10 * 60e3, lockMs: 10 * 60e3 },               // KI-Begriffshilfe: je Gerät 12 Fragen je 10 Minuten
  askLesson: { max: 300, windowMs: 3600e3, lockMs: 15 * 60e3 },                // … je Sitzung 300 Fragen je Stunde (Kontingent der kostenlosen KI)
  setup: { max: 10, windowMs: 3600e3, lockMs: 3600e3 },
  parentIp: { max: 30, windowMs: 10 * 60e3, lockMs: 10 * 60e3 },               // Elternansicht: ungültige Links je IP
};
export async function lockedFor(db, key, now = Date.now()) {
  const r = await db.prepare("SELECT locked_until FROM locks WHERE k=?1").bind(key).first();
  return r && r.locked_until > now ? r.locked_until - now : 0;
}
export async function registerFail(db, key, rule, now = Date.now()) {
  const r = await db.prepare(
    "INSERT INTO locks(k, fails, window_start, locked_until) VALUES(?1, 1, ?2, 0) " +
    "ON CONFLICT(k) DO UPDATE SET fails = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE fails + 1 END, " +
    "window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END RETURNING fails").bind(key, now, rule.windowMs).first();
  const fails = (r && r.fails) || 1;
  if (fails >= rule.max) {
    await db.prepare("UPDATE locks SET locked_until=?2, fails=0, window_start=?3 WHERE k=?1").bind(key, now + rule.lockMs, now).run();
    return { locked: true, lockMs: rule.lockMs, left: 0 };
  }
  return { locked: false, left: rule.max - fails };
}
export const clearFails = (db, key) => db.prepare("DELETE FROM locks WHERE k=?1").bind(key).run();
/* Zähler für öffentliche Aufrufe (nicht nur Fehlversuche) in einem festen Fenster – eine Anweisung (Upsert … RETURNING) in derselben
   Tabelle; mehr als rule.max Aufrufe im Fenster → 429 bis zum Ende des Fensters. rule = {max, windowMs} */
export async function hitLimit(db, key, rule, now, msg) {
  const r = await db.prepare(
    "INSERT INTO locks(k, fails, window_start, locked_until) VALUES(?1, 1, ?2, 0) " +
    "ON CONFLICT(k) DO UPDATE SET fails = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE fails + 1 END, " +
    "window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END RETURNING fails, window_start").bind(key, now, rule.windowMs).first();
  if (r && r.fails > rule.max) throw lockedError(Math.max(1000, r.window_start + rule.windowMs - now), msg && msg(Math.max(1000, r.window_start + rule.windowMs - now)));
}
export const lockedError = (ms, msg) => new HttpError(429, "locked", msg || ("Zu viele Fehlversuche. Bitte warten Sie " + fmtWait(ms) + "."), { retryAfter: Math.ceil(ms / 1000) });
export function fmtWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return s + " Sekunden";
  return Math.ceil(s / 60) + " Minuten";
}

/* Content-Disposition mit Umlauten (RFC 6266/5987) */
export function contentDisposition(name, attachment = true) {
  const safe = String(name || "datei").replace(/[\r\n"\\]/g, "_");
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return (attachment ? "attachment" : "inline") + "; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(safe);
}
/* Nur diese Typen dürfen im Browser direkt angezeigt werden (keine HTML/SVG-Ausführung auf unserer Herkunft) */
export const INLINE_SAFE = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif)|text\/plain)$/i;

/* Die Oberfläche kann auch von GitHub Pages kommen (z. B. https://unterricks.janrickmer.de): Anfragen von dort an /api sind
 * erlaubt (CORS). Angemeldet wird nur über „Authorization: Bearer“, nie über Cookies – fremde Seiten erhalten so nichts. */
/* Herkünfte: https ohne Pfad; für lokale Tests auch http://localhost:PORT bzw. http://127.0.0.1:PORT */
export const pagesOrigins = (env) => String((env && env.PAGES_ORIGINS) || "").split(/[\s,]+/).filter((o) => /^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1):\d+)$/i.test(o));
export function corsHeaders(request, env) {
  const o = request.headers.get("Origin");
  if (!o || !pagesOrigins(env).includes(o)) return null;
  return { "Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "Access-Control-Max-Age": "86400", "Access-Control-Expose-Headers": "Content-Disposition" };
}
export function withCors(res, cors) {
  if (!cors || !res || res.status === 101 || res.webSocket) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
