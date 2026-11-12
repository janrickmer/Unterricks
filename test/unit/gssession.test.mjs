// Sitzung der Grundschule (Slice S6): Prompt „Stunde mit Claude planen“, Felder für die Eltern, Verweise im Verlaufsplan, Druckliste für
// Arbeitsblätter der Kinder und der Connector (get_lesson, save_verlaufsplan, update_lesson inhalt_eltern, add_material_pdf) – mit der
// D1-Nachbildung aus fake-d1.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const { SYSTEM_PROMPT_ROLE, PORTAL_EXAMPLE, MATERIAL_DESIGN_RULES, parentMaterial, STOP_LINE } = await import("../../public/shared.js");
const P = await import("../../public/gsplanning.js");

const TOKEN = "lehrkraft-token-123";
async function ctx() {
  const c = fakeCtx();
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  return c;
}
const call = async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const mcpOf = async (c) => {
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : "tools/list", params: name ? { name, arguments: args } : {} }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
};
const REL = { grade: 2, classes: ["a", "b"], religion: true, description: "Wir lernen Geschichten aus der Bibel kennen.", weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 };
async function setup() {
  const c = await ctx();
  const k = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", REL)).data.course;
  const l1 = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef und seine Brüder", date: "2026-11-03", startTime: "08:00", durationMin: 45 }, c.now);
  const l2 = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef in Ägypten", date: "2026-11-10", startTime: "08:00", durationMin: 45 }, c.now + 1);
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-10" }, c.now + 2);
  const file = async (lessonId, area, name, extra = {}) => {
    const id = (await sha256Hex(lessonId + name)).slice(0, 16);
    await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, created_at, updated_at, print_copies) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 10, 'ready', 'upload', ?7, ?7, ?8)")
      .bind(id, lessonId, area, extra.kind || "file", name, extra.mime || "application/pdf", c.now + (extra.at || 0), extra.copies ?? null).run();
    return id;
  };
  return { c, k, l1, l2, sek, file };
}

test("Prompt „Stunde mit Claude planen“ (Grundschule): Chat-Name, Rolle, Verlaufsplan, Inhalt für Eltern, Bildkarten – kein Schulportal", () => {
  const course = { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", gradeText: "Jahrgangsstufe 2 der Grundschule", subjectName: "Religion", description: "Bibel" };
  const unit = { id: "u".repeat(16), rows: [{ uid: "aaaaaaaa" }, { uid: "bbbbbbbb", minutes: 45 }] };
  const ctx = { lessonId: "f".repeat(16), course, classSize: 22, lesson: { title: "Josef in Ägypten", durationMin: 45, date: "2026-11-10", startTime: "08:00", homework: "Bild malen" },
    materials: [{ id: "1".repeat(16), name: "Arbeitsblatt.pdf", area: "student", kind: "file", mime: "application/pdf" }], unit, row: unit.rows[1], unitText: "Unterrichtseinheit: Josef",
    previousStop: { title: "Josef und seine Brüder", date: "2026-11-03", portal: "**1) Start**\n" + STOP_LINE + "\n**2) Rest**" } };
  assert.equal(P.gsChatName(ctx), "GS Religion 2ab - Sitzung 2 - Josef in Ägypten");
  const p = P.claudeGsLessonPrompt(ctx);
  assert.ok(p.startsWith("Chat-Name: GS Religion 2ab - Sitzung 2 - Josef in Ägypten\n\n" + SYSTEM_PROMPT_ROLE));
  for (const s of ["save_verlaufsplan", "inhalt_eltern", "add_picture_cards", "[[pdf:", "add_material_pdf", "`anzahl` 22", "Schülerzahl laut Kurseinstellungen: 22", "Grundschule in Hessen",
    "file_id " + "1".repeat(16), "Zwischenstopp", P.GS_MATERIAL_RULES[0], P.CARD_DESIGN_RULES[0], P.VERLAUFSPLAN_EXAMPLE, "update_unit_row", "Hausaufgabe (für Eltern und Kinder sichtbar): Bild malen",
    "Lehrkraft liest [[pdf:<file_id>|Vorlesetext – Die Arche Noah]] vor."]) assert.ok(p.includes(s), s);
  for (const s of ["save_schulportal_entry", "propose_feibeitsblatt", PORTAL_EXAMPLE, "Sitzungscode für"]) assert.ok(!p.includes(s), s);
  assert.ok(!p.replace(/keine Präsentation/g, "").includes("Präsentation"), "„Präsentation“ nur verneint");
  // ohne Schülerzahl: nach der Zahl der Kinder fragen
  assert.ok(P.claudeGsLessonPrompt({ ...ctx, classSize: null }).includes("frag mich nach der Zahl der Kinder"));
});

test("Felder für die Eltern: nur bei Sitzungen der Grundschule; lessonOut ohne Elternlink, Gymnasium unverändert", async () => {
  const { c, l2, sek } = await setup();
  let r = await call(c, L.routeLessonPatch, "PATCH", "/api/teacher/lessons/" + sek.id, { parentSummary: "x" }, sek.id);
  assert.equal(r.status, 400); assert.equal(r.data.error, "Nur bei Sitzungen der Grundschule.");
  r = await call(c, L.routeLessonPatch, "PATCH", "/api/teacher/lessons/" + sek.id, { parentNote: "x" }, sek.id);
  assert.equal(r.status, 400);
  r = await call(c, L.routeLessonPatch, "PATCH", "/api/teacher/lessons/" + l2.id, { parentSummary: "  Wir haben die Josefsgeschichte gehört.  ", parentNote: "Bitte Malstifte mitgeben." + "x".repeat(3000) }, l2.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.lesson.parentSummary, "Wir haben die Josefsgeschichte gehört.");
  assert.equal(r.data.lesson.parentNote.length, 2000);
  assert.deepEqual([r.data.lesson.cancelled, r.data.lesson.hasParentLink], [false, false]);
  for (const k of ["parentHash", "parent_hash", "parentSealed", "token"]) assert.ok(!(k in r.data.lesson), k);
  const s = L.lessonOut(await L.getLesson(c.db, sek.id));
  for (const k of ["parentSummary", "parentNote", "cancelled", "hasParentLink"]) assert.ok(!(k in s), "Gymnasium ohne " + k);
});

test("Sitzung lesen (Grundschule): PDFs der vorigen Sitzung und Verweise als refFiles, Zeitpunkt für die Eltern; Schulportal-Eintrag erstellen abgelehnt", async () => {
  const { c, l1, l2, sek, file } = await setup();
  const a = await file(l1.id, "student", "Bildkarten Josef.pdf");
  const t = await file(l1.id, "teacher", "Erzähltext.pdf", { at: 1 });
  const x = await file(l1.id, "student", "Notizen", { kind: "text", mime: "text/markdown", at: 2 });
  const own = await file(l2.id, "student", "Arbeitsblatt.pdf");
  const other = await file(sek.id, "student", "Fremd.pdf");
  await L.savePortal(c.db, l2.id, "**1) Erzählung**\n- [[pdf:" + a + "]]\n- [[pdf:" + other + "]]\n- [[pdf:" + own + "]]", null, "claude", c.now);
  const r = await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + l2.id, undefined, l2.id);
  assert.equal(r.status, 200);
  const ids = r.data.refFiles.map((f) => f.id).sort();
  assert.deepEqual(ids, [a, t].sort(), "PDFs der vorigen Sitzung (kein Text, keine fremde Klasse, nicht die eigenen)");
  assert.ok(r.data.refFiles.every((f) => f.previous && f.lessonId === l1.id && f.mime === "application/pdf"));
  assert.ok(!r.data.refFiles.some((f) => f.id === x));
  assert.equal(r.data.opensAt, Date.parse("2026-11-10T07:45:00Z"), "Ende 08:45 Uhr (MEZ)");
  assert.equal(r.data.lesson.parentSummary, "");
  // dieselbe Regel wie im Worker: ohne Zwischenstopp sieht man die Verweise des Kurses und die eigenen PDFs der Kinder
  const pm = parentMaterial(r.data.lesson.portal, [...r.data.files.map((f) => ({ ...f, lessonId: l2.id })), ...r.data.refFiles], l2.id);
  assert.deepEqual(pm.files, [a, own]);
  const g = await call(c, L.routePortalGenerate, "POST", "/api/teacher/lessons/" + l2.id + "/portal/generate", {}, l2.id);
  assert.equal(g.status, 400); assert.equal(g.data.error, "In der Grundschule gibt es keinen Schulportal-Eintrag.");
  // Gymnasium: keine zusätzlichen Felder
  const s = await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + sek.id, undefined, sek.id);
  assert.ok(!("refFiles" in s.data) && !("opensAt" in s.data));
});

test("Druckliste: PDFs der Kinder (Grundschule) mit Anzahl – an und aus; am Gymnasium nur Druckvorlagen", async () => {
  const { c, l2, sek, file } = await setup();
  const ab = await file(l2.id, "student", "Arbeitsblatt.pdf");
  let r = await call(c, F.routeFilePatch, "PATCH", "/api/teacher/files/" + ab, { duplex: false }, ab);
  assert.equal(r.status, 400, "erst die Anzahl");
  r = await call(c, F.routeFilePatch, "PATCH", "/api/teacher/files/" + ab, { copies: 22 }, ab);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.file.print, r.data.file.printName], [{ copies: 22, duplex: true, color: false }, "22x - beidseitig - sw - Arbeitsblatt.pdf"]);
  r = await call(c, F.routeFilePatch, "PATCH", "/api/teacher/files/" + ab, { duplex: false, color: true }, ab);
  assert.equal(r.data.file.printName, "22x - einseitig - Farbe - Arbeitsblatt.pdf");
  r = await call(c, F.routeFilePatch, "PATCH", "/api/teacher/files/" + ab, { copies: null }, ab);
  assert.ok(r.status === 200 && !("print" in r.data.file) && r.data.file.area === "student");
  const sekAb = await file(sek.id, "student", "AB.pdf");
  r = await call(c, F.routeFilePatch, "PATCH", "/api/teacher/files/" + sekAb, { copies: 22 }, sekAb);
  assert.equal(r.status, 400); assert.equal(r.data.error, "Anzahl, beidseitig und Farbe gibt es nur bei Dateien zum Ausdrucken.");
});

test("Connector (Grundschule): get_lesson, save_verlaufsplan, update_lesson inhalt_eltern, add_material_pdf mit Anzahl; Gymnasium abgelehnt", async () => {
  const { c, k, l1, l2, sek, file } = await setup();
  const mcp = await mcpOf(c);
  const list = await mcp(null);
  const amp = list.tools.find((t) => t.name === "add_material_pdf"), sv = list.tools.find((t) => t.name === "save_verlaufsplan"), ul = list.tools.find((t) => t.name === "update_lesson");
  assert.ok(amp.description.includes(MATERIAL_DESIGN_RULES[0]) && amp.description.includes("Atkinson Hyperlegible Next") && amp.description.includes(P.GS_MATERIAL_RULES[0]));
  assert.ok(sv && sv.description.includes(P.VERLAUFSPLAN_EXAMPLE) && sv.description.includes("setze selbst keinen") && ul.inputSchema.properties.inhalt_eltern.maxLength === 800);
  const prevAb = await file(l1.id, "student", "Bildkarten Josef.pdf");
  // get_lesson: Grundschul-Aufbau, ohne Sitzungscode
  let r = await mcp("get_lesson", { lesson_id: l2.id });
  let t = r.content[0].text;
  for (const s of ["# Sitzung " + l2.id + " (Grundschule)", "Fach: Religion", "Lerngruppe: Religion · Jahrgang 2 (Klassen 2a, 2b)", "Schülerzahl laut Kurseinstellungen: 22",
    "Ziel des Kurses (Beschreibung der Lehrkraft): Wir lernen Geschichten", "## Verlaufsplan (Version 0)", "## Inhalt der Unterrichtsstunde (für die Eltern)",
    "## Hinweis der Lehrkraft für die Eltern (nur lesen)", "## PDF-Dateien des Kurses für Verweise ([[pdf:<file_id>]])", "file_id " + prevAb + ": „Bildkarten Josef.pdf“ (für die Kinder – Eltern sehen sie nach der Stunde; fertig) → [[pdf:" + prevAb + "]]"])
    assert.ok(t.includes(s), s);
  for (const s of ["Sitzungscode", l2.code, "Schulportal", "Feibeitsblatt", "Unterrichtsfach:"]) assert.ok(!t.includes(s), s);
  // Schulportal-Eintrag und Verlaufsplan: jeweils nur in ihrer Schulform
  r = await mcp("save_schulportal_entry", { lesson_id: l2.id, text: "x" });
  assert.ok(r.isError && /save_verlaufsplan/.test(r.content[0].text));
  r = await mcp("save_verlaufsplan", { lesson_id: sek.id, text: "x" });
  assert.ok(r.isError); assert.equal(r.content[0].text, "Nur für Grundschul-Sitzungen – sonst save_schulportal_entry.");
  // add_material_pdf: Arbeitsblatt der Kinder mit Anzahl → auch auf der Druckliste; die Antwort nennt den Verweis (ohne Drucker: wartet)
  r = await mcp("add_material_pdf", { lesson_id: l2.id, bereich: "schueler", titel: "Arbeitsblatt Josef", html: "<h1>Josef</h1>", anzahl: 22 });
  assert.ok(!r.isError, JSON.stringify(r));
  const abId = r.structuredContent.file_id;
  assert.ok(r.content[0].text.includes("für die Kinder (Eltern sehen es nach der Stunde) und in der Liste „Von der Lehrkraft auszudrucken“ als „22x - beidseitig - sw - Arbeitsblatt Josef.pdf“"), r.content[0].text);
  assert.ok(r.content[0].text.includes("Verweis im Verlaufsplan: [[pdf:" + abId + "]]."));
  const ab = await F.getFile(c.db, abId);
  assert.deepEqual([ab.area, ab.print_copies, ab.print_duplex, ab.print_color], ["student", 22, 1, 0]);
  r = await mcp("add_material_pdf", { lesson_id: l2.id, bereich: "schueler", titel: "Ohne Anzahl", html: "<h1>x</h1>" });
  assert.equal((await F.getFile(c.db, r.structuredContent.file_id)).print_copies, null, "ohne anzahl nicht auf der Druckliste");
  // am Gymnasium bleibt ein Arbeitsblatt der Schüler:innen ohne Druckangaben (auch mit anzahl)
  r = await mcp("add_material_pdf", { lesson_id: sek.id, bereich: "schueler", titel: "AB", html: "<h1>x</h1>", anzahl: 28 });
  assert.equal((await F.getFile(c.db, r.structuredContent.file_id)).print_copies, null);
  assert.ok(!r.content[0].text.includes("[[pdf:"));
  // save_verlaufsplan: unbekannter Verweis → gespeichert mit Warnung; danach gültig, Material nach dem Zwischenstopp sehen Eltern nicht
  const bad = "0123456789abcdef";
  r = await mcp("save_verlaufsplan", { lesson_id: l2.id, text: "**1) Erzählung (15 Min.)**\n- [[pdf:" + bad + "]]", base_version: 0 });
  assert.ok(!r.isError);
  t = r.content[0].text;
  assert.ok(t.startsWith("Verlaufsplan gespeichert (Version 1). Achtung: Diese Verweise gehören zu keiner PDF des Kurses: [[pdf:" + bad + "]]. Gültige file_id: "), t);
  assert.ok(t.includes(abId + " („Arbeitsblatt Josef.pdf“)") && t.includes(prevAb + " („Bildkarten Josef.pdf“)"));
  assert.deepEqual(r.structuredContent.unknown_refs, [bad]);
  r = await mcp("save_verlaufsplan", { lesson_id: l2.id, text: "x", base_version: 0 });
  assert.ok(r.isError && /aktuelle Version 1/.test(r.content[0].text), "Versionskonflikt");
  // Zwischenstopp der Lehrkraft: ein Verweis danach erscheint nicht bei den Eltern
  await L.savePortal(c.db, l2.id, "**1) Erzählung**\n- [[pdf:" + prevAb + "]]\n" + STOP_LINE + "\n**2) Arbeitsblatt**\n- [[pdf:" + abId + "]]", null, "lehrkraft", c.now);
  r = await mcp("get_lesson", { lesson_id: l2.id });
  assert.ok(r.content[0].text.includes("Eltern sehen nach der Stunde: „Bildkarten Josef.pdf“\n") && r.content[0].text.includes("hat die Lehrkraft gesetzt"), r.content[0].text);
  r = await mcp("save_verlaufsplan", { lesson_id: l2.id, text: "**1) Erzählung**\n- [[pdf:" + prevAb + "|Bildkarten]]\n**2) Arbeitsblatt**\n- [[pdf:" + abId + "]]", base_version: 2 });
  assert.ok(!r.isError && r.content[0].text.endsWith("Eltern sehen nach der Stunde: „Bildkarten Josef.pdf“."), r.content[0].text);   // das Arbeitsblatt ist noch nicht gedruckt
  // update_lesson inhalt_eltern
  r = await mcp("update_lesson", { lesson_id: l2.id, inhalt_eltern: "Wir haben gehört, wie Josef nach Ägypten kam." });
  assert.ok(!r.isError && r.structuredContent.lesson.parentSummary === "Wir haben gehört, wie Josef nach Ägypten kam.");
  r = await mcp("update_lesson", { lesson_id: sek.id, inhalt_eltern: "x" });
  assert.ok(r.isError && r.content[0].text === "Nur bei Sitzungen der Grundschule.");
  r = await mcp("get_lesson", { lesson_id: l2.id });
  assert.ok(r.content[0].text.includes("## Inhalt der Unterrichtsstunde (für die Eltern)\nWir haben gehört, wie Josef nach Ägypten kam."));
  assert.equal(r.structuredContent.verlaufsplan_version, 3);
  // Gymnasium: get_lesson unverändert mit Sitzungscode
  r = await mcp("get_lesson", { lesson_id: sek.id });
  assert.ok(r.content[0].text.includes("Sitzungscode für Schüler:innen:") && !r.content[0].text.includes("Grundschule"));
  assert.ok(k.id);
});

/* Anforderung 12: Aufforderung an die Lehrkraft, auf eigenes Material zurückzugreifen – eigener, unterstrichener Stichpunkt (Materialtitel kursiv) */
test("Anforderung 12: unterstrichene Aufforderung an die Lehrkraft – Verlaufsplan (Grundschule) und Schulportal-Eintrag (Gymnasium)", async () => {
  const S = await import("../../public/shared.js");
  const Pl = await import("../../public/planning.js");
  // Verlaufsplan: __…__ mit gelbem Verweis darin
  const [li] = S.parsePlanMarkup("- __Lehrkraft liest [[pdf:0123456789abcdef|Vorlesetext – Die Arche Noah]] vor.__");
  assert.equal(li.type, "li");
  assert.deepEqual(li.runs.map((r) => [r.text, r.u, r.file || null]), [["Lehrkraft liest ", true, null], ["", true, "0123456789abcdef"], [" vor.", true, null]]);
  const [li2] = S.parsePlanMarkup("- __Lehrkraft liest den Vorlesetext ~~Die Arche Noah~~ vor.__");
  assert.deepEqual(li2.runs.map((r) => [r.text, r.u, r.i]), [["Lehrkraft liest den Vorlesetext ", true, false], ["Die Arche Noah", true, true], [" vor.", true, false]]);
  for (const s of [P.VERLAUFSPLAN_RULES, P.VERLAUFSPLAN_EXAMPLE]) assert.ok(s.includes("- __Lehrkraft liest [[pdf:<file_id>|"), s);
  // Schulportal (Claude): Regel in Prompts und Connector; die Vorlage selbst bleibt unverändert
  assert.ok(S.PORTAL_TEACHER_RULE.includes("„- __Lehrkraft liest den Vorlesetext ~~Die Arche Noah~~ vor.__“") && !S.PORTAL_EXAMPLE.includes("__"));
  const lesson = { lessonId: "0123456789abcdef", subject: "ethik", klass: "7-K", lesson: { title: "Was ist gerecht?", durationMin: 45 }, materials: [], sheets: [], portal: "", unitText: "", messages: [] };
  assert.ok(Pl.claudeLessonPrompt(lesson).includes(S.PORTAL_TEACHER_RULE));
  assert.ok(Pl.claudeSubstitutePrompt({ ...lesson, klass: "8B" }).includes(S.PORTAL_TEACHER_RULE));
  const c = await ctx(), mcp = await mcpOf(c);
  const tools = (await mcp(null)).tools;
  assert.ok(tools.find((t) => t.name === "save_schulportal_entry").description.includes(S.PORTAL_TEACHER_RULE));
  assert.ok(tools.find((t) => t.name === "save_verlaufsplan").description.includes("unterstrichen"));
  // kostenlose KI: ‹…› wird unterstrichen, «…» darin kursiv
  const [sys] = S.portalMessages({ subject: "ethik", klass: "8B", lesson: { title: "x" }, materials: [], sheets: [] }, "Planung");
  assert.ok(sys.content.includes("‹Lehrkraft liest den Vorlesetext «Die Arche Noah» vor.›"));
  assert.equal(S.renderPortalEntry({ phasen: [{ titel: "Erzählung", punkte: ["‹Lehrkraft liest den Vorlesetext «Die Arche Noah» vor.›", "Arbeitsblatt «Noah»"] }] }),
    "**1) Erzählung**\n- __Lehrkraft liest den Vorlesetext ~~Die Arche Noah~~ vor.__\n- Arbeitsblatt ~~Noah~~");
});
