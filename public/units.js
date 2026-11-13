// units.js – Seite einer Unterrichtseinheit: Rahmendaten → Termine, Planungsgrundlagen, Planung mit Claude, Leupold-Schema, Ablauf-Tabelle,
// Sitzungen anlegen. Außerdem: Darstellung des Leupold-Schemas (auch in der Sitzungsansicht, aktuelle Stunde fett).
import { h, clear, toast, errToast, busy, confirmDialog, fmtTime, nn, icon, pageHead, modal, stateLine, downloadBlob, fmtBytes } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { T, tapi, teacherBar, markNav } from "./teacher.js";
import { subjectName, gradeInfo, classShort, fmtDay, isAnalogClass, GS_SUBJECT } from "./shared.js";
import { WEEKDAYS, computeSlots, lessonSlots, claudeUnitPrompt, normalizeParams } from "./planning.js";
import { claudeHandoff } from "./claude.js";
import { claudeGsUnitPrompt } from "./gsplanning.js";
import { baseLink } from "./bases.js";
import { reviseBox } from "./grundschule.js";

/* ---------- Leupold-Schema (links Ausgangslage, Mitte Lernschritte, rechts Lernaufgabe) ---------- */
export function leupoldView(unit, highlight) {
  const plan = unit.plan || {}, steps = plan.schritte || [];
  if (!plan.lernaufgabe && !steps.length) return h("p", { class: "muted small", text: "Noch kein Leupold-Schema – es entsteht bei der Planung mit Claude oder von Hand (Bearbeiten)." });
  return h("div", { class: "leupold", role: "group", "aria-label": "Leupold-Schema" },
    h("div", { class: "lp-head" }, h("strong", { text: "Leupold-Schema" }), " ", h("span", { text: (unit.title || plan.titel || "") + (plan.thema ? " – " + plan.thema : "") })),
    h("div", { class: "lp-grid" },
      h("div", { class: "lp-side lp-start" }, h("div", { class: "lp-cap", text: "Ausgangslage" }), h("div", { text: plan.ausgangslage || "–" })),
      h("div", { class: "lp-steps" }, steps.map((s, i) => h("div", { class: "lp-row" + (highlight === i ? " current" : "") },
        h("div", { class: "lp-desc", text: s.beschreibung || "" }), h("div", { class: "lp-title", text: s.titel || "" })))),
      h("div", { class: "lp-side lp-goal" }, h("div", { class: "lp-cap", text: "Lernaufgabe" }), h("div", { text: plan.lernaufgabe || "–" }))),
    plan.planungsgrundlage && plan.planungsgrundlage.name ? h("p", { class: "small", style: { marginTop: ".5rem" } }, h("strong", { text: "Planungsgrundlage: " }), plan.planungsgrundlage.name,
      plan.planungsgrundlage.begruendung ? " – " + plan.planungsgrundlage.begruendung : "") : null);
}

export async function unitPage(id) {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade die Unterrichtseinheit …" }));
  render(teacherBar("lessons"), main);
  let u;
  try { u = (await tapi("GET", "/api/teacher/units/" + id)).unit; }
  catch (e) { clear(main).append(h("div", { class: "card" }, h("p", { class: "err", text: e.message }), h("a", { class: "btn", href: "#/lk" }, "Zur Übersicht"))); return; }
  // Grundschule: Kurs statt Klasse, ohne Klausur, eigener Prompt; Menüpunkt „Grundschule“
  const gs = u.subject === GS_SUBJECT, gsc = gs && u.course && u.course.gs ? u.course.gs : null;
  const coursePage = "#/lk/grundschule/k/" + u.klass;
  if (gs) markNav("primary");
  let rows = u.rows.map((r) => ({ ...r })), plan = JSON.parse(JSON.stringify(u.plan || {}));
  let dirty = false;
  // gesicherte Sitzungen aus „Einheit aus Datei laden“, bis die Sitzungen angelegt sind (backup.js, IndexedDB dieses Geräts)
  let pend = null, filling = false;
  const pendFor = (uid) => !!(pend && pend.rows && pend.rows[uid]);
  const pendOpen = () => (pend ? u.lessons.filter((l) => pendFor(l.row)) : []);
  // Grundschule: „Einheit als Datei“ gibt es dort (noch) nicht – also auch keine gesicherten Sitzungen, die auf ihre Übernahme warten (R14, F13/F27)
  if (!gs) import("./backup.js").then((B) => B.loadPending(id)).then((p) => { if (p && Object.keys(p.rows || {}).length) { pend = p; paint(); } }).catch(() => {});
  const unitInput = h("input", { type: "file", class: "hidden", accept: ".zip,.json,application/zip,application/json", "aria-label": "Gesicherte Unterrichtseinheit (ZIP- oder JSON-Datei) auswählen" });
  unitInput.addEventListener("change", () => { const f = unitInput.files[0]; unitInput.value = ""; if (f) importUnit(f); });
  const markDirty = () => { dirty = true; saveState.textContent = "Ungespeicherte Änderungen"; };

  const paint = () => {
    clear(main);
    const badge = h("span", { class: "badge " + (u.status === "geplant" ? "ok" : ""), text: u.status === "geplant" ? "festgelegt · Sitzungen angelegt" : "Entwurf" });
    main.append(...nn(gs
      ? pageHead({ fach: "gs", crumbs: [["#/lk/grundschule", "Grundschule"], [coursePage, gsc ? gsc.short : "Kurs"], u.title || "Neue Einheit"],
        title: u.title || "Neue Unterrichtseinheit", aside: badge, sub: gsc ? gsc.label + " · " + gsc.gradeText : "Grundschule" })
      : pageHead({ fach: u.subject, crumbs: [["#/lk", "Fächer"], ["#/lk/f/" + u.subject, subjectName(u.subject)], ["#/lk/f/" + u.subject + "/" + u.klass, classShort(u.klass)], u.title || "Neue Einheit"],
        title: u.title || "Neue Unterrichtseinheit", aside: badge,
        sub: subjectName(u.subject) + " · " + classShort(u.klass) + " · " + gradeInfo(u.klass).text }),
      // „Erledigt“ ändert die Zeilen nicht: ungespeicherte Änderungen der Tabelle bleiben; nach „rückgängig“ neu laden
      gs ? reviseBox(u, { onChange: (nu) => { if (nu && JSON.stringify(nu.rows) === JSON.stringify(u.rows)) { u = nu; if (!dirty) { rows = u.rows.map((x) => ({ ...x })); plan = JSON.parse(JSON.stringify(u.plan || {})); } paint(); } else unitPage(id); } }) : null,
      paramsCard(), basisCard(), claudeCard(), schemaCard(), tableCard(), finishCard(), gs ? null : ioCard()));
  };

  /* 1) Rahmendaten */
  function paramsCard() {
    const p = normalizeParams(u.params);
    const title = h("input", { value: u.title || "", maxlength: "200", placeholder: "z. B. Herausforderungen des sozialen Wandels", "aria-label": "Thema der Einheit" });
    const wdBox = h("div", { class: "stack" }), brBox = h("div", { class: "stack" });
    const wds = p.weekdays.length ? p.weekdays.map((w) => ({ ...w })) : [{ day: 1, minutes: 45 }];
    const brs = p.breaks.map((b) => ({ ...b }));
    const paintWd = () => clear(wdBox).append(...wds.map((w, i) => h("div", { class: "row" },
      h("select", { style: { width: "auto" }, "aria-label": "Wochentag", onchange: (e) => { w.day = Number(e.target.value); } }, WEEKDAYS.map((d) => h("option", { value: d.d, selected: d.d === w.day ? true : null }, d.n))),
      h("input", { type: "time", step: "300", value: w.time || "", style: { maxWidth: "8.5rem" }, "aria-label": "Uhrzeit (Beginn)", oninput: (e) => { w.time = e.target.value || null; } }), h("span", { class: "small", text: "Uhr," }),
      h("input", { type: "number", min: "20", max: "240", step: "5", value: w.minutes, style: { maxWidth: "7rem" }, "aria-label": "Minuten", oninput: (e) => { w.minutes = Number(e.target.value); } }), h("span", { class: "small", text: "Minuten" }),
      h("button", { class: "btn small ghost", type: "button", "aria-label": "Entfernen", onclick: () => { wds.splice(i, 1); paintWd(); } }, icon("x")))),
      h("button", { class: "btn small", type: "button", onclick: () => { wds.push({ day: 4, minutes: 45 }); paintWd(); } }, "+ Sitzung pro Woche"));
    const paintBr = () => clear(brBox).append(...brs.map((b, i) => h("div", { class: "row" },
      h("input", { type: "date", value: b.from || "", style: { maxWidth: "11rem" }, "aria-label": "von", oninput: (e) => { b.from = e.target.value; } }), "–",
      h("input", { type: "date", value: b.to || "", style: { maxWidth: "11rem" }, "aria-label": "bis", oninput: (e) => { b.to = e.target.value; } }),
      h("input", { value: b.label || "", placeholder: "z. B. Weihnachtsferien", style: { maxWidth: "16rem" }, oninput: (e) => { b.label = e.target.value; } }),
      h("button", { class: "btn small ghost", type: "button", "aria-label": "Entfernen", onclick: () => { brs.splice(i, 1); paintBr(); } }, icon("x")))),
      h("button", { class: "btn small", type: "button", onclick: () => { brs.push({ from: "", to: "", label: "" }); paintBr(); } }, "+ Ferien/Ausfall"));
    paintWd(); paintBr();
    // Stundenplan aus den Kurseinstellungen (nur, wenn er dort eingetragen ist und sich von dem der Einheit unterscheidet)
    const cw = u.course && Array.isArray(u.course.weekdays) ? u.course.weekdays : [];
    const sameWd = () => JSON.stringify(normalizeParams({ weekdays: wds }).weekdays) === JSON.stringify(normalizeParams({ weekdays: cw }).weekdays);
    const wdState = h("p", { class: "small", role: "status" });
    const takeWd = cw.length && !sameWd() ? h("button", { class: "btn small", type: "button", onclick: () => {
      wds.splice(0, wds.length, ...cw.map((w) => ({ ...w })));
      paintWd(); takeWd.remove();
      wdState.textContent = "Übernommen – zum Speichern „Speichern und Termine berechnen“ wählen.";
      const first = wdBox.querySelector("select"); if (first) first.focus();
    } }, "Stundenplan aus den Kurseinstellungen übernehmen") : null;
    const start = h("input", { type: "date", value: p.start || "", "aria-label": "Beginn" }), end = h("input", { type: "date", value: p.end || "", "aria-label": "Ende" });
    const exam = h("input", { type: "date", value: p.exam || "", "aria-label": "Klausurtermin" }), notes = h("textarea", { rows: "2", value: p.notes || "", placeholder: "Weitere Hinweise (optional)" });
    const slots = computeSlots(u.params), ls = lessonSlots(slots);
    const slotInfo = h("div", { class: "small" }, ls.length ? [h("strong", { text: ls.length + " Sitzungen verfügbar" }), " · " + ls.map((s) => fmtDay(s.date).slice(0, 9) + " (" + s.minutes + ")").join(", "),
      slots.some((s) => s.kind === "klausur") ? h("div", { class: "warnc", text: "Klausur: " + slots.filter((s) => s.kind === "klausur").map((s) => fmtDay(s.date)).join(", ") }) : null] : h("span", { class: "muted", text: "Noch keine Termine – bitte Stundenplan, Beginn und Ende eintragen." }));
    return h("section", { class: "card" }, h("h2", { text: "1. Rahmendaten der Einheit" }),
      h("div", { class: "field" }, h("label", null, "Thema / Arbeitstitel"), title),
      h("div", { class: "meta-grid" },
        h("div", { class: "field" }, h("label", null, "Sitzungen pro Woche (Wochentag, Beginn und Länge)"), wdBox, takeWd, wdState),
        h("div", { class: "field" }, h("label", null, "Ferien und bekannte Ausfälle im Zeitraum"), brBox,
          ...(p.cancelled || []).map((x) => h("p", { class: "small warnc", text: "Ausgefallen (Krankmeldung): " + fmtDay(x.date) + (x.time ? ", " + x.time : "") + " – die Stunden wurden verschoben." }))),
        h("div", { class: "field" }, h("label", null, "Beginn der Einheit"), start),
        h("div", { class: "field" }, h("label", null, "Abgeschlossen sein bis"), end),
        gs ? null : h("div", { class: "field" }, h("label", null, "Klausurtermin (falls vorhanden)"), exam),
        h("div", { class: "field" }, h("label", null, "Hinweise"), notes)),
      h("div", { class: "row between" }, slotInfo,
        h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try {
            const params = { weekdays: wds, breaks: brs.filter((b) => b.from), start: start.value || null, end: end.value || null, exam: gs ? null : exam.value || null, notes: notes.value };
            u = (await tapi("PATCH", "/api/teacher/units/" + id, { body: { title: title.value, params } })).unit;
            toast(lessonSlots(computeSlots(u.params)).length + " Sitzungen verfügbar.", "ok"); paint();
          } catch (err) { errToast(err); }
        }) }, "Speichern und Termine berechnen")));
  }

  /* 2) Planungsgrundlagen */
  function basisCard() {
    const box = h("div", { class: "small muted", text: "Lade …" });
    // Grundschule: Religionskurse nutzen das Curriculum bei Ev. Religion, andere Fächer die Planungsgrundlagen auf der Kursseite
    const manage = gs ? (gsc && !gsc.religion ? coursePage : "#/lk/grundlagen/evrel") : "#/lk/grundlagen/" + u.subject;
    tapi("GET", "/api/teacher/basis?subject=" + u.subject + "&klass=" + u.klass).then((b) => {
      clear(box).classList.remove("muted");
      box.append(...nn(b.docs.length ? h("ul", null, b.docs.map((d) => h("li", null, baseLink(d)))) : h("p", { class: "warnc", text: gs ? "Für diesen Kurs ist noch keine Planungsgrundlage hinterlegt." : "Für diese Klasse ist noch keine Planungsgrundlage hinterlegt." }),
        b.missing.length ? h("div", { class: "notice warn" }, "Es fehlen noch: " + b.missing.join("; ") + ". ", h("a", { href: manage }, "Jetzt hochladen")) : null,
        b.gradeNote ? h("p", null, h("strong", { text: "Hinweis: " }), b.gradeNote) : null,
        gs ? h("p", { class: "warnc", text: "Grundschule: keine Tablets – die KI plant nur analoges, ausdruckbares Material." })
          : isAnalogClass(u.klass) ? h("p", { class: "warnc", text: "Jahrgang 5/6: keine iPads – die KI plant nur analoge, ausdruckbare Materialien." }) : null));
    }).catch((e) => { box.textContent = e.message; });
    return h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "2. Planungsgrundlagen" }), h("a", { class: "btn small", href: manage }, "Verwalten")), box);
  }

  /* 3) Mit Claude planen */
  function claudeCard() {
    const ls = lessonSlots(computeSlots(u.params));
    const btn = h("button", { class: "btn primary big", type: "button", disabled: ls.length ? null : true }, "Einheit mit Claude planen");
    btn.addEventListener("click", async () => {
      let b = { docs: [], missing: [], rules: "", gradeNote: "" };
      try { b = await tapi("GET", "/api/teacher/basis?subject=" + u.subject + "&klass=" + u.klass); } catch {}
      if (gs) {
        claudeHandoff({ title: "Unterrichtseinheit mit Claude planen",
          intro: "Claude klärt mit Ihnen Thema und Schwerpunkt, schlägt drei zentrale Lernaufgaben vor und erstellt danach Leupold-Schema und Ablauftabelle für " + ls.length + " Sitzungen.",
          after: "Wenn Claude den Plan mit „save_unit_plan“ gespeichert hat, kommen Sie hierher zurück: Leupold-Schema und Tabelle erscheinen unten und lassen sich bearbeiten.",
          prompt: () => claudeGsUnitPrompt({ unitId: u.id, course: gsc, title: u.title, params: u.params, slots: computeSlots(u.params), bases: b.docs.map((d) => d.title), missing: b.missing,
            classSize: u.course ? u.course.classSize : null, hasSessions: (u.lessons || []).some((l) => !l.cancelled) }) });
        return;
      }
      const cfg = (await tapi("GET", "/api/teacher/subjects")).subjects[u.subject];
      claudeHandoff({ title: "Unterrichtseinheit mit Claude planen",
        intro: "Claude fragt Sie zuerst" + (u.subject === "powi" ? " nach der Planungsgrundlage (mit priorisiertem und sekundärem Vorschlag), " : " ") + "dann nach der zentralen Lernaufgabe (drei Vorschläge) und erstellt danach Leupold-Schema und Ablauftabelle für " + ls.length + " Sitzungen.",
        after: "Wenn Claude den Plan mit „save_unit_plan“ gespeichert hat, kommen Sie hierher zurück: Leupold-Schema und Tabelle erscheinen unten und lassen sich bearbeiten.",
        prompt: () => claudeUnitPrompt({ unitId: u.id, subject: u.subject, klass: u.klass, title: u.title, params: u.params, slots: computeSlots(u.params),
          rules: cfg.rules, gradeNote: b.gradeNote, bases: b.docs.map((d) => d.title), missing: b.missing, classSize: u.course ? u.course.classSize : null }) });
    });
    return h("section", { class: "card claudeplan" }, h("div", { class: "section-title" }, h("h2", { text: "3. Planung mit Claude" }), h("span", { class: "badge", text: "Hauptweg" })),
      h("p", { class: "small", text: "Die Planung der Einheit übernimmt Claude mit Ihrem Pro-Abo in claude.ai. Claude liest die Planungsgrundlagen über den Connector, stimmt Planungsgrundlage und Lernaufgabe mit Ihnen ab und speichert Leupold-Schema und Ablauf direkt hier." }),
      ls.length ? null : h("p", { class: "warnc small", text: "Bitte zuerst die Rahmendaten eintragen und Termine berechnen." }), btn,
      // Grundschule: Laden einer gesicherten Einheit ist dort (noch) nicht vorgesehen – wie die Karte „Einheit als Datei“ (R14, F13/F27)
      u.lessons.length || gs ? null : h("p", { class: "small" }, "Schon einmal geplant? ", h("button", { class: "btn small", type: "button", onclick: () => unitInput.click() }, icon("up"), "Gesicherte Einheit laden"),
        " – Leupold-Schema, Ablauf und Sitzungen aus einer Datei übernehmen (siehe „Einheit als Datei“ unten)."),
      u.source === "claude" ? h("p", { class: "ok small", text: "Zuletzt von Claude gespeichert: " + fmtTime(u.updatedAt) }) : null);
  }

  /* 4) Leupold-Schema (Ansicht + Bearbeitung) */
  function schemaCard() {
    const view = h("div", null, leupoldView({ ...u, plan }));
    const edit = h("div", { class: "hidden stack" });
    const paintEdit = () => {
      clear(edit);
      const pg = plan.planungsgrundlage || (plan.planungsgrundlage = { name: "", begruendung: "" });
      const f = (label, el) => h("div", { class: "field" }, h("label", null, label), el);
      const ta = (v, on, rows = 3) => h("textarea", { rows: String(rows), value: v || "", oninput: (e) => { on(e.target.value); markDirty(); } });
      edit.append(f("Planungsgrundlage", h("input", { value: pg.name || "", oninput: (e) => { pg.name = e.target.value; markDirty(); } })), f("Begründung", ta(pg.begruendung, (v) => { pg.begruendung = v; })),
        f("Zentrale Lernaufgabe (Ziel der Einheit)", ta(plan.lernaufgabe, (v) => { plan.lernaufgabe = v; }, 4)), f("Ausgangslage der Lerngruppe", ta(plan.ausgangslage, (v) => { plan.ausgangslage = v; }, 4)),
        h("h3", { text: "Lernschritte" }));
      (plan.schritte || (plan.schritte = [])).forEach((s, i) => edit.append(h("div", { class: "task-edit" },
        h("div", { class: "row between" }, h("strong", { text: "Lernschritt " + (i + 1) }), h("div", { class: "row" },
          h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Lernschritt " + (i + 1) + " nach oben", disabled: i === 0 ? true : null, onclick: () => { plan.schritte.splice(i - 1, 0, plan.schritte.splice(i, 1)[0]); markDirty(); paintEdit(); } }, icon("up")),
          h("button", { class: "btn small ghost danger", type: "button", onclick: () => { plan.schritte.splice(i, 1); markDirty(); paintEdit(); } }, "Entfernen"))),
        f("Titel", h("input", { value: s.titel || "", oninput: (e) => { s.titel = e.target.value; markDirty(); } })), f("Tätigkeitsbeschreibung (mit Operatoren)", ta(s.beschreibung, (v) => { s.beschreibung = v; }, 2)))));
      edit.append(h("button", { class: "btn small", type: "button", onclick: () => { plan.schritte.push({ titel: "", beschreibung: "" }); markDirty(); paintEdit(); } }, "+ Lernschritt"));
    };
    const toggle = h("button", { class: "btn small", type: "button", onclick: () => {
      const editing = edit.classList.toggle("hidden") === false;
      if (editing) paintEdit(); else { clear(view).append(leupoldView({ ...u, plan })); }
      toggle.textContent = editing ? "Ansicht" : "Bearbeiten";
    } }, "Bearbeiten");
    return h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "4. Leupold-Schema" }), toggle), view, edit);
  }

  /* 5) Ablauf der Unterrichtseinheit */
  const saveState = h("span", { class: "save-state" });
  function tableCard() {
    const steps = plan.schritte || [], lessonByRow = new Map(u.lessons.map((l) => [l.row, l]));
    const tbody = h("tbody", { role: "rowgroup" });
    const paintRows = () => {
      clear(tbody);
      rows.forEach((r, i) => {
        const l = lessonByRow.get(r.uid);
        tbody.append(h("tr", { role: "row" },
          h("td", { class: "small", "data-label": "Stunde", role: "cell" }, h("strong", { text: String(i + 1) }), h("br"), h("input", { type: "date", value: r.date || "", "aria-label": "Datum Stunde " + (i + 1), style: { maxWidth: "10.5rem", fontSize: ".85rem" }, onchange: (e) => { r.date = e.target.value || null; markDirty(); } }),
            gs && !r.date ? h("div", null, h("span", { class: "badge warnc", text: "ohne Termin" })) : null,
            h("div", { class: "muted", text: r.minutes ? r.minutes + " min" : "" })),
          h("td", { "data-label": "Stundenfrage", role: "cell" }, h("textarea", { rows: "3", value: r.stundenfrage, "aria-label": "Stundenfrage " + (i + 1), oninput: (e) => { r.stundenfrage = e.target.value; markDirty(); } })),
          h("td", { "data-label": "Grober Stundenablauf", role: "cell" }, h("textarea", { rows: "4", value: r.ablauf.map((a) => "- " + a).join("\n"), "aria-label": "Ablauf " + (i + 1), oninput: (e) => { r.ablauf = e.target.value.split("\n").map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean); markDirty(); } })),
          h("td", { "data-label": "Lernschritt", role: "cell" }, h("select", { "aria-label": "Lernschritt " + (i + 1), onchange: (e) => { r.schritt = e.target.value === "" ? null : Number(e.target.value); markDirty(); } },
            h("option", { value: "" }, "–"), steps.map((s, k) => h("option", { value: k, selected: r.schritt === k ? true : null }, (k + 1) + ". " + (s.titel || "").slice(0, 40))))),
          h("td", { class: "small", "data-label": "Sitzung", role: "cell" }, l ? h("a", { class: "btn small", href: "#/lk/s/" + l.id }, "Sitzung öffnen") : h("span", { class: "muted", text: "noch keine Sitzung" }),
            pendFor(r.uid) ? h("div", null, h("span", { class: "badge", title: "Den Inhalt bekommt die Sitzung beim Anlegen (aus der geladenen Datei)", text: l ? "Inhalt aus Datei steht aus" : "Inhalt aus Datei" })) : null,
            h("div", { class: "row", style: { marginTop: ".3rem" } },
              h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Stunde " + (i + 1) + " nach oben", disabled: i === 0 ? true : null, onclick: () => { rows.splice(i - 1, 0, rows.splice(i, 1)[0]); markDirty(); paintRows(); } }, icon("up")),
              h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Stunde " + (i + 1) + " nach unten", disabled: i === rows.length - 1 ? true : null, onclick: () => { rows.splice(i + 1, 0, rows.splice(i, 1)[0]); markDirty(); paintRows(); } }, icon("down")),
              l ? null : h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Stunde " + (i + 1) + " löschen", onclick: () => { rows.splice(i, 1); markDirty(); paintRows(); } }, icon("x"))))));
      });
    };
    paintRows();
    return h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "5. Ablauf der Unterrichtseinheit" }), saveState),
      h("div", { class: "table-wrap" }, h("table", { class: "unit-table", role: "table" }, h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, ["Stunde", "Stundenfrage", "Grober Stundenablauf", "Lernschritt", "Sitzung"].map((t) => h("th", { text: t, role: "columnheader" })))), tbody)),
      h("div", { class: "row between", style: { marginTop: ".6rem" } },
        h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => { rows.push({ uid: "", stundenfrage: "", ablauf: [], schritt: null, date: null, minutes: null }); markDirty(); paintRows(); } }, "+ Stunde"),
          h("button", { class: "btn small", type: "button", title: "Termine der Rahmendaten der Reihe nach neu zuordnen", onclick: (e) => busy(e.currentTarget, () => save(true)) }, "Termine neu verteilen")),
        h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, () => save(false)) }, "Änderungen speichern")),
      gs ? cancelledList() : null,
      h("p", { class: "hint", text: "Spalte 1: Stundenfrage, Spalte 2: grober Ablauf in Stichpunkten (eine Zeile = ein Stichpunkt). Die Einheit bleibt das ganze Schuljahr über änderbar; Abweichungen aus der Stundenplanung landen hier." }));
  }
  // Grundschule: ausgefallene Termine (Ausfall-Einträge der Krankmeldung) unter der Tabelle
  function cancelledList() {
    const ph = u.lessons.filter((l) => l.cancelled).sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : 1));
    if (!ph.length) return null;
    return h("ul", { class: "small unit-cancelled", "aria-label": "Ausgefallene Termine" }, ph.map((l) => h("li", null,
      h("a", { href: "#/lk/s/" + l.id, text: "Ausgefallen: " + (l.date ? fmtDay(l.date) : "ohne Termin") }), " – Inhalt verschoben auf die nächste Stunde")));
  }
  async function save(redistribute) {
    try {
      const r = await tapi("PATCH", "/api/teacher/units/" + id, { body: { plan, rows: rows.map((x) => ({ ...x, uid: x.uid || undefined })), baseVersion: u.version, assignDates: !!redistribute } });
      u = r.unit; rows = u.rows.map((x) => ({ ...x })); plan = JSON.parse(JSON.stringify(u.plan || {})); dirty = false;
      toast("Einheit gespeichert.", "ok"); paint();
    } catch (e) {
      if (e.status === 409) { if (await confirmDialog("Einheit wurde geändert", "Die Einheit wurde inzwischen an anderer Stelle geändert (z. B. von Claude). Neu laden? Ihre ungespeicherten Änderungen gehen dann verloren.", "Neu laden")) unitPage(id); }
      else errToast(e);
    }
  }

  /* 6) Festlegen und Sitzungen anlegen */
  function finishCard() {
    // Grundschule: Stunden ohne Termin (nach einer Krankmeldung) bekommen noch keine Sitzung
    const open = rows.filter((r) => !u.lessons.some((l) => l.row === r.uid) && (!gs || r.date)).length, waiting = pendOpen().length;
    const fromFile = rows.filter((r) => !u.lessons.some((l) => l.row === r.uid) && pendFor(r.uid)).length;
    return h("section", { class: "card" }, h("h2", { text: "6. Einheit festlegen und Sitzungen anlegen" }),
      h("p", { class: "small", text: open ? "Legt für " + open + " Stunde(n) eine Sitzung mit Datum und Dauer an. Erst danach beginnt die Planung der einzelnen Stunden; die Stundenfrage wird zum Titel der Sitzung." +
        (fromFile ? " " + fromFile + " davon bekommen gleich ihren Inhalt aus der geladenen Datei (Materialien, Präsentation, Planungsverlauf, Hausaufgabe – Datumsangaben angepasst)." : "") : "Zu allen Stunden gibt es eine Sitzung." }),
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", disabled: open && !filling ? null : true, onclick: (e) => busy(e.currentTarget, async () => {
          if (dirty) await save(false);
          let r;
          try {
            r = await tapi("POST", "/api/teacher/units/" + id + "/sessions"); u = r.unit; rows = u.rows.map((x) => ({ ...x })); toast(r.created + " Sitzung(en) angelegt.", "ok");
            if (r.skipped) toast(r.skipped + " Stunde(n) ohne Termin – dafür entsteht noch keine Sitzung.", "", 8000);
            paint();
          }
          catch (err) { errToast(err); return; }
          if (pendOpen().length) await fillSessions();
        }) }, "Einheit festlegen und Sitzungen anlegen"),
        waiting && !open ? h("button", { class: "btn", type: "button", disabled: filling ? true : null, onclick: () => fillSessions() }, "Gesicherte Inhalte in " + waiting + " Sitzung" + (waiting === 1 ? "" : "en") + " übernehmen") : null,
        // Ausfall-Einträge (Grundschule) hindern das Löschen nicht – sie gehen mit der Einheit (wie auf dem Server, Abschlussprüfung F16)
        u.lessons.some((l) => !l.cancelled) ? null : h("button", { class: "btn danger", type: "button", onclick: async () => {
          const gone = u.lessons.length;
          if (!(await confirmDialog("Einheit löschen", "Diese Einheit mit Plan und Tabelle löschen?" + (gone === 1 ? " Ihr Ausfall-Eintrag wird ebenfalls gelöscht." : gone ? " Ihre " + gone + " Ausfall-Einträge werden ebenfalls gelöscht." : ""), "Löschen", true))) return;
          try { await tapi("DELETE", "/api/teacher/units/" + id); go(gs ? coursePage : "#/lk/f/" + u.subject + "/" + u.klass); } catch (e) { errToast(e); }
        } }, "Einheit löschen")));
  }

  /* 7) Einheit als Datei: herunterladen (Einheit + Sitzungen) und in eine Einheit ohne Sitzungen laden */
  function ioCard() {
    const state = h("span", { class: "save-state", role: "status" }), locked = u.lessons.length > 0;
    const dl = h("button", { class: "btn", type: "button", onclick: (e) => busy(e.currentTarget, () => exportUnit(state), "Stelle die Datei zusammen …") }, icon("download"), "Einheit als Datei herunterladen");
    const ld = h("button", { class: "btn", type: "button", disabled: locked || filling ? true : null, "aria-describedby": "uio-hint", onclick: () => unitInput.click() }, icon("up"), "Einheit aus Datei laden");
    return h("section", { class: "card sessionio unitio", id: "unitio" }, h("div", { class: "section-title" }, h("h2", { text: "Einheit als Datei" }), state),
      h("p", { class: "small", text: "Eine Datei mit der ganzen Einheit: Leupold-Schema und Ablauf und – je Sitzung ein Ordner, chronologisch nummeriert – die Sitzungsdateien mit Planung, Schulportal-Eintrag, Hausaufgabe, Planungsverlauf, Materialien, Präsentation, Druckliste und Feibeitsblättern (als Entwürfe). So lässt sich eine Einheit in einer anderen Lerngruppe oder im nächsten Schuljahr wiederverwenden und leicht abändern." }),
      h("div", { class: "row" }, dl, ld, unitInput),
      h("p", { class: "hint", id: "uio-hint", text: locked
        ? "Laden geht nur in eine Einheit, zu der es noch keine Sitzungen gibt – legen Sie dafür auf der Seite der Klasse eine neue Einheit an („Neue Unterrichtseinheit planen“)."
        : "Beim Laden bleiben die Rahmendaten dieser Einheit, die Termine verteilt Unterricks neu. Die gesicherten Sitzungen warten auf diesem Gerät, bis Sie „Einheit festlegen und Sitzungen anlegen“ wählen – dann bekommt jede Sitzung ihren Inhalt, mit angepassten Datumsangaben. Geladen werden kann auch nur die Einheitsdatei (.json) aus einer Sicherung." }));
  }
  async function exportUnit(state) {
    if (dirty) {
      if (!(await confirmDialog("Ungespeicherte Änderungen", "Die Datei enthält den gespeicherten Stand der Einheit. Ihre Änderungen jetzt zuerst speichern?", "Speichern"))) return;
      await save(false);
      if (dirty) return;
    }
    try {
      const B = await import("./backup.js"), full = (await tapi("GET", "/api/teacher/units/" + id)).unit;
      const r = await B.buildUnitZip(full, { onStep: (m) => stateLine(state, m) });
      downloadBlob(r.blob, r.name, 10 * 60e3);
      stateLine(state, "Heruntergeladen: " + r.name + " (" + fmtBytes(r.blob.size) + ", " + r.sessions + " Sitzung" + (r.sessions === 1 ? "" : "en") + ")", "ok");
      if (r.notes.length) toast(r.notes.slice(0, 6).join(" "), "", 9000);
    } catch (e) { stateLine(state, ""); errToast(e); }
  }
  async function importUnit(file) {
    if (gs) return;
    if (u.lessons.length) { toast("Zu dieser Einheit gibt es schon Sitzungen – bitte eine neue Einheit anlegen und die Datei dort laden.", "err"); return; }
    let B, r;
    try { B = await import("./backup.js"); r = await B.readUnitFile(file); } catch (e) { errToast(e); return; }
    const x = r.unit, n = x.rows.length, withS = r.sessions.filter(Boolean).length, ls = lessonSlots(computeSlots(u.params));
    const had = rows.length || (plan.lernaufgabe || "").trim() || (plan.schritte || []).length;
    const warn = [x.source.subject && x.source.subject !== u.subject ? "Die Einheit stammt aus " + subjectName(x.source.subject) + ", diese Einheit gehört zu " + subjectName(u.subject) + "." : null,
      r.missing ? r.missing + " Sitzungsdatei" + (r.missing === 1 ? " fehlt" : "en fehlen") + " in der ZIP-Datei – diese Sitzungen bleiben leer." : null,
      !ls.length ? "Für diese Einheit gibt es noch keine Termine: Tragen Sie danach die Rahmendaten ein und wählen Sie „Termine neu verteilen“." : ls.length < n ? "Es gibt nur " + ls.length + " Termine für " + n + " Stunden – die übrigen Stunden bekommen noch kein Datum." : null].filter(Boolean);
    const ok = await new Promise((resolve) => {
      let done = false;
      modal({ title: "Einheit aus Datei laden?", wide: true, onClose: () => { if (!done) resolve(false); }, body: (el) => el.append(
        h("p", null, "Aus „", h("strong", { text: file.name }), "“: Einheit „" + (x.title || "ohne Titel") + "“" + (x.source.klass ? " (" + classShort(x.source.klass) + ")" : "") + " mit " + n + " Stunde" + (n === 1 ? "" : "n") + "."),
        h("ul", { class: "small" },
          h("li", { text: "Titel, Leupold-Schema und Ablauf ersetzen den bisherigen Stand dieser Einheit" + (had ? " – Ihr bisheriger Plan geht dabei verloren." : ".") }),
          h("li", { text: "Die Rahmendaten dieser Einheit bleiben (" + classShort(u.klass) + "); Unterricks verteilt die Termine neu" + (ls.length ? " (" + ls.length + " Termine verfügbar)." : ".") }),
          h("li", { text: withS ? withS + " gesicherte Sitzung" + (withS === 1 ? "" : "en") + ": Ihren Inhalt (Planung, Materialien, Präsentation, Planungsverlauf, Hausaufgabe, Feibeitsblatt-Entwürfe) bekommen die Sitzungen beim „Einheit festlegen und Sitzungen anlegen“, Datumsangaben angepasst. Bis dahin liegen die Inhalte nur auf diesem Gerät."
            : r.fromZip ? "Die Datei enthält keine Sitzungen – nur die Planung der Einheit." : "Nur die Einheitsdatei: die Sitzungen lassen sich später einzeln mit „Sitzung aus Datei laden“ übernehmen." })),
        ...warn.map((w) => h("div", { class: "notice warn", text: w }))),
        actions: [{ label: "Abbrechen", onClick: () => { done = true; resolve(false); } }, { label: "Übernehmen", class: "primary", onClick: () => { done = true; resolve(true); } }] });
    });
    if (!ok) return;
    try {
      const res = await tapi("PATCH", "/api/teacher/units/" + id, { body: { title: x.title || u.title, plan: x.plan, rows: x.rows, assignDates: true, baseVersion: u.version } });
      u = res.unit; rows = u.rows.map((y) => ({ ...y })); plan = JSON.parse(JSON.stringify(u.plan || {})); dirty = false;
    } catch (e) {
      if (e.status === 409) toast("Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte die Seite neu laden und die Datei erneut wählen.", "err");
      else errToast(e);
      return;
    }
    let note = "";
    if (withS) {
      const rec = { unitId: id, file: file.name, at: Date.now(), rows: {} };
      if (u.rows.length === n) r.sessions.forEach((b, i) => { if (b) rec.rows[u.rows[i].uid] = new Blob([b], { type: "application/zip" }); });
      if (Object.keys(rec.rows).length) {
        try { await B.savePending(rec); } catch { note = " Die Sitzungsinhalte ließen sich auf diesem Gerät nicht zwischenspeichern – bitte die Seite nicht neu laden, bevor die Sitzungen angelegt sind."; }
        pend = rec;
      }
    }
    paint();
    toast("Einheit „" + (u.title || "ohne Titel") + "“ übernommen." + (pend ? " Die gesicherten Sitzungen bekommen ihren Inhalt beim Anlegen der Sitzungen." : "") + note, note ? "err" : "ok", note ? 12000 : 6000);
  }
  /* Gesicherte Inhalte in die angelegten Sitzungen übernehmen (Fortschritt im Dialog; Seite bitte offen lassen) */
  async function fillSessions() {
    if (filling || !pend) return;
    const todo = pendOpen();
    if (!todo.length) return;
    filling = true; paint();
    const status = h("p", { role: "status", text: "Bereite vor …" }), bar = h("i");
    const dlg = modal({ title: "Inhalte werden übernommen", body: (el) => el.append(status, h("div", { class: "progress" }, bar), h("p", { class: "hint", text: "Bitte lassen Sie diese Seite geöffnet – Präsentationen werden dabei neu in Folien umgewandelt." })) });
    const guard = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    let report = null;
    try {
      const B = await import("./backup.js");
      let k = 0;
      report = await B.applyPending(id, todo, pend, { onStep: (m) => { status.textContent = m; const n = Number((/^Sitzung (\d+) von/.exec(m) || [])[1]); if (n && n !== k) { k = n; bar.style.width = Math.round(((n - 1) / todo.length) * 100) + "%"; } } });
      pend = await B.loadPending(id);
    } catch (e) { errToast(e); }
    finally { window.removeEventListener("beforeunload", guard); filling = false; dlg.close(); }
    try { u = (await tapi("GET", "/api/teacher/units/" + id)).unit; rows = u.rows.map((y) => ({ ...y })); } catch {}
    paint();
    if (!report) return;
    const list = (title, xs) => (xs.length ? [h("h3", { text: title }), h("ul", { class: "small" }, xs.slice(0, 30).map((x) => h("li", { text: x })))] : []);
    modal({ title: "Sitzungen gefüllt", wide: true, body: (el) => el.append(
      h("p", { class: "small", text: report.done + " von " + todo.length + " Sitzungen haben ihren gesicherten Inhalt bekommen." + (report.drafts ? " " + report.drafts + " Feibeitsblatt-Entwürfe – mit „Feibeitsblatt jetzt anlegen“ bekommt jedes Blatt in seiner Sitzung einen neuen Code für diese Lerngruppe." : "") }),
      ...list("Nicht übernommen", report.failed), ...list("Angepasste Datumsangaben", report.replaced), ...list("Bitte prüfen: weitere Datumsangaben", report.unknown),
      ...list("Dateien, die fehlen", report.missing), ...list("Hinweise", report.notes)),
      actions: [{ label: "Fertig", class: "primary" }] });
  }

  paint();
  // Ergebnisse von Claude (Connector) beim Zurückkehren übernehmen, wenn hier nichts ungespeichert ist
  const onVis = async () => {
    if (document.visibilityState !== "visible" || dirty) return;
    try { const r = (await tapi("GET", "/api/teacher/units/" + id)).unit; if (r.version !== u.version) { u = r; rows = u.rows.map((x) => ({ ...x })); plan = JSON.parse(JSON.stringify(u.plan || {})); paint(); toast("Die Einheit wurde aktualisiert" + (u.source === "claude" ? " (von Claude)." : "."), "ok"); } } catch {}
  };
  document.addEventListener("visibilitychange", onVis);
  onLeave(() => document.removeEventListener("visibilitychange", onVis));
}
