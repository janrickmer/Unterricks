// Baut die statische Seite aus public/ und die benötigten Bibliotheken (PDF.js, pdf-lib) aus node_modules/vendor.
//   npm run build                          → dist/        (wird vom Worker ausgeliefert; Sicherheits-Header setzt der Worker)
//   PAGES_API=https://… npm run build      → dist-pages/  (für GitHub Pages: Worker-Adresse und Sicherheitsregeln als <meta>,
//                                                            denn GitHub Pages setzt keine eigenen Header)
import { cp, mkdir, rm, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const nm = join(root, "node_modules");

// Feibeitsblatt-Schnittstelle: dieselbe Adresse wie im Worker (wrangler.jsonc, vars.FEIBEITSBLATT_API), sonst die Vorgabe
async function feibeitsblattApi() {
  if (process.env.FEIBEITSBLATT_API) return process.env.FEIBEITSBLATT_API.replace(/\/+$/, "");
  const w = await readFile(join(root, "wrangler.jsonc"), "utf8");
  const m = /"FEIBEITSBLATT_API"\s*:\s*"(https:\/\/[^"\s]+)"/.exec(w);
  return (m ? m[1] : "https://feibeitsblatt.feindt.workers.dev").replace(/\/+$/, "");
}

async function copySite(out) {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "vendor"), { recursive: true });
  await cp(join(root, "public"), out, { recursive: true });
  await copyFile(join(nm, "pdfjs-dist/build/pdf.min.mjs"), join(out, "vendor/pdf.min.mjs"));
  await copyFile(join(nm, "pdfjs-dist/build/pdf.worker.min.mjs"), join(out, "vendor/pdf.worker.min.mjs"));
  await copyFile(join(nm, "pdf-lib/dist/pdf-lib.esm.min.js"), join(out, "vendor/pdf-lib.esm.min.js"));
}

const pagesApi = (process.env.PAGES_API || "").trim().replace(/\/+$/, "");
if (!pagesApi) {
  const dist = join(root, "dist");
  await copySite(dist);
  // Schnittstelle des Feibeitsblatts in die CSP (connect-src) eintragen, falls abweichend (z. B. lokale Tests)
  const fbApi = process.env.FEIBEITSBLATT_API;
  if (fbApi) {
    const hp = join(dist, "_headers");
    await writeFile(hp, (await readFile(hp, "utf8")).replace("https://feibeitsblatt.feindt.workers.dev", fbApi.replace(/\/+$/, "")));
  }
  console.log("dist/ gebaut:", (await readdir(dist)).join(", "));
} else {
  // Nur eine reine https-Herkunft (ohne Pfad) – sie landet in einem HTML-Attribut und in der CSP
  // (http nur für lokale Tests: localhost bzw. 127.0.0.1 mit Port)
  if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1):\d+)$/i.test(pagesApi)) { console.error("PAGES_API muss eine https-Adresse ohne Pfad sein, z. B. https://unterricks.example.workers.dev"); process.exit(1); }
  const out = join(root, "dist-pages"), fb = await feibeitsblattApi();
  await copySite(out);
  await rm(join(out, "_headers"), { force: true });   // GitHub Pages wertet _headers nicht aus
  const wss = pagesApi.replace(/^http/, "ws");
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: " + pagesApi, "font-src 'self'",
    "connect-src 'self' " + pagesApi + " " + wss + " " + fb, "worker-src 'self' blob:", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"].join("; ");
  const ip = join(out, "index.html");
  const html = await readFile(ip, "utf8");
  const meta = '<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="' + csp + '">\n  <meta name="unterricks-api" content="' + pagesApi + '">';
  if (!html.includes('<meta charset="utf-8">')) { console.error("index.html: <meta charset> nicht gefunden"); process.exit(1); }
  await writeFile(ip, html.replace('<meta charset="utf-8">', meta));
  console.log("dist-pages/ gebaut (Server: " + pagesApi + "):", (await readdir(out)).join(", "));
}
