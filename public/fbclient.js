// fbclient.js – Anbindung an das bestehende Feibeitsblatt (Lehrkraft-API) direkt aus dem Browser der Lehrkraft.
// Das Feibeitsblatt-Passwort verlässt den Browser nie: daraus werden wie im Feibeitsblatt selbst per PBKDF2 (600 000 Iterationen)
// und HKDF der Anmeldeschlüssel und der Schlüssel zum Öffnen des privaten RSA-Schlüssels abgeleitet. Abgaben werden hier entschlüsselt.
// Schlüssel liegen nur im Arbeitsspeicher (Wunsch der Lehrkraft: bei jeder Anmeldung neu eingeben).
const subtle = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const b64 = (buf) => { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(String(s)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");

export class FbError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }

export class FbClient {
  constructor(apiBase) { this.base = String(apiBase || "").replace(/\/+$/, ""); this.authKey = null; this.priv = null; }
  get connected() { return !!(this.authKey && this.priv); }
  disconnect() { this.authKey = null; this.priv = null; }

  async call(method, path, body, auth = true) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) { if (!this.authKey) throw new FbError("Bitte zuerst mit Feibeitsblatt verbinden.", 401); headers.Authorization = "Bearer " + this.authKey; }
    let res;
    try { res = await fetch(this.base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "omit", cache: "no-store" }); }
    catch { throw new FbError("Feibeitsblatt ist nicht erreichbar (" + this.base + ").", 0); }
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok || !data || data.ok !== true) {
      if (res.status === 401 && auth) this.disconnect();
      throw new FbError((data && data.error) || "Feibeitsblatt: Fehler " + res.status, res.status, data && data.code);
    }
    return data;
  }

  async derive(password, kdf) {
    const it = Number(kdf && kdf.iterations);
    if (!Number.isInteger(it) || it < 100000 || it > 10000000) throw new FbError("Unerwartete Schlüsselparameter von Feibeitsblatt.");
    const base = await subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(kdf.salt), iterations: it }, base, 256);
    const master = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey", "deriveBits"]);
    const encKey = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("feibeitsblatt/enc/v1") }, master, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const auth = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("feibeitsblatt/auth/v1") }, master, 256);
    return { encKey, authKey: b64(auth) };
  }

  /* Türcode + Passwort → angemeldet, privater Schlüssel entschlüsselt (nicht exportierbar) */
  async connect(doorCode, password) {
    const door = await this.call("POST", "/api/teacher/door", { doorCode: String(doorCode || "").trim() }, false);
    if (!door.setup) throw new FbError("Im Feibeitsblatt ist noch kein Lehrkraft-Zugang eingerichtet. Bitte dort zuerst ein Passwort festlegen.");
    const keys = await this.derive(password, door.kdf);
    this.authKey = keys.authKey;
    let r;
    try { r = await this.call("POST", "/api/teacher/login"); }
    catch (e) { this.disconnect(); if (e.status === 401) throw new FbError("Das Feibeitsblatt-Passwort ist falsch.", 401); throw e; }
    try {
      const pkcs8 = await subtle.decrypt({ name: "AES-GCM", iv: unb64(r.encPrivateKey.iv) }, keys.encKey, unb64(r.encPrivateKey.ct));
      this.priv = await subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
    } catch { this.disconnect(); throw new FbError("Der Schlüssel für die Abgaben ließ sich nicht öffnen."); }
    return true;
  }

  async open(env) {
    if (typeof env === "string") env = JSON.parse(env);
    if (!env || env.v !== 1) throw new Error("Umschlag");
    const raw = await subtle.decrypt({ name: "RSA-OAEP" }, this.priv, unb64(env.ek));
    const K = await subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
    return JSON.parse(td.decode(await subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, K, unb64(env.ct))));
  }

  listSheets() { return this.call("GET", "/api/teacher/sheets"); }
  getSheet(code) { return this.call("GET", "/api/teacher/sheets/" + encodeURIComponent(code)); }
  aiStatus() { return this.call("GET", "/api/teacher/ai"); }
  setFinalWait(sec) { return this.call("PUT", "/api/teacher/final-wait", { waitSec: Number(sec) }); }
  checklistGet(code) { return this.call("GET", "/api/teacher/sheets/" + encodeURIComponent(code) + "/checklist"); }
  checklistPropose(code, force) { return this.call("POST", "/api/teacher/sheets/" + encodeURIComponent(code) + "/checklist", force ? { force: true } : {}); }
  checklistSave(code, ai, tasks) { return this.call("PUT", "/api/teacher/sheets/" + encodeURIComponent(code) + "/checklist", { ai: !!ai, tasks }); }

  /* Entwurf (Plattform-Format) → Feibeitsblatt anlegen */
  async createSheet(draft) {
    if (draft.tasks.some((t) => t.answer && t.answer.type === "photo"))
      throw new FbError("Die Antwortart „Foto“ kann das Feibeitsblatt noch nicht entgegennehmen. Bitte die Foto-Aufgabe vorerst als Textaufgabe formulieren (z. B. Beschreibung des Lernprodukts).", 400, "photo_unsupported");
    const tasks = draft.tasks.map((t) => {
      const task = { text: String(t.text || "").trim(), solution: String(t.solution || "").trim() };
      const mat = materialRuns(t.material || "");
      if (mat.length) task.material = mat;
      if (t.answer && t.answer.type === "table" && Array.isArray(t.answer.columns) && t.answer.columns.length) task.answer = { type: "table", columns: t.answer.columns.slice(0, 8), rows: Math.min(30, Math.max(1, Number(t.answer.rows) || 3)) };
      return task;
    });
    const body = { title: String(draft.title || "").trim(), tasks };
    if (draft.escape && draft.escape.id && draft.escape.name) body.escape = { id: draft.escape.id, name: draft.escape.name };   // Finale eines Escape-Rooms (nur beim Anlegen möglich)
    return this.call("POST", "/api/teacher/sheets", body);
  }

  /* Alle Abgaben eines Blattes laden und entschlüsseln (seitenweise, höchstens 40 Seiten wie im Feibeitsblatt) */
  async submissions(code) {
    const out = [];
    let after = null;
    for (let page = 0; page < 40; page++) {
      const r = await this.call("GET", "/api/teacher/sheets/" + encodeURIComponent(code) + "/submissions" + (after ? "?after=" + after : ""));
      for (const s of r.submissions || []) {
        const item = { id: s.id, receivedAt: s.receivedAt, stage: s.stage, payload: null, error: null, final: null, finalMismatch: false };
        try { item.payload = await this.open(s.envelope); } catch { item.error = "Diese Abgabe ließ sich nicht entschlüsseln (anderer Schlüssel?)."; }
        if (item.payload && s.finalEnv) {
          try {
            const f = await this.open(s.finalEnv);
            if (f && f.kind === "feibeitsblatt-final" && f.v === 1 && Array.isArray(f.results)) {
              const finals = (item.payload.answers || []).map((a) => (a && a.final) || "");
              if (typeof f.ah === "string" && f.ah === (await answersDigest(finals))) item.final = { at: f.at, results: f.results };
              else item.finalMismatch = true;
            }
          } catch {}
        }
        out.push(item);
      }
      if (!r.next) break;
      after = r.next;
    }
    return out;
  }
}

async function answersDigest(finals) {
  const clean = finals.map((a) => String(a == null ? "" : a).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));
  return hex(await subtle.digest("SHA-256", te.encode(JSON.stringify(clean))));
}

/* Klartext → Absätze aus Läufen (**fett** wird fett, Links bleiben Text) */
export function materialRuns(text) {
  const paras = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const runs = [];
    const re = /\*\*(.+?)\*\*/g; let last = 0, m;
    while ((m = re.exec(line))) { if (m.index > last) runs.push({ t: line.slice(last, m.index) }); runs.push({ t: m[1], f: "b" }); last = m.index + m[0].length; }
    if (last < line.length) runs.push({ t: line.slice(last) });
    return runs.filter((r) => r.t);
  });
  while (paras.length && !paras[0].length) paras.shift();
  while (paras.length && !paras[paras.length - 1].length) paras.pop();
  let total = 0;
  return paras.slice(0, 200).filter((p) => { total += p.reduce((n, r) => n + r.t.length, 0); return total <= 8000; });
}

/* Anzeige der Person wie im Feibeitsblatt (Kürzel) */
export function personLabel(p) {
  if (!p || typeof p !== "object") return "Unbekannt";
  if (Array.isArray(p.gruppe)) return "Gruppe: " + p.gruppe.slice(0, 10).map((x) => String(x).slice(0, 20)).join(", ") + (p.klasse ? " (" + String(p.klasse).slice(0, 10) + ")" : "");
  return [p.vorname, p.nachname].filter(Boolean).map((x) => String(x).slice(0, 20)).join(" ") + (p.klasse ? " (" + String(p.klasse).slice(0, 10) + ")" : "");
}
export const personKey = (p) => (p ? JSON.stringify([p.klasse || "", p.nachname || "", p.vorname || "", p.geburtsdatum || "", Array.isArray(p.gruppe) ? p.gruppe.join("|") : ""]) : "?");
