// Test-Doubles für den End-to-End-Test:
// 1) eine OpenAI-kompatible Mock-KI (Streaming und JSON-Antworten),
// 2) ein Nachbau der Lehrkraft-Schnittstelle von Feibeitsblatt mit demselben Krypto-Vertrag (PBKDF2 600 000 → HKDF
//    „feibeitsblatt/enc/v1“ / „feibeitsblatt/auth/v1“, privater RSA-OAEP-3072-Schlüssel AES-GCM-verschlüsselt, Umschläge {v:1, ek, iv, ct}).
import http from "node:http";
import { createHash } from "node:crypto";

const subtle = globalThis.crypto.subtle, te = new TextEncoder();
const b64 = (u8) => Buffer.from(u8 instanceof ArrayBuffer ? new Uint8Array(u8) : u8).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const readBody = (req) => new Promise((res) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => res(s)); });

/* ---------- Mock-KI ---------- */
export function startMockAI(port) {
  const calls = [];
  const srv = http.createServer(async (req, res) => {
    if (req.url.endsWith("/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "mock-1" }, { id: "mock-2" }] })); return; }
    if (!req.url.endsWith("/chat/completions")) { res.writeHead(404); res.end(); return; }
    if (req.headers.authorization !== "Bearer test-key-123456") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "bad key" } })); return; }
    const body = JSON.parse(await readBody(req));
    calls.push(body);
    const sys = (body.messages.find((m) => m.role === "system") || {}).content || "";
    let text;
    if (sys.includes("{\"phasen\"")) {
      text = JSON.stringify({ phasen: [
        { titel: "TOP 10", punkte: [] },
        { titel: "Blitzlicht ohne iPad", punkte: ["Einstieg: «Ist das Bundesverfassungsgericht zu mächtig?»"] },
        { titel: "Partnerarbeit", punkte: ["Arbeitsblatt «Aufgaben des BVerfG»", "Ergebnisse vergleichen"] },
        { titel: "Diskussionsrunde", punkte: ["Pro und Contra sammeln"] },
      ], naechsteStundeAb: 4 });
    } else if (sys.includes("Du entwirfst ein Feibeitsblatt")) {
      text = "Hier ist der Entwurf:\n```json\n" + JSON.stringify({ title: "Mock-Blatt BVerfG", tasks: [
        { text: "Erkläre zwei Aufgaben des Bundesverfassungsgerichts.", material: "Das BVerfG wacht über das **Grundgesetz**.", ki_auftrag: "Erwartet: Normenkontrolle, Verfassungsbeschwerde.", antwort: "text" },
        { text: "Sammle Pro und Contra.", ki_auftrag: "Je zwei Argumente.", antwort: { tabelle: ["Pro", "Contra"], zeilen: 3 } },
      ] }) + "\n```";
    } else if (sys.includes("Du bist die KI-Begriffshilfe")) {
      text = "Normenkontrolle heißt: Das Gericht prüft, ob ein Gesetz zum Grundgesetz passt. (Mock-Antwort auf: " + body.messages[body.messages.length - 1].content.slice(0, 40) + ")";
    } else if (/Stundenfrage ändern/.test(body.messages[body.messages.length - 1].content)) {
      text = "Ich schlage vor, die Stundenfrage zuzuspitzen.\n```einheit\n" + JSON.stringify({ stundenfrage: "Ist das Bundesverfassungsgericht ein Ersatzgesetzgeber?", ablauf: ["Karikatur deuten", "Urteil analysieren", "Positionslinie"], begruendung: "Die Lerngruppe kennt die Grundlagen schon." }) + "\n```";
    } else {
      const last = body.messages[body.messages.length - 1].content;
      text = "## Vorschlag\nGern! Für **" + (/Thema: (.*)/.exec(sys) || [, "die Stunde"])[1] + "** schlage ich vor:\n\n- Einstieg mit Karikatur (10 min)\n- Partnerarbeit (20 min)\n\nIhre Nachricht war: " + last.slice(0, 60);
    }
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const parts = text.match(/[\s\S]{1,25}/g);
      for (const p of parts) { res.write("data: " + JSON.stringify({ choices: [{ delta: { content: p } }] }) + "\n\n"); await new Promise((r) => setTimeout(r, 15)); }
      res.write("data: [DONE]\n\n"); res.end(); return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }));
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r({ srv, calls })));
}

/* ---------- Nachbau Feibeitsblatt ---------- */
export async function createFbTeacher(password) {
  const kdf = { salt: b64(crypto.getRandomValues(new Uint8Array(16))), iterations: 600000 };
  const base = await subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(kdf.salt), iterations: kdf.iterations }, base, 256);
  const hk = await subtle.importKey("raw", master, "HKDF", false, ["deriveBits", "deriveKey"]);
  const encKey = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("feibeitsblatt/enc/v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const authRaw = new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: te.encode("feibeitsblatt/auth/v1") }, hk, 256));
  const pair = await subtle.generateKey({ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encPrivateKey = { iv: b64(iv), ct: b64(await subtle.encrypt({ name: "AES-GCM", iv }, encKey, await subtle.exportKey("pkcs8", pair.privateKey))) };
  return { kdf, authHash: createHash("sha256").update(authRaw).digest("hex"), publicKey: b64(await subtle.exportKey("spki", pair.publicKey)), encPrivateKey };
}
export async function makeEnvelope(publicKeyB64, payload) {
  const pub = await subtle.importKey("spki", unb64(publicKeyB64), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const k = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, k, te.encode(JSON.stringify(payload)));
  const ek = await subtle.encrypt({ name: "RSA-OAEP" }, pub, await subtle.exportKey("raw", k));
  return { v: 1, ek: b64(ek), iv: b64(iv), ct: b64(ct) };
}
export const answersDigest = (finals) => createHash("sha256").update(JSON.stringify(finals)).digest("hex");

export async function startMockFeibeitsblatt(port, password, doorCode = "1104") {
  const teacher = await createFbTeacher(password);
  const sheets = new Map(), subs = [];
  let nextId = 1, finalWaitSec = 60;
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS" };
  const send = (res, status, data) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(data)); };
  const authed = (req) => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ""); return m && createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") === teacher.authHash; };
  const srv = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    const u = new URL(req.url, "http://x"), p = u.pathname, raw = await readBody(req), body = raw ? JSON.parse(raw) : {};
    let im;   // öffentlich wie im Feibeitsblatt: Bild einer Aufgabe (für das Notfall-Feibeitsblatt)
    if ((im = /^\/api\/sheet\/([A-Z0-9]+)\/images\/([0-9a-f]{16})$/.exec(p))) { const s0 = sheets.get(im[1]), d = s0 && s0.imageData && s0.imageData[im[2]]; return d ? send(res, 200, { ok: true, ...d }) : send(res, 404, { ok: false, error: "Bild nicht gefunden" }); }
    if (p === "/api/teacher/door" && req.method === "POST") return String(body.doorCode) === doorCode ? send(res, 200, { ok: true, setup: true, kdf: teacher.kdf }) : send(res, 403, { ok: false, error: "Falscher Türcode.", code: "wrong_code" });
    if (!p.startsWith("/api/teacher/")) return send(res, 404, { ok: false, error: "nicht gefunden" });
    if (!authed(req)) return send(res, 401, { ok: false, error: "Nicht angemeldet.", code: "unauthorized" });
    if (p === "/api/teacher/login") return send(res, 200, { ok: true, publicKey: teacher.publicKey, encPrivateKey: teacher.encPrivateKey, kdf: teacher.kdf });
    if (p === "/api/teacher/ai") return send(res, 200, { ok: true, provider: "cloudflare", label: "Cloudflare Workers AI", model: "@cf/google/gemma-4-26b-a4b-it", ready: true, finalWaitSec });
    if (p === "/api/teacher/final-wait") { finalWaitSec = body.waitSec; return send(res, 200, { ok: true, finalWaitSec }); }
    if (p === "/api/teacher/sheets" && req.method === "GET") return send(res, 200, { ok: true, sheets: [...sheets.values()].map((s) => ({ code: s.code, title: s.title, createdAt: s.createdAt, taskCount: s.tasks.length, submissionCount: subs.filter((x) => x.code === s.code && x.stage === "final").length, firstCount: 0, escape: s.escape || null })) });
    if (p === "/api/teacher/sheets" && req.method === "POST") {
      if (!Array.isArray(body.tasks) || !body.tasks.length || body.tasks.some((t) => !t.text)) return send(res, 400, { ok: false, error: "Aufgabe fehlt" });
      for (const t of body.tasks) if (t.material && (!Array.isArray(t.material) || t.material.some((para) => !Array.isArray(para)))) return send(res, 400, { ok: false, error: "Material-Format" });
      const code = "MCK" + String(sheets.size + 2).padStart(3, "2").replace(/[01]/g, "9");
      if (body.escape && (!/^[a-z0-9-]{3,60}$/.test(String(body.escape.id || "")) || !body.escape.name)) return send(res, 400, { ok: false, error: "Escape-Kennung ungültig" });
      if (body.tasks.some((t) => t.answer && !["table", "photo"].includes(t.answer.type))) return send(res, 400, { ok: false, error: "Antwortart ungültig" });
      sheets.set(code, { code, title: body.title || "Feibeitsblatt", tasks: body.tasks, createdAt: Date.now(), escape: body.escape ? { id: body.escape.id, name: body.escape.name } : null });
      return send(res, 200, { ok: true, code, title: body.title, createdAt: Date.now(), taskCount: body.tasks.length });
    }
    let m;
    if ((m = /^\/api\/teacher\/sheets\/([A-Z0-9]+)$/.exec(p))) { const s = sheets.get(m[1]); return s ? send(res, 200, { ok: true, sheet: { ...s, submissionCount: 0 } }) : send(res, 404, { ok: false, error: "weg" }); }
    if ((m = /^\/api\/teacher\/sheets\/([A-Z0-9]+)\/submissions$/.exec(p))) {
      const list = subs.filter((x) => x.code === m[1]).map((x) => ({ id: x.id, receivedAt: x.receivedAt, stage: x.stage, envelope: x.envelope, finalEnv: x.finalEnv }));
      return send(res, 200, { ok: true, submissions: list, next: null });
    }
    if ((m = /^\/api\/teacher\/sheets\/([A-Z0-9]+)\/checklist$/.exec(p))) {
      const s = sheets.get(m[1]);
      if (req.method === "POST") return send(res, 200, { ok: true, draft: { v: 1, ai: true, tasks: s.tasks.map((t, i) => ({ n: i + 1, points: ["Punkt A" + (i + 1)] })) }, final: null, generated: true });
      if (req.method === "PUT") { s.checklist = body; return send(res, 200, { ok: true, final: { v: 1, ...body }, updatedAt: Date.now() }); }
      if (req.method === "GET") return send(res, 200, { ok: true, checklist: s.checklist ? { draft: null, final: { v: 1, ...s.checklist }, updatedAt: Date.now() } : null, aiFeedback: true, aiReady: true });
    }
    send(res, 404, { ok: false, error: "nicht gefunden" });
  });
  // Abgabe einer Schülerin (wie die Schülerseite von Feibeitsblatt sie verschlüsselt) samt serverseitig versiegelter finaler Rückmeldung
  // photos[i] = data:-URL eines JPEG für Foto-Aufgaben (wie das Feibeitsblatt: final „[Foto]“, Bild in answers[i].photo)
  async function addSubmission(code, person, answers, photos = []) {
    const payload = { v: 1, stage: "final", sheetCode: code, sheetTitle: sheets.get(code).title, person, answers: answers.map((a, i) => (photos[i] ? { first: "[Foto]", final: "[Foto]", photo: photos[i] } : { first: a, final: a })),
      feedback: answers.map(() => ({ covered: ["Gute Gliederung"], missing: ["Beispiel ergänzen"] })), feedbackAt: new Date().toISOString(), submittedAt: new Date().toISOString(), finalMode: true };
    const fin = { kind: "feibeitsblatt-final", v: 1, at: new Date().toISOString(), ah: answersDigest(answers.map((a, i) => (photos[i] ? "[Foto]" : a))), results: answers.map(() => ({ covered: ["Normenkontrolle genannt"], missing: ["Verfassungsbeschwerde fehlt"] })) };
    subs.push({ id: nextId++, code, stage: "final", receivedAt: Date.now(), envelope: await makeEnvelope(teacher.publicKey, payload), finalEnv: JSON.stringify(await makeEnvelope(teacher.publicKey, fin)) });
  }
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  return { srv, sheets, addSubmission };
}
