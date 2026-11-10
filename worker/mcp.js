// mcp.js – Connector für claude.ai („Custom Connector“, Remote-MCP über Streamable HTTP, zustandslos, nur Werkzeuge).
// So nutzt die Lehrkraft Claude mit ihrem Pro-Abo erlaubt: Sie arbeitet in claude.ai, Claude liest und schreibt dort die Daten der
// Plattform. Unterstützt das aktuelle Protokoll (2026-07-28, ohne Handshake) und ältere Clients (initialize-Handshake).
// Zugang: geheimer Schlüssel in der Adresse (/mcp/<schlüssel>, für „Ohne Anmeldung“) oder als Authorization: Bearer.
import { HttpError, json, readJson, sha256Hex, timingSafeEqual, randomToken, LOCKS, lockedFor, registerFail, cleanText, cleanLine } from "./lib.js";
import { getSetting, setSetting } from "./db.js";
import { requireTeacher } from "./auth.js";
import { getLesson, lessonCtx, chatMessages, createLesson, updateLesson, savePortal, insertDraft, lessonOut, LIMITS } from "./lessons.js";
import { insertTextMaterial } from "./files.js";
import { SUBJECTS, ALL_CLASSES, subjectName, gradeInfo, formatCode, lessonContext, chatTranscript, PORTAL_RULES, PORTAL_EXAMPLE, SYSTEM_PROMPT_ROLE, FEIBEITSBLATT_INFO } from "../public/shared.js";

const MODERN = "2026-07-28";
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "unterricks", title: "Unterricks – Unterrichtsplattform", version: "1.0.0" };
const INSTRUCTIONS = "Unterricks ist die Unterrichtsplattform der Lehrkraft (Fächer: Politik und Wirtschaft, Evangelische Religion, Ethik; Klassen 5A–10F, EA–EF, Q1–Q4). " +
  "Jede Unterrichtssitzung hat Fach, Klasse, Thema, Dauer, Ideen der Lehrkraft, einen Planungsverlauf (Chat), Materialien, Feibeitsblätter und einen Schulportal-Eintrag. " +
  "Lies vor dem Planen immer zuerst die Sitzung mit get_lesson. Speichere Ergebnisse nur, wenn die Lehrkraft das möchte. " +
  "Eine Zeile „⏸ Zwischenstopp“ im Schulportal-Eintrag ist eine interne Markierung der Lehrkraft: Bis dorthin wurde die Stunde geschafft, ab dort ist der Inhalt offen (sie wird beim Kopieren ins Schulportal entfernt). " +
  "Der Schulportal-Eintrag verwendet die Schulportal-Zeichen (" + PORTAL_RULES.join("; ") + ") und folgt dieser Vorlage:\n" + PORTAL_EXAMPLE;

const SUBJECT_ARG = { type: "string", description: "Fach: powi (Politik und Wirtschaft), evrel (Evangelische Religion) oder ethik", enum: SUBJECTS.map((s) => s.id) };
const CLASS_ARG = { type: "string", description: "Klasse/Kurs, z. B. 7B, EA oder Q2", enum: ALL_CLASSES };
const ID_ARG = { type: "string", description: "Sitzungs-ID (16 Hex-Zeichen, aus list_lessons)", pattern: "^[a-f0-9]{16}$" };
const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const wr = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const TOOLS = [
  { name: "list_lessons", title: "Unterrichtssitzungen auflisten", annotations: ro,
    description: "Listet die Unterrichtssitzungen der Lehrkraft, optional gefiltert nach Fach und Klasse (neueste zuerst).",
    inputSchema: { type: "object", properties: { fach: SUBJECT_ARG, klasse: CLASS_ARG }, additionalProperties: false } },
  { name: "get_lesson", title: "Sitzung lesen", annotations: ro,
    description: "Liefert alle aktuellen Daten einer Sitzung: Fach, Klasse/Jahrgang, Thema, Dauer, Ideen, Planungsverlauf, Schulportal-Eintrag (mit Version), Materialien (Textmaterial im Wortlaut), Feibeitsblätter und Entwürfe.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG }, required: ["lesson_id"], additionalProperties: false } },
  { name: "create_lesson", title: "Neue Sitzung anlegen", annotations: wr,
    description: "Legt eine neue Unterrichtssitzung an und liefert ihre ID und den Sitzungscode für die Schüler:innen.",
    inputSchema: { type: "object", properties: { fach: SUBJECT_ARG, klasse: CLASS_ARG, titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
      dauer_minuten: { type: "integer", minimum: 5, maximum: 600 }, datum: { type: "string", description: "Datum der Sitzung, JJJJ-MM-TT (Pflicht)", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, required: ["fach", "klasse", "titel", "datum"], additionalProperties: false } },
  { name: "update_lesson", title: "Sitzungsdaten ändern", annotations: wr,
    description: "Ändert Titel, Thema, Dauer, Datum, das Notizfeld „Ideen und Wünsche“ oder die Hausaufgabe (bis zur nächsten Sitzung, für Schüler:innen sichtbar) einer Sitzung (nur übergebene Felder).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
      dauer_minuten: { type: "integer", minimum: 5, maximum: 600 }, datum: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, ideen: { type: "string", maxLength: 20000 },
      hausaufgabe: { type: "string", maxLength: 10000, description: "Schulportal-Zeichen erlaubt; leer = keine Hausaufgabe" } }, required: ["lesson_id"], additionalProperties: false } },
  { name: "save_planning_result", title: "Planungsergebnis in der Sitzung speichern", annotations: wr,
    description: "Speichert ein Planungsergebnis (z. B. den ausgearbeiteten Stundenentwurf) als Nachricht „Claude“ im Planungsverlauf der Sitzung, damit Schulportal-Eintrag und Präsentations-Prompt der Plattform darauf aufbauen.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", description: "Markdown", maxLength: 100000 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "save_schulportal_entry", title: "Schulportal-Eintrag speichern", annotations: { ...wr, destructiveHint: true },
    description: "Ersetzt den Schulportal-Eintrag der Sitzung. Format: Schulportal-Zeichen (**fett**, ~~kursiv~~, __unterstrichen__, --durchgestrichen--, Zeilen mit \"- \"), Struktur wie in der Vorlage (nummerierte fette Phasen, Stichpunkte, „--> Nächste Stunde“). " +
      "Übergib base_version aus get_lesson, damit keine neuere Änderung der Lehrkraft überschrieben wird.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", maxLength: 30000 }, base_version: { type: "integer", minimum: 0 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "add_text_material", title: "Textmaterial hinzufügen", annotations: wr,
    description: "Legt ein Unterrichtsmaterial als Text (Markdown: Überschriften, Listen, Tabellen, **fett**) in der Sitzung ab. Schüler:innen laden es als PDF herunter (z. B. für GoodNotes). " +
      "bereich: \"schueler\" (für Schüler:innen sichtbar) oder \"lehrkraft\" (nur für die Lehrkraft, z. B. Erwartungshorizont).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, bereich: { type: "string", enum: ["schueler", "lehrkraft"] }, titel: { type: "string", maxLength: 200 }, markdown: { type: "string", maxLength: 200000 } },
      required: ["lesson_id", "bereich", "titel", "markdown"], additionalProperties: false } },
  { name: "propose_feibeitsblatt", title: "Feibeitsblatt vorschlagen", annotations: wr,
    description: "Legt einen Feibeitsblatt-ENTWURF in der Sitzung ab. " + FEIBEITSBLATT_INFO + " Die Lehrkraft prüft und ändert den Entwurf in der Plattform und legt das Blatt dort selbst an (das Anlegen braucht ihr Feibeitsblatt-Passwort im Browser).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 120 },
      aufgaben: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: {
        text: { type: "string", description: "Aufgabenstellung", maxLength: 4000 }, material: { type: "string", description: "optionaler Materialtext", maxLength: 8000 },
        ki_auftrag: { type: "string", description: "Auftrag an die KI: worauf sie beim Feedback achten soll", maxLength: 8000 },
        antwort: { description: "\"text\" oder Tabelle", oneOf: [{ type: "string", enum: ["text"] }, { type: "object", properties: { tabelle: { type: "array", items: { type: "string", maxLength: 60 }, minItems: 1, maxItems: 8 }, zeilen: { type: "integer", minimum: 1, maximum: 30 } }, required: ["tabelle"] }] } },
        required: ["text", "ki_auftrag"] } } }, required: ["lesson_id", "titel", "aufgaben"], additionalProperties: false } },
];

const toolText = (text, structured) => ({ content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

async function lessonDump(db, l) {
  const ctx = await lessonCtx(db, l);
  const [msgs, drafts] = await Promise.all([chatMessages(db, l.id, 80), db.prepare("SELECT id, data, status, sheet_code FROM fb_drafts WHERE lesson_id=?1 ORDER BY created_at DESC LIMIT 10").bind(l.id).all()]);
  const parts = [
    "# Sitzung " + l.id, lessonContext(ctx, { portal: false, materialText: true, materialMax: 20000 }),
    "Sitzungscode für Schüler:innen: " + formatCode(l.code),
    "", "## Schulportal-Eintrag (Version " + l.portal_version + (l.portal_source ? ", zuletzt von " + l.portal_source : "") + ")", l.portal || "(noch leer)",
    "", "## Planungsverlauf", chatTranscript(msgs, 60000) || "(leer)",
  ];
  const ds = (drafts.results || []);
  if (ds.length) {
    parts.push("", "## Feibeitsblatt-Entwürfe");
    for (const d of ds) parts.push("- " + d.id + " (" + d.status + (d.sheet_code ? ", Code " + formatCode(d.sheet_code) : "") + "): " + d.data.slice(0, 4000));
  }
  parts.push("", "## Rolle des Planungsassistenten der Plattform (zur Orientierung)", SYSTEM_PROMPT_ROLE);
  return parts.join("\n");
}

async function callTool(c, name, a) {
  a = a && typeof a === "object" ? a : {};
  switch (name) {
    case "list_lessons": {
      let q = "SELECT id, subject, klass, title, topic, lesson_date, duration_min, updated_at FROM lessons", args = [];
      if (a.fach) { args.push(a.fach); q += " WHERE subject=?1"; }
      if (a.klasse) { args.push(a.klasse); q += (args.length > 1 ? " AND" : " WHERE") + " klass=?" + args.length; }
      const r = await c.db.prepare(q + " ORDER BY updated_at DESC LIMIT 100").bind(...args).all();
      const rows = (r.results || []).map((x) => ({ id: x.id, fach: subjectName(x.subject), klasse: x.klass, jahrgang: gradeInfo(x.klass).text, titel: x.title, thema: x.topic, datum: x.lesson_date, dauer_minuten: x.duration_min }));
      return toolText(rows.length ? rows.map((x) => "- " + x.id + ": " + x.titel + " (" + x.fach + ", " + x.klasse + (x.datum ? ", " + x.datum : "") + ")").join("\n") : "Keine Sitzungen gefunden.", { lessons: rows });
    }
    case "get_lesson": {
      const l = await getLesson(c.db, a.lesson_id);
      return toolText(await lessonDump(c.db, l), { lesson_id: l.id, portal_version: l.portal_version });
    }
    case "create_lesson": {
      const l = await createLesson(c.db, { subject: a.fach, klass: a.klasse, title: a.titel, topic: a.thema, durationMin: a.dauer_minuten ?? null, date: a.datum || null }, c.now);
      return toolText("Sitzung angelegt: " + l.id + " – Sitzungscode " + formatCode(l.code), { lesson: lessonOut(l) });
    }
    case "update_lesson": {
      await getLesson(c.db, a.lesson_id);
      const b = {};
      if (a.titel !== undefined) b.title = a.titel;
      if (a.thema !== undefined) b.topic = a.thema;
      if (a.dauer_minuten !== undefined) b.durationMin = a.dauer_minuten;
      if (a.datum !== undefined) b.date = a.datum;
      if (a.ideen !== undefined) b.ideas = a.ideen;
      if (a.hausaufgabe !== undefined) b.homework = a.hausaufgabe;
      const { lesson: l } = await updateLesson(c.db, a.lesson_id, b, c.now);
      return toolText("Gespeichert.", { lesson: lessonOut(l) });
    }
    case "save_planning_result": {
      await getLesson(c.db, a.lesson_id);
      const t = cleanText(a.text, LIMITS.answer).trim();
      if (!t) return toolError("Der Text ist leer.");
      await c.db.batch([
        c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) VALUES(?1, 'assistant', ?2, 'Claude (claude.ai, Connector)', 'claude', ?3)").bind(a.lesson_id, t, c.now),
        c.db.prepare("UPDATE lessons SET updated_at=?2 WHERE id=?1").bind(a.lesson_id, c.now),
      ]);
      return toolText("Im Planungsverlauf der Sitzung gespeichert.");
    }
    case "save_schulportal_entry": {
      await getLesson(c.db, a.lesson_id);
      if (typeof a.text !== "string" || !a.text.trim()) return toolError("Der Eintrag ist leer.");
      try {
        const p = await savePortal(c.db, a.lesson_id, a.text, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now);
        return toolText("Schulportal-Eintrag gespeichert (Version " + p.version + ").", { version: p.version });
      } catch (e) {
        if (e instanceof HttpError && e.code === "portal_conflict") return toolError("Der Eintrag wurde inzwischen geändert (aktuelle Version " + e.extra.current.version + "). Bitte get_lesson erneut aufrufen und die Änderungen der Lehrkraft berücksichtigen.");
        throw e;
      }
    }
    case "add_text_material": {
      await getLesson(c.db, a.lesson_id);
      const area = a.bereich === "schueler" ? "student" : a.bereich === "lehrkraft" ? "teacher" : "";
      const f = await insertTextMaterial(c.db, a.lesson_id, area, a.titel, a.markdown, "claude", c.now);
      return toolText("Material „" + f.name + "“ gespeichert (" + (area === "student" ? "für Schüler:innen sichtbar" : "nur für die Lehrkraft") + ").", { file_id: f.id });
    }
    case "propose_feibeitsblatt": {
      await getLesson(c.db, a.lesson_id);
      const d = await insertDraft(c.db, a.lesson_id, { title: a.titel, tasks: a.aufgaben }, "claude", c.now);
      return toolText("Entwurf gespeichert (" + d.data.tasks.length + " Aufgaben). Die Lehrkraft prüft ihn in der Plattform unter „Feibeitsblatt“ und legt das Blatt dort an.", { draft_id: d.id });
    }
  }
  return null;
}

/* ---------- Transport ---------- */
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

async function handleRpc(c, msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "Invalid Request");
  const isNote = msg.id === undefined || msg.id === null;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const meta = params._meta && typeof params._meta === "object" ? params._meta : null;
  const reqVersion = meta && meta["io.modelcontextprotocol/protocolVersion"];
  const modern = typeof reqVersion === "string";
  if (modern && reqVersion !== MODERN) return rpcError(msg.id, -32022, "Unsupported protocol version", { supported: [MODERN, ...LEGACY], requested: reqVersion });
  const done = (result) => (isNote ? null : rpcResult(msg.id, modern ? { resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } } : result));
  switch (msg.method) {
    case "initialize": {
      const v = LEGACY.includes(params.protocolVersion) ? params.protocolVersion : LEGACY[0];
      return done({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "server/discover":
      return done({ supportedVersions: [MODERN, ...LEGACY], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3600000, cacheScope: "private" });
    case "notifications/initialized": case "notifications/cancelled": return null;
    case "ping": return done({});
    case "tools/list": return done({ tools: TOOLS, ...(modern ? { ttlMs: 600000, cacheScope: "private" } : {}) });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) return rpcError(msg.id, -32602, "Unbekanntes Werkzeug: " + String(params.name).slice(0, 60));
      try { return done(await callTool(c, params.name, params.arguments)); }
      catch (e) { return done(toolError(e instanceof HttpError || e instanceof Error ? e.message : "Fehler")); }
    }
    default:
      if (isNote) return null;
      return rpcError(msg.id, -32601, "Method not found");
  }
}

async function checkToken(c, token) {
  const key = "mcp:" + (await sha256Hex("mcpip|" + c.ip));
  if (await lockedFor(c.db, key, c.now)) throw new HttpError(429, "locked", "Zu viele ungültige Zugriffe.");
  const s = await getSetting(c.db, "mcp");
  if (!token || !s || !s.hash || !timingSafeEqual(await sha256Hex("mcp|" + token), s.hash)) {
    await registerFail(c.db, key, LOCKS.mcp, c.now);
    throw new HttpError(401, "unauthorized", "Ungültiger Connector-Schlüssel.");
  }
}

export async function routeMcp(c, pathToken) {
  const h = /^Bearer\s+(\S+)\s*$/i.exec(c.request.headers.get("authorization") || "");
  const token = pathToken || (h && h[1]) || "";
  if (c.request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  try { await checkToken(c, token); }
  catch (e) { return new Response(JSON.stringify(rpcError(null, -32001, e.message)), { status: e.status || 401, headers: { "Content-Type": "application/json" } }); }
  let body;
  try { body = JSON.parse(await c.request.text()); } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }); }
  const out = Array.isArray(body) ? (await Promise.all(body.slice(0, 20).map((m) => handleRpc(c, m)))).filter(Boolean) : await handleRpc(c, body);
  if (!out || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/* ---------- Verwaltung des Connector-Schlüssels (Lehrkraft) ---------- */
export async function routeMcpGet(c) {
  await requireTeacher(c);
  const s = await getSetting(c.db, "mcp");
  return json({ ok: true, active: !!(s && s.hash), createdAt: (s && s.createdAt) || null });
}
export async function routeMcpCreate(c) {
  await requireTeacher(c);
  const token = randomToken(32);
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|" + token), createdAt: c.now });
  const origin = new URL(c.request.url).origin;
  return json({ ok: true, token, url: origin + "/mcp/" + token, headerUrl: origin + "/mcp" });
}
export async function routeMcpDelete(c) {
  await requireTeacher(c);
  await setSetting(c.db, "mcp", {});
  return json({ ok: true });
}
export { cleanLine };
