// substitute.js – Selbstlern-Phase in der Sitzungsansicht des Gymnasiums (Nachtrag 29 der Lehrkraft vom 15.11.2026; ersetzt die Krankheitsvertretung):
// Knopf „Präsenz der Lehrkraft nicht möglich – Unterricht in Selbstlern-Phase umbauen“ (Claude in claude.ai über den Connector; Modell und Aufwand werden
// vorher erfragt), Karte „Selbstlern-Phase“ mit Stationen, Vorschau dessen, was die Schüler:innen oben sehen, Hausaufgabe, archivierter Planung,
// „Wiederherstellen“ und Übernahme der ursprünglichen Planung in eine andere Sitzung. Ältere Vertretungen bleiben lesbar (Vorschlag: nur verwerfen;
// aktiv: wiederherstellen und übernehmen wie bisher).
import { h, clear, toast, errToast, busy, modal, confirmDialog, fmtTime, nn } from "./ui.js";
import { tapi } from "./teacher.js";
import { go } from "./app.js";
import { formatCode, fmtDay } from "./shared.js";
import { claudeHandoff } from "./claude.js";
import { renderMarkdown } from "./markdown.js";
import { portalPreview, paintPortalPreview } from "./portalview.js";
import { SELBSTLERN, SELBSTLERN_BUTTON, SELBSTLERN_INTRO, SELBSTLERN_INTRO_ANALOG, readSelbstlern, stationLabel, claudeSelbstlernPrompt, selbstlernChatName,
  youtubeUrl, fmtVideoStart } from "./selbstlern.js";

export function substituteCards({ id, st, L, ctx, analog, reload, openDraft, flushPortal, teacherNext = () => null }) {
  const mainBox = h("div");
  const side = h("section", { class: "card sick selfside", "aria-labelledby": "sl-side-h" });
  const status = () => (st.sub ? st.sub.status : null);

  function start() {
    if (status() === "aktiv") { toast("Für diese Sitzung ist noch eine ältere Vertretung aktiv – stellen Sie oben zuerst die ursprüngliche Planung wieder her.", "err", 7000); mainBox.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    flushPortal();
    const active = status() === SELBSTLERN;
    claudeHandoff({ title: "Selbstlern-Phase mit Claude entwickeln",
      intro: "Claude liest die geplante Sitzung, behält Lerninhalte und Stundenziel und entwickelt mit Ihnen mindestens drei Ideen für eine Selbstlern-Sitzung, die vollständig ohne Lehrkraft funktioniert" +
        (analog ? " – in Jahrgang 5/6 als analoge Stationen auf Papier (Laufzettel, Arbeitsblätter, Lösungskontrolle auf Ihrer Druckliste; die Aufsicht teilt nur aus)."
          : " – als Stationen, z. B. eine selbst erklärende Präsentation, ein Feibeitsblatt, ein KI-Chatbot, dem die Schüler:innen etwas erklären, oder ein YouTube-Video, das Sie freigeben.") +
        " Erst nach Ihrer ausdrücklichen Zustimmung im Chat baut Claude die Sitzung über den Connector um; muss vorher Material von Hand gelöscht werden, sagt Claude Ihnen genau, welches." +
        (active ? " Die Sitzung ist schon eine Selbstlern-Phase – Claude überarbeitet sie mit Ihnen." : ""),
      after: "Wenn Claude die Sitzung mit „save_selbstlern“ umgestellt hat, kommen Sie hierher zurück: Die Karte „Selbstlern-Phase“ oben auf dieser Seite zeigt die Stationen. Feibeitsblätter aus dem Chat legen Sie dort bzw. unter „Feibeitsblatt“ an.",
      chatName: () => selbstlernChatName(ctx()),
      prompt: () => claudeSelbstlernPrompt({ ...ctx(), teacherNextDate: teacherNext(), active: status() === SELBSTLERN }) });
  }

  function paintSide() {
    const s = st.sub;
    clear(side).append(...nn(h("h2", { id: "sl-side-h", text: "Ohne Lehrkraft" }),
      s && s.status === SELBSTLERN ? h("p", { class: "small" }, h("span", { class: "badge ink", text: "Selbstlern-Phase aktiv" }), " seit " + fmtTime(s.confirmedAt || s.updatedAt))
        : s && s.status === "aktiv" ? h("p", { class: "small" }, h("span", { class: "badge ink", text: "Ältere Vertretung aktiv" }), " seit " + fmtTime(s.confirmedAt || s.updatedAt))
          : s && s.status === "vorschlag" ? h("p", { class: "small" }, h("span", { class: "badge", text: "Älterer Vertretungsvorschlag" }), " – siehe oben.") : null,
      h("button", { class: "btn sickbtn", type: "button", onclick: start }, SELBSTLERN_BUTTON),
      h("p", { class: "hint", text: "Claude (Ihr Pro-Abo in claude.ai, über den Connector) entwickelt mit Ihnen mindestens drei Ideen für eine Selbstlern-Phase, die ohne Lehrkraft funktioniert, und baut die Sitzung erst nach Ihrer Zustimmung um. Die ursprüngliche Planung wird archiviert und lässt sich wiederherstellen." })));
  }

  /* ======================= Selbstlern-Phase ======================= */
  const fileOf = (fid) => st.files.find((f) => f.id === fid) || null;
  const draftOf = (did) => st.drafts.find((d) => d.id === did) || null;
  const sheetOf = (code) => st.sheets.find((s) => s.code === code) || null;
  const fileState = (f) => (!f ? h("span", { class: "warnc", text: "Datei fehlt (gelöscht?) – bitte mit Claude überarbeiten." })
    : f.area === "archive" ? h("span", { class: "warnc", text: "„" + f.name + "“ liegt im Archiv – die Schüler:innen sehen es nicht." })
      : h("span", null, "„" + f.name + "“", f.area === "print" ? h("span", { class: "muted", text: " – auf Ihrer Druckliste" }) : null, f.status !== "ready" ? h("span", { class: "muted", text: " – wird noch gedruckt" }) : null));
  const draftButton = (dr, label) => h("button", { class: "btn small", type: "button", onclick: () => openDraft(dr, { onSaved: () => paint(), onCreated: () => paint() }) }, label);
  function stationRef(s, p) {
    if (s.typ === "praesentation" || s.typ === "material") return h("p", { class: "sl-ref small" }, h("strong", { text: "Datei: " }), fileState(fileOf(s.fileId)));
    if (s.typ === "feibeitsblatt") {
      if (s.code) { const sh = sheetOf(s.code); return h("p", { class: "sl-ref small" }, h("strong", { text: "Feibeitsblatt: " }), (sh ? "„" + sh.title + "“, " : "") + "Code " + formatCode(s.code)); }
      const dr = draftOf(s.draftId);
      if (dr && dr.status === "created" && dr.sheetCode) return h("p", { class: "sl-ref small" }, h("strong", { text: "Feibeitsblatt: " }), "„" + ((dr.data && dr.data.title) || "Feibeitsblatt") + "“, Code " + formatCode(dr.sheetCode));
      if (!dr) return h("p", { class: "sl-ref small warnc", text: "Der Feibeitsblatt-Entwurf fehlt – bitte mit Claude überarbeiten." });
      return h("div", { class: "sl-ref sl-todo" }, h("p", { class: "small", text: "Feibeitsblatt „" + ((dr.data && dr.data.title) || "Entwurf") + "“ ist noch nicht angelegt – die Schüler:innen können diese Station erst bearbeiten, wenn Sie es anlegen." }),
        draftButton(dr, "Feibeitsblatt prüfen und anlegen"));
    }
    if (s.typ === "video" && s.video) return h("p", { class: "sl-ref small" }, h("strong", { text: "YouTube-Video" + (s.video.start ? " ab " + fmtVideoStart(s.video.start) : "") + ": " }),
      h("a", { href: youtubeUrl(s.video), target: "_blank", rel: "noopener noreferrer" }, "auf YouTube ansehen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" })),
      h("span", { class: "muted", text: " – die Schüler:innen laden es erst mit einem Klick (youtube-nocookie.com)." }));
    if (s.typ === "erklaer_chatbot" && s.bot) return h("div", { class: "sl-ref" }, h("p", { class: "small" }, h("strong", { text: "Die Schüler:innen erklären dem Chatbot: " }), s.bot.erklaeren),
      h("details", { class: "box small" }, h("summary", null, "Woran der Chatbot eine gute Erklärung erkennt (nur für Sie)"),
        h("p", { class: "lp-cap", text: "Kernpunkte" }), h("ul", null, s.bot.kernpunkte.map((x) => h("li", { text: x }))),
        s.bot.fehlvorstellungen.length ? h("p", { class: "lp-cap", text: "Fehlvorstellungen, nach denen er fragt" }) : null,
        s.bot.fehlvorstellungen.length ? h("ul", null, s.bot.fehlvorstellungen.map((x) => h("li", { text: x }))) : null));
    if (s.typ === "escape_room") {
      const room = p.escape_room, dr = draftOf(p.escapeDraftId);
      if (!room) return null;
      const made = dr && dr.status === "created" && dr.sheetCode;
      return h("div", { class: "sl-ref escbox" }, h("div", { class: "row between" }, h("strong", { text: "Escape-Room „" + room.name + "“" }), h("span", { class: "badge mono", text: "Lösungswort " + room.wort })),
        h("p", { class: "small", text: made ? "Finale-Feibeitsblatt angelegt (Code " + formatCode(dr.sheetCode) + ")." : "Das Finale-Feibeitsblatt ist noch nicht angelegt – erst dann führt der Tunnel am Ende ins Feibeitsblatt." }),
        h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => go("#/lk/escape/" + id) }, "Escape-Room ansehen (Vorschau)"),
          !made && dr ? draftButton(dr, "Finale-Feibeitsblatt prüfen und anlegen") : null));
    }
    return null;
  }
  function paintSelbstlern() {
    const s = st.sub, p = s.proposal || {}, d = readSelbstlern(p) || { stationen: [], material: [], einleitung: "", hausaufgabe: "", hinweisAufsicht: "", analog };
    const ar = s.archive || {}, archived = st.files.filter((f) => f.area === "archive");
    // ursprüngliche Feibeitsblätter, auf die eine Station verweist, sind nicht archiviert (die Schüler:innen sehen sie an der Station)
    const arSheets = (ar.sheets || []).filter((x) => x && !d.stationen.some((y) => y.code === x.code));
    const total = d.stationen.reduce((n, x) => n + (x.minuten || 0), 0), due = teacherNext();
    const own = st.files.filter((f) => f.source === SELBSTLERN && f.area !== "archive");
    const loose = own.filter((f) => !d.stationen.some((x) => x.fileId === f.id) && !d.material.includes(f.id));
    clear(mainBox).append(h("section", { class: "card substitute selbstlern", "aria-labelledby": "sl-h" },
      h("div", { class: "section-title" }, h("h2", { id: "sl-h", text: "Selbstlern-Phase" }), h("span", { class: "badge ink", text: "seit " + fmtTime(s.confirmedAt || s.updatedAt) })),
      h("p", { class: "small", text: "Sie sind zu dieser Sitzung nicht da: Die Schüler:innen arbeiten die Stationen selbstständig ab. Die ursprüngliche Planung ist archiviert – mit „Wiederherstellen“ wird die Sitzung wieder eine normale Sitzung." }),
      h("h3", { text: "Das sehen die Schüler:innen ganz oben" }),
      h("div", { class: "notice sl-intro" }, h("p", { text: d.analog ? SELBSTLERN_INTRO_ANALOG : SELBSTLERN_INTRO }), d.einleitung ? h("p", { text: d.einleitung }) : null),
      h("h3", { text: "Ablaufplan: " + d.stationen.length + (d.stationen.length === 1 ? " Station" : " Stationen") + (total ? " (ca. " + total + " Minuten)" : "") }),
      h("ol", { class: "sub-steps sl-stations" }, d.stationen.map((x) => h("li", null,
        h("div", { class: "row between sl-head" }, h("strong", { text: x.titel }), h("span", { class: "row" }, h("span", { class: "badge sl-typ", text: stationLabel(x.typ) }), x.minuten ? h("span", { class: "badge", text: "ca. " + x.minuten + " min" }) : null)),
        renderMarkdown(x.anleitung || ""), stationRef(x, p)))),
      d.material.length ? h("p", { class: "small" }, h("strong", { text: "Weiteres Material: " }), d.material.map((fid) => { const f = fileOf(fid); return f ? "„" + f.name + "“" : "(fehlt)"; }).join(", ")) : null,
      // KI-Chatbots der Schüleransicht (Teil B): wann es sie gibt – damit die Lehrkraft es weiß
      !d.analog ? h("p", { class: "small sl-ai" }, h("strong", { text: "KI-Chatbots für die Schüler:innen: " }), (d.stationen.some((x) => x.typ === "erklaer_chatbot") ? "der Erklär-Chatbot der Station und " : "") +
        "ganz unten die KI-Begriffshilfe – nur nach Einwilligung der Schüler:innen, ab dem Beginn dieser Sitzung bis zum Beginn der nächsten Sitzung mit Ihnen (ohne angelegte nächste Sitzung bis 7 Tage nach dem Ende). " +
        "Die KI-Begriffshilfe lässt sich in den Sitzungsdaten ausschalten; der Erklär-Chatbot gehört zur Station.") : null,
      loose.length ? h("p", { class: "small warnc", text: "Material der Selbstlern-Phase ohne Station (die Schüler:innen sehen es trotzdem): " + loose.map((f) => "„" + f.name + "“").join(", ") + " – brauchen Sie es nicht, löschen Sie es unten im Material." }) : null,
      h("h3", { text: "Hausaufgabe (für die Schüler:innen von Anfang an sichtbar)" }),
      h("div", { class: "sl-hw" }, h("p", { class: "small due", text: due ? "Bis zur nächsten Sitzung mit Ihnen am " + fmtDay(due) + ":" : "Bis zur nächsten Sitzung mit Ihnen (noch keine angelegt):" }),
        paintPortalPreview(h("div", { class: "hwtext" }), L().homework || d.hausaufgabe || "")),
      d.hinweisAufsicht ? h("details", { class: "box" }, h("summary", null, "Hinweis für die Aufsicht"), h("p", { class: "small sl-note", text: d.hinweisAufsicht })) : null,
      h("h3", { text: "Ursprüngliche Planung (archiviert)" }),
      h("p", { class: "small", text: [archived.length ? archived.length + " Datei(en): " + archived.map((f) => f.name).join(", ") : "keine Dateien",
        arSheets.length ? "Feibeitsblätter: " + arSheets.map((x) => x.title + " (" + formatCode(x.code) + ")").join(", ") : null,
        ar.homework ? "Hausaufgabe: " + ar.homework.slice(0, 120) : null].filter(Boolean).join(" · ") }),
      ar.portal ? h("details", { class: "box" }, h("summary", null, "Ursprünglicher Schulportal-Eintrag"), portalPreview(ar.portal)) : null,
      h("div", { class: "row sl-acts" },
        h("button", { class: "btn", type: "button", onclick: (e) => transfer(e.currentTarget) }, "Ursprüngliche Planung in eine andere Sitzung übernehmen"),
        h("button", { class: "btn danger", type: "button", onclick: (e) => restore(e.currentTarget) }, "Wiederherstellen – zurück zur normalen Sitzung"))));
  }

  /* ======================= ältere Vertretungen (nur lesen, verwerfen, wiederherstellen) ======================= */
  const list = (arr) => h("ul", null, arr.map((x) => h("li", { text: x })));
  function stepsNode(p) {
    return h("ol", { class: "sub-steps" }, (p.schritte || []).map((x) => h("li", null,
      h("div", { class: "row between" }, h("strong", { text: x.titel }), h("span", { class: "row" }, x.minuten ? h("span", { class: "badge", text: "ca. " + x.minuten + " min" }) : null, x.abgabe ? h("span", { class: "badge ink", text: "Abgabe" }) : null)),
      renderMarkdown(x.anleitung || ""))));
  }
  function escapeNode(p, active) {
    const r = p.escape_room;
    if (!r || !Array.isArray(r.stationen)) return null;
    return h("div", { class: "escbox" }, h("div", { class: "row between" }, h("strong", { text: "Escape-Room „" + r.name + "“" }), h("span", { class: "badge mono", text: "Lösungswort " + r.wort })),
      h("ol", { class: "small" }, r.stationen.map((x) => h("li", { text: x.titel }))),
      h("p", { class: "small muted", text: "Finale: Feibeitsblatt „" + ((r.feibeitsblatt || {}).titel || "") + "“" + (active && p.escapeSheet ? " (Code " + formatCode(p.escapeSheet) + ")." : ".") }),
      h("button", { class: "btn small", type: "button", onclick: () => go("#/lk/escape/" + id) }, "Escape-Room ansehen (Vorschau)"));
  }
  function paintOldProposal() {
    const s = st.sub, p = s.proposal || {}, a = p.analyse || {};
    clear(mainBox).append(h("section", { class: "card substitute", "aria-labelledby": "sub-old-h" },
      h("div", { class: "section-title" }, h("h2", { id: "sub-old-h", text: "Älterer Vertretungsvorschlag" }), h("span", { class: "badge", text: "nicht bestätigt" })),
      h("p", { class: "small", text: "Claude hat diesen Vorschlag am " + fmtTime(s.updatedAt) + " gespeichert. Vertretungsvorschläge lassen sich nicht mehr bestätigen: Kann die Lehrkraft nicht da sein, baut Unterricks die Sitzung jetzt in eine Selbstlern-Phase um („" + SELBSTLERN_BUTTON + "“). Die Sitzung ist unverändert." }),
      h("div", { class: "meta-grid" },
        h("div", null, h("div", { class: "lp-cap", text: "Fachdidaktische Kompetenz" }), h("div", { class: "small", text: a.kompetenz || "–" })),
        h("div", null, h("div", { class: "lp-cap", text: "Stundenfrage" }), h("div", { class: "small", text: a.stundenfrage || "–" })),
        h("div", { class: "full" }, h("div", { class: "lp-cap", text: "Lerninhalte" }), (a.inhalte || []).length ? list(a.inhalte) : h("div", { class: "small muted", text: "–" }))),
      h("h3", { text: "Anleitung des Vorschlags" }), p.hinweis ? h("div", { class: "notice" }, p.hinweis) : null, stepsNode(p),
      (p.materialien || []).length ? h("p", { class: "small" }, h("strong", { text: "Material: " }), p.materialien.map((m) => m.titel).join(", ")) : null,
      escapeNode(p, false),
      p.schulportal ? h("details", { class: "box" }, h("summary", null, "Schulportal-Eintrag des Vorschlags"), portalPreview(p.schulportal)) : null,
      h("div", { class: "row", style: { marginTop: ".8rem" } }, h("button", { class: "btn ghost danger", type: "button", onclick: discard }, "Vorschlag verwerfen"))));
  }
  async function discard() {
    if (!(await confirmDialog("Vorschlag verwerfen", "Den älteren Vertretungsvorschlag (und seinen Feibeitsblatt-Entwurf) löschen? Die Sitzung bleibt unverändert.", "Verwerfen", true))) return;
    const draftId = ((st.sub || {}).proposal || {}).draftId;
    try { await tapi("POST", "/api/teacher/lessons/" + id + "/substitute/discard"); st.sub = null; st.drafts = st.drafts.filter((x) => x.id !== draftId); paint(); toast("Vorschlag verworfen.", "ok"); }
    catch (e) { errToast(e); }
  }
  function paintOldActive() {
    const s = st.sub, p = s.proposal || {}, ar = s.archive || {};
    const archived = st.files.filter((f) => f.area === "archive");
    clear(mainBox).append(h("section", { class: "card substitute active", "aria-labelledby": "sub-act-h" },
      h("div", { class: "section-title" }, h("h2", { id: "sub-act-h", text: "Vertretung aktiv" }), h("span", { class: "badge ink", text: "seit " + fmtTime(s.confirmedAt || s.updatedAt) })),
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

  /* ======================= Wiederherstellen und Übernehmen (Selbstlern-Phase und ältere Vertretung) ======================= */
  async function restore(btn) {
    const sl = status() === SELBSTLERN;
    const own = st.files.filter((f) => f.source === SELBSTLERN);
    const text = sl
      ? "Die Sitzung wird wieder eine normale Sitzung: Die archivierte Planung (Schulportal-Eintrag, Hausaufgabe, Material und Feibeitsblätter) kehrt zurück. " +
        (own.length ? "Das Material der Selbstlern-Phase wird gelöscht (" + own.map((f) => "„" + f.name + "“").join(", ") + "). " : "") +
        "Feibeitsblätter der Selbstlern-Phase bleiben im Feibeitsblatt erhalten (mit ihren Abgaben), werden aber aus der Sitzung entfernt."
      : "Das Vertretungsmaterial wird gelöscht, die archivierte Planung (Schulportal-Eintrag, Hausaufgabe, Material, Feibeitsblätter) kehrt in diese Sitzung zurück. Das Feibeitsblatt der Vertretung bleibt im Feibeitsblatt erhalten (mit seinen Abgaben), wird aber aus der Sitzung entfernt.";
    if (!(await confirmDialog(sl ? "Zurück zur normalen Sitzung?" : "Ursprüngliche Planung wiederherstellen", text, "Wiederherstellen", true))) return;
    await busy(btn, async () => {
      try {
        const r = await tapi("POST", "/api/teacher/lessons/" + id + "/substitute/restore");
        toast((sl ? "Wiederhergestellt – die Sitzung ist wieder eine normale Sitzung" : "Ursprüngliche Planung wiederhergestellt") +
          (r.removedSheets && r.removedSheets.length ? " (Feibeitsblätter " + r.removedSheets.map(formatCode).join(", ") + " im Feibeitsblatt weiterhin abrufbar)." : "."), "ok", 7000);
        reload();
      } catch (e) { errToast(e); }
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
    else if (s.status === SELBSTLERN) paintSelbstlern();
    else if (s.status === "vorschlag") paintOldProposal();
    else if (s.status === "aktiv") paintOldActive();
  }
  paint();
  return { main: mainBox, side, paint };
}
