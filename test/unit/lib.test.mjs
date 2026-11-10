import test from "node:test";
import assert from "node:assert/strict";
import { generateCode, sealSecret, openSecret, signLink, checkLink, b64u, unb64u, contentDisposition, timingSafeEqual } from "../../worker/lib.js";
import { isValidCode } from "../../public/shared.js";
import { fitMessages, routeFor, parseLimits, adjustFor, callTask, AIError, MAX_WAIT_MS } from "../../worker/ai.js";
import { materialRuns } from "../../public/fbclient.js";

test("generateCode liefert gültige Codes", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const c = generateCode(); assert.ok(isValidCode(c), c); seen.add(c); }
  assert.ok(seen.size > 490);
});

test("API-Schlüssel verschlüsseln und öffnen", async () => {
  const s = await sealSecret("geheimnis-1234567890", "sk-test-abc");
  assert.notEqual(s, "sk-test-abc");
  assert.equal(await openSecret("geheimnis-1234567890", s), "sk-test-abc");
  await assert.rejects(openSecret("anderes-geheimnis-123", s));
});

test("signierte Links: Ablauf und Manipulation", async () => {
  const now = 1_000_000;
  const { e, s } = await signLink("x".repeat(20), ["slide", "abc", 3], 1000, now);
  assert.ok(await checkLink("x".repeat(20), ["slide", "abc", 3], e, s, now + 500));
  assert.ok(!(await checkLink("x".repeat(20), ["slide", "abc", 4], e, s, now + 500)), "andere Folie");
  assert.ok(!(await checkLink("x".repeat(20), ["slide", "abc", 3], e, s, now + 2000)), "abgelaufen");
  assert.ok(!(await checkLink("x".repeat(20), ["slide", "abc", 3], e + 1, s, now)), "verlängert");
});

test("Kodierung und Hilfsfunktionen", () => {
  const b = new Uint8Array([0, 255, 128, 7]);
  assert.deepEqual(Array.from(unb64u(b64u(b))), Array.from(b));
  assert.match(contentDisposition("Übung 1.pdf"), /filename\*=UTF-8''%C3%9Cbung%201\.pdf/);
  assert.ok(timingSafeEqual("abc", "abc") && !timingSafeEqual("abc", "abd") && !timingSafeEqual("abc", "abcd"));
});

test("Chatverlauf auf das Budget kürzen, System bleibt", () => {
  const msgs = [{ role: "system", content: "S".repeat(100) }, ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i).repeat(100) }))];
  const out = fitMessages(msgs, 450);
  assert.equal(out[0].role, "system");
  assert.equal(out[1].role, "user");
  assert.equal(out[out.length - 1].content, "9".repeat(100));
  assert.ok(out.reduce((n, m) => n + m.content.length, 0) <= 450 + 100);
});

test("Modellwahl: Vorgabe ohne Schlüssel = Workers AI, mit Schlüssel der Anbieter, Workers AI immer als letzter Rückfall", () => {
  assert.equal(routeFor({ keys: {}, custom: {}, tasks: {}, fallbacks: [] }, "planning")[0].provider, "cloudflare");
  const r = routeFor({ keys: { gemini: "x" }, custom: {}, tasks: {}, fallbacks: [{ provider: "groq", model: "m" }] }, "planning");
  assert.deepEqual(r.map((x) => x.provider), ["gemini", "cloudflare"]);   // groq ohne Schlüssel fällt weg
  const r2 = routeFor({ keys: { groq: "x", gemini: "y" }, custom: {}, tasks: { portal: { provider: "groq", model: "openai/gpt-oss-120b" } }, fallbacks: [{ provider: "gemini", model: "gemini-flash-latest" }] }, "portal");
  assert.deepEqual(r2.map((x) => x.provider), ["groq", "gemini", "cloudflare"]);
  const r3 = routeFor({ keys: { gemini: "y", groq: "x" }, custom: {}, tasks: {}, fallbacks: [] }, "planning");
  assert.deepEqual(r3.map((x) => x.provider), ["groq", "cloudflare"], "Reihenfolge der Lehrkraft: Groq vor den übrigen kostenlosen Diensten, Workers AI zuletzt");
});

test("Grenzen aus Fehlermeldungen (Groq) lesen", () => {
  const m = parseLimits("Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 4810, Requested 5212. Please try again in 1.5165s. Need more tokens?");
  assert.deepEqual(m, { limit: 8000, used: 4810, requested: 5212, retryMs: 1517, perMinute: true });
  assert.equal(parseLimits("on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26.4s.").retryMs, 86400);
  assert.equal(parseLimits("Please try again in 450ms").retryMs, 450);
  assert.equal(parseLimits("Please try again in 2h3m").retryMs, 7380000);
  assert.equal(parseLimits("egal", new Headers({ "retry-after": "7" })).retryMs, 7000);
  assert.deepEqual(parseLimits("Request too large for model `x` on tokens per minute (TPM): Limit 8000, Requested 12500, please reduce your message size"), { limit: 8000, used: null, requested: 12500, retryMs: null, perMinute: true });
});

test("Zu große Anfrage für die Minutengrenze: erst Antwortlänge, dann Verlauf kürzen; kurze Wartezeit abwarten", () => {
  const big = (requested, chars) => Object.assign(new AIError("TOO_LARGE", "x", { soft: true }), { limit: 8000, requested, inputChars: chars });
  // Eingabe 3000 Token + 6000 erlaubt = 9000 > 8000 → Antwortlänge auf 7200 − 3000 begrenzen
  assert.deepEqual(adjustFor(big(9000, 10500), { maxTokens: 6000 }).opt, { maxTokens: 4200 });
  // Eingabe 7000 Token (24 500 Zeichen) → Verlauf kürzen: Antwort 3240 Token, Eingabe ≈ 3960 Token
  const a = adjustFor(big(13000, 24500), { maxTokens: 6000 }).opt;
  assert.equal(a.maxTokens, 3240);
  assert.ok(a.budget > 12000 && a.budget < 13200, String(a.budget));
  const wait = Object.assign(new AIError("RATE_LIMIT", "x", { soft: true }), { limit: 8000, used: 6000, requested: 3000, retryMs: 9000 });
  assert.equal(adjustFor(wait, { maxTokens: 6000 }).waitMs, 9250);
  assert.equal(adjustFor(Object.assign(wait, { retryMs: MAX_WAIT_MS + 1 }), { maxTokens: 6000 }), null, "lange Wartezeit (Kontingent erschöpft) → nächster Dienst");
  assert.equal(adjustFor(new AIError("SERVER", "x", { soft: true }), {}), null);
});

test("callTask: Groq bleibt erste Wahl – verkleinert bzw. wartet kurz; erst ein erschöpftes Kontingent führt zu Workers AI", async () => {
  const secret = "s".repeat(32);
  const ai = { keys: { groq: await sealSecret(secret, "gsk_test_123456") }, custom: {}, tasks: {}, fallbacks: [] };
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ value: JSON.stringify(ai) }) }) }) };
  const cf = [];
  const env = { SETTINGS_SECRET: secret, AI: { run: async (model) => { cf.push(model); return { response: "Antwort von Workers AI" }; } } };
  const bodies = [], waits = [];
  let script = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const [status, msg, headers] = script.shift();
    return status === 200 ? new Response(JSON.stringify({ choices: [{ message: { content: msg } }] }), { status })
      : new Response(JSON.stringify({ error: { message: msg, type: "tokens", code: "rate_limit_exceeded" } }), { status, headers });
  };
  try {
    const msgs = [{ role: "system", content: "S".repeat(4000) }, { role: "user", content: "U".repeat(20000) }];
    // 1) einzelne Anfrage zu groß (413) → kleiner erneut bei Groq
    script = [[413, "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 13000, please reduce your message size and try again."], [200, "Antwort von Groq"]];
    let r = await callTask(env, db, "planning", msgs, { sleep: async (ms) => waits.push(ms) });
    assert.equal(r.text, "Antwort von Groq");
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].max_completion_tokens, 6000);
    assert.equal(bodies[1].max_completion_tokens, 3240);
    assert.ok(bodies[1].messages.reduce((n, m) => n + m.content.length, 0) < 13200);
    // 2) Minutengrenze kurz erreicht (429, retry-after 2 s) → warten, erneut bei Groq
    bodies.length = 0;
    script = [[429, "Rate limit reached … on tokens per minute (TPM): Limit 8000, Used 7000, Requested 3000. Please try again in 2s.", { "retry-after": "2" }], [200, "Antwort von Groq"]];
    r = await callTask(env, db, "portal", [{ role: "user", content: "kurz" }], { sleep: async (ms) => waits.push(ms) });
    assert.equal(r.text, "Antwort von Groq");
    assert.deepEqual(waits, [2250]);
    assert.equal(cf.length, 0, "Workers AI wurde nicht gebraucht");
    // 3) Tageskontingent erschöpft (lange Wartezeit) → Workers AI
    script = [[429, "Rate limit reached … on tokens per day (TPD): Limit 200000, Used 199500, Requested 3000. Please try again in 7m12.5s."]];
    r = await callTask(env, db, "portal", [{ role: "user", content: "kurz" }], { sleep: async (ms) => waits.push(ms) });
    assert.equal(r.text, "Antwort von Workers AI");
    assert.equal(r.provider, "cloudflare");
    assert.equal(waits.length, 1, "keine lange Wartezeit");
  } finally { globalThis.fetch = orig; }
});

test("Feibeitsblatt-Material: Absätze aus Läufen", () => {
  assert.deepEqual(materialRuns("\nErster **fett** Absatz\n\nZweiter\n"), [[{ t: "Erster " }, { t: "fett", f: "b" }, { t: " Absatz" }], [], [{ t: "Zweiter" }]]);
});

test("CORS nur für die eingetragene Herkunft der Oberfläche (GitHub Pages)", async () => {
  const { corsHeaders, withCors, pagesOrigins } = await import("../../worker/lib.js");
  const env = { PAGES_ORIGINS: "https://unterricks.janrickmer.de  https://x.example" };
  assert.deepEqual(pagesOrigins(env), ["https://unterricks.janrickmer.de", "https://x.example"]);
  assert.deepEqual(pagesOrigins({ PAGES_ORIGINS: "http://unsicher.example * https://x.example/pfad http://localhost http://localhost.example:80" }), [], "nur https-Herkünfte ohne Pfad");
  assert.deepEqual(pagesOrigins({ PAGES_ORIGINS: "http://localhost:8792,http://127.0.0.1:9000" }), ["http://localhost:8792", "http://127.0.0.1:9000"], "lokale Tests: http://localhost:PORT");
  const req = (o) => new Request("https://u.workers.dev/api/health", { headers: o ? { Origin: o } : {} });
  const c = corsHeaders(req("https://unterricks.janrickmer.de"), env);
  assert.equal(c["Access-Control-Allow-Origin"], "https://unterricks.janrickmer.de");
  assert.match(c["Access-Control-Allow-Headers"], /Authorization/);
  assert.equal(corsHeaders(req("https://boese.example"), env), null);
  assert.equal(corsHeaders(req(null), env), null, "gleiche Herkunft braucht keine CORS-Kopfzeilen");
  const r = withCors(new Response("x", { status: 418, headers: { "content-type": "text/plain" } }), c);
  assert.equal(r.status, 418); assert.equal(r.headers.get("access-control-allow-origin"), "https://unterricks.janrickmer.de"); assert.equal(await r.text(), "x");
});
