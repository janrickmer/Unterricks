// podcast.js – „Podcast für den kommenden Unterricht“ (Nachtrag 22, nur für die Lehrkraft): Grundlage des Podcasts (Sitzungen des Tages mit
// Zusammenfassung bzw. Ersatz aus der Planung), Ablage der Audiodatei aus Gemini Notebook in R2 (ein Podcast je Unterrichtstag), Abspielen über
// einen signierten Link mit Range-Anfragen (Spulen, Safari), Löschen von Hand und automatisch zwei Tage nach dem Unterrichtstag.
// Die Folge selbst erstellt Claude in Chrome in Gemini Notebook (Auftrag aus public/podcastlib.js); Unterricks spricht nie mit Google.
import { HttpError, bad, json, randomId, isId, requireSecret, signLink, checkLink, contentDisposition } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { checkStorage } from "./files.js";
import { nextTeachingDay, sessionOrder } from "./printjobs.js";
import { stopDecision } from "./lessons.js";
import { berlinToday, addDays, isIsoDate, subjectShort, classShort, GS_SUBJECT, summaryHead, summaryOutdated, hasStop, stopParts, savedSinceDecision } from "../public/shared.js";
import { PODCAST_MAX_BYTES, PODCAST_AHEAD_DAYS, PODCAST_LINK_TTL_MS, podcastDeleteAfter, audioKind, planPlain, AUDIO_KINDS_TEXT } from "../public/podcastlib.js";

export const PODCAST_PREFIX = "podcast/";
export const podcastKey = (id) => PODCAST_PREFIX + id;   // außerhalb der Sitzungen (l/<Sitzung>/…): nicht in Sicherung und Sitzungsdateien
const COLS = "id, day, r2_key, mime, size, created_at, delete_after";
const EXT = { "audio/mp4": "m4a", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/ogg": "ogg", "audio/webm": "webm" };
const GONE = "Diesen Podcast gibt es nicht mehr.";

/* Sitzungen von heute und vom nächsten Schultag (?1, ?2) – ohne Ausfall-Einträge; sub = Stand einer Vertretung ('aktiv' = bestätigt: die Lehrkraft
   unterrichtet sie nicht); prev = die vorige Sitzung desselben Kurses (wie previousLesson in worker/lessons.js) als JSON {id, date, portal, v} – für den
   offenen Teil nach einem Zwischenstopp (Anforderung 13), in derselben Anweisung */
export const PODCAST_SESSIONS_SQL = "SELECT id, subject, klass, title, topic, lesson_date, start_time, duration_min, portal, portal_updated_at, teacher_summary, teacher_summary_plan, " +
  "teacher_summary_at, stop_decision, (SELECT status FROM substitutes WHERE lesson_id=lessons.id) AS sub, " +
  "(SELECT json_object('id', p.id, 'date', p.lesson_date, 'portal', p.portal, 'v', p.portal_version) FROM lessons p WHERE p.subject=lessons.subject AND p.klass=lessons.klass " +
  "AND p.id<>lessons.id AND p.lesson_date IS NOT NULL AND p.cancelled=0 AND (p.lesson_date < lessons.lesson_date OR (p.lesson_date = lessons.lesson_date AND p.created_at < lessons.created_at)) " +
  "ORDER BY p.lesson_date DESC, p.created_at DESC LIMIT 1) AS prev FROM lessons WHERE lesson_date IN (?1, ?2) AND cancelled=0";
/* Offener Teil der vorigen Stunde nach einem Zwischenstopp (Anforderung 13), der in der Planung dieser Sitzung (und damit in ihrer Zusammenfassung)
   noch nicht steht: noch nicht entschieden ("open") bzw. „übernehmen“ entschieden, die Sitzung danach aber noch nicht neu geplant ("take"). Verzichtet
   oder schon neu geplant (Eintrag bzw. Zusammenfassung nach der Entscheidung gespeichert) → null. → {state, date (der vorigen Stunde), text (schlicht)} */
export function carryOf(l, isGs, names) {
  let p = null;
  try { p = l.prev ? JSON.parse(l.prev) : null; } catch {}
  if (!p || !hasStop(p.portal)) return null;
  const text = planPlain(stopParts(p.portal).open, isGs, names);
  if (!text) return null;
  const d = stopDecision(l, { id: p.id, portal_version: p.v });
  if (d && d.choice !== "uebernehmen") return null;
  // neu geplant: Eintrag bzw. Verlaufsplan oder Zusammenfassung danach gespeichert (auch im selben Aufruf von update_lesson wie die Entscheidung)
  if (savedSinceDecision(d, l.portal_updated_at, l.teacher_summary_at)) return null;
  return { state: d ? "take" : "open", date: p.date, text };
}
/* Namen der PDF-Dateien der Grundschulkurse, die an diesen Tagen Unterricht haben (Verweise [[pdf:…]] im Verlaufsplan zeigen auch auf Dateien
   früherer Sitzungen des Kurses) */
export const PODCAST_FILES_SQL = "SELECT id, name FROM files WHERE kind='file' AND lesson_id IN (SELECT id FROM lessons WHERE subject='" + GS_SUBJECT + "' AND klass IN " +
  "(SELECT klass FROM lessons WHERE lesson_date IN (?1, ?2) AND subject='" + GS_SUBJECT + "' AND cancelled=0))";

async function linkFor(secret, id, now) {
  const { e, s } = await signLink(secret, ["podcast", id], PODCAST_LINK_TTL_MS, now);
  return { url: "/api/podcast/" + id + "?e=" + e + "&s=" + encodeURIComponent(s), urlExpires: e };
}
async function podcastOut(c, r) {
  return { id: r.id, day: r.day, mime: r.mime, size: r.size, createdAt: r.created_at, deleteAfter: r.delete_after, ...(await linkFor(requireSecret(c.env), r.id, c.now)) };
}

/* Abgelaufene Podcasts löschen (delete_after erreicht): erst die Dateien in R2, dann die Zeilen – scheitert R2, bleibt die Zeile und es geht beim
   nächsten Mal weiter. sweep: zusätzlich Dateien unter podcast/ ohne Zeile (z. B. nach einem abgebrochenen Ersetzen), wenn sie älter als eine Stunde
   sind (ein Hochladen kann gerade laufen). Aufgerufen beim Laden der Startseiten (GET /api/teacher/podcast), im gelegentlichen Aufräumen, im
   Zeitplan-Handler und beim Zurücksetzen. → Zahl der gelöschten Podcasts */
export async function cleanupPodcasts(c, { sweep = false } = {}) {
  const r = await c.db.prepare("SELECT id, r2_key FROM podcasts WHERE delete_after <= ?1 ORDER BY delete_after LIMIT 50").bind(c.now).all();
  const rows = r.results || [];
  if (rows.length) {
    await c.env.FILES.delete(rows.map((x) => x.r2_key));
    await c.db.prepare("DELETE FROM podcasts WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(rows.map((x) => x.id))).run();
  }
  if (sweep && c.env.FILES.list) {
    const keep = new Set(((await c.db.prepare("SELECT r2_key FROM podcasts").all()).results || []).map((x) => x.r2_key));
    const list = await c.env.FILES.list({ prefix: PODCAST_PREFIX, limit: 200 });
    const old = (list.objects || []).filter((o) => !keep.has(o.key) && (!o.uploaded || c.now - new Date(o.uploaded).getTime() > 3600e3)).map((o) => o.key);
    if (old.length) await c.env.FILES.delete(old);
  }
  return rows.length;
}

/* GET /api/teacher/podcast → {today, podcasts: [{id, day, mime, size, createdAt, deleteAfter, url, urlExpires}]}: die Podcasts für heute und spätere
   Tage (ein vergangener Tag wird nicht mehr angeboten, die Datei bleibt bis delete_after), je Tag nur der neueste. Räumt nebenbei ab. */
export async function routePodcastList(c) {
  await requireTeacher(c);
  const today = berlinToday(c.now);
  const r = await c.db.prepare("SELECT " + COLS + " FROM podcasts WHERE day >= ?1 AND delete_after > ?2 ORDER BY day, created_at DESC, id DESC").bind(today, c.now).all();
  const seen = new Set(), list = [], extra = [];
  for (const x of r.results || []) { if (seen.has(x.day)) extra.push(x); else { seen.add(x.day); list.push(x); } }
  c.waitUntil((async () => {
    // zwei gleichzeitig hochgeladene Folgen für denselben Tag: die ältere geht (wie beim Ersetzen)
    if (extra.length) {
      await c.env.FILES.delete(extra.map((x) => x.r2_key));
      await c.db.prepare("DELETE FROM podcasts WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(extra.map((x) => x.id))).run();
    }
    await cleanupPodcasts(c);
  })().catch(() => {}));
  return json({ ok: true, today, podcasts: await Promise.all(list.map((x) => podcastOut(c, x))) });
}

/* GET /api/teacher/podcast/plan → {today, candidate, next (nächster Schultag wie bei den Druckaufträgen: Fr/Sa/So → Montag, Ferien und Ausfälle laut
   Stundenplan übersprungen; null = kein Unterricht in Sicht), plans: [{date, sessions}]} für heute (nur mit Sitzungen) und den nächsten Schultag.
   Je Sitzung (in Unterrichtsreihenfolge) die Kopfzeile wie in der Zusammenfassung (summaryHead), die Zusammenfassung oder – ohne sie – der Ersatz aus
   der Planung (Schulportal-Eintrag bzw. Verlaufsplan als schlichter Text, ohne Zwischenstopp-Zeile) und – nach einem Zwischenstopp der vorigen Stunde
   desselben Kurses, solange ihr offener Teil noch nicht in dieser Sitzung eingeplant ist – carry (carryOf). Ob heute noch Unterricht bevorsteht,
   entscheidet der Browser mit seiner Uhr (podcastChoice). 8 D1-Anweisungen. */
export async function routePodcastPlan(c) {
  await requireTeacher(c);
  const today = berlinToday(c.now);
  const { candidate, date: next, gs } = await nextTeachingDay(c, today);
  const other = next || today;
  const [ls, fs] = await c.db.batch([c.db.prepare(PODCAST_SESSIONS_SQL).bind(today, other), c.db.prepare(PODCAST_FILES_SQL).bind(today, other)]);
  const names = Object.fromEntries((fs.results || []).map((f) => [f.id, f.name]));
  const sessions = (ls.results || []).map((l) => {
    const isGs = l.subject === GS_SUBJECT, course = isGs ? gs.get(l.klass) || null : null, sum = String(l.teacher_summary || "").trim(), sub = l.sub === "aktiv";
    const one = { subject: l.subject, klass: l.klass, date: l.lesson_date, startTime: l.start_time || null };
    const out = { id: l.id, ...one, title: l.title || "", topic: l.topic || "", durationMin: l.duration_min ?? null, school: isGs ? "gs" : "gym",
      label: isGs ? (course ? course.short : "Grundschule") : subjectShort(l.subject) + " " + classShort(l.klass), head: summaryHead(one, course),
      summary: sub ? "" : sum, summaryOutdated: !sub && summaryOutdated(sum, l.teacher_summary_plan, l.portal), fallback: sub || sum ? "" : planPlain(l.portal, isGs, names),
      ...(sub ? { substitute: true } : {}) };
    const carry = sub ? null : carryOf(l, isGs, names);
    return carry ? { ...out, carry } : out;
  }).sort(sessionOrder);
  const plans = [];
  const todays = sessions.filter((s) => s.date === today);
  if (todays.length) plans.push({ date: today, sessions: todays });
  if (next) plans.push({ date: next, sessions: sessions.filter((s) => s.date === next) });
  return json({ ok: true, today, candidate, next: next || null, plans });
}

/* POST /api/teacher/podcast?day=JJJJ-MM-TT – Rumpf = die Audiodatei (roh, mit Content-Length, höchstens 95 MB): geht ohne Zwischenspeicher direkt
   nach R2 (128 MB Arbeitsspeicher, 10 ms CPU), danach prüft der Server die ersten Bytes (keine Audiodatei → gelöscht, 415). Ein Podcast je Tag: ein
   neuer ersetzt den bisherigen (dessen Datei wird gelöscht). → {podcast, replaced} */
export async function routePodcastUpload(c) {
  await requireTeacher(c);
  const day = new URL(c.request.url).searchParams.get("day") || "", today = berlinToday(c.now);
  if (!isIsoDate(day) || day < today || day > addDays(today, PODCAST_AHEAD_DAYS)) throw bad("Der Podcast gehört zu einem Unterrichtstag ab heute – bitte die Seite neu laden.");
  const len = Number(c.request.headers.get("content-length"));   // ohne Länge nimmt R2 den Rumpf nicht an (unbekannte Länge, z. B. „chunked“)
  if (!Number.isSafeInteger(len) || len <= 0) throw new HttpError(411, "length_required", "Die Dateigröße fehlt in der Anfrage.");
  if (len > PODCAST_MAX_BYTES) throw new HttpError(413, "too_large", "Die Datei ist zu groß (höchstens " + PODCAST_MAX_BYTES / 1e6 + " MB). Bitten Sie Claude bzw. Gemini Notebook um eine kürzere Folge.");
  await checkStorage(c, len);
  const id = randomId(8), key = podcastKey(id);
  await c.env.FILES.put(key, c.request.body, { httpMetadata: { contentType: "application/octet-stream" } });
  let head = null;
  try { const o = await c.env.FILES.get(key, { range: { offset: 0, length: 64 } }); if (o) head = new Uint8Array(await o.arrayBuffer()); } catch {}
  const kind = audioKind(head);
  if (!kind) {
    try { await c.env.FILES.delete(key); } catch {}
    throw new HttpError(415, "not_audio", "Das ist keine Audiodatei, die Unterricks abspielen kann (erlaubt: " + AUDIO_KINDS_TEXT + ").");
  }
  const row = { id, day, r2_key: key, mime: kind.mime, size: len, created_at: c.now, delete_after: podcastDeleteAfter(day) };
  const res = await c.db.batch([
    c.db.prepare("INSERT INTO podcasts(" + COLS + ") VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(row.id, row.day, row.r2_key, row.mime, row.size, row.created_at, row.delete_after),
    c.db.prepare("DELETE FROM podcasts WHERE day=?1 AND id<>?2 AND (created_at < ?3 OR (created_at = ?3 AND id < ?2)) RETURNING r2_key").bind(day, id, c.now),
  ]);
  const old = (res[1].results || []).map((x) => x.r2_key);
  if (old.length) { try { await c.env.FILES.delete(old); } catch {} }   // bleibt eine Datei liegen, räumt sie cleanupPodcasts (sweep) ab
  return json({ ok: true, podcast: await podcastOut(c, row), replaced: old.length });
}

/* POST /api/teacher/podcast/<id>/link → neuer signierter Link (der Player erneuert ihn, bevor er abläuft) */
export async function routePodcastLink(c, id) {
  await requireTeacher(c);
  const r = isId(id) ? await c.db.prepare("SELECT " + COLS + " FROM podcasts WHERE id=?1 AND delete_after > ?2").bind(id, c.now).first() : null;
  if (!r) throw new HttpError(404, "not_found", GONE);
  return json({ ok: true, podcast: await podcastOut(c, r) });
}

/* DELETE /api/teacher/podcast/<id> – Datei und Zeile löschen */
export async function routePodcastDelete(c, id) {
  await requireTeacher(c);
  const r = isId(id) ? await c.db.prepare("SELECT id, r2_key FROM podcasts WHERE id=?1").bind(id).first() : null;
  if (!r) throw new HttpError(404, "not_found", GONE);
  await c.env.FILES.delete(r.r2_key);
  await c.db.prepare("DELETE FROM podcasts WHERE id=?1").bind(id).run();
  return json({ ok: true });
}

/* Range-Kopf „bytes=a-b“, „bytes=a-“, „bytes=-n“ → {start, end} (beide einschließlich), null (kein bzw. nicht unterstützter Bereich – dann die ganze
   Datei, wie es RFC 9110 erlaubt, z. B. mehrere Bereiche) oder "bad" (nicht erfüllbar → 416) */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (!n || !size) return "bad";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]), end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (!Number.isSafeInteger(start) || start >= size || end < start) return "bad";
  return { start, end };
}

/* GET/HEAD /api/podcast/<id>?e=…&s=… – Abspielen über den signierten Link (ein <audio> kann keinen Authorization-Kopf senden), mit Range-Anfragen
   (206 Partial Content, 416 bei unerfüllbarem Bereich) – Spulen und Safari/iPad brauchen sie. Nur bis delete_after. */
export async function routePodcastStream(c, id) {
  const u = new URL(c.request.url);
  if (!(await checkLink(requireSecret(c.env), ["podcast", id], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "link_expired", "Der Link zum Podcast ist abgelaufen. Bitte die Seite neu laden.");
  const r = await c.db.prepare("SELECT " + COLS + " FROM podcasts WHERE id=?1 AND delete_after > ?2").bind(id, c.now).first();
  if (!r) throw new HttpError(404, "not_found", GONE);
  const size = Number(r.size), rg = parseRange(c.request.headers.get("range"), size);
  const base = { "Content-Type": r.mime || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600",
    "Content-Disposition": contentDisposition("Unterricks-Podcast " + r.day + "." + (EXT[r.mime] || "audio"), false),
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox; default-src 'none'" };
  if (rg === "bad") return new Response(null, { status: 416, headers: { ...base, "Content-Range": "bytes */" + size } });
  const part = rg ? { "Content-Length": String(rg.end - rg.start + 1), "Content-Range": "bytes " + rg.start + "-" + rg.end + "/" + size } : { "Content-Length": String(size) };
  if (c.request.method === "HEAD") return new Response(null, { status: rg ? 206 : 200, headers: { ...base, ...part } });
  const obj = await c.env.FILES.get(r.r2_key, rg ? { range: { offset: rg.start, length: rg.end - rg.start + 1 } } : undefined);
  if (!obj) throw new HttpError(404, "not_found", "Die Datei des Podcasts fehlt im Speicher.");
  return new Response(obj.body, { status: rg ? 206 : 200, headers: { ...base, ...part } });
}
