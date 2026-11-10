// Erzeugt public/qr-unterricks.svg: QR-Code zur Adresse von Unterricks (PUBLIC_URL) für die Beamer-Folie mit dem Sitzungscode.
//   node scripts/qr-unterricks.mjs          → Datei schreiben
//   node scripts/qr-unterricks.mjs --check  → nur prüfen, ob die Datei zur Adresse passt (Unit-Test macht dasselbe)
// Der QR-Code entsteht mit qrMatrix aus dem Feibeitsblatt (public/fbanalog.js, Byte-Modus, Fehlerkorrektur M).
import { readFileSync, writeFileSync } from "node:fs";
import { qrMatrix } from "../public/fbanalog.js";
import { PUBLIC_URL } from "../public/shared.js";

export function qrSvg(text) {
  const q = qrMatrix(text), n = q.size + 8;   // Ruhezone: 4 Module je Seite
  let d = "";
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; ) {
      if (!q.dark[y * q.size + x]) { x++; continue; }
      let len = 1; while (x + len < q.size && q.dark[y * q.size + x + len]) len++;
      d += "M" + (x + 4) + " " + (y + 4) + "h" + len + "v1h-" + len + "z";
      x += len;
    }
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges"><title>QR-Code: ' + esc(text) + "</title>" +
    '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>\n';
}
export const QR_FILE = new URL("../public/qr-unterricks.svg", import.meta.url);

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const want = qrSvg(PUBLIC_URL);
  if (process.argv.includes("--check")) {
    let have = ""; try { have = readFileSync(QR_FILE, "utf8"); } catch {}
    if (have !== want) { console.error("public/qr-unterricks.svg passt nicht zu " + PUBLIC_URL + " – bitte node scripts/qr-unterricks.mjs ausführen."); process.exit(1); }
    console.log("QR-Code passt zu " + PUBLIC_URL);
  } else { writeFileSync(QR_FILE, want); console.log("public/qr-unterricks.svg geschrieben (" + PUBLIC_URL + ")"); }
}
