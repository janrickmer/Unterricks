// Übernimmt den Code des analogen Arbeitsblattes („Notfall-Feibeitsblatt“) unverändert aus dem Feibeitsblatt (index.html) nach
// public/fbanalog.js. So entsteht in Unterricks genau dieselbe PDF-Datei wie im Feibeitsblatt („Analoges Arbeitsblatt als PDF
// herunterladen“) – ohne den Code von Hand nachzubauen.
//
//   node scripts/fbanalog-sync.mjs <Pfad zu feibeitsblatt/index.html> [Quelle, z. B. Commit]
//
// Übernommen werden nur benannte Bausteine (Funktionen, Konstanten und die markierten Blöcke VIDEO, PDFPLAIN, QR, WORLDMAP).
// Regel des Feibeitsblatts: Deklarationen beginnen in Spalte 0, ihr Inhalt ist eingerückt, eine Funktion endet mit „}“ in Spalte 0.
import { readFileSync, writeFileSync } from "node:fs";

const [src, origin = "unbekannt"] = process.argv.slice(2);
if (!src) { console.error("Aufruf: node scripts/fbanalog-sync.mjs <feibeitsblatt/index.html> [Quelle]"); process.exit(1); }
const L = readFileSync(src, "utf8").split("\n");

const findLine = (re, from = 0) => { for (let i = from; i < L.length; i++) if (re.test(L[i])) return i; throw new Error("nicht gefunden: " + re); };
// Deklaration ab Zeile i: eingerückte Folgezeilen gehören dazu; „}“/„};“/„]“ in Spalte 0 beendet (und gehört dazu); Leerzeilen nur,
// wenn danach eingerückt weitergeht
function block(i) {
  const out = [L[i]];
  for (let j = i + 1; j < L.length; j++) {
    const l = L[j];
    if (l === "") { let k = j + 1; while (k < L.length && L[k] === "") k++; if (k < L.length && /^\s/.test(L[k])) { out.push(l); continue; } break; }
    if (/^\s/.test(l)) { out.push(l); continue; }
    if (/^[}\])]/.test(l)) { out.push(l); break; }
    break;
  }
  return out.join("\n");
}
const decl = (re) => block(findLine(re));
const marked = (name) => { const a = findLine(new RegExp("^/\\* " + name + ":BEGIN")), b = findLine(new RegExp("^/\\* " + name + ":END \\*/"), a); return L.slice(a, b + 1).join("\n"); };
// zusammenhängender Abschnitt von der ersten bis einschließlich der Deklaration, die mit endRe beginnt
const span = (startRe, endRe) => { const a = findLine(startRe), b = findLine(endRe, a); return L.slice(a, b).join("\n") + "\n" + block(b); };

const parts = [
  decl(/^const pad2 = /),
  decl(/^function fmtCode\(/), decl(/^function normCode\(/),
  decl(/^const MAT_LIMITS = /), decl(/^function cleanHref\(/), decl(/^function cleanMaterial\(/),
  decl(/^const IMAGE_ID_RE = /),
  decl(/^const FILE_ID_RE = /), decl(/^const FILE_MAX_BYTES = /), decl(/^function safeFileName\(/), decl(/^function cleanFiles\(/),
  marked("VIDEO"),
  decl(/^function cleanImages\(/), decl(/^const ANS_LIMITS = /), decl(/^const ITEM_ID_RE = /), decl(/^const oneLine = /), decl(/^function cleanAnswer\(/),
  decl(/^const PDF_W_REG = /), decl(/^const PDF_W_BOLD = /), marked("PDFPLAIN"),
  decl(/^function pdfBytes\(/), decl(/^function pdfStr\(/), decl(/^const PDF_W_EXTRA = /), decl(/^function pdfWidth\(/), decl(/^function pdfWrap\(/),
  decl(/^const pdfUtf16 = /), decl(/^const latin1 = /),
  decl(/^async function deflateBytes\(/), decl(/^async function pdfJpeg\(/), decl(/^async function decodeImage\(/),
  decl(/^const UMLAUTS = /), decl(/^const pdfAscii = /),
  span(/^const ANALOG_LINES = /, /^async function makeAnalogPdf\(/),
  decl(/^const analogPdfName = /),
  marked("QR"),
  marked("WORLDMAP"),
];

const out = `// fbanalog.js – AUTOMATISCH ERZEUGT von scripts/fbanalog-sync.mjs aus dem Feibeitsblatt (index.html, ${origin}). Nicht von Hand ändern:
// Änderungen gehören ins Feibeitsblatt, danach das Skript erneut ausführen.
// Inhalt: das analoge Arbeitsblatt als PDF (makeAnalogPdf, ohne Bibliothek) mit allen Bausteinen – in Unterricks „Notfall-Feibeitsblatt“.
/* eslint-disable */
// Adresse der digitalen Fassung (Hinweiskasten, QR-Code zur Checkliste) – im Feibeitsblatt window.FEIBEITSBLATT_PUBLIC
let PUBLIC_URL = "https://feibeitsblatt.janrickmer.de/";
export function setFeibeitsblattUrl(u) { if (/^https:\\/\\/[^\\s"<>]+$/.test(String(u || ""))) PUBLIC_URL = String(u).replace(/\\/*$/, "/"); }
const checkUrlOf = (code) => PUBLIC_URL.replace(/#.*$/, "") + "#checkliste=" + normCode(code);   // Ziel des QR-Codes (wie im Feibeitsblatt)

${parts.join("\n\n")}

export { makeAnalogPdf, pdfJpeg, analogPdfName, cleanImages, cleanAnswer, cleanVideos, checkUrlOf, fmtCode, normCode, qrMatrix, WORLD_MAP };
`;
writeFileSync(new URL("../public/fbanalog.js", import.meta.url), out);
console.log("public/fbanalog.js geschrieben:", parts.length, "Bausteine,", Math.round(out.length / 1024), "KB");
