// Reihenfolge der kostenlosen KI je Aufgabe
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFor, TASKS, PROVIDER_WHO, PROVIDERS, CF_RETIRED, liveModel, loadAiConfig, routeAiGet, routeAiPut, callOne } from "../../worker/ai.js";
import { getSetting, setSetting } from "../../worker/db.js";
import { sha256Hex } from "../../worker/lib.js";
import { fakeCtx } from "./fake-d1.mjs";

test("KI-Begriffshilfe: eigene Aufgabe; ohne eigene Einstellung gilt die der Unterrichtsplanung, zuletzt Workers AI", () => {
  assert.ok(TASKS.erklaeren && TASKS.erklaeren.maxTokens <= 1000, "kurze Antworten");
  const cfg = { keys: { custom: "x" }, custom: { base: "http://127.0.0.1:1/v1" }, tasks: { planning: { provider: "custom", model: "mock-1" } }, fallbacks: [] };
  assert.deepEqual(routeFor(cfg, "erklaeren"), [{ provider: "custom", model: "mock-1" }, { provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it" }]);
  const own = { ...cfg, tasks: { ...cfg.tasks, erklaeren: { provider: "cloudflare", model: "@cf/zai-org/glm-4.7-flash" } } };
  assert.deepEqual(routeFor(own, "erklaeren")[0], { provider: "cloudflare", model: "@cf/zai-org/glm-4.7-flash" });
  for (const p of ["groq", "cloudflare", "gemini", "cerebras", "openrouter", "custom"]) assert.ok(PROVIDER_WHO[p], p + " im Einwilligungstext benannt");
});

test("Workers AI: Qwen3-30B ist seit dem 20.11.2026 abgeschaltet – nicht mehr in der Auswahl; gespeicherte Einstellungen, ältere Seiten und „Testen“ laufen über Gemma 4", async () => {
  const QWEN = "@cf/qwen/qwen3-30b-a3b-fp8", GEMMA = "@cf/google/gemma-4-26b-a4b-it", GLM = "@cf/zai-org/glm-4.7-flash", cf = (model) => ({ provider: "cloudflare", model });
  assert.deepEqual(PROVIDERS.cloudflare.models, [GEMMA, GLM], "Auswahl ohne Qwen3-30B (kein teurer Ersatz)");
  assert.equal(PROVIDERS.cloudflare.defaultModel, GEMMA);
  assert.ok(CF_RETIRED.has(QWEN));
  assert.deepEqual([liveModel("cloudflare", QWEN), liveModel("cloudflare", GLM), liveModel("custom", QWEN)], [GEMMA, GLM, QWEN], "nur bei Workers AI");
  // gespeicherte Einstellungen (Aufgabe und Ausweichliste) nennen das Modell noch
  const c = fakeCtx(), TOKEN = "lehrkraft-token-ki";
  c.now = Date.UTC(2026, 10, 20, 9, 0);
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "ai", { keys: {}, custom: { base: "" }, tasks: { planning: cf(QWEN), portal: cf(GLM) }, fallbacks: [cf(QWEN), cf(GLM)] });
  const cfg = await loadAiConfig(c.db);
  assert.deepEqual(cfg.tasks, { planning: cf(GEMMA), portal: cf(GLM) });
  assert.deepEqual(cfg.fallbacks, [cf(GEMMA), cf(GLM)]);
  assert.deepEqual(routeFor(cfg, "planning"), [cf(GEMMA), cf(GLM)], "Gemma 4 nur einmal in der Reihenfolge");
  const req = (method, body) => ({ ...c, request: new Request("https://unterricks.test/api/teacher/ai", { method, headers: { Authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined }), waitUntil: () => {} });
  // Anzeige in den Einstellungen: was wirklich genutzt wird
  const got = await (await routeAiGet(req("GET"))).json();
  assert.deepEqual(got.tasks.find((t) => t.id === "planning").choice, cf(GEMMA));
  assert.deepEqual(got.fallbacks, [cf(GEMMA), cf(GLM)]);
  assert.deepEqual(got.providers.find((p) => p.id === "cloudflare").models, [GEMMA, GLM]);
  // eine ältere, noch geöffnete Seite speichert Qwen3-30B → gespeichert wird Gemma 4
  const put = await (await routeAiPut(req("PUT", { tasks: { ideas: cf(QWEN) }, fallbacks: [cf(QWEN), cf(GLM)] }))).json();
  assert.deepEqual(put.tasks.find((t) => t.id === "ideas").choice, cf(GEMMA));
  const saved = await getSetting(c.db, "ai");
  assert.deepEqual([saved.tasks.planning, saved.tasks.ideas, saved.fallbacks], [cf(GEMMA), cf(GEMMA), [cf(GEMMA), cf(GLM)]], "D1 nennt das abgeschaltete Modell nicht mehr");
  // „Testen“ bzw. jeder Aufruf mit dem abgeschalteten Modell: Workers AI bekommt Gemma 4, die Antwort nennt es
  const runs = [];
  const env = { AI: { run: async (model) => { runs.push(model); return { response: "Bereit" }; } } };
  const r = await callOne(env, cfg, cf(QWEN), [{ role: "user", content: "Antworte nur mit dem Wort: Bereit" }]);
  assert.deepEqual(runs, [GEMMA]);
  assert.equal(r.model, GEMMA);
  assert.equal(r.text, "Bereit");
});
