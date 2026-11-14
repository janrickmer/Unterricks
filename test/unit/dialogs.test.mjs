// Dialoge (Nachtrag 25): Der Tastaturfokus bleibt im obersten offenen Dialog – modal(), confirmDialog(), openLayer()/keepTab() aus public/ui.js
// und die eigenen Ebenen (Codefolie „Für den Beamer zeigen“, Folienfenster als Ebene) im Browser-Ersatz (fake-dom.mjs): Tab und Umschalt+Tab
// wandern im Kreis, nie auf die Seite dahinter; gesperrte, ausgeblendete, inerte Elemente und tabindex="-1" zählen nicht; Optionsfelder sind ein
// Halt; Esc schließt nur den obersten Dialog; der Fokus geht zum Auslöser zurück; die Seite ist inert (außer den Meldungen) und nichts bleibt inert.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk" });
const { h, modal, confirmDialog, openLayer, keepTab, tabbables } = await import("../../public/ui.js");

const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const desc = (el) => (el ? el.tagName + (el.id ? "#" + el.id : "") + " „" + el.textContent.trim().slice(0, 30) + "“" : String(el));
const at = (el, msg) => assert.ok(document.activeElement === el, (msg || "") + " – Fokus auf " + desc(document.activeElement) + ", erwartet " + desc(el));
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
const app = document.getElementById("app"), toasts = document.getElementById("toasts");
const inertNow = () => $$("[inert]").map((x) => x.id || x.className);
/* Seite mit Knöpfen davor und danach (der Fokus darf nie dorthin) */
function page() {
  for (const x of $$("body > *")) if (x !== app && x !== toasts) x.remove();
  app.replaceChildren(h("button", { id: "p1", type: "button" }, "Vorher"), h("button", { id: "open", type: "button" }, "Öffnen"), h("a", { id: "p2", href: "#/x" }, "Danach"));
  return { opener: document.getElementById("open") };
}
const settle = () => D.sleep(40);   // erster Fokus von modal() (30 ms) und Mikrotasks (MutationObserver)
/* n-mal Tab (bzw. Umschalt+Tab): jeder Halt liegt in root, nie auf der Seite */
function cycle(root, n, shift = false) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    D.press("Tab", shift ? { shiftKey: true } : {});
    const a = document.activeElement;
    assert.ok(root.contains(a), "Tab " + (i + 1) + (shift ? " (rückwärts)" : "") + " bleibt im Dialog – ist " + desc(a));
    seen.push(a);
  }
  return seen;
}

test("modal(): erster Fokus im Dialog, Tab vom letzten zum ersten, Umschalt+Tab vom ersten zum letzten, die Seite ist inert", async () => {
  const { opener } = page();
  opener.focus();
  let name = null, check = null;
  modal({ title: "Link hinzufügen", body: (el) => el.append(name = h("input", { id: "t" }), check = h("input", { type: "checkbox", id: "c" })),
    actions: [{ label: "Abbrechen" }, { label: "Hinzufügen", class: "primary", onClick: () => false }] });
  await settle();
  const box = document.querySelector(".modal"), x = button(box, "Schließen"), ok = button(box, "Hinzufügen");
  at(name, "erster Fokus: das Eingabefeld");
  assert.equal(box.getAttribute("role"), "dialog"); assert.equal(box.getAttribute("aria-modal"), "true");
  assert.deepEqual(inertNow(), ["app"], "die Seite ist inert, die Meldungen (#toasts) nicht");
  assert.deepEqual(tabbables(box).map((e) => e.id || e.textContent.trim() || e.getAttribute("aria-label")), ["Schließen", "t", "c", "Abbrechen", "Hinzufügen"]);
  ok.focus(); D.press("Tab"); at(x, "Tab vom letzten Halt → erster (Schließen)");
  D.press("Tab", { shiftKey: true }); at(ok, "Umschalt+Tab vom ersten Halt → letzter");
  const fwd = cycle(box, 11), back = cycle(box, 11, true);
  assert.equal(new Set(fwd).size, 5, "alle fünf Halte, im Kreis"); assert.equal(new Set(back).size, 5);
  // Fokus auf body (z. B. nach einem Klick auf eine leere Stelle): Tab → erster, Umschalt+Tab → letzter Halt
  document.activeElement.blur(); at(document.body); D.press("Tab"); at(x, "von body: Tab → erster Halt");
  document.activeElement.blur(); D.press("Tab", { shiftKey: true }); at(ok, "von body: Umschalt+Tab → letzter Halt");
  D.press("Escape");
  assert.equal($$(".modal").length, 0, "Esc schließt");
  at(opener, "Fokus zurück auf den Auslöser");
  assert.deepEqual(inertNow(), [], "nichts bleibt inert");
});

test("übereinander: Esc schließt nur den obersten Dialog, der Fokus geht an seinen Auslöser im Dialog darunter; die Ebene darunter ist solange inert", async () => {
  const { opener } = page();
  opener.focus();
  let inner = null;
  modal({ title: "Unten", body: (el) => el.append(inner = h("button", { type: "button", id: "inner" }, "Rückfrage öffnen")), actions: [{ label: "Fertig" }] });
  await settle();
  const lower = document.querySelector(".modal-back");
  inner.focus();
  const asked = confirmDialog("Wirklich?", "Diese Rückfrage liegt oben.", "Ja");
  await settle();
  assert.equal($$(".modal").length, 2);
  const upper = $$(".modal-back")[1];
  at(button(upper, "Ja"), "Rückfrage ohne Eingabefeld: Fokus auf dem Hauptknopf");
  assert.ok(lower.hasAttribute("inert") && app.hasAttribute("inert") && !upper.hasAttribute("inert") && !toasts.hasAttribute("inert"), "Seite und Dialog darunter inert: " + inertNow());
  cycle(upper, 7); cycle(upper, 7, true);
  D.press("Escape");
  assert.equal(await asked, false, "Esc beantwortet die Rückfrage mit „nein“");
  assert.equal($$(".modal").length, 1, "nur der oberste Dialog ist zu");
  assert.ok(lower.isConnected && !lower.hasAttribute("inert"), "der Dialog darunter ist wieder bedienbar");
  at(inner, "Fokus zurück auf den Auslöser im Dialog darunter");
  cycle(lower, 4);
  D.press("Escape");
  assert.equal($$(".modal").length, 0);
  at(opener, "danach zurück auf den Auslöser in der Seite");
  assert.deepEqual(inertNow(), []);
});

test("ein gesperrter, ausgeblendeter, inerter oder entfernter Halt: Tab bleibt im Dialog", async () => {
  const { opener } = page();
  opener.focus();
  let busyBtn = null, gone = null;
  const dlg = modal({ title: "Speichern", body: (el) => el.append(h("input", { id: "f1" }), h("button", { type: "button", id: "hid", class: "hidden" }, "versteckt"),
    h("span", { tabindex: "-1", id: "neg" }, "nur per Skript"), h("div", { inert: true }, h("button", { type: "button", id: "in" }, "inert")), h("button", { type: "button", id: "dis", disabled: true }, "gesperrt"),
    gone = h("button", { type: "button", id: "gone" }, "verschwindet")),
  actions: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: (e) => { busyBtn = e.currentTarget; busyBtn.disabled = true; return false; } }] });
  await settle();
  const box = document.querySelector(".modal");
  assert.deepEqual(tabbables(box).map((e) => e.id || e.textContent.trim() || e.getAttribute("aria-label")), ["Schließen", "f1", "gone", "Abbrechen", "Speichern"], "ohne ausgeblendete, gesperrte, inerte und tabindex=-1");
  // der fokussierte Knopf wird gesperrt (wie busy()): der Fokus fällt auf body – Tab landet im Dialog
  const save = button(box, "Speichern");
  save.focus(); save.click();
  assert.ok(save.disabled); at(document.body, "gesperrt: Fokus auf body (wie im Browser)");
  D.press("Tab"); at(button(box, "Schließen"), "Tab danach: erster Halt");
  D.press("Tab", { shiftKey: true }); at(button(box, "Abbrechen"), "Umschalt+Tab vom ersten: letzter erreichbarer Halt (Speichern ist gesperrt)");
  // tabindex=-1 fokussiert (per Skript): vom Platz im Dokument aus weiter
  document.getElementById("neg").focus(); at(document.getElementById("neg"));
  D.press("Tab"); at(gone, "Tab nach dem Element mit tabindex=-1: nächster Halt danach");
  document.getElementById("neg").focus(); D.press("Tab", { shiftKey: true }); at(document.getElementById("f1"), "Umschalt+Tab: voriger Halt");
  // fokussierter Knopf entfernt (Inhalt neu gezeichnet): Tab landet im Dialog
  gone.focus(); gone.remove(); at(document.body);
  D.press("Tab"); assert.ok(box.contains(document.activeElement)); at(button(box, "Schließen"));
  dlg.close();
  at(opener); assert.deepEqual(inertNow(), []);
});

test("Optionsfelder sind ein Halt (wie im Browser); ohne Wahl das erste bzw. letzte", async () => {
  page();
  const radios = ["a", "b", "c"].map((v) => h("input", { type: "radio", name: "r", value: v, id: "r" + v }));
  const dlg = modal({ title: "Bereich", body: (el) => el.append(...radios), actions: [{ label: "Abbrechen" }, { label: "Übernehmen", class: "primary" }] });
  await settle();
  const box = document.querySelector(".modal"), x = button(box, "Schließen"), go = button(box, "Übernehmen");
  go.focus(); D.press("Tab"); at(x);
  x.focus(); D.press("Tab", { shiftKey: true }); at(go);
  radios[1].checked = true;
  // vom letzten Halt rückwärts im Kreis: Übernehmen → Abbrechen → (Optionsfelder) → Schließen; am Rand landet Tab auf dem gewählten
  document.activeElement.blur(); D.press("Tab"); at(x);
  // Optionsfelder als letzter Halt: Tab vom gewählten (nicht vom letzten im Dokument) wandert zum ersten
  box.querySelector("footer").remove();
  radios[1].focus(); D.press("Tab"); at(x, "Tab vom gewählten Optionsfeld (letzter Halt) → erster Halt");
  x.focus(); D.press("Tab", { shiftKey: true }); at(radios[1], "Umschalt+Tab vom ersten Halt → das gewählte Optionsfeld");
  radios[1].checked = false;
  x.focus(); D.press("Tab", { shiftKey: true }); at(radios[2], "ohne Wahl: rückwärts das letzte Optionsfeld");
  dlg.close();
});

test("Esc und Tab: eigene Tastenhandler gehen vor (preventDefault), Strg/Alt/Cmd und Eingaben mit IME bleiben unberührt", async () => {
  page();
  let esc = 0;
  const host = h("div", { id: "lay" }, h("button", { type: "button", id: "l1" }, "Eins"), h("button", { type: "button", id: "l2" }, "Zwei"));
  document.body.append(host);
  const lay = openLayer(host, { onEscape: () => { esc++; } });
  document.getElementById("l2").focus();
  D.press("Tab", { ctrlKey: true }); at(document.body, "Strg+Tab (Tab des Browsers): nicht angefasst – der Ersatz-Browser geht ans Ende");
  D.press("Escape", { isComposing: true }); assert.equal(esc, 0, "Esc während einer Eingabe mit IME: nichts");
  host.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); }, { once: true });
  document.getElementById("l1").focus(); D.press("Escape"); assert.equal(esc, 0, "ein eigener Handler hat Esc behalten");
  D.press("Escape"); assert.equal(esc, 1);
  assert.equal(lay.top, true);
  host.remove(); lay.release();
  assert.deepEqual(inertNow(), []);
});

test("ohne close() entfernt (Seitenwechsel): die Ebene verschwindet von selbst, nichts bleibt inert, Tab geht in den Dialog darunter", async () => {
  const { opener } = page();
  opener.focus();
  modal({ title: "Unten", body: h("p", { text: "Text" }), actions: [{ label: "Abbrechen" }, { label: "OK", class: "primary" }] });
  await settle();
  const lower = document.querySelector(".modal-back");
  modal({ title: "Oben", body: h("p", { text: "Text" }), actions: [{ label: "Schließen" }] });
  await settle();
  const upper = $$(".modal-back")[1];
  assert.ok(lower.hasAttribute("inert"));
  upper.remove();
  await D.sleep(0);
  assert.ok(!lower.hasAttribute("inert") && app.hasAttribute("inert"), "nach dem Entfernen: der Dialog darunter ist wieder bedienbar, die Seite noch inert");
  assert.ok(lower.contains(document.activeElement), "der Fokus fiel auf body – er kommt in den Dialog darunter: " + desc(document.activeElement));
  D.press("Escape");
  assert.equal($$(".modal").length, 0); assert.deepEqual(inertNow(), []);
  // ganz ohne Dialog darunter
  modal({ title: "Allein", body: h("p", { text: "Text" }) });
  await settle();
  assert.deepEqual(inertNow(), ["app"]);
  document.querySelector(".modal-back").remove();
  await D.sleep(0);
  assert.deepEqual(inertNow(), [], "nichts bleibt inert");
  D.press("Escape"); D.press("Tab");
});

test("erster Fokus: nie über einen schon gesetzten Fokus hinweg und nie, wenn schon ein Dialog darüber liegt", async () => {
  page();
  let field = null;
  modal({ title: "A", body: (el) => el.append(h("input", { id: "a1" }), field = h("input", { id: "a2" })), actions: [{ label: "OK", class: "primary" }] });
  field.focus();   // schnelles Tippen: die Lehrkraft ist schon im zweiten Feld
  await settle();
  at(field, "der verzögerte erste Fokus nimmt ihn nicht weg");
  const lower = document.querySelector(".modal");
  document.activeElement.blur();
  const top = modal({ title: "B", body: h("p", { text: "Nur Text" }) });
  await settle();
  const upper = $$(".modal")[1];
  at(button(upper, "Schließen"), "ohne Eingabefeld und ohne Knöpfe unten: „Schließen“");
  assert.ok(!lower.contains(document.activeElement));
  top.close();
  assert.ok(lower.contains(document.activeElement), "zurück in den Dialog darunter (zuletzt fokussiert bzw. erster Halt)");
  D.press("Escape");
});

test("Dialog im Vollbild: er hängt im Element im Vollbild, das nie inert wird; danach wieder an body", async () => {
  page();
  const fs = h("div", { class: "presenter", id: "pres", tabindex: "-1" }, h("button", { type: "button", id: "next" }, "Weiter"));
  document.body.append(fs);
  document.fullscreenElement = fs;
  try {
    modal({ title: "Im Vollbild", body: h("p", { text: "Text" }), actions: [{ label: "OK", class: "primary" }] });
    await settle();
    const back = document.querySelector(".modal-back");
    assert.equal(back.parentNode, fs, "im Element im Vollbild – sonst wäre der Dialog nicht zu sehen");
    assert.ok(!fs.hasAttribute("inert") && app.hasAttribute("inert"));
    cycle(back, 4);
    D.press("Escape");
  } finally { document.fullscreenElement = undefined; fs.remove(); }
  assert.deepEqual(inertNow(), []);
  const d = modal({ title: "Normal", body: h("p", { text: "Text" }) });
  assert.equal(document.querySelector(".modal-back").parentNode, document.body);
  d.close();
});

test("keepTab ohne Ebene (Felder im Präsentationsmodus): hält Tab im Feld, dazwischen bleibt es beim Browser", () => {
  page();
  const wrap = h("div", null, h("input", { id: "w1" }), h("button", { type: "button", id: "w2" }, "B"), h("button", { type: "button", id: "w3", hidden: true }, "C"));
  app.append(wrap);
  const ev = (shift) => ({ shiftKey: shift, prevented: false, preventDefault() { this.prevented = true; } });
  document.getElementById("w1").focus();
  let e = ev(false); assert.equal(keepTab(e, wrap), false); assert.equal(e.prevented, false, "dazwischen: der Browser geht weiter");
  document.getElementById("w2").focus();
  e = ev(false); assert.equal(keepTab(e, wrap), true); assert.ok(e.prevented); at(document.getElementById("w1"), "letzter → erster (ausgeblendete zählen nicht)");
  e = ev(true); keepTab(e, wrap); at(document.getElementById("w2"), "erster → letzter");
  document.getElementById("open").focus();
  e = ev(false); keepTab(e, wrap); at(document.getElementById("w1"), "von außerhalb hinein");
  const empty = h("div"); app.append(empty);
  e = ev(false); assert.equal(keepTab(e, empty), true); assert.ok(e.prevented, "ohne Halt: Tab tut nichts (verlässt die Ebene nicht)");
  wrap.remove(); empty.remove();
});

test("Codefolie „Für den Beamer zeigen“: Fokus auf „Schließen“, Tab bleibt dort, die Seite ist inert, Esc schließt und gibt den Fokus zurück", async () => {
  const { opener } = page();
  opener.focus();
  const { showCode } = await import("../../public/presenter.js");
  showCode("K7QM4X", "Gewaltenteilung");
  const cs = document.querySelector(".codeshow"), shut = button(cs, "Schließen");
  assert.equal(cs.getAttribute("aria-modal"), "true");
  at(shut, "Fokus auf „Schließen“ (nicht mehr auf dem Knopf dahinter)");
  assert.deepEqual(inertNow(), ["app"]);
  D.press("Tab"); at(shut); D.press("Tab", { shiftKey: true }); at(shut);
  D.press("Escape");
  assert.ok(!cs.isConnected); at(opener, "zurück auf den Auslöser"); assert.deepEqual(inertNow(), []);
  showCode("K7QM4X", "Gewaltenteilung");
  button(document.querySelector(".codeshow"), "Schließen").click();
  assert.equal($$(".codeshow").length, 0); assert.deepEqual(inertNow(), []);
});

test("Folienfenster als Ebene (ohne Vollbild-Schnittstelle): Tab bleibt im Fenster, Esc beendet die Ebene", async () => {
  page();
  const { slideViewer } = await import("../../public/slideviewer.js");
  const slides = [1, 2, 3].map((n) => ({ n, w: 1920, h: 1080, url: "https://api.test/s/" + n + ".jpg" }));
  const v = slideViewer({ total: 3, fetchSlides: async () => ({ total: 3, slides }), download: async () => {}, image: () => ({}) });
  app.append(v.el);
  const fs = v.el.querySelector(".sv-fs"), stage = v.el.querySelector(".sv-stage");
  fs.focus(); fs.click();
  assert.ok(stage.classList.contains("max"));
  const seen = cycle(stage, 8);
  assert.ok(!seen.includes(fs) && !seen.some((x) => x.classList.contains("sv-dl")), "„Vollbild“ und der Download liegen unter der Ebene");
  cycle(stage, 8, true);
  document.activeElement.blur();
  D.press("Escape");
  assert.ok(!stage.classList.contains("max"), "Esc beendet die Ebene auch ohne Fokus im Fenster");
  at(fs, "Fokus zurück auf „Vollbild“");
  v.destroy();
  assert.deepEqual(inertNow(), []);
});

/* ---------- Prüfung von Nachtrag 25: Fokus wiederfinden ---------- */
/* Liste wie im Materialkasten: je Eintrag ein Textfeld, „Bearbeiten“ und „Löschen“ (nur Symbol, aria-label); paint() zeichnet alle Zeilen neu */
function listPage(names) {
  page();
  const list = h("div", { class: "list", id: "lst" });
  const paint = (ns) => list.replaceChildren(...ns.map((n) => h("div", { class: "item", dataset: { name: n } },
    h("input", { "aria-label": "Notiz " + n }), h("button", { type: "button" }, "Bearbeiten"), h("button", { type: "button", "aria-label": "Löschen" }, "x"))));
  paint(names);
  app.append(h("section", { id: "box" }, h("h2", { text: "Material" }), list, h("button", { type: "button", id: "add" }, "Link hinzufügen")));
  const btn = (n, label) => button(list.querySelector('[data-name="' + n + '"]'), label);
  const rowOf = () => { const r = document.activeElement.closest && document.activeElement.closest(".item"); return r ? r.dataset.name : null; };
  return { list, paint, btn, rowOf };
}
const footBtn = (label) => button($$(".modal")[$$(".modal").length - 1].querySelector("footer"), label);

test("Auslöser neu gezeichnet, während der Dialog offen ist: der Fokus geht auf das neue Element an seinem Platz (nicht auf body)", async () => {
  const L = listPage(["A", "B", "C"]);
  L.btn("B", "Bearbeiten").focus();
  modal({ title: "Link bearbeiten", body: h("input", { id: "t" }), actions: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: () => { L.paint(["A", "B2", "C"]); } }] });
  await settle();
  footBtn("Speichern").click();
  await settle();
  assert.equal(document.activeElement.textContent, "Bearbeiten"); assert.equal(L.rowOf(), "B2", "die neu gezeichnete Zeile an derselben Stelle");
  assert.deepEqual(inertNow(), []);
});

test("Auslöser nach dem Schließen gelöscht (Rückfrage „Löschen“): Fokus auf den ersten Knopf des Eintrags, der jetzt dort steht – nie ein Eingabefeld", async () => {
  const L = listPage(["A", "B", "C"]);
  L.btn("B", "Löschen").focus();
  const ok = confirmDialog("Datei löschen", "„B“ endgültig löschen?", "Löschen", true);
  await settle();
  footBtn("Löschen").click();
  assert.equal(await ok, true);
  at(L.btn("B", "Löschen"), "erst wie bisher zurück auf den Auslöser");
  L.paint(["A", "C"]);   // die Seite löscht und zeichnet die Liste neu
  await D.sleep(0);
  assert.equal(L.rowOf(), "C"); assert.equal(document.activeElement.textContent, "Bearbeiten", "der erste Knopf der Zeile, die nun an der Stelle steht (nicht das Textfeld davor)");
  // den letzten Eintrag gelöscht: die Zeile davor
  L.btn("C", "Löschen").focus();
  const ok2 = confirmDialog("Datei löschen", "„C“ endgültig löschen?", "Löschen", true);
  await settle();
  footBtn("Löschen").click(); await ok2;
  L.paint(["A"]);
  await D.sleep(0);
  assert.equal(L.rowOf(), "A", "die letzte verbliebene Zeile");
  // die ganze Liste leer: erst kurz warten (sie könnte gleich neu kommen), dann der Knopf daneben
  L.btn("A", "Löschen").focus();
  const ok3 = confirmDialog("Datei löschen", "„A“ endgültig löschen?", "Löschen", true);
  await settle();
  footBtn("Löschen").click(); await ok3;
  L.list.replaceChildren(h("p", { text: "Noch nichts hochgeladen." }));
  await D.sleep(0);
  at(document.body, "die Liste ist (noch) leer: kurz warten");
  await D.sleep(1700);
  at(document.getElementById("add"), "danach der Knopf daneben („Link hinzufügen“)");
});

test("Wache nach dem Schließen: sie greift nur, solange die Nutzerin nichts tut, und nie über einen Seitenwechsel hinweg", async () => {
  const L = listPage(["A", "B"]);
  L.btn("B", "Löschen").focus();
  let ok = confirmDialog("Datei löschen", "„B“ löschen?", "Löschen", true);
  await settle();
  footBtn("Löschen").click(); await ok;
  D.press("ArrowDown");   // die Nutzerin handelt selbst (z. B. rollt)
  L.paint(["A"]);
  await D.sleep(0);
  at(document.body, "nach einer eigenen Eingabe setzt die Wache keinen Fokus mehr");
  // Seitenwechsel: render() ersetzt alles in #app – kein Ersatz von einer anderen Seite
  L.paint(["A", "B"]);
  L.btn("B", "Löschen").focus();
  ok = confirmDialog("Sitzung löschen", "Wirklich?", "Löschen", true);
  await settle();
  footBtn("Löschen").click(); await ok;
  app.replaceChildren(h("main", null, h("div", { class: "list" }, h("div", { class: "item" }, h("button", { type: "button", "aria-label": "Löschen" }, "x")))));
  await D.sleep(0);
  at(document.body, "neue Seite: der Fokus bleibt, wo die Seite ihn hinsetzt");
});

test("Dialog A öffnet B und schließt sich: nach B geht der Fokus an den Auslöser von A", async () => {
  const { opener } = page();
  opener.focus();
  modal({ title: "A", body: h("p", { text: "a" }), actions: [{ label: "Weiter", class: "primary", onClick: () => { modal({ title: "B", body: h("p", { text: "b" }), actions: [{ label: "Fertig", class: "primary" }] }); } }] });
  await settle();
  footBtn("Weiter").click();
  await settle();
  assert.equal($$(".modal").length, 1); assert.equal(document.querySelector(".modal h2").textContent, "B");
  D.press("Escape");
  at(opener, "der Auslöser von A (der Knopf „Weiter“ ist mit A verschwunden)");
  assert.deepEqual(inertNow(), []);
});

test("im offenen Dialog: gesperrter Knopf (busy) bekommt den Fokus zurück, sobald er wieder bedienbar ist; neu gezeichnete Knöpfe ebenso – nicht nach blur() oder einem Mausklick", async () => {
  page();
  const nav = h("div", { id: "nav" });
  let k = 1;
  const paint = () => nav.replaceChildren(h("button", { type: "button" }, "zurück"), h("span", { text: "Seite " + k }), h("button", { type: "button", onclick: () => { k++; paint(); } }, "weiter"));
  paint();
  const dlg = modal({ title: "Text", body: nav, actions: [{ label: "Prüfen", class: "primary", onClick: (e) => { e.currentTarget.disabled = true; return false; } }] });
  await settle();
  const check = footBtn("Prüfen");
  check.focus(); check.click();
  await D.sleep(0);
  at(document.body, "gesperrt: Fokus auf body");
  check.disabled = false;
  await D.sleep(0);
  at(check, "wieder bedienbar: der Fokus kommt zurück");
  // neu gezeichnet (Seite weiter): der neue Knopf „weiter“
  button(nav, "weiter").focus(); button(nav, "weiter").click();
  await D.sleep(0);
  at(button(nav, "weiter"), "nach dem Neuzeichnen: das neue „weiter“");
  assert.equal(nav.querySelector("span").textContent, "Seite 2");
  // absichtlich weggenommen (blur): nichts zurückholen, auch wenn danach neu gezeichnet wird
  button(nav, "weiter").blur(); await D.sleep(5);
  paint(); await D.sleep(0);
  at(document.body, "nach blur() bleibt der Fokus auf body");
  // nach einem Mausklick (z. B. Präsentationsmodus): kein Fokus zurück
  const w = button(nav, "weiter");
  D.fire(w, "pointerdown"); w.focus(); w.click();
  await D.sleep(0);
  at(document.body, "nach einem Mausklick: kein Fokus zurück");
  dlg.close();
});

test("Meldungen über einem Dialog: verdecken sie das fokussierte Element, wandern sie an den anderen Rand (ohne Dialog nicht)", async () => {
  const { opener } = page();
  const { toast } = await import("../../public/ui.js");
  const rect = (top, bottom) => () => ({ left: 0, right: 400, top, bottom, width: 400, height: bottom - top, x: 0, y: top });
  // ohne Dialog: Meldung unten, auch wenn sie etwas verdeckt
  opener.getBoundingClientRect = rect(780, 820); toasts.getBoundingClientRect = rect(760, 830);
  opener.focus(); toast("Gespeichert.", "ok");
  assert.ok(!toasts.classList.contains("flip"), "auf der Seite bleibt alles wie bisher");
  toasts.replaceChildren();
  modal({ title: "KI-Begriffshilfe nutzen?", body: h("p", { text: "Text" }), actions: [{ label: "Einwilligen und starten", class: "primary", onClick: () => { toast("Bitte setze zuerst den Haken …", "err"); return false; } }] });
  await settle();
  const go = footBtn("Einwilligen und starten");
  go.getBoundingClientRect = rect(780, 824);
  // unten verdeckt die Meldung den Knopf, oben (flip) nicht
  toasts.getBoundingClientRect = () => (toasts.classList.contains("flip") ? rect(16, 80)() : rect(760, 830)());
  go.focus(); go.click();
  await D.sleep(0);
  assert.ok(toasts.classList.contains("flip"), "die Meldung wandert nach oben – der Knopf bleibt sichtbar");
  // der Fokus wandert nach oben („Schließen“), wo die Meldung jetzt steht: sie wandert wieder nach unten
  const x = button(document.querySelector(".modal"), "Schließen");
  x.getBoundingClientRect = rect(20, 64);
  x.focus();
  assert.ok(!toasts.classList.contains("flip"), "Fokus oben: die Meldung wieder unten");
  D.press("Escape");
  toasts.replaceChildren(); delete toasts.getBoundingClientRect; delete opener.getBoundingClientRect;
});

test("Auslöser während des Dialogs gesperrt (busy() um den Dialog): nach dem Schließen wartet der Fokus auf ihn – kein Ausweichen auf einen anderen Knopf", async () => {
  const L = listPage(["A", "B"]);
  const o = L.btn("B", "Bearbeiten");
  o.focus();
  const ask = confirmDialog("Frage", "Text", "OK");
  o.disabled = true;   // wie busy(): gesperrt, bis die Antwort verarbeitet ist
  await settle();
  footBtn("OK").click(); await ask;
  await D.sleep(0);
  at(document.body, "der Auslöser ist noch gesperrt – kein Ausweichen auf einen anderen Knopf");
  o.disabled = false;
  await D.sleep(0);
  at(o, "wieder bedienbar: der Fokus kommt auf den Auslöser zurück");
});
