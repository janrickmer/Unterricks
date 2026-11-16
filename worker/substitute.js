// substitute.js – Selbstlern-Phase (Nachtrag 29 der Lehrkraft vom 15.11.2026; ersetzt die Krankheitsvertretung ganz) und das Lesen älterer Vertretungen.
// Selbstlern-Phase: Claude stellt eine Sitzung nach der ausdrücklichen Zustimmung der Lehrkraft im Chat mit save_selbstlern in einem Schritt um
// (saveSelbstlern) – die ursprüngliche Planung (Schulportal-Eintrag, Hausaufgabe, Material, Feibeitsblätter) wird archiviert, die Stationen, der neue
// Schulportal-Eintrag und die Hausaufgabe (von Anfang an sichtbar) gelten. „Wiederherstellen“ holt die ursprüngliche Planung zurück und löscht das
// Material der Selbstlern-Phase (source 'selbstlern'). Gespeichert wird in substitutes mit status 'selbstlern' (proposal = Daten der Selbstlern-Phase,
// archive = ursprüngliche Planung) – so gelten Löschen der Sitzung, Zurücksetzen und „leere Sitzung“ unverändert.
// Ältere Vertretungen bleiben lesbar: 'vorschlag' (nicht mehr bestätigbar, nur verwerfen) und 'aktiv' (Wiederherstellen, Übernehmen, Escape-Room).
import { HttpError, bad, json, readJson, randomId, isId, cleanText } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { requireAccess } from "./student.js";
import { normalizeEscapeRoom } from "../public/escape-data.js";
import { getLesson, savePortal, LIMITS, nextTeacherLessonDate } from "./lessons.js";
import { fileKey, checkStorage, deleteNotfallFiles, deleteFileObjects } from "./files.js";
import { isAnalogClass, subjectName, classShort, GS_SUBJECT, normalizeFbDraft, formatCode, fmtDay, TEACHER_SUMMARY_TITLE } from "../public/shared.js";
import { SELBSTLERN, SELBSTLERN_INTRO, SELBSTLERN_INTRO_ANALOG, normalizeSelbstlern, readSelbstlern, stationLabel, selbstlernHomework, fmtVideoStart } from "../public/selbstlern.js";

export const ESCAPE_ROOMS_AVAILABLE = true;   // Escape-Room-Vorlage der Plattform (public/escape.js, Finale im Feibeitsblatt)
const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
// Grundschule: keine Selbstlern-Phase – bei Krankheit verschiebt Unterricks die Stunden (Wunsch der Lehrkraft vom 12.11.2026)
export const GS_NO_SELBSTLERN = "In der Grundschule gibt es keine Selbstlern-Phase – bei Krankheit verschiebt Unterricks die Stunden; danach überarbeitest du die Einheit.";
// das alte Werkzeug: in älteren Chats womöglich noch aufgerufen – klare Meldung statt „unbekanntes Werkzeug“
export const OLD_TOOL_TEXT = "Die Krankheitsvertretung gibt es nicht mehr: Kann die Lehrkraft nicht da sein, baust du die Sitzung nach ihrer ausdrücklichen Zustimmung mit save_selbstlern in eine Selbstlern-Phase um " +
  "(Stationen, Schulportal-Eintrag, Hausaufgabe). Rufe zuerst get_lesson auf. Den vollständigen Ablauf liefert in der Sitzung der Knopf „Präsenz der Lehrkraft nicht möglich – Unterricht in Selbstlern-Phase umbauen“ als Prompt.";
const OLD_ACTIVE = "Für diese Sitzung ist noch eine ältere Vertretung aktiv. Die Lehrkraft stellt in der Sitzung zuerst die ursprüngliche Planung wieder her – danach kannst du die Selbstlern-Phase speichern.";
// Stände, an denen die Lehrkraft nicht unterrichtet (Podcast, Gegenstände, Hausaufgabe bis zur nächsten Sitzung mit ihr)
export const ABSENT_STATES = ["aktiv", SELBSTLERN];
export const isAbsent = (status) => ABSENT_STATES.includes(status);
export async function getSubstitute(db, lessonId) {
  return db.prepare("SELECT * FROM substitutes WHERE lesson_id=?1").bind(lessonId).first();
}

/* ======================= Selbstlern-Phase speichern (Connector: save_selbstlern) =======================
 * Erstes Speichern: archiviert die ursprüngliche Planung – alle Dateien für Schüler:innen, nur für die Lehrkraft und der Druckliste außer dem Material
 * der Selbstlern-Phase (source 'selbstlern'), den Dateien, auf die eine Station oder „material“ verweist, und den Anmerkungs-PDFs der Präsentation; die
 * Feibeitsblätter, auf die keine Station verweist, samt Notfall-Feibeitsblatt; Schulportal-Eintrag und Hausaufgabe. Erneutes Speichern (idempotent)
 * ersetzt nur die Selbstlern-Phase: das Archiv bleibt; ursprüngliches Material, auf das jetzt eine Station verweist, kehrt aus dem Archiv zurück,
 * ursprüngliches, auf das keine Station mehr verweist, geht ins Archiv. Alles in einer Anweisungsfolge (db.batch) – nie halb umgestellt. */
export async function saveSelbstlern(c, lessonId, raw) {
  const db = c.db, now = c.now, l = await getLesson(db, lessonId);
  if (l.subject === GS_SUBJECT) throw bad(GS_NO_SELBSTLERN, "not_gs");
  const analog = isAnalogClass(l.klass);
  const { data, errors } = normalizeSelbstlern(raw, { analog });
  const cur = await getSubstitute(db, lessonId);
  if (cur && cur.status === "aktiv") throw new HttpError(409, "active", OLD_ACTIVE);
  const was = cur && cur.status === SELBSTLERN ? parseJ(cur.proposal, {}) : null, first = !was;
  const archive = first ? null : parseJ(cur.archive, {});
  if (first && !data.schulportal) errors.push("schulportal: Beim Umstellen gehört der neue Schulportal-Eintrag der Selbstlern-Phase dazu (Schulportal-Zeichen; die Schüler:innen öffnen die Sitzung mit ihrem Code und bearbeiten die Stationen).");
  const [fr, sr, dr] = await db.batch([
    db.prepare("SELECT id, area, kind, name, mime, source, fb_code, notes_of, cards, status FROM files WHERE lesson_id=?1").bind(lessonId),
    db.prepare("SELECT code, title, kind FROM fb_sheets WHERE lesson_id=?1").bind(lessonId),
    db.prepare("SELECT id, status, sheet_code, source FROM fb_drafts WHERE lesson_id=?1").bind(lessonId),
  ]);
  const files = fr.results || [], byId = new Map(files.map((f) => [f.id, f])), linked = sr.results || [], drafts = new Map((dr.results || []).map((d) => [d.id, d]));
  const archived = new Map(((archive && archive.files) || []).map((x) => [x.id, x.area]));   // ursprüngliches Material im Archiv → sein Bereich
  const areaOf = (f) => (f.area === "archive" ? archived.get(f.id) || null : f.area);
  const where = (s) => "Station " + s.nr + " („" + s.titel + "“)";
  for (const s of data.stationen) {
    if (s.fileId) {
      const f = byId.get(s.fileId), area = f ? areaOf(f) : null;
      if (!f || !area) errors.push(where(s) + ": file_id " + s.fileId + " gehört zu keinem Material dieser Sitzung (siehe get_lesson).");
      else if (f.cards != null || area === "presentation") errors.push(where(s) + ": „" + f.name + "“ " + (area === "presentation" ? "ist die Präsentation für den Unterricht mit Lehrkraft – gestalte eine selbsterklärende Präsentation mit add_material_pdf (bereich \"schueler\", selbstlern: true)." : "lässt sich nicht als Station verwenden."));
      else if (s.typ === "praesentation" && (area !== "student" || f.kind !== "file" || f.mime !== "application/pdf")) errors.push(where(s) + ": Die Präsentation ist eine PDF für die Schüler:innen – lege sie mit add_material_pdf an (bereich \"schueler\", selbstlern: true).");
      else if (s.typ === "material" && area === "teacher") errors.push(where(s) + ": „" + f.name + "“ liegt nur bei der Lehrkraft – die Schüler:innen sähen es nicht. Lege es mit add_material_pdf (bereich \"" + (analog ? "druck" : "schueler") + "\", selbstlern: true) an.");
      else if (s.typ === "material" && analog && area !== "print" && !(f.kind === "file" && f.mime === "application/pdf")) errors.push(where(s) + ": In Jg. 5/6 bekommen die Schüler:innen alles auf Papier – lege das Arbeitsblatt mit add_material_pdf (bereich \"druck\", selbstlern: true) an.");
    }
    if (s.draftId && !drafts.has(s.draftId)) errors.push(where(s) + ": entwurf_id " + s.draftId + " gehört zu keinem Feibeitsblatt-Entwurf dieser Sitzung (propose_feibeitsblatt bzw. get_lesson).");
  }
  for (const id of data.material) { const f = byId.get(id); if (!f || !areaOf(f) || f.cards != null) errors.push("material: file_id " + id + " gehört zu keinem Material dieser Sitzung (siehe get_lesson)."); }
  // Escape-Room: streng prüfen; schon angelegtes Finale behält seine Kennung (der Tunnel prüft sie im Feibeitsblatt)
  const es = data.stationen.find((s) => s.escape), prevEsc = was && was.escapeDraftId ? drafts.get(was.escapeDraftId) || null : null;
  let room = null;
  if (es && raw && Array.isArray(raw.stationen) && raw.stationen[es.nr - 1] && raw.stationen[es.nr - 1].escape_room) {
    const oldId = prevEsc && was.escape_room && typeof was.escape_room.id === "string" ? was.escape_room.id : null;
    try { room = normalizeEscapeRoom(raw.stationen[es.nr - 1].escape_room, { id: oldId || "unterricks-" + lessonId.slice(0, 8) + "-" + randomId(3), fach: subjectName(l.subject), klasse: classShort(l.klass) }); }
    catch (e) { errors.push(where(es) + ": " + e.message); }
  }
  if (errors.length) throw bad("Die Selbstlern-Phase ist noch nicht gespeichert – bitte korrigieren:\n- " + errors.slice(0, 30).join("\n- "), "selbstlern_invalid");

  // Feibeitsblätter: ursprüngliche (beim ersten Speichern alle verknüpften außer denen aus Entwürfen dieser Selbstlern-Phase) und die, die bleiben
  const draftCode = (id) => { const d = drafts.get(id); return d && d.status === "created" && d.sheet_code ? d.sheet_code : null; };
  const ownCodes = new Set([...data.stationen.map((s) => (s.draftId ? draftCode(s.draftId) : null)), prevEsc ? draftCode(prevEsc.id) : null].filter(Boolean));
  const origSheets = first ? linked.filter((s) => !ownCodes.has(s.code)).map((s) => ({ code: s.code, title: s.title, kind: s.kind || "" })) : (archive.sheets || []);
  const origCodes = new Set(origSheets.map((s) => s.code));
  const codeStations = data.stationen.filter((s) => s.code).map((s) => s.code);
  const keepCodes = new Set([...codeStations, ...ownCodes]);
  const linkedCodes = new Set(linked.map((s) => s.code));
  const unlink = linked.filter((s) => !keepCodes.has(s.code)).map((s) => s.code);
  const dropOwn = unlink.filter((code) => !origCodes.has(code));   // Blätter einer früheren Fassung dieser Selbstlern-Phase: Verknüpfung und Notfall-PDF weg
  const relink = codeStations.filter((code) => !linkedCodes.has(code));
  // Dateien: ins Archiv bzw. aus dem Archiv zurück
  const keep = new Set([...data.stationen.filter((s) => s.fileId).map((s) => s.fileId), ...data.material]);
  const toArchive = files.filter((f) => ["student", "teacher", "print"].includes(f.area) && f.source !== SELBSTLERN && !f.notes_of && !keep.has(f.id) &&
    !(f.source === "notfall" && (keepCodes.has(f.fb_code) || (!first && !origCodes.has(f.fb_code)))));
  const toRestore = files.filter((f) => f.area === "archive" && archived.has(f.id) && (keep.has(f.id) || (f.source === "notfall" && keepCodes.has(f.fb_code))));
  const archiveRec = first ? { portal: l.portal || "", portalSource: l.portal_source || "", homework: l.homework || "", files: [], sheets: origSheets, at: now } : { ...archive, files: [...(archive.files || [])] };
  archiveRec.files = archiveRec.files.filter((x) => !toRestore.some((f) => f.id === x.id)).concat(toArchive.map((f) => ({ id: f.id, area: f.area })));

  // gespeicherte Daten: Stationen mit Kennung (für den Erklär-Chatbot), Escape-Room samt Entwurf seines Finales
  const homeworkDate = await nextTeacherLessonDate(db, l);
  const hausaufgabe = data.hausaufgabe || selbstlernHomework(homeworkDate, analog);
  let escapeDraftId = null, escData = null;
  const stmts = [];
  if (room) {
    escData = normalizeFbDraft({ title: room.feibeitsblatt.titel, tasks: room.feibeitsblatt.aufgaben, escape: { id: room.id, name: room.name } }, { fromAi: true });
    if (prevEsc && prevEsc.status === "created") escapeDraftId = prevEsc.id;   // Finale schon angelegt: bleibt, wie es ist
    else if (prevEsc) { escapeDraftId = prevEsc.id; stmts.push(db.prepare("UPDATE fb_drafts SET data=?2, updated_at=?3 WHERE id=?1 AND status='draft'").bind(prevEsc.id, JSON.stringify(escData), now)); }
    else { escapeDraftId = randomId(8); stmts.push(db.prepare("INSERT INTO fb_drafts(id, lesson_id, data, source, status, created_at, updated_at) VALUES(?1, ?2, ?3, 'selbstlern', 'draft', ?4, ?4)").bind(escapeDraftId, lessonId, JSON.stringify(escData), now)); }
  }
  if (prevEsc && !room && prevEsc.status === "draft") stmts.push(db.prepare("DELETE FROM fb_drafts WHERE id=?1 AND status='draft'").bind(prevEsc.id));
  const { schulportal, ...rest } = data;
  const stored = { ...rest, hausaufgabe, stationen: data.stationen.map((s) => ({ ...s, id: randomId(4) })), escape_room: room, escapeDraftId, savedAt: now };
  if (new TextEncoder().encode(JSON.stringify(stored) + JSON.stringify(archiveRec)).length > 1_900_000) throw bad("Die Selbstlern-Phase ist zu groß (vor allem der Escape-Room). Bitte die Texte kürzen.");
  if (toArchive.length) stmts.push(db.prepare("UPDATE files SET area='archive', updated_at=?2 WHERE lesson_id=?1 AND id IN (SELECT value FROM json_each(?3))").bind(lessonId, now, JSON.stringify(toArchive.map((f) => f.id))));
  for (const area of ["student", "teacher", "print"]) {
    const ids = toRestore.filter((f) => archived.get(f.id) === area).map((f) => f.id);
    if (ids.length) stmts.push(db.prepare("UPDATE files SET area=?2, updated_at=?3 WHERE lesson_id=?1 AND area='archive' AND id IN (SELECT value FROM json_each(?4))").bind(lessonId, area, now, JSON.stringify(ids)));
  }
  if (unlink.length) stmts.push(db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1 AND code IN (SELECT value FROM json_each(?2))").bind(lessonId, JSON.stringify(unlink)));
  for (const code of [...new Set(relink)]) {
    const o = origSheets.find((s) => s.code === code), st = data.stationen.find((s) => s.code === code);
    stmts.push(db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at, kind) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(lesson_id, code) DO NOTHING")
      .bind(lessonId, code, o ? o.title : st.titel, now, o ? o.kind || "" : ""));
  }
  stmts.push(schulportal
    ? db.prepare("UPDATE lessons SET homework=?2, portal=?3, portal_version=portal_version+1, portal_updated_at=?4, portal_source='selbstlern', updated_at=?4 WHERE id=?1").bind(lessonId, cleanText(hausaufgabe, LIMITS.homework), cleanText(schulportal, LIMITS.portal), now)
    : db.prepare("UPDATE lessons SET homework=?2, updated_at=?3 WHERE id=?1").bind(lessonId, cleanText(hausaufgabe, LIMITS.homework), now));
  stmts.push(db.prepare("INSERT INTO substitutes(lesson_id, status, proposal, archive, created_at, updated_at, confirmed_at) VALUES(?1, 'selbstlern', ?2, ?3, ?4, ?4, ?4) " +
    "ON CONFLICT(lesson_id) DO UPDATE SET status='selbstlern', proposal=excluded.proposal, archive=excluded.archive, updated_at=excluded.updated_at, " +
    "confirmed_at=CASE WHEN substitutes.status='selbstlern' THEN substitutes.confirmed_at ELSE excluded.confirmed_at END").bind(lessonId, JSON.stringify(stored), JSON.stringify(archiveRec), now));
  // ein älterer, nicht bestätigter Vertretungsvorschlag geht in der Selbstlern-Phase auf (sein Feibeitsblatt-Entwurf mit ihm)
  const oldDraft = cur && cur.status === "vorschlag" ? parseJ(cur.proposal, {}).draftId : null;
  if (isId(oldDraft)) stmts.push(db.prepare("DELETE FROM fb_drafts WHERE id=?1 AND status='draft'").bind(oldDraft));
  await db.batch(stmts);
  for (const code of dropOwn) await deleteNotfallFiles(c, lessonId, code);
  return { first, stored, archiveRec, toArchive, toRestore, files, drafts, hausaufgabe, homeworkDate, analog, unlink: unlink.filter((x) => origCodes.has(x)), linked };
}

/* Antwort des Werkzeugs: was gespeichert und archiviert ist, was die Lehrkraft noch tun muss, Material ohne Station */
export function selbstlernReply(r) {
  const s = r.stored, byId = new Map(r.files.map((f) => [f.id, f]));
  const name = (id) => { const f = byId.get(id); return f ? "„" + f.name + "“" : id; };
  const st = s.stationen.map((x) => x.nr + ". " + x.titel + " (" + stationLabel(x.typ) + (x.minuten ? ", ca. " + x.minuten + " Min." : "") + ")");
  const out = ["Selbstlern-Phase " + (r.first ? "gespeichert – die Sitzung ist umgestellt" : "überarbeitet") + ": " + s.stationen.length + (s.stationen.length === 1 ? " Station" : " Stationen") + " – " + st.join("; ") + "."];
  if (r.first) out.push("Ursprüngliche Planung archiviert (für die Schüler:innen unsichtbar, „Wiederherstellen“ in der Sitzung holt sie zurück): Schulportal-Eintrag, Hausaufgabe" +
    (r.toArchive.length ? ", " + r.toArchive.length + (r.toArchive.length === 1 ? " Datei" : " Dateien") + " (" + r.toArchive.slice(0, 12).map((f) => "„" + f.name + "“").join(", ") + (r.toArchive.length > 12 ? " …" : "") + ")" : "") +
    (r.unlink.length ? ", Feibeitsblätter " + r.unlink.map(formatCode).join(", ") : "") + ".");
  else if (r.toArchive.length || r.toRestore.length) out.push("Archiv angepasst: " + [r.toArchive.length ? "ins Archiv " + r.toArchive.map((f) => "„" + f.name + "“").join(", ") : null,
    r.toRestore.length ? "zurück in die Sitzung " + r.toRestore.map((f) => "„" + f.name + "“").join(", ") : null].filter(Boolean).join("; ") + ".");
  out.push("Hausaufgabe (für die Schüler:innen von Anfang an sichtbar): „" + r.hausaufgabe + "“" + (r.homeworkDate ? " – nächste Sitzung mit der Lehrkraft: " + fmtDay(r.homeworkDate) + "." : " – eine nächste Sitzung mit der Lehrkraft ist noch nicht angelegt."));
  const pending = s.stationen.filter((x) => x.draftId && !(r.drafts.get(x.draftId) && r.drafts.get(x.draftId).status === "created"));
  if (pending.length) out.push("Noch zu tun für die Lehrkraft: " + pending.map((x) => "Station " + x.nr + " – Feibeitsblatt-Entwurf in Unterricks prüfen und anlegen").join("; ") + " (Abschnitt „Feibeitsblatt“ bzw. Karte „Selbstlern-Phase“ der Sitzung).");
  if (s.escape_room) out.push("Escape-Room „" + s.escape_room.name + "“ mit Lösungswort " + s.escape_room.wort + (r.drafts.get(s.escapeDraftId) && r.drafts.get(s.escapeDraftId).status === "created"
    ? " – das Finale-Feibeitsblatt ist schon angelegt und bleibt unverändert." : " – das Finale-Feibeitsblatt legt die Lehrkraft in Unterricks an (Karte „Selbstlern-Phase“); erst dann führt der Tunnel ins Feibeitsblatt."));
  const used = new Set([...s.stationen.filter((x) => x.fileId).map((x) => x.fileId), ...s.material]);
  const loose = r.files.filter((f) => f.source === SELBSTLERN && !used.has(f.id) && f.area !== "archive");
  if (loose.length) out.push("Achtung: Diese Selbstlern-Materialien gehören zu keiner Station und stehen nicht in material: " + loose.map((f) => "„" + f.name + "“ (file_id " + f.id + ")").join(", ") +
    " – die Schüler:innen sehen sie trotzdem. Werden sie nicht gebraucht, sage der Lehrkraft genau, welche sie in der Sitzung löschen soll (der Connector kann nichts löschen).");
  const notOwn = [...used].filter((id) => { const f = byId.get(id); return f && f.source !== SELBSTLERN; });
  if (notOwn.length) out.push("Hinweis: " + notOwn.map(name).join(", ") + (notOwn.length === 1 ? " gehört" : " gehören") + " nicht zum Material der Selbstlern-Phase (ohne selbstlern: true angelegt bzw. ursprüngliches Material) und " +
    (notOwn.length === 1 ? "bleibt" : "bleiben") + " nach „Wiederherstellen“ in der Sitzung.");
  const waiting = [...used].filter((id) => { const f = byId.get(id); return f && f.kind === "file" && f.status !== "ready"; });
  if (waiting.length) out.push("Noch nicht gedruckt: " + waiting.map(name).join(", ") + " – die Schüler:innen sehen " + (waiting.length === 1 ? "es" : "sie") + " erst nach dem Druck (Unterricks druckt nach, sobald die Lehrkraft die Sitzung öffnet).");
  out.push("Die „" + TEACHER_SUMMARY_TITLE + "“ bleibt unverändert – sie beschreibt die ursprüngliche Planung.");
  return out.join(" ");
}

/* get_lesson: Abschnitt „Selbstlern-Phase“ (Stationen samt Verweisen und Kriterien des Erklär-Chatbots, Hausaufgabe, Archiv) bzw. eine ältere Vertretung */
export function selbstlernLines(sub, files, drafts, sheets, nextDate) {
  if (!sub) return [];
  if (sub.status !== SELBSTLERN) return ["", "## Ältere Krankheitsvertretung", "Status: " + sub.status + (sub.status === "aktiv" ? " (die ursprüngliche Planung ist archiviert; bevor du eine Selbstlern-Phase speichern kannst, stellt die Lehrkraft sie in der Sitzung wieder her)" : " (nicht bestätigter Vorschlag – er lässt sich nicht mehr bestätigen; save_selbstlern ersetzt ihn)")];
  const p = readSelbstlern(sub.proposal) || { stationen: [], material: [] }, raw = parseJ(sub.proposal, {}), a = parseJ(sub.archive, {});
  const byId = new Map(files.map((f) => [f.id, f])), dById = new Map(drafts.map((d) => [d.id, d]));
  const fname = (id) => { const f = byId.get(id); return f ? "„" + f.name + "“ (file_id " + id + (f.area === "archive" ? ", archiviert" : "") + ")" : "file_id " + id + " (fehlt – gelöscht?)"; };
  const out = ["", "## Selbstlern-Phase (aktiv seit " + (sub.confirmed_at ? new Date(sub.confirmed_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) : "?") + ")",
    "Die Lehrkraft ist zu dieser Sitzung nicht da: Die Schüler:innen arbeiten die Stationen selbstständig ab. Ganz oben sehen sie: „" + (p.analog ? SELBSTLERN_INTRO_ANALOG : SELBSTLERN_INTRO) + "“" + (p.einleitung ? " Dazu deine einleitung: „" + p.einleitung + "“" : ""),
    "Stationen (überarbeiten: save_selbstlern mit allen Stationen – ersetzt die Selbstlern-Phase, das Archiv bleibt):"];
  for (const s of p.stationen) {
    out.push(s.nr + ". " + s.titel + " – typ " + s.typ + (s.minuten ? ", ca. " + s.minuten + " Min." : ""));
    if (s.fileId) out.push("   Datei: " + fname(s.fileId));
    if (s.code) out.push("   Feibeitsblatt " + formatCode(s.code));
    if (s.draftId) { const d = dById.get(s.draftId); out.push("   Feibeitsblatt-Entwurf " + s.draftId + (d ? (d.status === "created" && d.sheet_code ? " – angelegt, Code " + formatCode(d.sheet_code) : " – noch nicht angelegt (die Lehrkraft legt es in Unterricks an)") : " – fehlt (gelöscht?)")); }
    if (s.video) out.push("   YouTube-Video " + s.video.id + (s.video.start ? " ab " + fmtVideoStart(s.video.start) : ""));
    if (s.bot) out.push("   Erklären: " + s.bot.erklaeren, "   Kernpunkte: " + s.bot.kernpunkte.join(" | "), ...(s.bot.fehlvorstellungen.length ? ["   Fehlvorstellungen: " + s.bot.fehlvorstellungen.join(" | ")] : []));
    if (s.escape && raw.escape_room) { const d = dById.get(raw.escapeDraftId); out.push("   Escape-Room „" + raw.escape_room.name + "“, Lösungswort " + raw.escape_room.wort + (d && d.status === "created" && d.sheet_code ? " – Finale angelegt (Code " + formatCode(d.sheet_code) + ")" : " – das Finale-Feibeitsblatt ist noch nicht angelegt")); }
    out.push("   anleitung: " + s.anleitung.replace(/\n/g, " / "));
  }
  if (p.material.length) out.push("Weiteres Material der Selbstlern-Phase: " + p.material.map(fname).join(", "));
  if (p.hinweisAufsicht) out.push("Hinweis für die Aufsicht: " + p.hinweisAufsicht);
  out.push("Hausaufgabe (von Anfang an sichtbar) bis zur nächsten Sitzung mit der Lehrkraft" + (nextDate ? " am " + fmtDay(nextDate) : " (noch keine angelegt)") + ".");
  const arch = files.filter((f) => f.area === "archive");
  // Feibeitsblätter der ursprünglichen Planung, auf die eine Station verweist, sind nicht archiviert (die Schüler:innen sehen sie dort)
  const archSheets = (a.sheets || []).filter((x) => x && !p.stationen.some((s) => s.code === x.code));
  out.push("Archivierte ursprüngliche Planung: " + [arch.length ? arch.map((f) => "„" + f.name + "“").join(", ") : "keine Dateien", archSheets.length ? "Feibeitsblätter " + archSheets.map((s) => formatCode(s.code)).join(", ") : null,
    a.homework ? "Hausaufgabe „" + String(a.homework).slice(0, 200) + "“" : null].filter(Boolean).join("; ") + (a.portal ? "\nUrsprünglicher Schulportal-Eintrag:\n" + String(a.portal).slice(0, 6000) : ""));
  out.push("Selbstlern-Material (source selbstlern) sehen die Schüler:innen nur, solange die Sitzung eine Selbstlern-Phase ist; „Wiederherstellen“ löscht es. Lege es mit add_material_pdf und selbstlern: true an.");
  return out;
}

/* ======================= Ältere Vertretungsvorschläge: nur noch verwerfen ======================= */
export async function routeSubstituteDiscard(c, lessonId) {
  await requireTeacher(c);
  const s = await getSubstitute(c.db, lessonId);
  if (!s || s.status !== "vorschlag") throw bad("Es liegt kein offener Vorschlag vor.");
  const p = parseJ(s.proposal, {});
  await c.db.batch([
    c.db.prepare("DELETE FROM substitutes WHERE lesson_id=?1").bind(lessonId),
    ...(p.draftId ? [c.db.prepare("DELETE FROM fb_drafts WHERE id=?1 AND status='draft'").bind(p.draftId)] : []),
  ]);
  return json({ ok: true });
}

/* ======================= Wiederherstellen: zurück zur normalen Sitzung ======================= */
export async function routeSubstituteRestore(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  const s = await getSubstitute(c.db, lessonId);
  if (s && s.status === SELBSTLERN) return restoreSelbstlern(c, lessonId, s);
  if (!s || s.status !== "aktiv") throw bad("Für diese Sitzung ist keine Selbstlern-Phase bzw. Vertretung aktiv.");
  const a = parseJ(s.archive, {});
  // gestaltete Vertretungsmaterialien samt ihrer PDF in R2
  const designed = await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND source='vertretung' AND kind='file' AND html IS NOT NULL AND area<>'archive'").bind(lessonId).all();
  for (const f of designed.results || []) await deleteFileObjects(c, f);
  const stmts = [
    c.db.prepare("DELETE FROM files WHERE lesson_id=?1 AND source='vertretung' AND kind='text'").bind(lessonId),
    c.db.prepare("UPDATE lessons SET homework=?2, updated_at=?3 WHERE id=?1").bind(lessonId, a.homework || "", c.now),
    c.db.prepare("DELETE FROM substitutes WHERE lesson_id=?1").bind(lessonId),
  ];
  const back = (a0) => (a0 === "teacher" || a0 === "print" ? a0 : "student");
  for (const f of (a.files || []).slice(0, 40)) stmts.push(c.db.prepare("UPDATE files SET area=?3 WHERE id=?1 AND lesson_id=?2 AND area='archive'").bind(f.id, lessonId, back(f.area)));
  await c.db.batch(stmts);
  const curSheets = await c.db.prepare("SELECT code FROM fb_sheets WHERE lesson_id=?1").bind(lessonId).all();
  const subCodes = (curSheets.results || []).map((x) => x.code);
  const re = [c.db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1").bind(lessonId)];
  for (const sh of (a.sheets || []).slice(0, 20)) re.push(c.db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at) VALUES(?1, ?2, ?3, ?4) ON CONFLICT(lesson_id, code) DO NOTHING").bind(lessonId, sh.code, sh.title, c.now));
  await c.db.batch(re);
  await savePortal(c.db, lessonId, a.portal || "", null, "lehrkraft", Date.now());
  const removedSheets = subCodes.filter((x) => !(a.sheets || []).some((y) => y.code === x));
  for (const code of removedSheets) await deleteNotfallFiles(c, lessonId, code);   // Notfall-Feibeitsblatt der Vertretung gehört nicht mehr dazu
  return json({ ok: true, removedSheets });
}
/* Selbstlern-Phase → normale Sitzung: Material der Selbstlern-Phase löschen (R2 in einem Aufruf, Datenbank in einer Anweisung), Archiv zurück in seine
   Bereiche, Feibeitsblatt-Verknüpfungen wie vorher (ohne die Blätter der Selbstlern-Phase – sie bleiben im Feibeitsblatt mit ihren Abgaben), noch nicht
   angelegte Entwürfe der Selbstlern-Phase löschen, Schulportal-Eintrag und Hausaufgabe zurück. */
async function restoreSelbstlern(c, lessonId, s) {
  const db = c.db, a = parseJ(s.archive, {}), p = parseJ(s.proposal, {});
  const [own, linkedR] = await db.batch([
    db.prepare("SELECT id, lesson_id, kind FROM files WHERE lesson_id=?1 AND source='selbstlern'").bind(lessonId),
    db.prepare("SELECT code FROM fb_sheets WHERE lesson_id=?1").bind(lessonId),
  ]);
  const keys = (own.results || []).filter((f) => f.kind === "file").map((f) => fileKey(lessonId, f.id));
  for (let i = 0; i < keys.length; i += 1000) await c.env.FILES.delete(keys.slice(i, i + 1000));
  const origSheets = (a.sheets || []).slice(0, 40), origCodes = new Set(origSheets.map((x) => x.code));
  const removedSheets = (linkedR.results || []).map((x) => x.code).filter((x) => !origCodes.has(x));
  const draftIds = [...(Array.isArray(p.stationen) ? p.stationen : []).map((x) => x && x.draftId), p.escapeDraftId].filter(isId);
  const stmts = [db.prepare("DELETE FROM files WHERE lesson_id=?1 AND source='selbstlern'").bind(lessonId)];
  for (const area of ["student", "teacher", "print"]) {
    const ids = (a.files || []).filter((f) => (f.area === "teacher" || f.area === "print" ? f.area : "student") === area).map((f) => f.id);
    if (ids.length) stmts.push(db.prepare("UPDATE files SET area=?2, updated_at=?3 WHERE lesson_id=?1 AND area='archive' AND id IN (SELECT value FROM json_each(?4))").bind(lessonId, area, c.now, JSON.stringify(ids)));
  }
  stmts.push(db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1").bind(lessonId));
  for (const sh of origSheets) stmts.push(db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at, kind) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(lesson_id, code) DO NOTHING").bind(lessonId, sh.code, sh.title || "Feibeitsblatt", c.now, sh.kind || ""));
  if (draftIds.length) stmts.push(db.prepare("DELETE FROM fb_drafts WHERE lesson_id=?1 AND status='draft' AND id IN (SELECT value FROM json_each(?2))").bind(lessonId, JSON.stringify(draftIds)));
  stmts.push(db.prepare("UPDATE lessons SET homework=?2, updated_at=?3 WHERE id=?1").bind(lessonId, a.homework || "", c.now));
  stmts.push(db.prepare("DELETE FROM substitutes WHERE lesson_id=?1").bind(lessonId));
  await db.batch(stmts);
  // „zuletzt von …“ wie vorher (Prüfbefund: sonst stand nach dem Wiederherstellen immer „lehrkraft“ da)
  await savePortal(db, lessonId, a.portal || "", null, ["lehrkraft", "claude", "ki"].includes(a.portalSource) ? a.portalSource : "lehrkraft", c.now);
  for (const code of removedSheets) await deleteNotfallFiles(c, lessonId, code);   // Notfall-Feibeitsblätter der Selbstlern-Phase gehören nicht mehr dazu
  return json({ ok: true, removedSheets, deletedFiles: (own.results || []).length });
}

/* Archivierte ursprüngliche Planung (Schulportal-Eintrag + Material) in eine andere Sitzung übernehmen – Selbstlern-Phase und ältere Vertretung */
export async function routeSubstituteTransfer(c, lessonId) {
  await requireTeacher(c);
  const s = await getSubstitute(c.db, lessonId);
  if (!s || !isAbsent(s.status)) throw bad("Für diese Sitzung gibt es keine archivierte Planung.");
  const body = await readJson(c.request, 10000);
  if (!isId(body.targetLessonId) || body.targetLessonId === lessonId) throw bad("Bitte eine andere Sitzung wählen.");
  const target = await getLesson(c.db, body.targetLessonId);
  const a = parseJ(s.archive, {});
  // in Stücken (höchstens 10 Dateien je Aufruf: Grenzen des Free-Plans für R2- und Datenbankaufrufe); der Browser ruft mit offset weiter auf
  const all = a.files || [], from = Math.max(0, Math.min(all.length, Number(body.offset) || 0)), chunk = all.slice(from, from + 10);
  const found = chunk.length ? await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND id IN (SELECT value FROM json_each(?2))").bind(lessonId, JSON.stringify(chunk.map((f) => f.id))).all() : { results: [] };
  const byId = new Map((found.results || []).map((f) => [f.id, f]));
  // Notfall-Feibeitsblätter nicht kopieren: Sie entstehen in der Zielsitzung neu, sobald dort das Feibeitsblatt verknüpft ist
  // die Anmerkungs-PDF einer Präsentation (Nachtrag 20) gehört zu ihr und bleibt hier
  const files = chunk.map((f0) => ({ f0, f: byId.get(f0.id) })).filter((x) => x.f && x.f.source !== "notfall" && !x.f.notes_of);
  await checkStorage(c, files.reduce((n, x) => n + (x.f.kind === "file" ? x.f.size || 0 : 0), 0));
  const ins = [];
  for (const { f0, f } of files) {
    const id = randomId(8);
    let pending = false;
    if (f.kind === "file") {
      const obj = await c.env.FILES.get(fileKey(f.lesson_id, f.id));
      // von Claude gestaltet, aber noch nie gedruckt: ohne PDF übernehmen – die Zielsitzung druckt es
      if (!obj && f.html != null) pending = true;
      else if (!obj) continue;
      else await c.env.FILES.put(fileKey(target.id, id), obj.body, { httpMetadata: { contentType: f.mime } });
    }
    ins.push(c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, print_copies, print_duplex, print_color, created_at, updated_at, html, html_at, pdf_at, pages) " +
      "VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?17, 'uebernommen', ?9, ?10, ?11, ?12, ?12, ?13, ?14, ?15, ?16)")
      .bind(id, target.id, f0.area === "teacher" || f0.area === "print" ? f0.area : "student", f.kind, f.name, f.mime, pending ? 0 : f.size, f.text, f.print_copies ?? null, f.print_duplex ?? null, f.print_color ?? null, c.now,
        f.html ?? null, f.html_at ?? null, pending ? null : f.pdf_at ?? null, pending ? null : f.pages ?? null, pending ? "pending" : "ready"));
  }
  if (ins.length) await c.db.batch(ins);
  if (from === 0 && a.portal && body.portal !== false) {
    const merged = target.portal ? target.portal + "\n\n" + a.portal : a.portal;
    await savePortal(c.db, target.id, merged, null, "lehrkraft", Date.now());
  }
  const next = from + chunk.length < all.length ? from + chunk.length : null;
  return json({ ok: true, copied: ins.length, next, target: target.id });
}

/* ======================= Schüler:innen ======================= */
/* Feibeitsblatt der Station: Code der Station oder der des angelegten Entwurfs (noch nicht angelegt → null) */
const draftSheet = (drafts, id) => { const d = drafts.find((x) => x.id === id); return d && d.status === "created" && d.sheet_code ? d.sheet_code : null; };
/* Daten für die Schüleransicht (routeStudentLesson): Selbstlern-Phase vollständig für die Ansicht (Teil B) – nie die Kriterien des Erklär-Chatbots, nie
   Hinweise an die Aufsicht – und zusätzlich in der Form der älteren Vertretung (Hinweis + Schritte), damit die bisherige Ansicht sie schon zeigt.
   drafts = Entwürfe der Sitzung (id, status, sheet_code) – nur bei einer Selbstlern-Phase nötig. */
export function studentSubstitute(s, drafts = []) {
  if (!s || !isAbsent(s.status)) return { substitute: null, selbstlern: null };
  const raw = parseJ(s.proposal, {});
  if (s.status !== SELBSTLERN) return { substitute: substituteForStudents(s), selbstlern: null };
  const p = readSelbstlern(raw);
  if (!p) return { substitute: null, selbstlern: null };
  const escSheet = raw.escapeDraftId ? draftSheet(drafts, raw.escapeDraftId) : null;
  const stationen = p.stationen.map((x) => {
    const o = { nr: x.nr, id: x.id, titel: x.titel, typ: x.typ, label: stationLabel(x.typ), anleitung: x.anleitung, minuten: x.minuten };
    if (x.fileId) o.fileId = x.fileId;
    if (x.typ === "feibeitsblatt") { const code = x.code || (x.draftId ? draftSheet(drafts, x.draftId) : null); if (code) o.code = code; else o.pending = true; }
    if (x.video) o.video = x.video;
    if (x.bot) o.erklaeren = x.bot.erklaeren;
    if (x.escape) { o.escape = true; if (!escSheet) o.pending = true; }
    return o;
  });
  const intro = p.analog ? SELBSTLERN_INTRO_ANALOG : SELBSTLERN_INTRO;
  const escape = raw.escape_room ? { name: raw.escape_room.name, titel: raw.escape_room.titel, untertitel: raw.escape_room.untertitel, ready: !!escSheet } : null;
  return {
    selbstlern: { intro, einleitung: p.einleitung, analog: p.analog, stationen, material: p.material, ...(escape ? { escape } : {}) },
    // bisherige Ansicht (bis Teil B die eigene baut): Hinweis und Schritte
    substitute: { hinweis: intro + (p.einleitung ? " " + p.einleitung : ""), schritte: stationen.map((x) => ({ titel: x.titel + " (" + x.label + ")", anleitung: x.anleitung, minuten: x.minuten, abgabe: false })), abgabe: "", escape },
  };
}
export const substituteForStudents = (s) => {
  if (!s || s.status !== "aktiv") return null;
  const p = parseJ(s.proposal, {});
  return { hinweis: p.hinweis, schritte: (p.schritte || []).map((x) => ({ titel: x.titel, anleitung: x.anleitung, minuten: x.minuten, abgabe: !!x.abgabe })), abgabe: p.abgabe || "",
    escape: p.escape_room ? { name: p.escape_room.name, titel: p.escape_room.titel, untertitel: p.escape_room.untertitel, ready: !!p.escapeSheet } : null };
};

/* Escape-Room einer Sitzung: Schüler:innen nur bei aktiver Selbstlern-Phase bzw. Vertretung (mit Freischaltung der Sitzung), Lehrkraft auch als Vorschau */
async function escapeOf(db, lessonId, s) {
  if (!s) return null;
  const p = parseJ(s.proposal, {});
  if (!p || !p.escape_room) return null;
  if (s.status === SELBSTLERN) {
    const d = isId(p.escapeDraftId) ? await db.prepare("SELECT status, sheet_code FROM fb_drafts WHERE id=?1 AND lesson_id=?2").bind(p.escapeDraftId, lessonId).first() : null;
    return { room: p.escape_room, sheet: d && d.status === "created" && d.sheet_code ? d.sheet_code : "", active: true };
  }
  return { room: p.escape_room, sheet: p.escapeSheet || "", active: s.status === "aktiv" };
}
function escapeOut(c, l, e, preview) {
  // Vorbelegung der Klasse im Escape-Room: bei Schüler:innen ihre eigene Klasse (bei Kursen über mehrere Klassen nicht die Kurskennung)
  return json({ ok: true, room: e.room, sheetCode: preview ? "" : e.sheet || "", preview, subject: l.subject, klass: !preview && c.student && c.student.klass ? c.student.klass : l.klass,
    feibeitsblattUrl: c.env.FEIBEITSBLATT_URL || "https://feibeitsblatt.janrickmer.de/", authLeftMs: preview ? undefined : c.authLeftMs });
}
export async function routeStudentEscape(c, lessonId) {
  const { lesson } = await requireAccess(c, lessonId);
  const e = await escapeOf(c.db, lessonId, await getSubstitute(c.db, lessonId));
  if (!e || !e.active) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es keinen Escape-Room.");
  return escapeOut(c, lesson, e, false);
}
export async function routeTeacherEscape(c, lessonId) {
  await requireTeacher(c);
  const l = await getLesson(c.db, lessonId);
  const e = await escapeOf(c.db, lessonId, await getSubstitute(c.db, lessonId));
  if (!e) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es keinen Escape-Room.");
  return escapeOut(c, l, e, true);
}
