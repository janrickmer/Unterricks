// Nr. 17 (Wunsch der Lehrkraft vom 13.11.2026): Links im Material und in der Aufgabenstellung von Feibeitsblättern, die Unterricks anlegt,
// werden Link-Läufe des Feibeitsblatts – anklickbar, für die Schüler:innen in neuem Tab. Geprüft gegen eine Kopie des Validators des
// Feibeitsblatts (das Feibeitsblatt lehnt ein Blatt sonst ab) und gegen die Notfall-PDF (Adresse als Link wie im analogen Arbeitsblatt).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { FbClient, materialRuns, taskTextFmt, fbLinksOf, fbHref, FB_LIMITS } = await import("../../public/fbclient.js");
const { sheetToDraft } = await import("../../public/sessionfile.js");
const S = await import("../../public/shared.js");
const { makeAnalogPdf } = await import("../../public/fbanalog.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

/* Kopie aus dem Feibeitsblatt (worker/lib.js: cleanHref, validateMaterial, materialText, isFormatted – Stand 13.11.2026), nur die Prüfungen */
const LIMITS = { material: 8000, taskText: 4000, materialParagraphs: 200, materialRuns: 600, materialLinks: 60, href: 1000 };
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function cleanHref(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > LIMITS.href || /[\u0000-\u0020\u007f]/.test(s)) return "";
  let u; try { u = new URL(s); } catch { return ""; }
  return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= LIMITS.href ? u.href : "";
}
function validateMaterial(raw, chars = LIMITS.material) {
  if (!Array.isArray(raw)) throw new Error("Format");
  if (raw.length > LIMITS.materialParagraphs) throw new Error("zu viele Absätze");
  let n = 0, runs = 0, links = 0;
  const out = raw.map((para) => {
    if (!Array.isArray(para)) throw new Error("Format");
    runs += para.length;
    if (runs > LIMITS.materialRuns) throw new Error("zu kleinteilig");
    const line = [];
    for (const r of para) {
      if (!r || typeof r.t !== "string" || (r.f != null && typeof r.f !== "string") || (r.h != null && typeof r.h !== "string")) throw new Error("Format");
      if (r.t.length > chars) throw new Error("zu lang");
      const t = r.t.replace(/\r\n?/g, "\n").replace(CTRL_RE, "").replace(/[\t\n\r\u00a0]+/g, " ");
      if (!t) continue;
      n += t.length; if (n > chars) throw new Error("zu lang");
      const f = ["b", "i", "u"].filter((c) => String(r.f || "").includes(c)).join("");
      let h = ""; if (r.h) { h = cleanHref(r.h); if (!h) throw new Error("Link ungültig: " + r.h); }
      const prev = line[line.length - 1];
      if (prev && (prev.f || "") === f && (prev.h || "") === h) { prev.t += t; continue; }
      const run = { t }; if (f) run.f = f;
      if (h) { run.h = h; if (++links > LIMITS.materialLinks) throw new Error("zu viele Links"); }
      line.push(run);
    }
    return line;
  });
  while (out.length && !out[out.length - 1].length) out.pop();
  while (out.length && !out[0].length) out.shift();
  return out;
}
const materialText = (m) => m.map((p) => p.map((r) => r.t).join("")).join("\n").trim();
// … und aus validateSheetInput: mit textFmt leitet das Feibeitsblatt die Aufgabenstellung daraus ab – leer oder über 4000 Zeichen → abgelehnt
function validateTask(t) {
  const fmt = validateMaterial(t.textFmt == null ? [] : t.textFmt, LIMITS.taskText);
  const text = (fmt.length ? materialText(fmt) : String(t.text).replace(/\r\n?/g, "\n").replace(CTRL_RE, "")).trim();
  if (!text) throw new Error("Bitte eine Aufgabenstellung eintragen.");
  if (text.length > LIMITS.taskText) throw new Error("Die Aufgabenstellung ist zu lang");
  if (t.material != null) validateMaterial(t.material);
  return text;
}
const linksIn = (paras) => paras.flat().filter((r) => r.h);

test("Material: Markdown-Links und nackte Adressen werden Link-Läufe (Satzzeichen und Klammern am Ende nicht, Klammern in Wikipedia-Adressen schon)", () => {
  const m = materialRuns("Siehe [Bundesverfassungsgericht](https://www.bundesverfassungsgericht.de/) und https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht).");
  assert.deepEqual(m, [[{ t: "Siehe " }, { t: "Bundesverfassungsgericht", h: "https://www.bundesverfassungsgericht.de/" }, { t: " und " },
    { t: "https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht)", h: "https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht)" }, { t: "." }]]);
  assert.deepEqual(materialRuns("(Quelle: https://www.bpb.de/x), „https://a.de“; http://b.de/c?d=1!"), [[{ t: "(Quelle: " }, { t: "https://www.bpb.de/x", h: "https://www.bpb.de/x" },
    { t: "), „" }, { t: "https://a.de", h: "https://a.de/" }, { t: "“; " }, { t: "http://b.de/c?d=1", h: "http://b.de/c?d=1" }, { t: "!" }]]);
  // Umlaute: sichtbar wie geschrieben, als Adresse normalisiert (wie cleanHref im Feibeitsblatt)
  assert.deepEqual(materialRuns("https://de.wikipedia.org/wiki/Bürger"), [[{ t: "https://de.wikipedia.org/wiki/Bürger", h: "https://de.wikipedia.org/wiki/B%C3%BCrger" }]]);
  // Titel im Markdown-Link fällt weg; mehrere Absätze, fett bleibt
  assert.deepEqual(materialRuns("**Quelle:** [bpb](https://www.bpb.de/ \"Bundeszentrale\")\n\nZweiter"), [[{ t: "Quelle:", f: "b" }, { t: " " }, { t: "bpb", h: "https://www.bpb.de/" }], [], [{ t: "Zweiter" }]]);
});

test("Material: fett und Link kombiniert; unsichere oder unvollständige Links bleiben Text", () => {
  assert.deepEqual(materialRuns("**fett https://b.de/y** und **[Text](https://c.de)** [**F**ett](https://d.de)"), [[{ t: "fett ", f: "b" }, { t: "https://b.de/y", f: "b", h: "https://b.de/y" },
    { t: " und " }, { t: "Text", f: "b", h: "https://c.de/" }, { t: " " }, { t: "F", f: "b", h: "https://d.de/" }, { t: "ett", h: "https://d.de/" }]]);
  for (const bad of ["[böse](javascript:alert(1))", "javascript:alert(1)", "[x](data:text/html,hi)", "ftp://x.de/datei", "[leer]()", "https://", "mailto:a@b.de", "[rel](/pfad)"]) {
    const m = materialRuns("A " + bad + " B");
    assert.equal(linksIn(m).length, 0, bad);
    assert.equal(materialText(m), "A " + bad + " B", "bleibt unverändert Text: " + bad);
  }
  assert.equal(linksIn(materialRuns("https://x.de/" + "a".repeat(FB_LIMITS.href))).length, 0, "zu lange Adresse (nach der Normalisierung) bleibt Text");
  assert.equal(fbHref("https://de.wikipedia.org/wiki/" + "ä".repeat(300)), "", "die Länge zählt nach der Prozent-Kodierung");
});

test("Material: Grenzen des Feibeitsblatts – über 60 Links bleiben weitere Text, höchstens 600 Abschnitte, 8000 Zeichen; das Feibeitsblatt nimmt alles an", () => {
  const bare = materialRuns(Array.from({ length: 70 }, (_, i) => "https://x.de/" + i).join(" "));
  assert.equal(linksIn(bare).length, 60);
  assert.ok(materialText(bare).endsWith("https://x.de/69"), "die übrigen Adressen bleiben als Text stehen");
  const md = materialRuns(Array.from({ length: 65 }, (_, i) => "[L" + i + "](https://x.de/" + i + ")").join(" "));
  assert.equal(linksIn(md).length, 60);
  assert.ok(materialText(md).endsWith("L63 (https://x.de/63) L64 (https://x.de/64)"), "über der Grenze: Linktext mit der Adresse in Klammern");
  const busy = materialRuns(Array.from({ length: 200 }, (_, i) => "**a** b **c** [d](https://e.de/" + i + ") f " + i).join("\n"));
  assert.equal(busy.length, 200);
  assert.ok(busy.reduce((n, p) => n + p.length, 0) <= FB_LIMITS.runs, "höchstens 600 Abschnitte");
  assert.ok(busy.every((p) => p.length >= 1) && busy[199].length === 1 && !busy[199][0].h, "ein zu kleinteiliger Absatz wird ein einziger Textlauf");
  const long = materialRuns(("Lang " + "x".repeat(90) + " ").repeat(120) + "\nhttps://spaet.de");
  assert.ok(materialText(long).length <= 8000);
  // Zufallstexte aus Bausteinen: jedes Ergebnis besteht die Prüfung des Feibeitsblatts unverändert
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const parts = ["**", "[", "]", "(", ")", "https://", "http://", "x.de", "/", "a", " ", "\n", ".", ",", "“", "Wort", "**fett**", "[t](https://u.de/(a))", "\t", "\u00a0"];
  for (let k = 0; k < 300; k++) {
    const text = Array.from({ length: 5 + Math.floor(rnd() * 300) }, () => parts[Math.floor(rnd() * parts.length)]).join("");
    const m = materialRuns(text);
    assert.doesNotThrow(() => validateMaterial(m), text.slice(0, 80));
    const fmt = taskTextFmt(text);
    if (fmt) { assert.doesNotThrow(() => validateMaterial(fmt, LIMITS.taskText)); assert.ok(materialText(fmt).length <= LIMITS.taskText); }
    if (text.trim() && text.trim().length <= LIMITS.taskText) assert.doesNotThrow(() => validateTask({ text: text.trim(), ...(fmt ? { textFmt: fmt } : {}) }), text.slice(0, 80));
  }
  for (const m of [bare, md, busy, long]) assert.doesNotThrow(() => validateMaterial(m));
});

test("Aufgabenstellung: textFmt nur mit Link oder fett und nur, wenn sie samt Zeilenumbrüchen in 4000 Zeichen passt", () => {
  const fmt = taskTextFmt("Lies [den Text](https://www.bpb.de/) und https://x.de.\n\nSchreibe dann.");
  assert.deepEqual(fmt, [[{ t: "Lies " }, { t: "den Text", h: "https://www.bpb.de/" }, { t: " und " }, { t: "https://x.de", h: "https://x.de/" }, { t: "." }], [], [{ t: "Schreibe dann." }]]);
  assert.equal(materialText(validateMaterial(fmt, LIMITS.taskText)), "Lies den Text und https://x.de.\n\nSchreibe dann.", "das Feibeitsblatt leitet den reinen Text ohne Link-Adressen ab");
  assert.equal(taskTextFmt("Erkläre die Gewaltenteilung."), null, "ohne Link und fett bleibt es beim reinen Text");
  assert.deepEqual(taskTextFmt("Erkläre **zwei** Aufgaben."), [[{ t: "Erkläre " }, { t: "zwei", f: "b" }, { t: " Aufgaben." }]]);
  assert.equal(taskTextFmt("https://x.de\n" + "a\n".repeat(1999) + "b"), null, "mit den Zeilenumbrüchen über 4000 Zeichen: reiner Text");
  assert.deepEqual(fbLinksOf(materialRuns("[**a** b](https://x.de) https://y.de")), [{ t: "a b", h: "https://x.de/" }, { t: "https://y.de", h: "https://y.de/" }], "Vorschau: ein Eintrag je Link");
});

test("createSheet: Material mit Link-Läufen, Aufgabenstellung mit Link als textFmt (der Text bleibt daneben), ohne Link nichts Neues", async () => {
  const sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, code: "ABC234", title: "T" })); };
  try {
    const fb = new FbClient("https://fb.test"); fb.authKey = "x";
    await fb.createSheet({ title: "Gewaltenteilung", tasks: [
      { text: "Lies den Artikel [Gewaltenteilung](https://de.wikipedia.org/wiki/Gewaltenteilung) und fasse ihn zusammen.", material: "Mehr: https://www.bpb.de/themen/.", solution: "Achte darauf, ob …", answer: { type: "text" } },
      { text: "Erkläre die Gewaltenteilung.", material: "Das **Grundgesetz** regelt das.", solution: "", answer: { type: "text" } }] }, { klass: "8A" });
  } finally { globalThis.fetch = orig; }
  const [a, b] = sent[0].tasks;
  assert.equal(a.text, "Lies den Artikel [Gewaltenteilung](https://de.wikipedia.org/wiki/Gewaltenteilung) und fasse ihn zusammen.", "text bleibt (ältere Feibeitsblätter, die textFmt nicht kennen)");
  assert.deepEqual(a.textFmt, [[{ t: "Lies den Artikel " }, { t: "Gewaltenteilung", h: "https://de.wikipedia.org/wiki/Gewaltenteilung" }, { t: " und fasse ihn zusammen." }]]);
  assert.deepEqual(a.material, [[{ t: "Mehr: " }, { t: "https://www.bpb.de/themen/", h: "https://www.bpb.de/themen/" }, { t: "." }]]);
  assert.ok(!("textFmt" in b) && b.text === "Erkläre die Gewaltenteilung.", "ohne Link und fett: kein textFmt");
  assert.deepEqual(b.material, [[{ t: "Das " }, { t: "Grundgesetz", f: "b" }, { t: " regelt das." }]]);
  for (const t of sent[0].tasks) validateTask(t);
});

test("Prüfungsbefunde: Linktext mit eckigen Klammern, Titel in einfachen Anführungszeichen, <Adresse>, leerer Linktext", () => {
  assert.deepEqual(materialRuns("Lies [M1 [Karikatur]](https://x.de/m1) und [[M2] Text](https://x.de/m2)."), [[{ t: "Lies " }, { t: "M1 [Karikatur]", h: "https://x.de/m1" },
    { t: " und " }, { t: "[M2] Text", h: "https://x.de/m2" }, { t: "." }]], "Klammerpaare im Linktext: kein „[M1 [Karikatur]](“ mehr im Blatt");
  assert.deepEqual(materialRuns("[T](https://x.de 'Titel') [U](<https://y.de/a>) [](https://z.de)"), [[{ t: "T", h: "https://x.de/" }, { t: " " }, { t: "U", h: "https://y.de/a" },
    { t: " " }, { t: "https://z.de", h: "https://z.de/" }]]);
  assert.deepEqual(materialRuns("[a] und [b"), [[{ t: "[a] und [b" }]], "eckige Klammern ohne Link bleiben Text");
});

test("Prüfungsbefund: eine Aufgabenstellung nur aus **  ** wird nicht zu einem textFmt ohne Text (das Feibeitsblatt lehnte das Blatt ab)", async () => {
  for (const text of ["** **", "**  **\n**\t**", "**\u00a0**", "**\u0007**"]) {
    assert.equal(taskTextFmt(text), null, JSON.stringify(text));
    assert.doesNotThrow(() => validateTask({ text }), JSON.stringify(text));
  }
  assert.deepEqual(taskTextFmt("** ** Lies https://x.de"), [[{ t: " ", f: "b" }, { t: " Lies " }, { t: "https://x.de", h: "https://x.de/" }]], "mit Text daneben bleibt textFmt");
});

test("Prüfungsbefund: die Vorschau rechnet auch bei einer Adresse mit sehr vielen Klammern am Ende schnell (vorher quadratisch, über 2 s)", () => {
  const t0 = performance.now();
  materialRuns("https://x.de/a" + ")".repeat(20000));
  assert.ok(performance.now() - t0 < 400, "dauerte " + Math.round(performance.now() - t0) + " ms");
  assert.deepEqual(materialRuns("(https://x.de/a_(b)))."), [[{ t: "(" }, { t: "https://x.de/a_(b)", h: "https://x.de/a_(b)" }, { t: "))." }]], "Klammern am Ende wie vorher");
});

test("Notfall-Feibeitsblatt: Links aus Material und Aufgabenstellung stehen als Adresse mit Link-Annotation in der PDF", async () => {
  const task = { text: "Lies den Artikel.", textFmt: taskTextFmt("Lies den [Artikel](https://de.wikipedia.org/wiki/Gewaltenteilung)."), material: materialRuns("Mehr bei der [bpb](https://www.bpb.de/)."), answer: { type: "text" } };
  const pdf = Buffer.from(await makeAnalogPdf({ code: "K457A4", title: "Links", tasks: [task], shows: new Map(), aiNote: false, checkUrl: "" })).toString("latin1");
  assert.ok(pdf.includes("/URI (https://www.bpb.de/)") && pdf.includes("/URI (https://de.wikipedia.org/wiki/Gewaltenteilung)"), "beide Links als anklickbare Adresse");
});

test("Sitzungsdatei: Links eines Feibeitsblatts kommen als [Linktext](Adresse) in den Entwurf und werden beim Anlegen wieder dieselben Links", () => {
  const material = materialRuns("Siehe [bpb](https://www.bpb.de/) und **[Wikipedia](https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht))** sowie https://x.de/a.");
  const textFmt = taskTextFmt("Lies den [Artikel](https://www.bpb.de/artikel).");
  const { draft } = sheetToDraft({ title: "T", tasks: [{ text: "Lies den Artikel.", textFmt, material, solution: "", answer: { type: "text" } }] });
  assert.equal(draft.tasks[0].text, "Lies den [Artikel](https://www.bpb.de/artikel).", "die Aufgabenstellung kommt aus textFmt – mit Link");
  assert.deepEqual(materialRuns(draft.tasks[0].material), material);
  assert.deepEqual(taskTextFmt(draft.tasks[0].text), textFmt);
  // Linktext mit eckigen Klammerpaaren bleibt ein Markdown-Link; unpaarige Klammern: Adresse in Klammern dahinter (bleibt als nackte Adresse anklickbar)
  const odd = sheetToDraft({ title: "T", tasks: [{ text: "x", material: [[{ t: "[M1]", h: "https://m.de/1" }], [{ t: "M2 [", h: "https://m.de/2" }]], solution: "" }] }).draft;
  assert.equal(odd.tasks[0].material, "[[M1]](https://m.de/1)\nM2 [ (https://m.de/2)");
  assert.deepEqual(materialRuns(odd.tasks[0].material), [[{ t: "[M1]", h: "https://m.de/1" }], [{ t: "M2 [ (" }, { t: "https://m.de/2", h: "https://m.de/2" }, { t: ")" }]]);
});

test("Claude: Prompts und Werkzeugbeschreibungen nennen die Schreibweise der Links (ein Satz)", async () => {
  assert.ok(S.FEIBEITSBLATT_INFO.endsWith(" " + S.FB_LINK_RULE) && S.FB_LINK_RULE.includes("[Linktext](https://…)") && S.FB_LINK_RULE.includes("neuen Tab"));
  const [sys] = S.feibeitsblattMessages({ subject: "powi", klass: "8A", lesson: { title: "T" } }, "", "");
  assert.equal(sys.content.split(S.FB_LINK_RULE).length - 1, 1, "Entwurf aus dem Chat (Backup)");
  const ctx = { subject: "powi", klass: "8A", lesson: { title: "T", durationMin: 45 }, materials: [], sheets: [], messages: [] };
  assert.equal(S.planningSystemPrompt(ctx).split(S.FB_LINK_RULE).length - 1, 1, "Backup-Chat");
  assert.ok(!S.planningSystemPrompt({ ...ctx, klass: "6B" }).includes(S.FB_LINK_RULE), "Jg. 5/6: keine Feibeitsblätter");
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const tools = (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result.tools;
  const t = (n) => tools.find((x) => x.name === n);
  const pf = t("propose_feibeitsblatt"), task = pf.inputSchema.properties.aufgaben.items.properties;
  assert.ok(pf.description.includes(S.FB_LINK_RULE) && task.text.description.includes(S.FB_LINK_HINT) && task.material.description.includes(S.FB_LINK_HINT));
  const sub = t("save_substitute_plan").inputSchema.properties.feibeitsblatt.properties.aufgaben.items.properties;
  assert.ok(sub.text.description.includes(S.FB_LINK_HINT) && sub.material.description.includes(S.FB_LINK_HINT));
});

// Gegen den echten Validator des Feibeitsblatts – nur, wenn sein Quelltext daneben liegt (../feibeitsblatt oder FEIBEITSBLATT_DIR); nur gelesen
const { existsSync } = await import("node:fs");
const { pathToFileURL, fileURLToPath } = await import("node:url");
const REAL_LIB = process.env.FEIBEITSBLATT_DIR ? process.env.FEIBEITSBLATT_DIR.replace(/\/$/, "") + "/worker/lib.js" : fileURLToPath(new URL("../../../feibeitsblatt/worker/lib.js", import.meta.url));
test("echter Validator des Feibeitsblatts (falls vorhanden): realistische Entwürfe aus Claude, Vertretung und Sitzungsdatei werden angenommen, die Links bleiben", { skip: !existsSync(REAL_LIB) && "Quelltext des Feibeitsblatts nicht vorhanden" }, async () => {
  const real = await import(pathToFileURL(REAL_LIB).href);
  const drafts = [
    { titel: "Gewaltenteilung", aufgaben: [
      { text: "Lies den Artikel [Gewaltenteilung – bpb](https://www.bpb.de/kurz-knapp/lexika/politiklexikon/17567/gewaltenteilung/) und beantworte die Fragen.", material: "**M1:** Bundeszentrale, https://www.bpb.de/themen/politisches-system/.\n\n**M2:** [Gewaltenteilung](https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht)) (abgerufen am 13.11.2026).\n(Quelle: https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht))", ki_auftrag: "Achte darauf, ob …", antwort: "text" },
      { text: "**Wichtig:** Vergleiche [M1 [Karikatur]](https://x.de/m1) mit „https://www.tagesschau.de/“.", material: "[x](javascript:alert(1)) data:text/html,hi http://alt.example.org/seite.html", ki_auftrag: "", antwort: { tabelle: ["A", "B"], zeilen: 2 } },
      { text: "** **", material: Array.from({ length: 80 }, (_, i) => "[Link " + i + "](https://x.de/" + i + ")").join("\n"), antwort: "foto" }] },
  ];
  const bodyOf = async (draft) => {
    const sent = [], orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, code: "ABC234", title: "T" })); };
    try { const fb = new FbClient("https://fb.test"); fb.authKey = "x"; await fb.createSheet(draft, { klass: "8A" }); } finally { globalThis.fetch = orig; }
    return sent[0];
  };
  const linkRuns = (o) => o.tasks.map((t) => linksIn([...(t.textFmt || []), ...(t.material || [])]));
  for (const d of drafts) {
    const out = real.validateSheetInput(await bodyOf(S.normalizeFbDraft(d, { fromAi: true })));   // wirft bei jedem Verstoß
    const links = linkRuns(out).map((l) => l.map((r) => r.t));
    assert.deepEqual(links[0], ["Gewaltenteilung – bpb", "https://www.bpb.de/themen/politisches-system/", "Gewaltenteilung", "https://de.wikipedia.org/wiki/Gewaltenteilung_(Staatsrecht)"]);
    assert.deepEqual(links[1], ["M1 [Karikatur]", "https://www.tagesschau.de/", "http://alt.example.org/seite.html"]);
    assert.equal(links[2].length, 60, "über 60 Links: Text, nie ein abgelehntes Blatt");
    assert.equal(out.tasks[2].text, "** **");
    // Sitzungsdatei: dieselben Links nach der Rundreise
    const out2 = real.validateSheetInput(await bodyOf(sheetToDraft({ title: out.title, tasks: out.tasks }).draft));
    assert.deepEqual(linkRuns(out2).slice(0, 2), linkRuns(out).slice(0, 2));
  }
});
