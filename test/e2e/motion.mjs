// motion.mjs – End-to-End-Prüfung von Nachtrag 40: Bewegung im Folien-Stil. Startseite der Schüler:innen (Schriftzug, Satz, drei Schritte, Karte) und
// Anmeldung der Lehrkräfte: Folge „Folien auflegen“ nur beim ersten Bild, Inhalte von Anfang an lesbar, mit reduzierter Bewegung steht alles still;
// über alle Breiten von 320 bis 2000px kein abgeschnittener, verdeckter oder überlappender Text (der Schriftzug ragte im Entwurf zwischen 910 und 1070px
// in die Anmeldekarte). In der App: „Folie wechseln“ nur bei einem anderen Fach, „Karten legen sich auf“ nur auf Seiten mit data-settle, geblätterte Woche,
// Meldungen. ctx = {browser, BASE, tp (Lehrkraft, angemeldet), ok, OUT, SHOT}
import { join } from "node:path";

// Text abgeschnitten (außerhalb eines Vorfahren, der Überlauf abschneidet, oder des Fensters), verdeckt (an drei Stellen der Zeile liegt etwas anderes
// obenauf) oder Text über Text; seitliches Schieben. Läuft in der Seite (page.evaluate).
export const TEXT_CHECK = () => {
  const res = [], root = document.getElementById("app") || document.body;
  if (document.documentElement.scrollWidth > innerWidth + 1) res.push("Seite schiebt seitlich (" + (document.documentElement.scrollWidth - innerWidth) + " px)");
  const name = (el) => (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].join(".") : "") || el.tagName;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const items = [];
  for (let n; (n = tw.nextNode());) {
    const el = n.parentElement;
    if (getComputedStyle(el).visibility === "hidden" || el.closest("[hidden], .sr-only")) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) items.push({ el, r, t: n.nodeValue.trim().slice(0, 24) });
  }
  for (const { el, r, t } of items) {
    for (let a = el; a && a !== document.documentElement && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const b = a.getBoundingClientRect(), bl = parseFloat(s.borderLeftWidth), br = parseFloat(s.borderRightWidth), bt = parseFloat(s.borderTopWidth), bb = parseFloat(s.borderBottomWidth);
      if (r.left < b.left + bl - 1 || r.right > b.right - br + 1 || r.top < b.top + bt - 1 || r.bottom > b.bottom - bb + 1) { res.push("abgeschnitten: „" + t + "“ in " + name(a)); break; }
    }
    if (r.left < -1 || r.right > innerWidth + 1) res.push("außerhalb des Fensters: „" + t + "“");
    const y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight) continue;
    for (const x of [r.left + Math.min(3, r.width / 3), r.left + r.width / 2, r.right - Math.min(3, r.width / 3)]) {
      const top = document.elementFromPoint(x, y);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) { res.push("verdeckt: „" + t + "“ (" + name(el) + ") von " + name(top)); break; }
    }
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    if (A.el === B.el) continue;
    const ox = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left), oy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
    if (ox > 2 && oy > 2) res.push("Text über Text: „" + A.t + "“ × „" + B.t + "“");
  }
  return res;
};

export async function motionE2E({ browser, BASE, tp, ok, OUT, SHOT }) {
  const LEAD = "Präsentation, Material und Hausaufgabe deiner Stunde – an einem Ort.";
  /* ---------- Startseite: Aufbau, Folge beim ersten Bild, lesbar von Anfang an ---------- */
  const sctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const sp = await sctx.newPage();
  await sp.goto(BASE + "/"); await sp.locator("#spw").waitFor();
  const early = await sp.evaluate(() => ({
    play: document.querySelector(".login-wrap").classList.contains("play"),
    anims: [...new Set(document.getAnimations().map((a) => a.animationName))].sort(),
    opac: [".start-lead", ".login", ".start-steps li", ".wordmark"].map((s) => getComputedStyle(document.querySelector(s)).opacity),
    foilInCard: !!document.querySelector(".login .lfoil"),
  }));
  ok(early.play && ["abdeckblatt", "folie-kommt", "karte-legt", "marker", "rueckt", "stift-schreibt"].every((n) => early.anims.includes(n)),
    "Startseite: beim ersten Bild legen sich die Folien auf (Folien, Stift, Abdeckblatt, Marker, Schritte, Karte) – " + early.anims.join(", "));
  ok(early.opac.every((o) => o === "1") && !early.foilInCard, "Startseite: Satz, Karte, Schritte und Schriftzug sind von Anfang an lesbar (keine Deckkraft-Animation), keine Folie in der Karte");
  ok(await sp.locator("h1", { hasText: "Unterricks" }).count() === 1 && (await sp.locator(".start-lead").textContent()) === LEAD
    && JSON.stringify(await sp.locator(".start-steps li").allTextContents()) === JSON.stringify(["1Passwort", "2Fach und Klasse", "3Sitzungscode"])
    && await sp.getByRole("heading", { name: "Anmelden" }).isVisible() && (await sp.locator("#spw-h").textContent()) === "Das Passwort bekommst du von deiner Lehrkraft."
    && (await sp.locator("#spw").getAttribute("aria-describedby")) === "spw-h" && await sp.getByRole("button", { name: "Weiter" }).isVisible(),
    "Startseite: Schriftzug als h1, Satz mit Markerstrich, drei Schritte, Karte „Anmelden“ mit Hinweis (am Feld) und „Weiter“");
  ok(await sp.evaluate(() => document.activeElement && document.activeElement.id === "spw"), "Startseite: der Fokus steht trotz der Bewegung im Passwortfeld");
  await sp.waitForFunction(() => document.documentElement.hasAttribute("data-laid") && !document.getAnimations().length, null, { timeout: 5000 });
  ok(true, "Startseite: nach rund 1,5 s ist alles still (data-laid gesetzt)");
  await sp.screenshot({ ...SHOT, path: join(OUT, "nr40-start-1366.png") });
  // „Weiter“ ohne Passwort-Prüfung: nur die Folge selbst wird nicht wiederholt, wenn die Seite neu gezeichnet wird
  await sp.evaluate(() => { location.hash = "#/schueler"; }); await sp.locator("#spw").waitFor();
  ok(!(await sp.locator(".login-wrap").getAttribute("class")).includes("play"), "Startseite erneut gezeichnet (ohne Neuladen): keine zweite Folge");
  /* ---------- reduzierte Bewegung: nichts bewegt sich, auch keine Pseudo-Elemente ---------- */
  const rctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, reducedMotion: "reduce" });
  const rp = await rctx.newPage();
  await rp.goto(BASE + "/"); await rp.locator("#spw").waitFor();
  const calm = await rp.evaluate(() => ({ n: document.getAnimations().length, reveal: getComputedStyle(document.querySelector(".reveal"), "::after").animationName,
    hl: getComputedStyle(document.querySelector(".start-lead .hl"), "::before").animationName, card: getComputedStyle(document.querySelector(".login")).animationName }));
  ok(calm.n === 0 && calm.reveal === "none" && calm.hl === "none" && calm.card === "none", "reduzierte Bewegung: Startseite steht sofort still, auch Abdeckblatt und Marker (Pseudo-Elemente) – " + JSON.stringify(calm));
  /* ---------- alle Breiten: kein abgeschnittener, verdeckter oder überlappender Text ---------- */
  for (const [label, hash, ready] of [["Startseite", "/", "#spw"], ["Anmeldung der Lehrkräfte", "/#/lehrkraft", "#tu"]]) {
    await rp.goto(BASE + hash); await rp.locator(ready).waitFor();
    const bad = new Map();
    for (const hgt of [700, 1100]) for (let w = 320; w <= 2000; w += 20) {
      await rp.setViewportSize({ width: w, height: hgt });
      for (const y of [0, 1]) {
        await rp.evaluate((y) => window.scrollTo(0, y ? document.documentElement.scrollHeight : 0), y);
        for (const m of await rp.evaluate(TEXT_CHECK)) { const k = m.replace(/\(\d+ px\)/, ""); if (!bad.has(k)) bad.set(k, []); bad.get(k).push(w + "×" + hgt); }
      }
    }
    ok(bad.size === 0, label + ": bei allen Breiten von 320 bis 2000px (zwei Höhen, oben und unten) kein abgeschnittener, verdeckter oder überlappender Text, kein seitliches Schieben"
      + (bad.size ? " – " + [...bad].map(([k, v]) => k + " bei " + v.slice(0, 4).join(", ") + (v.length > 4 ? " …" : "")).join(" | ") : ""));
  }
  // der Schriftzug selbst: zwischen 900 und 1100px (zwei Spalten, schmal) mit Abstand zur Karte
  for (const w of [910, 960, 1000, 1070]) {
    await rp.setViewportSize({ width: w, height: 800 }); await rp.goto(BASE + "/"); await rp.locator("#spw").waitFor();
    const gap = await rp.evaluate(() => { const rg = document.createRange(); rg.selectNodeContents(document.querySelector(".reveal")); return Math.round(document.querySelector(".login").getBoundingClientRect().left - rg.getBoundingClientRect().right); });
    ok(gap >= 16, "Startseite " + w + "px: zwischen Schriftzug und Karte " + gap + "px Abstand (mindestens 16)");
  }
  // große Textgröße (200 %, z. B. Bedienungshilfen im Browser): der Schriftzug folgt nur der Spalte und wird auch auf schmalen Bildschirmen nicht abgeschnitten
  for (const w of [320, 360, 400, 768]) {
    await rp.setViewportSize({ width: w, height: 900 }); await rp.goto(BASE + "/"); await rp.locator("#spw").waitFor();
    await rp.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const bad = await rp.evaluate(TEXT_CHECK);
    ok(!bad.length, "Startseite " + w + "px bei 200 % Textgröße: „Unterricks“ ganz zu sehen, kein abgeschnittener, verdeckter oder überlappender Text, kein seitliches Schieben" + (bad.length ? " – " + bad.join(" | ") : ""));
  }
  for (const [w, hgt, scheme] of [[820, 1180, "light"], [390, 844, "light"], [390, 844, "dark"], [1366, 860, "dark"]]) {
    await rp.setViewportSize({ width: w, height: hgt }); await rp.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" }); await rp.goto(BASE + "/"); await rp.locator("#spw").waitFor();
    await rp.screenshot({ ...SHOT, path: join(OUT, "nr40-start-" + w + (scheme === "dark" ? "-dunkel" : "") + ".png") });
  }
  await rctx.close(); await sctx.close();
  /* ---------- Anmeldung der Lehrkräfte: dieselbe Folge, Karte kommt nach der Antwort des Servers ---------- */
  const lctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const lp = await lctx.newPage();
  await lp.goto(BASE + "/#/lehrkraft"); await lp.locator("#tu").waitFor();
  const lan = await lp.evaluate(() => ({ play: document.querySelector(".login-wrap").classList.contains("play"), card: getComputedStyle(document.querySelector(".login")).animationName,
    pile: !!document.querySelector(".login-pile > .lfoil-b + .login"), logo: !!document.querySelector(".login .logo svg.umark path.u1"), lehrk: document.querySelector(".login .logo span").textContent }));
  ok(lan.play && lan.card === "karte-legt" && lan.pile && lan.logo && lan.lehrk === "Lehrkräfte", "Anmeldung der Lehrkräfte: Folien legen sich auf, die violette liegt hinter der Karte, der Stift schreibt das U, die Karte legt sich hin");
  await lp.waitForFunction(() => !document.getAnimations().length, null, { timeout: 5000 });
  await lp.screenshot({ ...SHOT, path: join(OUT, "nr40-lehrkraft-1366.png") });
  // ohne Antwort des Servers: die Meldung steht statt des Stapels (früher lag sie auf der violetten Folie, die zu einem Streifen schrumpfte – 2,7:1)
  await lp.route("**/api/teacher/status", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Der Server antwortet gerade nicht.", code: "test" }) }));
  for (const [w, hgt] of [[390, 844], [810, 1080], [1366, 860]]) {
    await lp.setViewportSize({ width: w, height: hgt }); await lp.reload(); await lp.locator(".login-wrap > p.err").waitFor();
    const e = await lp.evaluate(() => ({ pile: document.querySelectorAll(".login-pile, .lfoil-b").length, text: document.querySelector(".login-wrap > p.err").textContent }));
    const bad = await lp.evaluate(TEXT_CHECK);
    ok(e.pile === 0 && e.text === "Der Server antwortet gerade nicht." && !bad.length, "Anmeldung der Lehrkräfte ohne Antwort des Servers (" + w + "px): die Meldung ersetzt den Stapel, keine violette Folie darunter" + (bad.length ? " – " + bad.join(" | ") : ""));
  }
  await lp.screenshot({ ...SHOT, path: join(OUT, "nr40-lehrkraft-fehler-1366.png") });
  await lctx.close();
  /* ---------- in der App: Folie wechseln, Karten legen sich auf, Woche, Meldungen ---------- */
  await tp.goto(BASE + "/#/lk"); await tp.locator(".tiles .tile").first().waitFor();
  ok(await tp.locator("main[data-settle]").count() === 1, "Fächer: die Seite lässt ihre Karten auflegen (data-settle)");
  await tp.getByRole("link", { name: /Politik und Wirtschaft/ }).first().click();
  // nach dem Laden legen sich die Karten der Fachseite auf (main.settle hält gut eine Sekunde)
  const settle = await tp.waitForFunction(() => { const m = location.hash === "#/lk/f/powi" && document.querySelector("main.settle"); if (!m) return null;
    return [...m.children].slice(0, 7).map((c) => { const s = getComputedStyle(c); return c.classList.contains("pagehead") ? "kopf" : s.animationName + " " + s.animationDelay; }); },
  null, { timeout: 4000, polling: 20 }).then((x) => x.jsonValue(), () => null);
  ok(!!settle, "Karten legen sich auf: nach dem Laden der Fachseite (main.settle)");
  // die Staffelung greift wirklich (früher setzte die Kurzform „animation“ die Verzögerungen zurück)
  const delays = ["0s", "0s", "0.05s", "0.1s", "0.15s", "0.2s", "0.25s"];
  ok(!!settle && settle.length >= 3 && settle[0] === "kopf" && settle.slice(1).every((x, i) => x === "karten " + delays[i + 1]),
    "Karten legen sich auf: nacheinander, je 50 ms versetzt (ohne das Kopfband) – " + JSON.stringify(settle));
  ok(await tp.locator("header.pagehead.relay").count() === 1, "Folie wechseln: vom Fach-Überblick ins Fach legt sich die Fachfolie neu auf");
  ok(await tp.evaluate(() => getComputedStyle(document.querySelector(".pagehead.relay .foils i")).animationName) === "auflegen", "… mit der Bewegung „auflegen“");
  await tp.evaluate(() => { document.querySelector("header.pagehead").dataset.alt = "1"; });   // das alte Kopfband erkennen
  await tp.locator(".class-btn").first().click();
  await tp.waitForFunction(() => /^#\/lk\/f\/powi\//.test(location.hash) && document.querySelector("header.pagehead:not([data-alt])"), null, { timeout: 10000 });
  ok(await tp.locator("header.pagehead.relay").count() === 0, "Folie wechseln: innerhalb desselben Fachs (Lerngruppe) legt sich nichts neu auf");
  // die Sitzung hat ein Kopfband mit Fach, bleibt aber ruhig: von „Fächer“ (ohne Fach) in eine Sitzung legt sich nichts neu auf
  await tp.goto(BASE + "/#/lk"); await tp.locator(".tiles .tile").first().waitFor();
  const tok = await tp.evaluate(() => localStorage.getItem("u.ttoken"));
  const lessons = (await (await fetch(BASE + "/api/teacher/lessons", { headers: { Authorization: "Bearer " + tok } })).json()).lessons || [];
  ok(lessons.length > 0, "für die Prüfung der Sitzungsseite gibt es eine Sitzung (" + lessons.length + ")");
  if (lessons.length) {
    await tp.evaluate(() => { document.querySelector("header.pagehead").dataset.alt = "1"; });
    await tp.evaluate((id) => { location.hash = "#/lk/s/" + id; }, lessons[0].id);
    await tp.waitForFunction(() => /^#\/lk\/s\//.test(location.hash) && document.querySelector("header.pagehead:not([data-alt])"), null, { timeout: 10000 });
    const quiet = await tp.evaluate(() => ({ relay: !!document.querySelector("header.pagehead.relay"), settle: !!document.querySelector("main[data-settle]"), foils: [...document.querySelectorAll("header.pagehead .foils i")].map((i) => getComputedStyle(i).animationName),
      anims: document.getAnimations().map((a) => a.animationName).filter((n) => n === "auflegen" || n === "karten") }));
    ok(!quiet.settle && quiet.foils.length > 0 && quiet.foils.every((n) => n === "none") && !quiet.anims.length, "Sitzungsseite: das Kopfband bleibt ruhig, auch wenn sich das Fach ändert – " + JSON.stringify(quiet));
    await tp.goto(BASE + "/#/lk"); await tp.locator(".tiles .tile").first().waitFor();
  }
  await tp.getByRole("button", { name: "Nächste Woche" }).click();
  ok(await tp.locator(".wk-body.wk-swap").count() === 1, "Wochenkalender: die geblätterte Woche blendet ein");
  await tp.getByRole("button", { name: "Zur Woche von heute" }).click();
  const toastAnim = await tp.evaluate(() => { const t = document.createElement("div"); t.className = "toast"; t.textContent = "Probe"; document.getElementById("toasts").append(t); const n = getComputedStyle(t).animationName; t.remove(); return n; });
  ok(toastAnim === "gleitet", "Meldungen gleiten herein");
}
