// Worker-Tests der Grundschulkurse (Slice S5): Kurse anlegen/ändern/löschen, Einheiten, Wochenkalender beider Schulformen, Listen ohne
// Grundschule am Gymnasium, Schutz (kein Vertretungsmaterial, kein Schülerzugang, kein Notfall), Connector (list_gs_courses, Filter, get_unit,
// get_planning_basis, Ablehnungen) und die Planungsgrundlagen eines Grundschulkurses.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const L = await import("../../worker/lessons.js");
const B = await import("../../worker/bases.js");
const SUB = await import("../../worker/substitute.js");
const ST = await import("../../worker/student.js");
const F = await import("../../worker/files.js");
const R = await import("../../worker/reset.js");
const CS = await import("../../worker/courses.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

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
const WD = [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "09:50" }];
const REL = { grade: 2, classes: ["b", "a"], religion: true, description: "Wir lernen Geschichten aus der Bibel kennen.", weekdays: WD, classSize: 22 };
const create = (c, body) => call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", body);
const mcpOf = async (c) => {
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : "tools/list", params: name ? { name, arguments: args } : {} }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
};

test("Grundschulkurs anlegen: Prüfungen, Kurseinstellungen im selben Schritt, Liste mit Zahlen", async () => {
  const c = await ctx();
  for (const [body, msg] of [[{ ...REL, grade: 5 }, "Bitte den Jahrgang 1–4 wählen."], [{ ...REL, classes: [] }, "Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c)."],
    [{ ...REL, classes: ["a", "d"] }, "Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c)."], [{ ...REL, religion: false, subjectName: " " }, "Bitte den Namen des Fachs eintragen."],
    [{ ...REL, weekdays: [{ day: 2, minutes: 45 }] }, "Bitte bei jedem Termin die Uhrzeit eintragen – daraus ergibt sich, ab wann Eltern eine Sitzung sehen können."],
    [{ ...REL, classSize: 70 }, "Die Schülerzahl muss zwischen 1 und 60 liegen."]]) {
    const r = await create(c, body);
    assert.equal(r.status, 400, msg); assert.equal(r.data.error, msg);
  }
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM gs_courses").first()).n, 0, "nichts angelegt");
  const r = await create(c, REL);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const k = r.data.course;
  assert.match(k.id, /^gs[a-f0-9]{8}$/);
  assert.deepEqual([k.grade, k.classes, k.religion, k.subjectName, k.short, k.label], [2, ["a", "b"], true, "Religion", "Religion 2ab", "Religion · Jahrgang 2 (Klassen 2a, 2b)"]);
  assert.equal(k.gradeText, "Jahrgangsstufe 2 der Grundschule, Kurs mit Kindern aus den Klassen 2a und 2b");
  assert.match(k.schoolYear, /^\d{4}\/\d{2}$/);
  const s = await CS.getCourseSettings(c.db, "gs", k.id);
  assert.deepEqual([s.weekdays, s.classSize], [WD, 22]);
  const sach = (await create(c, { grade: 3, classes: ["c"], religion: false, subjectName: "Sachunterricht", weekdays: [], classSize: null, schoolYear: "2027/28" })).data.course;
  assert.deepEqual([sach.short, sach.label, sach.schoolYear], ["Sachunterricht 3c", "Sachunterricht · Jahrgang 3 (Klasse 3c)", "2027/28"]);
  // Liste: zwei Anweisungen
  c.db.counter.n = 0;
  const list = (await call(c, GS.routeGsCourses, "GET", "/api/teacher/gs/courses")).data.courses;
  assert.equal(c.db.counter.n, 3, "Anmeldung + 2 Anweisungen");
  const mine = list.find((x) => x.id === k.id);
  assert.deepEqual([mine.settings.classSize, mine.counts, mine.revise], [22, { units: 0, lessons: 0 }, 0]);
  assert.deepEqual(list.find((x) => x.id === sach.id).settings.weekdays, []);
});

test("Grundschulkurs ändern und löschen: nur ohne Inhalte; mit dem Kurs gehen Kurseinstellungen und eigene Planungsgrundlagen", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  let r = await call(c, GS.routeGsCoursePatch, "PATCH", "/api/teacher/gs/courses/" + k.id, { religion: false }, k.id);
  assert.equal(r.status, 400); assert.equal(r.data.error, "Bitte den Namen des Fachs eintragen.");
  r = await call(c, GS.routeGsCoursePatch, "PATCH", "/api/teacher/gs/courses/" + k.id, { religion: false, subjectName: "Kunst", classes: ["c"] }, k.id);
  assert.deepEqual([r.data.course.short, r.data.course.grade, r.data.course.description], ["Kunst 2c", 2, REL.description]);
  r = await call(c, GS.routeGsCourseGet, "GET", "/api/teacher/gs/courses/" + k.id, undefined, k.id);
  assert.equal(r.data.course.subjectName, "Kunst"); assert.equal(r.data.settings.classSize, 22);
  assert.equal((await call(c, GS.routeGsCourseGet, "GET", "/x", undefined, "gs00000000")).status, 404);
  // eigene Planungsgrundlage mit PDF
  const b = (await call(c, B.routeBaseCreate, "POST", "/api/teacher/bases", { subject: k.id, kind: "sonstiges", title: "Lehrplan Kunst", pages: 1 })).data.base;
  await c.env.FILES.put("b/" + b.id + ".pdf", new TextEncoder().encode("%PDF-1.7"));
  // mit Einheit: nicht löschbar
  const u = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: k.id, title: "Farben" })).data.unit;
  r = await call(c, GS.routeGsCourseDelete, "DELETE", "/x", undefined, k.id);
  assert.equal(r.status, 409); assert.equal(r.data.error, "Zu diesem Kurs gibt es noch Unterrichtseinheiten oder Sitzungen. Bitte zuerst diese löschen.");
  await call(c, U.routeUnitDelete, "DELETE", "/x", undefined, u.id);
  r = await call(c, GS.routeGsCourseDelete, "DELETE", "/x", undefined, k.id);
  assert.equal(r.status, 200);
  for (const [t, w] of [["gs_courses", "id"], ["course_settings", "klass"], ["bases", "subject"]]) assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM " + t + " WHERE " + w + "=?1").bind(k.id).first()).n, 0, t);
  assert.equal(c.env.FILES.m.has("b/" + b.id + ".pdf"), false, "Original-PDF gelöscht");
});

test("Einheiten der Grundschule: Kurs muss existieren, Stundenplan aus den Kurseinstellungen, keine Klausur; Gymnasium unverändert", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  let r = await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: "gs00000000", title: "x" });
  assert.equal(r.status, 404); assert.equal(r.data.error, "Diesen Grundschulkurs gibt es nicht (mehr).");
  r = await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: "8A", title: "x" });
  assert.equal(r.status, 400);
  r = await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: k.id, title: "Josef", params: { exam: "2026-12-01" } });
  assert.equal(r.status, 200);
  const u = r.data.unit;
  assert.deepEqual(u.params.weekdays, WD); assert.equal(u.params.exam, null);
  assert.equal(u.course.gs.short, "Religion 2ab"); assert.equal(u.course.classSize, 22);
  r = await call(c, U.routeUnitPatch, "PATCH", "/x", { params: { ...u.params, exam: "2026-12-01", start: "2026-11-09", end: "2026-11-20" } }, u.id);
  assert.equal(r.data.unit.params.exam, null, "auch beim Speichern keine Klausur");
  r = await call(c, U.routeUnitsList, "GET", "/api/teacher/units?subject=gs&klass=" + k.id);
  assert.deepEqual(r.data.units.map((x) => x.id), [u.id]);
  assert.equal((await call(c, U.routeUnitsList, "GET", "/api/teacher/units?subject=gs&klass=gs00000000")).status, 404);
  // Gymnasium: bisherige Meldungen
  assert.equal((await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "mathe", klass: "8A" })).data.error, "Bitte eines der drei Fächer wählen.");
  assert.equal((await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "7A" })).data.error, "Politik und Wirtschaft wird in 7A laut Fach-Einstellungen nicht unterrichtet.");
  assert.equal((await call(c, U.routeUnitsList, "GET", "/api/teacher/units?subject=powi&klass=" + k.id)).data.error, "Fach oder Klasse ungültig.");
});

test("Wochenkalender: Einheiten beider Schulformen; Grundschule mit Kursnamen, nur vorhandene Kurse; Gymnasium unverändert", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  const P = { start: "2026-11-09", end: "2026-11-20", weekdays: WD };
  const g = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: k.id, title: "Josef", params: P })).data.unit;
  const s = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "8A", title: "Wahlen", params: { ...P, exam: "2026-11-12" } })).data.unit;
  await c.db.prepare("INSERT INTO units(id, subject, klass, title, params, created_at, updated_at) VALUES('00000000000000aa', 'gs', 'gs0000ffff', 'weg', ?1, 1, 1)").bind(JSON.stringify(P)).run();
  c.db.counter.n = 0;
  const r = await call(c, U.routeSchedule, "GET", "/api/teacher/schedule");
  assert.ok(c.db.counter.n <= 4, "Anmeldung, Fach-Einstellungen, ein Batch mit 2 Anweisungen: " + c.db.counter.n);
  const units = r.data.units;
  assert.deepEqual(units.map((x) => x.id).sort(), [g.id, s.id].sort(), "Einheit eines gelöschten Kurses fehlt");
  const gu = units.find((x) => x.id === g.id), su = units.find((x) => x.id === s.id);
  assert.deepEqual(gu.course, { id: k.id, short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)" });
  assert.deepEqual(Object.keys(su), ["id", "subject", "klass", "title", "params"], "Gymnasium ohne course");
  assert.equal(su.params.exam, "2026-11-12");
});

test("Sitzungslisten: ohne Fach nur das Gymnasium; Kurs bzw. school=gs nur die Grundschule; Sitzungen ohne Begrüßung", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  const g = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: k.id, title: "Josef" })).data.unit;
  const n = await L.createLessonsBulk(c.db, { subject: "gs", klass: k.id, topic: "Josef", unitId: g.id }, [{ title: "Wer war Josef?", date: "2026-11-10", durationMin: 45, startTime: "08:00", unitRow: "aaaaaaaa" }], c.now);
  assert.equal(n, 1);
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8A", title: "Wahlen", date: "2026-11-10" }, c.now);
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM chat WHERE lesson_id IN (SELECT id FROM lessons WHERE subject='gs')").first()).n, 0, "keine Begrüßung in der Grundschule");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM chat WHERE lesson_id=?1").bind(sek.id).first()).n, 1, "Gymnasium mit Begrüßung");
  let r = await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons");
  assert.deepEqual(r.data.lessons.map((x) => x.subject), ["powi"]);
  assert.equal("cancelled" in r.data.lessons[0], false, "Gymnasium: Felder wie bisher");
  r = await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons?school=gs");
  assert.deepEqual(r.data.lessons.map((x) => [x.subject, x.title, x.startTime, x.cancelled, x.hasParentLink, x.hasSummary]), [["gs", "Wer war Josef?", "08:00", false, false, false]]);
  r = await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons?subject=gs&klass=" + k.id);
  assert.equal(r.data.lessons.length, 1);
  assert.equal((await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons?subject=gs&klass=gs00000000")).status, 404);
  assert.equal((await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons?subject=powi")).data.lessons.length, 1);
});

test("Schutz: kein Vertretungsmaterial, kein Schülerzugang und kein Notfall-Feibeitsblatt in der Grundschule", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES('aaaaaaaaaaaaaaaa', 'gs', ?1, 'Josef', 'GSK123', 1, 1)").bind(k.id).run();
  await assert.rejects(SUB.saveProposal(c.db, "aaaaaaaaaaaaaaaa", { analyse: {}, schritte: [{ titel: "a", anleitung: "b" }], abgabe: "x" }, c.now),
    (e) => e.status === 400 && e.message === "In der Grundschule gibt es keine Vertretungsstunde – bei Krankheit verschiebt Unterricks die Stunden.");
  for (const fn of [SUB.routeSubstituteConfirm, SUB.routeSubstitutePreview]) {
    const r = await call(c, fn, "POST", "/x", {}, "aaaaaaaaaaaaaaaa");
    assert.equal(r.status, 400); assert.equal(r.data.code, "not_gs");
  }
  // Schüler:in mit dem Code der Grundschul-Sitzung: wie ein unbekannter Code (404, Fehlversuch gezählt)
  await c.db.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES('dev1', ?1, '8A', 'powi', 1, ?2, ?3)").bind(await sha256Hex("stud"), c.now, c.now + 3600e3).run();
  const req = new Request("https://unterricks.test/api/student/join", { method: "POST", headers: { Authorization: "Bearer stud", "Content-Type": "application/json" }, body: JSON.stringify({ code: "GSK123" }) });
  await assert.rejects(ST.routeStudentJoin({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }), (e) => e.status === 404 && e.code === "unknown_code");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM locks").first()).n, 2, "Fehlversuch für Gerät und Netz gezählt");
  // Notfall-Liste ohne Grundschule
  await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES('bbbbbbbbbbbbbbbb', 'powi', '8A', 'Wahlen', 'SEK123', 1, 1)").run();
  await c.db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, kind, created_at) VALUES('aaaaaaaaaaaaaaaa', 'ABC1234', 'Blatt', '', 1), ('bbbbbbbbbbbbbbbb', 'DEF5678', 'Blatt', '', 1)").run();
  const nf = await call(c, F.routeNotfallList, "GET", "/api/teacher/notfall");
  assert.equal(nf.status, 200); assert.deepEqual(nf.data.items.map((x) => x.lessonId), ["bbbbbbbbbbbbbbbb"]);
});

test("Planungsgrundlagen eines Grundschulkurses: Religion = Curriculum Ev. Religion des Jahrgangs; anderes Fach = eigene Grundlagen; Gymnasium unberührt", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  const sach = (await create(c, { grade: 3, classes: ["c"], religion: false, subjectName: "Sachunterricht", description: "Natur erleben", weekdays: [] })).data.course;
  const mk = async (subject, kind, texts, sections) => {
    const b = (await call(c, B.routeBaseCreate, "POST", "/api/teacher/bases", { subject, kind, title: kind + " " + subject, pages: texts.length, sections })).data.base;
    await call(c, B.routeBasePages, "PUT", "/x", { from: 1, texts }, b.id);
    return b;
  };
  let pb = await call(c, B.routeBasisPreview, "GET", "/api/teacher/basis?subject=gs&klass=" + k.id);
  assert.deepEqual(pb.data.missing, ["Schulcurriculum Ev. Religion (Grundschule) für Jahrgang 2"]);
  await mk("evrel", "gs-curriculum", ["Übersicht", "Jahrgangsstufe 1/2 Josef", "Jahrgangsstufe 3/4 Gleichnisse"], { allgemein: [1], 1: [2], 2: [2], 3: [3], 4: [3] });
  await mk("evrel", "schulcurriculum", ["Jahrgang 8 Reformation"], { 8: [1] });
  await mk(sach.id, "gs-curriculum", ["Klasse 3 Wasser", "Klasse 4 Strom"], { 3: [1], 4: [2] });
  pb = await call(c, B.routeBasisPreview, "GET", "/api/teacher/basis?subject=gs&klass=" + k.id);
  assert.deepEqual(pb.data.missing, []); assert.deepEqual(pb.data.docs.map((d) => [d.kind, d.pages]), [["gs-curriculum", "1–2"]]);
  const rel = await GS.planningBasisGs(c.db, k);
  assert.ok(rel.text.includes("Josef") && !rel.text.includes("Gleichnisse") && !rel.text.includes("Reformation") && !rel.text.includes("Wasser"));
  const s = await GS.planningBasisGs(c.db, sach);
  assert.ok(s.text.includes("Wasser") && !s.text.includes("Strom") && !s.text.includes("Josef")); assert.deepEqual(s.missing, []);
  assert.equal(s.description, "Natur erleben");
  assert.equal((await call(c, B.routeBasisPreview, "GET", "/api/teacher/basis?subject=gs&klass=gs00000000")).status, 404);
  // Gymnasium: Ev. Religion Jg. 8 sieht weder das Grundschul-Curriculum noch kurseigene Grundlagen
  const sek = await B.planningBasis(c.db, "evrel", "8A");
  assert.ok(sek.text.includes("Reformation") && !sek.text.includes("Josef") && !sek.text.includes("Wasser"));
});

test("Connector: list_gs_courses, Filter kurs/fach gs, get_unit und get_planning_basis der Grundschule, Ablehnungen", async () => {
  const c = await ctx();
  const mcp = await mcpOf(c);
  const k = (await create(c, REL)).data.course;
  const tools = (await mcp(null)).tools;
  assert.ok(tools.find((t) => t.name === "list_gs_courses"));
  assert.deepEqual(tools.find((t) => t.name === "list_lessons").inputSchema.properties.fach.enum, ["powi", "evrel", "ethik", "gs"]);
  assert.equal(tools.find((t) => t.name === "list_units").inputSchema.properties.kurs.pattern, "^gs[a-f0-9]{8}$");
  let r = await mcp("list_gs_courses", {});
  assert.match(r.content[0].text, new RegExp("^- " + k.id + ": Religion · Jahrgang 2 \\(Klassen 2a, 2b\\), Schuljahr \\d{4}/\\d{2}; Di 08:00 \\(45 Min\\.\\), Do 09:50 \\(45 Min\\.\\); 22 Kinder – Ziel: Wir lernen Geschichten aus der Bibel kennen\\.$"));
  const u = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: k.id, title: "Josef", params: { start: "2026-11-09", end: "2026-11-20" } })).data.unit;
  const sekU = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "8A", title: "Wahlen" })).data.unit;
  r = await mcp("save_unit_plan", { unit_id: u.id, plan: { lernaufgabe: "Bodenbild zur Josefsgeschichte", schritte: [{ titel: "Kennenlernen", beschreibung: "erzählen" }] },
    stunden: [{ stundenfrage: "Wer war Josef?", ablauf: ["Sitzkreis"], schritt: 0 }, { stundenfrage: "Josef in Ägypten", ablauf: ["Bildkarten"] }] });
  assert.ok(!r.isError, JSON.stringify(r));
  const unit = (await call(c, U.routeUnitGet, "GET", "/x", undefined, u.id)).data.unit;
  r = await mcp("get_unit", { unit_id: u.id });
  const t = r.content[0].text;
  assert.ok(t.startsWith("# Unterrichtseinheit " + u.id + " (Grundschule: Religion · Jahrgang 2 (Klassen 2a, 2b) – Jahrgangsstufe 2 der Grundschule, Kurs mit Kindern aus den Klassen 2a und 2b, 22 Kinder, Status: entwurf, Version "), t.split("\n")[0]);
  assert.ok(t.includes("\nZiel des Kurses: Wir lernen Geschichten aus der Bibel kennen.\n") && !t.includes("Klausur"));
  assert.ok(t.includes("\n1. [uid " + unit.rows[0].uid + "] Di, 10.11.2026 08:00 (45 min): Wer war Josef? [Lernschritt 1]\n   - Sitzkreis"), t);
  assert.ok(t.includes("\n2. [uid " + unit.rows[1].uid + "] Do, 12.11.2026 09:50 (45 min): Josef in Ägypten"));
  const sekT = (await mcp("get_unit", { unit_id: sekU.id })).content[0].text;
  assert.ok(sekT.includes("Klausurtermin: keiner angegeben") && !sekT.includes("[uid"), "Gymnasium unverändert");
  // Filter
  await L.createLessonsBulk(c.db, { subject: "gs", klass: k.id, topic: "Josef", unitId: u.id }, [{ title: "Wer war Josef?", date: "2026-11-10", durationMin: 45, startTime: "08:00", unitRow: unit.rows[0].uid }], c.now);
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8A", title: "Wahlen", date: "2026-11-10" }, c.now);
  r = await mcp("list_lessons", {});
  assert.ok(r.content[0].text.includes(": Wer war Josef? (Grundschule: Religion 2ab, 2026-11-10)") && r.content[0].text.includes(": Wahlen (Politik und Wirtschaft, 8A, 2026-11-10)"));
  r = await mcp("list_lessons", { kurs: k.id });
  assert.deepEqual(r.structuredContent.lessons.map((x) => x.titel), ["Wer war Josef?"]);
  r = await mcp("list_units", { fach: "gs" });
  assert.equal(r.content[0].text, "- " + u.id + ": Josef (Grundschule: Religion 2ab, entwurf, 2 Stunden)");
  // Planungsgrundlagen
  r = await mcp("get_planning_basis", { unit_id: u.id });
  assert.ok(r.content[0].text.startsWith("# Planungsgrundlagen für Religion · Jahrgang 2 (Klassen 2a, 2b) (Grundschule)\n\nLerngruppe: "));
  assert.ok(r.content[0].text.includes("## Ziel des Kurses\nWir lernen") && r.content[0].text.includes("Schulcurriculum Ev. Religion (Grundschule) für Jahrgang 2"));
  // Ablehnungen
  const gsl = (await c.db.prepare("SELECT id FROM lessons WHERE subject='gs'").first()).id;
  for (const [name, args, msg] of [["save_schulportal_entry", { text: "**1) x**" }, "In der Grundschule gibt es keinen Schulportal-Eintrag – speichere den Verlaufsplan mit save_verlaufsplan."],
    ["propose_feibeitsblatt", { titel: "x", aufgaben: [{ text: "a" }] }, "In der Grundschule gibt es keine Feibeitsblätter."],
    ["save_substitute_plan", { analyse: { kompetenz: "a", stundenfrage: "b", inhalte: [] }, schritte: [{ titel: "a", anleitung: "b" }], abgabe: "x" }, "In der Grundschule gibt es keine Vertretungsstunde – bei Krankheit verschiebt Unterricks die Stunden; danach überarbeitest du die Einheit."]]) {
    r = await mcp(name, { lesson_id: gsl, ...args });
    assert.equal(r.isError, true, name); assert.equal(r.content[0].text, msg);
  }
  r = await mcp("save_schulportal_entry", { lesson_id: sek.id, text: "**1) x**" });
  assert.ok(!r.isError, "Gymnasium: Schulportal wie bisher");
});

test("Sicherung: Übersicht nennt die Grundschulkurse (Ordnernamen)", async () => {
  const c = await ctx();
  const k = (await create(c, REL)).data.course;
  const r = await call(c, R.routeBackupIndex, "GET", "/api/teacher/backup");
  assert.deepEqual(r.data.gsCourses, [{ id: k.id, short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)" }]);
});
