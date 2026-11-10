// substitute.js – Krankheitsvertretung in der Sitzungsansicht: Knopf „Lehrkraft ist zu dieser Sitzung krank – Alternative entwickeln“
// (Claude in claude.ai über den Connector; Modell und Aufwand werden vorher erfragt), Prüfung des Vorschlags, Bestätigen (die
// ursprüngliche Planung wird archiviert, die Sitzung umgestellt), Wiederherstellen und Übernahme der Planung in eine andere Sitzung.
import { h, clear, toast, errToast, busy, modal, confirmDialog, fmtTime, store, nn } from "./ui.js";
import { tapi } from "./teacher.js";
import { go } from "./app.js";
import { formatCode, fmtDay } from "./shared.js";
import { claudeSubstitutePrompt, SUBSTITUTE_SHARE } from "./planning.js";
import { claudeHandoff } from "./claude.js";
import { renderMarkdown } from "./markdown.js";
import { portalPreview } from "./portalview.js";

const memo = {
  get(k) { try { return JSON.parse(store.get(k) || "null"); } catch { return null; } },
  set(k, v) { store.set(k, JSON.stringify(v)); }, del(k) { store.del(k); },
};

export function substituteCards({ id, st, L, ctx, fb, analog, reload, openDraft, flushPortal }) {
  const mainBox = h("div");
  const side = h("section", { class: "card sick" });
  const minutes = () => L().durationMin || (ctx().row && ctx().row.minutes) || 45;
  const work = () => Math.round(minutes() * SUBSTITUTE_SHARE);

  function start() {
    if (st.sub && st.sub.status === "aktiv") { toast("Für diese Sitzung ist bereits eine Vertretung aktiv.", "err"); mainBox.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    flushPortal();
    claudeHandoff({ title: "Lehrkraft ist krank – Vertretungsstunde mit Claude entwickeln",
      intro: "Claude untersucht die geplante Stunde (fachdidaktische Kompetenz, Stundenfrage, Lerninhalte) und entwickelt daraus eine Stunde, die die Schüler:innen ohne Sie bearbeiten: ca. " + work() + " Minuten Bearbeitungszeit (80 % von " + minutes() + " Minuten)" +
        (analog ? ", mit ausdruckbarem Material (Jahrgang 5/6, keine iPads)." : ", mit Abgabe in der Plattform – z. B. ein Escape-Room nach dem bekannten Aufbau mit Feibeitsblatt-Finale oder ein Feibeitsblatt (bei einem Lernprodukt mit Foto-Abgabe)."),
      after: "Wenn Claude den Vorschlag mit „save_substitute_plan“ gespeichert hat, kommen Sie hierher zurück: Der Vorschlag erscheint oben auf dieser Seite. Erst wenn Sie ihn bestätigen, wird der Inhalt der Sitzung ausgetauscht.",
      prompt: () => claudeSubstitutePrompt({ ...ctx(), escape: !analog }) });
  }

  function paintSide() {
    const s = st.sub;
    clear(side).append(...nn(h("h2", { text: "Krankheit" }),
      s && s.status === "aktiv" ? h("p", { class: "small" }, h("span", { class: "badge ink", text: "Vertretung aktiv" }), " seit " + fmtTime(s.confirmedAt || s.updatedAt))
        : s && s.status === "vorschlag" ? h("p", { class: "small" }, h("span", { class: "badge", text: "Vorschlag liegt vor" }), " – bitte oben prüfen.") : null,
      h("button", { class: "btn sickbtn", type: "button", onclick: start }, "Lehrkraft ist zu dieser Sitzung krank – Alternative entwickeln"),
      h("p", { class: "hint", text: "Claude (Ihr Pro-Abo in claude.ai, über den Connector) entwickelt eine Vertretungsstunde aus dieser Planung. Sie prüfen und bestätigen sie hier; die ursprüngliche Planung wird archiviert und bleibt wiederherstellbar." })));
  }

  const list = (arr) => h("ul", null, arr.map((x) => h("li", { text: x })));
  function stepsNode(p) {
    return h("ol", { class: "sub-steps" }, (p.schritte || []).map((x) => h("li", null,
      h("div", { class: "row between" }, h("strong", { text: x.titel }), h("span", { class: "row" }, x.minuten ? h("span", { class: "badge", text: "ca. " + x.minuten + " min" }) : null, x.abgabe ? h("span", { class: "badge ink", text: "Abgabe" }) : null)),
      renderMarkdown(x.anleitung || ""))));
  }
  function materialsNode(mats) {
    if (!mats || !mats.length) return h("p", { class: "muted small", text: "Kein zusätzliches Material." });
    return h("div", { class: "list" }, mats.map((m) => h("div", { class: "item" }, h("div", { class: "main" }, h("div", { class: "name", text: m.titel }), h("div", { class: "meta", text: m.bereich === "teacher" ? "nur für Lehrkräfte" : "für Schüler:innen · als PDF herunterladbar" })),
      h("div", { class: "acts" }, h("button", { class: "btn small", type: "button", onclick: () => modal({ title: m.titel, wide: true, body: (el) => el.append(renderMarkdown(m.markdown)) }) }, "Ansehen")))));
  }

  // Escape-Room im Vorschlag bzw. in der aktiven Vertretung: Stationen, Lösungswort, Vorschau
  function escapeNode(p, active) {
    const r = p.escape_room;
    if (!r) return null;
    return h("div", { class: "escbox" }, h("div", { class: "row between" }, h("strong", { text: "Escape-Room „" + r.name + "“" }), h("span", { class: "badge mono", text: "Lösungswort " + r.wort })),
      h("ol", { class: "small" }, r.stationen.map((x) => h("li", { text: x.titel + " – " + x.raetsel.teile.length + " Rätselteil" + (x.raetsel.teile.length === 1 ? "" : "e") + " (" + x.raetsel.teile.map((t) => t.typ).join(", ") + ")" }))),
      h("p", { class: "small muted", text: "Finale: Feibeitsblatt „" + r.feibeitsblatt.titel + "“ mit " + r.feibeitsblatt.aufgaben.length + " Aufgabe(n)" + (active ? (p.escapeSheet ? " (Code " + formatCode(p.escapeSheet) + ")." : ".") : " – wird beim Bestätigen angelegt.") }),
      h("button", { class: "btn small", type: "button", onclick: () => go("#/lk/escape/" + id) }, "Escape-Room ansehen (Vorschau)"));
  }

  function paintProposal() {
    const s = st.sub, p = s.proposal || {}, a = p.analyse || {};
    const dr = p.draftId ? st.drafts.find((x) => x.id === p.draftId) : null;
    const total = (p.schritte || []).reduce((n, x) => n + (x.minuten || 0), 0);
    const fbBox = h("div");
    if (dr && dr.data) {
      const photo = dr.data.tasks.filter((t) => t.answer && t.answer.type === "photo").length;
      fbBox.append(h("div", { class: "item" }, h("div", { class: "ficon fb", "aria-hidden": "true", text: "FB" }),
        h("div", { class: "main" }, h("div", { class: "name", text: dr.data.title }), h("div", { class: "meta", text: dr.data.tasks.length + " Aufgabe" + (dr.data.tasks.length === 1 ? "" : "n") + (photo ? " · davon " + photo + " mit Foto-Abgabe" : "") + (dr.status === "created" ? " · bereits angelegt (" + formatCode(dr.sheetCode) + ")" : " · wird beim Bestätigen angelegt") })),
        h("div", { class: "acts" }, h("button", { class: "btn small", type: "button", onclick: () => openDraft(dr, { onSaved: paint }) }, "Prüfen/bearbeiten"))));
    } else if (p.draftId) fbBox.append(h("p", { class: "warnc small", text: "Der Feibeitsblatt-Entwurf dieses Vorschlags fehlt. Bitte einen neuen Vorschlag mit Claude entwickeln." }));
    else if (!analog) fbBox.append(h("p", { class: "warnc small", text: "Dieser Vorschlag enthält kein Feibeitsblatt." }));
    else fbBox.append(h("p", { class: "small muted", text: "Jahrgang 5/6: Abgabe auf Papier (kein Feibeitsblatt)." }));

    const confirmBtn = h("button", { class: "btn primary", type: "button" }, "Bestätigen: Sitzung auf Vertretung umstellen");
    confirmBtn.addEventListener("click", () => confirmProposal(confirmBtn, dr));
    clear(mainBox).append(h("section", { class: "card substitute", "aria-label": "Vertretungsvorschlag" },
      h("div", { class: "section-title" }, h("h2", { text: "Vertretungsvorschlag prüfen" }), h("span", { class: "badge", text: "noch nicht bestätigt" })),
      h("p", { class: "small", text: "Claude hat den Vorschlag am " + fmtTime(s.updatedAt) + " gespeichert. Erst wenn Sie bestätigen, wird die ursprüngliche Planung archiviert und die Sitzung für die Schüler:innen auf die Vertretung umgestellt." }),
      h("h3", { text: "Analyse der geplanten Stunde" }),
      h("div", { class: "meta-grid" },
        h("div", null, h("div", { class: "lp-cap", text: "Fachdidaktische Kompetenz" }), h("div", { class: "small", text: a.kompetenz || "–" })),
        h("div", null, h("div", { class: "lp-cap", text: "Stundenfrage" }), h("div", { class: "small", text: a.stundenfrage || "–" })),
        h("div", { class: "full" }, h("div", { class: "lp-cap", text: "Lerninhalte" }), (a.inhalte || []).length ? list(a.inhalte) : h("div", { class: "small muted", text: "–" }))),
      h("p", { class: "small" }, h("strong", { text: "Format: " }), p.format || "–", " · ", h("strong", { text: "Bearbeitungszeit: " }),
        (p.bearbeitungszeit || total || "?") + " Minuten", " (Ziel: ca. " + work() + " Minuten = 80 % von " + minutes() + ")"),
      h("h3", { text: "Das sehen die Schüler:innen" }),
      h("div", { class: "notice" }, p.hinweis || ""), stepsNode(p),
      p.abgabe ? h("p", { class: "small" }, h("strong", { text: "Abgabe: " }), p.abgabe) : null,
      h("h3", { text: "Material" }), materialsNode(p.materialien),
      p.escape_room ? h("h3", { text: "Escape-Room" }) : null, escapeNode(p, false),
      h("h3", { text: p.escape_room ? "Finale im Feibeitsblatt" : "Feibeitsblatt" }), fbBox,
      p.schulportal ? h("details", { class: "box" }, h("summary", null, "Schulportal-Eintrag der Vertretung"), portalPreview(p.schulportal)) : null,
      p.vertretung ? h("details", { class: "box" }, h("summary", null, "Hinweise für die Vertretungslehrkraft"), renderMarkdown(p.vertretung)) : null,
      h("div", { class: "row between", style: { marginTop: ".8rem" } },
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: start }, "Neuen Vorschlag mit Claude entwickeln"),
          h("button", { class: "btn ghost danger", type: "button", onclick: discard }, "Verwerfen")), confirmBtn)));
  }

  async function confirmProposal(btn, dr) {
    const p = st.sub.proposal || {};
    if (p.draftId && !dr) { toast("Der Feibeitsblatt-Entwurf der Vertretung fehlt – bitte einen neuen Vorschlag mit Claude entwickeln.", "err"); return; }
    // ein bereits angelegtes Blatt (z. B. nach einem abgebrochenen Versuch) wiederverwenden statt doppelt anzulegen
    const key = "u.subsheet." + (p.draftId || "");
    let sheet = dr && dr.status === "created" && dr.sheetCode ? { code: dr.sheetCode, title: dr.data.title } : p.draftId ? memo.get(key) : null;
    if (dr && !sheet && !fb.connected) {
      toast("Bitte zuerst unten im Abschnitt „Feibeitsblatt“ verbinden (Türcode und Passwort) – das Feibeitsblatt der Vertretung wird beim Bestätigen angelegt.", "err", 8000);
      const fbc = document.querySelector("#fbcard"); if (fbc) fbc.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!(await confirmDialog("Vertretung bestätigen", "Die ursprüngliche Planung (Schulportal-Eintrag, Hausaufgabe, Material und Feibeitsblätter) wird archiviert – Sie können sie später wiederherstellen oder in eine andere Sitzung übernehmen. Die Schüler:innen sehen danach den Hinweis auf Ihre Abwesenheit und die Anleitung." +
      (dr && !sheet ? " Das Feibeitsblatt der Vertretung wird jetzt im Feibeitsblatt angelegt (danach nicht mehr änderbar)." : ""), "Bestätigen und umstellen"))) return;
    await busy(btn, async () => {
      try {
        if (dr && !sheet) { const r = await fb.createSheet(dr.data); sheet = { code: r.code, title: r.title }; memo.set(key, sheet); }
        await tapi("POST", "/api/teacher/lessons/" + id + "/substitute/confirm", { body: { sheet } });
        memo.del(key);
        toast("Vertretung aktiv – die Schüler:innen sehen jetzt den Hinweis und die Anleitung.", "ok", 6000);
        reload();
      } catch (e) { errToast(e); }
    }, "Stelle um …");
  }
  async function discard() {
    if (!(await confirmDialog("Vorschlag verwerfen", "Den Vertretungsvorschlag (und seinen Feibeitsblatt-Entwurf) löschen? Die Sitzung bleibt unverändert.", "Verwerfen", true))) return;
    const draftId = ((st.sub || {}).proposal || {}).draftId;
    try { await tapi("POST", "/api/teacher/lessons/" + id + "/substitute/discard"); st.sub = null; st.drafts = st.drafts.filter((x) => x.id !== draftId); paint(); toast("Vorschlag verworfen.", "ok"); }
    catch (e) { errToast(e); }
  }

  function paintActive() {
    const s = st.sub, p = s.proposal || {}, ar = s.archive || {};
    const archived = st.files.filter((f) => f.area === "archive");
    clear(mainBox).append(h("section", { class: "card substitute active", "aria-label": "Vertretung aktiv" },
      h("div", { class: "section-title" }, h("h2", { text: "Vertretung aktiv" }), h("span", { class: "badge ink", text: "seit " + fmtTime(s.confirmedAt || s.updatedAt) })),
      h("p", { class: "small", text: "Die Schüler:innen sehen in dieser Sitzung den Hinweis auf Ihre Abwesenheit und die Anleitung mit " + (p.schritte || []).length + " Schritten. Material, Schulportal-Eintrag und Feibeitsblatt sind ausgetauscht (unten in den Abschnitten der Sitzung)." }),
      h("details", { class: "box" }, h("summary", null, "Anleitung für die Schüler:innen"), h("div", { class: "notice" }, p.hinweis || ""), stepsNode(p), p.abgabe ? h("p", { class: "small" }, h("strong", { text: "Abgabe: " }), p.abgabe) : null),
      escapeNode(p, true),
      h("h3", { text: "Ursprüngliche Planung (archiviert)" }),
      h("p", { class: "small", text: [archived.length ? archived.length + " Datei(en): " + archived.map((f) => f.name).join(", ") : "keine Dateien",
        (ar.sheets || []).length ? "Feibeitsblätter: " + ar.sheets.map((x) => x.title + " (" + formatCode(x.code) + ")").join(", ") : null,
        ar.homework ? "Hausaufgabe: " + ar.homework.slice(0, 120) : null].filter(Boolean).join(" · ") }),
      ar.portal ? h("details", { class: "box" }, h("summary", null, "Ursprünglicher Schulportal-Eintrag"), portalPreview(ar.portal)) : null,
      h("div", { class: "row", style: { marginTop: ".8rem" } },
        h("button", { class: "btn", type: "button", onclick: (e) => transfer(e.currentTarget) }, "Ursprüngliche Planung in eine andere Sitzung übernehmen"),
        h("button", { class: "btn danger", type: "button", onclick: (e) => restore(e.currentTarget) }, "Ursprüngliche Planung wiederherstellen"))));
  }
  async function restore(btn) {
    if (!(await confirmDialog("Ursprüngliche Planung wiederherstellen", "Das Vertretungsmaterial wird gelöscht, die archivierte Planung (Schulportal-Eintrag, Hausaufgabe, Material, Feibeitsblätter) kehrt in diese Sitzung zurück. Das Feibeitsblatt der Vertretung bleibt im Feibeitsblatt erhalten (mit seinen Abgaben), wird aber aus der Sitzung entfernt.", "Wiederherstellen", true))) return;
    await busy(btn, async () => {
      try { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/substitute/restore"); toast("Ursprüngliche Planung wiederhergestellt" + (r.removedSheets && r.removedSheets.length ? " – Feibeitsblatt der Vertretung: " + r.removedSheets.map(formatCode).join(", ") + " (im Feibeitsblatt weiterhin abrufbar)." : "."), "ok", 7000); reload(); }
      catch (e) { errToast(e); }
    });
  }
  async function transfer(btn) {
    let lessons = [];
    await busy(btn, async () => { try { lessons = (await tapi("GET", "/api/teacher/lessons?subject=" + L().subject + "&klass=" + L().klass)).lessons.filter((x) => x.id !== id); } catch (e) { errToast(e); } });
    if (!lessons.length) { toast("Es gibt keine andere Sitzung dieser Klasse.", "err"); return; }
    lessons.sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : 1));
    const next = lessons.find((x) => x.date && x.date > (L().date || "")) || lessons[lessons.length - 1];
    const sel = h("select", { "aria-label": "Zielsitzung" }, lessons.map((x) => h("option", { value: x.id, selected: x === next ? true : null }, (x.date ? fmtDay(x.date) : "ohne Datum") + " – " + x.title)));
    const withPortal = h("input", { type: "checkbox", checked: true });
    modal({ title: "Ursprüngliche Planung übernehmen", wide: true, body: (el) => el.append(
      h("p", { class: "small", text: "Kopiert das archivierte Material dieser Sitzung in die gewählte Sitzung. Der ursprüngliche Schulportal-Eintrag wird dort angehängt (ein vorhandener Eintrag bleibt erhalten)." }),
      h("div", { class: "field" }, h("label", null, "Zielsitzung"), sel), h("label", { class: "chk" }, withPortal, "Schulportal-Eintrag mit übernehmen"),
      h("p", { class: "hint", text: "Feibeitsblätter der ursprünglichen Planung verknüpfen Sie in der Zielsitzung bei Bedarf selbst (Abschnitt „Feibeitsblatt“ → „Vorhandenes Feibeitsblatt verknüpfen“)." })),
      actions: [{ label: "Abbrechen" }, { label: "Übernehmen", class: "primary", onClick: async () => {
        try {
          let copied = 0, offset = 0;
          for (let k = 0; k < 30 && offset !== null; k++) {   // in Stücken (Grenzen des Free-Plans)
            const r = await tapi("POST", "/api/teacher/lessons/" + id + "/substitute/transfer", { body: { targetLessonId: sel.value, portal: withPortal.checked, offset } });
            copied += r.copied; offset = r.next;
          }
          const t = lessons.find((x) => x.id === sel.value);
          toast(copied + " Datei(en)" + (withPortal.checked ? " und der Schulportal-Eintrag" : "") + " wurden in „" + (t ? t.title : "die Sitzung") + "“ übernommen.", "ok", 7000);
        } catch (e) { errToast(e); return false; }
      } }] });
  }

  function paint() {
    paintSide();
    const s = st.sub;
    if (!s) clear(mainBox);
    else if (s.status === "vorschlag") paintProposal();
    else if (s.status === "aktiv") paintActive();
  }
  paint();
  return { main: mainBox, side, paint };
}
