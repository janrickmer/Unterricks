// bases.js – Planungsgrundlagen je Fach: Übersicht, was je Jahrgang/Kurs vorliegt oder fehlt; Dokumente hochladen (Text je Seite
// per PDF.js im Browser – die PDF selbst wird nicht gespeichert), Abschnitte automatisch erkennen und korrigieren; Fach-Einstellungen.
import { h, clear, toast, errToast, busy, modal, confirmDialog, fmtTime, fmtBytes, icon, pageHead } from "./ui.js";
import { render, go } from "./app.js";
import { tapi, teacherBar } from "./teacher.js";
import { SUBJECTS, subjectName, isValidSubject, CLASS_GROUPS, Q_COURSES, classShort } from "./shared.js";
import { BASE_KINDS, detectSections, parseRanges, formatRanges, sectionLabel, pageText, wantedSections, missingFor } from "./bases-detect.js";

let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import("/vendor/pdf.min.mjs").then((m) => { m.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs"; return m; });
  return pdfjsP;
}
/* Text je Seite (Index 0 = Seite 1) */
export async function pdfTexts(file, onProgress) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const n = doc.numPages, out = [];
  try {
    for (let i = 1; i <= n; i++) {
      const p = await doc.getPage(i);
      out.push(pageText((await p.getTextContent()).items).slice(0, 20000));
      p.cleanup();
      if (onProgress) onProgress(i, n);
    }
  } finally { await doc.destroy(); }
  return out;
}

const MAX_PAGES = 600, CHUNK_BYTES = 250000, CHUNK_PAGES = 60;
const gradeLabel = (key) => (CLASS_GROUPS.find((g) => g.key === key) || {}).label || key;
// Abschnitte, die je Art sinnvoll sind (für „Abschnitt hinzufügen“)
const SECTION_KEYS = {
  kcgo: ["grundlagen", "standards", "regeln", "E1", "E2", "Q1", "Q2", "Q3", "Q4"],
  abiturerlass: ["fach"],
  schulcurriculum: ["5", "6", "7", "8", "9", "10", "allgemein"],
  "e-curriculum": ["E1", "E2", "alle"],
  sonstiges: [],
};
// Klassen, für die der Status angezeigt wird: je Jahrgang eine Beispielklasse, in der Q-Phase jeder Kurs
const statusRows = (grades) => grades.flatMap((g) => (g === "Q" ? Q_COURSES.map((k) => ({ klass: k, label: classShort(k) })) : [{ klass: g === "E" ? "EA" : g + "A", label: g === "E" ? "E-Phase" : "Jahrgang " + g }]));

/* ---------- Übersicht über alle Fächer ---------- */
export async function basesOverview() {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("bases"), main);
  let bases, cfgs;
  try { [bases, cfgs] = await Promise.all([tapi("GET", "/api/teacher/bases").then((r) => r.bases), tapi("GET", "/api/teacher/subjects").then((r) => r.subjects)]); }
  catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  clear(main).append(pageHead({ title: "Planungsgrundlagen" }),
    h("p", { class: "small", text: "Die KI plant Unterrichtseinheiten auf Grundlage dieser Vorgaben: in den Jahrgängen 5–10 das Schulcurriculum, in der E-Phase das KCGO (und für Politik und Wirtschaft das schulinterne E-Phasen-Curriculum), in Q1–Q4 das KCGO und den Abiturerlass des Kurses. Laden Sie die Dokumente einmal je Fach hoch; für jeden neuen Abiturjahrgang kommt der aktuelle Abiturerlass dazu." }),
    h("div", { class: "tiles" }, SUBJECTS.map((s) => {
      const mine = bases.filter((b) => b.subject === s.id), cfg = cfgs[s.id];
      const gaps = statusRows(cfg.grades).filter((r) => missingFor(mine, s.id, s.name, r.klass).length).length;
      return h("a", { class: "tile", href: "#/lk/grundlagen/" + s.id, dataset: { fach: s.id } }, h("div", { class: "t", text: s.name }),
        h("div", { class: "s", text: mine.length + " Dokument" + (mine.length === 1 ? "" : "e") + (gaps ? " · bei " + gaps + " Jahrgang/Kurs fehlt noch etwas" : " · vollständig") + (cfg.complete ? " · von Ihnen bestätigt" : "") }));
    })));
}

/* ---------- Seite eines Fachs ---------- */
export async function basesPage(subject) {
  if (!isValidSubject(subject)) return go("#/lk/grundlagen");
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("bases"), main);
  let bases, cfg;
  const load = async () => {
    [bases, cfg] = await Promise.all([tapi("GET", "/api/teacher/bases?subject=" + subject).then((r) => r.bases), tapi("GET", "/api/teacher/subjects").then((r) => r.subjects[subject])]);
  };
  try { await load(); } catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  const name = subjectName(subject);
  const paint = () => {
    clear(main).append(pageHead({ fach: subject, crumbs: [["#/lk/grundlagen", "Planungsgrundlagen"], name], title: "Planungsgrundlagen · " + name }),
      statusCard(), docsCard(), uploadCard(), settingsCard());
  };
  const reload = async () => { try { await load(); paint(); } catch (e) { errToast(e); } };

  function statusCard() {
    const rows = statusRows(cfg.grades);
    const tbody = h("tbody", null, rows.map((r) => {
      const docs = bases.filter((b) => wantedSections(b, r.klass).length), miss = missingFor(bases, subject, name, r.klass);
      return h("tr", null, h("td", { text: r.label }),
        h("td", { class: "small" }, docs.length ? docs.map((b) => h("div", { text: b.title + " (S. " + formatRanges([...new Set(wantedSections(b, r.klass).map((w) => w.n))]) + ")" })) : h("span", { class: "muted", text: "–" })),
        h("td", { class: "small" }, miss.length ? h("span", { class: "warnc", text: "fehlt: " + miss.join("; ") }) : h("span", { class: "ok" }, icon("check"), "vollständig")));
    }));
    const otherSubject = subject !== "powi";
    return h("section", { class: "card" }, h("h2", { text: "Was liegt je Jahrgang bzw. Kurs vor?" }),
      otherSubject && !cfg.complete ? h("div", { class: "notice warn", style: { marginBottom: ".7rem" } },
        "Für " + name + " kennt die Plattform die Vorgaben Ihrer Schule nicht. Bitte laden Sie alle Dokumente hoch, die für die Planung nötig sind (Schulcurriculum, KCGO, Abiturerlass, ggf. Fachkonferenzbeschlüsse), und bestätigen Sie unten in den Fach-Einstellungen, dass sie vollständig sind – die Vollständigkeit liegt bei Ihnen.") : null,
      h("div", { class: "table-wrap" }, h("table", { class: "unit-table" }, h("thead", null, h("tr", null, h("th", { text: "Jahrgang / Kurs" }), h("th", { text: "Verwendete Grundlagen" }), h("th", { text: "Status" }))), tbody)),
      h("p", { class: "hint", text: "Angezeigt werden nur die Jahrgänge, in denen " + name + " laut Fach-Einstellungen unterrichtet wird. Q-Kurse: Grundkurs (GK) und Leistungskurs (LK) je Kurshalbjahr." }));
  }

  function docsCard() {
    const list = h("div", { class: "list" });
    if (!bases.length) list.append(h("p", { class: "muted small", text: "Noch keine Dokumente." }));
    for (const b of bases) {
      const secs = Object.entries(b.sections || {}).map(([k, v]) => sectionLabel(k) + ": S. " + formatRanges(v)).join(" · ");
      list.append(h("div", { class: "item" }, h("div", { class: "ficon pdf", "aria-hidden": "true", text: "PDF" }),
        h("div", { class: "main" }, h("div", { class: "name", text: b.title }),
          h("div", { class: "meta", text: [b.kindLabel, b.pages + " Seiten", b.scope.length ? "für " + b.scope.map(classShort).join(", ") : null, b.fileName, "hochgeladen " + fmtTime(b.createdAt)].filter(Boolean).join(" · ") }),
          secs ? h("div", { class: "meta", text: "Abschnitte: " + secs }) : null, b.note ? h("div", { class: "meta", text: "Hinweis: " + b.note }) : null),
        h("div", { class: "acts" },
          h("button", { class: "btn small", type: "button", onclick: () => editBase(b) }, "Bearbeiten"),
          h("button", { class: "btn small", type: "button", onclick: () => viewText(b) }, "Text ansehen"),
          h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Löschen", onclick: async () => {
            if (!(await confirmDialog("Planungsgrundlage löschen", "„" + b.title + "“ mit allen Seitentexten löschen? Bereits geplante Einheiten bleiben erhalten.", "Löschen", true))) return;
            try { await tapi("DELETE", "/api/teacher/bases/" + b.id); toast("Gelöscht.", "ok"); reload(); } catch (e) { errToast(e); }
          } }, icon("trash")))));
    }
    return h("section", { class: "card" }, h("h2", { text: "Dokumente" }), list);
  }

  /* Geltungsbereich (Kurse/Jahrgänge) je Art */
  function scopePicker(kind, current) {
    const sel = new Set(current || []);
    const opts = kind === "abiturerlass" ? Q_COURSES.map((k) => [k, classShort(k)])
      : kind === "schulcurriculum" ? ["5", "6", "7", "8", "9", "10"].map((g) => [g, "Jg. " + g])
      : kind === "sonstiges" ? [...cfg.grades.filter((g) => g !== "Q").map((g) => [g, g === "E" ? "E-Phase" : "Jg. " + g]), ...(cfg.grades.includes("Q") ? Q_COURSES.map((k) => [k, classShort(k)]) : [])] : [];
    const box = h("div", { class: "row" }, opts.map(([v, l]) => h("label", { class: "chk" }, h("input", { type: "checkbox", value: v, checked: sel.has(v) ? true : null, onchange: (e) => { if (e.target.checked) sel.add(v); else sel.delete(v); } }), l)));
    const hint = kind === "abiturerlass" ? "Für welche Kurse gilt dieser Erlass? (Ein Erlass gilt für einen Abiturjahrgang – z. B. Q1/Q2 des einen und Q3/Q4 des anderen Jahrgangs.)"
      : kind === "schulcurriculum" ? "Optional: nur für diese Jahrgänge verwenden (leer = nach den erkannten Abschnitten)."
      : kind === "sonstiges" ? "Für welche Jahrgänge bzw. Kurse gilt diese Vorgabe?" : "";
    return { el: opts.length ? h("div", { class: "field" }, h("label", null, "Gilt für"), box, hint ? h("p", { class: "hint", text: hint }) : null) : null, value: () => [...sel] };
  }
  /* Abschnitte als Seitenbereiche bearbeiten */
  function sectionsEditor(kind, sections, pages) {
    const cur = Object.entries(sections || {}).map(([k, v]) => ({ k, s: formatRanges(v) }));
    const box = h("div", { class: "stack" });
    const paintS = () => {
      clear(box);
      if (!cur.length) box.append(h("p", { class: "muted small", text: kind === "sonstiges" ? "Das ganze Dokument wird verwendet." : "Keine Abschnitte erkannt – ohne Abschnitte verwendet die Plattform das ganze Dokument." }));
      cur.forEach((x, i) => box.append(h("div", { class: "row" }, h("span", { class: "small", style: { minWidth: "12rem" }, text: sectionLabel(x.k) }),
        h("input", { value: x.s, style: { maxWidth: "14rem" }, "aria-label": "Seiten für " + sectionLabel(x.k), placeholder: "z. B. 12–24, 31", oninput: (e) => { x.s = e.target.value; } }),
        h("button", { class: "btn small ghost", type: "button", "aria-label": "Abschnitt entfernen", onclick: () => { cur.splice(i, 1); paintS(); } }, icon("x")))));
      const free = (SECTION_KEYS[kind] || []).filter((k) => !cur.some((x) => x.k === k));
      if (free.length) {
        const add = h("select", { style: { width: "auto" }, "aria-label": "Abschnitt hinzufügen" }, h("option", { value: "" }, "+ Abschnitt hinzufügen …"), free.map((k) => h("option", { value: k }, sectionLabel(k))));
        add.addEventListener("change", () => { if (add.value) { cur.push({ k: add.value, s: "" }); paintS(); } });
        box.append(add);
      }
    };
    paintS();
    return { el: box, value: () => Object.fromEntries(cur.map((x) => [x.k, parseRanges(x.s, pages)]).filter(([, v]) => v.length)) };
  }

  function uploadCard() {
    let kind = subject === "powi" ? "kcgo" : "schulcurriculum", texts = null, file = null;
    const kindSel = h("select", { "aria-label": "Art der Planungsgrundlage" }, Object.entries(BASE_KINDS).map(([k, v]) => h("option", { value: k, selected: k === kind ? true : null }, v.label)));
    const kindHint = h("p", { class: "hint" });
    const fileInp = h("input", { type: "file", accept: "application/pdf,.pdf", "aria-label": "PDF-Datei" });
    const title = h("input", { maxlength: "200", placeholder: "z. B. KCGO Politik und Wirtschaft (2016)" });
    const note = h("textarea", { rows: "2", placeholder: "Optional: Hinweis für die KI, z. B. „gilt für den Abiturjahrgang 2028“" });
    const status = h("div", { class: "small" }), detail = h("div", { class: "stack" });
    const btn = h("button", { class: "btn primary", type: "button", disabled: true }, "Hochladen");
    let scope = scopePicker(kind, []), secs = null;
    const scopeBox = h("div");
    const paintKind = () => {
      kindHint.textContent = BASE_KINDS[kind].hint;
      scope = scopePicker(kind, []);
      clear(scopeBox).append(...(scope.el ? [scope.el] : []));
      paintDetect();
    };
    const paintDetect = () => {
      clear(detail);
      if (!texts) return;
      const det = detectSections(kind, name, texts);
      secs = sectionsEditor(kind, det, texts.length);
      if (kind === "abiturerlass" && !det.fach) detail.append(h("div", { class: "notice warn" }, "Den Fachteil „" + name + "“ hat die Plattform nicht gefunden. Bitte tragen Sie die Seiten des Fachteils ein (sonst wird der ganze Erlass verwendet). Tipp: den Erlass möglichst vollständig als eine Datei hochladen."));
      detail.append(h("div", { class: "field" }, h("label", null, "Erkannte Abschnitte (Seitenangaben, korrigierbar)"), secs.el));
    };
    kindSel.addEventListener("change", () => { kind = kindSel.value; paintKind(); });
    fileInp.addEventListener("change", async () => {
      file = fileInp.files[0] || null; texts = null; btn.disabled = true; clear(detail);
      if (!file) return;
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { status.textContent = "Bitte eine PDF-Datei wählen."; return; }
      if (!title.value) title.value = file.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").slice(0, 200);
      status.textContent = "Lese die PDF …";
      try {
        texts = await pdfTexts(file, (i, n) => { status.textContent = "Lese Seite " + i + " von " + n + " …"; });
        if (texts.length > MAX_PAGES) throw new Error("Die Datei hat " + texts.length + " Seiten – höchstens " + MAX_PAGES + " sind möglich.");
        const chars = texts.reduce((a, t) => a + t.replace(/\s+/g, "").length, 0);
        if (chars < Math.max(50, texts.length * 10)) throw new Error("Die PDF enthält (fast) keinen Text – vermutlich eingescannt. Bitte eine PDF mit Textebene verwenden (z. B. die Originaldatei oder eine Fassung mit Texterkennung).");
        status.textContent = file.name + " · " + fmtBytes(file.size) + " · " + texts.length + " Seiten · " + chars.toLocaleString("de-DE") + " Zeichen Text";
        btn.disabled = false; paintDetect();
      } catch (e) { texts = null; status.textContent = ""; errToast(e); }
    });
    btn.addEventListener("click", () => busy(btn, async () => {
      if (!texts) return;
      const sc = scope.value();
      if ((kind === "abiturerlass" || kind === "sonstiges") && !sc.length) { toast(kind === "abiturerlass" ? "Bitte die Kurse wählen, für die der Erlass gilt." : "Bitte wählen, wofür die Vorgabe gilt.", "err"); return; }
      let base = null;
      try {
        base = (await tapi("POST", "/api/teacher/bases", { body: { subject, kind, title: title.value, scope: sc, note: note.value, fileName: file.name, pages: texts.length, sections: secs ? secs.value() : {} } })).base;
        const enc = new TextEncoder();
        for (let from = 0; from < texts.length;) {
          const chunk = [];
          let bytes = 2;
          while (from + chunk.length < texts.length && chunk.length < CHUNK_PAGES) {
            const b = enc.encode(JSON.stringify(texts[from + chunk.length])).length + 1;
            if (chunk.length && bytes + b > CHUNK_BYTES) break;
            chunk.push(texts[from + chunk.length]); bytes += b;
          }
          status.textContent = "Speichere Seiten " + (from + 1) + "–" + (from + chunk.length) + " von " + texts.length + " …";
          await tapi("PUT", "/api/teacher/bases/" + base.id + "/pages", { body: { from: from + 1, texts: chunk } });
          from += chunk.length;
        }
        toast("„" + base.title + "“ gespeichert (" + texts.length + " Seiten).", "ok");
        reload();
      } catch (e) {
        errToast(e);
        if (base) { try { await tapi("DELETE", "/api/teacher/bases/" + base.id); } catch {} status.textContent = "Hochladen abgebrochen – bitte erneut versuchen."; }
      }
    }, "Speichere …"));
    paintKind();
    return h("section", { class: "card" }, h("h2", { text: "Neue Planungsgrundlage hochladen" }),
      h("div", { class: "meta-grid" }, h("div", { class: "field" }, h("label", null, "Art"), kindSel, kindHint), h("div", { class: "field" }, h("label", null, "PDF-Datei"), fileInp, status)),
      h("div", { class: "field" }, h("label", null, "Titel"), title), scopeBox, detail, h("div", { class: "field" }, h("label", null, "Hinweis"), note),
      h("div", { class: "row end" }, btn),
      h("p", { class: "hint", text: "Die PDF verlässt Ihr Gerät nicht: Ihr Browser liest den Text Seite für Seite aus, gespeichert werden nur die Texte (für die KI). Schulinterne Dokumente sind damit nur in Ihrer Plattform hinterlegt." }));
  }

  function editBase(b) {
    const title = h("input", { value: b.title, maxlength: "200" }), note = h("textarea", { rows: "2", value: b.note || "" });
    const scope = scopePicker(b.kind, b.scope), secs = sectionsEditor(b.kind, b.sections, b.pages);
    modal({ title: "Planungsgrundlage bearbeiten", wide: true, body: (el) => el.append(h("p", { class: "small muted", text: b.kindLabel + " · " + b.pages + " Seiten" }),
      h("div", { class: "field" }, h("label", null, "Titel"), title), scope.el, h("div", { class: "field" }, h("label", null, "Abschnitte (Seitenangaben)"), secs.el), h("div", { class: "field" }, h("label", null, "Hinweis"), note)),
      actions: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
        try { await tapi("PATCH", "/api/teacher/bases/" + b.id, { body: { title: title.value, note: note.value, scope: scope.value(), sections: secs.value() } }); toast("Gespeichert.", "ok"); reload(); }
        catch (e) { errToast(e); return false; }
      } }] });
  }

  function viewText(b) {
    let from = 1;
    const box = h("div", { class: "stack" }), nav = h("div", { class: "row between" });
    const show = async () => {
      clear(box).append(h("p", { class: "muted small", text: "Lade …" }));
      try {
        const r = await tapi("GET", "/api/teacher/bases/" + b.id + "/text?from=" + from + "&to=" + Math.min(b.pages, from + 4));
        clear(box).append(...r.pages.map((p) => h("div", null, h("div", { class: "small muted", text: "Seite " + p.n }), h("pre", { class: "basetext", text: p.text || "(kein Text)" }))));
        clear(nav).append(h("button", { class: "btn small", type: "button", disabled: from <= 1 ? true : null, onclick: () => { from = Math.max(1, from - 5); show(); } }, icon("left"), "zurück"),
          h("span", { class: "small", text: "Seiten " + from + "–" + Math.min(b.pages, from + 4) + " von " + b.pages }),
          h("button", { class: "btn small", type: "button", disabled: from + 5 > b.pages ? true : null, onclick: () => { from += 5; show(); } }, "weiter", icon("right")));
      } catch (e) { clear(box).append(h("p", { class: "err", text: e.message })); }
    };
    modal({ title: b.title, wide: true, body: (el) => el.append(h("p", { class: "hint", text: "So liest die KI das Dokument (Text ohne Layout)." }), nav, box) });
    show();
  }

  function settingsCard() {
    const grades = new Set(cfg.grades), notes = { ...(cfg.gradeNotes || {}) };
    const allKeys = CLASS_GROUPS.map((g) => g.key);
    const gradeBox = h("div", { class: "row" }, allKeys.map((k) => h("label", { class: "chk" }, h("input", { type: "checkbox", checked: grades.has(k) ? true : null, onchange: (e) => { if (e.target.checked) grades.add(k); else grades.delete(k); paintNotes(); } }), k === "E" ? "E-Phase" : k === "Q" ? "Q-Phase" : "Jg. " + k)));
    const notesBox = h("div", { class: "stack" });
    const paintNotes = () => clear(notesBox).append(...allKeys.filter((k) => grades.has(k)).map((k) => h("div", { class: "row" }, h("span", { class: "small", style: { minWidth: "10rem" }, text: gradeLabel(k).replace(/ \(.*\)$/, "") }),
      h("div", { class: "grow" }, h("input", { value: notes[k] || "", placeholder: "Hinweis für die KI (optional)", "aria-label": "Hinweis für " + gradeLabel(k), oninput: (e) => { notes[k] = e.target.value; } })))));
    paintNotes();
    const rules = h("textarea", { rows: "7", value: cfg.rules || "", placeholder: "Regeln, die die KI bei jeder Einheitenplanung beachten soll" });
    const complete = h("input", { type: "checkbox", checked: cfg.complete ? true : null });
    return h("section", { class: "card" }, h("h2", { text: "Fach-Einstellungen" }),
      h("div", { class: "field" }, h("label", null, "In welchen Jahrgängen wird " + name + " an Ihrer Schule unterrichtet?"), gradeBox,
        h("p", { class: "hint", text: "Nur diese Jahrgänge erscheinen bei der Klassenwahl (Lehrkraft und Schüler:innen)." })),
      h("div", { class: "field" }, h("label", null, "Hinweise je Jahrgang"), notesBox),
      h("div", { class: "field" }, h("label", null, "Planungsregeln für die KI"), rules),
      h("label", { class: "chk" }, complete, "Die Planungsgrundlagen für " + name + " sind vollständig hochgeladen (die Vollständigkeit liegt bei mir)."),
      h("div", { class: "row end" }, h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const gradeNotes = Object.fromEntries(Object.entries(notes).filter(([k, v]) => grades.has(k) && String(v).trim()));
          await tapi("PUT", "/api/teacher/subjects/" + subject, { body: { grades: allKeys.filter((k) => grades.has(k)), gradeNotes, rules: rules.value, complete: complete.checked } });
          toast("Fach-Einstellungen gespeichert.", "ok"); reload();
        } catch (err) { errToast(err); }
      }) }, "Speichern")));
  }

  paint();
}
