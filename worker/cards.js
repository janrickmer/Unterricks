// cards.js – Bildkarten der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): eine PDF, eine Seite = eine Karte, zu jeder Karte ein gekürzter
// Erzähltext für die Elternansicht. Die Lehrkraft lädt die PDF hoch (Freigabe für Eltern zunächst aus – Verlagskarten dürfen meist nicht online
// weitergegeben werden) oder Claude gestaltet die Karten über den Connector (HTML → PDF wie add_material_pdf, saveCardSet). Gespeichert als
// Datei der Lehrkraft (area teacher) mit files.cards = {v:1, texts, share, rev}; Schüler:innen sehen sie nie. Die Kartenbilder rendert der
// Browser der Lehrkraft (PDF.js, presenter.js opt.cards) in slides – card_img_at merkt sich, aus welchem Stand der PDF sie stammen.
import { HttpError, bad, json, readJson, randomId, cleanLine, cleanText, isId, requireSecret, signLink, checkLink } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { getLesson, fileOut, cardData, cardVersion, MAX_CARD_TEXT } from "./lessons.js";
import { getFile, fileKey, slideKey, uploadLength, checkStorage, mimeFor, MAX_FILE, MAX_CARDS, saveDesign } from "./files.js";
import { GS_SUBJECT } from "../public/shared.js";

const STALE = "Die Bildkarten wurden inzwischen neu gestaltet – die Bilder werden neu erstellt.";
const CONFLICT = "Die Erzähltexte wurden inzwischen geändert (z. B. von Claude) – bitte neu laden.";

/* Erzähltexte prüfen: Liste von höchstens 40 Texten (je ≤ 1200 Zeichen); leere Texte bleiben an ihrer Stelle (Karte ohne Text) */
export function cleanCardTexts(raw, { min = 0 } = {}) {
  if (!Array.isArray(raw)) throw bad("Die Erzähltexte müssen eine Liste sein (ein Text je Karte).");
  if (raw.length > MAX_CARDS) throw bad("Höchstens " + MAX_CARDS + " Bildkarten (und Erzähltexte) je PDF.");
  const t = raw.map((x) => cleanText(typeof x === "string" ? x : x == null ? "" : String(x), MAX_CARD_TEXT).trim());
  let end = t.length; while (end > 0 && !t[end - 1]) end--;   // leere Texte am Ende fallen weg
  const out = t.slice(0, end);
  if (out.length < min) throw bad("Bitte zu jeder Karte einen Erzähltext angeben.");
  return out;
}
const pdfName = (raw) => (cleanLine(raw, 190).replace(/\.pdf$/i, "").trim() || "Bildkarten") + ".pdf";

async function gsLessonFor(db, lessonId) {
  const l = await getLesson(db, lessonId);
  if (l.subject !== GS_SUBJECT) throw bad("Bildkarten gibt es nur in Sitzungen der Grundschule.");
  if (l.cancelled) throw bad("Für einen Ausfall-Eintrag gibt es kein Material.");
  return l;
}
// eine Datei mit Bildkarten (ohne Claudes Gestaltung – html bis 1,5 MB wird hier nie gebraucht)
async function cardFile(db, fileId) {
  if (!isId(fileId)) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  const f = await db.prepare("SELECT id, lesson_id, area, kind, name, mime, size, status, source, pages, cards, card_pages, card_img_at, pdf_at, html_at, created_at, updated_at, " +
    "(html IS NOT NULL) AS designed FROM files WHERE id=?1").bind(fileId).first();
  if (!f) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  if (f.cards == null) throw bad("Diese Datei sind keine Bildkarten.");
  return f;
}

/* Signatur für alle Bilder eines Kartensatzes (eine HMAC je Satz): Bild n = base + n + q */
export async function cardSetUrl(secret, fileId, ttl, now = Date.now()) {
  const { e, s } = await signLink(secret, ["cards", fileId], ttl, now);
  return { base: "/api/card/" + fileId + "/", q: "?e=" + e + "&s=" + encodeURIComponent(s) };
}

/* Lehrkraft: Bildkarten als PDF hochladen (eine Seite = eine Karte); share = Eltern dürfen sie sehen (Standard: nein) */
export async function routeCardsUpload(c, lessonId) {
  await requireTeacher(c);
  await gsLessonFor(c.db, lessonId);
  const u = new URL(c.request.url), name = pdfName(u.searchParams.get("name"));
  if (mimeFor(name, c.request.headers.get("content-type")) !== "application/pdf") throw bad("Bitte die Bildkarten als PDF-Datei hochladen (eine Seite = eine Karte).");
  const len = uploadLength(c, MAX_FILE);
  await checkStorage(c, len);
  const id = randomId(8), key = fileKey(lessonId, id);
  await c.env.FILES.put(key, c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  const head = await c.env.FILES.get(key, { range: { offset: 0, length: 5 } });
  if (!head || (await head.text()) !== "%PDF-") { await c.env.FILES.delete(key); throw bad("Diese Datei ist keine PDF-Datei. Bitte die Bildkarten als PDF-Datei hochladen."); }
  const share = u.searchParams.get("share") === "1";
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, cards, created_at, updated_at) VALUES(?1, ?2, 'teacher', 'file', ?3, 'application/pdf', ?4, 'processing', 'upload', ?5, ?6, ?6)")
    .bind(id, lessonId, name, len, JSON.stringify({ v: 1, texts: [], share, rev: 0 }), c.now).run();
  // während des Hochladens gelöscht (anderer Tab)? Dann die PDF nicht verwaist liegen lassen
  if (!(await c.db.prepare("SELECT 1 AS x FROM lessons WHERE id=?1").bind(lessonId).first())) {
    await c.env.FILES.delete(key); await c.db.prepare("DELETE FROM files WHERE id=?1").bind(id).run();
    throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
  }
  return json({ ok: true, file: fileOut(await getFile(c.db, id)) });
}

/* Lehrkraft: alle Kartenbilder sind hochgeladen ({pages, version}) – version muss der Stand der PDF sein, aus dem sie stammen */
export async function routeCardsReady(c, fileId) {
  await requireTeacher(c);
  const f = await cardFile(c.db, fileId);
  const body = await readJson(c.request, 2000);
  const pages = Number(body.pages), version = Number(body.version);
  if (!Number.isInteger(pages) || pages < 1) throw bad("Ungültige Zahl der Bildkarten.");
  if (pages > MAX_CARDS) throw bad("Die PDF hat mehr als " + MAX_CARDS + " Seiten – höchstens " + MAX_CARDS + " Bildkarten je PDF.");
  if (version !== cardVersion(f)) throw new HttpError(409, "stale", STALE);
  const have = await c.db.prepare("SELECT n FROM slides WHERE file_id=?1").bind(f.id).all();
  const ns = (have.results || []).map((x) => x.n), got = ns.filter((n) => n >= 1 && n <= pages).length;
  if (got !== pages) throw bad("Es fehlen noch Kartenbilder (" + got + " von " + pages + "). Bitte erneut versuchen.");
  const extra = ns.filter((n) => n > pages);   // weniger Karten als vorher: überzählige Bilder löschen
  if (extra.length) await c.env.FILES.delete(extra.map((n) => slideKey(f.lesson_id, f.id, n)));
  const [, done] = await c.db.batch([
    c.db.prepare("DELETE FROM slides WHERE file_id=?1 AND n > ?2").bind(f.id, pages),
    c.db.prepare("UPDATE files SET card_pages=?2, card_img_at=?3, pages=CASE WHEN html IS NULL THEN ?2 ELSE pages END, status=CASE WHEN html IS NULL THEN 'ready' ELSE status END, updated_at=?4 " +
      "WHERE id=?1 AND COALESCE(pdf_at, created_at)=?3 RETURNING id").bind(f.id, pages, version, c.now),
  ]);
  if (!(done.results || []).length) throw new HttpError(409, "stale", STALE);
  return json({ ok: true, file: fileOut(await getFile(c.db, f.id)) });
}

/* Lehrkraft: Bilder (signiert, 12 h), Größe, Erzähltexte und Freigabe eines Kartensatzes */
export async function routeCardsGet(c, fileId) {
  await requireTeacher(c);
  const f = await cardFile(c.db, fileId);
  const d = cardData(f), v = cardVersion(f);
  const s1 = (f.card_pages || 0) > 0 ? await c.db.prepare("SELECT w, h FROM slides WHERE file_id=?1 AND n=1").bind(f.id).first() : null;
  return json({ ok: true, img: await cardSetUrl(requireSecret(c.env), f.id, 12 * 3600e3, c.now), w: (s1 && s1.w) || null, h: (s1 && s1.h) || null,
    pages: f.card_pages || 0, texts: d.texts, share: d.share, rev: d.rev, current: f.card_img_at != null && f.card_img_at === v && (f.card_pages || 0) > 0, version: v,
    status: f.status, name: f.name, pdfPages: f.pages ?? null });
}

/* Lehrkraft: Erzähltexte und/oder Freigabe ändern ({texts?, share?, rev}) – rev schützt vor dem Überschreiben einer neueren Fassung (z. B. von Claude) */
export async function routeCardsPut(c, fileId) {
  await requireTeacher(c);
  const f = await cardFile(c.db, fileId);
  const body = await readJson(c.request, 120000);
  const cur = cardData(f);
  if (!Number.isInteger(body.rev)) throw bad("Der Stand der Erzähltexte (rev) fehlt.");
  const next = { v: 1, texts: body.texts !== undefined ? cleanCardTexts(body.texts) : cur.texts, share: body.share !== undefined ? body.share === true : cur.share, rev: cur.rev + 1 };
  const conflict = () => new HttpError(409, "cards_conflict", CONFLICT, { cards: { texts: cur.texts, share: cur.share, rev: cur.rev } });
  if (body.rev !== cur.rev) throw conflict();
  const r = await c.db.prepare("UPDATE files SET cards=?2, updated_at=?3 WHERE id=?1 AND cards=?4 RETURNING id").bind(f.id, JSON.stringify(next), c.now, f.cards).run();
  if (!(r.results || []).length) throw conflict();
  return json({ ok: true, cards: { texts: next.texts, share: next.share, rev: next.rev } });
}

/* Claude: Erzähltexte setzen (ohne Rücksicht auf rev – der Connector liest vorher get_lesson); rev zählt weiter, damit offene Seiten neu laden */
export async function setCardTexts(c, fileId, texts) {
  const t = cleanCardTexts(texts, { min: 1 });
  for (let i = 0; i < 3; i++) {
    const f = await cardFile(c.db, fileId), cur = cardData(f);
    const next = { ...cur, texts: t, rev: cur.rev + 1 };
    const r = await c.db.prepare("UPDATE files SET cards=?2, updated_at=?3 WHERE id=?1 AND cards=?4 RETURNING id").bind(f.id, JSON.stringify(next), c.now, f.cards).run();
    if ((r.results || []).length) return { file: f, cards: next };
  }
  throw new HttpError(409, "cards_conflict", CONFLICT);
}

/* Lehrkraft: Kartensätze, deren Bilder fehlen oder nicht mehr zur PDF passen (die Startseiten und die Sitzungsseite erstellen sie nach).
   Hochgeladene zählen auch vor dem ersten Erstellen (status processing), gestaltete erst, wenn ihre PDF gedruckt ist. */
export async function routeCardsPending(c) {
  await requireTeacher(c);
  const r = await c.db.prepare("SELECT id, lesson_id, name, COALESCE(pdf_at, created_at) AS version FROM files WHERE cards IS NOT NULL AND kind='file' AND area<>'archive' " +
    "AND (status='ready' OR html IS NULL) AND (card_img_at IS NULL OR card_img_at <> COALESCE(pdf_at, created_at)) ORDER BY updated_at LIMIT 20").all();
  return json({ ok: true, files: (r.results || []).map((f) => ({ id: f.id, lessonId: f.lesson_id, name: f.name, version: f.version })) });
}

/* Ein Kartenbild (signierter Link eines Satzes; auch für die Elternansicht) */
export async function routeCardImage(c, fileId, nRaw) {
  const u = new URL(c.request.url), n = Number(nRaw);
  if (!Number.isInteger(n) || n < 1 || !(await checkLink(requireSecret(c.env), ["cards", fileId], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "link_expired", "Diese Bildkarte ist nicht (mehr) freigegeben.");
  const f = await c.db.prepare("SELECT id, lesson_id, card_pages FROM files WHERE id=?1 AND cards IS NOT NULL").bind(fileId).first();
  if (!f || n > (f.card_pages || 0)) throw new HttpError(404, "not_found", "Bildkarte nicht gefunden.");
  const obj = await c.env.FILES.get(slideKey(f.lesson_id, f.id, n));
  if (!obj) throw new HttpError(404, "not_found", "Bildkarte nicht gefunden.");
  return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

/* Claude (Connector): Bildkarten gestalten bzw. ihre Gestaltung ersetzen (fileId) – Bereich „nur Lehrkraft“, mit Erzähltexten; share Standard: ja
   (selbst gestaltete Karten). Gedruckt wird wie bei add_material_pdf (renderDesign im Aufrufer). */
export async function saveCardSet(c, lessonId, { title, html, texts, fileId = null, share }) {
  await gsLessonFor(c.db, lessonId);
  const t = cleanCardTexts(texts, { min: 1 });
  let cards;
  if (fileId) {
    const f = await getFile(c.db, fileId);
    if (f.lesson_id !== lessonId || f.cards == null) throw bad("file_id gehört zu keinen Bildkarten dieser Sitzung (siehe get_lesson).");
    const cur = cardData(f);
    cards = { v: 1, texts: t, share: typeof share === "boolean" ? share : cur.share, rev: cur.rev + 1 };
  } else cards = { v: 1, texts: t, share: share !== false, rev: 0 };
  return saveDesign(c, lessonId, { area: "teacher", title: title || "Bildkarten", html, source: "claude", fileId, cards });
}
