// units.js – Seite einer Unterrichtseinheit: Rahmendaten → Termine, Planungsgrundlagen, Planung mit Claude, Leupold-Schema, Ablauf-Tabelle,
// Sitzungen anlegen. Außerdem: Darstellung des Leupold-Schemas (auch in der Sitzungsansicht, aktuelle Stunde fett).
import { h, clear, toast, errToast, busy, confirmDialog, fmtTime, nn, icon, pageHead } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { T, tapi, teacherBar } from "./teacher.js";
import { subjectName, gradeInfo, classShort, fmtDay, isAnalogClass } from "./shared.js";
import { WEEKDAYS, computeSlots, lessonSlots, claudeUnitPrompt, normalizeParams } from "./planning.js";
import { claudeHandoff } from "./claude.js";

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
  let rows = u.rows.map((r) => ({ ...r })), plan = JSON.parse(JSON.stringify(u.plan || {}));
  let dirty = false;
  const markDirty = () => { dirty = true; saveState.textContent = "Ungespeicherte Änderungen"; };

  const paint = () => {
    clear(main);
    main.append(pageHead({ fach: u.subject, crumbs: [["#/lk", "Fächer"], ["#/lk/f/" + u.subject, subjectName(u.subject)], ["#/lk/f/" + u.subject + "/" + u.klass, classShort(u.klass)], u.title || "Neue Einheit"],
        title: u.title || "Neue Unterrichtseinheit", aside: h("span", { class: "badge " + (u.status === "geplant" ? "ok" : ""), text: u.status === "geplant" ? "festgelegt · Sitzungen angelegt" : "Entwurf" }),
        sub: subjectName(u.subject) + " · " + classShort(u.klass) + " · " + gradeInfo(u.klass).text }),
      paramsCard(), basisCard(), claudeCard(), schemaCard(), tableCard(), finishCard());
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
    const start = h("input", { type: "date", value: p.start || "", "aria-label": "Beginn" }), end = h("input", { type: "date", value: p.end || "", "aria-label": "Ende" });
    const exam = h("input", { type: "date", value: p.exam || "", "aria-label": "Klausurtermin" }), notes = h("textarea", { rows: "2", value: p.notes || "", placeholder: "Weitere Hinweise (optional)" });
    const slots = computeSlots(u.params), ls = lessonSlots(slots);
    const slotInfo = h("div", { class: "small" }, ls.length ? [h("strong", { text: ls.length + " Sitzungen verfügbar" }), " · " + ls.map((s) => fmtDay(s.date).slice(0, 9) + " (" + s.minutes + ")").join(", "),
      slots.some((s) => s.kind === "klausur") ? h("div", { class: "warnc", text: "Klausur: " + slots.filter((s) => s.kind === "klausur").map((s) => fmtDay(s.date)).join(", ") }) : null] : h("span", { class: "muted", text: "Noch keine Termine – bitte Stundenplan, Beginn und Ende eintragen." }));
    return h("section", { class: "card" }, h("h2", { text: "1. Rahmendaten der Einheit" }),
      h("div", { class: "field" }, h("label", null, "Thema / Arbeitstitel"), title),
      h("div", { class: "meta-grid" },
        h("div", { class: "field" }, h("label", null, "Sitzungen pro Woche (Wochentag, Beginn und Länge)"), wdBox),
        h("div", { class: "field" }, h("label", null, "Ferien und bekannte Ausfälle im Zeitraum"), brBox),
        h("div", { class: "field" }, h("label", null, "Beginn der Einheit"), start),
        h("div", { class: "field" }, h("label", null, "Abgeschlossen sein bis"), end),
        h("div", { class: "field" }, h("label", null, "Klausurtermin (falls vorhanden)"), exam),
        h("div", { class: "field" }, h("label", null, "Hinweise"), notes)),
      h("div", { class: "row between" }, slotInfo,
        h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try {
            const params = { weekdays: wds, breaks: brs.filter((b) => b.from), start: start.value || null, end: end.value || null, exam: exam.value || null, notes: notes.value };
            u = (await tapi("PATCH", "/api/teacher/units/" + id, { body: { title: title.value, params } })).unit;
            toast(lessonSlots(computeSlots(u.params)).length + " Sitzungen verfügbar.", "ok"); paint();
          } catch (err) { errToast(err); }
        }) }, "Speichern und Termine berechnen")));
  }

  /* 2) Planungsgrundlagen */
  function basisCard() {
    const box = h("div", { class: "small muted", text: "Lade …" });
    tapi("GET", "/api/teacher/basis?subject=" + u.subject + "&klass=" + u.klass).then((b) => {
      clear(box).classList.remove("muted");
      box.append(...nn(b.docs.length ? h("ul", null, b.docs.map((d) => h("li", { text: d.title + " (S. " + d.pages + ")" }))) : h("p", { class: "warnc", text: "Für diese Klasse ist noch keine Planungsgrundlage hinterlegt." }),
        b.missing.length ? h("div", { class: "notice warn" }, "Es fehlen noch: " + b.missing.join("; ") + ". ", h("a", { href: "#/lk/grundlagen/" + u.subject }, "Jetzt hochladen")) : null,
        b.gradeNote ? h("p", null, h("strong", { text: "Hinweis: " }), b.gradeNote) : null,
        isAnalogClass(u.klass) ? h("p", { class: "warnc", text: "Jahrgang 5/6: keine iPads – die KI plant nur analoge, ausdruckbare Materialien." }) : null));
    }).catch((e) => { box.textContent = e.message; });
    return h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "2. Planungsgrundlagen" }), h("a", { class: "btn small", href: "#/lk/grundlagen/" + u.subject }, "Verwalten")), box);
  }

  /* 3) Mit Claude planen */
  function claudeCard() {
    const ls = lessonSlots(computeSlots(u.params));
    const btn = h("button", { class: "btn primary big", type: "button", disabled: ls.length ? null : true }, "Einheit mit Claude planen");
    btn.addEventListener("click", async () => {
      let b = { docs: [], missing: [], rules: "", gradeNote: "" };
      try { b = await tapi("GET", "/api/teacher/basis?subject=" + u.subject + "&klass=" + u.klass); } catch {}
      const cfg = (await tapi("GET", "/api/teacher/subjects")).subjects[u.subject];
      claudeHandoff({ title: "Unterrichtseinheit mit Claude planen",
        intro: "Claude fragt Sie zuerst" + (u.subject === "powi" ? " nach der Planungsgrundlage (mit priorisiertem und sekundärem Vorschlag), " : " ") + "dann nach der zentralen Lernaufgabe (drei Vorschläge) und erstellt danach Leupold-Schema und Ablauftabelle für " + ls.length + " Sitzungen.",
        after: "Wenn Claude den Plan mit „save_unit_plan“ gespeichert hat, kommen Sie hierher zurück: Leupold-Schema und Tabelle erscheinen unten und lassen sich bearbeiten.",
        prompt: () => claudeUnitPrompt({ unitId: u.id, subject: u.subject, klass: u.klass, title: u.title, params: u.params, slots: computeSlots(u.params),
          rules: cfg.rules, gradeNote: b.gradeNote, bases: b.docs.map((d) => d.title), missing: b.missing }) });
    });
    return h("section", { class: "card claudeplan" }, h("div", { class: "section-title" }, h("h2", { text: "3. Planung mit Claude" }), h("span", { class: "badge", text: "Hauptweg" })),
      h("p", { class: "small", text: "Die Planung der Einheit übernimmt Claude mit Ihrem Pro-Abo in claude.ai. Claude liest die Planungsgrundlagen über den Connector, stimmt Planungsgrundlage und Lernaufgabe mit Ihnen ab und speichert Leupold-Schema und Ablauf direkt hier." }),
      ls.length ? null : h("p", { class: "warnc small", text: "Bitte zuerst die Rahmendaten eintragen und Termine berechnen." }), btn,
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
            h("div", { class: "muted", text: r.minutes ? r.minutes + " min" : "" })),
          h("td", { "data-label": "Stundenfrage", role: "cell" }, h("textarea", { rows: "3", value: r.stundenfrage, "aria-label": "Stundenfrage " + (i + 1), oninput: (e) => { r.stundenfrage = e.target.value; markDirty(); } })),
          h("td", { "data-label": "Grober Stundenablauf", role: "cell" }, h("textarea", { rows: "4", value: r.ablauf.map((a) => "- " + a).join("\n"), "aria-label": "Ablauf " + (i + 1), oninput: (e) => { r.ablauf = e.target.value.split("\n").map((x) => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean); markDirty(); } })),
          h("td", { "data-label": "Lernschritt", role: "cell" }, h("select", { "aria-label": "Lernschritt " + (i + 1), onchange: (e) => { r.schritt = e.target.value === "" ? null : Number(e.target.value); markDirty(); } },
            h("option", { value: "" }, "–"), steps.map((s, k) => h("option", { value: k, selected: r.schritt === k ? true : null }, (k + 1) + ". " + (s.titel || "").slice(0, 40))))),
          h("td", { class: "small", "data-label": "Sitzung", role: "cell" }, l ? h("a", { class: "btn small", href: "#/lk/s/" + l.id }, "Sitzung öffnen") : h("span", { class: "muted", text: "noch keine Sitzung" }),
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
      h("p", { class: "hint", text: "Spalte 1: Stundenfrage, Spalte 2: grober Ablauf in Stichpunkten (eine Zeile = ein Stichpunkt). Die Einheit bleibt das ganze Schuljahr über änderbar; Abweichungen aus der Stundenplanung landen hier." }));
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
    const open = rows.filter((r) => !u.lessons.some((l) => l.row === r.uid)).length;
    return h("section", { class: "card" }, h("h2", { text: "6. Einheit festlegen und Sitzungen anlegen" }),
      h("p", { class: "small", text: open ? "Legt für " + open + " Stunde(n) eine Sitzung mit Datum und Dauer an. Erst danach beginnt die Planung der einzelnen Stunden; die Stundenfrage wird zum Titel der Sitzung." : "Zu allen Stunden gibt es eine Sitzung." }),
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", disabled: open ? null : true, onclick: (e) => busy(e.currentTarget, async () => {
          if (dirty) await save(false);
          try { const r = await tapi("POST", "/api/teacher/units/" + id + "/sessions"); u = r.unit; rows = u.rows.map((x) => ({ ...x })); toast(r.created + " Sitzung(en) angelegt.", "ok"); paint(); }
          catch (err) { errToast(err); }
        }) }, "Einheit festlegen und Sitzungen anlegen"),
        u.lessons.length ? null : h("button", { class: "btn danger", type: "button", onclick: async () => {
          if (!(await confirmDialog("Einheit löschen", "Diese Einheit mit Plan und Tabelle löschen?", "Löschen", true))) return;
          try { await tapi("DELETE", "/api/teacher/units/" + id); go("#/lk/f/" + u.subject + "/" + u.klass); } catch (e) { errToast(e); }
        } }, "Einheit löschen")));
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
