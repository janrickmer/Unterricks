// storagefoot.js – Fußzeile der Lehrkräfteansicht (Nachtrag 30): wie viel Prozent des Speichers von Unterricks belegt ist. Gezeigt wird der knappere
// der beiden Werte – Dateien (R2, Grenze 9 GB) und Datenbank (D1, 500 MB im kostenlosen Plan) –, ein Klick auf „Speicher: n % belegt“ klappt beide
// Werte auf (Antwort der Lehrkraft: „knapperer Wert + Details“). Nur auf den Seiten der Lehrkraft – nie bei Schüler:innen, Eltern oder am Beamer.
// Die Zahlen kommen von GET /api/teacher/storage (worker/files.js); dieser Tab merkt sie sich STORAGE_MEMO_MS lang, damit nicht jede Seite fragt.
import { h, clear, icon, fmtClock } from "./ui.js";

export const STORAGE_WARN = 0.8, STORAGE_DANGER = 0.95;   // ab 80 % Hinweis (Tinte mit Warnsymbol), ab 95 % rot – „fast voll“
export const STORAGE_MEMO_MS = 60e3;    // so lange zeigt jede Seite dieses Tabs den gemerkten Stand (der Server merkt ihn sich bis zu 5 Minuten)
export const STORAGE_FRESH_MS = 10e3;   // Aufklappen fragt neu, wenn der Stand älter ist (der Server rechnet dann auch neu)
const NB = "\u00a0";   // geschütztes Leerzeichen zwischen Zahl und Einheit bzw. Prozentzeichen

const fmtNum = (x, frac) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: frac, minimumFractionDigits: 0 }).format(x);
/* Menge in einer Einheit: unter 10 mit einer Nachkommastelle, sonst ganzzahlig; etwas mehr als nichts nie als „0“ */
const amount = (x) => (x > 0 && x < 0.1 ? fmtNum(0.1, 1) : fmtNum(x, x < 10 ? 1 : 0));
/* „1,1 von 9 GB“ bzw. „350 MB von 9 GB“; base = 1024 (Dateien: die Grenze ist 9 · 1024³ Byte) oder 1000 (Datenbank: 500 000 000 Byte) */
export function amountText(used, limit, base) {
  const M = base ** 2, G = base ** 3;
  const big = limit >= G, lim = big ? fmtNum(limit / G, 1) + NB + "GB" : fmtNum(limit / M, 0) + NB + "MB";
  const u = Math.max(0, Number(used) || 0);
  if (big && u >= 1000 * M) return amount(u / G) + " von " + lim;   // ab 1000 MB in GB
  if (!big) return amount(u / M) + " von " + lim;
  return amount(u / M) + NB + "MB von " + lim;
}
/* Anteil als Text: 0 → „0 %“, etwas mehr als nichts → „unter 1 %“, sonst abgerundet (die Farbe richtet sich nach demselben Wert) */
export function pctText(r) {
  if (!(r > 0)) return "0" + NB + "%";
  if (r < 0.01) return "unter 1" + NB + "%";
  return Math.floor(r * 100 + 1e-9) + NB + "%";
}
const ratioOf = (x) => (x && Number.isFinite(x.used) && x.used >= 0 && x.limit > 0 ? x.used / x.limit : null);

/* Stand des Servers → was die Fußzeile zeigt: {ratio, level ok|warn|danger, label, files, db, tight files|db, note} */
export function storageView(d) {
  const rf = ratioOf(d && d.files) ?? 0, rd = ratioOf(d && d.db);
  const tight = rd !== null && rd > rf ? "db" : "files", ratio = Math.max(rf, rd ?? 0);
  const r = ratio + 1e-9;   // dieselbe Toleranz wie beim Abrunden in pctText: 95 % angezeigt heißt auch „fast voll“
  const level = r >= STORAGE_DANGER ? "danger" : r >= STORAGE_WARN ? "warn" : "ok", full = r >= 1;
  const label = "Speicher: " + pctText(ratio) + " belegt" + (full ? " – voll" : level === "danger" ? " – fast voll" : "");
  const files = "Dateien: " + amountText(d.files.used, d.files.limit, 1024);
  const db = "Datenbank: " + (rd === null ? "Größe gerade nicht abrufbar" : amountText(d.db.used, d.db.limit, 1000));
  const what = tight === "db" ? "alte Sitzungen oder Einheiten" : "Dateien oder Sitzungen";
  let note = "";
  if (full) note = tight === "db" ? "Die Datenbank ist voll: Neues lässt sich erst wieder speichern, wenn Sie alte Sitzungen oder Einheiten löschen."
    : "Der Speicher für Dateien ist voll: Neue Dateien lassen sich erst wieder hochladen, wenn Sie alte Dateien oder Sitzungen löschen.";
  else if (level === "danger") note = "Der Speicher ist fast voll. Bitte löschen Sie " + what + ", die Sie nicht mehr brauchen – sonst " +
    (tight === "db" ? "lässt sich bald nichts mehr speichern." : "lassen sich bald keine Dateien mehr hochladen.");
  else if (level === "warn") note = "Der Speicher wird knapp. Löschen Sie bei Gelegenheit " + what + ", die Sie nicht mehr brauchen.";
  return { ratio, level, label, files, db, tight, note };
}
export const STORAGE_EXPLAIN = "Zu den Dateien zählen Material, Präsentationen, Bildkarten, PDFs der Planungsgrundlagen und Podcasts, zur Datenbank " +
  "Sitzungen, Einheiten, Texte und Chats. Mit diesen Grenzen bleibt Unterricks im kostenlosen Angebot von Cloudflare.";

/* ---------- Stand im Tab merken: eine Anfrage für alle Seiten, die in STORAGE_MEMO_MS gezeichnet werden ---------- */
let memo = null, inflight = null, gen = 0;   // memo = {got: tick(), data}; gen steigt beim Abmelden (späte Antworten zählen dann nicht)
// Alter des gemerkten Stands mit der gleichmäßigen Uhr der Seite (performance.now) – eine verstellte Uhr des Geräts hält ihn nicht fest
const tick = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
const younger = (ms) => { if (!memo) return false; const age = tick() - memo.got; return age >= 0 && age < ms; };
export function resetStorageMemo() { memo = null; inflight = null; gen++; }
function usage(load, fresh) {
  const g = gen;
  if (!fresh && younger(STORAGE_MEMO_MS)) return Promise.resolve(memo.data);
  if (inflight && (!fresh || inflight.fresh)) return inflight.p;
  const p = Promise.resolve().then(() => load(fresh)).then((d) => { if (g === gen) memo = { got: tick(), data: d }; return d; })
    .finally(() => { if (inflight && inflight.p === p) inflight = null; });
  inflight = { p, fresh };
  return p;
}

/* Fußzeile für jede Seite der Lehrkraft: load(fresh) liefert den Stand des Servers (teacher.js: GET /api/teacher/storage[?fresh=1]). Bis er da ist,
   bleibt die Fußzeile leer; scheitert die Anfrage, bleibt sie still leer (die nächste Seite fragt erneut). Den Fokus setzt sie nie. */
export function storageFoot(load) {
  const label = h("span", { class: "sf-label" });
  const fill = h("span", { class: "sf-fill" });
  const btn = h("button", { type: "button", class: "sf-btn", id: "storage-btn", "aria-expanded": "false", "aria-controls": "storage-more", hidden: true },
    h("span", { class: "sf-ico" }), label, h("span", { class: "sf-bar", "aria-hidden": "true" }, fill), icon("chev"));
  const vals = h("p", { class: "sf-vals" }), note = h("p", { class: "sf-note hidden" }), expl = h("p", { class: "sf-expl small muted" });
  const more = h("div", { class: "sf-more", id: "storage-more", hidden: true }, vals, note, expl);
  const box = h("div", { class: "sf", dataset: { level: "ok" } }, btn, more);
  const foot = h("footer", { class: "footer tfoot" }, box);
  let shown = null;
  function paint(d) {
    const v = storageView(d);
    shown = v;
    box.dataset.level = v.level;
    label.textContent = v.label;
    clear(btn.firstChild).append(icon(v.level === "ok" ? "database" : "alert"));
    fill.style.width = Math.min(100, Math.max(v.ratio > 0 ? 2 : 0, v.ratio * 100)) + "%";
    clear(vals).append(h("span", { class: "sf-v", text: v.files }), h("span", { class: "sf-sep", text: " · " }), h("span", { class: "sf-v", text: v.db }));   // am Handy untereinander
    note.textContent = v.note; note.className = "sf-note" + (v.note ? (v.level === "warn" ? " warnc" : " err") : " hidden");
    expl.textContent = STORAGE_EXPLAIN + (Number.isFinite(d.at) ? " Stand: " + fmtClock(d.at) + " Uhr." : "");
    btn.hidden = false;
  }
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    more.hidden = !open;
    // aufgeklappt: einen älteren Stand neu holen (z. B. gleich nach dem Löschen von Dateien) – die Werte ändern sich an Ort und Stelle
    if (open && !younger(STORAGE_FRESH_MS)) usage(load, true).then(paint).catch(() => {});
  });
  usage(load, false).then(paint).catch(() => {});   // auch eine unbrauchbare Antwort lässt die Fußzeile nur leer
  foot._view = () => shown;   // für Tests
  return foot;
}
