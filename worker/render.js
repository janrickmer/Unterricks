// render.js – von Claude gestaltetes Material (HTML) als PDF drucken (Wunsch der Lehrkraft vom 11.11.2026: Claude entwickelt Arbeitsblätter
// und alle PDFs, Unterricks druckt nur). Druck mit Cloudflare Browser Run (Quick Action „pdf“ über die Bindung BROWSER, kostenlos bis
// 10 Minuten Browserzeit am Tag, höchstens 1 Auftrag je 10 s). Unterricks ändert nichts an der Gestaltung: Es sperrt nur JavaScript und
// jeden Netzzugriff (Bilder und Schriften nur eingebettet) und stellt die Unterricks-Schrift bereit. In Tests: RENDER_MOCK_URL.
import { HttpError, bad, json } from "./lib.js";

export const HTML_MAX = 1_500_000;   // Zeichen – Platz für eingebettete Grafiken (SVG, data:-Bilder)
export const PDF_MAX = 20 * 1024 * 1024;
export const PAGES_MAX = 40;
export const PDF_FONT = "Atkinson Hyperlegible Next";

/* Lange data:-Adressen (eingebettete Bilder) finden – mit indexOf und einem verankerten Ausdruck nur über die Base64-Zeichen: Ausdrücke
   über das ganze HTML kosten bei 1,5 MB sonst mehr Rechenzeit, als der Free-Plan erlaubt (10 ms je Anfrage) */
const B64_RUN = /[A-Za-z0-9+\/=]*/y, DATA_HEAD = /^data:[a-z0-9.+\/-]+(?:;[a-z0-9=.+-]+)*;base64,$/i;
export function dataRanges(s, min = 1500) {
  const out = [];
  for (let i = s.indexOf("data:"); i >= 0; i = s.indexOf("data:", i)) {
    const b = s.indexOf(";base64,", i);
    if (b < 0) break;
    // nur eine schlichte Medienangabe zwischen „data:“ und „;base64,“ (sonst ließe sich hier Text an der Prüfung vorbeischleusen)
    if (b - i > 120 || !DATA_HEAD.test(s.slice(i, b + 8))) { i += 5; continue; }
    B64_RUN.lastIndex = b + 8; B64_RUN.exec(s);
    const end = B64_RUN.lastIndex;
    if (end - i >= min) out.push([i, end]);
    i = Math.max(end, i + 5);
  }
  return out;
}
const cutRanges = (s, ranges, token) => {
  if (!ranges.length) return s;
  let o = "", p = 0;
  ranges.forEach(([a, z], k) => { o += s.slice(p, a) + token(k); p = z; });
  return o + s.slice(p);
};

/* HTML von Claude annehmen: nur Gestaltung – Skripte, Ereignis-Attribute, eingebettete fremde Seiten und Weiterleitungen fallen weg (zusätzlich
   zum abgeschalteten JavaScript beim Druck, siehe pdfRequest; Netzzugriffe sind gesperrt). Ein Bruchstück wird zu einer ganzen Seite. */
export function cleanDesignHtml(raw) {
  let s = typeof raw === "string" ? raw.replace(/\u0000/g, "") : "";
  if (s.length > HTML_MAX) throw bad("Das Material ist zu groß (höchstens " + HTML_MAX.toLocaleString("de-DE") + " Zeichen HTML). Bitte Grafiken einfacher halten oder auf mehrere Materialien aufteilen.");
  s = s.trim();
  // Bilder für die Prüfung beiseitelegen (Platzhalter mit NUL – kommt im HTML sonst nicht mehr vor) und danach wieder einsetzen
  const ranges = dataRanges(s), imgs = ranges.map(([a, z]) => s.slice(a, z));
  s = cutRanges(s, ranges, (k) => "\u0000" + k + "\u0000");
  if (!s || !/<[a-z!]/i.test(s)) throw bad("Bitte das Material als HTML-Seite übergeben (mit <style> für die Gestaltung).");
  // so lange wiederholt, bis sich nichts mehr ändert („<scr<script>ipt>“ setzt sich sonst nach dem Entfernen neu zusammen); je Tag auch
  // mehrere Ereignis-Attribute (onload …, auch nach „/“ wie in „<svg/onload=…>“) und javascript:-Adressen
  for (let i = 0, prev = ""; i < 30 && prev !== s; i++) {
    prev = s;
    s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<\/?script\b[^>]*>/gi, "")
      .replace(/<\/?(iframe|object|embed|frame|frameset|portal|applet)\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "").replace(/<base\b[^>]*>/gi, "")
      .replace(/(<[a-z][^>]*?)[\s\/]+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "$1").replace(/((?:href|src|action|xlink:href|formaction)\s*=\s*["']?)\s*javascript:/gi, "$1#");
  }
  if (!/<html[\s>]/i.test(s)) s = '<!doctype html><html lang="de"><head><meta charset="utf-8"></head><body>' + s + "</body></html>";
  return imgs.length ? s.replace(/\u0000(\d+)\u0000/g, (m, k) => imgs[Number(k)] || "") : s;
}

/* Grundeinstellungen VOR Claudes eigener Gestaltung (Claudes Regeln gehen also vor): A4 mit Rändern, die Unterricks-Schrift, Farben
   wie am Bildschirm. Steht ganz vorn im <head>, damit die Schrift schon beim ersten Aufbau da ist. */
export const BASE_CSS = "@page{size:A4;margin:16mm 16mm 18mm}" +
  "html{-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
  "body{margin:0;font-family:'" + PDF_FONT + "','DejaVu Sans','Liberation Sans',sans-serif;font-size:11.5pt;line-height:1.45;color:#111}" +
  "code,pre,kbd{font-family:'Atkinson Hyperlegible Mono','DejaVu Sans Mono',monospace}";
export function printableHtml(html, fonts = "") {
  const css = '<meta charset="utf-8"><style id="unterricks-base">' + fonts + "\n" + BASE_CSS + "</style>";
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (m) => m + css);
  return html.replace(/<html\b[^>]*>/i, (m) => m + "<head>" + css + "</head>");
}

/* Auftrag an den Drucker: A4 (eine @page-Regel von Claude geht vor, auch Querformat), Hintergründe mitdrucken, JavaScript aus, jede
   Anfrage ins Netz abgewiesen (nur data:-Adressen). Skripte und Ereignis-Attribute entfernt cleanDesignHtml vorher. */
export function pdfRequest(html, fonts = "", js = false) {
  return {
    html: printableHtml(html, fonts),
    ...(js ? {} : { setJavaScriptEnabled: false }),   // Feld der Browser-Run-API; lehnt der Drucker es ab, druckt renderPdf ohne (s. u.)
    rejectRequestPattern: ["^https?:", "^wss?:", "^ftp:", "^file:"],
    gotoOptions: { waitUntil: "load", timeout: 30000 },
    pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true, timeout: 60000 },
  };
}

/* @font-face der Unterricks-Schrift (Atkinson Hyperlegible Next, auch kursiv; Mono) als data:-Adressen – einmal je Isolate aus den
   statischen Dateien; fehlt etwas, druckt der Browser mit seinen eigenen Schriften */
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";
// wie in styles.css: Teilschriften nach Zeichenbereich (Zeichen außerhalb, z. B. Griechisch oder Hebräisch, nimmt der Drucker aus DejaVu)
const FONT_FILES = [
  ["atkinson-hyperlegible-next-latin-wght-normal.woff2", PDF_FONT, "normal", LATIN],
  ["atkinson-hyperlegible-next-latin-ext-wght-normal.woff2", PDF_FONT, "normal", LATIN_EXT],
  ["atkinson-hyperlegible-next-latin-wght-italic.woff2", PDF_FONT, "italic", LATIN],
  ["atkinson-hyperlegible-mono-latin-wght-normal.woff2", "Atkinson Hyperlegible Mono", "normal", ""],
];
let fontCssP = null;
function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fontCss(env) {
  if (!env.ASSETS) return Promise.resolve("");
  if (!fontCssP) fontCssP = (async () => {
    const parts = [];
    for (const [file, family, style, range] of FONT_FILES) {
      try {
        const r = await env.ASSETS.fetch(new Request("https://assets.invalid/fonts/" + file));
        if (!r.ok) continue;
        parts.push("@font-face{font-family:'" + family + "';font-style:" + style + ";font-weight:200 800;font-display:block;src:url(data:font/woff2;base64," + b64(new Uint8Array(await r.arrayBuffer())) + ") format('woff2')" + (range ? ";unicode-range:" + range : "") + ";}");
      } catch {}
    }
    return parts.join("\n");
  })().catch(() => { fontCssP = null; return ""; });
  return fontCssP;
}

/* Seitenzahl einer PDF: größtes „/Count n“ (Wurzel des Seitenbaums) – mit der eingebauten Bytesuche, ohne die Datei als Text zu lesen
   (wenig Rechenzeit: der Free-Plan erlaubt 10 ms je Anfrage) */
export function pdfPageCount(u8) {
  const C = [67, 111, 117, 110, 116];   // „Count“
  let best = 0;
  for (let i = u8.indexOf(47); i >= 0 && i < u8.length - 8; i = u8.indexOf(47, i + 1)) {
    if (u8[i + 1] !== C[0] || u8[i + 2] !== C[1] || u8[i + 3] !== C[2] || u8[i + 4] !== C[3] || u8[i + 5] !== C[4]) continue;
    let j = i + 6; while (u8[j] === 32 || u8[j] === 10 || u8[j] === 13) j++;
    let n = 0, d = 0; while (u8[j] >= 48 && u8[j] <= 57 && d < 6) { n = n * 10 + u8[j] - 48; j++; d++; }
    if (d && n > best) best = n;
  }
  return best || null;
}

/* Klartext der Gestaltung (für die KI-Hilfe im Planungschat und die Übersicht): ohne Stil, eingebettete Bilder und Tags */
export function htmlText(html, max = 20000) {
  const h = String(html || "");
  return cutRanges(h, dataRanges(h, 200), () => "").replace(/<(style|script|head|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/table|\/section|hr)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t ]+/g, " ").replace(/ *\n[ \n]*/g, "\n").trim().slice(0, max);
}

/* Eingebettete Bilder (lange data:-Adressen) für Claude kürzen: Beim Lesen stehen dort Platzhalter „data:unterricks-bild,<k>“; schickt
   Claude die Gestaltung geändert zurück, setzt keepImages die Bilder der bisherigen Fassung wieder ein (Claude muss sie nicht abschreiben) */
export function shortImages(html) {
  const h = String(html || "");
  return cutRanges(h, dataRanges(h), (k) => "data:unterricks-bild," + (k + 1));
}
export function keepImages(html, oldHtml) {
  const h = String(html || "");
  if (!h.includes("data:unterricks-bild,")) return h;
  const o = String(oldHtml || ""), old = dataRanges(o).map(([a, z]) => o.slice(a, z));
  return h.replace(/data:unterricks-bild,(\d+)/g, (m, n) => old[Number(n) - 1] || m);
}

/* Fehler beim Drucken: busy (gleich erneut versuchen, retryAfter in s), quota (Tageskontingent), config (nicht eingerichtet), failed */
export class RenderError extends HttpError {
  constructor(code, message, retryAfter = null) {
    super(code === "config" ? 503 : code === "failed" ? 422 : code === "quota" ? 503 : 429, "render_" + code, message, retryAfter ? { retryAfter } : {});
    this.renderCode = code; this.retryAfter = retryAfter;
  }
}
const QUOTA_TEXT = "Das kostenlose Tageskontingent des PDF-Druckers (10 Minuten Browserzeit bei Cloudflare) ist für heute aufgebraucht – ab 1 Uhr nachts (Winterzeit; Sommerzeit 2 Uhr) druckt Unterricks wieder.";
export const RENDER_GAP_MS = 10500;   // Cloudflare Free: 1 Auftrag je 10 s (für das ganze Konto)
const gapOf = (env) => (env && env.RENDER_GAP_MS !== undefined && Number.isFinite(Number(env.RENDER_GAP_MS)) ? Math.max(0, Number(env.RENDER_GAP_MS)) : RENDER_GAP_MS);
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const nextUtcMidnight = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let jsFieldRejected = false;   // je Instanz: der Drucker lehnte setJavaScriptEnabled ab

/* Platz in der Warteschlange: der nächste freie Zeitpunkt für einen Auftrag (atomar, auch über mehrere Instanzen) – nur, wenn er
   höchstens maxWait entfernt ist; sonst null und wann es wieder geht */
export async function reserveSlot(db, now, gap, maxWait) {
  const r = await db.prepare("INSERT INTO render_gate(k, until) VALUES('slot', ?1 + ?2) ON CONFLICT(k) DO UPDATE SET until = MAX(render_gate.until, ?1) + ?2 " +
    "WHERE MAX(render_gate.until, ?1) - ?1 <= ?3 RETURNING until - ?2 AS start").bind(now, gap, maxWait).first();
  if (r) return { start: Number(r.start) };
  const g = await db.prepare("SELECT until FROM render_gate WHERE k='slot'").first();
  return { start: null, retryAt: g ? Number(g.until) : now + gap };
}
export async function quotaUntil(db, now) {
  const q = await db.prepare("SELECT until FROM render_gate WHERE k='quota'").first();
  return q && Number(q.until) > now ? Number(q.until) : null;
}
export async function renderUsage(db, now) {
  const r = await db.prepare("SELECT ms, n FROM render_usage WHERE day=?1").bind(utcDay(now)).first();
  return { day: utcDay(now), ms: r ? Number(r.ms) || 0 : 0, n: r ? Number(r.n) || 0 : 0, limitMs: 600000, quotaUntil: await quotaUntil(db, now) };
}

async function callPrinter(env, body) {
  const mock = String((env && env.RENDER_MOCK_URL) || "");
  if (mock) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(mock)) throw new RenderError("config", "RENDER_MOCK_URL ist nur für lokale Tests gedacht.");
    return fetch(mock, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  if (env && env.BROWSER && typeof env.BROWSER.quickAction === "function") return env.BROWSER.quickAction("pdf", body);
  throw new RenderError("config", "Der PDF-Druck ist auf dem Server nicht eingerichtet (Cloudflare Browser Run fehlt in der Konfiguration).");
}

/* HTML → {bytes, pages, ms}. c = {db, env}; wartet höchstens waitMs auf einen freien Platz beim Drucker (sonst busy mit retryAfter) */
export async function renderPdf(c, html, { waitMs = 25000 } = {}) {
  const db = c.db, env = c.env;
  const now0 = Date.now(), q = await quotaUntil(db, now0);
  if (q) throw new RenderError("quota", QUOTA_TEXT);
  const fonts = await fontCss(env);
  let body = pdfRequest(html, fonts, jsFieldRejected);
  const gap = gapOf(env), deadline = now0 + waitMs;
  for (let attempt = 1; ; attempt++) {
    const now = Date.now();
    const slot = await reserveSlot(db, now, gap, Math.max(0, deadline - now));
    if (slot.start === null) throw new RenderError("busy", "Der PDF-Drucker ist gerade ausgelastet (mehrere Materialien warten).", Math.max(5, Math.ceil((slot.retryAt - now) / 1000)));
    if (slot.start > now) await sleep(slot.start - now);
    let r;
    const t0 = Date.now();
    try {
      const res = await callPrinter(env, body);
      r = res instanceof Response ? res : new Response(res);
    } catch (e) {
      if (e instanceof RenderError) throw e;
      // die Bindung wirft statt einer Antwort: lokal ohne Cloudflare („does not implement the method“), sonst Fehlertext mit Code
      const m = String((e && e.message) || e || "").slice(0, 300);
      if (/does not implement|run remotely|not supported in local/i.test(m)) throw new RenderError("config", "Der PDF-Druck läuft nur auf dem Cloudflare-Server (lokal fehlt Browser Run).");
      const code = Number((/\b(4\d\d|5\d\d)\b/.exec(m) || [])[1]) || 503;
      r = new Response(m, { status: code });
    }
    // Browserzeit: die Antwort der Bindung nennt sie nicht (X-Browser-Ms-Used fehlt dort) – dann zählt die gemessene Dauer als Schätzung
    const used = Number(r.headers.get("x-browser-ms-used")) || (r.ok ? Date.now() - t0 : 0);
    if (used || r.ok) { try { await db.prepare("INSERT INTO render_usage(day, ms, n) VALUES(?1, ?2, ?3) ON CONFLICT(day) DO UPDATE SET ms = ms + ?2, n = n + ?3").bind(utcDay(Date.now()), used, r.ok ? 1 : 0).run(); } catch {} }
    if (r.ok) {
      const u8 = new Uint8Array(await r.arrayBuffer());
      if (u8.length < 5 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4]) !== "%PDF-") throw new RenderError("failed", "Der PDF-Drucker hat keine PDF-Datei geliefert.");
      if (u8.length > PDF_MAX) throw new RenderError("failed", "Die PDF-Datei wäre größer als 20 MB. Bitte Grafiken einfacher halten (z. B. SVG statt großer Fotos).");
      const pages = pdfPageCount(u8);
      if (pages && pages > PAGES_MAX) throw new RenderError("failed", "Die PDF hätte " + pages + " Seiten – höchstens " + PAGES_MAX + " Seiten je Material. Bitte aufteilen oder kürzen.");
      return { bytes: u8, pages, ms: used || null };
    }
    const text = (await r.text().catch(() => "")).slice(0, 400);
    if (r.status === 429 && /time limit|browser time|for today/i.test(text)) {
      try { await db.prepare("INSERT INTO render_gate(k, until) VALUES('quota', ?1) ON CONFLICT(k) DO UPDATE SET until = MAX(render_gate.until, ?1)").bind(nextUtcMidnight(Date.now())).run(); } catch {}
      throw new RenderError("quota", QUOTA_TEXT);
    }
    const left = deadline - Date.now();
    if (r.status === 429) {
      if (attempt < 4 && left > gap) continue;   // die Warteschlange gibt den nächsten Platz
      throw new RenderError("busy", "Der PDF-Drucker ist gerade ausgelastet.", 15);
    }
    if (r.status >= 500 || r.status === 408) {
      if (attempt < 2 && left > gap + 5000) continue;
      throw new RenderError("busy", "Der PDF-Drucker hat gerade nicht geantwortet (Fehler " + r.status + ").", 20);
    }
    // kennt der Drucker das Feld setJavaScriptEnabled nicht, ohne es erneut (Skripte und Ereignis-Attribute hat cleanDesignHtml entfernt)
    if (r.status === 400 && !jsFieldRejected && /setJavaScriptEnabled|unrecognized|unknown key|additional propert/i.test(text)) { jsFieldRejected = true; body = pdfRequest(html, fonts, true); continue; }
    throw new RenderError("failed", "Der PDF-Drucker hat das Material abgelehnt (Fehler " + r.status + (text ? ": " + text.replace(/\s+/g, " ").slice(0, 200) : "") + ").");
  }
}

/* ---------- Prüfung nach dem Ausrollen: druckt eine feste Testseite (Umlaute, Griechisch, Hebräisch, SVG, Tabelle, Schreiblinien) ----------
 * Öffentlich, aber höchstens einmal je Stunde wirklich gedruckt (sonst die Auskunft, wann es wieder geht) – so verbraucht sie kaum
 * Browserzeit. ?pdf=1 liefert die PDF selbst. */
export const HEALTH_HTML = '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Unterricks – Testseite</title><style>' +
  "@page{size:A4;margin:18mm}h1{font-size:20pt;margin:0 0 4mm}.kopf{display:flex;gap:6mm;border-bottom:1.5pt solid #222;padding-bottom:2mm;margin-bottom:5mm;font-size:10pt}" +
  ".kopf span{flex:1;border-bottom:.6pt solid #888;padding-bottom:5mm}table{border-collapse:collapse;width:100%;margin:4mm 0}td,th{border:.6pt solid #444;padding:2mm 3mm;text-align:left}" +
  ".linien{height:40mm;background:repeating-linear-gradient(transparent 0 9.4mm,#999 9.4mm 9.6mm)}.k{font-style:italic}</style></head><body>" +
  '<div class="kopf"><span>Name:</span><span>Klasse:</span><span>Datum:</span></div><h1>Testseite: „Größe“ – Übung macht den Meister</h1>' +
  "<p>Umlaute und ß: ÄÖÜ äöü ß · Anführungszeichen „deutsch“ und »französisch« · Gedankenstrich – und Ellipse … · <b>fett</b> · <span class=\"k\">kursiv</span></p>" +
  "<p>Griechisch: Ἐν ἀρχῇ ἦν ὁ λόγος (αβγδ) · Hebräisch: בְּרֵאשִׁית בָּרָא · Polnisch: Łódź · Türkisch: İstanbul, ğ, ş</p>" +
  '<svg width="120" height="60" viewBox="0 0 120 60" role="img" aria-label="Waage"><line x1="10" y1="40" x2="110" y2="20" stroke="#222" stroke-width="3"/><polygon points="60,30 50,55 70,55" fill="#2557c7"/></svg>' +
  "<table><tr><th>Pro</th><th>Contra</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table><p><b>Aufgabe 1</b> (AFB II): Erkläre …</p><div class=\"linien\"></div></body></html>";
export async function routeHealthPdf(c) {
  const wantPdf = new URL(c.request.url).searchParams.get("pdf") === "1";
  const now = Date.now();
  const lock = await c.db.prepare("INSERT INTO render_gate(k, until) VALUES('health', ?1) ON CONFLICT(k) DO UPDATE SET until = ?1 WHERE render_gate.until <= ?2 RETURNING until")
    .bind(now + 3600e3, now).first();
  if (!lock) {
    const g = await c.db.prepare("SELECT until FROM render_gate WHERE k='health'").first();
    return json({ ok: true, skipped: true, nextAt: g ? Number(g.until) : null, usage: await renderUsage(c.db, now) }, 200, { "Cache-Control": "no-store" });
  }
  const t0 = Date.now();
  try {
    const r = await renderPdf(c, HEALTH_HTML, { waitMs: 25000 });
    if (wantPdf) return new Response(r.bytes, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "Content-Disposition": 'inline; filename="unterricks-testseite.pdf"' } });
    return json({ ok: true, pages: r.pages, bytes: r.bytes.length, browserMs: r.ms, ms: Date.now() - t0, fonts: (await fontCss(c.env)).length > 1000 }, 200, { "Cache-Control": "no-store" });
  } catch (e) {
    try { await c.db.prepare("UPDATE render_gate SET until=?1 WHERE k='health'").bind(Date.now() + 300e3).run(); } catch {}   // nach einem Fehler früher erneut prüfbar
    return json({ ok: false, code: e.code || "error", error: e.message || String(e) }, e.status || 500, { "Cache-Control": "no-store" });
  }
}
/* Verbrauch des PDF-Druckers heute (für die Lehrkraft, siehe files.js) */
export const printerConfigured = (env) => !!(env && (env.RENDER_MOCK_URL || (env.BROWSER && typeof env.BROWSER.quickAction === "function")));
