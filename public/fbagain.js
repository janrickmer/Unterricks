// fbagain.js – Feibeitsblatt aus einer früheren Sitzung wieder gebraucht (Nachtrag 45 der Lehrkraft vom 23.11.2026): In der Schüleransicht steht ein
// Feibeitsblatt, das auch mit einer früheren Sitzung desselben Kurses verknüpft ist (Server: again, worker/lessons.js SHEETS_AGAIN_SQL), unter „Material“
// mit einem Feld für die Zwischenstand-PDF, dem Knopf „Im Feibeitsblatt weiterarbeiten“, klein dem Code und dem kleinen Knopf „Von vorn beginnen“.
// Übergabe der PDF nach dem Protokoll v1 (mit Feibeitsblatt abgestimmt, Repository janrickmer/Feibeitsblatt): nur von Tab zu Tab auf demselben Gerät per
// postMessage, nie über einen Server – Unterricks hält die Datei nur im Arbeitsspeicher, bis sie übergeben ist bzw. die Seite verlassen wird.
//   1. Datei wählen (≤ 5 MB wie PDF_MAX_BYTES im Feibeitsblatt, beginnt mit „%PDF-“) → erst dann der Knopf (das Öffnen eines Tabs muss direkt im Klick passieren)
//   2. Klick → window.open(<Feibeitsblatt>#von-unterricks, "_blank") OHNE noopener (das Feibeitsblatt braucht window.opener)
//   3. das Feibeitsblatt meldet {kind: "feibeitsblatt-bereit", v: 1} – nur von seiner Herkunft und aus genau diesem Tab angenommen
//   4. Unterricks schickt GENAU EINMAL {kind: "unterricks-zwischenstand", v: 1, name, pdf: ArrayBuffer} (übertragen, nicht kopiert); ohne Bereitschaft binnen
//      10 s (älteres Feibeitsblatt ohne Übergabe) ruhig die Anleitung zum eigenen Hochladen – kommt sie später doch, wird noch übergeben
//   5. Antwort {kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok, grund?} → „Dein Zwischenstand ist im Feibeitsblatt geöffnet.“ bzw. die Anleitung
import { h, clear, toast, copyText, fmtBytes, icon } from "./ui.js";
import { formatCode } from "./shared.js";

export const FB_AGAIN = {
  hash: "von-unterricks", ready: "feibeitsblatt-bereit", send: "unterricks-zwischenstand", ack: "feibeitsblatt-zwischenstand-angekommen", v: 1,
  maxBytes: 5 * 1024 * 1024,   // = PDF_MAX_BYTES im Feibeitsblatt
  readyMs: 10000,              // so lange wartet Unterricks auf die Bereitschaft, dann die Anleitung
  listenMs: 120000,            // so lange nimmt es eine verspätete Bereitschaft bzw. Antwort noch an
  nameMax: 200,
};
export const AGAIN_TEXT = {
  badge: "Wieder gebraucht",
  meta: "Feibeitsblatt aus einer früheren Sitzung",
  intro: "Dieses Feibeitsblatt kennst du schon aus einer früheren Sitzung. Mach mit deinem Zwischenstand weiter: Wähle die Zwischenstand-PDF aus, die du im Feibeitsblatt gespeichert hast.",
  pick: "Zwischenstand-PDF auswählen",
  repick: "Andere Datei wählen",
  go: "Im Feibeitsblatt weiterarbeiten",
  restart: "Von vorn beginnen",
  restartHint: " – Code kopieren und Feibeitsblatt ohne Zwischenstand öffnen",
  code: "Feibeitsblatt-Code ",
  tooBig: "Diese Datei ist größer als 5 MB – das ist keine Zwischenstand-PDF. Wähle die PDF-Datei, die du im Feibeitsblatt gespeichert hast.",
  notPdf: "Das ist keine PDF-Datei. Wähle die Zwischenstand-PDF, die du im Feibeitsblatt gespeichert hast.",
  unreadable: "Die Datei ließ sich nicht lesen. Versuch es noch einmal.",
  opening: "Das Feibeitsblatt öffnet sich in einem neuen Tab …",
  sending: "Dein Zwischenstand wird ans Feibeitsblatt übergeben …",
  ok: "Dein Zwischenstand ist im Feibeitsblatt geöffnet.",
  fallback: "Tippe im Feibeitsblatt auf „Zwischenstand-PDF hochladen“ und wähle deine PDF-Datei.",
  blocked: "Dein Browser hat den neuen Tab blockiert. Erlaube Pop-ups für Unterricks und tippe noch einmal auf „Im Feibeitsblatt weiterarbeiten“.",
};

/* gewählte Datei prüfen: size (Bytes), head (die ersten Bytes) → Meldung oder "" (passt) */
export function draftPdfIssue(size, head) {
  if (!(size > 0) || size > FB_AGAIN.maxBytes) return size > FB_AGAIN.maxBytes ? AGAIN_TEXT.tooBig : AGAIN_TEXT.notPdf;
  const b = head instanceof Uint8Array ? head : new Uint8Array(head || []);
  return b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d ? "" : AGAIN_TEXT.notPdf;   // „%PDF-“
}
/* Adresse des Feibeitsblatts mit der Marke für die Übergabe → {href, origin} bzw. null (keine gültige http(s)-Adresse) */
export function handoverTarget(url) {
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; u.hash = FB_AGAIN.hash; return { href: u.href, origin: u.origin }; } catch { return null; }
}

/* Übergabe starten – nur direkt im Klick aufrufen (sonst blockiert der Browser den neuen Tab). onStatus(state): "blocked" (kein Tab, nichts übergeben),
   "opening", "sending", "ok", "fallback" (keine Bereitschaft binnen readyMs bzw. ok:false). → {stop()} bzw. null (blockiert / ungültige Adresse) */
export function fbHandover({ url, name, buf, win = window, onStatus = () => {}, readyMs = FB_AGAIN.readyMs, listenMs = FB_AGAIN.listenMs }) {
  const t = handoverTarget(url);
  if (!t) { onStatus("blocked"); return null; }
  const w = win.open(t.href, "_blank");   // ohne noopener: das Feibeitsblatt antwortet über window.opener
  if (!w) { onStatus("blocked"); return null; }
  let sent = false, over = false, readyT = null, endT = null;
  const stop = () => { over = true; clearTimeout(readyT); clearTimeout(endT); win.removeEventListener("message", onMsg); };
  function onMsg(e) {
    if (over || !e || e.origin !== t.origin || e.source !== w) return;
    const d = e.data;
    if (!d || typeof d !== "object" || d.v !== FB_AGAIN.v) return;
    if (d.kind === FB_AGAIN.ready && !sent) {
      sent = true; clearTimeout(readyT);
      try { w.postMessage({ kind: FB_AGAIN.send, v: FB_AGAIN.v, name: String(name || "Zwischenstand.pdf").slice(0, FB_AGAIN.nameMax), pdf: buf }, t.origin, [buf]); onStatus("sending"); }
      catch { stop(); onStatus("fallback"); }
    } else if (d.kind === FB_AGAIN.ack && sent) {
      stop(); onStatus(d.ok === true ? "ok" : "fallback", typeof d.grund === "string" ? d.grund : "");
    }
  }
  win.addEventListener("message", onMsg);
  onStatus("opening");
  readyT = setTimeout(() => { if (!sent && !over) onStatus("fallback"); }, readyMs);
  endT = setTimeout(stop, listenMs);
  return { stop, sent: () => sent };
}

/* Zeile des wieder gebrauchten Feibeitsblatts in der Schüleransicht (statt „Code kopieren und Feibeitsblatt öffnen“). s = {code, title}, url = Adresse des
   Feibeitsblatts, leave(fn) = beim Verlassen der Seite (Übergabe beenden, Datei vergessen). → Element (class item fbagain) */
export function fbAgainItem(s, url, { leave = () => {}, win = window } = {}) {
  const uid = "fba-" + s.code, code = formatCode(s.code);
  let file = null, run = null;   // file = {name, size, buf}: nur im Arbeitsspeicher
  // klares Feld zum Wählen: das Dateifeld liegt unsichtbar im Feld (Tastatur: Tab, dann Enter bzw. Leertaste öffnet die Auswahl; Ablegen per Ziehen geht auch)
  const input = h("input", { type: "file", id: uid + "-f", class: "fba-file", accept: "application/pdf,.pdf" });
  const pickText = h("span", { class: "fba-picktext", text: AGAIN_TEXT.pick });
  const pick = h("label", { class: "fba-pick" }, input, icon("upload"), pickText);
  const err = h("p", { class: "err fba-err", role: "alert", id: uid + "-e" });
  // tabindex -1: verschwindet „Im Feibeitsblatt weiterarbeiten“ mit dem Fokus darauf (übergeben), bekommt die Statuszeile darunter den Fokus
  const status = h("p", { class: "fba-status", role: "status", "aria-live": "polite", id: uid + "-s", tabindex: "-1" });
  const go = h("button", { class: "btn primary fba-go", type: "button", hidden: true, "aria-describedby": uid + "-s" }, icon("arrow"), AGAIN_TEXT.go);
  input.setAttribute("aria-describedby", uid + "-i " + uid + "-e");
  const say = (state) => {
    status.textContent = AGAIN_TEXT[state] || "";
    status.classList.toggle("ok", state === "ok");
  };
  const forget = () => { if (run) { run.stop(); run = null; } file = null; };
  const showFile = () => {
    clear(pickText).append(file ? AGAIN_TEXT.repick : AGAIN_TEXT.pick);
    pick.classList.toggle("has", !!file);
    clear(chosen);
    if (file) chosen.append(icon("check"), h("span", { text: file.name }), h("span", { class: "muted", text: " · " + fmtBytes(file.size) }));
    const had = !file && document.activeElement === go;
    go.hidden = !file;
    if (had) status.focus();   // der Fokus geht nicht verloren (Nachtrag 25)
  };
  const chosen = h("p", { class: "fba-chosen" });
  async function take(f) {
    err.textContent = ""; say("");
    if (run) { run.stop(); run = null; }
    file = null; showFile();
    if (!f) return;
    const size = Number(f.size) || 0;
    if (size > FB_AGAIN.maxBytes || size <= 0) { err.textContent = draftPdfIssue(size, null); return; }
    let buf;
    try { buf = await f.arrayBuffer(); } catch { err.textContent = AGAIN_TEXT.unreadable; return; }
    const issue = draftPdfIssue(buf.byteLength, new Uint8Array(buf, 0, Math.min(8, buf.byteLength)));
    if (issue) { err.textContent = issue; return; }
    file = { name: String(f.name || "Zwischenstand.pdf"), size: buf.byteLength, buf };
    showFile();
  }
  input.addEventListener("change", () => { const f = input.files && input.files[0]; input.value = ""; take(f); });
  pick.addEventListener("dragover", (e) => { e.preventDefault(); pick.classList.add("over"); });
  pick.addEventListener("dragleave", () => pick.classList.remove("over"));
  pick.addEventListener("drop", (e) => { e.preventDefault(); pick.classList.remove("over"); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) take(f); });
  go.addEventListener("click", () => {
    if (!file) return;
    if (run) { run.stop(); run = null; }
    const f = file;
    run = fbHandover({ url, name: f.name, buf: f.buf, win, onStatus: (state) => {
      say(state);
      // übergeben (die Bytes gehören jetzt dem Feibeitsblatt): Datei vergessen, für einen neuen Versuch wieder wählen
      if (state === "sending" && file === f) { file = null; showFile(); }
    } });
  });
  leave(forget);
  const restart = h("button", { class: "btn ghost small fba-restart", type: "button", onclick: async () => {
    // wie „Code kopieren und Feibeitsblatt öffnen“: Code in die Zwischenablage, das Feibeitsblatt in einem neuen Tab (dort den Code einsetzen). Der Tab geht
    // direkt im Klick auf (iPad-Safari blockiert ihn nach einem await) – das Kopieren beginnt davor und wird danach abgewartet
    const copied = copyText(code);
    win.open(url, "_blank", "noopener");
    const ok = await copied;
    toast(ok ? "Code " + code + " kopiert – füge ihn im Feibeitsblatt ein." : "Bitte den Code " + code + " im Feibeitsblatt eintippen.", "ok", 6000);
  } }, AGAIN_TEXT.restart, h("span", { class: "sr-only", text: AGAIN_TEXT.restartHint }));
  return h("div", { class: "item fbagain", role: "group", "aria-labelledby": uid + "-t" }, h("div", { class: "ficon fb", "aria-hidden": "true", text: "FB" }),
    h("div", { class: "main" },
      h("div", { class: "name", id: uid + "-t", text: s.title }),
      h("div", { class: "meta" }, h("span", { class: "badge again", text: AGAIN_TEXT.badge }), " " + AGAIN_TEXT.meta),
      h("p", { class: "fba-intro", id: uid + "-i", text: AGAIN_TEXT.intro }),
      pick, chosen, err, go, status,
      h("div", { class: "fba-foot" }, h("span", { class: "fba-code" }, AGAIN_TEXT.code, h("span", { class: "mono", text: code })), restart)));
}
