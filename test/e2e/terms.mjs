// terms.mjs – End-to-End-Prüfung „Fachbegriffe dieser Sitzung“ (Nachtrag 44, Teil 3; nur Oberstufe): Claude legt über den Connector (lokaler Worker) vier
// Begriffe für die Hauptsitzung (Q2-GK) an (update_lesson fachbegriffe) → get_lesson; Karte auf der Sitzungsseite der Lehrkraft (nach der Hausaufgabe), dort
// bearbeitet; Schüleransicht: vor 2 Minuten vor dem Ende nichts (auch nicht per Schnittstelle), danach ganz unten die Karteikarten – Umdrehen mit Maus und
// Tastatur, 3D-Drehung nur ohne „Bewegung reduzieren“, hell und dunkel, am Handy ohne seitliches Schieben; mit [] gelöscht → kein Bereich mehr. Zum Schluss steht
// die Schülerseite wieder auf „Meine Sitzungen“ (wie vor diesem Schritt).
// Bildschirmfotos in OUT („fachbegriffe-*.png“). Frei erfundene Inhalte.
// ctx = {tp (Lehrkraft, angemeldet), sp (Schüler:in, Sitzung freigeschaltet), BASE, T (Fetch Lehrkraft), SA (Fetch Schüler:in), tool (Connector), ok, OUT, SHOT,
//        lessonId (Hauptsitzung Q2-GK, Dauer 90 min), setWhen(ms) (setzt Datum und Beginn über die Sitzungsseite, → lessonTimes), horizontalIssues}
import { join } from "node:path";

const TERMS = [
  { begriff: "Gewaltenteilung", definition: "Aufteilung der Staatsgewalt auf Gesetzgebung, Regierung und Rechtsprechung, damit sich die Gewalten gegenseitig kontrollieren." },
  { begriff: "Normenkontrolle", definition: "Das Bundesverfassungsgericht prüft, ob ein Gesetz mit dem Grundgesetz vereinbar ist." },
  { begriff: "Verfassungsbeschwerde", definition: "Jede Person kann sich an das Bundesverfassungsgericht wenden, wenn sie sich in ihren Grundrechten verletzt sieht." },
  { begriff: "Judikative", definition: "Die rechtsprechende Gewalt – die unabhängigen Gerichte." },
];

export async function termsE2E({ tp, sp, BASE, T, SA, tool, ok, OUT, SHOT, lessonId, setWhen, horizontalIssues }) {
  // Claude legt die Begriffe an; get_lesson zeigt sie mit dem Zeitpunkt
  let r = await tool("update_lesson", { lesson_id: lessonId, fachbegriffe: TERMS });
  ok(!r.isError && r.content[0].text.includes("Fachbegriffe dieser Sitzung (4): Gewaltenteilung, Normenkontrolle, Verfassungsbeschwerde, Judikative – die Schüler:innen sehen sie ab "),
    "Connector: update_lesson mit fachbegriffe – " + r.content[0].text.slice(0, 160));
  r = await tool("update_lesson", { lesson_id: lessonId, fachbegriffe: TERMS.slice(0, 2) });
  ok(r.isError && r.content[0].text.startsWith("fachbegriffe: Bitte mindestens 3 Fachbegriffe angeben"), "Connector: weniger als 3 Begriffe werden abgelehnt (die Liste bleibt)");
  const g = (await tool("get_lesson", { lesson_id: lessonId })).content[0].text;
  ok(g.includes("## Fachbegriffe dieser Sitzung (Karteikarten für die Schüler:innen, sichtbar ab 2 Minuten vor dem Ende der Sitzung)\n- Gewaltenteilung: Aufteilung der Staatsgewalt"),
    "get_lesson zeigt die Fachbegriffe");

  // Lehrkraft: Karte nach der Hausaufgabe, Liste, Zeitpunkt; bearbeiten und speichern
  // stand die Seite schon auf dieser Sitzung, lädt derselbe Hash nicht neu – der Abgleich beim Zurückkehren in den Tab holt den Stand von Claude
  await tp.goto(BASE + "/#/lk/s/" + lessonId);
  const card = tp.locator("#terms");
  await card.waitFor({ timeout: 15000 });
  await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await card.locator(".terms-item dt").first().waitFor({ timeout: 15000 });
  ok(await tp.evaluate(() => { const hw = document.querySelector("section.card.homework"), t = document.querySelector("#terms"); return !!hw && !!t && hw.nextElementSibling === t; })
    && JSON.stringify(await card.locator(".terms-item dt").allTextContents()) === JSON.stringify(TERMS.map((x) => x.begriff)) && (await card.locator("#terms-h").textContent()) === "Fachbegriffe dieser Sitzung"
    && (await card.locator("#terms-when").textContent()).startsWith("Schüler:innen sehen die Karteikarten ab "),
    "Sitzungsseite: Karte „Fachbegriffe dieser Sitzung“ direkt nach der Hausaufgabe, vier Begriffe, Zeitpunkt für die Schüler:innen");
  await card.locator("#terms-edit").click();
  ok(await tp.evaluate(() => document.activeElement && document.activeElement.classList.contains("terms-t")) && await card.locator(".terms-row").count() === 4, "„Bearbeiten“: je Begriff zwei Felder, Fokus im ersten");
  const def2 = "Das Bundesverfassungsgericht prüft auf Antrag, ob ein Gesetz mit dem Grundgesetz vereinbar ist.";
  await card.locator(".terms-row").nth(1).locator("textarea.terms-d").fill(def2);
  await card.getByRole("button", { name: "Speichern", exact: true }).click();
  await card.locator('.save-state[data-state="ok"]', { hasText: "Gespeichert" }).waitFor({ timeout: 10000 });
  const tl = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.lesson;
  ok(tl.terms.length === 4 && tl.terms[1].definition === def2 && await tp.evaluate(() => document.activeElement && document.activeElement.id === "terms-edit"),
    "von der Lehrkraft geändert und gespeichert, Fokus zurück auf „Bearbeiten“");
  await card.scrollIntoViewIfNeeded(); await card.screenshot({ ...SHOT, path: join(OUT, "fachbegriffe-lehrkraft.png") });

  // Schüler:innen vor der Zeit (die Sitzung endet in etwa 10 Minuten): nichts – auch nicht per Schnittstelle; die Seite kennt den Zeitpunkt
  let t = await setWhen(Date.now() - 80 * 60e3);
  let sv = (await SA("GET", "/api/student/lessons/" + lessonId)).data;
  // keine der Definitionen (auch nicht die geänderte) steht irgendwo in der Antwort – nur die Definitionen: die Begriffe selbst kommen in Material und
  // Feibeitsblättern dieser Sitzung auch sonst vor
  const svTxt = JSON.stringify(sv), leaked = [...TERMS.map((x) => x.definition), def2].filter((x) => svTxt.includes(x));
  ok(sv.terms === null && sv.changesAt.includes(t.termsAt) && !leaked.length, "vor 2 Minuten vor dem Ende: keine Begriffe (Schnittstelle), der Zeitpunkt steht in changesAt" + (leaked.length ? " – gefunden: " + leaked.join(" | ").slice(0, 160) : ""));
  await sp.goto(BASE + "/#/schueler/s/" + lessonId); await sp.reload(); await sp.locator(".live").waitFor(); await sp.waitForTimeout(400);
  ok(await sp.locator("#terms-s").count() === 0, "… und kein Bereich in der Ansicht");
  // ab 2 Minuten vor dem Ende (die Sitzung endet in etwa einer Minute): ganz unten die Karteikarten
  t = await setWhen(Date.now() - 89 * 60e3);
  ok(Date.now() >= t.termsAt, "Sitzung für den Test: Karteikarten-Zeitpunkt vorbei, die Sitzung läuft noch");
  sv = (await SA("GET", "/api/student/lessons/" + lessonId)).data;
  ok(Array.isArray(sv.terms) && sv.terms.length === 4 && sv.terms[1].definition === def2, "ab 2 Minuten vor dem Ende: die Schnittstelle liefert die Begriffe");
  await sp.reload(); await sp.locator("#terms-s button.tcard-btn").first().waitFor({ timeout: 15000 });
  const sec = sp.locator("#terms-s");
  ok(await sp.evaluate(() => { const s = document.querySelector("#terms-s"), m = document.querySelector("main"); return !!s && !!m && m.lastElementChild.contains(s); })
    && (await sec.locator("h2").textContent()) === "Fachbegriffe dieser Sitzung" && await sec.locator("button.tcard-btn").count() === 4,
    "Schüleransicht: Bereich „Fachbegriffe dieser Sitzung“ ganz unten mit vier Karteikarten");
  const btn = (i) => sec.locator("button.tcard-btn").nth(i);
  const geo = await sec.evaluate((el) => [...el.querySelectorAll("li.tcard")].map((li) => li.getBoundingClientRect().height));
  ok(geo.every((hgt) => hgt >= 44) && await btn(0).getAttribute("aria-expanded") === "false" && (await btn(0).textContent()) === "Gewaltenteilung"
    && await sp.locator("#tc-back-1").getAttribute("aria-hidden") === "true", "Karten mindestens 44 px hoch; Knopf mit dem Begriff als Namen, Rückseite aria-hidden");
  await sec.screenshot({ ...SHOT, path: join(OUT, "fachbegriffe-schueler-vorne.png") });
  // Maus: umdrehen (3D, ohne „Bewegung reduzieren“)
  await btn(0).click(); await sp.waitForTimeout(600);
  const flip = await sec.evaluate((el) => { const li = el.querySelector("li.tcard"), inner = li.querySelector(".tcard-in"), back = li.querySelector(".tback"), front = li.querySelector(".tfront");
    return { flipped: li.classList.contains("flipped"), tf: getComputedStyle(inner).transform, back: getComputedStyle(back).visibility, bv: getComputedStyle(front).backfaceVisibility }; });
  ok(flip.flipped && flip.tf !== "none" && flip.bv === "hidden" && await btn(0).getAttribute("aria-expanded") === "true" && await sp.locator("#tc-back-1").getAttribute("aria-hidden") === "false"
    && await sp.locator("#tc-back-1 .tdef").isVisible(), "Klick dreht die Karte (3D: " + flip.tf.slice(0, 30) + "), hinten die Definition, aria-expanded/aria-hidden folgen");
  await sec.screenshot({ ...SHOT, path: join(OUT, "fachbegriffe-schueler-hinten.png") });
  // Tastatur: Enter und Leertaste, der Fokus bleibt
  await btn(1).focus(); await sp.keyboard.press("Enter");
  const k1 = await btn(1).getAttribute("aria-expanded");
  await sp.keyboard.press(" ");
  ok(k1 === "true" && await btn(1).getAttribute("aria-expanded") === "false" && await btn(1).evaluate((el) => el === document.activeElement), "Tastatur: Enter dreht um, Leertaste zurück, der Fokus bleibt auf der Karte");
  // Bewegung reduzieren: keine 3D-Drehung, die Seite wechselt sofort
  await sp.emulateMedia({ reducedMotion: "reduce" });
  await btn(2).click();
  const red = await sec.evaluate((el) => { const li = el.querySelectorAll("li.tcard")[2], inner = li.querySelector(".tcard-in");
    return { tf: getComputedStyle(inner).transform, back: getComputedStyle(li.querySelector(".tback")).visibility, front: getComputedStyle(li.querySelector(".tfront")).visibility }; });
  ok(red.tf === "none" && red.back === "visible" && red.front === "hidden", "Bewegung reduzieren: ohne 3D-Drehung, die Rückseite steht sofort da");
  await sp.emulateMedia({ reducedMotion: "no-preference" });
  // hell und dunkel, iPad und Handy; am Handy ohne seitliches Schieben
  const vp0 = sp.viewportSize();
  for (const [w, hgt] of [[810, 1080], [390, 844]]) for (const dark of [false, true]) {
    await sp.setViewportSize({ width: w, height: hgt }); await sp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sp.waitForTimeout(250);
    await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ ...SHOT, path: join(OUT, "fachbegriffe-schueler-" + w + (dark ? "-dunkel" : "") + ".png") });
    if (w < 400 && !dark) { const hi = (await horizontalIssues(sp)).issues; ok(!hi.length, "Karteikarten am Handy (390 px): ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
    if (dark && w === 810) {
      const c = await sec.evaluate((el) => { const f = el.querySelector(".tfront"), b = el.querySelector(".tback"); return { f: getComputedStyle(f).color, fb: getComputedStyle(f).backgroundColor, b: getComputedStyle(b).color, bb: getComputedStyle(b).backgroundColor }; });
      ok(c.f !== c.fb && c.b !== c.bb && c.bb !== "rgb(255, 255, 255)", "dunkel: Vorder- und Rückseite in den dunklen Farben (" + c.fb + " / " + c.bb + ")");
    }
  }
  await sp.emulateMedia({ colorScheme: "light" }); await sp.setViewportSize(vp0);
  // mit [] gelöscht: kein Bereich mehr (ältere Sitzungen ohne Begriffe sehen genauso aus)
  r = await tool("update_lesson", { lesson_id: lessonId, fachbegriffe: [] });
  ok(!r.isError && r.content[0].text === "Gespeichert. Die „Fachbegriffe dieser Sitzung“ sind gelöscht.", "Connector: [] löscht die Fachbegriffe");
  await sp.reload(); await sp.locator(".live").waitFor(); await sp.waitForTimeout(400);
  ok(await sp.locator("#terms-s").count() === 0 && (await SA("GET", "/api/student/lessons/" + lessonId)).data.terms === null, "ohne Begriffe: kein Bereich in der Schüleransicht");
  // zurück auf „Meine Sitzungen“ (wie vor diesem Schritt): run.mjs öffnet danach wieder diese Sitzung – auf derselben Adresse lüde goto nicht neu, und die
  // Ansicht behielte den Stand von hier (Präsentation noch gesperrt)
  await sp.goto(BASE + "/#/schueler");
  await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).waitFor({ timeout: 15000 });
  return t;
}
