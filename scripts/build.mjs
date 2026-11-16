// Baut die statische Seite aus public/ und die benötigten Bibliotheken (PDF.js, pdf-lib) aus node_modules/vendor.
//   npm run build                          → dist/        (wird vom Worker ausgeliefert; Sicherheits-Header setzt der Worker)
//   PAGES_API=https://… npm run build      → dist-pages/  (für GitHub Pages: Worker-Adresse und Sicherheitsregeln als <meta>,
//                                                            denn GitHub Pages setzt keine eigenen Header)
//
// Stände (S24, 14.11.2026 – nach einem Deploy mischte ein offener Tab alte und neue Programmteile): Jeder Build bekommt einen Stand = die ersten
// 12 Zeichen des SHA-256 über public/ und die Bibliotheken – für dist/ und dist-pages/ desselben Commits also derselbe. Alle Programmteile
// (*.js), styles.css und vendor/ liegen in /v/<Stand>/; untereinander laden sie sich relativ („./ui.js“), absolute Verweise („/vendor/…“) schreibt
// der Build auf „/v/<Stand>/vendor/…“ um. Eine Seite lädt so immer nur Dateien eines Stands; die alten Ordner sind nach einem Deploy weg (404) –
// nie kommt neuer Code unter einer alten Adresse (GitHub Pages ignoriert Abfragen wie ?v=…, ein alter Verweis bekäme dort neuen Inhalt).
//   /boot.js      Startdatei, bleibt gleich: läuft die Oberfläche nicht, fragt sie /version.json (immer frisch) und lädt /v/<Stand>/app.js
//   /version.json {"build":"<Stand>"} – was jetzt ausgeliefert wird (update.js fragt beim Seitenwechsel danach)
//   /index.html   lädt /v/<Stand>/app.js und danach /boot.js; Stand als <meta name="unterricks-build">, Stylesheet aus /v/<Stand>/
//   /app.js       = boot.js (ein bis zu 10 Minuten alter index.html-Zwischenspeicher von Pages lädt noch /app.js)
//   /<Modul>.js   Platzhalter, der „Unterricks wurde aktualisiert …“ meldet: Tabs von vor dieser Umstellung laden ihre Module noch hier
//   /styles.css, /vendor/, /fonts/, Bilder: unversioniert (Schriften und Bilder verweisen absolut darauf; styles.css/vendor für ältere Tabs)
// public/ bleibt unverändert lesbar (Unit-Tests lesen die Quellen).
import { createHash } from "node:crypto";
import { cp, mkdir, rm, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const VENDOR = [["pdfjs-dist/build/pdf.min.mjs", "pdf.min.mjs"], ["pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"], ["pdf-lib/dist/pdf-lib.esm.min.js", "pdf-lib.esm.min.js"]];
export const BUILD_RE = /^[a-f0-9]{12}$/;
export const BOOT = "boot.js";
// Platzhalter für Tabs von vor der Umstellung (alte Seite lädt „./teacher.js“ usw. noch ohne Stand): neutral formuliert (Lehrkraft und Schüler:innen)
export const STALE_MESSAGE = "Unterricks wurde aktualisiert – bitte die Seite neu laden.";
export const STALE_STUB = "// Platzhalter (S24): Die Programmteile von Unterricks liegen jetzt je Stand in /v/<Stand>/. Ein Tab von vor dieser Umstellung lädt sie hier.\n" +
  "throw new Error(" + JSON.stringify(STALE_MESSAGE) + ");\n";

async function filesOf(dir, base = dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesOf(p, base))); else out.push(relative(base, p).split("\\").join("/"));
  }
  return out.sort();
}

/* Stand: SHA-256 über alle Quelldateien (Pfad, Länge, Inhalt), die Bibliotheken und dieses Skript (es bestimmt, was in /v/<Stand>/ steht – ändert
   sich nur der Umbau, darf unter derselben Adresse kein anderer Inhalt liegen) – unabhängig vom Ziel (Worker oder Pages) */
export async function buildId(src, nm) {
  const hash = createHash("sha256");
  const add = (name, bytes) => { hash.update(name + "\0" + bytes.length + "\0"); hash.update(bytes); };
  add("scripts/build.mjs", await readFile(fileURLToPath(import.meta.url)));
  for (const f of await filesOf(src)) add("public/" + f, await readFile(join(src, f)));
  for (const [from, to] of VENDOR) add("vendor/" + to, await readFile(join(nm, from)));
  return hash.digest("hex").slice(0, 12);
}

/* Modul-Verweise im Quelltext: import … from "x", import "x", export … from "x", import("x") – je { spec, start, end } (Position des Textes in
   den Anführungszeichen). Nur echte Zeichenketten; Kommentare und Text in Zeichenketten zählen nicht. */
export function moduleSpecifiers(code) {
  const out = [], mask = maskCode(code);
  // zwischen import/export und from nur Namen, {…}, *, „as“ und Kommas (auch über mehrere Zeilen) – nie über ein anderes import() hinweg
  const re = /\b(?:import|export)\s*[\w$*{},\s]*?\bfrom\s*(["'])([^"'\n]*)\1|\bimport\s*(["'])([^"'\n]*)\3|\bimport\s*\(\s*(["'])([^"'\n]*)\5\s*\)/g;
  for (let m; (m = re.exec(mask)); ) {
    const q = m[1] || m[3] || m[5], spec = m[2] ?? m[4] ?? m[6], kind = m[1] ? "from" : m[3] ? "side-effect" : "dynamic";
    const end = m.index + m[0].length - (kind === "dynamic" ? m[0].length - m[0].lastIndexOf(q) : 1), start = end - spec.length;
    // Text an dieser Stelle (der Maske entspricht das Original an denselben Positionen)
    out.push({ spec: code.slice(start, end), kind, start, end, quote: q });
  }
  return out;
}
/* Kommentare und den Inhalt von Zeichenketten (außer der Verweise selbst) durch Leerzeichen ersetzen – gleiche Länge, gleiche Positionen.
   Zeichenketten nach import/from bleiben stehen; alle übrigen werden geleert, damit „from "…"“ in einem Text nie als Verweis zählt. */
function maskCode(code, keepStrings = false) {   // keepStrings: nur Kommentare (und reguläre Ausdrücke) leeren – für die Prüfung des gebauten Stands
  let out = "", i = 0;
  const n = code.length;
  const keepNext = () => /(\bfrom|\bimport)\s*$/.test(out) || /\bimport\s*\(\s*$/.test(out);
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === "/" && d === "/") { const e = code.indexOf("\n", i); const stop = e < 0 ? n : e; out += " ".repeat(stop - i); i = stop; continue; }
    if (c === "/" && d === "*") { const e = code.indexOf("*/", i + 2); const stop = e < 0 ? n : e + 2; out += code.slice(i, stop).replace(/[^\n]/g, " "); i = stop; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && code[j] !== c) { if (code[j] === "\\") j++; if (c !== "`" && code[j] === "\n") break; j++; }
      const stop = Math.min(n, j + 1), keep = keepStrings || (c !== "`" && keepNext());
      out += keep ? code.slice(i, stop) : c + code.slice(i + 1, stop - 1).replace(/[^\n]/g, " ") + (stop - 1 > i ? code[stop - 1] : "");
      i = stop; continue;
    }
    if (c === "/" && /[(,=:[!&|?{};]\s*$|^\s*$|\breturn\s*$/.test(out.slice(-40)) && d !== "/" && d !== "*") {   // regulärer Ausdruck: Inhalt leeren
      let j = i + 1, cls = false;
      while (j < n && code[j] !== "\n") { if (code[j] === "\\") { j += 2; continue; } if (code[j] === "[") cls = true; else if (code[j] === "]") cls = false; else if (code[j] === "/" && !cls) break; j++; }
      if (j < n && code[j] === "/") { out += "/" + " ".repeat(j - i - 1) + "/"; i = j + 1; continue; }
    }
    out += c; i++;
  }
  return out;
}

const VERSIONED = /^\/v\/[a-f0-9]{12}\//;
/* Absolute Verweise („/vendor/…“) auf den Stand umschreiben, relative bleiben (sie liegen im selben Ordner /v/<Stand>/). Bereits umgeschriebene
   bleiben unverändert (mehrfach anwenden ändert nichts). Sonst ändert sich nichts am Quelltext. */
export function versionSpecifiers(code, id) {
  if (!BUILD_RE.test(id)) throw new Error("Ungültiger Stand: " + id);
  let out = "", at = 0;
  for (const s of moduleSpecifiers(code)) {
    if (!s.spec.startsWith("/") || s.spec.startsWith("//") || VERSIONED.test(s.spec)) continue;
    out += code.slice(at, s.start) + "/v/" + id + s.spec; at = s.end;
  }
  return out + code.slice(at);
}

/* index.html: Stand als <meta>, Stylesheet und app.js des Stands direkt (die Seite steht wie bisher beim load-Ereignis), danach die Startdatei
   als Rückfall (läuft die Oberfläche nicht – z. B. ein veraltetes index.html, dessen Stand es nicht mehr gibt –, lädt sie den aktuellen Stand);
   scheitert laut, wenn die erwarteten Zeilen fehlen */
export function versionIndex(html, id) {
  const css = '<link rel="stylesheet" href="/styles.css">', js = '<script type="module" src="/app.js"></script>', cs = '<meta charset="utf-8">';
  for (const x of [css, js, cs]) if (!html.includes(x)) throw new Error("index.html: " + x + " nicht gefunden");
  return html.replace(cs, cs + '\n  <meta name="unterricks-build" content="' + id + '">')
    .replace(css, '<link rel="stylesheet" href="/v/' + id + '/styles.css">')
    .replace(js, '<script type="module" src="/v/' + id + '/app.js"></script>\n  <script type="module" src="/' + BOOT + '"></script>');
}

/* Prüft den gebauten Stand: Jeder Verweis jedes eigenen Moduls zeigt in /v/<Stand>/ (genau einmal) auf eine vorhandene Datei; es gibt keine
   Verweise, die sich nicht umschreiben lassen (import(variable), andere Herkunft); new URL("…", import.meta.url) zeigt auf vorhandene Dateien. */
export async function verifyVersioned(out, id) {
  const dir = join(out, "v", id), problems = [];
  const own = (await readdir(dir)).filter((f) => f.endsWith(".js"));
  for (const f of own) {
    const code = await readFile(join(dir, f), "utf8"), base = "/v/" + id + "/" + f;
    const mask = maskCode(code);
    if (/\bimport\s*\(\s*(?!["'])/.test(mask.replace(/\bimport\s*\(\s*\/\*[\s\S]*?\*\//g, ""))) problems.push(f + ": import() ohne feste Adresse");
    const targets = moduleSpecifiers(code).map((s) => s.spec);
    for (const m of mask.matchAll(/new URL\(\s*(["'])/g)) {
      const r = /^new URL\(\s*(["'])([^"'\n]*)\1\s*,\s*import\.meta\.url\s*\)/.exec(code.slice(m.index));
      if (r) targets.push(r[2]);
    }
    // Gegenprobe ohne Zerlegung: kein absoluter Verweis außerhalb des Stands irgendwo im Quelltext (auch nicht in einer Vorlage `…${import("/x.js")}…`,
    // die die Zerlegung als Text überspringt); Kommentare zählen nicht
    for (const m of maskCode(code, true).matchAll(/\b(?:import\s*\(\s*|import\s*|from\s*)(["'`])(\/[^"'`\n]*)\1/g))
      if (!m[2].startsWith("/v/" + id + "/") && !targets.includes(m[2])) problems.push(f + ": " + m[2] + " (Verweis ohne Stand)");
    for (const spec of targets) {
      if (!spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith("/")) { problems.push(f + ": " + spec + " (kein Pfad dieser Seite)"); continue; }
      if (spec.startsWith("//")) { problems.push(f + ": " + spec + " (andere Herkunft)"); continue; }
      const url = posix.normalize(spec.startsWith("/") ? spec : posix.join(posix.dirname(base), spec));
      const n = url.split("/v/" + id + "/").length - 1;
      if (!url.startsWith("/v/" + id + "/") || n !== 1 || /\/v\/[a-f0-9]{12}\/.*\/v\/[a-f0-9]{12}\//.test(url)) { problems.push(f + ": " + spec + " → " + url + " (nicht im Stand)"); continue; }
      if (!existsSync(join(out, url))) problems.push(f + ": " + spec + " → " + url + " (fehlt)");
    }
  }
  if (problems.length) throw new Error("Stand " + id + " unvollständig:\n  " + problems.join("\n  "));
  return own.length;
}

const HEADERS_EXTRA = "\n# Stände (S24): was gerade ausgeliefert wird, nie zwischenspeichern; die Startdatei immer neu prüfen\n" +
  "/version.json\n  Cache-Control: no-store\n/boot.js\n  Cache-Control: no-cache\n/app.js\n  Cache-Control: no-cache\n";

/* Baut eine Ausgabe. pagesApi: Server-Adresse für GitHub Pages (CSP als <meta>, keine _headers); fbApi: Feibeitsblatt-Schnittstelle */
export async function buildSite({ out, src = join(ROOT, "public"), nm = join(ROOT, "node_modules"), pagesApi = "", fbApi = "" } = {}) {
  const id = await buildId(src, nm);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "vendor"), { recursive: true });
  await cp(src, out, { recursive: true });
  for (const [from, to] of VENDOR) await copyFile(join(nm, from), join(out, "vendor", to));
  // Stand: alle Module (außer der Startdatei), styles.css und vendor/ in /v/<Stand>/
  const vdir = join(out, "v", id);
  await mkdir(join(vdir, "vendor"), { recursive: true });
  const mods = (await readdir(src)).filter((f) => f.endsWith(".js") && f !== BOOT);
  for (const f of mods) await writeFile(join(vdir, f), versionSpecifiers(await readFile(join(src, f), "utf8"), id));
  await copyFile(join(src, "styles.css"), join(vdir, "styles.css"));
  for (const [, to] of VENDOR) await copyFile(join(out, "vendor", to), join(vdir, "vendor", to));
  // unversionierte Wurzel: Startdatei, Platzhalter für Tabs von vor der Umstellung, Stand
  const boot = await readFile(join(src, BOOT), "utf8");
  for (const f of mods) await writeFile(join(out, f), f === "app.js" ? boot : STALE_STUB);
  await writeFile(join(out, "version.json"), JSON.stringify({ build: id }) + "\n");
  let html = versionIndex(await readFile(join(src, "index.html"), "utf8"), id);
  await verifyVersioned(out, id);
  if (!pagesApi) {
    let hd = await readFile(join(out, "_headers"), "utf8");
    // Schnittstelle des Feibeitsblatts in die CSP (connect-src) eintragen, falls abweichend (z. B. lokale Tests)
    if (fbApi) hd = hd.replace("https://feibeitsblatt.feindt.workers.dev", fbApi.replace(/\/+$/, ""));
    await writeFile(join(out, "_headers"), hd + HEADERS_EXTRA);
  } else {
    await rm(join(out, "_headers"), { force: true });   // GitHub Pages wertet _headers nicht aus
    const fb = (fbApi || "https://feibeitsblatt.feindt.workers.dev").replace(/\/+$/, "");
    const wss = pagesApi.replace(/^http/, "ws");
    const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: " + pagesApi, "font-src 'self'", "media-src 'self' " + pagesApi,
      "connect-src 'self' " + pagesApi + " " + wss + " " + fb, "worker-src 'self' blob:", "frame-src https://www.youtube-nocookie.com", "object-src 'none'", "base-uri 'none'", "form-action 'self'"].join("; ");
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="' + csp + '">\n  <meta name="unterricks-api" content="' + pagesApi + '">');
  }
  await writeFile(join(out, "index.html"), html);
  return { id, out, modules: mods.length };
}

// Feibeitsblatt-Schnittstelle: dieselbe Adresse wie im Worker (wrangler.jsonc, vars.FEIBEITSBLATT_API), sonst die Vorgabe
async function feibeitsblattApi() {
  if (process.env.FEIBEITSBLATT_API) return process.env.FEIBEITSBLATT_API.replace(/\/+$/, "");
  const w = await readFile(join(ROOT, "wrangler.jsonc"), "utf8");
  const m = /"FEIBEITSBLATT_API"\s*:\s*"(https:\/\/[^"\s]+)"/.exec(w);
  return (m ? m[1] : "https://feibeitsblatt.feindt.workers.dev").replace(/\/+$/, "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pagesApi = (process.env.PAGES_API || "").trim().replace(/\/+$/, "");
  if (!pagesApi) {
    const r = await buildSite({ out: join(ROOT, "dist"), fbApi: process.env.FEIBEITSBLATT_API || "" });
    console.log("dist/ gebaut (Stand " + r.id + ", " + r.modules + " Module in /v/" + r.id + "/):", (await readdir(r.out)).join(", "));
  } else {
    // Nur eine reine https-Herkunft (ohne Pfad) – sie landet in einem HTML-Attribut und in der CSP
    // (http nur für lokale Tests: localhost bzw. 127.0.0.1 mit Port)
    if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1):\d+)$/i.test(pagesApi)) { console.error("PAGES_API muss eine https-Adresse ohne Pfad sein, z. B. https://unterricks.example.workers.dev"); process.exit(1); }
    const r = await buildSite({ out: join(ROOT, "dist-pages"), pagesApi, fbApi: await feibeitsblattApi() });
    console.log("dist-pages/ gebaut (Server: " + pagesApi + ", Stand " + r.id + "):", (await readdir(r.out)).join(", "));
  }
}
