// ai.js – kostenlose KI-Anbieter (OpenAI-kompatible Schnittstellen + Cloudflare Workers AI über das Binding env.AI).
// Je Aufgabe (Planung, Ideen, Material, Schulportal, Feibeitsblatt) wählt die Lehrkraft Anbieter und Modell; dazu eine Ausweichliste.
// Claude ist hier bewusst NICHT angebunden: Das Pro-Abo darf laut Anthropic nicht in fremden Anwendungen genutzt werden
// (Claude läuft über den Connector in claude.ai, siehe mcp.js).
import { HttpError, bad, json, readJson, sealSecret, openSecret, requireSecret, cleanLine, isObj } from "./lib.js";
import { getSetting, setSetting } from "./db.js";
import { requireTeacher } from "./auth.js";

export const PROVIDERS = {
  gemini: { label: "Google Gemini (AI Studio)", base: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-flash-latest",
    keyUrl: "https://aistudio.google.com/apikey", budget: 200000, note: "Kostenloser Schlüssel in Google AI Studio; im Gratis-Kontingent dürfen Eingaben zur Verbesserung der Google-Modelle genutzt werden." },
  groq: { label: "Groq", base: "https://api.groq.com/openai/v1", defaultModel: "openai/gpt-oss-120b", maxField: "max_completion_tokens", reasoning: "effort",
    keyUrl: "https://console.groq.com/keys", budget: 24000, note: "Sehr schnell; kleines Minutenkontingent im Gratis-Tarif (lange Chats werden gekürzt)." },
  cerebras: { label: "Cerebras", base: "https://api.cerebras.ai/v1", defaultModel: "gpt-oss-120b", maxField: "max_completion_tokens", reasoning: "effort",
    keyUrl: "https://cloud.cerebras.ai", budget: 24000, note: "Sehr schnell; Gratis-Tarif mit Tageskontingent." },
  openrouter: { label: "OpenRouter (nur Gratis-Modelle)", base: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-oss-120b:free", reasoning: "object", freeOnly: true,
    keyUrl: "https://openrouter.ai/keys", budget: 60000, note: "Vermittelt Gratis-Modelle verschiedener Anbieter; Verfügbarkeit schwankt." },
  cloudflare: { label: "Cloudflare Workers AI (ohne Schlüssel)", keyless: true, defaultModel: "@cf/google/gemma-4-26b-a4b-it", budget: 40000,
    models: ["@cf/google/gemma-4-26b-a4b-it", "@cf/zai-org/glm-4.7-flash", "@cf/qwen/qwen3-30b-a3b-fp8"],
    note: "Sofort nutzbar, aber kleineres Tageskontingent (10.000 Neurons für das ganze Konto) und schwächere Modelle." },
  custom: { label: "Anderer OpenAI-kompatibler Dienst", base: "", defaultModel: "", budget: 60000, note: "Eigene Basis-URL (…/v1) und Schlüssel." },
};
// Workers-AI-Modelle (wie im Feibeitsblatt, Stand 22.10.2026): Feld für die Ausgabegrenze und Denkmodus abschaltbar
const CF_MODELS = {
  "@cf/google/gemma-4-26b-a4b-it": { maxField: "max_completion_tokens", think: true },
  "@cf/zai-org/glm-4.7-flash": { maxField: "max_completion_tokens", think: true },
  "@cf/qwen/qwen3-30b-a3b-fp8": { maxField: "max_tokens", think: true },
};
export const TASKS = {
  planning: { label: "Allgemeine Unterrichtsplanung (Chat)", maxTokens: 6000 },
  ideas: { label: "Entwicklung und Überarbeitung von Unterrichtsideen", maxTokens: 6000 },
  material: { label: "Erstellung von Unterrichtsmaterialien", maxTokens: 8000 },
  portal: { label: "Schulportal-Eintrag", maxTokens: 3000 },
  feibeitsblatt: { label: "Feibeitsblatt-Entwurf", maxTokens: 6000 },
};
const TASK_IDS = Object.keys(TASKS);

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
export class AIError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

/* ---------- Konfiguration (settings.ai) ---------- */
// { keys: {provider: sealed}, custom: {base}, tasks: {task: {provider, model}}, fallbacks: [{provider, model}] }
export async function loadAiConfig(db) {
  const s = (await getSetting(db, "ai")) || {};
  return { keys: isObj(s.keys) ? s.keys : {}, custom: isObj(s.custom) ? s.custom : { base: "" }, tasks: isObj(s.tasks) ? s.tasks : {}, fallbacks: Array.isArray(s.fallbacks) ? s.fallbacks : [] };
}
const usable = (cfg, p) => !!PROVIDERS[p] && (PROVIDERS[p].keyless ? true : !!cfg.keys[p]) && (p !== "custom" || !!cfg.custom.base);
/* Reihenfolge der Lehrkraft: Claude (claude.ai, Connector) → Groq → Cloudflare Workers AI. Unter den kostenlosen Diensten steht Groq deshalb vorn. */
export const DEFAULT_ORDER = ["groq", "gemini", "cerebras", "openrouter", "custom"];
function defaultChoice(cfg) {
  for (const p of DEFAULT_ORDER) if (usable(cfg, p)) return { provider: p, model: PROVIDERS[p].defaultModel || "" };
  return { provider: "cloudflare", model: PROVIDERS.cloudflare.defaultModel };
}
export function routeFor(cfg, task) {
  const first = isObj(cfg.tasks[task]) && usable(cfg, cfg.tasks[task].provider) ? cfg.tasks[task] : defaultChoice(cfg);
  const list = [first, ...cfg.fallbacks.filter((f) => isObj(f) && usable(cfg, f.provider))];
  if (!list.some((x) => x.provider === "cloudflare")) list.push({ provider: "cloudflare", model: PROVIDERS.cloudflare.defaultModel });   // letzter Rückfall ohne Schlüssel
  const seen = new Set();
  return list.filter((x) => { const k = x.provider + "|" + (x.model || ""); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
}
async function keyOf(env, cfg, provider) {
  if (PROVIDERS[provider].keyless) return "";
  try { return await openSecret(requireSecret(env), cfg.keys[provider]); }
  catch { throw new AIError("KEY", "Der gespeicherte Schlüssel für " + PROVIDERS[provider].label + " ist nicht lesbar. Bitte in den Einstellungen neu eintragen."); }
}
const baseOf = (cfg, p) => (p === "custom" ? str(cfg.custom.base) : PROVIDERS[p].base).replace(/\/+$/, "");

/* Verlauf auf das Budget des Anbieters kürzen (Zeichen, grob 4 Zeichen ≈ 1 Token): System bleibt, älteste Nachrichten fallen weg */
export function fitMessages(messages, budget) {
  const sysMax = Math.max(1000, budget - 1500);   // Platz für mindestens die letzte Nachricht
  const sys = messages.filter((m) => m.role === "system").map((m) => (m.content.length > sysMax ? { ...m, content: m.content.slice(0, sysMax) } : m));
  const rest = messages.filter((m) => m.role !== "system");
  let total = sys.reduce((n, m) => n + m.content.length, 0);
  const out = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const len = rest[i].content.length;
    if (out.length && total + len > budget) break;
    const room = Math.max(500, budget - total);   // die neueste Nachricht nur so weit kürzen, wie neben dem System-Prompt Platz ist
    out.unshift(len > room ? { ...rest[i], content: rest[i].content.slice(-room) } : rest[i]);
    total += Math.min(len, room);
  }
  while (out.length && out[0].role === "assistant") out.shift();   // mit einer Nachricht der Lehrkraft beginnen
  return [...sys, ...out];
}

function openAIBody(p, model, messages, o) {
  const body = { model, messages: messages.map((m) => ({ role: m.role, content: str(m.content) })) };
  if (o.maxTokens) body[p.maxField || "max_tokens"] = o.maxTokens;
  if (o.stream) body.stream = true;
  if (p.reasoning && /gpt-oss/i.test(model)) { if (p.reasoning === "object") body.reasoning = { effort: "medium" }; else body.reasoning_effort = "medium"; }
  return body;
}
function errText(data, raw) {
  const e = data && data.error;
  if (typeof e === "string") return e.slice(0, 300);
  if (e && e.message) return str(e.message).slice(0, 300) + (e.metadata && e.metadata.raw ? " – " + str(e.metadata.raw).slice(0, 200) : "");
  if (Array.isArray(data) && data[0] && data[0].error) return str(data[0].error.message).slice(0, 300);
  return str(raw).slice(0, 200);
}
/* Grenzen aus der Fehlermeldung lesen. Groq meldet sie genau, z. B. „… on tokens per minute (TPM): Limit 8000, Used 4810, Requested 5212.
 * Please try again in 1.5165s.“ (429) bzw. bei einer einzelnen zu großen Anfrage „Request too large … Limit 8000, Requested 12500“ (413). */
export function parseLimits(msg, headers) {
  const s = str(msg), num = (re) => { const m = re.exec(s); return m ? Number(m[1]) : null; };
  let retryMs = null;
  const ra = headers && typeof headers.get === "function" ? str(headers.get("retry-after")).trim() : "";
  if (/^\d+(\.\d+)?$/.test(ra)) retryMs = Math.ceil(Number(ra) * 1000);
  else {
    const m = /try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+)/i.exec(s);
    if (m) {
      retryMs = 0;
      for (const [, v, u] of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi)) retryMs += Number(v) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[u.toLowerCase()];
      retryMs = Math.ceil(retryMs);
    }
  }
  return { limit: num(/\bLimit\s+(\d+)/i), used: num(/\bUsed\s+(\d+)/i), requested: num(/\bRequested\s+(\d+)/i), retryMs, perMinute: /per minute|\b[TR]PM\b/i.test(s) };
}
function classify(status, msg, full, headers) {
  const lim = parseLimits(full || msg, headers);
  if (status === 401 || status === 403) return new AIError("AUTH", "Der Schlüssel wurde abgelehnt (" + status + "): " + msg);
  if (status === 404) return new AIError("MODEL", "Modell nicht gefunden (" + status + "): " + msg, { soft: true });
  if (status === 429) return new AIError("RATE_LIMIT", "Kontingent erschöpft oder zu viele Anfragen (429): " + msg, { soft: true, ...lim });
  if (status === 413 || /context|too long|too large|maximum.*tokens/i.test(msg)) return new AIError("TOO_LARGE", "Anfrage zu lang für dieses Modell: " + msg, { soft: true, ...lim });
  return new AIError("SERVER", "Fehler des KI-Dienstes (" + status + "): " + msg, { soft: true });
}

/* Bevor die Plattform zum nächsten Dienst wechselt: Lässt sich die Anfrage beim selben Dienst noch retten?
 * – Einzelne Anfrage größer als die Minutengrenze (Groq im Gratis-Tarif: 8000 Token pro Minute, gezählt Eingabe + erlaubte Antwortlänge):
 *   Antwortlänge begrenzen bzw. den Verlauf kürzen, bis es passt (Zeichen je Token an genau dieser Anfrage gemessen).
 * – Kurze Wartezeit (Minutengrenze, retry-after ≤ 30 s): abwarten und erneut fragen – erst ein erschöpftes Kontingent führt zum nächsten Dienst. */
export const MAX_WAIT_MS = 30000;
export function adjustFor(e, opt) {
  if (!(e instanceof AIError)) return null;
  if (e.limit && e.requested && e.requested > e.limit) {
    const target = Math.floor(e.limit * 0.9), max = opt.maxTokens || 0;
    const input = Math.max(1, e.requested - max);
    const want = Math.min(max || target, Math.floor(target * 0.45));   // Mindestlänge der Antwort
    if (target - input >= want) return { opt: { ...opt, maxTokens: Math.min(max || Infinity, target - input) } };
    const ratio = (e.inputChars || 0) / input;
    const budget = Math.floor((target - want) * ratio * 0.95);
    return ratio && budget >= 2000 ? { opt: { ...opt, maxTokens: want, budget } } : null;
  }
  if (e.code === "RATE_LIMIT" && e.retryMs > 0 && e.retryMs <= MAX_WAIT_MS) return { waitMs: e.retryMs + 250, opt };
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function parseOpenAI(data) {
  const c = data && Array.isArray(data.choices) && data.choices[0];
  if (!c) throw new AIError("EMPTY", "Leere Antwort der KI.", { soft: true });
  const msg = c.message || {};
  const text = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((x) => str(x && x.text)).join("") : "";
  if (c.finish_reason === "content_filter") throw new AIError("FILTERED", "Die KI hat die Anfrage abgelehnt (Inhaltsfilter).");
  if (!text.trim()) throw new AIError("EMPTY", c.finish_reason === "length" ? "Die Antwort wurde abgeschnitten (Ausgabegrenze erreicht)." : "Leere Antwort der KI.", { soft: true });
  return text;
}
const cfBody = (d) => (d && !Array.isArray(d.choices) && d.response == null && d.result && typeof d.result === "object" ? d.result : d);
function parseWorkersAI(data) {
  const d = cfBody(data);
  if (d && Array.isArray(d.choices)) return parseOpenAI(d);
  const r = d && d.response;
  if (r && typeof r === "object") return JSON.stringify(r);
  if (typeof r === "string" && r.trim()) return r;
  throw new AIError("EMPTY", "Leere Antwort der KI.", { soft: true });
}

/* Ein Aufruf bei genau einem Anbieter. stream=true liefert die rohe SSE-Antwort (OpenAI-Format) zum Durchreichen an den Browser:
 * der Worker parst sie nicht (CPU-Grenze im Free-Plan), der Browser liest die Deltas und speichert die fertige Antwort. */
export async function callOne(env, cfg, choice, messages, o = {}) {
  const p = PROVIDERS[choice.provider];
  if (!p) throw new AIError("CONFIG", "Unbekannter Anbieter.");
  const model = choice.model || p.defaultModel;
  if (!model) throw new AIError("CONFIG", "Für " + p.label + " ist kein Modell eingetragen.");
  const msgs = fitMessages(messages, o.budget || p.budget);
  const inputChars = msgs.reduce((n, m) => n + str(m.content).length, 0);
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), o.timeoutMs || 120000);
  try {
    if (p.keyless) {
      if (!env.AI) throw new AIError("CONFIG", "Cloudflare Workers AI ist in diesem Worker nicht verfügbar.");
      const m = CF_MODELS[model] || { maxField: "max_tokens" };
      const inputs = { messages: msgs.map((x) => ({ role: x.role, content: x.content })) };
      if (o.maxTokens) inputs[m.maxField] = Math.min(o.maxTokens, 8000);
      if (m.think) inputs.chat_template_kwargs = { enable_thinking: false };
      let data;
      try { data = await env.AI.run(model, inputs, { signal: ac.signal }); }
      catch (e) {
        const em = str(e && e.message);
        if (/daily|neuron|quota|4006/i.test(em)) throw new AIError("RATE_LIMIT", "Das Tageskontingent von Workers AI ist aufgebraucht: " + em.slice(0, 200), { soft: true });
        throw new AIError("SERVER", "Workers AI: " + em.slice(0, 300), { soft: true });
      }
      return { text: parseWorkersAI(data), model, provider: choice.provider };
    }
    const key = await keyOf(env, cfg, choice.provider);
    const r = await fetch(baseOf(cfg, choice.provider) + "/chat/completions", {
      method: "POST", signal: ac.signal,
      headers: { "content-type": "application/json", authorization: "Bearer " + key, ...(choice.provider === "openrouter" ? { "X-Title": "Unterricks" } : {}) },
      body: JSON.stringify(openAIBody(p, model, msgs, o)),
    });
    if (!r.ok) {
      const raw = await r.text(); let data = null; try { data = JSON.parse(raw); } catch {}
      const full = data && data.error && typeof data.error.message === "string" ? data.error.message : raw;
      throw classify(r.status, errText(data, raw), str(full).slice(0, 2000), r.headers);
    }
    if (o.stream) return { stream: r.body, model, provider: choice.provider };
    const data = await r.json();
    return { text: parseOpenAI(data), model, provider: choice.provider };
  } catch (e) {
    if (e instanceof AIError) { if (e.inputChars === undefined) e.inputChars = inputChars; throw e; }
    if (e && e.name === "AbortError") throw new AIError("TIMEOUT", "Die KI hat zu lange gebraucht.", { soft: true });
    throw new AIError("NETWORK", "Der KI-Dienst ist nicht erreichbar: " + str(e && e.message).slice(0, 200), { soft: true });
  } finally { clearTimeout(timer); }
}

/* Anfrage mit Ausweichliste: weiche Fehler (Kontingent, Modell, Zeit) → nächster Eintrag.
 * Vorher wird beim selben Dienst noch höchstens zweimal nachgebessert (zu große Anfrage verkleinern, kurze Wartezeit abwarten). */
export async function callTask(env, db, task, messages, o = {}) {
  const cfg = await loadAiConfig(db);
  const route = routeFor(cfg, task), errors = [];
  for (const choice of route) {
    let opt = { maxTokens: TASKS[task].maxTokens, ...o, stream: o.stream && !PROVIDERS[choice.provider].keyless }, last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await callOne(env, cfg, choice, messages, opt); }
      catch (e) {
        last = e;
        const adj = attempt < 2 ? adjustFor(e, opt) : null;
        if (!adj) break;
        if (adj.waitMs) await (o.sleep || sleep)(adj.waitMs);
        opt = adj.opt;
      }
    }
    errors.push(PROVIDERS[choice.provider].label + " (" + (choice.model || PROVIDERS[choice.provider].defaultModel) + "): " + last.message);
    if (!(last instanceof AIError) || !last.soft) break;
  }
  throw new HttpError(502, "ai_error", "Die KI hat nicht geantwortet. " + errors.join(" | "));
}

/* ---------- Einstellungen (Lehrkraft) ---------- */
function publicConfig(cfg) {
  return {
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, keyless: !!p.keyless, hasKey: p.keyless ? true : !!cfg.keys[id],
      defaultModel: p.defaultModel, keyUrl: p.keyUrl || "", note: p.note || "", models: p.models || null, base: id === "custom" ? str(cfg.custom.base) : undefined })),
    tasks: TASK_IDS.map((id) => { const route = routeFor(cfg, id); return { id, label: TASKS[id].label, choice: route[0], route, saved: isObj(cfg.tasks[id]) }; }),
    fallbacks: cfg.fallbacks,
  };
}
export async function routeAiGet(c) {
  await requireTeacher(c);
  return json({ ok: true, ...publicConfig(await loadAiConfig(c.db)) });
}
export async function routeAiPut(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 50000);
  const cfg = await loadAiConfig(c.db);
  if (isObj(body.key)) {
    const p = body.key.provider;
    if (!PROVIDERS[p] || PROVIDERS[p].keyless) throw bad("Unbekannter Anbieter.");
    if (body.key.apiKey === null || body.key.apiKey === "") delete cfg.keys[p];
    else if (typeof body.key.apiKey === "string") {
      const k = cleanLine(body.key.apiKey, 400);
      if (k.length < 8) throw bad("Der Schlüssel ist zu kurz.");
      cfg.keys[p] = await sealSecret(requireSecret(c.env), k);
    }
    if (p === "custom" && body.key.base !== undefined) {
      const b = cleanLine(body.key.base, 300);
      const devOk = c.env.DEV_ALLOW_HTTP_AI === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/.test(b);   // nur lokale Tests
      if (b && !devOk && !/^https:\/\/[^\s/]+(\/\S*)?$/.test(b)) throw bad("Die Basis-URL muss mit https:// beginnen.");
      cfg.custom = { base: b };
    }
  }
  const choice = (x) => {
    if (!isObj(x) || !PROVIDERS[x.provider]) throw bad("Bitte Anbieter und Modell wählen.");
    return { provider: x.provider, model: cleanLine(x.model, 200) || PROVIDERS[x.provider].defaultModel };
  };
  if (isObj(body.tasks)) for (const id of TASK_IDS) if (body.tasks[id] !== undefined) {
    if (body.tasks[id] === null) delete cfg.tasks[id]; else cfg.tasks[id] = choice(body.tasks[id]);
  }
  if (Array.isArray(body.fallbacks)) cfg.fallbacks = body.fallbacks.slice(0, 3).map(choice);
  await setSetting(c.db, "ai", cfg);
  return json({ ok: true, ...publicConfig(cfg) });
}
// Verfügbare Modelle beim Anbieter abfragen (OpenRouter: nur kostenlose)
export async function routeAiModels(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 10000);
  const cfg = await loadAiConfig(c.db), p = PROVIDERS[body.provider];
  if (!p) throw bad("Unbekannter Anbieter.");
  if (p.keyless) return json({ ok: true, models: p.models });
  if (!usable(cfg, body.provider)) throw bad("Bitte zuerst einen Schlüssel für " + p.label + " speichern.");
  const key = await keyOf(c.env, cfg, body.provider);
  const r = await fetch(baseOf(cfg, body.provider) + "/models", { headers: { authorization: "Bearer " + key } });
  const raw = await r.text(); let data = null; try { data = JSON.parse(raw); } catch {}
  if (!r.ok) throw new HttpError(502, "ai_error", "Modellliste nicht abrufbar: " + errText(data, raw));
  let list = (data && Array.isArray(data.data) ? data.data : []).filter((m) => m && typeof m.id === "string");
  if (p.freeOnly) list = list.filter((m) => /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0));
  const models = list.map((m) => m.id.replace(/^models\//, "")).filter((id) => !/embed|tts|whisper|imagen|veo|guard|audio|image/i.test(id)).sort().slice(0, 300);
  return json({ ok: true, models });
}
export async function routeAiTest(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 10000);
  const cfg = await loadAiConfig(c.db);
  if (!PROVIDERS[body.provider]) throw bad("Unbekannter Anbieter.");
  const t0 = Date.now();
  try {
    const r = await callOne(c.env, cfg, { provider: body.provider, model: cleanLine(body.model, 200) }, [{ role: "user", content: "Antworte nur mit dem Wort: Bereit" }], { maxTokens: 1200, timeoutMs: 60000 });
    return json({ ok: true, reply: r.text.slice(0, 200), model: r.model, ms: Date.now() - t0 });
  } catch (e) { throw new HttpError(502, "ai_error", e.message); }
}
