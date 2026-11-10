// Reihenfolge der kostenlosen KI je Aufgabe
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFor, TASKS, PROVIDER_WHO } from "../../worker/ai.js";

test("KI-Begriffshilfe: eigene Aufgabe; ohne eigene Einstellung gilt die der Unterrichtsplanung, zuletzt Workers AI", () => {
  assert.ok(TASKS.erklaeren && TASKS.erklaeren.maxTokens <= 1000, "kurze Antworten");
  const cfg = { keys: { custom: "x" }, custom: { base: "http://127.0.0.1:1/v1" }, tasks: { planning: { provider: "custom", model: "mock-1" } }, fallbacks: [] };
  assert.deepEqual(routeFor(cfg, "erklaeren"), [{ provider: "custom", model: "mock-1" }, { provider: "cloudflare", model: "@cf/google/gemma-4-26b-a4b-it" }]);
  const own = { ...cfg, tasks: { ...cfg.tasks, erklaeren: { provider: "cloudflare", model: "@cf/qwen/qwen3-30b-a3b-fp8" } } };
  assert.deepEqual(routeFor(own, "erklaeren")[0], { provider: "cloudflare", model: "@cf/qwen/qwen3-30b-a3b-fp8" });
  for (const p of ["groq", "cloudflare", "gemini", "cerebras", "openrouter", "custom"]) assert.ok(PROVIDER_WHO[p], p + " im Einwilligungstext benannt");
});
