// bases.js – Planungsgrundlagen je Fach: Übersicht, was je Jahrgang/Kurs vorliegt oder fehlt; Dokumente hochladen (Text je Seite
// per PDF.js im Browser – die KI arbeitet nur mit diesem Text; zusätzlich liegt die Original-PDF in Unterricks, damit die Lehrkraft sie
// aus der Planung heraus öffnen kann), Abschnitte automatisch erkennen und korrigieren; Fach-Einstellungen. Ev. Religion: auch das
// Schulcurriculum der Grundschule (Jahrgänge 1–4). Jede Planungsgrundlage öffnet sich über #/lk/grundlage/<id> in einem neuen Tab.
import { h, clear, toast, errToast, busy, modal, confirmDialog, fmtTime, fmtBytes, icon, pageHead, upload, apiUrl, stateLine } from "./ui.js";
import { render, go } from "./app.js";
import { T, tapi, teacherBar } from "./teacher.js";
import { SUBJECTS, subjectName, isValidSubject, CLASS_GROUPS, Q_COURSES, classShort, schoolYearOf, berlinToday } from "./shared.js";
import { BASE_KINDS, detectSections, parseRanges, formatRanges, sectionLabel, pageText, wantedSections, missingFor, wantedGsSections, missingForGs, gsReligionCourseIn, baseKindLabel } from "./bases-detect.js";

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
const pdfPages = async (file) => {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try { return doc.numPages; } finally { await doc.destroy(); }
};

/* Link auf eine Planungsgrundlage (neuer Tab): Original-PDF bzw. – bei älteren ohne PDF – ihr gespeicherter Text.
   d = {id, title, pages?} (pages = „5–9“: Seiten, die für die Klasse bzw. den Kurs gelten) */
export function baseLink(d) {
  return h("a", { class: "baselink", href: "#/lk/grundlage/" + d.id, target: "_blank", rel: "noopener" },
    d.title + (d.pages ? " (S. " + d.pages + ")" : ""), h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" }));
}

/* Neue Planungsgrundlage speichern: Text je Seite (für die KI) in Stücken, danach die Original-PDF. Ohne texts liest die Funktion die PDF
   selbst und erkennt die Abschnitte. Scheitert nur die PDF, bleibt die Planungsgrundlage (Ergebnis pdfError); scheitert der Text, wird
   sie wieder gelöscht und der Fehler geworfen. */
export async function uploadBaseFile({ subject, kind, title, scope = [], note = "", file, texts = null, sections = null, onStatus = () => {} }) {
  if (!texts) {
    onStatus("Lese die PDF …");
    texts = await pdfTexts(file, (i, n) => onStatus("Lese Seite " + i + " von " + n + " …"));
    if (texts.length > MAX_PAGES) throw new Error("Die Datei hat " + texts.length + " Seiten – höchstens " + MAX_PAGES + " sind möglich.");
  }
  if (!sections) sections = detectSections(kind, subjectName(subject), texts);
  let base = null;
  try {
    base = (await tapi("POST", "/api/teacher/bases", { body: { subject, kind, title, scope, note, fileName: file.name, pages: texts.length, sections } })).base;
    const enc = new TextEncoder();
    for (let from = 0; from < texts.length;) {
      const chunk = [];
      let bytes = 2;
      while (from + chunk.length < texts.length && chunk.length < CHUNK_PAGES) {
        const b = enc.encode(JSON.stringify(texts[from + chunk.length])).length + 1;
        if (chunk.length && bytes + b > CHUNK_BYTES) break;
        chunk.push(texts[from + chunk.length]); bytes += b;
      }
      onStatus("Speichere Seiten " + (from + 1) + "–" + (from + chunk.length) + " von " + texts.length + " …");
      await tapi("PUT", "/api/teacher/bases/" + base.id + "/pages", { body: { from: from + 1, texts: chunk } });
      from += chunk.length;
    }
  } catch (e) {
    if (base) { try { await tapi("DELETE", "/api/teacher/bases/" + base.id); } catch {} }
    throw e;
  }
  let pdfError = null;
  try {
    onStatus("Speichere die Original-PDF …");
    base = (await upload("/api/teacher/bases/" + base.id + "/pdf?name=" + encodeURIComponent(file.name), file, T.token,
      (f) => onStatus("Speichere die Original-PDF … " + Math.round(f * 100) + " %"), "application/pdf")).base;
  } catch (e) { pdfError = e.message || String(e); }
  return { base, pages: texts.length, pdfError };
}
const pdfFailText = (why) => "Der Text ist gespeichert, die Original-PDF nicht (" + String(why).replace(/\.$/, "") + "). Sie können sie später mit „Original-PDF hinzufügen“ ergänzen.";
const gradeLabel = (key) => (CLASS_GROUPS.find((g) => g.key === key) || {}).label || key;
// Abschnitte, die je Art sinnvoll sind (für „Abschnitt hinzufügen“)
const SECTION_KEYS = {
  kcgo: ["grundlagen", "standards", "regeln", "E1", "E2", "Q1", "Q2", "Q3", "Q4"],
  abiturerlass: ["fach"],
  schulcurriculum: ["5", "6", "7", "8", "9", "10", "allgemein"],
  "e-curriculum": ["E1", "E2", "alle"],
  "gs-curriculum": ["1", "2", "3", "4", "allgemein"],
  sonstiges: [],
};
// Klassen, für die der Status angezeigt wird: je Jahrgang eine Beispielklasse, in der Q-Phase jeder Kurs
const statusRows = (grades) => grades.flatMap((g) => (g === "Q" ? Q_COURSES.map((k) => ({ klass: k, label: classShort(k) })) : [{ klass: g === "E" ? "EA" : g + "A", label: g === "E" ? "E-Phase" : "Jahrgang " + g }]));

/* Geltungsbereich (Kurse/Jahrgänge) je Art */
function scopePickerFor(kind, current, grades = []) {
  const sel = new Set(current || []);
  const opts = kind === "abiturerlass" ? Q_COURSES.map((k) => [k, classShort(k)])
    : kind === "gs-curriculum" ? ["1", "2", "3", "4"].map((g) => [g, "Jg. " + g])
    : kind === "schulcurriculum" ? ["5", "6", "7", "8", "9", "10"].map((g) => [g, "Jg. " + g])
    : kind === "sonstiges" ? [...grades.filter((g) => g !== "Q").map((g) => [g, g === "E" ? "E-Phase" : "Jg. " + g]), ...(grades.includes("Q") ? Q_COURSES.map((k) => [k, classShort(k)]) : [])] : [];
  const box = h("div", { class: "row" }, opts.map(([v, l]) => h("label", { class: "chk" }, h("input", { type: "checkbox", value: v, checked: sel.has(v) ? true : null, onchange: (e) => { if (e.target.checked) sel.add(v); else sel.delete(v); } }), l)));
  const hint = kind === "abiturerlass" ? "Für welche Kurse gilt dieser Erlass? (Ein Erlass gilt für einen Abiturjahrgang – z. B. Q1/Q2 des einen und Q3/Q4 des anderen Jahrgangs.)"
    : kind === "schulcurriculum" ? "Optional: nur für diese Jahrgänge verwenden (leer = nach den erkannten Abschnitten)."
    : kind === "gs-curriculum" ? "Optional: nur für diese Jahrgänge (leer = nach den erkannten Abschnitten)."
    : kind === "sonstiges" ? "Für welche Jahrgänge bzw. Kurse gilt diese Vorgabe?" : "";
  return { el: opts.length ? h("div", { class: "field" }, h("label", null, "Gilt für"), box, hint ? h("p", { class: "hint", text: hint }) : null) : null, value: () => [...sel] };
}
/* Abschnitte als Seitenbereiche bearbeiten */
function sectionsEditorFor(kind, sections, pages) {
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

/* Planungsgrundlage bearbeiten (Titel, Geltungsbereich, Abschnitte, Hinweis) – auch von der Seite eines Grundschulkurses.
   grades = Jahrgänge des Fachs (für „Sonstiges“: wofür die Vorgabe gilt; Grundschulkurs: keine) */
export function editBase(b, { grades = [], onSaved = () => {} } = {}) {
  const title = h("input", { value: b.title, maxlength: "200" }), note = h("textarea", { rows: "2", value: b.note || "" });
  const scope = scopePickerFor(b.kind, b.scope, grades), secs = sectionsEditorFor(b.kind, b.sections, b.pages);
  modal({ title: "Planungsgrundlage bearbeiten", wide: true, body: (el) => el.append(h("p", { class: "small muted", text: b.kindLabel + " · " + b.pages + " Seiten" }),
    h("div", { class: "field" }, h("label", null, "Titel"), title), scope.el, h("div", { class: "field" }, h("label", null, "Abschnitte (Seitenangaben)"), secs.el), h("div", { class: "field" }, h("label", null, "Hinweis"), note)),
    actions: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
      try { await tapi("PATCH", "/api/teacher/bases/" + b.id, { body: { title: title.value, note: note.value, scope: scope.value(), sections: secs.value() } }); toast("Gespeichert.", "ok"); onSaved(); }
      catch (e) { errToast(e); return false; }
    } }] });
}

/* ---------- Übersicht über alle Fächer ---------- */
export async function basesOverview() {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("bases"), main);
  let bases, cfgs;
  try { [bases, cfgs] = await Promise.all([tapi("GET", "/api/teacher/bases").then((r) => r.bases), tapi("GET", "/api/teacher/subjects").then((r) => r.subjects)]); }
  catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  clear(main).append(pageHead({ title: "Planungsgrundlagen" }),
    h("p", { class: "small", text: "Die KI plant Unterrichtseinheiten auf Grundlage dieser Vorgaben: in den Jahrgängen 5–10 das Schulcurriculum, in der E-Phase das KCGO (und für Politik und Wirtschaft das schulinterne E-Phasen-Curriculum), in Q1–Q4 das KCGO und den Abiturerlass des Kurses. Laden Sie die Dokumente einmal je Fach hoch; für jeden neuen Abiturjahrgang kommt der aktuelle Abiturerlass dazu." }),
    h("p", { class: "small", text: "Grundschule: Das Schulcurriculum Ev. Religion (Grundschule) laden Sie bei „Evangelische Religion“ hoch; Planungsgrundlagen anderer Grundschulfächer beim jeweiligen Kurs (Menü „Grundschule“)." }),
    h("div", { class: "tiles" }, SUBJECTS.map((s) => {
      const mine = bases.filter((b) => b.subject === s.id), cfg = cfgs[s.id];
      const gaps = statusRows(cfg.grades).filter((r) => missingFor(mine, s.id, s.name, r.klass).length).length;
      return h("a", { class: "tile", href: "#/lk/grundlagen/" + s.id, dataset: { fach: s.id } }, h("div", { class: "t", text: s.name }),
        h("div", { class: "s", text: mine.length + " Dokument" + (mine.length === 1 ? "" : "e") + (gaps ? " · bei " + gaps + " Jahrgang/Kurs fehlt noch etwas" : " · vollständig") + (cfg.complete ? " · von Ihnen bestätigt" : "") }));
    })));
}

/* „Original-PDF hinzufügen“ (ältere Planungsgrundlagen: nur Text) bzw. „… ersetzen“ – dieselbe Datei (gleiche Seitenzahl). Auch für die eigenen
   Planungsgrundlagen eines Grundschulkurses (Kursseite – Abschlussprüfung F12). onSaved: danach (die Seite baut sich neu auf; der Knopf hat die
   Klasse „bpdf“, damit sie ihm den Fokus zurückgeben kann – F39) */
export function basePdfButton(b, { onSaved = () => {} } = {}) {
  const label = b.pdf ? "Original-PDF ersetzen" : "Original-PDF hinzufügen";
  const inp = h("input", { type: "file", accept: "application/pdf,.pdf", class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
  const btn = h("button", { class: "btn small bpdf", type: "button", "aria-label": label + " – „" + b.title + "“", onclick: () => inp.click() }, label);
  inp.addEventListener("change", () => {
    const file = inp.files[0]; inp.value = "";
    if (!file) return;
    busy(btn, async () => {
      try {
        if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new Error("Bitte eine PDF-Datei wählen.");
        let n;
        try { n = await pdfPages(file); } catch { throw new Error("Diese Datei lässt sich nicht als PDF lesen."); }
        if (n !== b.pages) throw new Error("Diese PDF hat " + n + " Seiten, gespeichert sind " + b.pages + ". Bitte dieselbe Datei wählen.");
        await upload("/api/teacher/bases/" + b.id + "/pdf?name=" + encodeURIComponent(file.name), file, T.token, null, "application/pdf");
        toast("Original-PDF zu „" + b.title + "“ gespeichert.", "ok");
        await onSaved();
      } catch (e) { errToast(e); }
    }, "Speichere …");
  });
  return h("span", { class: "pdfpick" }, btn, inp);
}

/* ---------- Seite eines Fachs ---------- */
export async function basesPage(subject) {
  if (!isValidSubject(subject)) return go("#/lk/grundlagen");
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("bases"), main);
  let bases, cfg, gsCourses = [];
  const load = async () => {
    [bases, cfg, gsCourses] = await Promise.all([tapi("GET", "/api/teacher/bases?subject=" + subject).then((r) => r.bases), tapi("GET", "/api/teacher/subjects").then((r) => r.subjects[subject]),
      // Grundschulkurse (für den Stand der Jahrgänge 1–4 bei Ev. Religion); fehlt die Liste, gilt „keine Kurse“
      subject === "evrel" ? tapi("GET", "/api/teacher/gs/courses").then((r) => r.courses || [], () => []) : []]);
  };
  try { await load(); } catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  const name = subjectName(subject);
  const paint = () => {
    clear(main).append(pageHead({ fach: subject, crumbs: [["#/lk/grundlagen", "Planungsgrundlagen"], name], title: "Planungsgrundlagen · " + name }),
      statusCard(), docsCard(), uploadCard(), settingsCard());
  };
  // neu aufbauen; focus = Selektor für das Element, das danach den Fokus bekommt – nur, wenn er mit dem alten Aufbau verloren ging (F39)
  const reload = async (focus = null) => {
    try {
      await load(); paint();
      const a = document.activeElement;
      if (focus && (!a || a === document.body || !a.isConnected)) { const t = main.querySelector(focus); if (t) t.focus(); }
    } catch (e) { errToast(e); }
  };

  function statusCard() {
    const rows = statusRows(cfg.grades);
    const tbody = h("tbody", { role: "rowgroup" }, rows.map((r) => {
      const docs = bases.filter((b) => wantedSections(b, r.klass).length), miss = missingFor(bases, subject, name, r.klass);
      return h("tr", { role: "row" }, h("td", { text: r.label, "data-label": "Jahrgang / Kurs", role: "cell" }),
        h("td", { class: "small", "data-label": "Verwendete Grundlagen", role: "cell" }, docs.length ? docs.map((b) => h("div", null, baseLink({ id: b.id, title: b.title, pages: formatRanges([...new Set(wantedSections(b, r.klass).map((w) => w.n))]) }))) : h("span", { class: "muted", text: "–" })),
        h("td", { class: "small", "data-label": "Status", role: "cell" }, miss.length ? h("span", { class: "warnc", text: "fehlt: " + miss.join("; ") }) : h("span", { class: "ok" }, icon("check"), "vollständig")));
    }));
    const otherSubject = subject !== "powi";
    const head = () => h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, ["Jahrgang / Kurs", "Verwendete Grundlagen", "Status"].map((t) => h("th", { text: t, role: "columnheader" }))));
    return h("section", { class: "card" }, h("h2", { text: "Was liegt je Jahrgang bzw. Kurs vor?" }),
      otherSubject && !cfg.complete ? h("div", { class: "notice warn", style: { marginBottom: ".7rem" } },
        "Für " + name + " kennt die Plattform die Vorgaben Ihrer Schule nicht. Bitte laden Sie alle Dokumente hoch, die für die Planung nötig sind (Schulcurriculum, KCGO, Abiturerlass, ggf. Fachkonferenzbeschlüsse), und bestätigen Sie unten in den Fach-Einstellungen, dass sie vollständig sind – die Vollständigkeit liegt bei Ihnen.") : null,
      h("div", { class: "table-wrap" }, h("table", { class: "unit-table", role: "table" }, head(), tbody)),
      h("p", { class: "hint", text: "Angezeigt werden nur die Jahrgänge, in denen " + name + " laut Fach-Einstellungen unterrichtet wird. Q-Kurse: Grundkurs (GK) und Leistungskurs (LK) je Kurshalbjahr." }),
      subject === "evrel" ? gsStatus(head) : null);
  }
  /* Ev. Religion: Schulcurriculum der Grundschule je Jahrgang 1–4 („fehlt“ nur, wenn es im laufenden oder einem späteren Schuljahr einen Religionskurs dieses Jahrgangs gibt) */
  function gsStatus(head) {
    const sy = (schoolYearOf(berlinToday()) || {}).label;
    const tbody = h("tbody", { role: "rowgroup" }, ["1", "2", "3", "4"].map((g) => {
      const docs = bases.filter((b) => b.kind === "gs-curriculum" && wantedGsSections(b, g).length), miss = missingForGs(bases, { religion: true, grade: g });
      const course = gsReligionCourseIn(gsCourses, g, sy);
      return h("tr", { role: "row" }, h("td", { text: "Grundschule Jg. " + g, "data-label": "Jahrgang / Kurs", role: "cell" }),
        h("td", { class: "small", "data-label": "Verwendete Grundlagen", role: "cell" }, docs.length ? docs.map((b) => h("div", null, baseLink({ id: b.id, title: b.title, pages: formatRanges([...new Set(wantedGsSections(b, g).map((w) => w.n))]) }))) : h("span", { class: "muted", text: "–" })),
        h("td", { class: "small", "data-label": "Status", role: "cell" }, !miss.length ? h("span", { class: "ok" }, icon("check"), "vollständig")
          : course ? h("span", { class: "warnc", text: "fehlt: " + miss.join("; ") }) : h("span", { class: "muted", text: "–" })));
    }));
    return h("div", { class: "gs-basis" }, h("h3", { text: "Grundschule (Jahrgänge 1–4)" }),
      h("div", { class: "table-wrap" }, h("table", { class: "unit-table", role: "table" }, head(), tbody)));
  }

  function docsCard() {
    const list = h("div", { class: "list" });
    if (!bases.length) list.append(h("p", { class: "muted small", text: "Noch keine Dokumente." }));
    for (const b of bases) {
      const secs = Object.entries(b.sections || {}).map(([k, v]) => sectionLabel(k) + ": S. " + formatRanges(v)).join(" · ");
      const scopeText = b.scope.length ? "für " + b.scope.map((x) => (b.kind === "gs-curriculum" ? "Jg. " + x : classShort(x))).join(", ") : null;
      list.append(h("div", { class: "item", dataset: { base: b.id } }, h("div", { class: "ficon pdf", "aria-hidden": "true", text: "PDF" }),
        h("div", { class: "main" }, h("div", { class: "name" }, baseLink({ id: b.id, title: b.title })),
          h("div", { class: "meta", text: [b.kindLabel, b.pages + " Seiten", scopeText, b.fileName, "hochgeladen " + fmtTime(b.createdAt), b.pdf ? "Original-PDF gespeichert" : "nur Text gespeichert"].filter(Boolean).join(" · ") }),
          secs ? h("div", { class: "meta", text: "Abschnitte: " + secs }) : null, b.note ? h("div", { class: "meta", text: "Hinweis: " + b.note }) : null),
        h("div", { class: "acts" },
          h("a", { class: "btn small", href: "#/lk/grundlage/" + b.id, target: "_blank", rel: "noopener", "aria-label": "„" + b.title + "“ öffnen (öffnet in neuem Tab)" }, "Öffnen"),
          basePdfButton(b, { onSaved: () => reload('[data-base="' + b.id + '"] button.bpdf') }),
          h("button", { class: "btn small", type: "button", onclick: () => editBase(b, { grades: cfg.grades, onSaved: () => reload() }) }, "Bearbeiten"),
          h("button", { class: "btn small", type: "button", onclick: () => viewText(b) }, "Text ansehen"),
          h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Löschen", onclick: async () => {
            if (!(await confirmDialog("Planungsgrundlage löschen", "„" + b.title + "“ mit allen Seitentexten löschen? Bereits geplante Einheiten bleiben erhalten.", "Löschen", true))) return;
            try { await tapi("DELETE", "/api/teacher/bases/" + b.id); toast("Gelöscht.", "ok"); reload(); } catch (e) { errToast(e); }
          } }, icon("trash")))));
    }
    return h("section", { class: "card" }, h("h2", { text: "Dokumente" }), list);
  }
  const scopePicker = (kind, current) => scopePickerFor(kind, current, cfg.grades);
  const sectionsEditor = sectionsEditorFor;

  function uploadCard() {
    let kind = subject === "powi" ? "kcgo" : "schulcurriculum", texts = null, file = null;
    // das Schulcurriculum der Grundschule gibt es nur bei Ev. Religion
    const kinds = Object.entries(BASE_KINDS).filter(([k]) => k !== "gs-curriculum" || subject === "evrel");
    const kindSel = h("select", { "aria-label": "Art der Planungsgrundlage" }, kinds.map(([k, v]) => h("option", { value: k, selected: k === kind ? true : null }, v.label)));
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
      try {
        const r = await uploadBaseFile({ subject, kind, title: title.value, scope: sc, note: note.value, file, texts, sections: secs ? secs.value() : {}, onStatus: (t) => { status.textContent = t; } });
        if (r.pdfError) toast(pdfFailText(r.pdfError), "err", 9000);
        else toast("„" + r.base.title + "“ gespeichert (" + r.pages + " Seiten).", "ok");
        reload();
      } catch (e) {
        errToast(e);
        status.textContent = "Hochladen abgebrochen – bitte erneut versuchen.";
      }
    }, "Speichere …"));
    paintKind();
    return h("section", { class: "card" }, h("h2", { text: "Neue Planungsgrundlage hochladen" }),
      h("div", { class: "meta-grid" }, h("div", { class: "field" }, h("label", null, "Art"), kindSel, kindHint), h("div", { class: "field" }, h("label", null, "PDF-Datei"), fileInp, status)),
      h("div", { class: "field" }, h("label", null, "Titel"), title), scopeBox, detail, h("div", { class: "field" }, h("label", null, "Hinweis"), note),
      h("div", { class: "row end" }, btn),
      h("p", { class: "hint", text: "Ihr Browser liest den Text Seite für Seite aus; die KI arbeitet nur mit diesem Text. Zusätzlich speichert Unterricks die Original-PDF in Ihrer Plattform (nur für Sie sichtbar), damit Sie sie aus der Planung heraus öffnen können." }));
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

/* ---------- Eine Planungsgrundlage im neuen Tab (#/lk/grundlage/<id>) ----------
   Mit Original-PDF: weiter zur PDF (signierter Link, wie „PDF ansehen“). Ältere ohne PDF: ihr gespeicherter Text als lesbare Seite. */
export async function baseDocPage(id) {
  const main = h("main", { class: "narrow" }, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("bases"), main);
  let b;
  try { b = (await tapi("GET", "/api/teacher/bases/" + id)).base; }
  catch (e) { clear(main).append(pageHead({ crumbs: [["#/lk/grundlagen", "Planungsgrundlagen"]], title: "Planungsgrundlage" }), h("p", { class: "err", text: e.message })); return; }
  const head = () => pageHead({ fach: isValidSubject(b.subject) ? b.subject : /^gs[a-f0-9]{8}$/.test(b.subject) ? "gs" : null,
    crumbs: [["#/lk/grundlagen", "Planungsgrundlagen"], b.title], title: b.title, sub: (b.kindLabel || baseKindLabel(b.kind)) + " · " + b.pages + " Seiten" });
  if (b.pdf) {
    const st = h("p", { role: "status", text: "Die PDF wird geöffnet …" });
    clear(main).append(head(), st);
    try { const r = await tapi("POST", "/api/teacher/bases/" + id + "/link"); location.replace(apiUrl(r.url)); }
    catch (e) {
      stateLine(st, e.message, "err");
      main.append(h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => textView(main, b, head, false) }, "Text ansehen")));
    }
    return;
  }
  textView(main, b, head, true);
}
function textView(main, b, head, onlyText) {
  const status = h("p", { class: "small", role: "status", "aria-live": "polite" });
  const pages = h("div", { class: "basepages" });
  const jump = h("input", { type: "number", min: "1", max: String(b.pages), inputmode: "numeric", id: "bt-jump", style: { maxWidth: "7rem" } });
  const go2 = () => {
    const n = Number(jump.value), el = Number.isInteger(n) && document.getElementById("seite-" + n);
    if (!el) { stateLine(status, n >= 1 && n <= b.pages ? "Seite " + n + " wird noch geladen – bitte gleich noch einmal." : "Bitte eine Seite zwischen 1 und " + b.pages + " eingeben.", "err"); return; }
    el.scrollIntoView({ block: "start" }); el.focus({ preventScroll: true });
  };
  jump.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go2(); } });
  clear(main).append(head(),
    // eigene Planungsgrundlage eines Grundschulkurses: „Original-PDF hinzufügen“ steht auf der Kursseite (F12)
    onlyText ? (/^gs[a-f0-9]{8}$/.test(b.subject)
      ? h("div", { class: "notice" }, "Für diese Planungsgrundlage ist nur der Text gespeichert (so liest ihn auch die KI). Laden Sie auf der ", h("a", { href: "#/lk/grundschule/k/" + b.subject }, "Seite des Kurses"),
        " unter „Planungsgrundlagen“ mit „Original-PDF hinzufügen“ dieselbe PDF hoch – dann öffnet sich hier das Original.")
      : h("div", { class: "notice" }, "Für diese Planungsgrundlage ist nur der Text gespeichert (so liest ihn auch die KI). Laden Sie unter „Planungsgrundlagen“ mit „Original-PDF hinzufügen“ dieselbe PDF hoch – dann öffnet sich hier das Original.")) : null,
    h("div", { class: "field row", style: { alignItems: "end", marginTop: ".8rem" } }, h("div", null, h("label", { for: "bt-jump" }, "Zu Seite springen"), jump),
      h("button", { class: "btn", type: "button", onclick: go2 }, "Springen")),
    status, pages);
  (async () => {
    for (let from = 1; from <= b.pages; from += 31) {
      const to = Math.min(b.pages, from + 30);
      if (b.pages > 31) status.textContent = "Seiten " + from + "–" + to + " von " + b.pages + " werden geladen …";
      let r;
      try { r = await tapi("GET", "/api/teacher/bases/" + b.id + "/text?from=" + from + "&to=" + to); }
      catch (e) { stateLine(status, e.message, "err"); return; }
      if (!main.isConnected) return;
      for (const p of r.pages) pages.append(h("section", { id: "seite-" + p.n, tabindex: "-1", class: "basepage" }, h("h2", { text: "Seite " + p.n }), h("div", { class: "basetext", text: p.text || "(kein Text)" })));
    }
    status.textContent = b.pages > 31 ? "Alle " + b.pages + " Seiten geladen." : "";
  })();
}
