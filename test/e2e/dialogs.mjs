// E2E: Dialoge (Nachtrag 25) – der Tastaturfokus bleibt im obersten offenen Dialog. Echte Tastatur in Chromium: Tab vom letzten Halt zum ersten,
// Umschalt+Tab vom ersten zum letzten, nie auf die Seite dahinter (inert); Esc schließt bei zwei Dialogen übereinander nur den oberen; der Fokus geht
// an den Auslöser zurück; ein gesperrter Knopf („Weiter“ während der Prüfung) hält Tab im Dialog; Codefolie und Präsentationsmodus; Schüler:in am
// iPad (Einwilligung KI-Begriffshilfe). Mit shots (DIALOG_SHOTS=1) Bildschirmfotos mit sichtbarem Fokusrahmen: Laptop und iPad hochkant, hell und dunkel.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const seed = (s) => { if (!sessionStorage.getItem("dlg")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("dlg", "1"); } };
/* wo steht der Fokus? root = Selektor des obersten Dialogs (die letzte Fundstelle) */
const where = (p, rootSel) => p.evaluate((sel) => {
  const roots = document.querySelectorAll(sel), root = roots[roots.length - 1], a = document.activeElement;
  const label = !a || a === document.body ? "body" : (a.getAttribute("aria-label") || a.id || a.textContent || a.tagName).trim().slice(0, 100);
  return { inside: !!root && !!a && a !== document.body && root.contains(a), page: !!(a && a.closest("#app")), label };
}, rootSel);
/* n-mal Tab bzw. Umschalt+Tab: jeder Halt im obersten Dialog? */
async function cycle(p, rootSel, n, shift = false) {
  const seen = [];
  let inside = true;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press(shift ? "Shift+Tab" : "Tab");
    const w = await where(p, rootSel);
    if (!w.inside || w.page) inside = false;
    seen.push(w.label);
  }
  return { inside, seen, kinds: new Set(seen).size };
}
const inertState = (p) => p.evaluate(() => ({ app: document.getElementById("app").hasAttribute("inert"), toasts: document.getElementById("toasts").hasAttribute("inert"),
  all: [...document.querySelectorAll("[inert]")].map((x) => x.id || x.className) }));

export async function dialogsE2E({ browser, devices, BASE, tStore, sStore, lessonId, ok, OUT, watch, shots }) {
  /* ---------- Lehrkraft am Laptop: „Link hinzufügen“ ---------- */
  const tctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await tctx.addInitScript(seed, tStore);
  const p = await tctx.newPage(); watch(p, "Dialoge Lehrkraft");
  await p.goto(BASE + "/#/lk/s/" + lessonId);
  const opener = p.getByRole("button", { name: "Link hinzufügen" }).first();
  await opener.waitFor({ timeout: 20000 });
  await opener.evaluate((b) => { b.dataset.e2eOpener = "1"; });
  await opener.click();
  const lm = p.locator(".modal", { hasText: "Internetadresse" });
  await lm.waitFor();
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "lk-t", null, { timeout: 5000 }).catch(() => {});
  let st = await inertState(p), w = await where(p, ".modal-back");
  ok(w.label === "lk-t" && st.app && !st.toasts && st.all.length === 1, "Lehrkraft: Dialog „Link hinzufügen“ – Fokus im ersten Feld, die Seite dahinter inert, die Meldungen (Toasts) nicht");
  await lm.getByRole("button", { name: "Hinzufügen", exact: true }).focus();
  await p.keyboard.press("Tab");
  const wrapped = await where(p, ".modal-back");
  await p.keyboard.press("Shift+Tab");
  const back = await where(p, ".modal-back");
  ok(wrapped.inside && wrapped.label === "Schließen" && back.inside && back.label === "Hinzufügen", "Tab vom letzten Knopf („Hinzufügen“) springt zum ersten („Schließen“), Umschalt+Tab zurück zum letzten");
  let c = await cycle(p, ".modal-back", 12), cb = await cycle(p, ".modal-back", 12, true);
  ok(c.inside && cb.inside && c.kinds === 5 && cb.kinds === 5, "zwölfmal Tab und zwölfmal Umschalt+Tab: immer im Dialog, im Kreis über alle fünf Halte (" + c.seen.slice(0, 5).join(" → ") + ")");
  if (shots) { mkdirSync(shots, { recursive: true }); await lm.getByRole("button", { name: "Abbrechen" }).focus(); await p.keyboard.press("Tab"); }

  /* ---------- zwei Dialoge übereinander: Esc schließt nur den oberen ---------- */
  await p.locator("#lk-u").focus();
  await p.evaluate(() => { import("/ui.js").then((m) => { window.__e2eAsk = m.confirmDialog("Zweite Rückfrage", "Diese Rückfrage liegt über dem Dialog „Link hinzufügen“.", "Ja"); }); });
  await p.waitForFunction(() => document.querySelectorAll(".modal").length === 2);
  await p.waitForTimeout(100);
  const two = await p.evaluate(() => { const b = document.querySelectorAll(".modal-back"); return { lower: b[0].hasAttribute("inert"), upper: b[1].hasAttribute("inert"), app: document.getElementById("app").hasAttribute("inert") }; });
  c = await cycle(p, ".modal-back", 7); cb = await cycle(p, ".modal-back", 7, true);
  ok(two.lower && !two.upper && two.app && c.inside && cb.inside && c.kinds === 3, "übereinander: nur der obere Dialog ist bedienbar (der untere und die Seite inert), Tab und Umschalt+Tab bleiben im oberen");
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.querySelectorAll(".modal").length === 1);
  const after1 = await p.evaluate(() => ({ id: document.activeElement.id, title: document.querySelector(".modal h2").textContent, inert: document.querySelector(".modal-back").hasAttribute("inert") }));
  ok(after1.title === "Link hinzufügen" && after1.id === "lk-u" && !after1.inert && await p.evaluate(() => window.__e2eAsk) === false,
    "Esc schließt nur die obere Rückfrage (Antwort „nein“) – der Fokus steht wieder im Feld „Internetadresse“, aus dem sie geöffnet wurde");
  await p.keyboard.press("Escape");
  await lm.waitFor({ state: "detached" });
  st = await inertState(p);
  ok(await p.evaluate(() => document.activeElement.dataset.e2eOpener === "1") && st.all.length === 0, "das zweite Esc schließt „Link hinzufügen“ – Fokus zurück auf den Knopf „Link hinzufügen“, nichts bleibt inert");

  /* ---------- Codefolie „Für den Beamer zeigen“ ---------- */
  await p.getByRole("button", { name: "Für den Beamer zeigen" }).focus();
  await p.keyboard.press("Enter");
  await p.locator(".codeshow").waitFor();
  w = await where(p, ".codeshow"); st = await inertState(p);
  c = await cycle(p, ".codeshow", 3); cb = await cycle(p, ".codeshow", 2, true);
  ok(w.inside && w.label === "Schließen" && st.app && c.inside && cb.inside && c.kinds === 1, "Codefolie: Fokus auf „Schließen“ (nicht mehr auf dem Knopf dahinter), Tab bleibt dort, die Seite ist inert");
  if (shots) await p.screenshot({ path: join(shots, "codefolie-laptop-hell.png") });
  await p.keyboard.press("Escape");
  await p.locator(".codeshow").waitFor({ state: "detached" });
  await p.waitForFunction(() => !document.fullscreenElement).catch(() => {});
  ok((await where(p, "#app")).label === "Für den Beamer zeigen" && (await inertState(p)).all.length === 0, "Esc schließt die Codefolie – Fokus zurück auf „Für den Beamer zeigen“, nichts bleibt inert");

  /* ---------- Präsentationsmodus ---------- */
  await p.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
  await p.locator(".presenter").waitFor();
  await p.waitForTimeout(300);
  st = await inertState(p);
  await p.keyboard.press("Shift+Tab");
  const last = await where(p, ".presenter");
  const nStops = await p.evaluate(async () => (await import("/ui.js")).tabbables(document.querySelector(".presenter")).length);
  c = await cycle(p, ".presenter", nStops + 2); cb = await cycle(p, ".presenter", nStops + 2, true);
  ok(st.app && last.inside && c.inside && cb.inside && c.kinds === nStops, "Präsentationsmodus: Umschalt+Tab vom Anfang springt ans Ende der Leiste, Tab läuft im Kreis über alle " + nStops + " Halte – nie auf die Seite dahinter (inert)");
  await p.keyboard.press("t");
  await p.locator(".presenter .tmc").waitFor();
  c = await cycle(p, ".presenter .tmc", 16);
  await p.keyboard.press("Escape");
  ok(c.inside && await p.locator(".presenter .tmc").isHidden() && await p.evaluate(() => document.activeElement.classList.contains("tmbtn")), "Feld „Timer“ darin: Tab bleibt im Feld (wie bisher), Esc schließt nur das Feld – Fokus auf „Timer“");
  await p.locator(".presenter").getByRole("button", { name: "Schließen", exact: true }).click();
  await p.locator(".presenter").waitFor({ state: "detached" });
  ok((await inertState(p)).all.length === 0 && (await where(p, "#app")).label === "Ich bin im Unterricht und starte die Präsentation für alle.", "Präsentationsmodus geschlossen: nichts bleibt inert, Fokus zurück auf dem Start-Knopf");

  /* ---------- gesperrter Knopf: „Weiter“ wird während der Prüfung gesperrt, Tab bleibt im Dialog ---------- */
  await p.goto(BASE + "/#/lk/einstellungen");
  const resetBtn = p.getByRole("button", { name: "Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen" });
  await resetBtn.waitFor({ timeout: 20000 });
  await resetBtn.click();
  const pm = p.locator(".modal", { hasText: "Zurücksetzen: Passwort bestätigen" });
  await pm.waitFor();
  // die Prüfung hängt (Anfrage angehalten) – es wird kein Passwort geprüft und kein Versuch verbraucht
  let release = null;
  const held = new Promise((r) => { release = r; });
  await p.route("**/api/teacher/me", async (route) => { await held; await route.abort().catch(() => {}); });
  await pm.locator("#rs-pw").fill("nur-fuer-den-test");
  await pm.getByRole("button", { name: "Weiter" }).focus();
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => { const b = [...document.querySelectorAll(".modal footer button")].find((x) => x.textContent === "Weiter"); return !!b && b.disabled; });
  const blurred = await where(p, ".modal-back");
  await p.keyboard.press("Tab");
  const t1 = await where(p, ".modal-back");
  await p.keyboard.press("Shift+Tab");
  const t2 = await where(p, ".modal-back");
  ok((blurred.inside || blurred.label === "body") && t1.inside && t1.label === "Schließen" && t2.inside && t2.label === "Abbrechen",
    "gesperrter Knopf: „Weiter“ wird während der Prüfung gesperrt (Fokus " + blurred.label + ") – Tab geht zum ersten Halt im Dialog, Umschalt+Tab zum letzten bedienbaren („Abbrechen“)");
  await p.keyboard.press("Escape");
  await pm.waitFor({ state: "detached" });
  release(); await p.waitForTimeout(300); await p.unroute("**/api/teacher/me");
  ok(await p.locator(".modal").count() === 0 && (await inertState(p)).all.length === 0 && (await where(p, "#app")).label === "Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen",
    "Esc schließt den Dialog trotz laufender Prüfung (nichts gelöscht, kein weiterer Dialog), Fokus zurück auf den Knopf, nichts bleibt inert");

  if (shots) {
    // Bildschirmfotos mit sichtbarem Fokusrahmen (per Tastatur): Laptop und iPad hochkant, hell und dunkel
    for (const [dev, opt] of [["laptop", { viewport: { width: 1440, height: 950 } }], ["ipad-hochkant", { ...devices["iPad (gen 7)"] }]]) for (const dark of [false, true]) {
      const ctx = await browser.newContext({ ...opt, colorScheme: dark ? "dark" : "light" });
      await ctx.addInitScript(seed, tStore);
      const q = await ctx.newPage(); watch(q, "Dialoge Bildschirmfoto");
      await q.goto(BASE + "/#/lk/s/" + lessonId);
      const o = q.getByRole("button", { name: "Link hinzufügen" }).first(); await o.waitFor({ timeout: 20000 });
      await o.focus(); await q.keyboard.press("Enter");
      await q.locator(".modal").waitFor(); await q.waitForTimeout(500);
      for (let i = 0; i < 3; i++) await q.keyboard.press("Tab");
      await q.screenshot({ path: join(shots, "link-hinzufuegen-" + dev + (dark ? "-dunkel" : "-hell") + ".png") });
      await q.keyboard.press("Tab");
      await q.screenshot({ path: join(shots, "link-hinzufuegen-schliessen-" + dev + (dark ? "-dunkel" : "-hell") + ".png") });
      await ctx.close();
    }
  }
  await tctx.close();

  /* ---------- Schüler:in am iPad (mit Tastatur): Einwilligung KI-Begriffshilfe ---------- */
  const sctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
  await sctx.addInitScript(seed, sStore);
  const s = await sctx.newPage(); watch(s, "Dialoge Schüler:in");
  await s.goto(BASE + "/#/schueler/s/" + lessonId);
  await s.locator("main").first().waitFor({ timeout: 15000 });
  await s.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("u.kihelp.")) localStorage.removeItem(k); });
  await s.reload();
  const kiBtn = s.getByRole("button", { name: "KI-Begriffshilfe nutzen" });
  await kiBtn.waitFor({ timeout: 15000 });
  await kiBtn.focus(); await s.keyboard.press("Enter");
  const km = s.locator(".modal", { hasText: "KI-Begriffshilfe nutzen?" });
  await km.waitFor();
  await s.waitForFunction(() => document.activeElement && document.activeElement.id === "ki-ok", null, { timeout: 5000 }).catch(() => {});
  st = await inertState(s); w = await where(s, ".modal-back");
  await km.getByRole("button", { name: "Einwilligen und starten" }).focus();
  await s.keyboard.press("Tab");
  const sw = await where(s, ".modal-back");
  await s.keyboard.press("Shift+Tab");
  const sb = await where(s, ".modal-back");
  c = await cycle(s, ".modal-back", 9); cb = await cycle(s, ".modal-back", 9, true);
  ok(w.label === "ki-ok" && st.app && !st.toasts && sw.label === "Schließen" && sb.label === "Einwilligen und starten" && c.inside && cb.inside && c.kinds === 4,
    "Schüler:in (iPad mit Tastatur): Einwilligung – Fokus auf dem Kästchen, Tab vom letzten Knopf zu „Schließen“, Umschalt+Tab zurück, nie auf die Seite dahinter");
  if (shots) { await km.locator("#ki-ok").focus(); await s.keyboard.press("Tab"); await s.keyboard.press("Shift+Tab"); await s.screenshot({ path: join(shots, "einwilligung-ipad-hochkant-hell.png") }); }
  await s.keyboard.press("Escape");
  await km.waitFor({ state: "detached" });
  ok((await where(s, "#app")).label === "KI-Begriffshilfe nutzen" && (await inertState(s)).all.length === 0 && await s.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith("u.kihelp."))),
    "Esc schließt die Einwilligung ohne Einwilligung – Fokus zurück auf „KI-Begriffshilfe nutzen“, nichts bleibt inert");
  await sctx.close();
}
