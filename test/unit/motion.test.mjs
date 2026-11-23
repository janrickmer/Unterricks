// Bewegung im Folien-Stil (Nachtrag 40, public/ui.js + public/styles.css): Regeln, die das Gestaltungssystem festlegt – reduzierte Bewegung auch für
// Pseudo-Elemente, kein Blinken über drei Durchläufe, Heben nur mit Maus, jede neue Bewegung nur ohne reduzierte Bewegung; „Folie wechseln“ nur bei einem
// anderen Fach, „Karten legen sich auf“ nur auf Seiten mit data-settle und erst, wenn der Inhalt da ist; die Folge der Anmeldeseiten nur beim ersten Bild.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { installDom } = await import("./fake-dom.mjs");
const D = installDom({ hash: "#/" });
const UI = await import("../../public/ui.js");

const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
const src = (f) => readFileSync(new URL("../../public/" + f, import.meta.url), "utf8");
// Blöcke @media (…) { … } mit ihrem Inhalt (Klammern gezählt)
function mediaBlocks(query) {
  const out = [];
  for (let i = css.indexOf(query); i >= 0; i = css.indexOf(query, i + 1)) {
    const open = css.indexOf("{", i); let depth = 0, j = open;
    for (; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}" && --depth === 0) break; }
    out.push(css.slice(open + 1, j));
  }
  return out;
}

test("reduzierte Bewegung: alles steht still – auch Pseudo-Elemente (Folienecke der Kacheln, Wartezeichen, Abdeckblatt, Marker)", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important; \} \}/);
});

test("kein Blinken über drei Durchläufe (WCAG 2.2.2): der LIVE-Punkt pulsiert dreimal; endlos nur der Drehkreis beim Warten und das Wartezeichen im Chat", () => {
  assert.match(css, /\.badge\.onair \.dot \{ animation: pulse 1\.4s ease-in-out 3; \}/);
  const infinite = [...css.matchAll(/([^{}\n]+)\{[^{}]*animation:[^;{}]*infinite/g)].map((m) => m[1].trim());
  for (const sel of infinite) assert.ok(/\.spin|sv-spin|\.msg\.pending/.test(sel), "endlose Animation nur beim Warten: " + sel);
});

test("Heben nur mit Maus: Kacheln (und der Pfeil im Knopf „Weiter“) bewegen sich beim Zeigen nur in @media (hover: hover) and (pointer: fine)", () => {
  const outside = css.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/g, "");
  assert.ok(!/\.tile:hover \{[^}]*transform/.test(outside) && !/\.tile:hover::after/.test(outside), "kein Heben außerhalb der Maus-Abfrage");
  assert.ok(mediaBlocks("@media (hover: hover) and (pointer: fine)").some((b) => b.includes(".tile:hover {") && b.includes("transform")));
});

test("jede neue Bewegung steht in @media (prefers-reduced-motion: no-preference); nur transform und opacity (keine Verläufe, kein Weichzeichner)", () => {
  const blocks = mediaBlocks("@media (prefers-reduced-motion: no-preference)").join("\n");
  for (const kf of ["folie-kommt", "stift-schreibt", "abdeckblatt", "marker", "rueckt", "karte-legt", "karten", "gleitet", "abdunkeln"]) {
    assert.ok(blocks.includes("@keyframes " + kf + " "), "Bewegung " + kf + " nur ohne reduzierte Bewegung");
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    assert.ok(!new RegExp("animation: " + kf + "\\b").test(outside), kf + " wird nirgends außerhalb gestartet");
  }
  for (const sel of [".login-wrap.play .lfoil-a", ".login-wrap.play .login", "main.settle > :not(.pagehead):nth-child(-n+7)", "main[data-settle] > .pagehead.relay .foils i", ".toast", ".modal-back", ".wk-body.wk-swap"])
    assert.ok(blocks.includes(sel + " {"), sel);
  // „Folie wechseln“ nur auf Übersichtsseiten: Sitzung, Sitzungsraum der Schüler:innen und GS-Sitzung haben auch ein Kopfband mit Fach, bleiben aber ruhig
  const relay = [...css.matchAll(/([^{}\n]*\.relay[^{}]*)\{/g)].map((m) => m[1].trim());
  assert.equal(relay.length, 3, "Bewegung und zwei Verzögerungen");
  for (const r of relay) assert.ok(r.startsWith("main[data-settle] > .pagehead.relay"), "nur unter main[data-settle]: " + r);
  // Staffelung der Karten über --sd: die Kurzform „animation“ setzte eine eigene Verzögerung sonst zurück (höhere Spezifität)
  assert.match(blocks, /main\.settle > :not\(\.pagehead\):nth-child\(-n\+7\) \{ animation: karten \.34s var\(--ease\) var\(--sd, 0s\) backwards; \}/);
  for (const [n, d] of [[3, ".05s"], [4, ".1s"], [5, ".15s"], [6, ".2s"], [7, ".25s"]]) assert.ok(blocks.includes("main.settle > :nth-child(" + n + ") { --sd: " + d + "; }"), "Staffelung " + n);
  assert.ok(!/main\.settle[^{]*\{ animation-delay/.test(blocks), "keine animation-delay-Regel, die die Kurzform überschreiben müsste");
  assert.ok(!/backdrop-filter|filter: blur|linear-gradient\((?!var\(--fach\) 0 0)/.test(blocks), "keine Verläufe oder Weichzeichner in der Bewegung");
  assert.match(blocks, /body:has\(> \.presenter\) \.toast \{ animation: none; \}/, "im Präsentationsmodus gleiten Meldungen nicht");
});

test("die Folge der Anmeldeseiten hält nach dem Ende nichts fest (backwards) und keine Deckkraft – alles ist von Anfang an lesbar", () => {
  const seq = [...css.matchAll(/\.login-wrap\.play [^{]+\{[^}]*animation:[^}]*\}/g)].map((m) => m[0]);
  assert.ok(seq.length >= 8);
  for (const r of seq) if (/animation: \w/.test(r)) assert.ok(/backwards/.test(r), "backwards: " + r);
  const kf = (n) => { const i = css.indexOf("@keyframes " + n + " "); return css.slice(i, css.indexOf("}", css.indexOf("{", i) + 1) + 2); };
  for (const n of ["folie-kommt", "rueckt", "karte-legt", "karten"]) assert.ok(!/opacity/.test(kf(n)), n + " ohne Deckkraft");
});

test("Schriftzug der Startseite: Größe nach der Breite seiner Spalte (Container-Einheiten), nie gestaucht; Abdeckblatt in Ruhe unter dem Wort", () => {
  assert.match(css, /\.start-text \{ container-type: inline-size; width: 100%; min-width: 0; \}/);
  // ohne Mindestgröße in rem: bei 200 % Textgröße wäre sie breiter als eine schmale Spalte (Prüfbefund vom 23.11.2026)
  assert.match(css, /\.wordmark \{[^}]*font-size: 3rem; font-size: min\(16cqi, 6\.6rem\);/);
  assert.match(css, /\.reveal \{[^}]*flex: none; overflow: hidden;/);
  assert.match(css, /\.reveal::after \{[^}]*transform: translateY\(140%\); \}/);
});

test("Markerstrich im Dunkelmodus deckend (nicht per screen über den Folien – sonst 3,2:1 bei schmalen Bildschirmen)", () => {
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \.start-lead \.hl::before \{ background: #6b5a12; mix-blend-mode: normal; \}/);
});

test("„Folie wechseln“: das Kopfband legt sich nur neu auf, wenn sich das Fach gegenüber dem vorigen ändert (nicht beim ersten und nicht beim Neuzeichnen)", () => {
  const root = document.documentElement;
  root.removeAttribute("data-laid");
  assert.ok(!UI.pageHead({ title: "Fächer" }).classList.contains("relay"), "erstes Kopfband: dafür gibt es „Folie auflegen“");
  root.setAttribute("data-laid", "");
  assert.ok(!UI.pageHead({ title: "Fächer" }).classList.contains("relay"), "gleiche Seite neu gezeichnet: nichts");
  assert.ok(UI.pageHead({ title: "PoWi", fach: "powi" }).classList.contains("relay"), "ins Fach: neu auflegen");
  assert.ok(!UI.pageHead({ title: "8B", fach: "powi" }).classList.contains("relay"), "im selben Fach: nichts");
  assert.ok(UI.pageHead({ title: "Ethik", fach: "ethik" }).classList.contains("relay"), "anderes Fach: neu auflegen");
  UI.setFach(null);
  assert.ok(UI.pageHead({ title: "Einstellungen" }).classList.contains("relay"), "zurück ohne Fach: neu auflegen");
});

test("„Karten legen sich auf“: nur mit data-settle, erst wenn der Platzhalter weg ist, einmal je Seitenaufbau", async () => {
  const mk = (settle, kids) => { const m = document.createElement("main"); if (settle) m.setAttribute("data-settle", ""); m.append(...kids); document.getElementById("app").append(m); return m; };
  const skel = () => Object.assign(document.createElement("div"), { className: "skeleton", textContent: "Lade …" });
  const card = () => Object.assign(document.createElement("section"), { className: "card", textContent: "Inhalt" });
  const a = mk(false, [card()]); UI.settleIn(a);
  assert.ok(!a.classList.contains("settle"), "ohne data-settle (Sitzung, Live-Fenster …) bewegt sich nichts");
  const b = mk(true, [card()]); UI.settleIn(b);
  assert.ok(b.classList.contains("settle"), "Inhalt schon da: sofort");
  const c = mk(true, [skel()]); UI.settleIn(c);
  assert.ok(!c.classList.contains("settle"), "solange geladen wird: noch nicht");
  c.replaceChildren(card(), card()); await D.sleep(5);
  assert.ok(c.classList.contains("settle"), "sobald der Inhalt da ist");
  c.classList.remove("settle"); c.replaceChildren(card()); await D.sleep(5);
  assert.ok(!c.classList.contains("settle"), "späteres Neuzeichnen (z. B. nach dem Speichern) bewegt sich nicht");
  for (const m of [a, b, c]) m.remove();
});

test("opt-in je Seite: data-settle auf den Übersichtsseiten, nie auf Sitzung, Live-Fenster, Präsentation, Beamer, Escape-Room oder Elternansicht", () => {
  for (const [f, n] of [["teacher.js", 4], ["units.js", 1], ["bases.js", 3], ["grundschule.js", 2], ["app.js", 1]])
    assert.equal((src(f).match(/"data-settle": ""/g) || []).length, n, f);
  for (const f of ["session.js", "gssession.js", "presenter.js", "beamer.js", "escape.js", "parents.js", "inclass.js", "slideviewer.js", "selbstlernview.js"])
    assert.ok(!src(f).includes("data-settle"), f + " bleibt ruhig");
  assert.ok(/const main = h\("main", \{ class: "narrow" \}, h\("div", \{ class: "skeleton", text: "Lade die Sitzung …" \}\)\);/.test(src("app.js")), "Sitzungsraum der Schüler:innen ohne data-settle");
});

test("Anmeldeseiten: die Folge nur beim ersten Bild nach dem Laden (firstLay), danach data-laid; Folien als eigene Elemente, keine in der Karte", async () => {
  const root = document.documentElement;
  root.removeAttribute("data-laid"); UI.firstLay.timer = null;
  assert.equal(UI.firstLay(), true);
  assert.equal(UI.firstLay(), true, "noch vor dem Ende der Folge: dieselbe Folge (z. B. zweimal gezeichnet)");
  root.setAttribute("data-laid", "");
  assert.equal(UI.firstLay(), false, "danach nie wieder (Abmelden, nach 90 Minuten erneut anmelden)");
  const foils = UI.loginFoils("a", "b");
  assert.deepEqual(foils.map((f) => [f.className, f.getAttribute("aria-hidden")]), [["lfoil lfoil-a", "true"], ["lfoil lfoil-b", "true"]]);
  const m = UI.logoMark();
  assert.equal(m.getAttribute("aria-hidden"), "true");
  assert.deepEqual([...m.querySelectorAll("path")].map((p) => [p.getAttribute("class"), p.getAttribute("pathLength")]), [["u1", "1"], ["u2", "1"]]);
  assert.ok(!/\.login::before|\.login-wrap::before|\.login-wrap::after/.test(css), "keine Folien mehr als Pseudo-Elemente der Karte bzw. Seite");
  assert.ok(src("teacher.js").includes('h("div", { class: "login-pile" }, ...loginFoils("b"))'), "Lehrkräfte: violette Folie hinter der Karte");
  assert.ok(src("teacher.js").includes('pile.replaceWith(h("p", { class: "err", text: e.message }))') && !/pile\.append\(h\("p"/.test(src("teacher.js")),
    "ohne Antwort des Servers ersetzt die Meldung den Stapel – sonst läge sie auf der violetten Folie (zu wenig Kontrast)");
});
