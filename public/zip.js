// zip.js – mehrere Dateien als eine ZIP-Datei („Alle herunterladen“ der Druckliste, Sitzung als Datei). Ohne Bibliothek: Verfahren
// „stored“ (PDFs sind schon komprimiert), Dateinamen in UTF-8 (Bit 11), CRC-32 nach ISO 3309. readZip liest solche Dateien wieder
// (auch „deflate“, falls die Datei von einem anderen Programm neu gepackt wurde).
const te = new TextEncoder(), td = new TextDecoder();
let CRC = null;
export function crc32(u8) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
/* Namen eindeutig machen: „Name.pdf“, „Name (2).pdf“ … */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((n) => {
    let k = n, i = 1;
    while (seen.has(k.toLowerCase())) { i++; k = n.replace(/(\.[^.]+)?$/, (ext) => " (" + i + ")" + (ext || "")); }
    seen.set(k.toLowerCase(), true);
    return k;
  });
}
/* entries = [{ name, data: Uint8Array }] → Uint8Array der ZIP-Datei */
/* Pfad in der ZIP-Datei: „/“ trennt Ordner; nie absolut, nie „..“ (sonst landeten Dateien beim Entpacken außerhalb des Ordners) */
export const zipPath = (n) => String(n).replace(/\\/g, "/").split("/").map((p) => p.trim()).filter((p) => p && p !== "." && p !== "..").join("/") || "Datei";
export function makeZip(entries, when = new Date()) {
  const names = uniqueNames(entries.map((e) => zipPath(e.name)));
  const parts = [], central = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const name = te.encode(names[i]), data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime(when), true); local.setUint16(12, dosDate(when), true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime(when), true); cd.setUint16(14, dosDate(when), true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = central.reduce((n, x) => n + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
/* ZIP lesen → [{ name, data }] (Verzeichnisse übersprungen); prüft die CRC */
export async function readZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("Das ist keine ZIP-Datei.");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Die ZIP-Datei ist beschädigt.");
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else throw new Error("Diese ZIP-Datei nutzt ein unbekanntes Verfahren.");
    if (crc32(data) !== crc) throw new Error("Die ZIP-Datei ist beschädigt (Prüfsumme von „" + name + "“).");
    out.push({ name, data });
  }
  return out;
}
