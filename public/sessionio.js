// sessionio.js – Unterrickssitzung als Datei zusammenstellen und in eine Sitzung übernehmen, ohne dass deren Seite offen sein muss:
// für die Sitzungsseite („Sitzung als Datei“), die Einheit als Datei und die große Sicherung (backup.js). Format: sessionfile.js.
import { apiUrl, upload } from "./ui.js";
import { T, tapi } from "./teacher.js";
import { formatCode, GS_SUBJECT } from "./shared.js";
import { SESSION_FILE, sessionFileName, sheetToDraft, cleanSessionFile, adaptDates } from "./sessionfile.js";
import { makeZip, readZip } from "./zip.js";

const te = new TextEncoder();
export const safeName = (n) => String(n || "Datei").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Datei";

/* bei Netzfehlern und Fehlern des Servers (5xx, 429) bis zu tries-mal mit Pause wiederholen – nicht bei Ablehnungen (4xx) */
export async function retry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const st = e && typeof e.status === "number" ? e.status : 0;
      if (i >= tries || (st >= 400 && st < 500 && st !== 429)) throw e;
      await new Promise((r) => setTimeout(r, 800 * i * i));
    }
  }
}
/* Bytes einer Datei (kind "file") über einen kurz gültigen, signierten Link */
export async function fetchFileBytes(f) {
  return retry(async () => {
    const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} });
    const res = await fetch(apiUrl(r.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) { const e = new Error("„" + f.name + "“ ließ sich nicht laden (Fehler " + res.status + ")."); e.status = res.status >= 500 ? res.status : 0; throw e; }
    return new Uint8Array(await res.arrayBuffer());
  });
}

/* detail = Antwort von GET /api/teacher/lessons/:id; homework/portal: Stand der offenen Seite (sonst der gespeicherte).
   full: für die Sicherung – auch das Archiv einer Vertretung (ursprüngliche Planung, Dateien unter „archiv/“), der Vertretungsplan selbst
   und noch nicht fertig verarbeitete Präsentationen; eine Datei, die sich nicht laden lässt, fehlt dann (missing) statt abzubrechen.
   cancelled() bricht vor jeder Datei ab. → {name, bytes (ZIP), files, notes, missing} */
/* Bildkarten (Grundschule): Erzähltexte und Freigabe für Eltern kommen mit in die Sitzungsdatei */
const cardsOf = (f) => (f.cards ? { cards: { texts: Array.isArray(f.cards.texts) ? f.cards.texts : [], share: !!f.cards.share } } : {});
export async function buildSessionZip(detail, { fb = T.fb, onStep = () => {}, homework, portal, full = false, cancelled = () => false, fileName } = {}) {
  const L = detail.lesson, unit = detail.unit || null;
  const rows = unit ? unit.rows || [] : [], idx = rows.findIndex((r) => r.uid === L.unitRow);
  const entries = [], files = [], drafts = [], notes = [], missing = [], archived = [];
  let k = 0, a = 0;
  const grab = async (f) => {
    if (cancelled()) { const e = new Error("Abgebrochen."); e.cancelled = true; throw e; }
    onStep("Lade „" + f.name + "“ …");
    try { return await fetchFileBytes(f); }
    catch (e) { if (!full) throw e; missing.push("„" + f.name + "“: " + e.message); return null; }
  };
  const grabHtml = async (f) => {
    if (cancelled()) { const e = new Error("Abgebrochen."); e.cancelled = true; throw e; }
    try { return (await retry(() => tapi("GET", "/api/teacher/files/" + f.id + "/html"))).html; }
    catch (e) { if (!full) throw e; missing.push("„" + f.name + "“ (Gestaltung): " + e.message); return null; }
  };
  let g = 0;
  for (const f of detail.files || []) {
    if (f.source === "notfall") continue;   // Notfall-Feibeitsblätter entstehen neu
    // von Claude gestaltet: die HTML-Gestaltung als eigene Datei (lässt sich auch im Browser öffnen), die PDF nur, wenn sie zur Gestaltung passt
    if (f.design && f.area !== "archive" && f.area !== "presentation") {
      const html = await grabHtml(f);
      if (html == null) continue;
      const design = "gestaltung/" + (++g) + " - " + safeName(f.name.replace(/\.pdf$/i, "")) + ".html";
      entries.push({ name: design, data: te.encode(html) });
      const base = { area: f.area, kind: "file", name: f.name, mime: "application/pdf", design, ...(f.print ? { print: f.print } : {}), ...cardsOf(f) };
      if (f.status === "ready" && !f.design.outdated) {
        const data = await grab(f);
        if (data) { const path = "dateien/" + (++k) + " - " + safeName(f.name); entries.push({ name: path, data }); files.push({ ...base, path, rendered: true }); continue; }
      }
      files.push(base);
      continue;
    }
    const base = { area: f.area, kind: f.kind, name: f.name, mime: f.mime, ...(f.print ? { print: f.print } : {}), ...cardsOf(f) };
    if (f.area === "archive") {   // ursprüngliches Material einer vertretenen Sitzung – nur in der Sicherung
      if (!full) continue;
      if (f.kind === "text") archived.push({ kind: "text", name: f.name, text: f.text || "" });
      else if (f.kind === "link") archived.push({ kind: "link", name: f.name, url: f.url });
      else { const data = await grab(f); if (!data) continue; const path = "archiv/" + (++a) + " - " + safeName(f.name); entries.push({ name: path, data }); archived.push({ kind: "file", name: f.name, mime: f.mime, path }); }
      continue;
    }
    if (f.status !== "ready" && !(full && f.area === "presentation" && f.kind === "file")) {
      if (full) missing.push("„" + f.name + "“: noch nicht fertig hochgeladen");
      continue;
    }
    if (f.kind === "text") files.push({ ...base, text: f.text || "" });
    else if (f.kind === "link") files.push({ ...base, url: f.url });
    else {
      const data = await grab(f);
      if (!data) continue;
      const path = "dateien/" + (++k) + " - " + safeName(f.name);
      entries.push({ name: path, data }); files.push({ ...base, path });
    }
  }
  for (const d of detail.drafts || []) if (d.status === "draft" && d.data) drafts.push(d.data);
  const sheets = [];
  for (const s of detail.sheets || []) {
    if (s.kind === "escape") { notes.push("Escape-Room mit dem Feibeitsblatt „" + s.title + "“ (" + formatCode(s.code) + "): nicht in der Datei – ein Escape-Room lässt sich nicht übernehmen."); continue; }
    sheets.push({ code: s.code, title: s.title });
    if (!fb || !fb.connected) { notes.push("Feibeitsblatt „" + s.title + "“ (" + formatCode(s.code) + "): nur der Code – ohne Verbindung zum Feibeitsblatt ließ sich der Inhalt nicht mitnehmen."); continue; }
    try { onStep("Lade das Feibeitsblatt „" + s.title + "“ …"); const c = sheetToDraft((await fb.getSheet(s.code)).sheet); if (c.draft) drafts.push(c.draft); notes.push(...c.notes.map((x) => "„" + s.title + "“: " + x)); }
    catch (e) { notes.push("Feibeitsblatt „" + s.title + "“ (" + formatCode(s.code) + "): Inhalt nicht geladen – " + e.message); }
  }
  const data = { kind: SESSION_FILE.kind, v: SESSION_FILE.v, exportedAt: Date.now(),
    source: { subject: L.subject, klass: L.klass, unitTitle: unit ? unit.title || "" : "", sessionNo: idx >= 0 ? idx + 1 : null, date: L.date, nextDate: L.nextDate || null,
      startTime: L.startTime || null, durationMin: L.durationMin || null, title: L.title },
    lesson: { title: L.title, topic: L.topic, ideas: L.ideas || "", homework: homework !== undefined ? homework : L.homework || "", portal: portal !== undefined ? portal : L.portal || "" },
    chat: (detail.messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && m.model !== "begruessung").map((m) => ({ role: m.role, content: m.content, model: m.model || null, mode: m.mode || null })),
    files, drafts, sheets, notes };
  // Grundschule: Inhalt und Hinweis für die Eltern, Ausfall-Eintrag (nie der Elternlink); am Gymnasium bleibt die Datei, wie sie war
  if (L.subject === GS_SUBJECT) {
    Object.assign(data.lesson, { parentSummary: L.parentSummary || "", parentNote: L.parentNote || "" });
    if (L.cancelled) data.source.cancelled = true;
  }
  const sub = detail.substitute;
  if (full && sub) {
    // Vertretung: der Plan selbst und – nach dem Bestätigen – die ursprüngliche Planung der Lehrkraft (Schulportal, Hausaufgabe, Feibeitsblätter, Material)
    data.substitute = { status: sub.status, proposal: sub.proposal || null, confirmedAt: sub.confirmedAt || null };
    if (sub.archive) {
      data.archive = { portal: sub.archive.portal || "", homework: sub.archive.homework || "", sheets: sub.archive.sheets || [], files: archived, at: sub.archive.at || null };
      notes.push("Diese Sitzung wurde vertreten: Die ursprüngliche Planung (Schulportal-Eintrag, Hausaufgabe, Feibeitsblätter, Material) steht in dieser Datei unter „archive“ in sitzung.json und im Ordner „archiv/“.");
    }
  }
  entries.unshift({ name: SESSION_FILE.json, data: te.encode(JSON.stringify(data, null, 1)) });
  const name = fileName || sessionFileName({ subject: L.subject, klass: L.klass, unitTitle: data.source.unitTitle, sessionNo: data.source.sessionNo });
  return { name, bytes: makeZip(entries), files: files.length, notes, missing };
}

/* Sitzungsdatei lesen → {data (geprüft), byPath}; sitzung.json liegt oben in der Datei */
export async function readSessionZip(bytes) {
  let entries;
  try { entries = await readZip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch { throw new Error("Diese Datei ist keine Unterrickssitzung (keine ZIP-Datei)."); }
  const j = entries.find((x) => x.name === SESSION_FILE.json);
  if (!j) throw new Error("In dieser Datei steckt keine Unterrickssitzung.");
  let raw; try { raw = JSON.parse(new TextDecoder().decode(j.data)); } catch { throw new Error("Die Unterrickssitzung in dieser Datei ist beschädigt."); }
  return { data: cleanSessionFile(raw), byPath: new Map(entries.map((x) => [x.name, x.data])) };
}

/* Was in die Zielsitzung kommt: Datumsangaben der Texte auf deren Datum und nächste Sitzung angepasst (target = lesson mit date, nextDate) */
export function planSessionImport(data, target) {
  const src = data.source;
  const pairs = [[src.date, target.date], [src.nextDate, target.nextDate]].filter(([a, b]) => a && b && a !== b);
  const replaced = [], unknown = [];
  const fix = (t, where) => { const r = adaptDates(t, pairs); replaced.push(...r.replaced); unknown.push(...r.unknown.map((u) => where + ": „" + u + "“")); return r.text; };
  const lesson = { title: data.lesson.title, topic: data.lesson.topic, ideas: fix(data.lesson.ideas, "Ideen und Wünsche"), homework: fix(data.lesson.homework, "Hausaufgabe"), portal: fix(data.lesson.portal, "Schulportal-Eintrag") };
  const texts = [], links = [], prints = [], bins = [];
  for (const f of data.files) {
    if (f.kind === "link") links.push({ area: f.area, title: f.name, url: f.url });
    else if (f.kind === "text" && f.area === "print") prints.push({ title: f.name, text: fix(f.text, "„" + f.name + "“"), ...f.print });
    else if (f.kind === "text") texts.push({ area: f.area, title: f.name, text: fix(f.text, "„" + f.name + "“") });
    else bins.push(f);
  }
  return { lesson, texts, links, prints, bins, pres: bins.find((f) => f.area === "presentation") || null, pairs, replaced, unknown };
}

/* Präsentation in eine Sitzung hochladen und in Folienbilder umwandeln (ohne Sitzungsseite) */
export async function uploadPresentationTo(lessonId, file, { code, exclude = [], onProgress } = {}) {
  const r = await upload("/api/teacher/lessons/" + lessonId + "/presentation?name=" + encodeURIComponent(file.name), file, T.token, null, "application/pdf");
  const { rasterizeAndUpload } = await import("./presenter.js");
  return rasterizeAndUpload(file, r.file.id, T.token, onProgress, { code, exclude });
}

/* In die Sitzung lessonId übernehmen: Texte, Chat, Links, Druck-Texte, Entwürfe in einem Aufruf, danach jede Datei einzeln.
   uploadPres(file, sheetCodes) = eigene Übernahme der Präsentation (Sitzungsseite); sonst uploadPresentationTo mit target.code.
   → {missing} (Dateien, die fehlen oder sich nicht hochladen ließen) */
export async function applySessionImport(lessonId, plan, data, byPath, { onStep = () => {}, uploadPres = null, target = null } = {}) {
  onStep("Übernehme Planung, Texte und Entwürfe …");
  await tapi("POST", "/api/teacher/lessons/" + lessonId + "/import", { body: { lesson: plan.lesson, chat: data.chat, texts: plan.texts, links: plan.links, prints: plan.prints, drafts: data.drafts } });
  const missing = [], sheetCodes = data.sheets.map((s) => s.code);
  for (const f of plan.bins) {
    // von Claude gestaltet: mit gedruckter PDF hochladen und die Gestaltung anhängen, sonst nur die Gestaltung (die Sitzungsseite druckt sie)
    const html = f.design && byPath.get(f.design) ? new TextDecoder().decode(byPath.get(f.design)) : null;
    if (html !== null && (!f.path || !byPath.get(f.path))) {
      onStep("Übernehme „" + f.name + "“ (Gestaltung) …");
      try { await retry(() => tapi("POST", "/api/teacher/lessons/" + lessonId + "/designs", { body: { area: f.area, title: f.name, html, print: f.print || {}, source: "uebernommen" } })); }
      catch (e) { missing.push(f.name + " (" + e.message + ")"); }
      continue;
    }
    const bytes = byPath.get(f.path);
    if (!bytes) { missing.push(f.name); continue; }
    onStep("Lade „" + f.name + "“ hoch …");
    try {
      if (html !== null) {
        const r = f.area === "print"
          ? await upload("/api/teacher/lessons/" + lessonId + "/print?name=" + encodeURIComponent(f.name) + "&copies=" + f.print.copies + "&duplex=" + (f.print.duplex ? 1 : 0) + "&color=" + (f.print.color ? 1 : 0) + "&source=uebernommen", new Blob([bytes], { type: "application/pdf" }), T.token, null, "application/pdf")
          : await upload("/api/teacher/lessons/" + lessonId + "/files?area=" + f.area + "&name=" + encodeURIComponent(f.name) + "&source=uebernommen", new Blob([bytes], { type: "application/pdf" }), T.token, null, "application/pdf");
        await retry(() => tapi("PATCH", "/api/teacher/files/" + r.file.id, { body: { html, rendered: f.rendered === true } }));
        continue;
      }
      if (f.area === "presentation") {
        const file = new File([bytes], f.name, { type: "application/pdf" });
        if (uploadPres) await uploadPres(file, sheetCodes);
        else await uploadPresentationTo(lessonId, file, { code: target && target.code, exclude: sheetCodes, onProgress: (i, n) => onStep("„" + f.name + "“: Folie " + i + " von " + n + " …") });
      } else if (f.area === "print") await upload("/api/teacher/lessons/" + lessonId + "/print?name=" + encodeURIComponent(f.name) + "&copies=" + f.print.copies + "&duplex=" + (f.print.duplex ? 1 : 0) + "&color=" + (f.print.color ? 1 : 0) + "&source=uebernommen", new Blob([bytes], { type: "application/pdf" }), T.token, null, "application/pdf");
      else await upload("/api/teacher/lessons/" + lessonId + "/files?area=" + f.area + "&name=" + encodeURIComponent(f.name) + "&source=uebernommen", new Blob([bytes], { type: f.mime || "application/octet-stream" }), T.token, null, f.mime || "application/octet-stream");
    } catch (e) { missing.push(f.name + " (" + e.message + ")"); }
  }
  return { missing };
}
