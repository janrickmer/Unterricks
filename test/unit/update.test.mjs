// Nach einem Update (S24, 14.11.2026): Stände je Ordner /v/<Stand>/ (scripts/build.mjs), Startdatei public/boot.js, Prüfung und sicheres Neuladen
// in public/update.js. Gemeldet war: Ein vor dem Deploy geöffneter Tab lud die neue session.js zur alten portalview.js („does not provide an export
// named 'keepFocusOn'“). Geprüft: der Umbau der Modul-Verweise beim Build (jede Form, genau einmal, sonst nichts geändert, mehrfach anwenden ändert
// nichts), der gebaute Stand (alle Verweise zeigen auf vorhandene Dateien desselben Stands, Worker- und Pages-Build gleich), die Startdatei (Stand
// erfragen, veraltetes index.html, Schutz vor einer Schleife), die Prüfung beim Seitenwechsel und die Regeln für einen sicheren Moment.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const B = await import("../../scripts/build.mjs");
const BOOT = await import("../../public/boot.js");   // vor installDom: ohne window startet die Startdatei nicht von selbst
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk" });
// fake-dom lässt Zeitgeber der Seite den Prozess nicht am Leben halten (unref) – hier warten Startdatei und update.js aber auf eigene Zeitgeber
const keepAlive = setInterval(() => {}, 20);
after(() => clearInterval(keepAlive));
const UI = await import("../../public/ui.js");
let fresh = 0;
const loadUpdate = () => import("../../public/update.js?t=" + ++fresh);   // eigener Zustand je Ablauf (ui.js bleibt dieselbe Instanz)
const ID_A = "aaaaaaaaaaaa", ID_B = "bbbbbbbbbbbb";
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const jsonRes = (body, ok = true) => ({ ok, json: async () => (typeof body === "string" ? JSON.parse(body) : body) });
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text);
const clean = () => { for (const x of $$("body > *")) if (x.id !== "app" && x.id !== "toasts") x.remove(); document.getElementById("app").replaceChildren(); };

/* ---------- Build: Modul-Verweise ---------- */
const SAMPLE = [
  'import { a, b as c } from "./a.js";',
  "import {\n  x,\n  y,\n} from './multi.js';",
  'import * as ns from "/vendor/lib.js";',
  'import "./side.js";',
  "export { u } from './re.js';",
  'export * from "/vendor/all.js";',
  'const m = await import("./dyn.js");',
  'const v = () => import( "/vendor/pdf.min.mjs" );',
  '// import("/vendor/kommentar.js") und from "/vendor/kommentar2.js"',
  '/* import "/vendor/block.js"; */',
  'const s = "import(\\"/vendor/string.js\\")";',
  'const t = `from "/vendor/tmpl.js"`;',
  'const re = /import\\("\\/vendor\\/regex\\.js"\\)/;',
  'Array.from("abc"); x.from = 1; const meta = import.meta.url;',
  'const w = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;',
].join("\n");

test("Build: Modul-Verweise in jeder Form (statisch, mehrzeilig, Seiteneffekt, export … from, import()) – nie in Kommentaren, Zeichenketten, Vorlagen, regulären Ausdrücken", () => {
  const found = B.moduleSpecifiers(SAMPLE).map((s) => s.kind + ":" + s.spec);
  assert.deepEqual(found, ["from:./a.js", "from:./multi.js", "from:/vendor/lib.js", "side-effect:./side.js", "from:./re.js", "from:/vendor/all.js", "dynamic:./dyn.js", "dynamic:/vendor/pdf.min.mjs"]);
  for (const s of B.moduleSpecifiers(SAMPLE)) assert.equal(SAMPLE.slice(s.start, s.end), s.spec);
});

test("Build: absolute Verweise bekommen den Stand genau einmal, relative bleiben, sonst ändert sich nichts; mehrfach anwenden ändert nichts", () => {
  const out = B.versionSpecifiers(SAMPLE, ID_A);
  const specs = B.moduleSpecifiers(out).map((s) => s.spec);
  assert.deepEqual(specs.filter((s) => s.startsWith("/")), ["/v/" + ID_A + "/vendor/lib.js", "/v/" + ID_A + "/vendor/all.js", "/v/" + ID_A + "/vendor/pdf.min.mjs"]);
  assert.deepEqual(specs.filter((s) => !s.startsWith("/")), ["./a.js", "./multi.js", "./side.js", "./re.js", "./dyn.js"]);
  assert.equal(out.replaceAll("/v/" + ID_A + "/vendor/", "/vendor/"), SAMPLE, "nur die Verweise ändern sich");
  for (const keep of ['// import("/vendor/kommentar.js")', '/* import "/vendor/block.js"; */', '"import(\\"/vendor/string.js\\")"', '`from "/vendor/tmpl.js"`', '/import\\("\\/vendor\\/regex\\.js"\\)/'])
    assert.ok(out.includes(keep), "unverändert: " + keep);
  assert.equal(B.versionSpecifiers(out, ID_A), out, "idempotent");
  assert.equal(B.versionSpecifiers(out, ID_B), out, "ein schon umgeschriebener Verweis bekommt nie einen zweiten Stand");
  const other = 'import("//cdn.example.org/x.js"); import "https://example.org/y.js"; import(name);';
  assert.equal(B.versionSpecifiers(other, ID_A), other, "fremde Herkunft und import(variable) bleiben unberührt (die Prüfung des Builds meldet sie)");
  assert.throws(() => B.versionSpecifiers(SAMPLE, "nicht-gültig"));
});

test("Build: index.html lädt app.js und Stylesheet des Stands direkt, danach die Startdatei als Rückfall, Stand als <meta>; ohne die erwarteten Zeilen bricht der Build ab", () => {
  const src = readFileSync(join(ROOT, "public/index.html"), "utf8");
  assert.ok(src.includes('<script type="module" src="/app.js"></script>') && src.includes('<link rel="stylesheet" href="/styles.css">'), "public/index.html bleibt unversioniert (npm run dev, Unit-Tests)");
  const html = B.versionIndex(src, ID_A);
  assert.ok(html.includes('<meta name="unterricks-build" content="' + ID_A + '">') && html.includes('<link rel="stylesheet" href="/v/' + ID_A + '/styles.css">')
    && html.includes('<script type="module" src="/v/' + ID_A + '/app.js"></script>\n  <script type="module" src="/boot.js"></script>'), "app.js zuerst, die Startdatei danach (Reihenfolge der Module bleibt)");
  assert.ok(!html.includes('src="/app.js"') && !html.includes('href="/styles.css"'));
  assert.throws(() => B.versionIndex(src.replace('<script type="module" src="/app.js"></script>', ""), ID_A), /nicht gefunden/);
});

test("Build: Worker und GitHub Pages bekommen denselben Stand; jedes Modul liegt in /v/<Stand>/, jeder Verweis zeigt genau einmal in den Stand auf eine vorhandene Datei; ein zweiter Build ist gleich", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "unterricks-build-"));
  try {
    const w = await B.buildSite({ out: join(tmp, "w"), fbApi: "http://localhost:8788" });
    const p = await B.buildSite({ out: join(tmp, "p"), pagesApi: "https://unterricks.example.workers.dev", fbApi: "https://fb.example.org" });
    assert.match(w.id, B.BUILD_RE);
    assert.equal(w.id, p.id, "ein Commit = ein Stand (dist/ und dist-pages/)");
    const id = w.id, out = join(tmp, "w"), vdir = join(out, "v", id);
    const pub = readdirSync(join(ROOT, "public")).filter((f) => f.endsWith(".js"));
    const boot = readFileSync(join(ROOT, "public/boot.js"), "utf8");
    for (const f of pub) {
      const root = readFileSync(join(out, f), "utf8");
      if (f === "boot.js") { assert.ok(!existsSync(join(vdir, f)), "die Startdatei liegt nur unversioniert"); assert.equal(root, boot); continue; }
      const src = readFileSync(join(ROOT, "public", f), "utf8"), built = readFileSync(join(vdir, f), "utf8");
      assert.equal(built, B.versionSpecifiers(src, id), f);
      assert.equal(built.replaceAll("/v/" + id + "/", "/"), src, f + ": nur absolute Verweise geändert");
      for (const s of B.moduleSpecifiers(built)) {
        const url = s.spec.startsWith("/") ? s.spec : posix.normalize(posix.join("/v/" + id, s.spec));
        assert.ok(url.startsWith("/v/" + id + "/") && url.split("/v/").length === 2, f + ": " + s.spec + " → " + url);
        assert.ok(existsSync(join(out, url)), f + ": " + url + " fehlt");
      }
      // Wurzel: Platzhalter für Tabs von vor der Umstellung (app.js = Startdatei für ein altes index.html)
      assert.equal(root, f === "app.js" ? boot : B.STALE_STUB, f);
    }
    for (const v of ["pdf.min.mjs", "pdf.worker.min.mjs", "pdf-lib.esm.min.js"]) assert.ok(existsSync(join(vdir, "vendor", v)) && existsSync(join(out, "vendor", v)), v);
    assert.ok(existsSync(join(vdir, "styles.css")) && existsSync(join(out, "styles.css")) && existsSync(join(out, "fonts")));
    assert.deepEqual(JSON.parse(readFileSync(join(out, "version.json"), "utf8")), { build: id });
    const hd = readFileSync(join(out, "_headers"), "utf8");
    assert.match(hd, /\/version\.json\n\s+Cache-Control: no-store/); assert.match(hd, /\/boot\.js\n\s+Cache-Control: no-cache/); assert.match(hd, /\/app\.js\n\s+Cache-Control: no-cache/);
    assert.ok(hd.includes("http://localhost:8788") && !hd.includes("https://feibeitsblatt.feindt.workers.dev"), "Feibeitsblatt-Schnittstelle in der CSP wie bisher");
    // Pages: keine _headers, CSP und Server als <meta>, sonst dieselben Dateien
    const pi = readFileSync(join(tmp, "p/index.html"), "utf8");
    assert.ok(!existsSync(join(tmp, "p/_headers")) && pi.includes('<meta name="unterricks-api" content="https://unterricks.example.workers.dev">')
      && /<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'self';/.test(pi) && pi.includes('<meta name="unterricks-build" content="' + id + '">'));
    const files = (d) => { const o = []; const walk = (x) => { for (const e of readdirSync(x)) { const q = join(x, e); if (statSync(q).isDirectory()) walk(q); else o.push(relative(d, q)); } }; walk(d); return o.sort(); };
    assert.deepEqual(files(join(tmp, "p")), files(out).filter((f) => f !== "_headers"));
    for (const f of files(join(tmp, "p")).filter((x) => x !== "index.html")) assert.ok(readFileSync(join(tmp, "p", f)).equals(readFileSync(join(out, f))), f);
    // derselbe Quelltext noch einmal gebaut: dieselben Dateien
    const w2 = await B.buildSite({ out: join(tmp, "w2"), fbApi: "http://localhost:8788" });
    assert.equal(w2.id, id);
    assert.deepEqual(files(join(tmp, "w2")), files(out));
    for (const f of files(out)) assert.ok(readFileSync(join(tmp, "w2", f)).equals(readFileSync(join(out, f))), f);
    // die Prüfung des Builds findet fehlende Dateien, Verweise aus dem Stand heraus und import(variable)
    writeFileSync(join(vdir, "kaputt.js"), 'import("./gibtsnicht.js"); import("/anderswo/x.js"); import(name);\n');
    await assert.rejects(B.verifyVersioned(out, id), (e) => /kaputt\.js: \.\/gibtsnicht\.js .*\(fehlt\)/.test(e.message) && /\/anderswo\/x\.js .*nicht im Stand/.test(e.message) && /import\(\) ohne feste Adresse/.test(e.message));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("Quelltext: jedes Nachladen geht über lazy(); Module, die der Worker mitbündelt, laden update.js nicht", () => {
  const dir = join(ROOT, "public"), bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js") && x !== "boot.js")) {
    const s = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const m of s.matchAll(/\bimport\s*\(/g)) if (!/lazy\(\s*$/.test(s.slice(Math.max(0, m.index - 10), m.index))) bad.push(f + ": " + s.slice(m.index, m.index + 40));
  }
  assert.deepEqual(bad, []);
  const worker = new Set();
  for (const f of readdirSync(join(ROOT, "worker")).filter((x) => x.endsWith(".js"))) for (const m of readFileSync(join(ROOT, "worker", f), "utf8").matchAll(/from "\.\.\/public\/([a-z-]+\.js)"/g)) worker.add(m[1]);
  const seen = new Set(), todo = [...worker];
  while (todo.length) { const f = todo.pop(); if (seen.has(f)) continue; seen.add(f); for (const m of readFileSync(join(dir, f), "utf8").matchAll(/from "\.\/([a-z-]+\.js)"/g)) todo.push(m[1]); }
  assert.ok(seen.has("shared.js") && !seen.has("update.js") && !seen.has("ui.js"), "Worker-Bündel: " + [...seen].join(", "));
  const app = readFileSync(join(dir, "app.js"), "utf8");
  assert.ok(/const pre = navBlockers\(\);[^\n]*\n\s*render\(waitPage\(\)\);\n\s*beforeRoute\(pre\)/.test(app) && app.includes("installUpdateChecks();") && app.includes("holdReload("),
    "Router: erst feststellen, was gegen ein Neuladen spricht, dann die Seite verlassen, dann prüfen");
  assert.ok(readFileSync(join(dir, "beamer.js"), "utf8").includes("onLeave(holdReload("), "Beamerfenster meldet die laufende Präsentation an");
  assert.ok(readFileSync(join(dir, "update.js"), "utf8").includes('setAttribute("' + BOOT.STARTED_ATTR + '"'), "update.js meldet der Startdatei, dass die Oberfläche läuft");
  assert.ok(app.indexOf("installUpdateChecks();") < app.lastIndexOf("route();"), "vor dem ersten Seitenaufbau");
});

/* ---------- Startdatei ---------- */
test("Startdatei: Sie/du nach Adresse; Schutz vor einer Schleife (je Tab höchstens einmal je Stand, ohne Speicher nie); Stand erfragen ohne Zwischenspeicher", async () => {
  assert.equal(BOOT.audienceOf("#/lk/s/0123456789abcdef"), "sie"); assert.equal(BOOT.audienceOf("#/lehrkraft"), "sie"); assert.equal(BOOT.audienceOf("#/eltern/x"), "sie");
  assert.equal(BOOT.audienceOf("#/beamer"), "sie"); assert.equal(BOOT.audienceOf("#/"), "du"); assert.equal(BOOT.audienceOf("#/schueler/s/x"), "du"); assert.equal(BOOT.audienceOf(""), "du");
  assert.equal(BOOT.audienceOf("#/lkw"), "du");
  const st = memStore();
  assert.equal(BOOT.mayAutoReload(st, ID_B), true);
  assert.equal(BOOT.noteAutoReload(st, ID_B, 5), true);
  assert.equal(BOOT.mayAutoReload(st, ID_B), false, "derselbe Stand: kein zweites Mal");
  assert.equal(BOOT.mayAutoReload(st, ID_A), true, "ein anderer Stand: wieder einmal");
  st.setItem(BOOT.RELOAD_KEY, "kaputt"); assert.equal(BOOT.mayAutoReload(st, ID_B), true);
  assert.equal(BOOT.mayAutoReload(null, ID_B), false, "ohne Speicher nie automatisch");
  const throwing = { getItem() { throw new Error("gesperrt"); }, setItem() { throw new Error("gesperrt"); } };
  assert.equal(BOOT.mayAutoReload(throwing, ID_B), false); assert.equal(BOOT.noteAutoReload(throwing, ID_B, 1), false);
  assert.equal(BOOT.mayAutoReload(st, "nicht-gültig"), false);
  // /version.json: nie aus einem Zwischenspeicher (Browser: no-store, CDN: eigene Abfrage)
  const calls = [];
  assert.equal(await BOOT.fetchBuild(async (u, o) => { calls.push([u, o]); return jsonRes({ build: ID_A }); }, 123), ID_A);
  assert.equal(calls[0][0], "/version.json?t=123"); assert.equal(calls[0][1].cache, "no-store"); assert.equal(calls[0][1].credentials, "omit");
  assert.equal(await BOOT.fetchBuild(async () => jsonRes({ build: "x" }), 1), null);
  assert.equal(await BOOT.fetchBuild(async () => jsonRes({ build: ID_A }, false), 1), null);
  assert.equal(await BOOT.fetchBuild(async () => { throw new TypeError("offline"); }, 1), null);
  assert.equal(await BOOT.fetchBuild(async () => ({ ok: true, json: async () => { throw new SyntaxError("kein JSON"); } }), 1), null);
  assert.equal(await BOOT.fetchBuild((u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("abgebrochen")))), 1, 30), null, "Zeitüberschreitung");
});

function bootEnv({ hash = "#/", meta = ID_A, css = "/v/" + ID_A + "/styles.css", versions = [ID_A], fail = null, storage = memStore(), framed = false } = {}) {
  document.head.replaceChildren(); clean();
  if (meta !== null) { const m = document.createElement("meta"); m.setAttribute("name", "unterricks-build"); m.setAttribute("content", meta); document.head.append(m); }
  if (css) { const l = document.createElement("link"); l.setAttribute("rel", "stylesheet"); l.setAttribute("href", css); document.head.append(l); }
  const env = { doc: document, storage, now: () => 1000, styleWaitMs: 5, imports: [], reloads: 0, fetches: 0 };
  env.win = { top: framed ? {} : null, self: null, location: { hash, reload: () => { env.reloads++; } } };
  if (!framed) env.win.top = env.win.self = env.win;
  env.fetch = async () => { const v = versions[Math.min(env.fetches++, versions.length - 1)]; if (v instanceof Error) throw v; return jsonRes({ build: v }); };
  env.importApp = async (u) => { env.imports.push(u); if (fail && fail(u)) throw new TypeError("Failed to fetch dynamically imported module: " + u); };
  return env;
}
test("Startdatei: lädt den Stand laut /version.json (auch mit veraltetem index.html samt Stylesheet), sonst den aus index.html; ohne Stand ein ruhiger Hinweis", async () => {
  let env = bootEnv();
  assert.equal(await BOOT.start(env), "ok:" + ID_A);
  assert.deepEqual(env.imports, ["/v/" + ID_A + "/app.js"]);
  // veraltetes index.html (Stand A), ausgeliefert wird B: B laden, Stylesheet von B dazu, das alte weg
  env = bootEnv({ versions: [ID_B] });
  assert.equal(await BOOT.start(env), "ok:" + ID_B);
  assert.deepEqual(env.imports, ["/v/" + ID_B + "/app.js"]);
  assert.equal(document.querySelector('meta[name="unterricks-build"]').getAttribute("content"), ID_B);
  assert.deepEqual($$('link[rel="stylesheet"]').map((l) => l.getAttribute("href")), ["/v/" + ID_A + "/styles.css", "/v/" + ID_B + "/styles.css"], "ohne geladenes neues Stylesheet bleibt das alte stehen");
  // index.html von vor der Umstellung (lädt /app.js = Startdatei, /styles.css)
  env = bootEnv({ meta: null, css: "/styles.css", versions: [ID_B] });
  const p = BOOT.ensureStyles(document, ID_B, 1000);
  const added = $$('link[rel="stylesheet"]').find((l) => l.getAttribute("href") === "/v/" + ID_B + "/styles.css");
  added.onload(); await p;
  assert.deepEqual($$('link[rel="stylesheet"]').map((l) => l.getAttribute("href")), ["/v/" + ID_B + "/styles.css"], "geladen: das alte Stylesheet ist weg");
  env = bootEnv({ meta: null, css: "/styles.css", versions: [ID_B] });
  assert.equal(await BOOT.start(env), "ok:" + ID_B);
  assert.equal(document.querySelector('meta[name="unterricks-build"]').getAttribute("content"), ID_B, "der laufende Stand steht auch dann im <meta>");
  // kein Netz: Stand aus index.html
  env = bootEnv({ versions: [new TypeError("offline")] });
  assert.equal(await BOOT.start(env), "ok:" + ID_A);
  // weder noch: Hinweis statt leerer Seite
  env = bootEnv({ meta: null, versions: [new TypeError("offline")] });
  assert.equal(await BOOT.start(env), "failed");
  assert.match(document.getElementById("app").textContent, /^Unterricks konnte nicht geladen werden/);
  // die Oberfläche läuft schon (index.html hat app.js des Stands geladen): nichts tun, nicht einmal nachfragen
  env = bootEnv();
  document.documentElement.setAttribute(BOOT.STARTED_ATTR, ID_A);
  assert.equal(await BOOT.start(env), "running"); assert.equal(env.fetches, 0); assert.equal(env.imports.length, 0);
  document.documentElement.removeAttribute(BOOT.STARTED_ATTR);
  // in einer fremden Seite: nichts zeigen, nichts laden
  env = bootEnv({ framed: true });
  assert.equal(await BOOT.start(env), "framed"); assert.equal(document.documentElement.hidden, true); assert.equal(env.imports.length, 0);
  document.documentElement.hidden = false;
});
test("Startdatei: scheitert das Laden, von selbst neu nur bei einem inzwischen anderen Stand und höchstens einmal je Stand – sonst ein ruhiger Hinweis (Sie/du) mit „Neu laden“ und technischer Angabe", async () => {
  // Deploy genau jetzt: A scheitert, inzwischen B → einmal neu laden
  const storage = memStore();
  let env = bootEnv({ versions: [ID_A, ID_B], fail: (u) => u.includes(ID_A), storage });
  assert.equal(await BOOT.start(env), "reload:" + ID_B);
  assert.equal(env.reloads, 1);
  // nach dem Neuladen scheitert auch B (z. B. halber Deploy), der Server meldet weiter B: kein zweites Mal, Hinweis
  env = bootEnv({ hash: "#/lk/s/0123456789abcdef", versions: [ID_B, ID_B], fail: () => true, storage });
  assert.equal(await BOOT.start(env), "failed"); assert.equal(env.reloads, 0);
  const app = document.getElementById("app");
  assert.equal(app.querySelector("h1").textContent, BOOT.BOOT_TEXT.title);
  assert.equal(app.querySelectorAll("p")[0].textContent, BOOT.BOOT_TEXT.sie);
  assert.match(app.textContent, /Technische Angabe: Failed to fetch dynamically imported module: \/v\/bbbbbbbbbbbb\/app\.js/);
  const btn = button(app, "Neu laden"); assert.ok(btn); btn.click(); assert.equal(env.reloads, 1, "„Neu laden“ lädt (von Hand) neu");
  // Schüler:in, gleicher Stand, Netzfehler: du-Form, kein automatisches Neuladen
  env = bootEnv({ hash: "#/schueler/s/0123456789abcdef", versions: [ID_A, ID_A], fail: () => true });
  assert.equal(await BOOT.start(env), "failed"); assert.equal(env.reloads, 0);
  assert.equal(document.getElementById("app").querySelectorAll("p")[0].textContent, BOOT.BOOT_TEXT.du);
  assert.ok(!/Sie |Ihre /.test(BOOT.BOOT_TEXT.du) && /Prüfen Sie/.test(BOOT.BOOT_TEXT.sie));
});

/* ---------- update.js ---------- */
function setup(U, { build = ID_A, latest = ID_A, at = 1000, versions = [ID_A], hash = "#/lk/s/0123456789abcdef" } = {}) {
  clean();
  location.hash = hash;
  const s = { now: at, fetches: 0, reloads: 0, storage: memStore() };
  Object.assign(U.versionState, { build, latest, at, pending: null });
  U.io.now = () => s.now;
  U.io.fetch = async () => { const v = versions[Math.min(s.fetches++, versions.length - 1)]; if (v instanceof Error) throw v; return jsonRes({ build: v }); };
  U.io.reload = () => { s.reloads++; };
  U.io.storage = () => s.storage;
  U.io.sleep = (ms) => D.sleep(Math.min(ms, 5));
  U.io.beforeUnload = () => new D.Event("beforeunload", { cancelable: true });
  return s;
}
test("update.js: Stand aus der eigenen Adresse; Prüfung beim Seitenwechsel höchstens alle 15 s, eine Anfrage gleichzeitig; ein Fehlschlag ändert den bekannten Stand nicht", async () => {
  const U = await loadUpdate();
  assert.equal(U.buildOf("https://unterricks.janrickmer.de/v/0123456789ab/update.js"), "0123456789ab");
  assert.equal(U.buildOf("http://localhost:8787/v/0123456789ab/update.js?x=1"), "0123456789ab");
  assert.equal(U.buildOf("file:///home/user/Unterricks/public/update.js"), null);
  assert.equal(U.buildOf("https://x/v/0123456789ab/sub/update.js"), null);
  assert.equal(U.BUILD, null, "Unit-Tests lesen public/ – ohne Stand");
  assert.equal(U.RELOAD_KEY, BOOT.RELOAD_KEY);
  const s = setup(U, { versions: [ID_A, new TypeError("offline"), ID_B] });
  assert.equal(U.navCheckDue(), false, "gerade erst gestartet (die Startdatei hat eben gefragt)");
  s.now += U.NAV_FRESH_MS - 1; assert.equal(U.navCheckDue(), false);
  s.now += 1; assert.equal(U.navCheckDue(), true);
  const [a, b] = [U.checkVersion({ maxAge: U.NAV_FRESH_MS }), U.checkVersion({ maxAge: U.NAV_FRESH_MS })];
  assert.equal(a, b, "eine Anfrage gleichzeitig"); assert.equal(await a, ID_A); assert.equal(s.fetches, 1);
  assert.equal(await U.checkVersion({ maxAge: U.NAV_FRESH_MS }), ID_A); assert.equal(s.fetches, 1, "frisch: keine neue Anfrage");
  assert.equal(await U.checkVersion(), null); assert.equal(U.versionState.latest, ID_A); assert.equal(U.isOutdated(), false, "kein Netz: bekannter Stand bleibt");
  assert.equal(U.navCheckDue(), false, "auch ein Fehlschlag zählt als Prüfung (kein Warten bei jedem Klick ohne Netz)");
  assert.equal(await U.checkVersion(), ID_B); assert.equal(U.isOutdated(), true); assert.equal(U.navCheckDue(), true, "neuer Stand bekannt: jeder Seitenwechsel versucht neu zu laden");
  // ohne Stand (Quellen, Unit-Tests): nie prüfen
  setup(U, { build: null, latest: null, at: 0 });
  assert.equal(U.navCheckDue(), false); assert.equal(await U.checkVersion(), null);
  // Merker gemeinsam mit der Startdatei
  const st = memStore();
  assert.equal(U.noteAutoReload(ID_B, st), true); assert.equal(BOOT.mayAutoReload(st, ID_B), false); assert.equal(U.mayAutoReload(ID_B, st), false);
  BOOT.noteAutoReload(st, ID_A, 1); assert.equal(U.mayAutoReload(ID_A, st), false); assert.equal(U.mayAutoReload(ID_B, st), true);
});

test("update.js: sicherer Moment – offene Ebene, Vollbild, angemeldete Präsentation, laufende Arbeit, ungespeicherte Eingaben", async () => {
  const U = await loadUpdate();
  setup(U);
  assert.deepEqual(U.blockersOf({ layers: 0, fullscreen: false, held: false, working: false, unsaved: false }), []);
  assert.deepEqual(U.blockersOf({ layers: 2, fullscreen: true, held: true, working: true, unsaved: true }), ["dialog", "fullscreen", "presentation", "working", "unsaved"]);
  assert.deepEqual(U.blockersOf(U.reloadSnapshot({ unsaved: true })), []);
  const dlg = UI.modal({ title: "Test", body: UI.h("p", { text: "x" }) });
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), ["dialog"]);
  dlg.close();
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), []);
  let live = true;
  const off = U.holdReload(() => live);
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), ["presentation"]);
  live = false; assert.deepEqual(U.blockersOf(U.reloadSnapshot()), []);
  live = true; off(); assert.deepEqual(U.blockersOf(U.reloadSnapshot()), [], "abgemeldet (Seite verlassen)");
  const offErr = U.holdReload(() => { throw new Error("kaputt"); });
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), ["presentation"], "im Zweifel nicht neu laden"); offErr();
  let done; const work = UI.trackWork(new Promise((r) => { done = r; }));
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), ["working"]);
  done(); await work; await D.sleep(0);
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), []);
  const btn = UI.h("button", { type: "button" }, "Speichern"); document.getElementById("app").append(btn);
  let release; const busyRun = UI.busy(btn, () => new Promise((r) => { release = r; }));
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), ["working"], "Aktion hinter busy()");
  release(); await busyRun; assert.deepEqual(U.blockersOf(U.reloadSnapshot()), []);
  const realNow = Date.now; let t = realNow() - 10000;   // in der Vergangenheit: nach dem Zurücksetzen der Uhr ist der Download längst vorbei
  Date.now = () => t;
  try {
    UI.downloadUrl("data:text/plain,x", "x.txt");
    assert.deepEqual(U.blockersOf(U.reloadSnapshot()), ["working"], "gerade begonnener Download");
    t += 5001; assert.deepEqual(U.blockersOf(U.reloadSnapshot()), []);
  } finally { Date.now = realNow; }
  const guard = (e) => { e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", guard);
  assert.deepEqual(U.blockersOf(U.reloadSnapshot({ unsaved: true })), ["unsaved"], "die eigenen Rückfragen der Seiten beim Verlassen zählen");
  assert.deepEqual(U.blockersOf(U.reloadSnapshot()), [], "nur auf Wunsch geprüft");
  window.removeEventListener("beforeunload", guard);
  assert.deepEqual(U.blockersOf(U.reloadSnapshot({ unsaved: true })), []);
});

test("update.js: Seitenwechsel – neuer Stand und sicherer Moment: laufende Arbeit abwarten, einmal neu laden; mit Dialog bzw. Präsentation (vor dem Verlassen festgestellt) wie gewohnt weiter", async () => {
  // kein neuer Stand: weiter
  let U = await loadUpdate(), s = setup(U, { versions: [ID_A] });
  s.now += U.NAV_FRESH_MS;
  assert.deepEqual(U.navBlockers(), []);
  assert.equal(await U.beforeRoute(U.navBlockers()), false); assert.equal(s.reloads, 0); assert.equal(s.fetches, 1);
  // neuer Stand, sicher: neu laden – einmal (zwei Seitenwechsel gleichzeitig teilen sich die Prüfung), Merker gesetzt
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  const [r1, r2] = await Promise.all([U.beforeRoute([]), U.beforeRoute([])]);
  assert.equal(r1, true); assert.equal(r2, true); assert.equal(s.reloads, 1); assert.equal(s.fetches, 1);
  assert.equal(JSON.parse(s.storage.getItem(U.RELOAD_KEY)).to, ID_B);
  assert.equal(await U.beforeRoute([]), true, "lädt schon neu"); assert.equal(s.reloads, 1);
  // offener Dialog (bleibt über den Seitenwechsel offen): nicht neu laden, nicht warten – der nächste Seitenwechsel versucht es wieder
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  const dlg = UI.modal({ title: "Link hinzufügen", body: UI.h("input", { id: "x" }) });
  const pre = U.navBlockers();
  assert.deepEqual(pre, ["dialog"]);
  assert.equal(await U.beforeRoute(pre), false); assert.equal(s.reloads, 0);
  await D.sleep(5); assert.equal(U.isOutdated(), true, "im Hintergrund nachgefragt");
  dlg.close();
  assert.equal(U.navCheckDue(), true);
  assert.equal(await U.beforeRoute(U.navBlockers()), true); assert.equal(s.reloads, 1);
  // angemeldete Präsentation (Beamer, Live-Fenster der Schüler:innen): ebenso
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  const off = U.holdReload(() => true);
  assert.deepEqual(U.navBlockers(), ["presentation"]);
  assert.equal(await U.beforeRoute(U.navBlockers()), false); assert.equal(s.reloads, 0); off();
  // laufende Arbeit zählt vor dem Verlassen nicht (sie wird abgewartet)
  let fin; const w = UI.trackWork(new Promise((x) => { fin = x; }));
  assert.deepEqual(U.navBlockers(), []); fin(); await w;
  // Merker schon für B genutzt: kein zweites automatisches Neuladen
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  U.noteAutoReload(ID_B);
  assert.equal(await U.beforeRoute([]), false); assert.equal(s.reloads, 0);
  // Speichern beim Verlassen läuft noch: abwarten, dann neu laden
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  let saved = false;
  UI.trackWork(D.sleep(30).then(() => { saved = true; }));
  assert.equal(await U.beforeRoute([]), true); assert.equal(saved, true, "erst nach dem Speichern neu geladen"); assert.equal(s.reloads, 1);
  // ungespeicherte Eingaben, die das Verlassen nicht sichert (z. B. laufender Druck): nicht neu laden, die neue Seite kommt wie gewohnt
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  const guard = (e) => e.preventDefault();
  window.addEventListener("beforeunload", guard);
  assert.equal(await U.beforeRoute([]), false); assert.equal(s.reloads, 0);
  window.removeEventListener("beforeunload", guard);
  // Arbeit läuft länger als SETTLE_MS: nicht neu laden
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] }); s.now += U.NAV_FRESH_MS;
  let stop; const long = UI.trackWork(new Promise((x) => { stop = x; }));
  U.io.sleep = async () => { s.now += 1000; await D.sleep(0); };
  assert.equal(await U.beforeRoute([]), false); assert.equal(s.reloads, 0);
  stop(); await long;
  // kein Netz: weiter wie gewohnt
  U = await loadUpdate(); s = setup(U, { versions: [new TypeError("offline")] }); s.now += U.NAV_FRESH_MS;
  assert.equal(await U.beforeRoute([]), false); assert.equal(s.reloads, 0);
});

test("update.js: Nachladen gescheitert – Dialog „Unterricks wurde aktualisiert“ (Sie/du) bzw. „Ein Teil … ließ sich nicht laden“ mit „Neu laden“, nie von selbst neu; der Router zeigt stattdessen eine Seite und lädt einmal neu", async () => {
  let U = await loadUpdate(), s = setup(U, { versions: [ID_B] });
  const cause = new SyntaxError("The requested module './portalview.js' does not provide an export named 'keepFocusOn'");
  let err = null;
  await U.lazy(Promise.reject(cause)).catch((e) => { err = e; });
  assert.ok(U.isModuleError(err) && err.cause === cause && err.message === U.LOAD_SHORT.sie && !/portalview|export/.test(err.message), "Meldung ohne Technik");
  const ok1 = await U.lazy(Promise.resolve({ x: 1 })); assert.equal(ok1.x, 1);
  await D.sleep(20);
  let m = $$(".modal");
  assert.equal(m.length, 1, "der Dialog kommt von selbst (auch wo die Seite den Fehler nur in einer Statuszeile nennt)");
  assert.equal(m[0].querySelector("h2").textContent, U.UPDATE_TEXT.title);
  assert.equal(m[0].querySelector(".body p").textContent, U.UPDATE_TEXT.sie);
  assert.ok(!/Technische Angabe/.test(m[0].textContent), "bei einem Update ohne technische Angabe");
  UI.errToast(err); await D.sleep(20);
  assert.equal($$(".modal").length, 1, "errToast zeigt keinen zweiten Hinweis"); assert.equal($$("#toasts .toast").length, 0, "und keine technische Meldung");
  button(m[0], "Jetzt neu laden").click(); assert.equal(s.reloads, 1); assert.equal($$(".modal").length, 1, "der Dialog bleibt bis zum Neuladen (z. B. Rückfrage des Browsers abgebrochen)");
  button(m[0], "Abbrechen").click(); assert.equal($$(".modal").length, 0);
  // Schüler:in, Netzfehler (kein neuer Stand): du-Form, technische Angabe, „Neu laden“
  U = await loadUpdate(); s = setup(U, { versions: [ID_A], hash: "#/schueler/s/0123456789abcdef" });
  await U.lazy(Promise.reject(new TypeError("Failed to fetch dynamically imported module: /v/aaaaaaaaaaaa/pdfmaker.js"))).catch((e) => { err = e; });
  assert.equal(err.message, U.LOAD_SHORT.du);
  await D.sleep(20);
  m = $$(".modal");
  assert.equal(m.length, 1); assert.equal(m[0].querySelector("h2").textContent, U.LOAD_TEXT.title);
  assert.equal(m[0].querySelectorAll(".body p")[0].textContent, U.LOAD_TEXT.du);
  assert.equal(m[0].querySelectorAll(".body p")[1].textContent, "Technische Angabe: Failed to fetch dynamically imported module: /v/aaaaaaaaaaaa/pdfmaker.js");
  assert.ok(button(m[0], "Neu laden") && button(m[0], "Abbrechen")); assert.equal(s.reloads, 0, "nie von selbst");
  button(m[0], "Abbrechen").click();
  // Router: die Seite selbst ist der Hinweis (kein Dialog dazu); neuer Stand und sicher → einmal von selbst neu
  U = await loadUpdate(); s = setup(U, { versions: [ID_B], hash: "#/lk/s/0123456789abcdef" });
  await U.lazy(Promise.reject(cause)).catch((e) => { err = e; });
  const shown = [];
  await U.pageFailed(err, (node) => { shown.push(node); document.getElementById("app").replaceChildren(node); });
  await D.sleep(20);
  assert.equal($$(".modal").length, 0, "kein Dialog zusätzlich zur Seite");
  const page = shown[0];
  assert.ok(page.classList.contains("loadfail") && page.querySelector("h1").textContent === U.UPDATE_TEXT.title && button(page, "Jetzt neu laden"));
  assert.equal(s.reloads, 1); assert.equal(page.querySelector("[role=status]").textContent, U.RELOADING_TEXT);
  // dasselbe noch einmal (Merker genutzt): Seite bleibt, kein zweites automatisches Neuladen
  await U.pageFailed(new U.ModuleLoadError(cause), (node) => document.getElementById("app").replaceChildren(node));
  assert.equal(s.reloads, 1);
  // offener Dialog: Seite zeigen, aber nicht neu laden
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] });
  const dlg = UI.modal({ title: "Offen", body: UI.h("p", { text: "x" }) });
  await U.pageFailed(new U.ModuleLoadError(cause), (node) => document.getElementById("app").replaceChildren(node));
  assert.equal(s.reloads, 0); assert.ok(document.querySelector("main.loadfail")); dlg.close();
  // inzwischen woanders hin gewechselt: nichts zeigen
  U = await loadUpdate(); s = setup(U, { versions: [ID_B] });
  let painted = 0;
  const run = U.pageFailed(new U.ModuleLoadError(cause), () => painted++);
  location.hash = "#/lk"; await run;
  assert.equal(painted, 0); assert.equal(s.reloads, 0);
  // Netzfehler auf der Seite: Hinweis mit technischer Angabe, nie von selbst neu
  U = await loadUpdate(); s = setup(U, { versions: [ID_A], hash: "#/eltern/abc" });
  await U.pageFailed(new U.ModuleLoadError(new TypeError("Load failed")), (node) => document.getElementById("app").replaceChildren(node));
  const pg = document.querySelector("main.loadfail");
  assert.equal(pg.querySelector("h1").textContent, U.LOAD_TEXT.title); assert.equal(pg.querySelectorAll("p")[0].textContent, U.LOAD_TEXT.sie);
  assert.match(pg.textContent, /Technische Angabe: Load failed/); assert.equal(s.reloads, 0);
});

test("Texte: ruhig, Sie für Lehrkraft und Eltern, du für Schüler:innen, typografische Anführungszeichen, keine Technik", async () => {
  const U = await loadUpdate();
  for (const T of [U.UPDATE_TEXT, U.LOAD_TEXT, U.LOAD_SHORT, BOOT.BOOT_TEXT]) {
    assert.ok(/\b(Sie|Ihre?|Prüfen Sie|laden Sie)\b/.test(T.sie) && !/\b(du|dein|Prüfe|lade)\b/.test(T.sie), T.sie);
    assert.ok(/\b(du|Prüfe|Lade|lade)\b/.test(T.du) && !/\bSie\b/.test(T.du), T.du);
    for (const t of [T.sie, T.du, T.title || ""]) assert.ok(!/["']|module|import|fetch|404/i.test(t), t);
  }
  assert.equal(U.UPDATE_TEXT.button, "Jetzt neu laden"); assert.equal(U.LOAD_TEXT.button, "Neu laden"); assert.equal(BOOT.BOOT_TEXT.button, "Neu laden");
  assert.equal(B.STALE_MESSAGE, "Unterricks wurde aktualisiert – bitte die Seite neu laden.");
});
