// Baut dist/: statische Seite aus public/ und die benötigten Bibliotheken (PDF.js, pdf-lib) aus node_modules/vendor.
import { cp, mkdir, rm, copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname, dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "vendor"), { recursive: true });
await cp(join(root, "public"), dist, { recursive: true });
const nm = join(root, "node_modules");
await copyFile(join(nm, "pdfjs-dist/build/pdf.min.mjs"), join(dist, "vendor/pdf.min.mjs"));
await copyFile(join(nm, "pdfjs-dist/build/pdf.worker.min.mjs"), join(dist, "vendor/pdf.worker.min.mjs"));
await copyFile(join(nm, "pdf-lib/dist/pdf-lib.esm.min.js"), join(dist, "vendor/pdf-lib.esm.min.js"));
// Schnittstelle des Feibeitsblatts in die CSP (connect-src) eintragen, falls abweichend (z. B. lokale Tests)
const fbApi = process.env.FEIBEITSBLATT_API;
if (fbApi) {
  const hp = join(dist, "_headers");
  const { readFile, writeFile } = await import("node:fs/promises");
  await writeFile(hp, (await readFile(hp, "utf8")).replace("https://feibeitsblatt.feindt.workers.dev", fbApi.replace(/\/+$/, "")));
}
console.log("dist/ gebaut:", (await readdir(dist)).join(", "));
