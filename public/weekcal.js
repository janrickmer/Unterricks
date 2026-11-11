// weekcal.js – Wochenkalender auf der Startseite der Lehrkraft: der Unterricht der Woche aus den Stundenplänen der Unterrichtseinheiten
// (weekSchedule in planning.js). Breit ein Zeitraster Mo–Fr (Einträge nach Uhrzeit, Überschneidungen nebeneinander), schmal eine Liste je Tag
// – eine Struktur, umgeschaltet nur per CSS (styles.css .weekcal). Jeder Eintrag ist ein Link auf die Klasse bzw. den Kurs.
import { h, clear, icon } from "./ui.js";
import { addDays, berlinToday, isoWeek, minutesClock } from "./shared.js";
import { weekSchedule, assignLanes, calendarWeek, weekRangeText, dayMonthText } from "./planning.js";

const MIN_SPAN = 40;   // Mindesthöhe eines Eintrags im Raster in Minuten (54 px bei --ppm 1.35px)
const setVars = (el, vars) => { for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, String(v)); return el; };

/* load() → Promise mit den Einheiten (GET /api/teacher/schedule); today = Datum an der Schule (für Tests fest einstellbar, sonst jedes Mal neu –
   ein Tab, der übers Wochenende offen bleibt, zeigt danach die richtige Woche) */
export function weekCard(load, { today: fixed = null } = {}) {
  let today = fixed || berlinToday(), home = calendarWeek(today), monday = home, units = null;
  const refresh = () => { const t = fixed || berlinToday(); if (t === today) return false; const wasHome = monday === home; today = t; home = calendarWeek(t); if (wasHome) monday = home; return true; };
  const range = h("p", { class: "wk-range", id: "wk-range", "aria-live": "polite" });
  const prev = h("button", { class: "btn ghost iconbtn", type: "button", "aria-label": "Vorige Woche", onclick: () => move(-7) }, icon("left"));
  const next = h("button", { class: "btn ghost iconbtn", type: "button", "aria-label": "Nächste Woche", onclick: () => move(7) }, icon("right"));
  // aria-disabled statt disabled: der Knopf behält beim Klicken den Fokus
  const back = h("button", { class: "btn ghost small", type: "button", onclick: () => { refresh(); if (monday !== home) monday = home; paint(); } }, "Heute");
  const body = h("div", { class: "wk-body skeleton", text: "Lade den Wochenkalender …" });
  const card = h("section", { class: "card weekcal", "aria-labelledby": "wk-h" },
    h("div", { class: "section-title" }, h("h2", { id: "wk-h", text: "Ihre Woche" }), h("div", { class: "wk-nav" }, prev, range, next, back)),
    body);
  function move(n) { refresh(); monday = addDays(monday, n); paint(); }
  // zurück im Tab (z. B. am nächsten Morgen): neues Datum übernehmen; ohne Karte im Dokument meldet sich der Zuhörer ab
  const onVis = () => { if (!card.isConnected) { document.removeEventListener("visibilitychange", onVis); return; } if (document.visibilityState === "visible" && refresh()) paint(); };
  document.addEventListener("visibilitychange", onVis);
  function paint() {
    range.textContent = weekRangeText(monday) + " · KW " + isoWeek(monday);
    back.setAttribute("aria-disabled", String(monday === home));
    back.setAttribute("aria-label", monday === home ? "Heute – diese Woche wird schon gezeigt" : "Zur Woche von heute");
    if (units) { clear(body); body.classList.remove("skeleton"); body.append(...weekBody(weekSchedule(units, monday), today)); }
  }
  paint();
  Promise.resolve().then(load).then((u) => { units = Array.isArray(u) ? u : []; paint(); }, (e) => {
    clear(body); body.classList.remove("skeleton");
    body.append(h("p", { class: "err", role: "alert", text: "Der Wochenkalender ließ sich nicht laden: " + ((e && e.message) || e) }));
  });
  return card;
}

function weekBody(w, today) {
  const all = w.days.flatMap((d) => [...d.timed, ...d.untimed]);
  if (!all.length && !w.days.some((d) => d.off.length))
    return [h("p", { class: "muted wk-empty", text: "In dieser Woche ist kein Unterricht eingetragen. Wochentag, Uhrzeit und Dauer sowie Beginn und Ende tragen Sie in jeder Unterrichtseinheit unter „1. Rahmendaten der Einheit“ ein." })];
  const timed = w.days.flatMap((d) => d.timed), urows = Math.max(0, ...w.days.map((d) => d.untimed.length));
  const from = timed.length ? Math.floor(Math.min(...timed.map((e) => e.start)) / 60) * 60 : 0;
  const to = timed.length ? Math.min(24 * 60, Math.ceil(Math.max(...timed.map((e) => Math.max(e.end, e.start + MIN_SPAN))) / 60) * 60) : 0;
  const grid = setVars(h("div", { class: "wk-grid" + (timed.length ? "" : " no-time") }), { "--span": to - from, "--urows": urows, "--ugap": urows ? ".45rem" : "0px" });
  if (timed.length) {   // Zeitachse – nur im breiten Raster sichtbar
    const axis = h("div", { class: "wk-axis", "aria-hidden": "true" }, urows ? h("span", { class: "wk-ax-u", text: "ohne Uhrzeit" }) : null);
    const marks = h("div", { class: "wk-ax-m" });
    for (let m = from; m <= to; m += 60) marks.append(setVars(h("span", { text: minutesClock(m) }), { "--m": m - from }));
    axis.append(marks); grid.append(axis);
  }
  const ol = h("ol", { class: "wk-days" });
  for (const d of w.days) {
    const isToday = d.date === today, hid = "wk-d" + d.day;
    const li = h("li", { class: "wk-day" + (isToday ? " today" : ""), "aria-labelledby": hid, "aria-current": isToday ? "date" : null },
      h("h3", { class: "wk-dh", id: hid }, h("span", { class: "sr-only", text: d.name + ", " + dayMonthText(d.date) + (isToday ? " – heute" : "") }),
        h("span", { "aria-hidden": "true", title: isToday ? "heute" : null }, h("span", { class: "wk-wd", text: d.name.slice(0, 2) }), " ", h("time", { datetime: d.date, text: d.date.slice(8, 10) + "." + d.date.slice(5, 7) + "." }))));
    if (urows) li.append(h("ul", { class: "wk-untimed", "aria-label": "ohne Uhrzeit" }, d.untimed.map((e) => h("li", null, entry(e, d)))));
    if (timed.length) {
      const track = h("ul", { class: "wk-track", "aria-label": "mit Uhrzeit" });
      for (let m = from + 60; m < to; m += 60) track.append(setVars(h("li", { class: "wk-hl", "aria-hidden": "true" }), { "--m": m - from }));
      assignLanes(d.timed, MIN_SPAN);
      for (const e of d.timed) track.append(setVars(h("li", { class: "wk-slot" }, entry(e, d)), { "--m": e.start - from, "--dur": Math.max(e.end - e.start, MIN_SPAN), "--lane": e.lane, "--lanes": e.lanes }));
      li.append(track);
    }
    if (d.off.length) li.append(h("p", { class: "wk-off", text: "Entfällt: " + d.off.map((o) => o.subjectShort + " " + o.label + (o.reason ? " (" + o.reason + ")" : "")).join(", ") }));
    if (!d.timed.length && !d.untimed.length && !d.off.length) li.append(h("p", { class: "wk-none", text: "kein Unterricht" }));
    ol.append(li);
  }
  grid.append(ol);
  const out = [grid];
  if (w.days.some((d) => d.untimed.length))
    out.push(h("p", { class: "hint wk-hint", text: "„ohne Uhrzeit“: Im Stundenplan dieser Einheiten fehlt die Uhrzeit – tragen Sie sie in der Unterrichtseinheit ein, dann erscheint der Unterricht im Zeitraster." }));
  return out;
}

// Im Raster: short = zu niedrig für die Titelzeile (entfällt dort), lane = Spur geteilt mit einer Überschneidung (die Zeitzeile entfällt, die Lage
// am Raster zeigt die Zeit; Fach und Klasse dürfen umbrechen). Uhrzeit, Klausur und Titel stehen immer im Linktext (sr-only) und im Tooltip.
function entry(e, d) {
  const exam = e.kind === "klausur", short = !e.time || e.minutes < 56, lane = (e.lanes || 1) > 1;
  const when = e.time ? e.time + "–" + e.endTime : "ohne Uhrzeit, " + e.minutes + " Minuten";
  return h("a", { class: "wk-ev" + (exam ? " exam" : "") + (short ? " short" : "") + (lane ? " lane" : ""), href: e.href, dataset: { fach: e.subject },
    title: (e.time ? e.time + "–" + e.endTime + " " : "") + e.subjectShort + " " + e.label + (exam ? " – Klausur" : "") + (e.title ? " – " + e.title : "") },
    h("span", { class: "sr-only", text: d.name + ", " + dayMonthText(d.date) + ", " + when + (exam ? ", Klausur" : "") + ": " }),
    h("span", { class: "wk-time", "aria-hidden": "true" }, exam ? h("span", { class: "wk-exam", text: "Klausur" }) : null, exam ? " · " : null, e.time ? e.time + "–" + e.endTime : "ohne Uhrzeit · " + e.minutes + " Min."),
    h("span", { class: "wk-who" }, h("span", { class: "ftag", dataset: { fach: e.subject }, text: e.subjectShort }), h("strong", { text: e.label }), exam ? h("span", { class: "wk-exam wk-exam-l", "aria-hidden": "true", text: "Klausur" }) : null),
    e.title ? h("span", { class: "wk-t", text: e.title }) : null);
}
