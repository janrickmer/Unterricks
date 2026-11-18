// sharecard.js – Karte „Mit Kolleg:innen teilen“ ganz unten auf der Seite einer Unterrichtseinheit (Nachtrag 39, Gymnasium und Grundschule):
// Stand der Sitzungen (geplant / noch nicht geplant), „Absätze mit Claude schreiben“ (Prompt), Absätze prüfen und bearbeiten (je geplanter Sitzung
// drei Felder) und der Knopf „Unterrichtseinheit mit KollegInnen teilen“ → ZIP-Ordner (share.js, erst beim Klick geladen).
import { lazy } from "./update.js";
import { h, clear, nn, errToast, busy, confirmDialog, icon, stateLine, downloadBlob, fmtBytes, fmtTime, modal } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi } from "./teacher.js";
import { claudeHandoff } from "./claude.js";
import { SHARE_BUTTON, SHARE_PARTS, SHARE_LIMITS, SHARE_TEXT_TITLE, shareSessions, shareTextComplete, claudeSharePrompt, competenceSource } from "./sharelib.js";

const list = (ns) => ns.map((n) => "Sitzung " + n).join(", ");
const same = (a, b) => SHARE_PARTS.every(([k]) => String((a && a[k]) || "").trim() === String((b && b[k]) || "").trim());

/* Absatz inzwischen an anderer Stelle geändert (z. B. von Claude): beide Fassungen zeigen → "theirs" (gespeicherte übernehmen) | "mine" | null */
function conflictDialog(title, mine, theirs, label) {
  return new Promise((resolve) => {
    let done = false;
    const show = (t) => h("dl", { class: "sharecmp" }, ...SHARE_PARTS.flatMap(([k, l]) => [h("dt", { text: k === "kompetenz" ? label : l }), h("dd", { text: (t && t[k]) || "(leer)" })]));
    modal({ title: "Absatz inzwischen geändert", wide: true, onClose: () => { if (!done) resolve(null); }, body: (el) => el.append(
      h("p", { text: "Der Absatz zu „" + title + "“ wurde inzwischen an anderer Stelle " + (theirs ? "gespeichert" : "gelöscht") + " (z. B. von Claude)." + (theirs && theirs.at ? " Stand: " + fmtTime(theirs.at) + "." : "") }),
      h("div", { class: "meta-grid" }, h("div", null, h("h3", { text: "Gespeicherte Fassung" }), theirs ? show(theirs) : h("p", { class: "muted small", text: "Der Absatz wurde gelöscht." })),
        h("div", null, h("h3", { text: "Ihre Fassung" }), show(mine)))),
      actions: [{ label: "Gespeicherte Fassung übernehmen", onClick: () => { done = true; resolve("theirs"); } }, { label: "Meine Fassung speichern", class: "primary", onClick: () => { done = true; resolve("mine"); } }] });
  });
}

/* Ungespeicherte Absätze über einen Neuaufbau derselben Einheitenseite hinweg (z. B. nach „Krankmeldung rückgängig machen“ oder „Neu laden“ nach
   einem Konflikt der Tabelle): units.js legt sie mit keep() ab, die neue Karte derselben Einheit übernimmt sie (höchstens eine Minute alt) */
const KEPT = new Map();   // unitId → {at, edits}

/* ctx = {getUnit, gs, isDirty, saveUnit} → {el, refresh, dirty, keep} – el bleibt über paint() hinweg dasselbe Element (Eingaben in den Feldern gehen nicht verloren) */
export function shareCard(ctx) {
  let data = null, loading = null, again = false, building = false, saving = false;
  let gen = 0;   // steigt mit jedem Speichern: ein Abruf, der davor begonnen hat, überschreibt den gespeicherten Stand nicht
  const edits = new Map();   // lessonId → {passiert, kompetenz, ziel, base (Zeitpunkt des Absatzes, auf dem die Eingabe beruht), changed}
  const kept = KEPT.get(ctx.getUnit().id);
  KEPT.delete(ctx.getUnit().id);
  if (kept && Date.now() - kept.at < 60e3) for (const [id, e] of kept.edits) edits.set(id, e);
  const state = h("span", { class: "save-state", role: "status" });
  const body = h("div", { class: "stack" }, h("p", { class: "muted small", text: "Lade den Stand der Sitzungen …" }));
  const el = h("section", { class: "card sharecard", id: "unitshare", "aria-labelledby": "unitshare-h" },
    h("div", { class: "section-title" }, h("h2", { id: "unitshare-h", text: "Mit Kolleg:innen teilen" }), state), body);
  const dirtyTexts = () => [...edits.entries()].filter(([, e]) => e.changed);
  // ungespeicherte Absätze nicht still verlieren (wie die Zusammenfassung der Sitzung)
  const guardUnsaved = (ev) => { if (dirtyTexts().length) { ev.preventDefault(); ev.returnValue = ""; } };
  window.addEventListener("beforeunload", guardUnsaved);
  onLeave(() => window.removeEventListener("beforeunload", guardUnsaved));

  // → true, wenn der neue Stand übernommen wurde (nicht, wenn inzwischen gespeichert wurde – dann gilt der gespeicherte)
  async function load() {
    const g = gen, r = await tapi("GET", "/api/teacher/units/" + ctx.getUnit().id + "/share");
    if (g !== gen) return false;
    data = { lessons: r.lessons || [] };
    return true;
  }
  // ungespeicherte Absätze bleiben beim Neuzeichnen (paint); nur während des Speicherns bzw. Erstellens wird nicht neu geladen. Kommt ein Wunsch
  // während eines Abrufs, wird danach noch einmal geladen (der laufende kann vor einer Änderung von Claude begonnen haben)
  // Beim ersten Laden ist ein zweiter Wunsch überflüssig (units.js zeichnet die Seite gleich nach dem Anlegen der Karte); Speichern bzw. Erstellen
  // beendet die Wiederholung (es lädt selbst neu). Was schon geladen ist, wird gezeichnet, auch wenn ein weiterer Abruf scheitert.
  function refresh(force = false) {
    if (!force && (saving || building)) return Promise.resolve();
    if (loading) { if (data) again = true; return loading; }
    loading = (async () => {
      let fresh = false, err = null;
      try { do { again = false; fresh = (await load()) || fresh; } while (again && !saving && !building); }
      catch (e) { err = e; }
      finally { loading = null; }
      try {
        if (fresh && !saving && !building) paint();
        else if (err && !data) throw err;   // Stand schon da: still weiter mit ihm (z. B. kurz kein Netz beim Zurückkehren)
      } catch (e) {
        clear(body).append(h("p", { class: "err small", text: "Der Stand der Sitzungen ließ sich nicht laden: " + (e && e.message ? e.message : "Fehler") }),
          h("button", { class: "btn small", type: "button", "data-k": "retry", onclick: () => refresh(true) }, "Erneut versuchen"));
      }
    })();
    return loading;
  }

  function paint() {
    if (!data) return;
    const u = ctx.getUnit(), gs = ctx.gs;
    // Zustand der Oberfläche über das Neuzeichnen hinweg: aufgeklappt, Fokus (Knopf bzw. Feld)
    const wasOpen = !!(body.querySelector("details.sharetexts") || {}).open, focusKey = activeKey(), caret = caretOf();
    const sessions = shareSessions(u.rows || [], data.lessons), planned = sessions.filter((s) => s.planned), open = sessions.filter((s) => !s.planned);
    const missingText = planned.filter((s) => !shareTextComplete(s.lesson.shareText));
    const src = competenceSource(u.subject, u.klass);
    for (const id of [...edits.keys()]) if (!planned.some((s) => s.lesson.id === id)) edits.delete(id);
    const what = gs
      ? "Ein ZIP-Ordner mit dem Leupold-Schema (darunter zu jeder Sitzung ein kurzer Absatz: was passiert, zentrale Kompetenz laut " + src.from + ", Ziel) und je geplanter Sitzung einem Ordner „Sitzung n“ mit dem Verlaufsplan und allen PDF-Dateien der Sitzung (Material für die Kinder, Druckliste, Material für die Lehrkraft samt Bildkarten). Sind noch nicht alle Stunden geplant, liegt das Dokument „Fehlende Sitzungen“ bei."
      : "Ein ZIP-Ordner mit dem Leupold-Schema (darunter zu jeder Sitzung ein kurzer Absatz: was passiert, zentrale Kompetenz" + (src.kcgo ? " des KCGO" : " laut " + src.from) + ", Ziel), der Erklärung „Das ist ein Feibeitsblatt“ (wenn die Einheit Feibeitsblätter nutzt) und je geplanter Sitzung einem Ordner „Sitzung n“ mit der Präsentation als PDF und als PowerPoint-Datei (ohne reine Codefolien, mit „Copyright Jan-Rickmer Feindt“ in der Fußzeile; in PowerPoint stehen Ihre Notizen in den Notizen der Folien), den Notizen zu den Folien, dem Verlaufsplan und allen PDF-Dateien der Sitzung (Material für die Schüler:innen samt Notfall-Feibeitsblättern, Druckliste, Material für die Lehrkraft). Sind noch nicht alle Stunden geplant, liegt das Dokument „Fehlende Sitzungen“ bei.";
    const status = !(u.rows || []).length ? "Diese Einheit hat noch keine Stunden – planen Sie zuerst den Ablauf (Punkt 3 „Planung mit Claude“ bzw. Punkt 5) und legen Sie dann die Sitzungen an (Punkt 6)."
      : !sessions.some((s) => s.lesson) ? "Zu dieser Einheit gibt es noch keine Sitzungen – legen Sie sie zuerst an (Punkt 6)."
      : planned.length + " von " + sessions.length + " Sitzung" + (sessions.length === 1 ? "" : "en") + " geplant" +
        (open.length ? " (noch nicht geplant: " + list(open.map((s) => s.n)) + " – " + (open.length === 1 ? "sie steht" : "sie stehen") + " im Dokument „Fehlende Sitzungen“)" : "") + ". " +
        (planned.length ? (missingText.length ? (missingText.length === 1 ? "Der Absatz für das Leupold-Schema fehlt noch bei " : "Absätze für das Leupold-Schema fehlen noch bei ") + list(missingText.map((s) => s.n)) + "."
          : "Zu allen geplanten Sitzungen gibt es einen Absatz.") : "");
    const claudeBtn = h("button", { class: "btn", type: "button", "data-k": "claude", disabled: planned.length ? null : true, onclick: () => claudeHandoff({
      title: "Absätze für die Weitergabe mit Claude schreiben",
      intro: "Claude liest die Einheit, die Planungsgrundlagen und jede geplante Sitzung über den Connector und schreibt zu jeder Sitzung einen kurzen Absatz: was passiert, die zentrale Kompetenz" + (src.kcgo ? " des KCGO" : " laut " + src.from) + " und das Ziel der Sitzung.",
      after: "Wenn Claude die Absätze mit „save_weitergabe“ gespeichert hat, kommen Sie hierher zurück: Sie stehen unten unter „Absätze prüfen und bearbeiten“ und lassen sich ändern.",
      prompt: () => claudeSharePrompt({ unitId: u.id, title: u.title || (u.plan && u.plan.titel) || "", subject: u.subject, klass: u.klass, gs,
        sessions: sessions.map((s) => ({ n: s.n, lessonId: s.lesson ? s.lesson.id : null, title: (s.row && s.row.stundenfrage) || (s.lesson && s.lesson.title) || "", planned: s.planned, has: !!(s.lesson && shareTextComplete(s.lesson.shareText)) })) }) }) },
      "Absätze mit Claude schreiben");
    const shareBtn = h("button", { class: "btn primary big", type: "button", "data-k": "share", disabled: sessions.some((s) => s.lesson) && !building ? null : true, "aria-describedby": "unitshare-hint",
      onclick: (e) => busy(e.currentTarget, () => share("share"), "Stelle den Ordner zusammen …") }, icon("download"), SHARE_BUTTON);
    clear(body).append(...nn(
      h("p", { class: "small", text: what }),
      h("p", { class: "small" + (missingText.length || open.length || !sessions.length ? " warnc" : ""), text: status }),
      planned.length ? h("div", { class: "row" }, claudeBtn, h("span", { class: "hint", text: "Claude schreibt die Absätze; Sie prüfen sie hier." })) : null,
      planned.length ? editor(planned, src, wasOpen) : null,
      h("div", { class: "row sharego" }, shareBtn),
      h("p", { class: "hint", id: "unitshare-hint", text: gs
        ? "Der Ordner entsteht auf diesem Gerät aus dem gespeicherten Stand. Verweise im Verlaufsplan nennen den Namen der Datei im Ordner."
        : "Der Ordner entsteht auf diesem Gerät aus dem gespeicherten Stand – bei vielen Präsentationen kann das eine Minute dauern. Codefolien ohne Material fallen weg; auf Materialfolien wird die Zeile mit dem Unterricks-Code überdeckt. " +
          "Feibeitsblätter stecken als Notfall-Feibeitsblatt (PDF) im Ordner; das digitale Feibeitsblatt nutzen Kolleg:innen nur nach Absprache mit Ihnen (die Abgaben kämen bei Ihnen an)." })));
    if (focusKey) focusBy(focusKey);
    if (caret) restoreCaret(caret);
    // übernommene Absätze (keep) kann die vorige Karte inzwischen gespeichert haben
    if (!dirtyTexts().length && state.textContent === "Ungespeicherte Absätze") stateLine(state, "");
  }
  // Fokus über das Neuzeichnen hinweg: über die id (Felder) bzw. data-k (Knöpfe, Zusammenfassung); im Feld auch die Schreibmarke
  function activeKey() { const a = document.activeElement; return a && el.contains(a) ? a.id || (a.dataset && a.dataset.k) || null : null; }
  function caretOf() {
    const a = document.activeElement;
    return a && a.tagName === "TEXTAREA" && el.contains(a) ? { id: a.id, start: a.selectionStart, end: a.selectionEnd, dir: a.selectionDirection, top: a.scrollTop } : null;
  }
  function restoreCaret(c) {
    const a = document.activeElement;
    if (!a || a.id !== c.id || a.tagName !== "TEXTAREA") return;
    try { a.setSelectionRange(c.start, c.end, c.dir || "none"); } catch {}
    a.scrollTop = c.top;
  }
  function focusBy(key, fallback = null) {
    const n = (key && (body.querySelector("#" + CSS.escape(key)) || body.querySelector('[data-k="' + key + '"]'))) || (fallback && body.querySelector('[data-k="' + fallback + '"]'));
    if (n && !n.disabled) { n.focus(); return; }
    const s = body.querySelector('[data-k="summary"]') || body.querySelector('[data-k="share"]:not([disabled])');
    if (s) s.focus();
  }

  function editor(planned, src, wasOpen) {
    const saveBtn = h("button", { class: "btn", type: "button", "data-k": "save", disabled: true, onclick: (e) => busy(e.currentTarget, () => saveTexts(), "Speichere …") }, "Absätze speichern");
    const sync = () => { saveBtn.disabled = dirtyTexts().length && !saving ? false : true; };
    const sets = planned.map((s) => {
      // nur ungespeicherte Eingaben bleiben; sonst gilt der gerade geladene Stand (z. B. von Claude inzwischen gespeichert)
      const L = s.lesson, t = L.shareText, prev = edits.get(L.id);
      const e = prev && prev.changed ? prev : { passiert: t ? t.passiert : "", kompetenz: t ? t.kompetenz : "", ziel: t ? t.ziel : "", base: t ? t.at : null, changed: false };
      edits.set(L.id, e);
      const done = shareTextComplete(t);
      const badge = h("span", { class: "badge " + (done ? "ok" : t ? "warn" : ""), text: done ? "Absatz vorhanden" + (t.at ? " · " + fmtTime(t.at) : "") : t ? "unvollständig" : "noch kein Absatz" });
      const field = (key, label) => {
        const id = "sh-" + L.id + "-" + key;
        const ta = h("textarea", { id, rows: key === "passiert" ? "3" : "2", maxlength: String(SHARE_LIMITS[key]), readonly: saving ? true : null });
        ta.value = e[key] || "";
        ta.addEventListener("input", () => {
          e[key] = ta.value; e.changed = true; sync();
          if (state.textContent !== "Ungespeicherte Absätze") stateLine(state, "Ungespeicherte Absätze");   // nicht bei jedem Tastendruck neu ansagen
        });
        return h("div", { class: "field" }, h("label", { for: id, text: key === "kompetenz" ? src.label : label }), ta);
      };
      return h("fieldset", { class: "sharetext" }, h("legend", null, "Sitzung " + s.n + ": " + ((s.row && s.row.stundenfrage) || L.title || "ohne Titel") + " ", badge),
        ...SHARE_PARTS.map(([k, label]) => field(k, label)));
    });
    const det = h("details", { class: "sharetexts" }, h("summary", { "data-k": "summary", text: "Absätze prüfen und bearbeiten (" + planned.filter((s) => shareTextComplete(s.lesson.shareText)).length + " von " + planned.length + ")" }),
      h("p", { class: "hint", text: "Je Sitzung drei kurze Teile – sie stehen in der PDF-Datei unter dem Leupold-Schema. „" + SHARE_TEXT_TITLE + "“ schreibt Claude auch beim Planen jeder Stunde mit. Drei leere Teile entfernen den Absatz." }),
      ...sets, h("div", { class: "row" }, saveBtn));
    if (wasOpen || dirtyTexts().length) det.open = true;
    sync();
    return det;
  }

  /* geänderte Absätze speichern → true, wenn alles gespeichert ist. Während des Speicherns sind die Felder schreibgeschützt; was gesendet wurde, wird
     verglichen – nur dann gilt die Eingabe als gespeichert */
  async function saveTexts() {
    if (saving) return false;
    const fk = activeKey();
    saving = true; gen++; paint();
    let failed = false;   // ein Fehler (nicht der Konflikt selbst – nach ihm entscheidet die Lehrkraft)
    try {
      for (const [id, e] of dirtyTexts()) {
        const sent = { passiert: e.passiert, kompetenz: e.kompetenz, ziel: e.ziel };
        const L = data.lessons.find((x) => x.id === id);
        try {
          const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { shareText: sent, shareTextBase: e.base } });
          const t = (r.lesson && r.lesson.shareText) || null;
          if (L) L.shareText = t;
          // gespeichert: auch e selbst gilt nicht mehr als geändert (keep() kann es schon an eine neue Karte gegeben haben)
          if (same(e, sent)) { e.changed = false; edits.delete(id); } else { e.base = t ? t.at : null; }
        } catch (err) {
          if (err && err.status === 409) {
            const cur = err.data && err.data.current ? err.data.current : null;
            if (L) L.shareText = cur;
            paint();   // die Felder bleiben gesperrt; das Abzeichen zeigt den gespeicherten Stand
            const u = ctx.getUnit(), choice = await conflictDialog(L ? L.title : "einer Sitzung", sent, cur, competenceSource(u.subject, u.klass).label);
            if (choice === "theirs") { e.changed = false; edits.delete(id); }
            paint();   // nach „Gespeicherte Fassung übernehmen“ zeigen die Felder sie sofort
            if (choice === "mine") {
              e.base = cur ? cur.at : null;
              try {
                const r2 = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { shareText: sent, shareTextBase: e.base } });
                if (L) L.shareText = (r2.lesson && r2.lesson.shareText) || null;
                if (same(e, sent)) { e.changed = false; edits.delete(id); } else e.base = L && L.shareText ? L.shareText.at : null;
              } catch (err2) { failed = true; errToast(err2); break; }
            }
          } else { failed = true; errToast(err); break; }
        }
      }
      // danach den Stand aller Sitzungen neu laden (Claude kann inzwischen andere Absätze gespeichert haben); scheitert das, gilt der bisherige
      try { gen++; await load(); } catch {}
    } finally { saving = false; }
    if (!dirtyTexts().length) stateLine(state, "Absätze gespeichert", "ok");
    paint();
    if (fk) focusBy(fk === "save" && !dirtyTexts().length ? "summary" : fk, "summary");   // der Knopf ist danach gesperrt: Fokus auf die Überschrift des Bereichs
    return !failed && !dirtyTexts().length;
  }

  async function share(fromKey = null) {
    if (building || saving) return;
    if (ctx.isDirty()) {
      if (!(await confirmDialog("Ungespeicherte Änderungen", "Der Ordner entsteht aus dem gespeicherten Stand der Einheit. Ihre Änderungen jetzt zuerst speichern?", "Speichern"))) return;
      await ctx.saveUnit();
      if (ctx.isDirty()) return;
    }
    if (dirtyTexts().length) {
      if (!(await confirmDialog("Ungespeicherte Absätze", "Ihre Änderungen an den Absätzen sind noch nicht gespeichert. Jetzt speichern und danach den Ordner erstellen? Mit „Abbrechen“ wird der Ordner nicht erstellt.", "Speichern"))) return;
      if (!(await saveTexts())) return;
    } else {
      // der aktuelle Stand der Absätze (z. B. von Claude inzwischen gespeichert) für die Rückfrage unten; scheitert das, gilt der bisherige
      try { await load(); } catch {}
    }
    const u = ctx.getUnit(), planned = shareSessions(u.rows || [], data.lessons).filter((s) => s.planned);
    const missingText = planned.filter((s) => !shareTextComplete(s.lesson.shareText)), one = missingText.length === 1;
    if (missingText.length && !(await confirmDialog("Absätze fehlen",
      "Zu " + list(missingText.map((s) => s.n)) + " gibt es noch keinen vollständigen Absatz – unter dem Leupold-Schema steht dort dann nur, was schon da ist, und der grobe Ablauf aus der Tabelle. Mit „Absätze mit Claude schreiben“ " +
        (one ? "lässt er" : "lassen sie") + " sich vorher ergänzen. Trotzdem jetzt teilen?", "Trotzdem teilen"))) return;
    building = true;
    const guard = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    let r = null;
    try {
      const S = await lazy(import("./share.js")), full = (await tapi("GET", "/api/teacher/units/" + u.id)).unit;
      r = await S.buildShareZip(full, { onStep: (m) => stateLine(state, m) });
      downloadBlob(r.blob, r.name, 10 * 60e3);
      stateLine(state, "Heruntergeladen: " + r.name + " (" + fmtBytes(r.blob.size) + ", " + r.sessions + " Sitzung" + (r.sessions === 1 ? "" : "en") + (r.missing ? ", " + r.missing + " noch nicht geplant" : "") + ")", "ok");
    } catch (e) { stateLine(state, ""); errToast(e); }
    finally {
      building = false; window.removeEventListener("beforeunload", guard); paint();
      // der Knopf war während des Erstellens gesperrt (der Fokus fiel auf die Seite): zurück auf den neu gezeichneten Knopf
      const a = document.activeElement;
      if (fromKey && (!a || a === document.body || !a.isConnected)) focusBy(fromKey);
    }
    // Hinweise vollständig (alle; der Dialog scrollt): was fehlt oder anders ist als erwartet – „Fertig“ gibt den Fokus an den Knopf zurück
    if (r && r.notes.length) modal({ title: "Hinweise zum Ordner", wide: true, body: (el2) => el2.append(
      h("p", { class: "small", text: "Der Ordner ist heruntergeladen. Bitte prüfen Sie diese Punkte, bevor Sie ihn weitergeben:" }),
      h("ul", { class: "small" }, r.notes.map((x) => h("li", { text: x })))), actions: [{ label: "Fertig", class: "primary" }] });
  }

  if (dirtyTexts().length) stateLine(state, "Ungespeicherte Absätze");
  refresh(true);
  // keep(): vor einem Neuaufbau der Seite (units.js) – die neue Karte derselben Einheit übernimmt die ungespeicherten Absätze
  const keep = () => { const d = dirtyTexts(); if (d.length) KEPT.set(ctx.getUnit().id, { at: Date.now(), edits: new Map(d) }); };
  return { el, refresh, dirty: () => dirtyTexts().length > 0, keep };
}
