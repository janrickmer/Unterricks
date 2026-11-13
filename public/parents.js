// parents.js – Elternansicht der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): erreichbar nur über den geheimen Link der Lehrkraft
// (#/eltern/<Token>), ohne Anmeldung. Erst nach dem geplanten Ende der Sitzung zu sehen (vorher „Diese Unterrichtssitzung hat noch nicht
// stattgefunden.“). Ganz oben der Hinweis der Lehrkraft (rot), dann die Bildkarten zum Nacherzählen, „Inhalt der Unterrichtsstunde“,
// „Hausaufgabe“ (nur, wenn eine eingetragen ist), das Material der Kinder (PDF) und ganz unten die vorherigen Sitzungen dieses Schuljahres.
// Die Seite speichert nichts auf dem Gerät (kein localStorage), lädt nichts von fremden Servern und importiert keine Module der Lehrkraft.
import { h, clear, api, apiUrl, icon, setFach } from "./ui.js";
import { render, onLeave } from "./app.js";
import { fmtDay, fmtClockBerlin, isIsoDate, berlinToday } from "./shared.js";
import { cardViewer } from "./cardview.js";

const longDate = (iso) => (isIsoDate(iso) ? new Date(iso + "T12:00:00Z").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const pagesText = (n) => (Number.isInteger(n) && n > 0 ? "PDF, " + n + (n === 1 ? " Seite" : " Seiten") : "PDF");
const NOT_YET = "Diese Unterrichtssitzung hat noch nicht stattgefunden.";
const CANCELLED = "Der Unterricht konnte an diesem Termin leider nicht stattfinden. Darum gibt es für diesen Termin keine Unterrichtsinhalte.";
const FOOTER = "Diese Seite ist nur über den Link der Lehrkraft erreichbar. Bitte geben Sie den Link nicht weiter. Diese Seite speichert nichts auf Ihrem Gerät.";
const titleOf = (d) => (d.lesson && d.lesson.date ? "Unterricht am " + fmtDay(d.lesson.date).replace(/^\S+, /, "") : "Unterricht");
const sessionHeading = (date) => (date ? "Unterrichtssitzung am " + longDate(date) : "Unterrichtssitzung");

/* Text „Sie können sie hier ab 08:45 Uhr ansehen.“ bzw. „… ab Mittwoch, 11. November 2026, 00:00 Uhr …“ */
function pendingText(d) {
  if (!d.lesson || !d.lesson.date || !d.opensAt) return NOT_YET + " Der Termin dieser Unterrichtssitzung steht noch nicht fest.";
  const day = berlinToday(d.opensAt), clock = fmtClockBerlin(d.opensAt) + " Uhr";
  return NOT_YET + " Sie können sie hier ab " + (day === d.lesson.date ? clock : longDate(day) + ", " + clock) + " ansehen.";
}

/* ---------- Inhalt der Elternansicht (auch für die Vorschau der Lehrkraft) ----------
   o.openFileHref(fileId, lessonId) → Link einer PDF; o.sessionHref(lessonId | null) → Link einer Sitzung (null = die Sitzung des Links);
   o.loadPrevious() → {lessons} (vorherige Sitzungen); o.reload() → neue Nutzlast (für abgelaufene Kartenbilder); o.isAnchor: Sitzung des Links */
export function parentViewDom(d, o = {}) {
  const root = h("div", { class: "parents-view" });
  const h1 = h("h1", { tabindex: "-1" });
  const lesson = d.lesson || {};
  if (d.note && d.state !== "pending") {
    root.append(h("section", { class: "alarm parent-note", role: "note", "aria-labelledby": "pv-note-h" }, icon("alert"),
      h("div", null, h("h2", { id: "pv-note-h", text: "Hinweis der Lehrkraft" }), h("p", { class: "prewrap", text: d.note }))));
  }
  if (d.state === "pending") {
    h1.textContent = sessionHeading(lesson.date);
    root.append(h1, h("p", { class: "notice", role: "status", text: pendingText(d) }));
  } else if (d.state === "cancelled") {
    h1.textContent = sessionHeading(lesson.date);
    root.append(h1, d.course ? h("p", { class: "pv-meta", text: d.course.label }) : null, h("p", { class: "notice", text: CANCELLED }));
  } else {
    h1.textContent = lesson.title || sessionHeading(lesson.date);
    root.append(h1, h("p", { class: "pv-meta", text: [d.course && d.course.label, longDate(lesson.date)].filter(Boolean).join(" · ") }));
    for (const c of d.cards || []) {
      const reload = o.reload ? async () => { const nd = await o.reload(); const x = ((nd && nd.cards) || []).find((y) => y.fileId === c.fileId); return x ? { images: x.img } : null; } : null;
      root.append(h("section", { class: "card pv-cards", role: "region", "aria-label": "Bildkarten: " + String(c.name || "").replace(/\.pdf$/i, "") },
        h("h2", { text: "Die Geschichte zum Nacherzählen" }),
        h("p", { class: "small", text: "Klicken Sie sich der Reihe nach durch die Bildkarten und erzählen Sie die Geschichte mit Ihrem Kind nach." }),
        cardViewer({ images: c.img, pages: c.pages, w: c.w, h: c.h, texts: c.texts || [], reload })));
    }
    if (d.summary) root.append(h("section", { class: "card pv-summary" }, h("h2", { text: "Inhalt der Unterrichtsstunde" }), h("p", { class: "prewrap", text: d.summary })));
    if (d.homework && d.homework.text) {
      root.append(h("section", { class: "card pv-homework" }, h("h2", { text: "Hausaufgabe" }), h("p", { class: "prewrap", text: d.homework.text }),
        d.homework.dueDate ? h("p", { class: "small muted", text: "bis zur nächsten Stunde am " + longDate(d.homework.dueDate) }) : null));
    }
    if ((d.files || []).length) {
      root.append(h("section", { class: "card pv-files" }, h("h2", { text: "Material für die Schüler" }),
        h("ul", { class: "pv-filelist" }, d.files.map((f) => h("li", null, h("a", { href: o.openFileHref ? o.openFileHref(f.id, lesson.id) : "#", target: "_blank", rel: "noopener" },
          f.name + " (" + pagesText(f.pages) + ")", h("span", { class: "sr-only", text: " – öffnet in neuem Tab" })))))));
    }
    if (!d.cards && !d.summary && !d.homework && !d.files) root.append(h("p", { class: "muted", text: "Zu dieser Unterrichtssitzung hat die Lehrkraft noch nichts für Sie eingetragen." }));
  }
  // ganz unten: zurück zur Sitzung des Links, vorherige Sitzungen dieses Schuljahres
  const bottom = h("div", { class: "pv-bottom stack" });
  if (!o.isAnchor && o.sessionHref) {
    const ad = d.anchor && d.anchor.date;
    bottom.append(h("p", null, h("a", { class: "pv-back", href: o.sessionHref(null) }, "← Zur Sitzung" + (ad ? " vom " + fmtDay(ad).replace(/^\S+, /, "") : ""))));
  }
  if (o.loadPrevious && (d.hasPrevious || !o.isAnchor)) {
    const box = h("div", { class: "pv-prev" });
    const btn = h("button", { class: "btn", type: "button" }, "Vorherige Unterrichtssitzungen dieses Schuljahres ansehen");
    const st = h("p", { class: "small", role: "status" });
    btn.addEventListener("click", async () => {
      btn.disabled = true; st.textContent = "Die Sitzungen werden geladen …";
      try {
        const r = await o.loadPrevious();
        const head = h("h2", { tabindex: "-1", text: "Unterrichtssitzungen dieses Schuljahres" });
        const items = (r.lessons || []).map((l) => {
          const label = (l.date ? fmtDay(l.date) : "ohne Termin") + " – " + (l.cancelled ? "Unterricht ausgefallen" : l.title || "Unterrichtssitzung");
          return h("li", null, l.id === lesson.id ? h("span", null, label, h("strong", { text: " (diese Sitzung)" })) : h("a", { href: o.sessionHref(l.current ? null : l.id) }, label));
        });
        clear(box).append(head, items.length ? h("ul", { class: "pv-sessions" }, items) : h("p", { class: "muted", text: "In diesem Schuljahr gibt es noch keine weiteren Unterrichtssitzungen." }));
        head.focus();
      } catch (e) { btn.disabled = false; st.textContent = e.message || String(e); }
    });
    box.append(btn, st);
    bottom.append(box);
  }
  if (bottom.childNodes.length) root.append(bottom);
  root.focusHeading = () => h1.focus({ preventScroll: false });
  return root;
}

/* ---------- Seite #/eltern/<Token>[/s/<Sitzung> | /pdf/<Sitzung>/<Datei>] ---------- */
let navigated = false;   // erste Seite nach dem Öffnen des Links: Fokus bleibt am Anfang; danach (Navigation in der Ansicht) auf die Überschrift
export async function parentsPage(token, kind, lessonId, fileId) {
  const bar = h("header", { class: "topbar parents-bar" }, h("div", { class: "inner" },
    h("span", { class: "brand" }, h("img", { src: "/icon.svg", alt: "" }), "Unterricks"), h("span", { class: "pv-badge", text: "Elternansicht" })));
  const main = h("main", { class: "narrow parents" });
  const foot = h("footer", { class: "parents-foot" }, h("p", { class: "small muted", text: FOOTER }));
  render(bar, main, foot);
  setFach("gs");
  const oldTitle = document.title;
  onLeave(() => { document.title = oldTitle; });
  if (kind === "pdf") return openPdf(main, token, lessonId, fileId);
  const showFocus = navigated;
  navigated = true;
  const load = () => api("POST", "/api/eltern/sitzung", { body: { token, lessonId: kind === "s" ? lessonId : null } });
  const loading = () => clear(main).append(h("p", { role: "status", class: "muted", text: "Die Unterrichtssitzung wird geladen …" }));
  let timer = null, visFn = null;
  onLeave(() => { clearTimeout(timer); if (visFn) document.removeEventListener("visibilitychange", visFn); });
  async function show() {
    clearTimeout(timer);
    if (visFn) { document.removeEventListener("visibilitychange", visFn); visFn = null; }
    // lag der Fokus in der Ansicht (z. B. auf „Erneut versuchen“), geht er mit dem Neuaufbau verloren: danach auf die Überschrift bzw. den neuen
    // Knopf – nur, wenn er dann noch auf body liegt (Abschlussprüfung F38)
    const hadFocus = main.contains(document.activeElement);
    const lost = () => !document.activeElement || document.activeElement === document.body;
    loading();
    let d;
    try { d = await load(); }
    catch (e) {
      if (!main.isConnected) return;
      clear(main);
      if (e.status === 404 || e.status === 403 || e.status === 429) {
        const h1 = h("h1", { text: "Elternansicht" });
        main.append(h("section", { class: "card" }, h1, h("p", { class: "notice err", role: "alert", text: e.message })));
        if (hadFocus && lost()) { h1.setAttribute("tabindex", "-1"); h1.focus(); }
      } else {
        const retry = h("button", { class: "btn", type: "button", onclick: () => show() }, "Erneut versuchen");
        main.append(h("section", { class: "card" }, h("h1", { text: "Elternansicht" }), h("p", { class: "notice err", role: "alert", text: e.message || String(e) }), h("div", { class: "row" }, retry)));
        if (hadFocus && lost()) retry.focus();
      }
      return;
    }
    if (!main.isConnected) return;
    document.title = titleOf(d);
    const view = parentViewDom(d, {
      isAnchor: kind !== "s",
      openFileHref: (fid, lid) => "#/eltern/" + token + "/pdf/" + lid + "/" + fid,
      sessionHref: (lid) => "#/eltern/" + token + (lid ? "/s/" + lid : ""),
      loadPrevious: () => api("POST", "/api/eltern/verlauf", { body: { token } }),
      reload: load,
    });
    clear(main).append(view);
    if ((showFocus || hadFocus) && lost()) view.focusHeading();
    // noch nicht stattgefunden: zum Ende der Sitzung neu laden (Zeitgeber und beim Zurückkehren in den Tab)
    if (d.state === "pending" && d.opensAt) {
      const due = Date.now() + Math.max(0, d.opensAt - d.now);
      const again = () => { if (main.isConnected) show(); };
      timer = setTimeout(again, Math.min(Math.max(1000, due - Date.now() + 1500), 2 ** 31 - 1));
      visFn = () => { if (document.visibilityState === "visible" && Date.now() >= due) again(); };
      document.addEventListener("visibilitychange", visFn);
    }
  }
  return show();
}

/* PDF des Materials in einem neuen Tab: signierten Link holen und dorthin wechseln (auf GitHub Pages über apiUrl zum Server) */
async function openPdf(main, token, lessonId, fileId) {
  const st = h("p", { role: "status", text: "Die PDF wird geöffnet …" });
  main.append(h("h1", { text: "PDF öffnen" }), st);
  try { const r = await api("POST", "/api/eltern/datei", { body: { token, lessonId, fileId } }); location.replace(apiUrl(r.url)); }
  catch (e) { st.className = "notice err"; st.textContent = e.message || String(e); main.append(h("p", { class: "small muted", text: "Sie können diesen Tab schließen." })); }
}
