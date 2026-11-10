// fblink.js – Feibeitsblatt-Verbindung einmalig speichern, Ende-zu-Ende verschlüsselt (Wunsch der Lehrkraft vom 10.11.2026).
// Aus dem Unterricks-Passwort leitet der Browser per PBKDF2-SHA-256 (600 000 Iterationen) 64 Byte ab: Die ersten 32 sind wie bisher
// der Anmeldeschlüssel (der Server speichert nur dessen SHA-256), die zweiten 32 verlassen den Browser nie und ergeben per HKDF den
// Schlüssel für die gespeicherte Verbindung (AES-GCM-256). Gespeichert wird nur der Feibeitsblatt-Schlüssel (das PBKDF2-Ergebnis des
// Feibeitsblatt-Passworts), nie ein Passwort. Der Server bewahrt den Umschlag auf und kann ihn nicht öffnen. Auf jedem Gerät liegt der
// Schlüssel nicht exportierbar in IndexedDB – so verbindet sich Unterricks nach dem Neuladen von selbst; nach dem Abmelden ist er weg.
const subtle = globalThis.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
export const LINK_INFO = "unterricks/fb-link/v1";
const AAD = te.encode(LINK_INFO);

export const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => { const bin = atob(String(s)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
export const b64u = (u8) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); return unb64(t + "===".slice((t.length + 3) % 4)); };

/* Unterricks-Passwort → { authKey (wie bisher, für den Server), wrapKey (nur im Browser, nicht exportierbar) } */
export async function deriveLogin(password, saltB64u, iterations) {
  const base = await subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(saltB64u), iterations }, base, 512));
  const authKey = b64u(bits.subarray(0, 32));   // = PBKDF2 mit 32 Byte (erster Block) – bestehende Zugänge gelten weiter
  const hk = await subtle.importKey("raw", bits.subarray(32, 64), "HKDF", false, ["deriveKey"]);
  const wrapKey = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: AAD }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  bits.fill(0);
  return { authKey, wrapKey };
}

/* Inhalt des Umschlags: zu welchem Feibeitsblatt (Schnittstelle) und dessen Schlüssel (32 Byte) */
export const linkData = (api, master) => ({ v: 1, kind: "unterricks-fb-link", api: String(api || ""), master: b64(master), savedAt: Date.now() });
export async function sealLink(wrapKey, data) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, wrapKey, te.encode(JSON.stringify(data))));
  return { v: 1, iv: b64(iv), ct: b64(ct) };
}
/* Umschlag öffnen; wirft, wenn der Schlüssel nicht passt (anderes Passwort) oder der Inhalt nicht stimmt */
export async function openLink(wrapKey, env) {
  if (!env || env.v !== 1 || typeof env.iv !== "string" || typeof env.ct !== "string") throw new Error("Unbekanntes Format der gespeicherten Verbindung.");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv), additionalData: AAD }, wrapKey, unb64(env.ct));
  const d = JSON.parse(td.decode(pt));
  if (!d || d.v !== 1 || d.kind !== "unterricks-fb-link" || typeof d.master !== "string" || typeof d.api !== "string") throw new Error("Unbekannter Inhalt der gespeicherten Verbindung.");
  const master = unb64(d.master);
  if (master.length !== 32) throw new Error("Unbekannter Inhalt der gespeicherten Verbindung.");
  return { api: d.api, master, savedAt: Number(d.savedAt) || null };
}
export const sameApi = (a, b) => String(a || "").replace(/\/+$/, "") === String(b || "").replace(/\/+$/, "");

/* ---------- Schlüssel je Gerät (IndexedDB; nicht exportierbar – Skripte dieser Seite können ihn benutzen, aber nicht auslesen) ---------- */
const IDB = "unterricks", STORE = "keys", KEY_ID = "fb-link";
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB fehlt")); return; }
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("IndexedDB"));
    r.onblocked = () => reject(new Error("IndexedDB blockiert"));
  });
}
async function idbDo(mode, fn) {
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("IndexedDB"));
    });
  } finally { db.close(); }
}
export async function rememberKey(key) { try { await idbDo("readwrite", (s) => s.put(key, KEY_ID)); return true; } catch { return false; } }
export async function recallKey() {
  try {
    const k = await idbDo("readonly", (s) => s.get(KEY_ID));
    return k && k.type === "secret" && k.algorithm && k.algorithm.name === "AES-GCM" && !k.extractable ? k : null;
  } catch { return null; }
}
export async function forgetKey() { try { await idbDo("readwrite", (s) => s.delete(KEY_ID)); } catch {} }
