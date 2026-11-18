// sharecard.js – Karte „Mit Kolleg:innen teilen“ ganz unten auf der Seite einer Unterrichtseinheit (Nachtrag 39, Gymnasium und Grundschule):
// Stand der Sitzungen (geplant / noch nicht geplant), „Absätze mit Claude schreiben“ (Prompt), Absätze prüfen und bearbeiten (je geplanter Sitzung
// drei Felder) und der Knopf „Unterrichtseinheit mit KollegInnen teilen“ → ZIP-Ordner (share.js, erst beim Klick geladen).
import { lazy } from "./update.js";
import { h, clear, toast, errToast, busy, confirmDialog, icon, stateLine, downloadBlob, fmtBytes, fmtTime } from "./ui.js";
import { tapi } from "./teacher.js";
import { claudeHandoff } from "./claude.js";
import { SHARE_BUTTON, SHARE_PARTS, SHARE_LIMITS, SHARE_TEXT_TITLE, shareSessions, shareTextComplete, claudeSharePrompt, competenceSource } from "./sharelib.js";

const list = (ns) => ns.map((n) => "Sitzung " + n).join(", ");

/* ctx = {getUnit, gs, isDirty, saveUnit} → {el, refresh} – el bleibt über paint() hinweg dasselbe Element (Eingaben in den Feldern gehen nicht verloren) */
export function shareCard(ctx) {
  let data = null, loading = null, edits = new Map(), building = false;   // edits: lessonId → {passiert, kompetenz, ziel, base}
  const state = h("span", { class: "save-state", role: "status" });
  const body = h("div", { class: "stack" }, h("p", { class: "muted small", text: "Lade den Stand der Sitzungen …" }));
  const el = h("section", { class: "card sharecard", id: "unitshare", "aria-labelledby": "unitshare-h" },
    h("div", { class: "section-title" }, h("h2", { id: "unitshare-h", text: "Mit Kolleg:innen teilen" }), state), body);
  const dirtyTexts = () => [...edits.entries()].filter(([, e]) => e.changed);

  async function load() {
    const u = ctx.getUnit();
    const r = await tapi("GET", "/api/teacher/units/" + u.id + "/share");
    data = { lessons: r.lessons || [] };
    return data;
  }
  async function refresh(force = false) {
    if (!force && dirtyTexts().length) return;   // ungespeicherte Absätze nicht überschreiben
    if (loading) return loading;
    loading = load().then(() => { paint(); }).catch((e) => { clear(body).append(h("p", { class: "err small", text: "Der Stand der Sitzungen ließ sich nicht laden: " + (e && e.message ? e.message : "Fehler") }),
      h("button", { class: "btn small", type: "button", onclick: () => refresh(true) }, "Erneut versuchen")); }).finally(() => { loading = null; });
    return loading;
  }

  function paint() {
    const u = ctx.getUnit(), gs = ctx.gs;
    const sessions = shareSessions(u.rows || [], data.lessons), planned = sessions.filter((s) => s.planned), open = sessions.filter((s) => !s.planned);
    const missingText = planned.filter((s) => !shareTextComplete(s.lesson.shareText));
    const src = competenceSource(u.subject, u.klass);
    // Felder neu aufbauen; was ungespeichert ist, bleibt (edits)
    for (const id of [...edits.keys()]) if (!planned.some((s) => s.lesson.id === id)) edits.delete(id);
    const what = gs
      ? "Ein ZIP-Ordner mit dem Leupold-Schema (darunter zu jeder Sitzung ein kurzer Absatz: was passiert, zentrale Kompetenz laut " + src.from + ", Ziel) und je geplanter Sitzung einem Ordner „Sitzung n“ mit dem Verlaufsplan und allen PDF-Dateien der Sitzung (Material für die Kinder, Druckliste, Material für die Lehrkraft samt Bildkarten). Sind noch nicht alle Stunden geplant, liegt das Dokument „Fehlende Sitzungen“ bei."
      : "Ein ZIP-Ordner mit dem Leupold-Schema (darunter zu jeder Sitzung ein kurzer Absatz: was passiert, zentrale Kompetenz" + (src.kcgo ? " des KCGO" : " laut " + src.from) + ", Ziel), der Erklärung „Das ist ein Feibeitsblatt“ (wenn die Einheit Feibeitsblätter nutzt) und je geplanter Sitzung einem Ordner „Sitzung n“ mit der Präsentation (ohne reine Codefolien, mit „Copyright Jan-Rickmer Feindt“ in der Fußzeile), den Notizen zu den Folien, dem Verlaufsplan und allen PDF-Dateien der Sitzung (Material für die Schüler:innen samt Notfall-Feibeitsblättern, Druckliste, Material für die Lehrkraft). Sind noch nicht alle Stunden geplant, liegt das Dokument „Fehlende Sitzungen“ bei.";
    const status = !sessions.length ? "Diese Einheit hat noch keine Sitzungen – legen Sie zuerst die Sitzungen an (Punkt 6)."
      : planned.length + " von " + sessions.length + " Sitzung" + (sessions.length === 1 ? "" : "en") + " geplant" + (open.length ? " (noch nicht geplant: " + list(open.map((s) => s.n)) + " – sie stehen im Dokument „Fehlende Sitzungen“)" : "") + ". " +
        (planned.length ? (missingText.length ? "Absätze für das Leupold-Schema fehlen noch bei " + list(missingText.map((s) => s.n)) + "." : "Zu allen geplanten Sitzungen gibt es einen Absatz.") : "");
    const claudeBtn = h("button", { class: "btn", type: "button", disabled: planned.length ? null : true, onclick: () => claudeHandoff({
      title: "Absätze für die Weitergabe mit Claude schreiben",
      intro: "Claude liest die Einheit, die Planungsgrundlagen und jede geplante Sitzung über den Connector und schreibt zu jeder Sitzung einen kurzen Absatz: was passiert, die zentrale Kompetenz" + (src.kcgo ? " des KCGO" : " laut " + src.from) + " und das Ziel der Sitzung.",
      after: "Wenn Claude die Absätze mit „save_weitergabe“ gespeichert hat, kommen Sie hierher zurück: Sie stehen unten unter „Absätze prüfen und bearbeiten“ und lassen sich ändern.",
      prompt: () => claudeSharePrompt({ unitId: u.id, title: u.title || (u.plan && u.plan.titel) || "", subject: u.subject, klass: u.klass, gs,
        sessions: sessions.map((s) => ({ n: s.n, lessonId: s.lesson ? s.lesson.id : null, title: (s.row && s.row.stundenfrage) || (s.lesson && s.lesson.title) || "", planned: s.planned, has: !!(s.lesson && shareTextComplete(s.lesson.shareText)) })) }) }) },
      "Absätze mit Claude schreiben");
    const shareBtn = h("button", { class: "btn primary big", type: "button", disabled: sessions.length && !building ? null : true, "aria-describedby": "unitshare-hint", onclick: (e) => busy(e.currentTarget, () => share(sessions, planned, missingText), "Stelle den Ordner zusammen …") },
      icon("download"), SHARE_BUTTON);
    clear(body).append(
      h("p", { class: "small", text: what }),
      h("p", { class: "small" + (missingText.length || open.length ? " warnc" : ""), text: status }),
      planned.length ? h("div", { class: "row" }, claudeBtn, h("span", { class: "hint", text: "Claude schreibt die Absätze; Sie prüfen sie hier." })) : null,
      planned.length ? editor(planned, src) : null,
      h("div", { class: "row sharego" }, shareBtn),
      h("p", { class: "hint", id: "unitshare-hint", text: gs
        ? "Der Ordner entsteht auf diesem Gerät aus dem gespeicherten Stand. Verweise im Verlaufsplan nennen den Namen der Datei im Ordner."
        : "Der Ordner entsteht auf diesem Gerät aus dem gespeicherten Stand – bei vielen Präsentationen kann das eine Minute dauern. Codefolien ohne Material fallen weg; auf Materialfolien wird die Zeile mit dem Unterricks-Code überdeckt. " +
          "Feibeitsblätter stecken als Notfall-Feibeitsblatt (PDF) im Ordner; das digitale Feibeitsblatt nutzen Kolleg:innen nur nach Absprache mit Ihnen (die Abgaben kämen bei Ihnen an)." }));
  }

  function editor(planned, src) {
    const saveBtn = h("button", { class: "btn", type: "button", disabled: true, onclick: (e) => busy(e.currentTarget, () => saveTexts(), "Speichere …") }, "Absätze speichern");
    const sync = () => { saveBtn.disabled = dirtyTexts().length ? false : true; };
    const sets = planned.map((s) => {
      // nur ungespeicherte Eingaben bleiben; sonst gilt der gerade geladene Stand (z. B. von Claude inzwischen gespeichert)
      const L = s.lesson, t = L.shareText, prev = edits.get(L.id);
      const e = prev && prev.changed ? prev : { passiert: t ? t.passiert : "", kompetenz: t ? t.kompetenz : "", ziel: t ? t.ziel : "", base: t ? t.at : null, changed: false };
      edits.set(L.id, e);
      const done = shareTextComplete(t);
      const badge = h("span", { class: "badge " + (done ? "ok" : t ? "warn" : ""), text: done ? "Absatz vorhanden" + (t.at ? " · " + fmtTime(t.at) : "") : t ? "unvollständig" : "noch kein Absatz" });
      const field = (key, label) => {
        const id = "sh-" + L.id + "-" + key;
        const ta = h("textarea", { id, rows: key === "passiert" ? "3" : "2", maxlength: String(SHARE_LIMITS[key]), value: e[key] || "" });
        ta.value = e[key] || "";
        ta.addEventListener("input", () => { e[key] = ta.value; e.changed = true; sync(); stateLine(state, "Ungespeicherte Absätze"); });
        return h("div", { class: "field" }, h("label", { for: id, text: key === "kompetenz" ? src.label : label }), ta);
      };
      return h("fieldset", { class: "sharetext" }, h("legend", null, "Sitzung " + s.n + ": " + ((s.row && s.row.stundenfrage) || L.title || "ohne Titel") + " ", badge),
        ...SHARE_PARTS.map(([k, label]) => field(k, label)));
    });
    const det = h("details", { class: "sharetexts" }, h("summary", { text: "Absätze prüfen und bearbeiten (" + planned.filter((s) => shareTextComplete(s.lesson.shareText)).length + " von " + planned.length + ")" }),
      h("p", { class: "hint", text: "Je Sitzung drei kurze Teile – sie stehen in der PDF-Datei unter dem Leupold-Schema. „" + SHARE_TEXT_TITLE + "“ schreibt Claude auch beim Planen jeder Stunde mit. Ein leerer Absatz entfernt ihn." }),
      ...sets, h("div", { class: "row" }, saveBtn));
    if (dirtyTexts().length) { det.open = true; sync(); }
    return det;
  }

  /* geänderte Absätze speichern → true, wenn alles gespeichert ist */
  async function saveTexts() {
    let ok = true;
    for (const [id, e] of dirtyTexts()) {
      try {
        const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { shareText: { passiert: e.passiert, kompetenz: e.kompetenz, ziel: e.ziel }, shareTextBase: e.base } });
        const t = r.lesson && r.lesson.shareText;
        edits.delete(id);
        const L = data.lessons.find((x) => x.id === id);
        if (L) L.shareText = t || null;
      } catch (err) {
        ok = false;
        if (err && err.status === 409) {
          const L = data.lessons.find((x) => x.id === id);
          toast("Der Absatz zu „" + (L ? L.title : "einer Sitzung") + "“ wurde inzwischen an anderer Stelle geändert (z. B. von Claude). Ihre Fassung steht noch in den Feldern – prüfen Sie den neuen Stand und speichern Sie erneut.", "err", 12000);
          if (L) { L.shareText = err.data && err.data.current ? err.data.current : null; e.base = L.shareText ? L.shareText.at : null; }
        } else { errToast(err); break; }
      }
    }
    if (ok) stateLine(state, "Absätze gespeichert", "ok");
    paint();
    return ok;
  }

  async function share(sessions, planned, missingText) {
    if (building) return;
    if (ctx.isDirty()) {
      if (!(await confirmDialog("Ungespeicherte Änderungen", "Der Ordner entsteht aus dem gespeicherten Stand der Einheit. Ihre Änderungen jetzt zuerst speichern?", "Speichern"))) return;
      await ctx.saveUnit();
      if (ctx.isDirty()) return;
    }
    if (dirtyTexts().length) {
      if (!(await confirmDialog("Ungespeicherte Absätze", "Ihre Änderungen an den Absätzen jetzt zuerst speichern? Sonst enthält der Ordner den zuletzt gespeicherten Stand.", "Speichern"))) return;
      if (!(await saveTexts())) return;
      missingText = planned.filter((s) => { const L = data.lessons.find((x) => x.id === s.lesson.id); return !shareTextComplete(L && L.shareText); });
    }
    if (planned.length && missingText.length && !(await confirmDialog("Absätze fehlen",
      "Zu " + list(missingText.map((s) => s.n)) + " gibt es noch keinen vollständigen Absatz – unter dem Leupold-Schema steht dort dann nur der grobe Ablauf aus der Tabelle. Mit „Absätze mit Claude schreiben“ lassen sie sich vorher ergänzen. Trotzdem jetzt teilen?", "Trotzdem teilen"))) return;
    building = true;
    const guard = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    try {
      const S = await lazy(import("./share.js")), full = (await tapi("GET", "/api/teacher/units/" + ctx.getUnit().id)).unit;
      const r = await S.buildShareZip(full, { onStep: (m) => stateLine(state, m) });
      downloadBlob(r.blob, r.name, 10 * 60e3);
      stateLine(state, "Heruntergeladen: " + r.name + " (" + fmtBytes(r.blob.size) + ", " + r.sessions + " Sitzung" + (r.sessions === 1 ? "" : "en") + (r.missing ? ", " + r.missing + " noch nicht geplant" : "") + ")", "ok");
      if (r.notes.length) toast(r.notes.slice(0, 6).join(" ") + (r.notes.length > 6 ? " (und " + (r.notes.length - 6) + " weitere Hinweise)" : ""), "", 12000);
    } catch (e) { stateLine(state, ""); errToast(e); }
    finally { building = false; window.removeEventListener("beforeunload", guard); }
  }

  refresh(true);
  return { el, refresh, dirty: () => dirtyTexts().length > 0 };
}
