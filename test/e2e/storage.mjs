// storage.mjs – End-to-End-Prüfung „Speicher in der Fußzeile der Lehrkraft“ (Nachtrag 30): auf jeder Seite der Lehrkraft (Startseite Gymnasium, Übersicht
// Grundschule, Sitzung beider Schulformen, Einstellungen) steht unten „Speicher: n % belegt“ – der knappere Wert von Dateien (9 GB) und Datenbank (500 MB),
// berechnet vom Server (GET /api/teacher/storage); der Knopf klappt die Einzelheiten auf (Maus und Tastatur, aria-expanded, Fokus bleibt). Ein großer
// Stand nur für diesen Test (page.route): ab 80 % Tinte mit Warnsymbol auf Papier, ab 95 % rot mit „fast voll“ (hell und dunkel). Nie bei Schüler:innen,
// in der Elternansicht oder am Beamergerät (dort auch keine Anfrage). Bildschirmfotos 1366/820/390 px, hell und dunkel, in OUT („speicher-*.png“).
// ctx = {browser, tp (Seite der Lehrkraft, angemeldet), sp (Seite der Schülerin, angemeldet), BASE, T (Fetch mit Anmeldung), ok, OUT, SHOT, gymL, gsL
// (Sitzungen beider Schulformen), horizontalIssues, watch}
import { join } from "node:path";

const NB = " ";
export async function storageE2E({ browser, tp, sp, BASE, T, ok, OUT, SHOT, gymL, gsL, horizontalIssues, watch }) {
  const SF = await import("../../public/storagefoot.js");
  // der Server: Dateien gegen 9 GB, Datenbank (meta.size_after von D1) gegen 500 MB
  const st = await T("GET", "/api/teacher/storage?fresh=1");
  ok(st.status === 200 && st.data.files.limit === 9 * 1024 ** 3 && st.data.db.limit === 500e6 && st.data.files.used > 100000 && st.data.db.used > 100000 && Math.abs(st.data.at - Date.now()) < 60e3,
    "GET /api/teacher/storage: Dateien " + st.data.files.used + " B von 9 GB, Datenbank " + st.data.db.used + " B (D1 meta.size_after) von 500 MB");
  ok((await fetch(BASE + "/api/teacher/storage")).status === 401, "ohne Anmeldung: 401");

  const btn = tp.locator("footer.tfoot #storage-btn"), more = tp.locator("#storage-more"), box = tp.locator("footer.tfoot .sf");
  const reqs = [];
  tp.on("request", (r) => { if (r.url().includes("/api/teacher/storage")) reqs.push(r.url()); });
  // auf jeder Seite der Lehrkraft ganz unten; ein Tab fragt nur einmal (gemerkter Stand)
  for (const [hash, label, ready] of [["#/lk/grundschule", "Übersicht Grundschule", "main h1"], ["#/lk", "Startseite Gymnasium", ".tiles .tile"],
    ["#/lk/s/" + gymL, "Sitzung Gymnasium", "#printcard"], ["#/lk/s/" + gsL, "Sitzung Grundschule", "#gsplan"], ["#/lk/einstellungen", "Einstellungen", "main h1"]]) {
    await tp.goto(BASE + "/" + hash);
    await tp.locator(ready).first().waitFor({ timeout: 20000 });
    await btn.waitFor({ timeout: 15000 });
    const now = (await T("GET", "/api/teacher/storage")).data;
    const text = await tp.locator("#storage-btn .sf-label").textContent();
    const last = await tp.evaluate(() => { const a = document.getElementById("app"); return a.lastElementChild && a.lastElementChild.matches("footer.tfoot"); });
    ok(last && /^Speicher: (unter 1|\d{1,3}) % belegt( – (fast )?voll)?$/.test(text) && text === SF.storageView(now).label && await btn.getAttribute("aria-expanded") === "false" && await more.isHidden(),
      label + ": Fußzeile ganz unten „" + text.replace(/ /g, " ") + "“ (wie vom Server berechnet), zugeklappt");
  }
  ok(reqs.length <= 2, "derselbe Tab fragt für fünf Seiten höchstens zweimal nach dem Speicher (gemerkter Stand, " + reqs.length + "×)");
  // Einzelheiten: Maus klappt auf, beide Werte; Tastatur (Enter, Leertaste) klappt zu und auf, der Fokus bleibt
  await btn.click();
  const vals = (await tp.locator("#storage-more .sf-vals").textContent()).replace(/ /g, " ");
  ok(await btn.getAttribute("aria-expanded") === "true" && await btn.getAttribute("aria-controls") === "storage-more" && await more.isVisible()
    && /^Dateien: [\d,]+( MB)? von 9 GB · Datenbank: [\d,]+ von 500 MB$/.test(vals) && (await tp.locator("#storage-more .sf-expl").textContent()).includes("kostenlosen Angebot von Cloudflare"),
    "Klick: aufgeklappt – „" + vals + "“");
  await btn.focus(); await tp.keyboard.press("Enter");
  const closed = await btn.getAttribute("aria-expanded") === "false" && await more.isHidden();
  await tp.keyboard.press(" ");
  ok(closed && await btn.getAttribute("aria-expanded") === "true" && await more.isVisible() && await btn.evaluate((el) => el === document.activeElement),
    "Tastatur: Enter klappt zu, Leertaste wieder auf, der Fokus bleibt auf dem Knopf");
  const hit = await btn.boundingBox();
  ok(hit && hit.height >= 44, "Knopf mindestens 44 px hoch (" + (hit && Math.round(hit.height)) + ")");

  // großer Stand nur für diesen Test: Hinweis ab 80 %, rot ab 95 % (hell und dunkel)
  const fake = (files, db) => (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, files: { used: files, limit: 9 * 1024 ** 3 }, db: { used: db, limit: 500e6 }, at: Date.now() }) });
  const look = async () => { await tp.mouse.move(2, 2); return btn.evaluate((el) => { const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor, icon: !!el.querySelector(".sf-ico svg path[d^='M12 3.8']"), level: el.closest(".sf").dataset.level }; }); };   // Maus weg vom Knopf (sonst gilt die Hover-Farbe)
  const vp0 = tp.viewportSize();
  const shots = async (name) => {
    for (const [w, hh] of [[1366, 900], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
      await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await tp.waitForTimeout(200);
      await tp.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await tp.waitForTimeout(150);
      await tp.screenshot({ ...SHOT, path: join(OUT, "speicher-" + name + "-" + w + (dark ? "-dunkel" : "") + ".png") });
      if (w < 400 && !dark) { const hi = await horizontalIssues(tp); ok(!hi.issues.length, "„" + name + "“ am Handy (390 px): ohne seitliches Schieben" + (hi.issues.length ? " – " + JSON.stringify(hi.issues).slice(0, 200) : "")); }
    }
    await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  };
  await shots("normal-offen");
  await btn.click(); await shots("normal-zu");
  await tp.route("**/api/teacher/storage*", fake(0.86 * 9 * 1024 ** 3, 40e6));
  await tp.goto(BASE + "/#/lk/s/" + gymL); await tp.reload();   // neu laden: der gemerkte Stand des Tabs gilt nicht mehr
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
  const w1 = await look();
  ok(w1.level === "warn" && (await tp.locator("#storage-btn .sf-label").textContent()) === "Speicher: 86" + NB + "% belegt" && w1.color === "rgb(19, 33, 59)" && w1.bg === "rgb(238, 242, 248)" && w1.icon
    && (await tp.locator("#storage-more .sf-note").textContent()).startsWith("Der Speicher wird knapp.") && (await tp.locator("#storage-more .sf-note").getAttribute("class")).includes("warnc"),
    "86 % (nur im Test): Hinweis – Tinte mit Warnsymbol auf Papier (" + w1.color + " auf " + w1.bg + "), „Der Speicher wird knapp.“");
  await shots("hinweis-offen");
  await tp.unroute("**/api/teacher/storage*");
  await tp.route("**/api/teacher/storage*", fake(1.1 * 1024 ** 3, 481e6));
  await tp.goto(BASE + "/#/lk/grundschule"); await tp.reload();
  await btn.waitFor({ timeout: 15000 });
  await btn.click();
  const d1 = await look();
  await tp.emulateMedia({ colorScheme: "dark" }); await tp.waitForTimeout(200);
  const d2 = await look();
  await tp.emulateMedia({ colorScheme: "light" });
  ok(d1.level === "danger" && (await tp.locator("#storage-btn .sf-label").textContent()) === "Speicher: 96" + NB + "% belegt – fast voll" && d1.color === "rgb(200, 40, 30)" && d1.bg === "rgb(251, 233, 231)"
    && d2.color === "rgb(255, 138, 128)" && d2.bg === "rgb(61, 26, 26)" && (await tp.locator("#storage-more .sf-vals").textContent()) === "Dateien: 1,1 von 9" + NB + "GB · Datenbank: 481 von 500" + NB + "MB"
    && (await tp.locator("#storage-more .sf-note").textContent()).includes("alte Sitzungen oder Einheiten"),
    "Datenbank 96 % (nur im Test): rot mit „fast voll“ (hell " + d1.color + " auf " + d1.bg + ", dunkel " + d2.color + " auf " + d2.bg + "), der knappere Wert zählt");
  await shots("fast-voll-offen");
  await tp.unroute("**/api/teacher/storage*");
  await tp.goto(BASE + "/#/lk"); await tp.reload();
  await btn.waitFor({ timeout: 15000 });
  ok((await tp.locator("#storage-btn .sf-label").textContent()) === SF.storageView((await T("GET", "/api/teacher/storage")).data).label, "ohne Attrappe wieder der echte Stand");

  // nie bei Schüler:innen, Eltern oder am Beamer – und dort auch keine Anfrage nach dem Speicher
  const foreign = [];
  const spy = (p) => p.on("request", (r) => { if (r.url().includes("/api/teacher/storage")) foreign.push(r.url()); });
  spy(sp);
  await sp.goto(BASE + "/#/schueler"); await sp.locator("footer.footer").waitFor({ timeout: 15000 });
  const sNo = await sp.locator("#storage-btn, footer.tfoot").count() === 0 && !(await sp.locator("body").textContent()).includes("Speicher:");
  const pctx = await browser.newContext({ viewport: { width: 820, height: 1180 } }); const pp = await pctx.newPage(); watch(pp, "Eltern (Speicher)"); spy(pp);
  const tok = (await T("POST", "/api/teacher/lessons/" + gsL + "/parent-link", {})).data.token;
  await pp.goto(BASE + "/#/eltern/" + tok); await pp.locator("main.parents h1").first().waitFor({ timeout: 15000 }); await pp.waitForTimeout(500);
  const pNo = await pp.locator("#storage-btn, footer.tfoot").count() === 0 && !(await pp.locator("body").textContent()).includes("Speicher:");
  const bp = await pctx.newPage(); watch(bp, "Beamer (Speicher)"); spy(bp);
  await bp.goto(BASE + "/#/beamer"); await bp.locator(".beamer").first().waitFor({ timeout: 15000 }); await bp.waitForTimeout(500);
  const bNo = await bp.locator("#storage-btn, footer.tfoot").count() === 0;
  ok(sNo && pNo && bNo && !foreign.length, "keine Speicheranzeige bei Schüler:innen (" + sNo + "), in der Elternansicht (" + pNo + ") und am Beamergerät (" + bNo + "); keine Anfrage (" + foreign.length + ")");
  await pctx.close();
}
