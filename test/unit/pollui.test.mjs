// Nachtrag 46: Anzeige der anonymen Umfrage (public/pollview.js) und das Feld „Umfragefolien“ der Sitzungsseite (public/pollpanel.js) – Abstimmen bei den
// Schüler:innen, „Abstimmungsergebnis“ (aufklappbar), Beamer (nur die Zahl bzw. nach dem Zeigen die Verteilung), eine Zeile des Formulars lesen.
// Den Ablauf im Browser prüft E2E (polls.mjs). Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
const { installDom } = await import("./fake-dom.mjs");
const D = installDom({ hash: "#/" });
const V = await import("../../public/pollview.js");
const P = await import("../../public/polls.js");
const { readPollRow, pollsSummary, POLLS_HINT } = await import("../../public/pollpanel.js");
const { store } = await import("../../public/ui.js");
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const K = "0123456789abcdef:2", Q = "Soll das Wahlalter auf 16 sinken?", OPTS = ["Ja", "Nein", "Unentschieden"];
const mount = (el) => { const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(el); };
const tick = () => D.sleep(0);

test("Balken: je Antwort Text und „Zahl · Prozent“ als Text; die meistgewählte ist hervorgehoben", () => {
  const ul = V.pollBars(OPTS, [3, 1, 0]);
  assert.deepEqual($$("li.pollbar", ul).map((li) => [li.querySelector(".pb-text").textContent, li.querySelector(".pb-num").textContent, li.classList.contains("lead")]),
    [["Ja", "3 · 75 %", true], ["Nein", "1 · 25 %", false], ["Unentschieden", "0 · 0 %", false]]);
  assert.ok($$(".pb-track", ul).every((t) => t.getAttribute("aria-hidden") === "true"), "der Balken selbst ist Zierde – die Zahl steht daneben");
  assert.ok(!$$("li.pollbar", V.pollBars(OPTS, [0, 0, 0])).some((li) => li.classList.contains("lead")), "ohne Stimmen keine Hervorhebung");
});

test("Schüler:in: Auswahl mit Optionsfeldern, ohne Auswahl eine Meldung, nach der Stimme „gezählt“ (gemerkt), beendet → Hinweis auf „Abstimmungsergebnis“", async () => {
  store.del("u.poll." + K);
  const sent = [];
  const sp = V.studentPoll({ vote: async (k, choice) => { sent.push([k, choice]); } });
  mount(sp.el);
  sp.set(null);
  assert.equal(sp.el.textContent, "", "ohne Umfragefolie nichts");
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: true });
  const sec = sp.el.querySelector("section.pollbox");
  assert.equal(sec.querySelector("h2").textContent, "Umfrage"); assert.equal(sec.querySelector(".poll-q").textContent, Q);
  assert.deepEqual($$('input[type="radio"]', sec).map((i) => i.getAttribute("name")), ["poll-choice", "poll-choice", "poll-choice"]);
  assert.deepEqual($$("label.poll-opt", sec).map((l) => l.textContent), OPTS);
  assert.equal(sec.querySelector("fieldset").getAttribute("aria-labelledby"), "poll-q");
  assert.equal(sec.querySelector("#poll-hint").textContent, P.POLL_STUDENT.hint);
  assert.equal(sp.open, true);
  assert.equal(sp.el.querySelector('p.sr-only[role="status"]').textContent, "Umfrage: " + Q + " – du kannst jetzt unter der Präsentation abstimmen.", "angesagt (das Feld erscheint ohne Fokuswechsel)");
  // ohne Auswahl
  D.fire(sec.querySelector("form"), "submit");
  await tick();
  assert.equal(sec.querySelector("#poll-err").textContent, P.POLL_STUDENT.pick); assert.deepEqual(sent, []);
  // derselbe Stand noch einmal: nichts wird neu gezeichnet (die Auswahl bliebe sonst nicht)
  D.userClick($$('input[type="radio"]', sec)[1]);
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: true });
  assert.equal(sp.el.querySelector("section.pollbox"), sec);
  D.fire(sec.querySelector("form"), "submit");
  await tick(); await tick();
  assert.deepEqual(sent, [[K, 1]]);
  assert.equal(sp.el.querySelector(".poll-state").textContent, P.POLL_STUDENT.done);
  assert.equal(sp.el.querySelector("form"), null, "kein zweites Abstimmen");
  assert.equal(store.get("u.poll." + K), "1"); assert.equal(sp.open, false);
  // beendet
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: false });
  assert.equal(sp.el.querySelector(".poll-state").textContent, P.POLL_STUDENT.closed);
  // Zahlen aus einer (falschen) Nachricht erscheinen hier nie
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: false, counts: [9, 9, 9], total: 27 });
  assert.ok(!/\b9\b|27/.test(sp.el.textContent));
  // von der Lehrkraft neu geöffnet (r): dasselbe Gerät darf wieder einmal
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: true });
  assert.equal(sp.el.querySelector("form"), null, "ohne Neuöffnen bleibt es bei „gezählt“");
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: true, r: 1800000000000 });
  assert.ok(sp.el.querySelector("form"), "neu geöffnet: wieder das Formular"); assert.equal(sp.open, true);
  sp.set(null);
  assert.equal(sp.el.textContent, "");
});

test("Schüler:in: lehnt der Server ab – schon abgestimmt → wie gezählt; nicht geöffnet → Meldung, das Formular bleibt", async () => {
  store.del("u.poll." + K);
  let mode = "not_open";
  const sp = V.studentPoll({ vote: async () => { const e = new Error(mode === "voted" ? P.POLL_ERRORS.voted : P.POLL_ERRORS.not_open); e.code = "poll_" + mode; throw e; } });
  mount(sp.el);
  sp.set({ k: K, n: 2, q: Q, options: OPTS, open: true });
  D.userClick($$('input[type="radio"]', sp.el)[0]);
  D.fire(sp.el.querySelector("form"), "submit");
  await tick(); await tick();
  assert.equal(sp.el.querySelector("#poll-err").textContent, P.POLL_ERRORS.not_open);
  assert.ok(sp.el.querySelector("form"), "das Formular bleibt"); assert.equal(store.get("u.poll." + K), null);
  mode = "voted";
  D.fire(sp.el.querySelector("form"), "submit");
  await tick(); await tick();
  assert.equal(sp.el.querySelector("form"), null); assert.equal(store.get("u.poll." + K), "1");
  store.del("u.poll." + K);
});

test("„Abstimmungsergebnis“: leer ohne Ergebnis; je Umfrage ein aufklappbares Feld (zunächst zu) mit Frage, Zahl der Antworten und Balken; aufgeklappt bleibt beim Neuladen", () => {
  const r = V.pollResults();
  mount(r.el);
  r.update([]);
  assert.equal(r.el.textContent, "");
  const one = { id: "2-5000", q: Q, options: OPTS, counts: [3, 1, 0], total: 4 };
  r.update([one]);
  const sec = r.el.querySelector("section.pollresbox");
  assert.equal(sec.querySelector("h2").textContent, "Abstimmungsergebnis"); assert.equal(sec.getAttribute("aria-labelledby"), "polls-sh");
  const d = sec.querySelector("details.pollres");
  assert.ok(!d.open, "zunächst zugeklappt");
  assert.equal(d.querySelector("summary .pr-q").textContent, Q); assert.equal(d.querySelector("summary .pr-n").textContent, "4 Antworten");
  assert.deepEqual($$(".pb-num", d).map((x) => x.textContent), ["3 · 75 %", "1 · 25 %", "0 · 0 %"]);
  const live = r.el.querySelector('p.sr-only[role="status"]');
  assert.match(live.textContent, /Neues Abstimmungsergebnis: „Soll das Wahlalter auf 16 sinken\?“/, "angesagt, weil es bei offener Seite dazukam");
  assert.equal(sec.querySelector('[role="status"]'), null, "die Live-Region bleibt stehen (außerhalb des neu gezeichneten Bereichs)");
  // dieselben Daten: nichts neu gezeichnet
  r.update([{ ...one }]);
  assert.equal(r.el.querySelector("details.pollres"), d);
  // aufgeklappt, dann kommt ein zweites Ergebnis dazu: das erste bleibt offen, das neue ist zu
  d.open = true; D.fire(d, "toggle");
  r.update([one, { id: "4-9000", q: "Zweite Frage?", options: ["a", "b"], counts: [1, 1], total: 2 }]);
  const ds = $$("details.pollres", r.el);
  assert.deepEqual(ds.map((x) => !!x.open), [true, false]);
  assert.equal(r.el.querySelector('p.sr-only[role="status"]'), live);
  assert.match(live.textContent, /^Neues Abstimmungsergebnis: „Zweite Frage\?“\.$/, "angesagt wird nur das neue");
  r.update(null);
  assert.equal(r.el.textContent, "", "Ergebnis gelöscht: der Bereich verschwindet");
  // Ergebnisse, die beim Öffnen der Seite schon da sind, werden nicht als „neu“ angesagt
  const r2 = V.pollResults();
  r2.update([one]);
  assert.equal(r2.el.querySelector('p.sr-only[role="status"]').textContent, "");
});

test("Beamer: ohne Freigabe nur „Umfrage · n Antworten“, mit „Ergebnis am Beamer zeigen“ die Verteilung; ohne Umfrage verborgen", () => {
  const b = V.beamerPoll();
  mount(b.el);
  assert.equal(b.el.hidden, true);
  b.set({ k: K, n: 2, q: Q, options: OPTS, open: true, total: 12, shown: false });
  assert.equal(b.el.hidden, false); assert.equal(b.el.textContent, "Umfrage · 12 Antworten");
  assert.equal(b.el.querySelector(".pollbars"), null, "keine Verteilung");
  // Zahlen ohne Freigabe (dürfte der Server nie schicken) werden trotzdem nicht gezeigt
  b.set({ k: K, n: 2, q: Q, options: OPTS, open: true, total: 12, shown: false, counts: [7, 4, 1] });
  assert.equal(b.el.querySelector(".pollbars"), null);
  b.set({ k: K, n: 2, q: Q, options: OPTS, open: false, total: 12, shown: true, counts: [7, 4, 1] });
  assert.ok(b.el.classList.contains("shown"));
  assert.equal(b.el.querySelector(".bmp-q").textContent, Q);
  assert.deepEqual($$(".pb-num", b.el).map((x) => x.textContent), ["7 · 59 %", "4 · 33 %", "1 · 8 %"]);
  assert.equal(b.el.querySelector(".bmp-n").textContent, "12 Antworten · Abstimmung beendet");
  b.set(null);
  assert.equal(b.el.hidden, true); assert.equal(b.el.textContent, "");
});

test("Umfragefolie aus dem Formular: Folie, Frage, Antworten je Zeile – Meldungen sagen, was fehlt, und nennen das Feld", () => {
  assert.deepEqual(readPollRow({ slide: "3", q: "  Bist   du dafür? ", options: " Ja \n\nNein\n  Weiß nicht " }, 1), { v: { n: 3, q: "Bist du dafür?", options: ["Ja", "Nein", "Weiß nicht"] } });
  const err = (row, field, re) => { const r = readPollRow({ slide: "2", q: "Frage?", options: "a\nb", ...row }, 4); assert.equal(r.field, field, JSON.stringify(row)); assert.match(r.error, re); };
  err({ slide: "" }, "sel", /^Umfrage 4: Bitte eine Folie wählen\.$/);
  err({ q: "  " }, "q", /^Umfrage 4: Bitte die Frage eingeben\.$/);
  err({ q: "x".repeat(P.POLL_LIMITS.question + 1) }, "q", /Die Frage ist zu lang/);
  err({ options: "nur eine" }, "opts", /mindestens 2 Antworten/);
  err({ options: "1\n2\n3\n4\n5\n6\n7" }, "opts", /Höchstens 6 Antworten/);
  err({ options: "Ja\nja" }, "opts", /Zwei Antworten sind gleich/);
  err({ options: "a | b\nc" }, "opts", /keinen senkrechten Strich/);
  // kopierter Text: zusammengesetzte Umlaute (NFD) und weiche Trennstriche werden bereinigt statt abgelehnt
  assert.deepEqual(readPollRow({ slide: "2", q: "Wa\u0308hlen ab 16?", options: "Da\u00ADfür\nDagegen" }, 1), { v: { n: 2, q: "Wählen ab 16?", options: ["Dafür", "Dagegen"] } });
  err({ options: "x".repeat(P.POLL_LIMITS.option + 1) + "\nb" }, "opts", /Eine Antwort ist zu lang/);
});

test("Kopf des Feldes: woher die Umfragefolien kommen; der Hinweis nennt Anonymität, einmal je Gerät und die 2 Minuten", () => {
  const s = { n: 2, q: Q, options: OPTS };
  assert.equal(pollsSummary({ polls: { pdf: [s, { ...s, n: 5 }], hand: null } }), "aus der PDF: Folien 2, 5");
  assert.equal(pollsSummary({ polls: { pdf: null, hand: [{ ...s, n: 4 }] } }), "von Ihnen festgelegt: Folie 4");
  assert.equal(pollsSummary({ polls: { pdf: [s], hand: [] } }), "keine (von Ihnen festgelegt)");
  assert.equal(pollsSummary({ polls: { pdf: null, hand: null } }), "keine");
  assert.ok(POLLS_HINT.includes("anonym") && POLLS_HINT.includes("je Gerät einmal") && POLLS_HINT.includes("2 Minuten nach der ersten Antwort") && POLLS_HINT.includes("„Abstimmungsergebnis“"));
});
