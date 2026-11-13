// fbclient.js – Anbindung an das bestehende Feibeitsblatt (Lehrkraft-API) direkt aus dem Browser der Lehrkraft.
// Das Feibeitsblatt-Passwort verlässt den Browser nie: daraus werden wie im Feibeitsblatt selbst per PBKDF2 (600 000 Iterationen)
// und HKDF der Anmeldeschlüssel und der Schlüssel zum Öffnen des privaten RSA-Schlüssels abgeleitet. Abgaben werden hier entschlüsselt.
// Schlüssel liegen im Arbeitsspeicher; auf Wunsch speichert Unterricks den Feibeitsblatt-Schlüssel Ende-zu-Ende verschlüsselt im
// Benutzerkonto (fblink.js), dann verbindet connectMaster ohne erneute Eingabe.
import { withAgeExpectation } from "./shared.js";
const subtle = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const b64 = (buf) => { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(String(s)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");

export const PHOTO_TASKS_MAX = 3;   // Grenze des Feibeitsblatts (LIMITS.photoTasks)
// Foto einer Abgabe (entschlüsselt, fremde Daten): nur ein JPEG als data:-URL in der Form, die das Feibeitsblatt erzeugt (≤ 200 KB)
export function cleanPhoto(v) {
  if (typeof v !== "string" || v.length > 280000) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  return m && m[1].length % 4 === 0 && m[1].startsWith("/9j/") ? v : null;
}
export class FbError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }

export class FbClient {
  constructor(apiBase) { this.base = String(apiBase || "").replace(/\/+$/, ""); this.authKey = null; this.priv = null; this.master = null; }
  get connected() { return !!(this.authKey && this.priv); }
  disconnect() { this.authKey = null; this.priv = null; if (this.master) this.master.fill(0); this.master = null; }

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
    return this.keysOf(new Uint8Array(bits));
  }
  /* Feibeitsblatt-Schlüssel (PBKDF2-Ergebnis, 32 Byte) → Anmeldeschlüssel und Schlüssel zum Öffnen des privaten Schlüssels (HKDF wie im Feibeitsblatt) */
  async keysOf(bits) {
    const master = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey", "deriveBits"]);
    const encKey = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("feibeitsblatt/enc/v1") }, master, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const auth = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("feibeitsblatt/auth/v1") }, master, 256);
    return { encKey, authKey: b64(auth), master: bits };
  }

  /* Türcode + Passwort → angemeldet, privater Schlüssel entschlüsselt (nicht exportierbar) */
  async connect(doorCode, password) {
    const door = await this.call("POST", "/api/teacher/door", { doorCode: String(doorCode || "").trim() }, false);
    if (!door.setup) throw new FbError("Im Feibeitsblatt ist noch kein Lehrkraft-Zugang eingerichtet. Bitte dort zuerst ein Passwort festlegen.");
    return this.login(await this.derive(password, door.kdf), "Das Feibeitsblatt-Passwort ist falsch.");
  }
  /* mit dem gespeicherten Feibeitsblatt-Schlüssel (ohne Türcode und Passwort) */
  async connectMaster(bits) {
    if (!(bits instanceof Uint8Array) || bits.length !== 32) throw new FbError("Die gespeicherte Feibeitsblatt-Verbindung ist unvollständig.");
    return this.login(await this.keysOf(new Uint8Array(bits)), "Die gespeicherte Feibeitsblatt-Verbindung gilt nicht mehr – vermutlich wurde das Feibeitsblatt-Passwort geändert.");
  }
  async login(keys, wrongMsg) {
    this.disconnect();
    this.authKey = keys.authKey;
    let r;
    try { r = await this.call("POST", "/api/teacher/login"); }
    catch (e) { this.disconnect(); if (e.status === 401) throw new FbError(wrongMsg, 401); throw e; }
    try {
      const pkcs8 = await subtle.decrypt({ name: "AES-GCM", iv: unb64(r.encPrivateKey.iv) }, keys.encKey, unb64(r.encPrivateKey.ct));
      this.priv = await subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
    } catch { this.disconnect(); throw new FbError("Der Schlüssel für die Abgaben ließ sich nicht öffnen."); }
    this.master = keys.master;   // für „Verbindung speichern“ (nur im Arbeitsspeicher, beim Trennen überschrieben)
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
  // Bild einer Aufgabe (öffentlich, wie für die Schüler:innen): {mime, w, h, data: Base64} – für das Notfall-Feibeitsblatt
  image(code, imageId) { return this.call("GET", "/api/sheet/" + encodeURIComponent(code) + "/images/" + encodeURIComponent(imageId), undefined, false); }

  /* Entwurf (Plattform-Format) → Feibeitsblatt anlegen */
  // Antwortarten: Text, Tabelle, Foto (Foto: {type:"photo"} ohne Auftrag an die KI – Fotos gehen nie an die KI; höchstens 3 je Blatt)
  // opt.klass: Lerngruppe – jeder Auftrag an die KI bekommt (falls noch nicht da) die altersgemäße Erwartung (das Feibeitsblatt kennt den Jahrgang nicht)
  async createSheet(draft, opt = {}) {
    const photos = draft.tasks.filter((t) => t.answer && t.answer.type === "photo").length;
    if (photos > PHOTO_TASKS_MAX) throw new FbError("Höchstens " + PHOTO_TASKS_MAX + " Aufgaben mit der Antwortart „Foto“ je Feibeitsblatt.", 400, "too_many_photos");
    const tasks = draft.tasks.map((t) => {
      const photo = t.answer && t.answer.type === "photo";
      const task = { text: String(t.text || "").trim(), solution: photo ? "" : withAgeExpectation(t.solution, opt.klass) };
      const fmt = taskTextFmt(task.text);   // Aufgabenstellung mit Link oder fett: als textFmt (das Feibeitsblatt leitet den reinen Text daraus ab)
      if (fmt) task.textFmt = fmt;
      const mat = materialRuns(t.material || "");
      if (mat.length) task.material = mat;
      if (photo) task.answer = { type: "photo" };
      else if (t.answer && t.answer.type === "table" && Array.isArray(t.answer.columns) && t.answer.columns.length) task.answer = { type: "table", columns: t.answer.columns.slice(0, 8), rows: Math.min(30, Math.max(1, Number(t.answer.rows) || 3)) };
      return task;
    });
    const body = { title: String(draft.title || "").trim(), tasks };
    if (draft.escape && draft.escape.id && draft.escape.name) body.escape = { id: draft.escape.id, name: draft.escape.name };   // Finale eines Escape-Rooms (nur beim Anlegen möglich)
    try { return await this.call("POST", "/api/teacher/sheets", body); }
    catch (e) {
      // ein Feibeitsblatt ohne die Erweiterung „Foto“ kennt die Antwortart nicht: klar sagen, woran es liegt
      if (photos && e.status === 400 && /Antwortart hat ein ungültiges Format/.test(e.message))
        throw new FbError(e.message + " – Ihr Feibeitsblatt kennt die Antwortart „Foto“ noch nicht. Sie kommt mit der Erweiterung des Feibeitsblatts (Zweig claude/foto-antwort); bis sie veröffentlicht ist, bitte die Foto-Aufgabe als Textaufgabe formulieren.", 400, "photo_unsupported");
      throw e;
    }
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

/* ---------- Klartext → Feibeitsblatt-Läufe (Material und Aufgabenstellung, Wunsch der Lehrkraft vom 13.11.2026, Nr. 17) ----------
 * Absätze aus Läufen {t, f?, h?} wie im Feibeitsblatt (validateMaterial): **fett** wird fett (f "b"), Links zu anderen Internetseiten werden
 * Link-Läufe (h) – Markdown [Linktext](https://…) mit sichtbarem Linktext und nackte Adressen https://… bzw. http://… (sichtbar die Adresse;
 * Satzzeichen am Ende und eine schließende Klammer ohne öffnende gehören nicht dazu, Klammern in Wikipedia-Adressen schon). Das Feibeitsblatt
 * zeigt sie den Schüler:innen anklickbar in neuem Tab (target _blank, rel noopener noreferrer). Nur http(s), geprüft wie cleanHref im
 * Feibeitsblatt (Länge nach der Normalisierung); alles andere bleibt Text. Die Grenzen des Feibeitsblatts (FB_LIMITS) werden nie
 * überschritten: über 60 Links bleiben weitere Links Text („Linktext (Adresse)“), reicht die Zahl der Abschnitte (600) nicht, wird ein Absatz
 * zu einem einzigen Textlauf – ein Blatt scheitert nie an den Links. */
export const FB_LIMITS = { material: 8000, taskText: 4000, paragraphs: 200, runs: 600, links: 60, href: 1000 };   // wie LIMITS im Feibeitsblatt
export function fbHref(raw) {   // = cleanHref des Feibeitsblatts: normalisierte http(s)-Adresse oder ""
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > FB_LIMITS.href || /[\u0000-\u0020\u007f]/.test(s)) return "";
  let u; try { u = new URL(s); } catch { return ""; }
  return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= FB_LIMITS.href ? u.href : "";
}
// [Linktext](Adresse) bzw. [Linktext](Adresse "Titel"); die Adresse darf Klammerpaare enthalten (Wikipedia: …/Begriff_(Staatsrecht))
const MD_LINK_RE = /\[([^\[\]\n]+)\]\(\s*(https?:\/\/[^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*)(?:\s+"[^"\n]*")?\s*\)/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>"\[\]\uE000\uE001]+/gi;
const SLOT_RE = /\uE000(\d+)\uE001/g;
const URL_TAIL = /[.,;:!?…'"“”„‘’‚»«*]$/;   // Satzzeichen und Anführungszeichen am Ende gehören nicht zur Adresse
const count = (s, c) => s.split(c).length - 1;
function trimUrl(u) {
  for (;;) {
    if (URL_TAIL.test(u)) u = u.slice(0, -1);
    else if (u.endsWith(")") && count(u, ")") > count(u, "(")) u = u.slice(0, -1);
    else return u;
  }
}
const bolds = (s) => {   // **…** → [{t, b}]
  const out = [], re = /\*\*(.+?)\*\*/g; let last = 0, m;
  while ((m = re.exec(s))) { if (m.index > last) out.push({ t: s.slice(last, m.index), b: false }); out.push({ t: m[1], b: true }); last = m.index + m[0].length; }
  if (last < s.length) out.push({ t: s.slice(last), b: false });
  return out;
};
// eine Zeile → Läufe {t, b, k?}: k = Nummer des Links in links (je Link {h, addr, md}); Links werden erst beim Zählen der Grenzen festgelegt
function lineRuns(line, links) {
  const md = [];
  const s = line.replace(/[\uE000\uE001]/g, "").replace(MD_LINK_RE, (all, text, url) => {
    const h = fbHref(url);
    if (!h) return all;
    md.push({ text, h, addr: url });
    return "\uE000" + (md.length - 1) + "\uE001";
  });
  const out = [];
  const link = (parts, l, b) => { const k = links.push({ h: l.h, addr: l.addr, md: l.md }) - 1; for (const p of parts) out.push({ t: p.t, b: b || p.b, k }); };
  const plain = (t, b) => {   // nackte Adressen in einem Textstück
    let last = 0, m;
    BARE_URL_RE.lastIndex = 0;
    while ((m = BARE_URL_RE.exec(t))) {
      const u = trimUrl(m[0]), h = fbHref(u);
      if (!h) continue;
      if (m.index > last) out.push({ t: t.slice(last, m.index), b });
      link([{ t: u, b: false }], { h, addr: u, md: false }, b);
      last = m.index + u.length; BARE_URL_RE.lastIndex = last;
    }
    if (last < t.length) out.push({ t: t.slice(last), b });
  };
  for (const seg of bolds(s)) {
    let last = 0, m;
    SLOT_RE.lastIndex = 0;
    while ((m = SLOT_RE.exec(seg.t))) {
      if (m.index > last) plain(seg.t.slice(last, m.index), seg.b);
      const l = md[Number(m[1])];
      link(l.text.trim() ? bolds(l.text) : [{ t: l.addr, b: false }], { h: l.h, addr: l.addr, md: !!l.text.trim() }, seg.b);
      last = m.index + m[0].length;
    }
    if (last < seg.t.length) plain(seg.t.slice(last), seg.b);
  }
  return out.filter((r) => r.t);
}
// Läufe eines Absatzes festlegen: keep(k) = Link bleibt; ein Link, der Text wird, zeigt seine Adresse in Klammern dahinter
function fixRuns(runs, links, keep) {
  const out = [];
  runs.forEach((r, i) => {
    const l = r.k == null ? null : links[r.k], on = l && keep(r.k);
    const run = { t: r.t }; if (r.b) run.f = "b"; if (on) run.h = l.h;
    const prev = out[out.length - 1];
    if (prev && prev.f === run.f && prev.h === run.h) prev.t += run.t; else out.push(run);
    if (l && !on && l.md && (i + 1 >= runs.length || runs[i + 1].k !== r.k)) {   // nach dem letzten Lauf des Links
      const tail = { t: " (" + l.addr + ")" }, p2 = out[out.length - 1];
      if (!p2.f && !p2.h) p2.t += tail.t; else out.push(tail);
    }
  });
  return out;
}
// opt.chars: Zeichengrenze (Material 8000, Aufgabenstellung 4000); opt.breaks: Zeilenumbrüche zählen mit (Aufgabenstellung: das Feibeitsblatt
// leitet daraus den reinen Text mit „\n“ zwischen den Absätzen ab). → {paras, cut} (cut = Absätze wegen der Zeichengrenze weggelassen)
function fbParagraphs(text, opt = {}) {
  const max = opt.chars || FB_LIMITS.material, links = [];
  let raw = String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => lineRuns(line, links));
  while (raw.length && !raw[0].length) raw.shift();
  while (raw.length && !raw[raw.length - 1].length) raw.pop();
  let cut = raw.length > FB_LIMITS.paragraphs;
  raw = raw.slice(0, FB_LIMITS.paragraphs);
  // Abschnitte und Links in der Reihenfolge des Textes: jeder spätere nicht leere Absatz braucht mindestens einen Abschnitt
  let usedRuns = 0, usedLinks = 0, rest = raw.filter((p) => p.length).length;
  const paras = raw.map((p) => {
    if (!p.length) return [];
    rest--;
    const per = new Map(), kept = new Set();   // Läufe je Link (fett und nicht fett zählen getrennt)
    for (const r of p) if (r.k != null) per.set(r.k, (per.get(r.k) || 0) + 1);
    for (const [k, n] of per) if (usedLinks + n <= FB_LIMITS.links) { kept.add(k); usedLinks += n; }
    let runs = fixRuns(p, links, (k) => kept.has(k));
    if (usedRuns + runs.length + rest > FB_LIMITS.runs) {   // zu kleinteilig: der Absatz wird ein einziger Textlauf (ohne Links)
      for (const k of kept) usedLinks -= per.get(k);
      runs = [{ t: fixRuns(p, links, () => false).map((r) => r.t).join("") }];
    }
    usedRuns += runs.length;
    return runs;
  });
  let total = 0;
  const out = paras.filter((p, i) => { total += p.reduce((n, r) => n + r.t.length, 0) + (opt.breaks && i ? 1 : 0); return total <= max; });
  if (out.length < paras.length) cut = true;
  while (out.length && !out[out.length - 1].length) out.pop();
  return { paras: out, cut };
}
/* Materialtext → Absätze aus Läufen (fett und Links) */
export const materialRuns = (text) => fbParagraphs(text).paras;
const isFormatted = (paras) => paras.some((p) => p.some((r) => r.f || r.h));
/* Aufgabenstellung → textFmt (nur mit fett oder Link; passt sie samt Zeilenumbrüchen nicht in 4000 Zeichen, bleibt es beim reinen Text) */
export function taskTextFmt(text) {
  const { paras, cut } = fbParagraphs(text, { chars: FB_LIMITS.taskText, breaks: true });
  return !cut && isFormatted(paras) ? paras : null;
}
/* Vorschau im Entwurf: die Links, die im Feibeitsblatt anklickbar werden ({t, h}; mehrere Läufe desselben Links zusammen) */
export function fbLinksOf(paras) {
  const out = [];
  for (const p of paras || []) p.forEach((r, i) => { if (!r.h) return; if (i && p[i - 1].h === r.h) out[out.length - 1].t += r.t; else out.push({ t: r.t, h: r.h }); });
  return out;
}

/* Anzeige der Person wie im Feibeitsblatt (Kürzel) */
export function personLabel(p) {
  if (!p || typeof p !== "object") return "Unbekannt";
  if (Array.isArray(p.gruppe)) return "Gruppe: " + p.gruppe.slice(0, 10).map((x) => String(x).slice(0, 20)).join(", ") + (p.klasse ? " (" + String(p.klasse).slice(0, 10) + ")" : "");
  return [p.vorname, p.nachname].filter(Boolean).map((x) => String(x).slice(0, 20)).join(" ") + (p.klasse ? " (" + String(p.klasse).slice(0, 10) + ")" : "");
}
export const personKey = (p) => (p ? JSON.stringify([p.klasse || "", p.nachname || "", p.vorname || "", p.geburtsdatum || "", Array.isArray(p.gruppe) ? p.gruppe.join("|") : ""]) : "?");
