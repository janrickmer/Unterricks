// planning.js – Unterrichtseinheiten (Leupold-Schema + Ablaufplan), Terminberechnung, Krankheitsvertretung, Claude-Prompts.
// Gemeinsam für Browser und Worker (keine DOM-Zugriffe).
import { subjectName, gradeInfo, classShort, isAnalogClass, ANALOG_RULE, fmtDay, addDays, isIsoDate, isClockTime, PORTAL_RULES, PORTAL_EXAMPLE, PORTAL_TEACHER_RULE, FEIBEITSBLATT_INFO, materialDesignText,
  SYSTEM_PROMPT_ROLE, UNIT_RULE_BASE, STOP_LINE, lessonContext, teacherWishes, groupShort, subjectShort, isValidSubject, isValidClass, clockMinutes, minutesClock, mondayOf, isWeekend,
  GS_SUBJECT, isGsCourseId, parentOpensAt, berlinToday, stopParts, STOP_CHOICE_TEXT, STOP_CHOICES, stopDecidedOn } from "./shared.js";
import { ESCAPE_FORMAT_HINT } from "./escape-data.js";
export { UNIT_RULE } from "./shared.js";

export const WEEKDAYS = [{ d: 1, n: "Montag" }, { d: 2, n: "Dienstag" }, { d: 3, n: "Mittwoch" }, { d: 4, n: "Donnerstag" }, { d: 5, n: "Freitag" }];
const wdName = (d) => (WEEKDAYS.find((w) => w.d === d) || {}).n || "";
const str = (v, max) => { const s = typeof v === "string" ? v : v == null ? "" : String(v); return max && s.length > max ? s.slice(0, max) : s; };
const clip = (s, n) => { s = str(s); return s.length > n ? s.slice(0, n) + " […gekürzt]" : s; };

/* ---------- Rahmendaten und Termine ---------- */
// params = { start, end, exam, weekdays: [{day 1–5, minutes, time? „HH:MM“}], breaks: [{from, to, label}], notes, cancelled?: [{date, time}] }
export const CANCEL_MAX = 60;   // höchstens so viele Ausfälle (Krankmeldungen) je Einheit
export function normalizeParams(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const date = (v) => (isIsoDate(v) ? v : null);
  const weekdays = (Array.isArray(p.weekdays) ? p.weekdays : []).slice(0, 10)
    .map((w) => ({ day: Number(w && w.day), minutes: Number(w && w.minutes), time: isClockTime(w && w.time) ? w.time : null }))
    .filter((w) => Number.isInteger(w.day) && w.day >= 1 && w.day <= 5 && Number.isInteger(w.minutes) && w.minutes >= 20 && w.minutes <= 240);
  const breaks = (Array.isArray(p.breaks) ? p.breaks : []).slice(0, 30)
    .map((b) => ({ from: date(b && b.from), to: date(b && (b.to || b.from)), label: str(b && b.label, 80) }))
    .filter((b) => b.from && b.to && b.to >= b.from);
  // Grundschule: ausgefallene Termine (Krankmeldung, nur von der Plattform gesetzt) – der Schlüssel nur, wenn es welche gibt (Gymnasium unverändert)
  const cancelled = (Array.isArray(p.cancelled) ? p.cancelled : []).slice(0, CANCEL_MAX)
    .map((x) => ({ date: date(x && x.date), time: isClockTime(x && x.time) ? x.time : null })).filter((x) => x.date);
  return { start: date(p.start), end: date(p.end), exam: date(p.exam), weekdays, breaks, notes: str(p.notes, 2000), ...(cancelled.length ? { cancelled } : {}) };
}
/* Kurseinstellungen (course_settings; beide Schulformen): Stundenplan wie units.params.weekdays und Schülerzahl (1–60, null = nicht eingetragen).
 * requireTime (Grundschule): jeder Termin braucht eine Uhrzeit – daraus ergibt sich, ab wann Eltern eine Sitzung sehen. Wirft deutsche Meldungen. */
export const CLASS_SIZE_MAX = 60;
export function normalizeCourseSettings(raw, { requireTime = false } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const weekdays = normalizeParams({ weekdays: r.weekdays }).weekdays;
  const v = r.classSize;
  let classSize = null;
  if (v !== null && v !== undefined && v !== "") {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > CLASS_SIZE_MAX) throw new Error("Die Schülerzahl muss zwischen 1 und 60 liegen.");
    classSize = n;
  }
  if (requireTime && weekdays.some((w) => !w.time)) throw new Error("Bitte bei jedem Termin die Uhrzeit eintragen – daraus ergibt sich, ab wann Eltern eine Sitzung sehen können.");
  return { weekdays, classSize };
}
/* Alle Unterrichtstermine im Zeitraum nach Stundenplan, ohne Ferien/Ausfälle; der Klausurtag wird markiert */
export function computeSlots(raw) {
  const p = normalizeParams(raw), out = [];
  if (!p.start || !p.end || p.end < p.start || !p.weekdays.length) return out;
  for (let d = p.start, i = 0; d <= p.end && i < 400; d = addDays(d, 1), i++) {
    const wd = new Date(d + "T12:00:00Z").getUTCDay();
    const hits = p.weekdays.filter((w) => w.day === wd);
    if (!hits.length || p.breaks.some((b) => d >= b.from && d <= b.to)) continue;
    for (const w of hits) if (!isCancelled(p, d, w.time, hits.length === 1)) out.push({ date: d, minutes: w.minutes, time: w.time || null, kind: d === p.exam ? "klausur" : "stunde" });
  }
  return out;
}
export const lessonSlots = (slots) => slots.filter((s) => s.kind === "stunde");
// ausgefallen (Krankmeldung): derselbe Tag und – wenn beim Ausfall eine Uhrzeit stand – dieselbe Uhrzeit. Hat der Wochentag nur einen Termin
// (single), genügt der Tag: Eine später geänderte Uhrzeit im Stundenplan holt den ausgefallenen Termin nicht zurück (Abschlussprüfung F04).
const isCancelled = (p, date, time, single = false) => (p.cancelled || []).some((c) => c.date === date && (c.time == null || single || c.time === (time || null)));

/* ---------- Wochenkalender der Lehrkraft (Startseite) ----------
 * units = [{id, subject, klass, title, params}] (GET /api/teacher/schedule), monday = Montag der Woche. Eine Einheit gilt an einem Tag, wenn er
 * in ihrem Zeitraum liegt (Beginn und Ende einschließlich), sein Wochentag in ihrem Stundenplan steht und er in keinen ihrer Ferien/Ausfälle
 * fällt – wie computeSlots. Dieselbe Klasse zur selben Zeit (überlappende Einheiten) erscheint einmal. Je Tag: timed (mit Uhrzeit, nach Beginn),
 * untimed (ohne Uhrzeit), off (Unterricht, der laut Einheit an diesem Tag entfällt, mit dem Grund). */
export function weekSchedule(units, monday) {
  const friday = addDays(monday, 4);
  const days = WEEKDAYS.map((w, i) => ({ date: addDays(monday, i), day: w.d, name: w.n, timed: [], untimed: [], off: [] }));
  const byKey = new Map();
  for (const u of Array.isArray(units) ? units : []) {
    // Grundschule: Kurs „gs…“ mit Namen aus der Übersicht (u.course.short); beschriftet mit „Grundschule“, Klick öffnet den Kurs
    const gs = !!u && u.subject === GS_SUBJECT && isGsCourseId(u.klass) && !!u.course && typeof u.course.short === "string";
    if (!u || (!gs && (!isValidSubject(u.subject) || !isValidClass(u.klass)))) continue;
    const who = gs ? { subjectShort: "Grundschule", label: str(u.course.short, 60), gs: true } : { subjectShort: subjectShort(u.subject), label: classShort(u.klass) };
    const p = normalizeParams(u.params);
    if (!p.start || !p.end || p.end < p.start || !p.weekdays.length || p.end < monday || p.start > friday) continue;
    const from = p.start > monday ? p.start : monday, to = p.end < friday ? p.end : friday;
    const nth = new Map();   // zwei Stunden derselben Einheit am selben Tag (auch ohne Uhrzeit) bleiben zwei Einträge
    for (const s of computeSlots({ ...p, start: from, end: to })) {
      const day = days.find((d) => d.date === s.date);
      if (!day) continue;
      const base = u.subject + "|" + u.klass + "|" + s.date + "|" + (s.time || ""), k = (nth.get(base) || 0) + 1;
      nth.set(base, k);
      const key = base + "#" + k;   // die k-te Stunde dieser Klasse zu dieser Zeit – gleich in überlappenden Einheiten
      const old = byKey.get(key);
      if (old) {   // dieselbe Klasse zur selben Zeit aus einer zweiten Einheit
        if (!old.unitIds.includes(u.id)) old.unitIds.push(u.id);
        if (s.kind === "klausur") old.kind = "klausur";
        if (s.minutes > old.minutes) { old.minutes = s.minutes; if (old.start != null) { old.end = Math.min(24 * 60, old.start + s.minutes); old.endTime = minutesClock(old.end); } }
        continue;
      }
      const start = clockMinutes(s.time), end = start == null ? null : Math.min(24 * 60, start + s.minutes);
      const e = { key, date: s.date, day: day.day, time: s.time || null, endTime: end == null ? null : minutesClock(end), start, end, minutes: s.minutes, kind: s.kind,
        subject: u.subject, ...who, klass: u.klass, title: str(u.title, 200), unitIds: [u.id],
        href: gs ? "#/lk/grundschule/k/" + u.klass : "#/lk/f/" + u.subject + "/" + u.klass };
      byKey.set(key, e);
      (e.time ? day.timed : day.untimed).push(e);
    }
    // Ausfall laut Einheit (Ferien, Exkursion …): an Tagen im Zeitraum mit Unterricht nach Stundenplan, die in einen Ausfall fallen
    for (const day of days) {
      if (day.date < from || day.date > to || !p.weekdays.some((w) => w.day === day.day)) continue;
      const b = p.breaks.find((x) => day.date >= x.from && day.date <= x.to);
      if (b && !day.off.some((o) => o.subject === u.subject && o.klass === u.klass))
        day.off.push({ subject: u.subject, subjectShort: who.subjectShort, klass: u.klass, label: who.label, reason: b.label || "" });
      // Krankmeldung (Grundschule): der ausgefallene Termin – nur, wenn er sonst nach Stundenplan stattgefunden hätte
      else if (!b && p.weekdays.some((w) => w.day === day.day && isCancelled(p, day.date, w.time, p.weekdays.filter((x) => x.day === day.day).length === 1)) && !day.off.some((o) => o.subject === u.subject && o.klass === u.klass))
        day.off.push({ subject: u.subject, subjectShort: who.subjectShort, klass: u.klass, label: who.label, reason: "Unterricht ausgefallen", cancelled: true });
    }
  }
  const order = (a, b) => (a.subjectShort < b.subjectShort ? -1 : a.subjectShort > b.subjectShort ? 1 : a.label.localeCompare(b.label, "de", { numeric: true }));
  for (const d of days) {
    d.timed.sort((a, b) => a.start - b.start || order(a, b)); d.untimed.sort(order);
    // findet die Klasse an dem Tag doch statt (eine zweite Einheit ohne diesen Ausfall), ist sie nicht „entfallen“
    // (ein ausgefallener Termin bleibt sichtbar, auch wenn am selben Tag eine zweite Stunde stattfindet)
    d.off = d.off.filter((o) => o.cancelled || ![...d.timed, ...d.untimed].some((e) => e.subject === o.subject && e.klass === o.klass)).sort(order);
  }
  return { monday, friday, days };
}
/* Welche Woche zeigt der Kalender zuerst? Die laufende – am Wochenende die kommende (Montag bis Freitag). */
export const calendarWeek = (today) => { const m = mondayOf(today); return isWeekend(today) ? addDays(m, 7) : m; };
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const dmy = (iso) => [Number(iso.slice(8, 10)), Number(iso.slice(5, 7)) - 1, iso.slice(0, 4)];
/* „9.–13. November 2026“, „30. November – 4. Dezember 2026“, „28. Dezember 2026 – 1. Januar 2027“ */
export function weekRangeText(monday) {
  const [d1, m1, y1] = dmy(monday), [d2, m2, y2] = dmy(addDays(monday, 4));
  if (y1 !== y2) return d1 + ". " + MONTHS[m1] + " " + y1 + " – " + d2 + ". " + MONTHS[m2] + " " + y2;
  if (m1 !== m2) return d1 + ". " + MONTHS[m1] + " – " + d2 + ". " + MONTHS[m2] + " " + y2;
  return d1 + ".–" + d2 + ". " + MONTHS[m2] + " " + y2;
}
export const dayMonthText = (iso) => { const [d, m] = dmy(iso); return d + ". " + MONTHS[m]; };   // „9. November“
/* Überschneidungen je Tag nebeneinander: lane (0 …) und lanes (Zahl der Spuren in der Gruppe). minSpan = Mindesthöhe eines Eintrags in Minuten
   (kurze Stunden werden höher gezeichnet als ihre Dauer und dürfen den nächsten Eintrag nicht verdecken). entries nach start sortiert. */
export function assignLanes(entries, minSpan = 0) {
  let group = [], groupEnd = -1, laneEnds = [];
  const flush = () => { for (const e of group) e.lanes = Math.max(1, laneEnds.length); group = []; laneEnds = []; };
  for (const e of entries) {
    const end = Math.max(e.end, e.start + minSpan);
    if (group.length && e.start >= groupEnd) flush();
    let lane = laneEnds.findIndex((x) => x <= e.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
    e.lane = lane; group.push(e); groupEnd = Math.max(groupEnd, end);
  }
  flush();
  return entries;
}
/* exam: false = ohne Zeile „Klausurtermin“ (Grundschule) */
export function paramsText(raw, { exam = true } = {}) {
  const p = normalizeParams(raw);
  const lines = [];
  if (p.weekdays.length) lines.push("Stundenplan: " + p.weekdays.map((w) => wdName(w.day) + (w.time ? " ab " + w.time + " Uhr" : "") + " (" + w.minutes + " Minuten)").join(", "));
  if (p.start || p.end) lines.push("Zeitraum der Einheit: " + (p.start ? fmtDay(p.start) : "?") + " bis " + (p.end ? fmtDay(p.end) : "?") + " (bis dahin soll die Einheit abgeschlossen sein)");
  if (exam) lines.push("Klausurtermin: " + (p.exam ? fmtDay(p.exam) : "keiner angegeben"));
  if (p.breaks.length) lines.push("Ferien/Ausfälle: " + p.breaks.map((b) => (b.label ? b.label + " " : "") + fmtDay(b.from) + (b.to !== b.from ? "–" + fmtDay(b.to) : "")).join("; "));
  if (p.cancelled) lines.push("Ausgefallene Termine (Krankmeldung): " + p.cancelled.map((c) => fmtDay(c.date) + (c.time ? " " + c.time : "")).join("; "));
  if (p.notes) lines.push("Hinweise der Lehrkraft: " + p.notes);
  return lines.join("\n");
}

/* ---------- Plan der Einheit (Leupold-Schema + Tabelle) ---------- */
// plan = { titel, thema, planungsgrundlage: {name, begruendung, alternative?: {name, begruendung}}, lernaufgabe, ausgangslage,
//          schritte: [{titel, beschreibung}] }, rows = [{uid, stundenfrage, ablauf: [..], schritt, date, minutes}]
export function normalizePlan(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const pg = p.planungsgrundlage && typeof p.planungsgrundlage === "object" ? p.planungsgrundlage : { name: str(p.planungsgrundlage) };
  const alt = pg.alternative && typeof pg.alternative === "object" ? { name: str(pg.alternative.name, 120), begruendung: str(pg.alternative.begruendung, 2000) } : null;
  return {
    titel: str(p.titel || p.title, 200).trim(), thema: str(p.thema, 500).trim(),
    planungsgrundlage: { name: str(pg.name, 120).trim(), begruendung: str(pg.begruendung, 3000).trim(), ...(alt && alt.name ? { alternative: alt } : {}) },
    lernaufgabe: str(p.lernaufgabe, 4000).trim(), ausgangslage: str(p.ausgangslage, 4000).trim(),
    schritte: (Array.isArray(p.schritte) ? p.schritte : []).slice(0, 15).map((x) => ({ titel: str(x && x.titel, 160).trim(), beschreibung: str(x && x.beschreibung, 600).trim() })).filter((x) => x.titel || x.beschreibung),
  };
}
export function normalizeRows(raw, newUid) {
  return (Array.isArray(raw) ? raw : []).slice(0, 150).map((r) => {
    const ablauf = Array.isArray(r && r.ablauf) ? r.ablauf : str(r && r.ablauf).split("\n");
    const sch = r && r.schritt !== null && r.schritt !== undefined && r.schritt !== "" ? Number(r.schritt) : NaN;
    return {
      uid: typeof (r && r.uid) === "string" && /^[a-f0-9]{8}$/.test(r.uid) ? r.uid : newUid(),
      stundenfrage: str(r && r.stundenfrage, 400).trim(),
      ablauf: ablauf.map((x) => str(x, 400).replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean).slice(0, 15),
      schritt: Number.isInteger(sch) && sch >= 0 && sch < 15 ? sch : null,
      date: isIsoDate(r && r.date) ? r.date : null,
      minutes: Number.isInteger(Number(r && r.minutes)) && Number(r.minutes) >= 20 && Number(r.minutes) <= 240 ? Number(r.minutes) : null,
      time: isClockTime(r && r.time) ? r.time : null,
    };
  }).filter((r) => r.stundenfrage || r.ablauf.length);
}
/* Termine der Reihe nach auf Zeilen ohne Datum verteilen (bereits gesetzte Daten bleiben) */
export function assignDates(rows, slots) {
  const free = lessonSlots(slots).filter((s) => !rows.some((r) => r.date === s.date));
  let k = 0;
  return rows.map((r) => { if (r.date) return r; const sl = free[k++]; return sl ? { ...r, date: sl.date, minutes: r.minutes || sl.minutes, time: r.time || sl.time || null } : r; });
}

/* ---------- Krankmeldung in der Grundschule: Stunden rücken um einen Termin nach hinten (Wunsch der Lehrkraft vom 12.11.2026) ----------
 * Die ausgefallene Stunde und alle folgenden Stunden der Einheit bekommen der Reihe nach die nächsten freien Termine; was hinter das Ende der
 * Einheit rutscht, bleibt ohne Datum in der Einheit stehen (Entscheidung der Lehrkraft), bis sie bzw. Claude die Einheit überarbeitet.
 * Dieselbe Packfunktion verteilt die Termine nach einer Überarbeitung durch Claude (save_unit_plan mit uid) neu. */
// Termine stabil sortiert: nach Datum, dann Uhrzeit (ohne Uhrzeit zuerst), sonst in der bisherigen Reihenfolge
export const sortSlots = (slots) => (slots || []).map((s, i) => [s, i]).sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : (a[0].time || "") < (b[0].time || "") ? -1 : (a[0].time || "") > (b[0].time || "") ? 1 : a[1] - b[1])).map((x) => x[0]);
export const slotAfter = (a, pivot) => a.date > pivot.date || (a.date === pivot.date && (a.time || "") > (pivot.time || ""));
// Termine, die von Zeilen mit Datum belegt sind: je Zeile der erste noch freie Termin am selben Tag (zur selben Uhrzeit, wenn beide eine haben)
export function occupy(slots, rows) {
  const used = new Set();
  for (const r of rows) {
    if (!r || !r.date) continue;
    const k = slots.findIndex((s, i) => !used.has(i) && s.date === r.date && (r.time == null || s.time == null || s.time === r.time));
    if (k >= 0) used.add(k);
  }
  return used;
}
/* rows[0..start-1] bleiben; die Zeilen ab start bekommen der Reihe nach die freien Termine nach pivot ({date, time}; null = alle) – samt deren
   Länge; fehlt ein Termin, bleibt die Zeile ohne Datum (ihre Länge bleibt). slots: sortSlots(lessonSlots(computeSlots(params))) */
export function packFrom(rows, slots, start, pivot) {
  const used = occupy(slots, rows.slice(0, start));
  const free = slots.filter((s, i) => !used.has(i) && (!pivot || slotAfter(s, pivot)));
  return rows.map((r, i) => {
    if (i < start) return r;
    const s = free[i - start];
    return s ? { ...r, date: s.date, time: s.time || null, minutes: s.minutes } : { ...r, date: null, time: null, minutes: r.minutes ?? null };
  });
}
const cancelErr = (status, code, message) => Object.assign(new Error(message), { status, code });
// Termine, die noch nicht vorbei sind (Ende nach now; ohne Uhrzeit: heute oder später) – eine verschobene Stunde landet nie in der Vergangenheit
const upcoming = (slots, now) => slots.filter((s) => parentOpensAt({ date: s.date, startTime: s.time, durationMin: s.minutes }) > now);
/* Der Termin laut Stundenplan, den die Sitzung X (Zeile s) belegt – daySlots: die Termine ihres Tages (sortiert). Derselbe Beginn; sonst der
   einzige Termin des Tages; sonst der nächstgelegene, den keine andere Zeile belegt. So trifft die Krankmeldung auch dann den Termin, wenn der
   Beginn der Sitzung von Hand geändert wurde (z. B. 07:50 statt 08:00; Abschlussprüfung F04). null = an diesem Tag kein Termin. */
function slotOfLesson(daySlots, rows, s, X) {
  if (!daySlots.length) return null;
  const exact = daySlots.find((d) => (d.time || null) === (X.time || null));
  if (exact) return exact;
  if (daySlots.length === 1) return daySlots[0];
  const used = occupy(daySlots, rows.filter((r, i) => i !== s && r && r.date === X.date));
  const free = daySlots.filter((_, i) => !used.has(i)), cand = free.length ? free : daySlots, m = clockMinutes(X.time);
  if (m == null) return cand[0];
  const dist = (d) => { const t = clockMinutes(d.time); return t == null ? Infinity : Math.abs(t - m); };
  return cand.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}
/* Krankmeldung für die Sitzung lessonId. lessons = Sitzungen der Einheit [{id, title, date, time, row, minutes, cancelled}], now = ms.
   → {params (mit dem neuen Ausfall), rows, s (Index der Zeile), moves: [{uid, n, title, lessonId|null, from:{date,time,minutes}, to|null}],
      undated: [uid], undatedRows: [{uid, n, title}], lengthChanges: [{uid, n, title, from, to}], cancelled: {date, time, minutes} (die Sitzung),
      slot: {date, time} (der ausgefallene Termin laut Stundenplan – so steht er in params.cancelled)}
   Wirft Fehler mit status/code: no_row, too_many, already_held (eine der folgenden Stunden hat schon stattgefunden). */
export function planCancellation({ params, rows, lessons, lessonId, now = Date.now() }) {
  const p = normalizeParams(params), list = Array.isArray(lessons) ? lessons : [];
  const X = list.find((l) => l.id === lessonId);
  if (!X || !X.row) throw cancelErr(400, "no_unit", "Diese Sitzung gehört zu keiner Einheit – bitte das Datum von Hand ändern.");
  if (!X.date) throw cancelErr(400, "no_date", "Diese Sitzung hat keinen Termin.");
  if (X.cancelled) throw cancelErr(400, "already_cancelled", "Diese Sitzung ist bereits ausgefallen.");
  const s = rows.findIndex((r) => r.uid === X.row);
  if (s < 0) throw cancelErr(400, "no_row", "Die Zeile dieser Sitzung steht nicht mehr in der Einheit – bitte das Datum von Hand ändern.");
  if ((p.cancelled || []).length >= CANCEL_MAX) throw cancelErr(400, "too_many", "Zu viele Ausfälle in dieser Einheit (höchstens 60).");
  const sl = slotOfLesson(sortSlots(lessonSlots(computeSlots({ ...p, start: X.date, end: X.date }))), rows, s, X);
  const slot = { date: X.date, time: sl ? sl.time || null : X.time || null };
  const p2 = { ...p, cancelled: [...(p.cancelled || []), slot] };
  const byRow = new Map(list.filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
  // Die ausgefallene Stunde selbst darf schon vorbei sein (Krankmeldung im Nachhinein), die folgenden nicht
  for (const r of rows.slice(s + 1)) {
    const l = byRow.get(r.uid), open = l ? parentOpensAt({ date: l.date, startTime: l.time, durationMin: l.minutes }) : null;
    if (open != null && open <= now) throw cancelErr(409, "already_held", "Die Stunde „" + (l.title || r.stundenfrage || "") + "“ am " + fmtDay(l.date) + " hat schon stattgefunden – verschieben lässt sich nur, solange die folgenden Stunden noch ausstehen.");
  }
  const next = packFrom(rows, upcoming(sortSlots(lessonSlots(computeSlots(p2))), now), s, slot);
  const title = (r) => r.stundenfrage || (byRow.get(r.uid) || {}).title || "";
  const moves = [], lengthChanges = [];
  next.forEach((r, i) => {
    const o = rows[i];
    if (i < s || (o.date === r.date && (o.time || null) === (r.time || null) && (o.minutes ?? null) === (r.minutes ?? null))) return;
    const l = byRow.get(r.uid);
    moves.push({ uid: r.uid, n: i + 1, title: title(r), lessonId: l ? l.id : null, from: { date: o.date || null, time: o.time || null, minutes: o.minutes ?? null },
      to: r.date ? { date: r.date, time: r.time || null, minutes: r.minutes ?? null } : null });
    if (r.date && o.minutes && r.minutes && o.minutes !== r.minutes) lengthChanges.push({ uid: r.uid, n: i + 1, title: title(r), from: o.minutes, to: r.minutes });
  });
  const undatedRows = next.map((r, i) => ({ uid: r.uid, n: i + 1, title: title(r), date: r.date })).filter((r) => !r.date).map(({ uid, n, title }) => ({ uid, n, title }));
  return { params: p2, rows: next, s, moves, undated: undatedRows.map((r) => r.uid), undatedRows, lengthChanges,
    cancelled: { date: X.date, time: X.time || null, minutes: X.minutes ?? null }, slot };
}
/* Nach einer Überarbeitung (save_unit_plan mit uid, Grundschule): alle Stunden nach der letzten, die schon stattgefunden hat (bzw. ohne
   Sitzung: deren Datum vor heute liegt), bekommen der Reihe nach die freien Termine, die noch nicht vorbei sind. lessons wie bei planCancellation. → rows */
export function repackFuture({ params, rows, lessons, now = Date.now() }) {
  const byRow = new Map((Array.isArray(lessons) ? lessons : []).filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
  const today = berlinToday(now);
  let h = -1;
  rows.forEach((r, i) => {
    const l = byRow.get(r.uid);
    const open = l ? parentOpensAt({ date: l.date, startTime: l.time, durationMin: l.minutes }) : null;
    if (l ? open != null && open <= now : !!r.date && r.date < today) h = i;
  });
  return packFrom(rows, upcoming(sortSlots(lessonSlots(computeSlots(params))), now), h + 1, h >= 0 && rows[h].date ? { date: rows[h].date, time: rows[h].time || null } : null);
}
/* noch freie Termine bis zum Ende der Einheit (noch nicht vorbei; keine Zeile belegt sie) – für get_unit und den Überarbeitungs-Prompt */
export function freeSlots(params, rows, now = Date.now()) {
  const slots = sortSlots(lessonSlots(computeSlots(params))), used = occupy(slots, rows || []);
  return upcoming(slots.filter((s, i) => !used.has(i)), now);
}
/* die nächsten n Termine laut Stundenplan NACH dem Ende der Einheit (Ferien, Ausfälle und der Klausurtag wie computeSlots; nur Termine, die noch
   nicht vorbei sind) – für extend_unit und den Hinweis „neues Ende“ in den Prompts. Ohne Ende oder Stundenplan: [] */
export function slotsAfterEnd(params, n, now = Date.now()) {
  const p = normalizeParams(params);
  if (!p.end || !p.weekdays.length || !(n > 0)) return [];
  return upcoming(sortSlots(lessonSlots(computeSlots({ ...p, start: addDays(p.end, 1), end: addDays(p.end, 380) }))), now).slice(0, n);
}

/* ```einheit {…}``` in einer Antwort des Planungsassistenten: vorgeschlagene Änderung der Zeile dieser Stunde */
export function extractUnitChange(text) {
  const m = /```einheit\s*([\s\S]*?)```/i.exec(String(text || ""));
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]);
    const ablauf = Array.isArray(o.ablauf) ? o.ablauf.map((x) => str(x, 400).trim()).filter(Boolean).slice(0, 15) : [];
    const stundenfrage = str(o.stundenfrage, 400).trim();
    if (!stundenfrage && !ablauf.length) return null;
    return { stundenfrage, ablauf, begruendung: str(o.begruendung, 1000).trim() };
  } catch { return null; }
}
export const stripUnitBlock = (text) => String(text || "").replace(/```einheit\s*[\s\S]*?```/gi, "").trim();

/* Kontext der Einheit für eine Stunde (Chat, Prompts, Connector) */
export function unitContext(unit, rowUid) {
  if (!unit) return "";
  const plan = unit.plan || {}, rows = unit.rows || [];
  const idx = rows.findIndex((r) => r.uid === rowUid), row = idx >= 0 ? rows[idx] : null;
  const L = ["Unterrichtseinheit: " + (unit.title || plan.titel || "(ohne Titel)") + (plan.thema ? " – " + plan.thema : "")];
  if (plan.planungsgrundlage && plan.planungsgrundlage.name) L.push("Planungsgrundlage: " + plan.planungsgrundlage.name + (plan.planungsgrundlage.begruendung ? " (" + clip(plan.planungsgrundlage.begruendung, 600) + ")" : ""));
  if (plan.lernaufgabe) L.push("Zentrale Lernaufgabe (Ziel der Einheit): " + clip(plan.lernaufgabe, 1500));
  if (plan.ausgangslage) L.push("Ausgangslage der Lerngruppe: " + clip(plan.ausgangslage, 1200));
  if ((plan.schritte || []).length) {
    L.push("Lernschritte der Einheit (Leupold-Schema):");
    plan.schritte.forEach((s, i) => L.push((i + 1) + ". " + s.titel + (s.beschreibung ? " – " + s.beschreibung : "") + (row && row.schritt === i ? "   ← Lernschritt dieser Stunde" : "")));
  }
  if (row) {
    L.push("Diese Sitzung ist Stunde " + (idx + 1) + " von " + rows.length + (row.date ? " am " + fmtDay(row.date) : "") + (row.minutes ? " (" + row.minutes + " Minuten)" : "") + ":");
    L.push("  Stundenfrage: " + (row.stundenfrage || "(noch offen)"));
    if (row.ablauf.length) L.push("  Grober Ablauf laut Einheit (nur Inspiration):\n" + row.ablauf.map((a) => "  - " + a).join("\n"));
    if (idx > 0) L.push("  Vorige Stunde: " + rows[idx - 1].stundenfrage);
    if (idx < rows.length - 1) L.push("  Nächste Stunde: " + rows[idx + 1].stundenfrage);
  }
  return L.join("\n");
}
/* ---------- Offener Teil nach einem Zwischenstopp (Anforderung 13, beide Schulformen) ----------
 * ps = previousStop vom Server (GET lesson, prevStopInfo in worker/lessons.js): {id, title, date, portal, portalVersion, done, open, unitId, unitRow,
 *   sameUnit, unitTitle, row: {uid, n, total, stundenfrage, ablauf} | null, decision: {choice, at} | null, openFiles: [{id, name}] (Grundschule)}.
 * Knappe Objekte ({title, date, portal}) gehen auch (done/open aus dem Eintrag). opt = {gs, unitId (Einheit DIESER Sitzung), unit (mit params),
 * now}. Dieselben Regeln stehen im Prompt „Stunde mit Claude planen“ (Ich-Form der Lehrkraft), in get_lesson und im Backup-Chat. */
export { STOP_CHOICE_TEXT, STOP_CHOICES, stopDecidedOn };
export const stopDecisionOf = (ps) => (ps && ps.decision && STOP_CHOICE_TEXT[ps.decision.choice] ? ps.decision : null);
function stopPartsOf(ps) {
  if (typeof ps.done === "string" || typeof ps.open === "string") return { done: str(ps.done).trim(), open: str(ps.open).trim() };
  return stopParts(ps.portal);
}
// neues Ende bei einer Verlängerung um eine Stunde: der nächste Termin laut Stundenplan nach dem bisherigen Ende (oder null)
const nextEndOf = (opt) => { const s = opt.unit && opt.unit.params ? slotsAfterEnd(opt.unit.params, 1, opt.now || Date.now())[0] : null; return s ? s.date : null; };
const rowWhich = (r, gs) => "Stunde " + r.n + (gs ? " [uid " + r.uid + "]" : "");
// Was bekannt ist, in der Ich-Form der Lehrkraft (Prompt „Stunde mit Claude planen“)
function stopFacts(ps, opt) {
  const gs = !!opt.gs, p = stopPartsOf(ps), d = stopDecisionOf(ps), r = ps.row, out = [];
  out.push("In der vorigen Sitzung „" + str(ps.title) + "“" + (ps.date || ps.id ? " (" + [ps.date ? fmtDay(ps.date) : null, ps.id ? "Sitzungs-ID " + ps.id : null].filter(Boolean).join("; ") + ")" : "") +
    " habe ich einen Zwischenstopp markiert: Bis zur Zeile „" + STOP_LINE + "“ in " + (gs ? "ihrem Verlaufsplan" : "ihrem Schulportal-Eintrag") + " wurde die Stunde geschafft, alles danach ist noch offen.");
  if (r) out.push((ps.sameUnit === false ? "Sie gehört zu" + (opt.unitId ? " einer anderen Unterrichtseinheit („" + str(ps.unitTitle) + "“, ID " + str(ps.unitId) + ")" : "r Unterrichtseinheit „" + str(ps.unitTitle) + "“ (ID " + str(ps.unitId) + ")") +
    ", dort ist sie " : "In der Einheit ist sie ") +
    rowWhich(r, gs) + ": geplante Stundenfrage „" + str(r.stundenfrage) + "“" + ((r.ablauf || []).length ? "; geplanter grober Ablauf: " + r.ablauf.join("; ") : "") + ".");
  out.push("Geschafft (bis zum Zwischenstopp):\n<<<\n" + (p.done ? clip(p.done, 3000) : "(nichts – der Zwischenstopp steht am Anfang)") + "\n>>>");
  out.push("Nicht geschafft (nach dem Zwischenstopp):\n<<<\n" + (p.open ? clip(p.open, 4000) : "(nichts – der Zwischenstopp steht am Ende)") + "\n>>>");
  if (gs) out.push((ps.openFiles || []).length ? "Material nach dem Zwischenstopp (schon angelegt – verweise es mit seiner file_id weiter): " + ps.openFiles.map((f) => "„" + str(f.name) + "“ (file_id " + f.id + ")").join(", ") + "."
    : "Material aus dem offenen Teil verweist du weiter mit seiner file_id.");
  out.push(d ? "Stand: Ich habe am " + stopDecidedOn(d) + " entschieden: " + STOP_CHOICE_TEXT[d.choice] : "Stand: Ich habe noch nicht entschieden, ob der offene Teil in diese Stunde übernommen wird oder ob wir darauf verzichten.");
  return out;
}
// Was bekannt ist, sachlich (get_lesson und Backup-Chat) → Zeilen
function stopFactLines(ps, opt) {
  const gs = !!opt.gs, p = stopPartsOf(ps), d = stopDecisionOf(ps), r = ps.row;
  const out = ["Vorige Sitzung: „" + str(ps.title) + "“" + (ps.date ? " (" + fmtDay(ps.date) + ")" : "") + (ps.id ? ", Sitzungs-ID " + ps.id : "") + " – die Lehrkraft hat dort einen Zwischenstopp gesetzt (" +
    (gs ? "Verlaufsplan" : "Schulportal-Eintrag") + (Number.isInteger(ps.portalVersion) ? ", Version " + ps.portalVersion : "") + ")."];
  if (r) out.push((ps.sameUnit === false ? "Zeile der Einheit (" + (opt.unitId ? "andere " : "") + "Einheit „" + str(ps.unitTitle) + "“, unit_id " + str(ps.unitId) + "): " : "Zeile der Einheit: ") + rowWhich(r, gs) +
    " – geplante Stundenfrage: „" + str(r.stundenfrage) + "“", ...((r.ablauf || []).length ? ["Geplanter grober Ablauf:", ...r.ablauf.map((a) => "- " + a)] : []));
  else out.push("Die vorige Sitzung gehört zu keiner Zeile einer Unterrichtseinheit.");
  out.push("Geschafft (bis zum Zwischenstopp):", "<<<", p.done ? clip(p.done, 6000) : "(nichts – der Zwischenstopp steht am Anfang)", ">>>",
    "Nicht geschafft (nach dem Zwischenstopp):", "<<<", p.open ? clip(p.open, 6000) : "(nichts – der Zwischenstopp steht am Ende)", ">>>");
  if (gs) out.push("Material nach dem Zwischenstopp:", ...((ps.openFiles || []).length ? ps.openFiles.map((f) => "- file_id " + f.id + ": „" + str(f.name) + "“ → [[pdf:" + f.id + "]]") : ["(keines)"]));
  out.push("Entscheidung der Lehrkraft: " + (d ? "entschieden am " + stopDecidedOn(d) + ": " + (d.choice === "uebernehmen" ? "übernehmen" : "verzichten") + " – " + STOP_CHOICE_TEXT[d.choice] : "noch nicht entschieden"));
  return out;
}
/* Regeln (je ein Stichpunkt): erklären und fragen bzw. „schon entschieden“, Übernehmen (Inhalte rücken nach; verlängern oder kürzen mit drei
   Vorschlägen), Verzichten, die Einheit erst nach der bestätigten Stunde anpassen. opt.who = "ich" (Prompt in der Ich-Form der Lehrkraft) bzw. "lk"
   (get_lesson, Backup-Chat: über die Lehrkraft gesprochen); opt.save = false (Backup-Chat, ohne Connector): nichts speichern, Änderungen zum Übertragen nennen */
export function stopRules(ps, opt = {}) {
  const gs = !!opt.gs, d = stopDecisionOf(ps), unitId = opt.unitId || null, save = opt.save !== false, lk = opt.who === "lk", r = ps.row;
  const w = (ich, sie) => (lk ? sie : ich), want = (c) => !d || d.choice === c, sameRow = !!(r && unitId && ps.sameUnit !== false), out = [];
  const end = want("uebernehmen") && unitId ? nextEndOf(opt) : null;
  out.push(d ? w("Ich habe schon entschieden: ", "Die Lehrkraft hat schon entschieden: ") + STOP_CHOICE_TEXT[d.choice] + " (am " + stopDecidedOn(d) + "). Frage nicht erneut, außer " + w("ich möchte", "sie möchte") + " es ändern" +
      (save ? " (dann halte die neue Entscheidung mit `update_lesson` und `zwischenstopp` fest); passe die Einheit an, falls das noch nicht geschehen ist." : ".")
    : "Erkläre " + w("mir", "der Lehrkraft") + " zuerst in wenigen Stichpunkten, was in der vorigen Stunde nicht geschafft wurde (Inhalte, Aufgaben, Material nach dem Zwischenstopp). Frage " + w("mich", "sie") +
      ", ob du es in diese Stunde einbauen sollst oder ob " + w("wir darauf verzichten", "darauf verzichtet wird") + ". Warte auf " + w("meine", "ihre") + " Antwort" +
      (save ? " und halte sie mit `update_lesson` fest (`zwischenstopp`: \"uebernehmen\" oder \"verzichten\")." : "."));
  if (want("uebernehmen")) out.push(unitId ? "Übernehmen: Plane den offenen Teil in diese Stunde ein. Was dadurch in dieser Stunde keinen Platz mehr hat, rückt in die nächste Stunde der Einheit, deren Überhang in die übernächste usw. – " +
      "die Termine bleiben (keine Stunde einschieben, keine Sitzung verschieben). Zeige " + w("mir", "ihr") + ", welche Stunden der Einheit sich wie ändern. Am Ende der Einheit bleibt so ein Überhang: Frage " + w("mich", "sie") +
      ", ob die Einheit um eine Stunde verlängert werden kann" + (end ? " (neues Ende laut Stundenplan: " + fmtDay(end) + ")" : "") + " oder ob an einer Stelle gekürzt werden soll. Soll gekürzt werden: Mache " + w("mir", "ihr") + " genau drei Vorschläge, an welcher Stelle der Einheit gekürzt werden kann " +
      "(je mit den Folgen für die zentrale Lernaufgabe), nenne einen davon als Favoriten mit Begründung und warte auf " + w("meine", "ihre") + " Wahl."
    : "Übernehmen: Plane den offenen Teil in diese Stunde ein (diese Sitzung gehört zu keiner Unterrichtseinheit – es rückt nichts nach).");
  if (want("verzichten")) out.push("Verzichten: Plane die Stunde ohne den offenen Teil.");
  const adj = [];
  if (want("uebernehmen") && unitId) adj.push(!save
    ? "Übernehmen → die geänderten Stunden der Einheit" + (sameRow ? " (auch die Zeile der vorigen Stunde: was tatsächlich behandelt wurde)" : "") + "."
    : "Übernehmen → bei einer Verlängerung zuerst `extend_unit` (Einheit " + unitId + ", `base_version` aus `get_unit`, mit der zusätzlichen Stunde samt Stundenfrage und Ablauf), dann `update_unit_row` mit `unit_id` " + unitId +
      ", `base_version` (aus `get_unit` bzw. der Antwort von `extend_unit`) und `stunden` – in einer Speicherung " + (sameRow ? "die Zeile der vorigen Stunde (Ablauf = was tatsächlich behandelt wurde), " : "") +
      "diese Stunde und jede weitere geänderte Stunde, auch die gewählte Kürzung; je Stunde " + (gs ? "ihre `uid`" : "ihre Nummer `nr`") + " aus `get_unit`." +
      (r && !sameRow ? " Die Zeile der vorigen Stunde (andere Einheit) passt du mit `update_unit_row` und `lesson_id` " + ps.id + " an: Ablauf = was tatsächlich behandelt wurde." : ""));
  else if (want("uebernehmen") && r) adj.push((save ? "Übernehmen → `update_unit_row` mit `lesson_id` " + ps.id + " (Zeile der vorigen Stunde)" : "Übernehmen → die Zeile der vorigen Stunde") +
    ": Ablauf = was tatsächlich behandelt wurde (der offene Teil steht dann in dieser Sitzung).");
  if (want("verzichten") && r) adj.push((save ? "Verzichten → `update_unit_row` mit `lesson_id` " + ps.id + " (Zeile der vorigen Stunde)" : "Verzichten → die Zeile der vorigen Stunde") +
    ": Ablauf = was tatsächlich behandelt wurde, dazu ein Stichpunkt „Verzichtet: …“; die folgenden Stunden bleiben unverändert.");
  if (adj.length) out.push(!save
    ? "Du kannst in der Plattform nichts speichern: Nenne " + w("mir", "der Lehrkraft") + " am Ende, was " + w("ich", "sie") + " in der Einheit ändern muss, als Tabelle zum Übertragen (Stunde, Stundenfrage, grober Ablauf): " + adj.join(" ") +
      (want("uebernehmen") && unitId ? " Bei einer Verlängerung nenne " + w("mir", "ihr") + " auch das neue Ende für die Rahmendaten" + (end ? " (laut Stundenplan der nächste Termin nach dem bisherigen Ende: " + fmtDay(end) + ")" : "") + "." : "")
    : "Erst wenn " + w("ich die Planung dieser Stunde bestätigt habe", "die Lehrkraft die Planung dieser Stunde bestätigt hat") + " und du sie gespeichert hast, passt du die Einheit an: " + adj.join(" ") +
      " Sage " + w("mir", "ihr") + " danach, was sich in der Einheit geändert hat.");
  return out;
}
// Abschnitt des Prompts „Stunde mit Claude planen“ (Gymnasium: Schulportal-Eintrag; Grundschule: Verlaufsplan)
export const stopCarrySection = (ps, opt = {}) => "\n## Vorige Stunde nicht vollständig beendet\n" + stopFacts(ps, opt).join("\n");
// Schritt im Vorgehen (direkt nach dem Lesen mit get_lesson, vor der Frage nach Dauer und Wünschen)
export const stopCarryStep = (ps, n, opt = {}) => n + ". Zur vorigen Stunde (Zwischenstopp, siehe oben) – bevor du nach Dauer und Wünschen fragst:\n" + stopRules(ps, opt).map((x) => "   - " + x).join("\n");
// Satz für den Rückfall ohne Connector (andere KI): Änderungen der Einheit als Tabelle zum Übertragen, bei einer Verlängerung das neue Ende
export function stopFallbackText(ps, opt = {}) {
  const d = stopDecisionOf(ps), want = (c) => !d || d.choice === c, ext = want("uebernehmen") && !!opt.unitId;
  if (!ext && !ps.row) return "";   // sonst ändert sich die Zeile der vorigen Stunde (verzichten bzw. übernehmen ohne Einheit dieser Sitzung)
  const end = ext ? nextEndOf(opt) : null;
  return " Ändert sich wegen des offenen Teils der vorigen Stunde die Einheit, gib mir die geänderten Zeilen als Tabelle (Stunde, Stundenfrage, grober Ablauf) zum Übertragen aus" +
    (ext ? " und sage mir bei einer Verlängerung, welches neue Ende ich in den Rahmendaten eintrage" + (end ? " (laut Stundenplan der nächste Termin nach dem bisherigen Ende: " + fmtDay(end) + ")" : "") : "") + ".";
}
/* Abschnitt von get_lesson (Connector, beide Schulformen): die Fakten im Wortlaut und kurz die Regeln – auch für einen Prompt, der kopiert
   wurde, bevor die Lehrkraft den Zwischenstopp gesetzt hat. → Zeilen */
export const stopLessonLines = (ps, opt = {}) => ["", "## Vorige Stunde nicht vollständig beendet", ...stopFactLines(ps, opt),
  "So gehst du vor (auch wenn dein Prompt diesen Abschnitt nicht enthält):", ...stopRules(ps, { ...opt, who: "lk", save: true }).map((x) => "- " + x)];
/* Backup-Chat (kostenlose KI, kann nichts speichern): Abschnitt für den System-Prompt */
export const stopChatSection = (ps, opt = {}) => "\n\nVorige Stunde nicht vollständig beendet (automatisch übermittelt):\n" + stopFactLines(ps, opt).join("\n") +
  "\nSo gehst du damit um, sobald die Lehrkraft diese Stunde plant:\n" + stopRules(ps, { ...opt, who: "lk", save: false }).map((x) => "- " + x).join("\n");

/* ---------- Prompt für Claude: Unterrichtseinheit planen (claude.ai + Connector) ---------- */
export function claudeUnitPrompt(ctx) {
  const g = gradeInfo(ctx.klass), slots = lessonSlots(ctx.slots || []), powi = ctx.subject === "powi";
  const list = slots.map((s, i) => (i + 1) + ". " + fmtDay(s.date) + " (" + s.minutes + " min)").join("\n");
  const exams = (ctx.slots || []).filter((s) => s.kind === "klausur").map((s) => fmtDay(s.date)).join(", ");
  const steps = [];
  let n = 1;
  steps.push(n++ + ". Rufe zuerst mit dem Connector „Unterricks“ `get_planning_basis` für die Einheit " + ctx.unitId + " auf und lies die Planungsgrundlagen gründlich. Beziehe dich bei allen Vorschlägen auf die fachdidaktischen Prinzipien und didaktischen Vorgaben dieses Schuljahres und vor allem auf die Vorgaben zu den Unterrichtsinhalten.");
  if (powi) steps.push(n++ + ". Frage mich, mit welcher Planungsgrundlage ich an die Einheit herangehen möchte (z. B. Konfliktanalyse, Problemstudie, Fallanalyse/Fallbeispiel, Systemanalyse, Zukunftswerkstatt, Planspiel). Mache unter Berücksichtigung des Alters der Schüler:innen und des Themas einen **priorisierten** und einen **sekundären** Vorschlag und begründe zu jedem kurz, wie man sich die Einheit damit vorstellen kann. Warte auf meine Entscheidung.");
  else steps.push(n++ + ". Kläre mit mir kurz Thema und Schwerpunkt der Einheit im Rahmen der Vorgaben und warte auf meine Entscheidung.");
  steps.push(n++ + ". Schlage mir **drei** zentrale Lernaufgaben vor (kompetenzorientiert, mit Lernprodukt, passend zur Jahrgangsstufe). Die zentrale Lernaufgabe ist das Ziel der Unterrichtseinheit. Warte, bis ich eine festlege – ohne festgelegte Lernaufgabe entwickelst du noch keinen Ablauf.");
  steps.push(n++ + ". Entwickle dann das **Leupold-Schema**: links die Ausgangslage der Lerngruppe (Lernvoraussetzungen und angestrebter Kompetenzschwerpunkt), in der Mitte die Lernschritte der Einheit als Abfolge von Paaren aus Tätigkeitsbeschreibung mit Operatoren (z. B. „Sachtext auswerten, Kategorien strukturieren und im Austausch erweitern“) und knappem Schritt-Titel (z. B. „Problemstudie: Akteure und Interessen“), rechts die festgelegte Lernaufgabe. Die Lernschritte führen folgerichtig von der Ausgangslage zur Lernaufgabe.");
  steps.push(n++ + ". Stelle darauf aufbauend den Ablauf der Unterrichtseinheit **tabellarisch** dar: genau " + slots.length + " Zeilen, eine je verfügbarer Sitzung in zeitlicher Reihenfolge. Spalte 1: Stundenfrage, Spalte 2: grober Stundenablauf in Stichpunkten. Ordne jede Stunde einem Lernschritt zu; die letzten Stunden münden in die zentrale Lernaufgabe." + (exams ? " Berücksichtige die Klausur am " + exams + "." : ""));
  steps.push(n++ + ". Wenn ich zufrieden bin, speichere das Ergebnis mit `save_unit_plan` in der Einheit " + ctx.unitId + " (Planungsgrundlage, Lernaufgabe, Ausgangslage, Lernschritte und die Stunden mit Stundenfrage, Ablauf und Nummer des Lernschritts). Ich prüfe und bearbeite den Plan danach in der Plattform; die Sitzungen legt die Plattform mit den Terminen an.");
  return [
    "Du bist eine erfahrene Fachdidaktikerin bzw. ein erfahrener Fachdidaktiker für " + subjectName(ctx.subject) + " an einem Gymnasium in Hessen und planst mit mir eine Unterrichtseinheit. Arbeite gründlich, fachlich korrekt und dialogisch: Gehe Schritt für Schritt vor und warte an den markierten Stellen auf meine Entscheidung.",
    "",
    "## Rahmendaten (von der Plattform erfasst)",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + classShort(ctx.klass) + " – " + g.text,
    Number.isInteger(ctx.classSize) ? "- Schülerzahl: " + ctx.classSize + " (laut Kurseinstellungen)" : "",
    ctx.title ? "- Thema/Arbeitstitel der Einheit: " + ctx.title : "- Thema: noch offen (aus den Vorgaben ableiten und mit mir abstimmen)",
    paramsText(ctx.params).split("\n").map((l) => "- " + l).join("\n"),
    "- Verfügbare Sitzungen bis zum Ende der Einheit: " + slots.length + (slots.length ? "\n" + list : ""),
    "",
    "## Vorgaben",
    ctx.rules ? ctx.rules.split("\n").map((l) => "- " + l).join("\n") : "- (keine fachspezifischen Hinweise hinterlegt)",
    ctx.gradeNote ? "- " + ctx.gradeNote : "",
    isAnalogClass(ctx.klass) ? "- " + ANALOG_RULE : "",
    ctx.bases && ctx.bases.length ? "- Hinterlegte Planungsgrundlagen: " + ctx.bases.join("; ") : "- Es sind noch keine Planungsgrundlagen hinterlegt – sage mir, welche Dateien fehlen, und plane bis dahin nur mit ausdrücklich gekennzeichneten Annahmen.",
    ctx.missing && ctx.missing.length ? "- Es fehlen noch: " + ctx.missing.join("; ") + " – kennzeichne, wo du deshalb ohne Vorgabe planst." : "",
    "",
    "## Vorgehen",
    ...steps,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (er muss in claude.ai unter „Connectors“ eingerichtet und im Chat aktiviert sein).",
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- Prompt für Claude: eine Stunde planen (Hauptweg der Lehrkraft; claude.ai + Connector) ----------
 * ctx wie in der Sitzungsansicht (lessonId, subject, klass, lesson, materials, sheets, portal, unit, row, unitText, gradeNote)
 * + messages (Planungsverlauf der Plattform) + previousStop ({title, date, portal} der vorigen Stunde mit Zwischenstopp) */
/* Name des Chats in claude.ai, z. B. „Jg. 8 - PoWi - Sitzung 1 - Das Bundesverfassungsgericht“: Lerngruppe, Fach, Stunde in der
 * Unterrichtseinheit (ohne Einheit entfällt sie), Titel der Sitzung */
export function lessonChatName(ctx) {
  const L = (ctx && ctx.lesson) || {}, rows = (ctx && ctx.unit && ctx.unit.rows) || [];
  const i = ctx && ctx.row ? rows.findIndex((r) => r && r.uid === ctx.row.uid) : -1;
  const title = str(L.title).replace(/\s+/g, " ").trim().slice(0, 90);
  return [groupShort(ctx && ctx.klass), subjectShort(ctx && ctx.subject), i >= 0 ? "Sitzung " + (i + 1) : null, title || null].filter(Boolean).join(" - ");
}

export function claudeLessonPrompt(ctx) {
  const L = ctx.lesson || {}, analog = isAnalogClass(ctx.klass), unit = !!ctx.unitText, id = ctx.lessonId, chatName = lessonChatName(ctx);
  const minutes = L.durationMin || (ctx.row && ctx.row.minutes) || null;
  const chat = (ctx.messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && m.model !== "begruessung");
  const lastAnswers = chat.filter((m) => m.role === "assistant").slice(-2).map((m) => str(m.content).trim()).join("\n\n---\n\n");
  const ps = ctx.previousStop, stopOpt = { gs: false, unitId: ctx.unit && ctx.unit.id ? ctx.unit.id : null, unit: ctx.unit, now: ctx.now };
  // mit Zwischenstopp der vorigen Stunde: ein eigener Schritt direkt nach get_lesson – die folgenden rücken eine Nummer weiter (ohne bleibt alles gleich)
  const k = (n) => (ps && n >= 2 ? n + 1 : n) + ". ";
  const saves = [
    "   - Stundenverlauf → `save_schulportal_entry` (Schulportal-Zeichen: " + PORTAL_RULES.join("; ") + "; Aufbau genau wie in der Vorlage unten; " + PORTAL_TEACHER_RULE + " übergib `base_version` aus `get_lesson` – meldet die Plattform eine neuere Fassung, rufe `get_lesson` erneut auf und berücksichtige meine Änderungen).",
    "   - Ausgearbeiteter Stundenentwurf (Verlauf mit Minuten, Begründung, Erwartungen) → `save_planning_result` (erscheint im Planungsverlauf der Sitzung; darauf bauen der Präsentations-Prompt und spätere Planungen auf).",
    "   - Arbeitsblätter und alle anderen Materialien als Datei gestaltest du selbst als HTML-Seite (Gestaltungsregeln unten) und legst sie mit `add_material_pdf` ab – Unterricks druckt sie unverändert als A4-PDF und meldet dir die Seitenzahl. `bereich` \"schueler\": für die Schüler:innen" + (analog ? " (in dieser Jahrgangsstufe nur, wenn ich es ausdrücklich möchte – sonst \"druck\")" : ", z. B. für GoodNotes") + "; \"lehrkraft\": nur für mich, z. B. Erwartungshorizont, Lösungen oder Tafelbild.",
    "   - Alles, was ich vor der Stunde ausdrucken muss (z. B. Arbeitsblätter" + (analog ? " – in dieser Jahrgangsstufe alles Material für die Schüler:innen" : "") + ", Karten, Schaubilder oder Kärtchen für die Tafel) → `add_material_pdf` mit `bereich` \"druck\", " + (Number.isInteger(ctx.classSize) ? "`anzahl` (laut Kurseinstellungen " + ctx.classSize + " Schüler:innen)" : "`anzahl` (frag mich nach der Klassengröße, wenn du sie nicht kennst)") + ", `beidseitig` (false, wenn geschnitten wird) und `farbe` (nur, wenn Farbe unbedingt nötig ist – an der Schule wird fast immer schwarz-weiß gedruckt). Gedruckt wird nur A4.",
    "   - Meldet `add_material_pdf` einen Druckfehler, korrigiere die Gestaltung und sende sie mit `file_id` erneut. Nur wenn der PDF-Druck gar nicht funktioniert, nimm als Rückfall `add_text_material` bzw. `add_print_material` (Markdown, ohne eigene Gestaltung).",
    analog ? null : "   - Feibeitsblatt → `propose_feibeitsblatt` (nur ein Entwurf: Ich prüfe ihn in der Plattform und lege das Blatt dort an).",
    "   - Hausaufgabe bis zur nächsten Sitzung → `update_lesson` mit `hausaufgabe` (für die Schüler:innen sichtbar; Schulportal-Zeichen erlaubt). Geänderte Sitzungsdaten (Titel, Thema, Dauer) ebenfalls mit `update_lesson`.",
    unit ? "   - Abgestimmte Abweichung von der Einheit (Stundenfrage, grober Ablauf) → `update_unit_row`." : null,
  ];
  return [
    "Chat-Name: " + chatName,
    "",
    SYSTEM_PROMPT_ROLE,
    "",
    "Die Lehrkraft bin ich. Wir planen zusammen die folgende Unterrichtssitzung meiner Unterrichtsplattform „Unterricks“. Über den Connector „Unterricks“ liest du sie und speicherst Ergebnisse auf meinen Wunsch direkt dort. Arbeite gründlich und fachlich korrekt.",
    "",
    "## Die Sitzung (von der Plattform übermittelt)",
    "Sitzungs-ID: " + id,
    lessonContext(ctx, { materialText: false }),
    ps ? stopCarrySection(ps, stopOpt) : null,
    chat.length ? "\n## Bisheriger Planungsverlauf in der Plattform (Auszug; vollständig über `get_lesson`)" +
      (chat.some((m) => m.role === "user") ? "\nWünsche, die ich dort geäußert habe:\n" + teacherWishes(chat, 4000) : "") +
      (lastAnswers ? "\nLetzter Stand:\n<<<\n" + clip(lastAnswers, 12000) + "\n>>>" : "") : null,
    "",
    "## Feste Vorgaben",
    "- Plane mit Minutenangaben je Phase, die zusammen die Dauer der Sitzung ergeben, und nenne Methode und Sozialform.",
    "- Formuliere Materialien (Arbeitsaufträge mit Operatoren, Texte, Tafelbild bzw. Ergebnissicherung, Erwartungshorizont) vollständig aus, wenn ich das möchte, damit ich sie direkt übernehmen kann.",
    unit ? "- " + UNIT_RULE_BASE + " Stimme ich einer geänderten Stundenfrage oder einem geänderten groben Ablauf zu, halte das mit `update_unit_row` in der Einheit fest." : null,
    analog ? "- " + ANALOG_RULE
      : "- Schlage bewusst auch vor, statt eines klassischen Arbeitsblatts ein Feibeitsblatt zu erstellen, wenn es didaktisch passt. " + FEIBEITSBLATT_INFO +
        " Für ein Lernprodukt (z. B. ein Plakat) kann eine Aufgabe die Antwortart „foto“ haben: Die Schüler:innen geben ein Foto ihres Produkts ab (nie an die KI, ohne „Auftrag an die KI“; höchstens 3 Foto-Aufgaben je Feibeitsblatt).",
    "- Erfinde keine Quellen, Links oder Videos; kennzeichne Vorschläge, die ich prüfen sollte.",
    "",
    "## Gestaltungsregeln für Materialien (add_material_pdf)",
    materialDesignText(),
    analog ? "- Diese Lerngruppe ist " + gradeInfo(ctx.klass).text + ": Grundschrift mindestens 13 pt, große Schreiblinien (10–11 mm), viel Weißraum, kurze Sätze." : null,
    "",
    "## Vorgehen",
    "0. Dieser Chat soll „" + chatName + "“ heißen. Beginne deine erste Antwort mit der Zeile „Chat-Name: " + chatName + "“ (umbenennen kann ich den Chat in claude.ai nur selbst).",
    "1. Rufe zuerst mit dem Connector „Unterricks“ `get_lesson` mit der Sitzungs-ID " + id + " auf: Dort stehen die aktuellen Daten, alle Materialien im Wortlaut, der bisherige Planungsverlauf und der Schulportal-Eintrag mit seiner Version." +
      (ctx.unit && ctx.unit.id ? " Die ganze Unterrichtseinheit (Leupold-Schema, alle Stunden) liefert `get_unit` mit der ID " + ctx.unit.id + "." : "") +
      " Brauchst du die Vorgaben im Wortlaut (Schulcurriculum, KCGO, Abiturerlass), liefert sie `get_planning_basis` mit der Sitzungs-ID.",
    ps ? stopCarryStep(ps, 2, stopOpt) : null,
    k(2) + "Frage mich dann nach der Dauer (" + (minutes ? "laut Plattform " + minutes + " Minuten – stimmt das?" : "in der Plattform noch nicht eingetragen") + ") und nach Ideen, Themen, Materialien oder didaktischen Wünschen. Warte auf meine Antwort.",
    k(3) + "Plane mit mir dialogisch, bis ich zufrieden bin.",
    k(4) + "Speichere nur, was ich freigebe, direkt in der Plattform:",
    ...saves,
    k(5) + "Sage mir zum Schluss kurz, was du gespeichert hast. Die Präsentation erstelle ich danach in der Plattform mit „Präsentation mit Claude erstellen“ – deren Prompt baut auf dem gespeicherten Schulportal-Eintrag auf.",
    "",
    "Vorlage für den Schulportal-Eintrag (so sieht der fertige Eintrag aus):",
    PORTAL_EXAMPLE,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (beim ersten Mal muss er im Chat verbunden und sein Zugriff erlaubt werden). Plane dann mit den Angaben oben und gib mir den Schulportal-Eintrag am Ende zum Kopieren aus." +
      (ps ? stopFallbackText(ps, stopOpt) : ""),
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- Krankheitsvertretung ---------- */
export const SUBSTITUTE_SHARE = 0.8;   // Vorgabe: ca. 80 % der Unterrichtszeit für die Bearbeitung
export const DEFAULT_SUBSTITUTE_NOTICE = "Deine Lehrkraft kann heute nicht persönlich im Unterricht sein. Bitte bearbeite die folgenden Vertretungsaufgaben selbstständig der Reihe nach.";
export function claudeSubstitutePrompt(ctx) {
  const L = ctx.lesson || {}, minutes = L.durationMin || (ctx.row && ctx.row.minutes) || 45, work = Math.round(minutes * SUBSTITUTE_SHARE);
  const analog = isAnalogClass(ctx.klass);
  const formats = analog
    ? ["- " + ANALOG_RULE, "- Abgabe: ein ausgefülltes Arbeitsblatt (oder ein kleines Lernprodukt auf Papier), das die Vertretungslehrkraft einsammelt."]
    : ["- Kreative Selbstlern-Formate sind ausdrücklich erwünscht, z. B. ein Escape-Room" + (ctx.escape ? " (nach der Vorlage der Plattform – Inhalt im Feld `escape_room`, Finale ist automatisch ein Feibeitsblatt)" : " (zurzeit noch nicht über die Plattform verfügbar)") + ", ein Feibeitsblatt (" + FEIBEITSBLATT_INFO + ") oder ein Lernprodukt.",
      "- Entscheidest du dich für ein Lernprodukt (z. B. ein Plakat), führt ein Feibeitsblatt die Schüler:innen durch den Planungsprozess des Lernprodukts und enthält eine Aufgabe mit der Antwortart „Foto“ (`antwort: \"foto\"`), in der sie ein Foto ihres Lernprodukts abgeben. Fotos gehen nie an die KI (kein `ki_auftrag`); höchstens 3 Foto-Aufgaben je Feibeitsblatt.",
      "- Jede Vertretungsstunde enthält eine Abgabe in der Plattform: " + (ctx.escape ? "ein Feibeitsblatt, ein Escape-Room mit Feibeitsblatt-Finale oder ein Feibeitsblatt mit Foto-Abgabe." : "ein Feibeitsblatt (bei einem Lernprodukt mit Foto-Abgabe)."),
      ...(ctx.escape ? ["- Wählst du einen Escape-Room, liefere ihn vollständig im Feld `escape_room` (statt `feibeitsblatt`). Die Plattform hostet ihn in ihrer Vorlage. " + ESCAPE_FORMAT_HINT.replace(/\n/g, " ") +
        " Plane ihn so, dass er mit dem Finale in die Bearbeitungszeit passt (ca. 5–8 Minuten je Station). In der Anleitung für die Schüler:innen: Escape-Room in der Sitzung mit „Escape-Room starten“ öffnen, Stationen der Reihe nach bearbeiten (Notizen machen), am Ende durch den Tunnel ins Feibeitsblatt und dort abgeben."] : [])];
  return [
    "Ich bin krank und kann die folgende Unterrichtsstunde nicht selbst halten. Entwickle eine Vertretungsstunde, die die Schüler:innen ohne mich bearbeiten können. Arbeite gründlich und fachlich korrekt.",
    "",
    "## Die geplante Stunde",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + classShort(ctx.klass) + " – " + gradeInfo(ctx.klass).text,
    "- Sitzung: " + (L.title || "") + (L.date ? " am " + fmtDay(L.date) : "") + " (Sitzungs-ID " + ctx.lessonId + ")",
    "- Geplante Dauer: " + minutes + " Minuten → Bearbeitungszeit für die Schüler:innen: ca. " + work + " Minuten (80 %; der Rest geht für Organisation und Abgabe drauf).",
    ctx.unitText ? "\n" + ctx.unitText : "",
    "",
    "## Vorgehen",
    "1. Rufe mit dem Connector „Unterricks“ `get_lesson` mit der Sitzungs-ID " + ctx.lessonId + " auf: Dort stehen die eigentliche Planung, der Schulportal-Eintrag, die Materialien und die Unterrichtseinheit.",
    "2. Untersuche die eigentlich geplante Stunde: Welche fachdidaktische Kompetenz sollte erreicht werden? Welche Stundenfrage sollte am Ende beantwortet werden? Welche Lerninhalte sollten vermittelt werden?",
    "3. Entwickle mit diesen Antworten sowie Fach und Jahrgangsstufe etwas, das die Schüler:innen in der Vertretungsstunde ohne Lehrkraft bearbeiten können (ca. " + work + " Minuten).",
    ...formats,
    "4. Schreibe eine klare, chronologische Anleitung für die Schüler:innen: nummerierte Schritte mit Minutenangabe, was genau zu tun ist, welches Material, und wann bzw. wie abgegeben wird.",
    "5. Formuliere alle Materialien vollständig aus und gestalte sie als HTML-Seiten (Feld `materialien` mit `html`; Unterricks druckt sie nach meiner Bestätigung als A4-PDF – Material, das die Vertretungslehrkraft austeilen muss, mit `bereich` \"druck\" und `anzahl`). Gestaltungsregeln:\n" + materialDesignText("   - ") + "\n   Dazu einen Schulportal-Eintrag für die Vertretungsstunde (Schulportal-Zeichen: " + PORTAL_RULES.join("; ") + "; Aufbau wie in diesem Beispiel:\n" + PORTAL_EXAMPLE + "\n" + PORTAL_TEACHER_RULE + ") und kurze Hinweise für die Vertretungslehrkraft.",
    "6. Fasse mir den Vorschlag kurz zusammen und speichere ihn mit `save_substitute_plan` für die Sitzung " + ctx.lessonId + ". Ich prüfe ihn in der Plattform; erst wenn ich ihn bestätige, tauscht die Plattform das Material aus und zeigt den Schüler:innen den Vertretungshinweis.",
  ].filter((l) => l !== "").join("\n");
}
export function normalizeSubstitute(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const a = p.analyse && typeof p.analyse === "object" ? p.analyse : {};
  const fb = p.feibeitsblatt && typeof p.feibeitsblatt === "object" && Array.isArray(p.feibeitsblatt.aufgaben || p.feibeitsblatt.tasks) ? p.feibeitsblatt : null;
  return {
    analyse: { kompetenz: str(a.kompetenz, 1500).trim(), stundenfrage: str(a.stundenfrage, 400).trim(), inhalte: (Array.isArray(a.inhalte) ? a.inhalte : str(a.inhalte).split("\n")).map((x) => str(x, 400).trim()).filter(Boolean).slice(0, 15) },
    format: str(p.format, 80).trim(),
    bearbeitungszeit: Number.isInteger(Number(p.bearbeitungszeit)) ? Number(p.bearbeitungszeit) : null,
    hinweis: str(p.hinweis_schueler || p.hinweis, 1000).trim() || DEFAULT_SUBSTITUTE_NOTICE,
    schritte: (Array.isArray(p.schritte) ? p.schritte : []).slice(0, 20).map((x, i) => ({
      titel: str(x && x.titel, 160).trim() || "Schritt " + (i + 1), anleitung: str(x && x.anleitung, 3000).trim(),
      minuten: Number.isInteger(Number(x && x.minuten)) ? Number(x.minuten) : null, abgabe: !!(x && x.abgabe) })).filter((x) => x.anleitung || x.titel),
    abgabe: str(p.abgabe, 1000).trim(),
    schulportal: str(p.schulportal, 30000).trim(),
    // gestaltet (html → PDF nach der Bestätigung) oder als Rückfall Markdown; „druck“ nur gestaltet (Liste „Von der Lehrkraft auszudrucken“)
    materialien: (Array.isArray(p.materialien) ? p.materialien : []).slice(0, 12).map((m) => {
      const html = str(m && m.html, 1600000).trim(), b = m && (m.bereich === "lehrkraft" || m.bereich === "teacher") ? "teacher" : m && (m.bereich === "druck" || m.bereich === "print") && html ? "print" : "student";
      const o = { titel: str(m && m.titel, 200).trim() || "Material", bereich: b, markdown: html ? "" : str(m && m.markdown, 200000).trim() };
      if (html) o.html = html;
      if (b === "print") o.druck = { anzahl: Number.isInteger(m.anzahl) && m.anzahl >= 1 && m.anzahl <= 500 ? m.anzahl : null, beidseitig: m.beidseitig !== false, farbe: m.farbe === true };
      return o;
    }).filter((m) => m.html || m.markdown),
    feibeitsblatt: fb,
    escape_room: p.escape_room && typeof p.escape_room === "object" ? p.escape_room : null,
    vertretung: str(p.hinweise_vertretung || p.vertretung, 4000).trim(),
  };
}
