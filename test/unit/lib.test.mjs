import test from "node:test";
import assert from "node:assert/strict";
import { generateCode, sealSecret, openSecret, signLink, checkLink, b64u, unb64u, contentDisposition, timingSafeEqual } from "../../worker/lib.js";
import { isValidCode } from "../../public/shared.js";
import { fitMessages, routeFor } from "../../worker/ai.js";
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
});

test("Feibeitsblatt-Material: Absätze aus Läufen", () => {
  assert.deepEqual(materialRuns("\nErster **fett** Absatz\n\nZweiter\n"), [[{ t: "Erster " }, { t: "fett", f: "b" }, { t: " Absatz" }], [], [{ t: "Zweiter" }]]);
});
