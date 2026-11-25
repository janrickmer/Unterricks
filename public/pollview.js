// pollview.js – Anzeige der anonymen Umfrage (Nachtrag 46, Regeln in public/polls.js):
//  • pollBars – Verteilung als Balken mit Zahl und Prozent (Lehrkraft, Beamer, Ergebnis der Schüler:innen); Zahlen stehen immer als Text daneben, nie nur als Farbe
//  • studentPoll – Abstimmen in der Ansicht der Schüler:innen, direkt unter der Live-Präsentation (nur solange die Umfragefolie gezeigt wird)
//  • pollResults – Bereich „Abstimmungsergebnis“ ganz unten in der Ansicht der Schüler:innen: je Umfrage aufklappbar
//  • beamerPoll – am Beamer: Zahl der Antworten bzw. (nach „Ergebnis am Beamer zeigen“) die Verteilung
// Nur textContent – nie innerHTML. Kommt derselbe Stand noch einmal, bleibt alles stehen (Auswahl, Fokus und aufgeklappte Ergebnisse gehen nicht verloren).
import { h, clear, busy, store } from "./ui.js";
import { POLL_TITLE, POLL_STUDENT, POLL_ERRORS, pollPercents, votesText, cleanPollState } from "./polls.js";

/* Verteilung: je Antwort Text, Balken, „7 · 35 %“. counts wie options; lead = die meistgewählte(n) hervorheben */
export function pollBars(options, counts, { lead = true } = {}) {
  const pct = pollPercents(counts), max = Math.max(0, ...counts);
  return h("ul", { class: "pollbars" }, options.map((o, i) => h("li", { class: "pollbar" + (lead && max > 0 && counts[i] === max ? " lead" : "") },
    h("span", { class: "pb-text", text: o }),
    h("span", { class: "pb-track", "aria-hidden": "true" }, h("span", { class: "pb-fill", style: { width: pct[i] + "%" } })),
    h("span", { class: "pb-num", text: counts[i] + " · " + pct[i] + " %" }))));
}

/* ---------- Schüler:innen: abstimmen ----------
   set(poll) mit dem Stand aus der Live-Verbindung ({k, q, options, open} bzw. null). Ob dieses Gerät schon abgestimmt hat, merkt sich die Seite (store) – der
   Server prüft es unabhängig davon. vote(k, choice) → Promise (wirft mit code „poll_voted“ usw.). → {el, set} */
const VOTED_KEY = (p) => "u.poll." + p.k + (p.r ? "." + p.r : "");   // r: von der Lehrkraft neu geöffnet → das Gerät darf wieder einmal
export function studentPoll({ vote, onVoted = null }) {
  // box = das Feld (wird neu gezeichnet); say = bleibende, unsichtbare Live-Region: sagt an, dass eine Umfrage geöffnet wurde (das Feld erscheint ohne Fokuswechsel)
  const box = h("div", { class: "pollbox-holder" }), say = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const wrap = h("div", { class: "pollbox-wrap" }, say, box);
  let cur = null, key = "", picked = null, seq = 0;
  function paint() {
    const p = cur, my = ++seq;
    clear(box);
    if (!p) return;
    const voted = store.get(VOTED_KEY(p)) === "1";
    const head = h("h2", { id: "poll-h", text: POLL_STUDENT.title });
    const q = h("p", { class: "poll-q", id: "poll-q", text: p.q });
    const state = h("p", { class: "poll-state", role: "status" });
    const card = h("section", { class: "card pollbox", "aria-labelledby": "poll-h" }, head, q);
    if (!p.open || voted) {
      state.textContent = !p.open ? POLL_STUDENT.closed : POLL_STUDENT.done;
      card.classList.add(p.open ? "voted" : "closed");
      card.append(state);
      box.append(card);
      return;
    }
    const err = h("p", { class: "err small hidden", role: "alert", id: "poll-err" });
    const radios = p.options.map((o, i) => {
      const id = "poll-o-" + i, input = h("input", { type: "radio", name: "poll-choice", id, value: String(i), checked: picked === i ? true : null });
      input.addEventListener("change", () => { picked = i; err.classList.add("hidden"); });
      return h("label", { class: "poll-opt", for: id }, input, h("span", { text: o }));
    });
    const go = h("button", { class: "btn primary", type: "submit" }, POLL_STUDENT.go);
    const form = h("form", { class: "poll-form", novalidate: true },
      h("fieldset", { class: "poll-opts", "aria-labelledby": "poll-q", "aria-describedby": "poll-hint" }, ...radios),
      h("p", { class: "hint", id: "poll-hint", text: POLL_STUDENT.hint }), err, h("div", { class: "row" }, go));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (picked === null) { err.textContent = POLL_STUDENT.pick; err.classList.remove("hidden"); const f = form.querySelector("input"); if (f) f.focus({ preventScroll: true }); return; }
      const k = p.k, choice = picked;
      await busy(go, async () => {
        try {
          await vote(k, choice);
          store.set(VOTED_KEY(p), "1");
          if (onVoted) onVoted(k);
        } catch (ex) {
          if (ex && ex.code === "poll_voted") store.set(VOTED_KEY(p), "1");
          else {
            // beendet bzw. nicht mehr geöffnet: der nächste Stand der Live-Verbindung zeichnet es; bis dahin die Meldung (nur, wenn dieses Formular noch steht)
            if (my === seq && cur && cur.k === k) { err.textContent = (ex && ex.message) || POLL_ERRORS.not_open; err.classList.remove("hidden"); }
            return;
          }
        }
        // gezählt: neu zeichnen – auch wenn das Formular inzwischen neu aufgebaut wurde (Folie kurz verlassen und wieder gezeigt), solange es dieselbe Umfrage ist
        if (cur && cur.k === k && cur.r === p.r) { const had = my === seq || box.contains(document.activeElement); paint(); const st = box.querySelector(".poll-state"); if (st && had) { st.tabIndex = -1; st.focus({ preventScroll: true }); } }
      }, "Sendet …");
    });
    card.append(form);
    box.append(card);
  }
  return {
    el: wrap,
    set(raw) {
      const p = raw ? cleanPollState(raw) : null, k = p ? JSON.stringify([p.k, p.q, p.options, p.open, p.r]) : "";
      if (k === key) return;
      const other = !p || !cur || p.k !== cur.k || p.r !== cur.r;
      if (other) picked = null;
      key = k; cur = p;
      // neu geöffnet (bzw. von der Lehrkraft neu geöffnet) und von diesem Gerät noch nicht abgestimmt: ansagen
      say.textContent = !p ? "" : other && p.open && store.get(VOTED_KEY(p)) !== "1" ? "Umfrage: " + p.q + " – du kannst jetzt unter der Präsentation abstimmen." : say.textContent;
      // nie unter dem Fokus neu zeichnen, wenn sich nur „offen“ → „beendet“ ändert: dann wandert er auf die Meldung
      const had = box.contains(document.activeElement);
      paint();
      if (had && cur) { const st = box.querySelector(".poll-state") || box.querySelector("input"); if (st) { if (st.tagName === "P") st.tabIndex = -1; st.focus({ preventScroll: true }); } }
    },
    get open() { return !!cur && cur.open && store.get(VOTED_KEY(cur)) !== "1"; },
  };
}

/* ---------- Schüler:innen: „Abstimmungsergebnis“ ganz unten ----------
   update(list) mit [{id, q, options, counts, total}] aus der Antwort des Servers; leer → kein Bereich. Je Umfrage ein aufklappbares Feld (zu beim ersten
   Erscheinen; was auf- oder zugeklappt ist, bleibt beim Neuladen der Daten). → {el, update} */
export function pollResults() {
  // box = der Bereich (wird neu gezeichnet); live = bleibende, unsichtbare Live-Region: sagt ein Ergebnis an, das bei offener Seite dazukommt (nicht die, die
  // beim Öffnen der Seite schon da waren)
  const box = h("div", { class: "pollres-holder" }), live = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const wrap = h("div", { class: "pollres-wrap" }, box, live);
  let key = "", started = false;
  const open = new Map();
  function update(items) {
    const xs = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.q === "string" && Array.isArray(x.options) && Array.isArray(x.counts) && x.counts.length === x.options.length);
    const k = JSON.stringify(xs.map((x) => [x.id, x.q, x.options, x.counts]));
    const first = !started; started = true;
    if (k === key) return;
    const act = document.activeElement, hadId = act && box.contains(act) && act.closest("details") ? act.closest("details").dataset.id : null;
    for (const d of box.querySelectorAll("details")) open.set(d.dataset.id, d.open);
    key = k; clear(box);
    if (!xs.length) { live.textContent = ""; return; }
    const fresh = [];
    const items2 = xs.map((x, i) => {
      const id = String(x.id || i), total = x.counts.reduce((a, b) => a + b, 0);
      const d = h("details", { class: "pollres", "data-id": id },
        h("summary", null, h("span", { class: "pr-q", text: x.q }), h("span", { class: "pr-n muted small", text: votesText(total) })),
        h("div", { class: "pr-body" }, pollBars(x.options, x.counts)));
      if (open.get(id)) d.open = true;
      if (!open.has(id)) fresh.push(x.q);
      d.addEventListener("toggle", () => open.set(id, d.open));
      return d;
    });
    box.append(h("section", { class: "card pollresbox", id: "polls-s", "aria-labelledby": "polls-sh" }, h("h2", { id: "polls-sh", text: POLL_TITLE }),
      h("p", { class: "hint", text: xs.length === 1 ? "Tippe auf die Frage, um das Ergebnis zu sehen." : "Tippe auf eine Frage, um ihr Ergebnis zu sehen." }), ...items2));
    if (fresh.length && !first) live.textContent = "Neues Abstimmungsergebnis: " + fresh.map((q) => "„" + q + "“").join(", ") + ".";
    if (hadId !== null) { const d = [...box.querySelectorAll("details")].find((x) => x.dataset.id === hadId) || box.querySelector("details"); if (d) d.querySelector("summary").focus({ preventScroll: true }); }
  }
  return { el: wrap, update };
}

/* ---------- Beamer (Beamerfenster und Beamergerät) ----------
   set(poll) mit {q, options, open, total, shown, counts?}: ohne shown nur „Umfrage · 12 Antworten“ unten über der Folie, mit shown die Verteilung groß.
   → {el, set} */
export function beamerPoll() {
  const el = h("div", { class: "bm-poll", hidden: true });
  let key = "";
  return {
    el,
    set(raw) {
      const p = raw ? cleanPollState(raw) : null, k = p ? JSON.stringify([p.k, p.open, p.total, p.shown, p.counts || null]) : "";
      if (k === key) return;
      key = k;
      if (!p) { el.hidden = true; clear(el); return; }
      el.hidden = false;
      el.classList.toggle("shown", !!(p.shown && p.counts));
      const n = Number.isInteger(p.total) ? p.total : 0;
      if (p.shown && p.counts) clear(el).append(h("div", { class: "bmp-card" }, h("p", { class: "bmp-q", text: p.q }), pollBars(p.options, p.counts), h("p", { class: "bmp-n", text: votesText(n) + (p.open ? "" : " · Abstimmung beendet") })));
      else clear(el).append(h("p", { class: "bmp-badge" }, h("strong", { text: "Umfrage" }), " · " + votesText(n) + (p.open ? "" : " · beendet")));
    },
  };
}
