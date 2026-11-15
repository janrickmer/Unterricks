// E2E: Nach einem Update (S24, 14.11.2026) – eine Seite führt nie Programmteile zweier Stände zusammen aus.
// Gemeldet: Ein Tab, der vor dem Deploy geöffnet war (Startseite: portalview.js geladen), zeigte beim Öffnen einer Grundschul-Sitzung „Die
// Lehrkräfteansicht konnte nicht geladen werden: The requested module './portalview.js' does not provide an export named 'keepFocusOn'“.
// Nachgestellt mit zwei Ständen A (public/) und B (public/ mit einer neuen Ausfuhr in portalview.js, die session.js und gssession.js einführen –
// wie keepFocusOn) auf einem Nachbau von GitHub Pages (jede Datei 10 Minuten zwischenspeicherbar, Abfragen ignoriert, Server = Worker per CORS):
//   0. Gegenprobe im alten, flachen Aufbau: derselbe Fehler wie gemeldet.
//   1. Neuer Aufbau (/v/<Stand>/): Der Tab bemerkt beim Seitenwechsel den neuen Stand und lädt an derselben Adresse neu, bevor er Module des alten
//      Stands nachlädt (keine Anfrage an /v/A/…); kurz nach dem Deploy (Prüfung noch frisch) scheitert das Nachladen sauber (404) und die Seite lädt
//      einmal von selbst neu – nie gemischt.
//   2. Veraltetes index.html (Zwischenspeicher von Pages, auch das von vor der Umstellung) schadet nicht.
//   3. Schutz vor einer Schleife: höchstens einmal je Stand von selbst neu laden (sessionStorage), danach ein ruhiger Hinweis mit „Neu laden“;
//      lässt sich gar nichts laden, erklärt die Startdatei ruhig.
//   4./5. Nie von selbst neu laden mit offenem Dialog oder laufender Präsentation (Lehrkraft) bzw. Live-Präsentation (Schüler:in); ein Programmteil,
//      der dann fehlt, zeigt den Dialog „Unterricks wurde aktualisiert“ (Sie bzw. du) statt der technischen Meldung.
//   6. Dasselbe am Worker (eigener wrangler dev auf UPDATE_PORT, Neustart mit Stand B wie ein Deploy): Kopfzeilen und Neuladen.
// Mit shots (UPDATE_SHOTS=1) Bildschirmfotos des Dialogs und der Hinweisseite: Laptop und iPad hochkant (Lehrkraft), iPad (Schüler:in), hell und dunkel.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { buildSite, VENDOR, BUILD_RE } from "../../scripts/build.mjs";
import { PDFDocument } from "pdf-lib";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edit = (f, fn) => writeFileSync(f, fn(readFileSync(f, "utf8")));
export const UPDATE_PORT = 8795;   // eigener Worker für Teil 6

/* Nachbau von GitHub Pages: Datei aus root (Abfrage ignoriert), Cache-Control: max-age=600 wie dort; index/version ersetzen einzelne Antworten */
function pagesServer(port) {
  const st = { root: null, index: null, version: null, log: [] };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x"), path = decodeURIComponent(u.pathname);
    st.log.push(path);
    const send = (status, type, body) => { res.writeHead(status, { "content-type": type, "cache-control": "max-age=600" }); res.end(body); };
    if ((path === "/" || path === "/index.html") && st.index) return send(200, TYPES[".html"], st.index);
    if (path === "/version.json" && st.version) return send(200, TYPES[".json"], JSON.stringify({ build: st.version }));
    const f = join(st.root, path.endsWith("/") ? path + "index.html" : path);
    if (!f.startsWith(st.root) || !existsSync(f) || statSync(f).isDirectory()) return send(404, TYPES[".html"], "<!doctype html><title>404</title><h1>404</h1>");
    send(200, TYPES[extname(f)] || "application/octet-stream", readFileSync(f));
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({ st, serve: (o) => Object.assign(st, { index: null, version: null }, o), close: () => new Promise((r) => srv.close(r)) })));
}
/* alter Aufbau (vor S24): public/ und vendor/ flach kopiert, Server-Adresse als <meta> */
function flatBuild(src, out, api, nm) {
  rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, "vendor"), { recursive: true });
  cpSync(src, out, { recursive: true });
  for (const [from, to] of VENDOR) copyFileSync(join(nm, from), join(out, "vendor", to));
  edit(join(out, "index.html"), (s) => s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="unterricks-api" content="' + api + '">'));
}
const loadCounter = (p) => { const c = { n: 0 }; p.on("load", () => c.n++); return c; };
const metaBuild = (p) => p.evaluate(() => (document.querySelector('meta[name="unterricks-build"]') || {}).content || null);
// geladene Dateien aus /v/… (nur erfolgreiche Antworten: ein veraltetes index.html lädt z. B. noch vergeblich /v/<alt>/app.js vor)
const vMods = (p) => p.evaluate(() => performance.getEntriesByType("resource").filter((x) => !x.responseStatus || x.responseStatus === 200).map((x) => new URL(x.name).pathname).filter((x) => x.startsWith("/v/")));
const idsOf = (paths) => [...new Set(paths.map((x) => x.split("/")[2]))];
// „Prüfung fällig“ ohne 15 Sekunden zu warten: dieselbe Instanz von update.js wie die der Seite (aus dem Speicher, keine Anfrage)
const makeDue = (p) => p.evaluate(async () => { const U = await import("/v/" + document.querySelector('meta[name="unterricks-build"]').content + "/update.js"); U.versionState.at = 0; });
const outdated = (p) => p.evaluate(async () => (await import("/v/" + document.querySelector('meta[name="unterricks-build"]').content + "/update.js")).isOutdated());
const seed = (p, store) => p.evaluate((s) => { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, store);
const mark = (p) => p.evaluate(() => { window.__s24tab = 1; });
const marked = (p) => p.evaluate(() => window.__s24tab === 1);

export async function updateE2E({ browser, devices, ROOT, BASE, FB, PAGES, PAGES_PORT, tStore, studentCode, lessonId, gsLessonId, escLessonId = null, escCode = null, ok, watch, shots }) {
  const tmp = mkdtempSync(join(process.env.E2E_TMP || tmpdir(), "unterricks-update-"));
  const nm = join(ROOT, "node_modules");
  const srcA = join(tmp, "srcA"), srcB = join(tmp, "srcB");
  cpSync(join(ROOT, "public"), srcA, { recursive: true }); cpSync(join(ROOT, "public"), srcB, { recursive: true });
  edit(join(srcB, "portalview.js"), (s) => s + '\nexport const e2eNeu = "B";   // E2E (S24): neue Ausfuhr wie keepFocusOn am 14.11.2026\n');
  for (const f of ["session.js", "gssession.js"]) edit(join(srcB, f), (s) => { const t = s.replace('} from "./portalview.js";', ', e2eNeu } from "./portalview.js";\nvoid e2eNeu;'); if (t === s) throw new Error("Import aus portalview.js in " + f + " nicht gefunden"); return t; });
  const A = await buildSite({ src: srcA, out: join(tmp, "A"), pagesApi: BASE, fbApi: FB });
  const B = await buildSite({ src: srcB, out: join(tmp, "B"), pagesApi: BASE, fbApi: FB });
  ok(BUILD_RE.test(A.id) && BUILD_RE.test(B.id) && A.id !== B.id && A.id === (await buildSite({ src: srcA, out: join(tmp, "A2") })).id,
    "zwei Stände gebaut: A " + A.id + " (wie public/), B " + B.id + " (neue Ausfuhr in portalview.js); Worker- und Pages-Build desselben Quelltexts: derselbe Stand");
  const S = await pagesServer(PAGES_PORT);
  const ctxs = [];
  const teacherPage = async (opt = {}) => {
    const c = await browser.newContext(opt.device ? { ...devices[opt.device], ...(opt.dark ? { colorScheme: "dark" } : {}) } : { viewport: { width: 1280, height: 860 }, ...(opt.dark ? { colorScheme: "dark" } : {}) });
    ctxs.push(c);
    const p = await c.newPage(); watch(p, "Update-" + (opt.who || "Lehrkraft"));
    await p.goto(PAGES + "/#/"); await p.locator("#spw").waitFor({ timeout: 20000 });
    await seed(p, tStore); await mark(p);
    return p;
  };
  try {
    /* ---------- 0. Gegenprobe: alter Aufbau ---------- */
    flatBuild(srcA, join(tmp, "flatA"), BASE, nm); flatBuild(srcB, join(tmp, "flatB"), BASE, nm);
    S.serve({ root: join(tmp, "flatA") });
    {
      const p = await teacherPage({ who: "Gegenprobe" });
      const had = await p.evaluate(() => performance.getEntriesByType("resource").some((x) => x.name.endsWith("/portalview.js")));
      S.serve({ root: join(tmp, "flatB") });
      await p.evaluate((h) => { location.hash = h; }, "#/lk/s/" + gsLessonId);
      const fail = p.locator("main.loadfail, main .err").first();
      await fail.waitFor({ timeout: 20000 });
      const t = await fail.textContent();
      ok(had && /does not provide an export named 'e2eNeu'/.test(t), "Gegenprobe (alter, flacher Aufbau): Startseite offen, dann Deploy, dann Grundschul-Sitzung → derselbe Fehler wie gemeldet („" + t.replace(/\s+/g, " ").slice(-90) + "“)");
      await p.context().close();
    }

    /* ---------- 1. Neuer Aufbau: Seitenwechsel nach dem Deploy ---------- */
    S.serve({ root: A.out });
    {
      const p = await teacherPage();
      const loads = loadCounter(p);
      const before = await vMods(p);
      ok(before.includes("/v/" + A.id + "/portalview.js") && idsOf(before).join() === A.id && await metaBuild(p) === A.id, "Startseite in Stand A: alle Programmteile aus /v/" + A.id + "/ (portalview.js geladen)");
      S.serve({ root: B.out }); const at = S.st.log.length;
      await makeDue(p);
      const target = "#/lk/s/" + gsLessonId;
      await p.evaluate((h) => { location.hash = h; }, target);
      await p.locator("#gsplan").waitFor({ timeout: 30000 });
      await sleep(800);
      const after = await vMods(p), fromA = S.st.log.slice(at).filter((x) => x.startsWith("/v/" + A.id + "/"));
      const memo = await p.evaluate(() => JSON.parse(sessionStorage.getItem("u.reload") || "null"));
      ok(loads.n === 1 && !(await marked(p)) && new URL(p.url()).hash === target && await metaBuild(p) === B.id && idsOf(after).join() === B.id
        && after.includes("/v/" + B.id + "/gssession.js") && fromA.length === 0 && memo && memo.to === B.id && await p.locator("main.loadfail").count() === 0,
        "nach dem Deploy (Stand B) beim Öffnen der Grundschul-Sitzung: einmal an derselben Adresse neu geladen, Seite vollständig aus B – keine Anfrage an A, kein Ladefehler"
        + (fromA.length ? " (A: " + fromA.join(", ") + ")" : ""));
      await p.context().close();
    }
    {
      // Deploy kurz nach einer Prüfung (noch frisch, sie meldete A): das Nachladen aus A scheitert sauber (404), die Seite lädt einmal von selbst
      // neu – nie gemischt. Die Prüfung im Hintergrund kurz nach dem Start bekommt noch „A“ (wie ein CDN, das den Deploy gerade erst übernimmt).
      S.serve({ root: A.out });
      const p = await teacherPage();
      const loads = loadCounter(p);
      S.serve({ root: B.out, version: A.id });
      await sleep(3600);   // Prüfung kurz nach dem Start (START_CHECK_MS) ist gelaufen und meldete A
      S.serve({ root: B.out }); const at = S.st.log.length;
      const target = "#/lk/s/" + gsLessonId;
      await p.evaluate((h) => { location.hash = h; }, target);
      await p.locator("#gsplan").waitFor({ timeout: 30000 });
      await sleep(800);
      const tried = S.st.log.slice(at).filter((x) => x.startsWith("/v/" + A.id + "/"));
      ok(loads.n === 1 && new URL(p.url()).hash === target && await metaBuild(p) === B.id && idsOf(await vMods(p)).join() === B.id && tried.length > 0,
        "Deploy direkt nach einer Prüfung: das Nachladen aus A scheitert (" + tried.join(", ") + " → 404), die Seite lädt einmal von selbst neu – danach vollständig B");
      await p.context().close();
    }

    /* ---------- 2. veraltetes index.html ---------- */
    {
      // index.html und Stand A aus dem Zwischenspeicher des Browsers (Pages: 10 Minuten): der Tab läuft in sich stimmig mit A und wechselt beim
      // nächsten Seitenwechsel auf B
      const c = await browser.newContext({ viewport: { width: 1280, height: 860 } }); ctxs.push(c);
      const p = await c.newPage(); watch(p, "Update-Pages-Zwischenspeicher");
      S.serve({ root: A.out });
      await p.goto(PAGES + "/#/"); await p.locator("#spw").waitFor();
      await p.evaluate(() => { location.hash = "#/lehrkraft"; }); await p.locator("#tu").waitFor({ timeout: 20000 });
      S.serve({ root: B.out }); const at = S.st.log.length;
      const p2 = await c.newPage(); watch(p2, "Update-Pages-Zwischenspeicher-2");
      const loads = loadCounter(p2);
      await p2.goto(PAGES + "/#/lehrkraft"); await p2.locator("#tu").waitFor({ timeout: 20000 });
      const cached = !S.st.log.slice(at).includes("/"), first = idsOf(await vMods(p2));
      await makeDue(p2);
      await p2.evaluate(() => { location.hash = "#/"; }); await p2.locator("#spw").waitFor({ timeout: 20000 }); await sleep(800);
      const after = await vMods(p2), m = await metaBuild(p2);
      if (!(first.length === 1 && m === B.id)) console.log("    Zwischenspeicher:", cached, first.join(), m, idsOf(after).join());
      ok(first.length === 1 && m === B.id && after.includes("/v/" + B.id + "/app.js") && new URL(p2.url()).hash === "#/" && loads.n === (first[0] === B.id ? 1 : 2),
        "neuer Tab nach dem Deploy, index.html " + (cached ? "aus dem Zwischenspeicher des Browsers (Stand " + (first[0] === A.id ? "A" : "B") + ")" : "neu geladen")
        + ": läuft in sich stimmig mit einem Stand und ist nach dem nächsten Seitenwechsel auf B");
      await c.close();
    }
    for (const [label, html] of [["index.html von Stand A", readFileSync(join(A.out, "index.html"), "utf8")],
      ["index.html von vor der Umstellung (lädt /app.js und /styles.css)", readFileSync(join(tmp, "flatA", "index.html"), "utf8")]]) {
      S.serve({ root: B.out, index: html });
      const c = await browser.newContext({ viewport: { width: 1280, height: 860 } }); ctxs.push(c);
      const p = await c.newPage(); watch(p, "Update-altes-index");
      const loads = loadCounter(p);
      await p.goto(PAGES + "/#/lehrkraft"); await p.locator("#tu").waitFor({ timeout: 20000 });
      await sleep(500);
      const css = await p.evaluate(() => ({ sheets: [...document.styleSheets].map((s) => s.href && new URL(s.href).pathname).filter(Boolean), font: getComputedStyle(document.body).fontFamily }));
      const got = await vMods(p);
      if (!(loads.n === 1 && await metaBuild(p) === B.id && idsOf(got).join() === B.id && css.sheets.includes("/v/" + B.id + "/styles.css") && /Atkinson/.test(css.font))) console.log("    ", label, loads.n, await metaBuild(p), idsOf(got).join(), JSON.stringify(css));
      ok(loads.n === 1 && await metaBuild(p) === B.id && idsOf(got).join() === B.id && got.includes("/v/" + B.id + "/teacher.js") && css.sheets.includes("/v/" + B.id + "/styles.css") && /Atkinson/.test(css.font),
        "veraltetes " + label + " (GitHub Pages hält es bis zu 10 Minuten), Stand nicht mehr da: die Startdatei lädt Stand B samt Stylesheet");
      await c.close();
    }

    /* ---------- 3. Schutz vor einer Schleife ---------- */
    {
      // der Server meldet einen Stand, den es nicht gibt (z. B. ein halber Deploy): genau einmal von selbst neu laden, danach nicht wieder
      S.serve({ root: A.out });
      const p = await teacherPage({ who: "Schleife" });
      const loads = loadCounter(p);
      S.serve({ root: A.out, version: "000000000000" });
      await makeDue(p);
      await p.evaluate(() => { location.hash = "#/lk"; });
      await p.locator(".tiles .tile").first().waitFor({ timeout: 30000 });
      await sleep(4500);   // Prüfung kurz nach dem Start (meldet wieder den Stand ohne Dateien)
      ok(loads.n === 1 && await metaBuild(p) === A.id && await outdated(p) && (await p.evaluate(() => JSON.parse(sessionStorage.getItem("u.reload")).to)) === "000000000000",
        "Stand ohne Dateien gemeldet: genau einmal neu geladen (Merker), die Seite läuft mit dem vorhandenen Stand A weiter");
      await p.evaluate(() => { location.hash = "#/lk/grundschule"; });
      await p.locator("main h1").first().waitFor({ timeout: 30000 }); await sleep(2500);
      ok(loads.n === 1 && !/konnte nicht geladen|aktualisiert/.test(await p.locator("main").innerText()), "nächster Seitenwechsel: kein zweites automatisches Neuladen (Merker), die Seite arbeitet weiter – keine Schleife");
      await p.context().close();
    }
    {
      // nichts lässt sich laden (index.html verweist auf einen Stand ohne Dateien, version.json ebenso): die Startdatei erklärt ruhig
      S.serve({ root: A.out, version: "000000000000", index: readFileSync(join(A.out, "index.html"), "utf8").replaceAll(A.id, "000000000000") });
      const c = await browser.newContext({ viewport: { width: 1280, height: 860 } }); ctxs.push(c);
      const p = await c.newPage(); watch(p, "Update-Startdatei");
      const loads = loadCounter(p);
      await p.goto(PAGES + "/#/lehrkraft");
      const fail = p.locator("main.loadfail");
      await fail.waitFor({ timeout: 20000 }); await sleep(3000);
      const t1 = await fail.textContent();
      ok(loads.n === 1 && /^Unterricks konnte nicht geladen werden/.test(t1) && t1.includes("Prüfen Sie die Verbindung und laden Sie die Seite neu") && /Technische Angabe: /.test(t1)
        && await fail.getByRole("button", { name: "Neu laden" }).count() === 1, "nichts lässt sich laden: ruhiger Hinweis der Startdatei mit „Neu laden“ (Sie) und technischer Angabe – kein automatisches Neuladen");
      if (shots) { mkdirSync(shots, { recursive: true }); await p.screenshot({ path: join(shots, "startdatei-laptop-hell.png") }); }
      await fail.getByRole("button", { name: "Neu laden" }).click();
      await p.locator("main.loadfail").waitFor({ timeout: 20000 }); await sleep(3000);
      ok(loads.n === 2, "„Neu laden“ lädt einmal (von Hand) – wieder kein automatisches Neuladen");
      S.serve({ root: A.out });
      await p.locator("main.loadfail").getByRole("button", { name: "Neu laden" }).click();
      await p.locator("#tu").waitFor({ timeout: 20000 });
      ok(await metaBuild(p) === A.id, "ist der Stand wieder da, lädt „Neu laden“ die Seite normal");
      await c.close();
    }
    {
      // derselbe Schutz in der Seite: Merker schon für B gesetzt → nach einem Ladefehler kein zweites automatisches Neuladen, der Hinweis bleibt
      S.serve({ root: A.out });
      const p = await teacherPage({ who: "Merker" });
      const loads = loadCounter(p);
      await p.evaluate((b) => sessionStorage.setItem("u.reload", JSON.stringify({ to: b, at: Date.now() })), B.id);
      S.serve({ root: B.out, version: A.id }); await sleep(3600);   // Prüfung kurz nach dem Start meldet noch A
      S.serve({ root: B.out });
      await p.evaluate((h) => { location.hash = h; }, "#/lk/s/" + gsLessonId);   // Prüfung noch frisch: das Nachladen aus A scheitert
      const f2 = p.locator("main.loadfail");
      await f2.waitFor({ timeout: 20000 }); await sleep(2500);
      const t2 = await f2.textContent();
      ok(loads.n === 0 && /^Unterricks wurde aktualisiert/.test(t2) && t2.includes("Seit Sie diese Seite geöffnet haben, gibt es eine neue Version von Unterricks.")
        && await f2.getByRole("button", { name: "Jetzt neu laden" }).count() === 1 && !/Technische Angabe/.test(t2),
        "Ladefehler mit schon genutztem Merker: kein zweites automatisches Neuladen – Hinweis „Unterricks wurde aktualisiert“ mit „Jetzt neu laden“");
      if (shots) {
        mkdirSync(shots, { recursive: true }); await p.screenshot({ path: join(shots, "hinweisseite-laptop-hell.png") });
        await p.emulateMedia({ colorScheme: "dark" }); await sleep(300); await p.screenshot({ path: join(shots, "hinweisseite-laptop-dunkel.png") }); await p.emulateMedia({ colorScheme: "light" });
      }
      await f2.getByRole("button", { name: "Jetzt neu laden" }).click();
      await p.locator("#gsplan").waitFor({ timeout: 30000 });
      ok(loads.n === 1 && await metaBuild(p) === B.id, "„Jetzt neu laden“: dieselbe Grundschul-Sitzung in Stand B");
      await p.context().close();
    }

    /* ---------- 4. Lehrkraft: Programmteil fehlt (Dialog), offener Dialog beim Seitenwechsel ---------- */
    const featureDialog = async (p, label) => {
      await p.locator(".sessionio").getByRole("button", { name: "Sitzung als Datei herunterladen" }).click();
      const d = p.locator(".modal", { hasText: "Unterricks wurde aktualisiert" });
      await d.waitFor({ timeout: 20000 });
      return d;
    };
    {
      S.serve({ root: A.out });
      const p = await teacherPage();
      const loads = loadCounter(p);
      await p.evaluate((h) => { location.hash = h; }, "#/lk/s/" + lessonId); await p.locator(".code-big").waitFor({ timeout: 20000 });
      S.serve({ root: B.out });
      const d = await featureDialog(p);
      await sleep(300);
      const t = await d.textContent(), focus = await p.evaluate(() => document.activeElement && document.activeElement.textContent);
      ok(loads.n === 0 && await marked(p) && t.includes("Seit Sie diese Seite geöffnet haben, gibt es eine neue Version von Unterricks. Laden Sie die Seite bitte neu – Sie kommen danach an dieselbe Stelle zurück.")
        && await d.getByRole("button", { name: "Abbrechen" }).count() === 1 && await d.getByRole("button", { name: "Jetzt neu laden" }).count() === 1 && /Jetzt neu laden/.test(focus)
        && !/sessionio|Failed to fetch|dynamically imported/i.test(await p.locator("body").innerText()),
        "Lehrkraft, „Sitzung als Datei herunterladen“ nach dem Deploy (Programmteil aus A fehlt): Dialog „Unterricks wurde aktualisiert“ (Sie) mit „Abbrechen“ und „Jetzt neu laden“, kein automatisches Neuladen, keine technische Meldung");
      if (shots) await p.screenshot({ path: join(shots, "dialog-lehrkraft-laptop-hell.png") });
      if (shots) { await p.emulateMedia({ colorScheme: "dark" }); await sleep(300); await p.screenshot({ path: join(shots, "dialog-lehrkraft-laptop-dunkel.png") }); await p.emulateMedia({ colorScheme: "light" }); }
      await d.getByRole("button", { name: "Abbrechen" }).click();
      await d.waitFor({ state: "detached" });
      const back = await p.evaluate(() => document.activeElement && document.activeElement.textContent);
      ok(loads.n === 0 && /Sitzung als Datei herunterladen/.test(back || ""), "„Abbrechen“: Dialog zu, Fokus zurück auf den Knopf, die Seite bleibt (Stand A)");
      // offener Dialog beim Seitenwechsel (z. B. Zurück-Geste): nicht neu laden
      await p.locator(".zones > .stack").nth(0).getByRole("button", { name: "Link hinzufügen" }).click();
      const lm = p.locator(".modal", { hasText: "Link hinzufügen" }); await lm.waitFor();
      await makeDue(p);
      await p.evaluate(() => { location.hash = "#/lk"; });
      await sleep(2500);
      ok(loads.n === 0 && await marked(p) && await lm.isVisible() && await outdated(p), "Seitenwechsel mit offenem Dialog „Link hinzufügen“: kein Neuladen (der neue Stand ist bekannt, der Dialog bleibt)");
      await p.keyboard.press("Escape"); await lm.waitFor({ state: "detached" });
      await p.evaluate((h) => { location.hash = h; }, "#/lk/s/" + lessonId);
      await p.locator(".code-big").waitFor({ timeout: 30000 }); await sleep(800);
      ok(loads.n === 1 && !(await marked(p)) && await metaBuild(p) === B.id && new URL(p.url()).hash === "#/lk/s/" + lessonId, "Dialog geschlossen, nächster Seitenwechsel: an derselben Adresse neu geladen (Stand B)");
      await p.context().close();
    }
    if (shots) for (const dark of [false, true]) {   // iPad hochkant (Lehrkraft)
      S.serve({ root: A.out });
      const p = await teacherPage({ device: "iPad (gen 7)", dark, who: "Lehrkraft-iPad" });
      await p.evaluate((h) => { location.hash = h; }, "#/lk/s/" + lessonId); await p.locator(".code-big").waitFor({ timeout: 20000 });
      S.serve({ root: B.out });
      await featureDialog(p); await sleep(400);
      await p.screenshot({ path: join(shots, "dialog-lehrkraft-ipad-" + (dark ? "dunkel" : "hell") + ".png") });
      await p.context().close();
    }

    /* ---------- 4b. Prüfung S24: „Jetzt neu laden“ von Hand sichert erst (am iPad fragt der Browser beim Neuladen nicht nach) ---------- */
    {
      // Lehrkraft: Zusammenfassung in Bearbeitung (ungespeichert) – der Knopf lädt nicht neu, sondern sagt es; gespeichert, dann neu laden
      S.serve({ root: A.out });
      const p = await teacherPage({ who: "Lehrkraft-ungespeichert" });
      const loads = loadCounter(p);
      const asked = []; p.on("dialog", (x) => { asked.push(x.type()); x.accept().catch(() => {}); });   // wie am iPad: Verlassen ohne Rückfrage
      await p.evaluate((h) => { location.hash = h; }, "#/lk/s/" + lessonId); await p.locator(".code-big").waitFor({ timeout: 20000 });
      await p.locator("#tsum-edit-btn").click();
      await p.fill("#tsum-ta", "S24-Prüfung: noch nicht gespeichert");
      S.serve({ root: B.out });
      let d = await featureDialog(p);
      await d.getByRole("button", { name: "Jetzt neu laden" }).click();
      await d.locator("[role=status]", { hasText: "noch nicht neu geladen" }).waitFor({ timeout: 15000 });
      const st = await d.locator("[role=status]").textContent(), focus = await p.evaluate(() => document.activeElement && document.activeElement.textContent);
      ok(loads.n === 0 && asked.length === 0 && await marked(p) && st === "Die Seite wurde noch nicht neu geladen: Es gibt ungespeicherte Änderungen, oder es wird gerade etwas gespeichert, hochgeladen oder gedruckt. Speichern Sie bitte zuerst bzw. warten Sie, bis es fertig ist – danach können Sie die Seite neu laden."
        && /Jetzt neu laden/.test(focus || ""),
        "„Jetzt neu laden“ mit ungespeicherter Zusammenfassung: kein Neuladen (am iPad ginge der Text sonst verloren), ruhiger Hinweis im Dialog, Fokus bleibt auf dem Knopf");
      await d.getByRole("button", { name: "Abbrechen" }).click(); await d.waitFor({ state: "detached" });
      await p.locator("#tsum").getByRole("button", { name: "Speichern", exact: true }).click();
      await p.locator("#tsum-text", { hasText: "S24-Prüfung: noch nicht gespeichert" }).waitFor({ timeout: 15000 });
      d = await featureDialog(p);
      await d.getByRole("button", { name: "Jetzt neu laden" }).click();
      await p.locator(".code-big").waitFor({ timeout: 30000 }); await sleep(800);
      await p.locator("#tsum-text", { hasText: "S24-Prüfung: noch nicht gespeichert" }).waitFor({ timeout: 15000 });
      ok(loads.n === 1 && !(await marked(p)) && await metaBuild(p) === B.id, "gespeichert, dann „Jetzt neu laden“: dieselbe Sitzung in Stand B, die Zusammenfassung ist da");
      // aufräumen: Zusammenfassung wieder leeren (spätere Schritte setzen sie selbst)
      await p.locator("#tsum-edit-btn").click(); await p.fill("#tsum-ta", "");
      await p.locator("#tsum").getByRole("button", { name: "Speichern", exact: true }).click();
      await p.locator("#tsum .tsum-empty").waitFor({ state: "visible", timeout: 15000 });
      await p.context().close();
    }
    if (escLessonId) {
      // Schüler:in im Escape-Room (Stand nur im Arbeitsspeicher): ein Programmteil fehlt (Überblick-PDF braucht pdf-lib) → „Jetzt neu laden“ legt den Stand
      // vorher ab wie vor der Abmeldung nach 90 Minuten – nach dem Neuladen geht es dort weiter
      S.serve({ root: A.out });
      const sc = await browser.newContext({ ...devices["iPad (gen 7)"] }); ctxs.push(sc);
      const sp = await sc.newPage(); watch(sp, "Update-Escape-Room");
      const sl = loadCounter(sp);
      const asked = []; sp.on("dialog", (x) => { asked.push(x.type()); x.accept().catch(() => {}); });   // wie am iPad: Verlassen ohne Rückfrage
      await sp.goto(PAGES + "/");
      await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
      await sp.waitForURL(/#\/schueler$/); await sp.locator(".tiles .tile").first().waitFor();
      await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await sp.getByRole("button", { name: "Q2 GK", exact: true }).click();
      await sp.getByRole("button", { name: "Speichern und weiter" }).click();
      await sp.fill("#code", escCode); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
      await sp.waitForURL(/#\/schueler\/s\//);
      await sp.evaluate((h) => { location.hash = h; }, "#/schueler/escape/" + escLessonId);
      await sp.locator(".er-title", { hasText: "Mission Gewaltenteilung" }).waitFor({ timeout: 20000 });
      await sp.fill("#er-fn", "Carla"); await sp.fill("#er-ln", "Probe"); await sp.fill("#er-bd", "05052009");
      await sp.getByRole("button", { name: "Weiter zum Auftrag" }).click();
      await sp.locator(".er-title", { hasText: "Willkommen" }).waitFor({ timeout: 15000 });
      const n0 = sl.n;
      S.serve({ root: B.out });
      // „Überblick als PDF herunterladen“ (pdf-lib, nachgeladen) – dieselbe Instanz von escape.js wie die der Seite
      await sp.evaluate(async () => { const m = await import("/v/" + document.querySelector('meta[name="unterricks-build"]').content + "/escape.js"); m.overviewPdf({}, {}, {}, {}).catch(() => {}); });
      const sd = sp.locator(".modal", { hasText: "Unterricks wurde aktualisiert" }); await sd.waitFor({ timeout: 20000 });
      ok((await sd.textContent()).includes("Seit du diese Seite geöffnet hast") && sl.n === n0, "Escape-Room nach dem Deploy: der Überblick braucht einen fehlenden Programmteil – Dialog in der du-Form, kein Neuladen von selbst");
      await sd.getByRole("button", { name: "Jetzt neu laden" }).click();
      const back = sp.locator(".modal", { hasText: "Weiter im Escape-Room?" });
      await back.waitFor({ timeout: 30000 });
      ok(sl.n === n0 + 1 && asked.length === 0 && (await back.textContent()).includes("Stand von Carla P."), "„Jetzt neu laden“: Stand vorher im Browser abgelegt (keine Rückfrage beim Verlassen nötig), nach dem Neuladen die bekannte Frage „Weiter im Escape-Room?“");
      await back.getByRole("button", { name: "Ja, weiter" }).click();
      await sp.locator(".er-title", { hasText: "Willkommen" }).waitFor({ timeout: 15000 });
      ok(await metaBuild(sp) === B.id && new URL(sp.url()).hash === "#/schueler/escape/" + escLessonId && !(await sp.evaluate((k) => localStorage.getItem(k), "u.esc." + escLessonId)),
        "Escape-Room: nach dem Neuladen in Stand B genau dort weiter (Sicherung danach gelöscht)");
      await sc.close();
    }

    /* ---------- 5. laufende Präsentation (Lehrkraft) und Live-Präsentation (Schüler:in) ---------- */
    {
      S.serve({ root: A.out });
      const tp = await teacherPage();
      const tl = loadCounter(tp);
      await tp.evaluate((h) => { location.hash = h; }, "#/lk/s/" + lessonId); await tp.locator(".code-big").waitFor({ timeout: 20000 });
      const sc = await browser.newContext({ ...devices["iPad (gen 7)"] }); ctxs.push(sc);
      const sp = await sc.newPage(); watch(sp, "Update-Schüler:in");
      const sl = loadCounter(sp);
      await sp.goto(PAGES + "/");
      await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
      await sp.waitForURL(/#\/schueler$/); await sp.locator(".tiles .tile").first().waitFor();
      await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await sp.getByRole("button", { name: "Q2 GK", exact: true }).click();
      await sp.getByRole("button", { name: "Speichern und weiter" }).click();
      await sp.fill("#code", studentCode); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
      await sp.waitForURL(/#\/schueler\/s\//); await sp.locator(".live").waitFor();
      await mark(sp);
      await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
      await tp.locator(".presenter").waitFor({ timeout: 20000 });
      await sp.locator(".live:not(.idle)").waitFor({ timeout: 20000 });
      const sl0 = sl.n, tl0 = tl.n;
      S.serve({ root: B.out });
      // Schüler:in: ein Programmteil fehlt (Text als PDF) – Dialog in der du-Form, die Live-Präsentation läuft weiter
      const item = sp.locator(".item", { hasText: "Von Claude: Arbeitsauftrag" });
      await item.getByRole("button", { name: "Als PDF herunterladen" }).click();
      const sd = sp.locator(".modal", { hasText: "Unterricks wurde aktualisiert" }); await sd.waitFor({ timeout: 20000 });
      await sleep(300);
      ok(sl.n === sl0 && (await sd.textContent()).includes("Seit du diese Seite geöffnet hast, gibt es eine neue Version von Unterricks. Lade die Seite bitte neu – du kommst danach an dieselbe Stelle zurück.")
        && await sd.getByRole("button", { name: "Jetzt neu laden" }).count() === 1 && await sp.locator(".live:not(.idle)").count() === 1,
        "Schüler:in während der Live-Präsentation, „Als PDF herunterladen“ (Programmteil aus A fehlt): Dialog in der du-Form, kein Neuladen, die Präsentation läuft weiter");
      if (shots) for (const dark of [false, true]) { await sp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(300); await sp.screenshot({ path: join(shots, "dialog-schueler-ipad-" + (dark ? "dunkel" : "hell") + ".png") }); }
      await sd.getByRole("button", { name: "Abbrechen" }).click(); await sd.waitFor({ state: "detached" });
      // Seitenwechsel während der Präsentation: weder Lehrkraft (Präsentationsmodus offen) noch Schüler:in (Live-Präsentation) laden neu
      await makeDue(tp); await makeDue(sp);
      await tp.evaluate(() => { location.hash = "#/lk"; });
      await sp.evaluate(() => { location.hash = "#/schueler"; });
      await sleep(3000);
      ok(tl.n === tl0 && await marked(tp) && await tp.locator(".presenter").isVisible() && await outdated(tp), "Lehrkraft: Seitenwechsel bei laufender Präsentation (Präsentationsmodus offen) – kein Neuladen");
      ok(sl.n === sl0 && await marked(sp) && await outdated(sp), "Schüler:in: Seitenwechsel bei laufender Live-Präsentation – kein Neuladen");
      await tp.locator(".presenter").getByRole("button", { name: "Präsentation für alle beenden" }).click();
      await tp.locator(".presenter").waitFor({ state: "detached", timeout: 15000 });
      await tp.evaluate((h) => { location.hash = h; }, "#/lk/s/" + lessonId);
      await tp.locator(".code-big").waitFor({ timeout: 30000 }); await sleep(800);
      ok(tl.n === tl0 + 1 && await metaBuild(tp) === B.id, "Präsentation beendet, nächster Seitenwechsel: Lehrkraft lädt neu (Stand B)");
      await sp.evaluate((h) => { location.hash = h; }, "#/schueler/s/" + lessonId);
      await sp.locator(".live").waitFor({ timeout: 30000 }); await sleep(800);
      ok(sl.n === sl0 + 1 && !(await marked(sp)) && await metaBuild(sp) === B.id && new URL(sp.url()).hash === "#/schueler/s/" + lessonId,
        "Schüler:in nach der Stunde (keine Live-Präsentation mehr), nächster Seitenwechsel: an derselben Adresse neu geladen (Stand B)");
      await sc.close(); await tp.context().close();
    }
  } finally {
    for (const c of ctxs) await c.close().catch(() => {});
    await S.close();
  }

  /* ---------- 6. Worker (wrangler dev mit eigenem Speicher, Neustart mit Stand B wie ein Deploy) ---------- */
  {
    const WA = await buildSite({ src: srcA, out: join(tmp, "WA"), fbApi: FB }), WB = await buildSite({ src: srcB, out: join(tmp, "WB"), fbApi: FB });
    const W = "http://localhost:" + UPDATE_PORT, persist = join(tmp, "wd");
    let wd = null, wlog = "";
    const startW = async (dir) => {
      for (let i = 0; i < 20; i++) { try { await fetch(W + "/api/health"); await sleep(500); } catch { break; } }
      wd = spawn("npx", ["wrangler", "dev", "--local", "--port", String(UPDATE_PORT), "--persist-to", persist, "--assets", dir, "--var", "SETTINGS_SECRET:e2e-update-1234567890"],
        { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
      wd.stdout.on("data", (d) => (wlog += d)); wd.stderr.on("data", (d) => (wlog += d));
      for (let i = 0; i < 60; i++) { try { if ((await fetch(W + "/api/health")).ok) return; } catch {} await sleep(500); }
      throw new Error("wrangler dev (Teil 6) startet nicht: " + wlog.slice(-500));
    };
    const stopW = async () => { if (!wd) return; const p = wd; wd = null; try { process.kill(-p.pid, "SIGTERM"); } catch {} for (let i = 0; i < 40; i++) { try { await fetch(W + "/api/health"); await sleep(250); } catch { return; } } };
    try {
      await startW(WA.out);
      const vr = await fetch(W + "/version.json?t=1"), ir = await fetch(W + "/");
      ok((await vr.json()).build === WA.id && vr.headers.get("cache-control") === "no-store" && ir.headers.get("cache-control") === "no-cache"
        && (await fetch(W + "/boot.js")).headers.get("cache-control") === "no-cache",
        "Worker: /version.json nie zwischengespeichert (no-store), index.html und boot.js immer neu geprüft (no-cache)");
      const c = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const p = await c.newPage(); watch(p, "Update-Worker");
      const loads = loadCounter(p);
      await p.goto(W + "/#/"); await p.locator("#spw").waitFor({ timeout: 20000 }); await mark(p);
      // Prüfung S24: pdf.js ist schon geladen (z. B. eine Präsentation umgewandelt) – nach dem Deploy fehlt der Worker des alten Stands
      const pd = await PDFDocument.create(); pd.addPage([200, 200]); pd.addPage([200, 200]);
      const pdfBytes = Array.from(await pd.save());
      const pages = () => p.evaluate(async (bytes) => {
        const m = await import("/v/" + document.querySelector('meta[name="unterricks-build"]').content + "/presenter.js");   // dieselbe Instanz wie die der Seite
        try { return { n: await m.pdfPageCount(new File([new Uint8Array(bytes)], "x.pdf", { type: "application/pdf" })) }; }
        catch (e) { return { moduleLoad: e && e.moduleLoad === true, message: String((e && e.message) || e) }; }
      }, pdfBytes);
      const before = await pages();
      await stopW(); await startW(WB.out);   // „Deploy“
      const after = await pages();
      const wd = p.locator(".modal", { hasText: "Unterricks wurde aktualisiert" }); await wd.waitFor({ timeout: 20000 });
      ok(before.n === 2 && after.moduleLoad && !/worker|fetch|module/i.test(after.message) && (await wd.textContent()).includes("Seit du diese Seite geöffnet hast") && loads.n === 1,
        "Worker: pdf.js schon geladen, nach dem Deploy fehlt sein Worker (alter Stand) – Hinweis „Unterricks wurde aktualisiert“ statt „Setting up fake worker failed …“ (" + after.message + ")");
      await wd.getByRole("button", { name: "Abbrechen" }).click(); await wd.waitFor({ state: "detached" });
      await makeDue(p);
      await p.evaluate(() => { location.hash = "#/lehrkraft"; });
      await p.locator("#tu").waitFor({ timeout: 30000 }); await sleep(800);
      ok(loads.n === 2 && !(await marked(p)) && await metaBuild(p) === WB.id && idsOf(await vMods(p)).join() === WB.id && new URL(p.url()).hash === "#/lehrkraft",
        "Worker: Tab von vor dem Deploy lädt beim Seitenwechsel an derselben Adresse neu und läuft danach vollständig mit Stand B");
      await c.close();
    } finally { await stopW(); }
  }
  rmSync(tmp, { recursive: true, force: true });
}
