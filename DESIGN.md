---
name: Unterricks
description: "Unterrichtsplattform einer Lehrkraft: jede Sitzung eine getönte Overhead-Folie – mit Folienstift beschriftet, bis zum Abdeckblatt aufgedeckt."
colors:
  # Leuchtfläche und Tinte (hell)
  ground: "#f2f5fa"
  surface: "#ffffff"
  surface-2: "#e9eef6"
  paper: "#eef2f8"
  text: "#13213b"
  ink: "#13213b"
  muted: "#4d5a73"
  line: "#d5dce8"
  line-ui: "#7d8aa2"
  # Fachfolien und Marke
  blau: "#2557c7"
  violett: "#6a3cc0"
  kupfer: "#b2490c"
  marke: "#16264a"
  blau-t: "#e5ebf8"
  violett-t: "#ede8f7"
  kupfer-t: "#f6e9e2"
  marke-t: "#e8edf7"
  # Markerfolie
  gelb: "#ffd43b"
  gelb-kante: "#e5b80f"
  gelb-t: "#fff5cf"
  # Signale
  rot: "#c8281e"
  rot-tief: "#a81f17"
  rot-t: "#fbe9e7"
  gruen: "#14794a"
  gruen-tief: "#116a40"
  gruen-t: "#e3f2ea"
  # Kennfarbe des Feldes „Druckaufträge für den nächsten Arbeitstag“ (Wunsch der Lehrkraft, nur dort)
  orange: "#e05d00"
  orange-t: "#fff0dc"
  # Unterrichtsfrei (Nachtrag 24): Schraffur aus zwei Tönen mit Kante
  frei-t: "#edf0f5"
  frei-s: "#dce2ec"
  frei-k: "#7d8aa2"
  # Projektionsfläche des Live-Fensters (in beiden Modi gleich)
  stage: "#0b111e"
  stage-text: "#cfd8e6"
  # Timer der Live-Präsentation (Nachtrag 16; liegt auf der Projektionsfläche – in beiden Modi gleich)
  timer: "#13213b"
  timer-bar: "#ffd43b"
  timer-last: "#ff9a45"
  timer-over: "#c8281e"
  timer-pause: "#2b3550"
  # Dunkelmodus: Projektor im abgedunkelten Raum
  ground-dark: "#0b111e"
  surface-dark: "#131b2c"
  surface-2-dark: "#1a2438"
  paper-dark: "#182134"
  text-dark: "#e8edf6"
  muted-dark: "#a6b2c7"
  line-dark: "#26324a"
  line-ui-dark: "#5a6884"
  marke-dark: "#23396a"
  blau-t-dark: "#1a2a4f"
  violett-t-dark: "#261d45"
  kupfer-t-dark: "#3a2216"
  marke-t-dark: "#1c2436"
  gelb-t-dark: "#3a3214"
  rot-t-dark: "#3d1a1a"
  gruen-t-dark: "#12301f"
  orange-dark: "#ff9a45"
  orange-t-dark: "#37230f"
  frei-t-dark: "#182033"
  frei-s-dark: "#232d44"
  frei-k-dark: "#7987a3"
  fach-text-dark: "#c9d3e6"
  blau-text-dark: "#8db0ff"
  violett-text-dark: "#bfa6ff"
  kupfer-text-dark: "#ffa766"
  ok-dark: "#5fd39a"
  err-dark: "#ff8a80"
typography:
  display:
    fontFamily: '"Atkinson Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "clamp(3.5rem, 15vw, 12rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: ".1em"
  code:
    fontFamily: '"Atkinson Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "clamp(2.2rem, 1.6rem + 2.2vw, 3.2rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: ".08em"
    fontFeature: "tnum"
  headline:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "clamp(1.8rem, 1.25rem + 1.9vw, 2.6rem)"
    fontWeight: 800
    lineHeight: 1.18
    letterSpacing: "-.02em"
  title:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.28rem"
    fontWeight: 800
    lineHeight: 1.18
    letterSpacing: "-.01em"
  title-small:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.08rem"
    fontWeight: 700
    lineHeight: 1.18
  body:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: ".95rem"
    fontWeight: 700
  button:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
  chip:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: ".92rem"
    fontWeight: 700
    lineHeight: 1.2
  badge:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: ".82rem"
    fontWeight: 700
    lineHeight: 1.2
  tag:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: ".78rem"
    fontWeight: 800
    lineHeight: 1.2
  hint:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: ".9rem"
    fontWeight: 400
  brand:
    fontFamily: '"Atkinson Next", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "1.2rem"
    fontWeight: 800
    letterSpacing: "-.01em"
  code-input:
    fontFamily: '"Atkinson Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "1.3rem"
    fontWeight: 400
    letterSpacing: ".12em"
rounded:
  radius: "16px"
  radius-s: "10px"
  pill: "999px"
  foil: "20px"
  modal: "18px"
  item: "12px"
  tag: "8px"
  focus: "6px"
spacing:
  container: "1280px"
  container-narrow: "780px"
  sidebar: "360px"
  gutter: "1rem"
  gutter-mobile: ".75rem"
  grid: "1.25rem"
  card-gap: "1.15rem"
  field: ".95rem"
  stack: ".8rem"
  row: ".6rem"
  list: ".55rem"
  chips: ".45rem"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.radius-s}"
    padding: ".6rem 1.05rem"
    height: "44px"
  button-hover:
    backgroundColor: "{colors.surface-2}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#fff"
    typography: "{typography.button}"
    rounded: "{rounded.radius-s}"
    padding: ".6rem 1.05rem"
    height: "44px"
  button-primary-dark:
    backgroundColor: "{colors.text-dark}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
  button-danger:
    textColor: "{colors.rot}"
  button-danger-hover:
    backgroundColor: "{colors.rot-t}"
  button-onair:
    backgroundColor: "{colors.rot}"
    textColor: "#fff"
  button-onair-hover:
    backgroundColor: "{colors.rot-tief}"
  button-small:
    padding: ".35rem .7rem"
    height: "36px"
  button-big:
    rounded: "{rounded.item}"
    padding: ".85rem 1.4rem"
    height: "54px"
  button-on-band:
    backgroundColor: "rgba(10, 16, 30, .22)"
    textColor: "#fff"
  button-on-band-hover:
    backgroundColor: "rgba(10, 16, 30, .34)"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-s}"
    padding: ".6rem .75rem"
    height: "44px"
  input-code:
    typography: "{typography.code-input}"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.radius-s}"
    padding: ".5rem .8rem"
  nav-link-hover:
    backgroundColor: "{colors.surface-2}"
  nav-link-current:
    backgroundColor: "{colors.marke-t}"
    textColor: "{colors.marke}"
  pagehead:
    backgroundColor: "{colors.marke}"
    textColor: "#fff"
    typography: "{typography.headline}"
    padding: "1.5rem 0 1.65rem"
  pagehead-powi:
    backgroundColor: "{colors.blau}"
  pagehead-evrel:
    backgroundColor: "{colors.violett}"
  pagehead-ethik:
    backgroundColor: "{colors.kupfer}"
  chip:
    backgroundColor: "rgba(10, 16, 30, .2)"
    textColor: "#fff"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    padding: ".32rem .8rem"
  chip-strong:
    backgroundColor: "#fff"
    textColor: "{colors.marke}"
  badge:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: ".22rem .62rem"
  badge-ok:
    backgroundColor: "{colors.gruen-t}"
    textColor: "{colors.gruen}"
  badge-stop:
    backgroundColor: "{colors.rot-t}"
    textColor: "{colors.rot}"
  badge-onair:
    backgroundColor: "{colors.rot}"
    textColor: "#fff"
  badge-ink:
    backgroundColor: "{colors.ink}"
    textColor: "#fff"
  badge-hw:
    backgroundColor: "{colors.gelb-t}"
    textColor: "{colors.text}"
  ftag:
    backgroundColor: "{colors.marke}"
    textColor: "#fff"
    typography: "{typography.tag}"
    rounded: "{rounded.tag}"
    padding: ".34rem .5rem"
  ftag-powi:
    backgroundColor: "{colors.blau}"
  ftag-evrel:
    backgroundColor: "{colors.violett}"
  ftag-ethik:
    backgroundColor: "{colors.kupfer}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
    padding: "1.25rem 1.35rem"
  card-mobile:
    padding: "1rem .95rem"
  card-row:
    backgroundColor: "transparent"
    padding: ".75rem .4rem"
  card-row-hover:
    backgroundColor: "{colors.marke-t}"
  list-item:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.item}"
    padding: ".75rem .9rem"
  hauptweg:
    backgroundColor: "{colors.gelb}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "1.25rem 1.35rem"
  hauptweg-button:
    backgroundColor: "{colors.ink}"
    textColor: "#fff"
    rounded: "{rounded.item}"
    padding: ".85rem 1.4rem"
    height: "54px"
  stopfield:
    backgroundColor: "{colors.rot}"
    textColor: "#fff"
    rounded: "{rounded.tag}"
    padding: ".32rem .75rem"
  covered:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.muted}"
    padding: ".7rem 1rem .95rem"
  code-box:
    backgroundColor: "{colors.marke-t}"
    textColor: "{colors.text}"
    typography: "{typography.code}"
    rounded: "{rounded.item}"
    padding: ".9rem .6rem .8rem"
  codeshow:
    backgroundColor: "{colors.marke}"
    textColor: "#fff"
    typography: "{typography.display}"
    padding: "2rem"
  live-idle:
    backgroundColor: "{colors.marke-t}"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
  live-stage:
    backgroundColor: "{colors.stage}"
    textColor: "{colors.stage-text}"
    rounded: "{rounded.radius}"
  tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
    padding: "1.15rem 4.4rem 1.15rem 1.2rem"
  class-btn:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.item}"
    padding: ".7rem .3rem"
    height: "48px"
  class-btn-hover:
    backgroundColor: "{colors.marke-t}"
  class-btn-pressed:
    backgroundColor: "{colors.marke}"
    textColor: "#fff"
  class-btn-course:
    padding: ".7rem .9rem"
    height: "48px"
  course-members:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  notice:
    backgroundColor: "{colors.marke-t}"
    textColor: "{colors.text}"
    rounded: "{rounded.radius-s}"
    padding: ".75rem .95rem"
  notice-warn:
    backgroundColor: "{colors.paper}"
  notice-err:
    backgroundColor: "{colors.rot-t}"
  notice-ok:
    backgroundColor: "{colors.gruen-t}"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "#fff"
    rounded: "{rounded.item}"
    padding: ".75rem 1.05rem"
  toast-err:
    backgroundColor: "{colors.rot-tief}"
  toast-ok:
    backgroundColor: "{colors.gruen-tief}"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.modal}"
---

# Design System: Unterricks

## Overview

**Creative North Star: „Folie & Aufdecken“**

Jede Sitzung ist eine Folie auf dem Overhead-Projektor. Die Seite ist die kühle Leuchtfläche, geschrieben wird mit Folienstift-Tinte, und jedes Fach legt seine getönte Farbfolie über den Kopf der Seite: Blau für Politik und Wirtschaft, Violett für Ev. Religion, Kupfer für Ethik. Die gelbe Markerfolie zeigt den Hauptweg „Stunde mit Claude planen“ bzw. „Einheit mit Claude planen“. Im Verlaufsplan liegt ab dem Zwischenstopp ein Abdeckblatt mit roter Kante – was darunter steht, ist noch nicht aufgedeckt, bleibt aber lesbar. Fach, Kurs und „Stunde n von m“ stehen auf jeder Seite im Kopfband.

Die Gestaltung ist ruhig und lesbar bis in die letzte Reihe eines hellen Klassenraums: eine Schriftfamilie (Atkinson Hyperlegible Next, für Codes ihre Mono-Schwester), Hierarchie allein über Größe und Gewicht, volle Farbe flächig und ohne Verlauf, weiche nach unten versetzte Schatten, Haarlinien statt Kästen in Kästen. Die Arbeitsseiten der Lehrkraft sind dicht und zweispaltig (in der Sitzung: Inhalt links, Sitzungscode und Sitzungsdaten rechts), Schüler:innen-Seiten schmal und einspaltig mit einem eindeutigen nächsten Schritt. Bewegung gibt es nur, wo sich Folien bewegen: „Folie auflegen“ beim ersten Kopfband und „Aufdecken“ am Abdeckblatt.

Verweigert sind graue Lernplattform-Karten mit einem einzigen Blau; falsch wäre eine Oberfläche, die kindlich, unruhig oder kühl-technisch wirkt. Hell- und Dunkelmodus folgen der Geräteeinstellung. Nichts wird von außen geladen – die Schriften liegen unter der SIL Open Font License in `public/fonts`. Kein Schulname, kein Schullogo, keine Schulfarben. Eine bewusst begrenzte Ausnahme ist der Escape-Room (`.er`, Petrol und Ocker, Serifenschrift): Er behält die von der Lehrkraft vorgegebene Gestaltung und gehört nicht zum System (siehe Components).

**Key Characteristics:**
- Leuchtfläche (`--ground`) und Folienstift-Tinte (`--ink`); drei Fachfolien, die sich per multiply mischen.
- Randloses Kopfband in der Fachfarbe mit Brotkrumen, Titel und Chips; „Stunde n von m“ als weißer Chip vorn.
- Gelb ist die Markerfolie des Hauptwegs, Rot steht nur für Zwischenstopp, Live und Fehler, Grün nur für erledigt bzw. gespeichert; Warnungen stehen in Tinte mit Warnsymbol.
- Eine Schriftfamilie in drei Gewichten (400, 700, 800); Codes in Atkinson Mono.
- Flache Flächen, weiche versetzte Schatten, Haarlinien; Symbole als eigene Strichzeichnungen im 24er-Raster.
- Signaturen: Kopfband mit Fachfolie, Hauptweg-Markerfolie, Abdeckblatt am Zwischenstopp, Sitzungscode groß in Mono.

## Colors

Kühle Leuchtfläche, Folienstift-Tinte und drei flächige Fachfolien; Gelb, Rot und Grün sind Signale mit genau einem Auftrag.

### Primary
Die Fachfolien – sie sagen auf jeder Seite, in welchem Fach man ist.
- **Politik-Blau** (`--blau`, #2557c7): Fachfolie für Politik und Wirtschaft – Kopfband, Fach-Schild, Fachkachel, gedrückter Klassenknopf, aktueller Lernschritt im Leupold-Schema. Die helle Tönung `--blau-t` (#e5ebf8) trägt die Flächen in der Seite: Codekasten, Hinweise, Tabellenköpfe, Listen-Hover, das ruhende Live-Fenster.
- **Religions-Violett** (`--violett`, #6a3cc0) mit `--violett-t` (#ede8f7): dieselben Aufgaben für Ev. Religion.
- **Ethik-Kupfer** (`--kupfer`, #b2490c) mit `--kupfer-t` (#f6e9e2): dieselben Aufgaben für Ethik.
- **Marken-Nachtblau** (`--marke`, #16264a) mit `--marke-t` (#e8edf7): das Band auf Seiten ohne Fach (Fächerübersicht, Einstellungen, Planungsgrundlagen, Fachwahl der Schüler:innen) und das Fach-Schild ohne Fach.

Das Attribut `data-fach` an `<html>` (`powi`, `evrel`, `ethik`; gesetzt von `setFach()` bzw. `pageHead({ fach })`) bestimmt die Fachfarbe der Seite. Es setzt drei Variablen: `--fach` (Fläche), `--fach-t` (Tönung) und `--fach-text` (Schrift-, Link- und Fokusfarbe). Ohne `data-fach` gelten `--marke` und `--marke-t`. Die Folie im Kopfband ist `--foil` = `color-mix(in srgb, var(--fach) 36%, #fff)`.

### Secondary
Die Markerfolie – der Hauptweg und, ganz dünn aufgetragen, Aufgaben und Ziele.
- **Markergelb** (`--gelb`, #ffd43b) mit der Kante `--gelb-kante` (#e5b80f): die Markerfolie des Hauptwegs – die Karte „Stunde mit Claude planen“ in der Sitzung und „Planung mit Claude“ mit dem Knopf „Einheit mit Claude planen“ in der Einheit. Auf Gelb steht immer #13213b; Gelb ändert sich im Dunkelmodus nicht.
- **Dünne Markerfolie** (`--gelb-t`, #fff5cf): Aufgabe und Ziel – die Hausaufgabe der Schüler:innen, die zentrale Lernaufgabe im Leupold-Schema, die Vertretungsanleitung für Schüler:innen und das Abzeichen „Hausaufgabe“; Kanten mit `color-mix(in srgb, var(--gelb-kante) 55%, var(--line))`.

### Tertiary
Die Signale – jede Farbe hat genau einen Auftrag.
- **Signalrot** (`--rot`, #c8281e): Zwischenstopp (Reiter, Kante des Abdeckblatts, Abzeichen), Live (Abzeichen „LIVE“, Knopf „Präsentation für alle beenden“) und Fehler (`--err`: Fehlertexte, Fehlerhinweise, Fehler-Toasts und Knöpfe für endgültige Aktionen). Die tiefe Stufe `rot-tief` (#a81f17) trägt den Hover des Live-Knopfs und den Fehler-Toast, die Tönung `--rot-t` (#fbe9e7) Hinweise und Abzeichen.
- **Erledigt-Grün** (`--gruen`, #14794a) als `--ok`: gespeichert, verbunden, festgelegt, aktiv – in Zustandszeilen mit Häkchen. Die tiefe Stufe `gruen-tief` (#116a40) trägt Erfolgs-Toasts und das Erledigt-Abzeichen im Kopfband, die Tönung `--gruen-t` (#e3f2ea) Hinweise und Abzeichen.
- **Druckauftrags-Orange** (`--orange`, #e05d00, mit `--orange-t` #fff0dc; dunkel #ff9a45 und #37230f, dort das Drucker-Symbol in #13213b): ausschließlich das Feld „Druckaufträge für den nächsten Arbeitstag“ auf den beiden Startseiten – ausdrücklicher Wunsch der Lehrkraft („ein orangenes Feld mit einem Drucker als Symbol“). Kennfarbe dieses einen Feldes, keine Warnfarbe; Schrift darauf immer `--text`/`--muted`.
- **Timer-Farben** (`--timer-*`, nur das Band des Timers in der Live-Präsentation und der Knopf „Timer“, Nachtrag 16): läuft #13213b mit weißer Schrift und gelbem Balken (`--gelb`), **letzte Minute** #ff9a45 mit Schrift #13213b (7,6 : 1; Wunsch der Lehrkraft „letzte Minute orange“ – derselbe Ton wie das dunkle Druckauftrags-Orange, aber ein eigener Auftrag), **abgelaufen** Signalrot #c8281e mit weißer Schrift (5,6 : 1), pausiert #2b3550 mit #e8edf6 und grauem Balken (#9fb0cc). Das Band liegt immer auf der Projektionsfläche (dunkel) und ist deshalb hell wie dunkel gleich.
- **Unterrichtsfrei** (`--frei-t` #edf0f5, `--frei-s` #dce2ec, Kante `--frei-k` #7d8aa2; dunkel #182033, #232d44 und #7987a3; Nachtrag 24): die abgedeckte Folie – eine graublaue Schraffur aus zwei Tönen (`repeating-linear-gradient` 135°, 7px) für unterrichtsfreie Tage im Wochenkalender, dazu die Fläche der Schulangabe in den Einstellungen und der ruhige Hinweis „Liegt auf einem unterrichtsfreien Tag“. Keine Signalfarbe, kein Fach; Schrift darauf immer `--text` (mindestens 11 : 1 auf beiden Tönen, hell wie dunkel). Unterrichtsfrei steht nie nur als Fläche da – immer mit Text („Herbstferien – unterrichtsfrei (Gymnasium)“).
- **Warnungen haben keine eigene Farbe.** `--warn` ist `--text`: `.warnc` und `.notice.warn` zeigen Tinte mit dem Warnsymbol (`--ico-alert`, als Maske in Schriftfarbe); der Hinweis liegt auf `--paper`.

### Neutral
Leuchtfläche und Tinte.
- **Leuchtfläche** (`--ground`, #f2f5fa): Seitenhintergrund.
- **Folie** (`--surface`, #ffffff): Karten, Felder, Knöpfe, Kopfleiste.
- **Mattglas** (`--surface-2`, #e9eef6): Hover, neutrales Abzeichen, Ablagezone, Aufgabeneditor, Code-Hintergrund.
- **Papier** (`--paper`, #eef2f8): Abdeckblatt, Warnhinweis, verschachtelte Karten in Listen.
- **Folienstift-Tinte** (`--ink` und `--text`, #13213b): Schrift, Primärknopf, Tinten-Abzeichen, Toast. `--text` wechselt im Dunkelmodus, `--ink` bleibt.
- **Bleistiftgrau** (`--muted`, #4d5a73): Metadaten, Hinweise, Kursmitglieder, abgedeckter Text.
- **Haarlinie** (`--line`, #d5dce8): Trennlinien, Kartenränder, Tabellenzeilen.
- **Bedienkante** (`--line-ui`, #7d8aa2): Ränder von Feldern und Knöpfen (mindestens 3:1 gegen die Fläche, hell wie dunkel).
- **Projektionsfläche** (`stage`, #0b111e, mit Schrift `stage-text`, #cfd8e6 – feste Werte in `.live`): das laufende Live-Fenster der Schüler:innen, in beiden Modi gleich. Der Präsentationsmodus der Lehrkraft liegt auf #000.
- **Notizen der Lehrkraft** (`.notespane`, Nachtrag 20, nur im Präsentationsmodus mit getrenntem Beamerbild): unter der aktuellen Folie, so breit wie sie (auch mit Timer, wenn die Folie unter dem Band schmaler wird), gut ein Drittel der Spaltenhöhe, rollbar; Fläche #141c2e mit Kante `rgba(255, 255, 255, .14)` wie die Vorschau, Kopf „Notizen zu Folie n“ in #9fb0cc (800, Großbuchstaben wie „Als Nächstes“), Stichpunkte #f1f4fa in `clamp(1rem, 1.55vw, 1.4rem)` mit orangen Aufzählungspunkten (#f0a050) – in beiden Modi gleich (der Präsentationsmodus ist immer dunkel). In der Sitzung: Kasten `.notesbox` auf `--surface-2`, je Folie eine Zeile (Vorschaubild 16:9 links, Textfeld rechts; unter 560px untereinander); würde das Speichern ein Feld kürzen, steht darunter ein Hinweis `.warnc` (Warnsymbol + fett in `--warn`, leer ausgeblendet). Die Anmerkungs-PDF: weiß, Kopfzeile grau, Überschrift dunkelblau mit orangem Strich, Stichpunkte mit orangem Punkt.

### Dunkelmodus
„Projektor im abgedunkelten Raum“: Unter `@media (prefers-color-scheme: dark)` gilt `:root:not([data-theme="light"])` – ein `data-theme="light"` an `<html>` erzwänge den hellen Modus; derzeit setzt es kein Skript. Flächen, Linien und Tönungen kehren sich um (die Schlüssel `*-dark` in der Frontmatter), `--marke` hellt zu `marke-dark` auf. Die Fachfarben bleiben als Flächen (Band, Fach-Schild, Kachel), `--fach-text` wird zur hellen Schriftstufe des Fachs (`blau-text-dark`, `violett-text-dark`, `kupfer-text-dark`, ohne Fach `fach-text-dark`); `--ok` wird `ok-dark`, `--err` wird `err-dark`. Primärknopf und Tinten-Abzeichen kehren sich um (`text-dark` mit #13213b; der Primärknopf im Hover #fff), der Rahmen der Vertretung nimmt `--line-ui`. Die Bandfolie ist `color-mix(in srgb, var(--fach) 30%, #c8d0de)` mit Deckkraft .72 (`--foil-op`) und endet an der Bandkante. `theme-color` in `index.html`: #ffffff hell, #131b2c dunkel.

### Named Rules
**Die Fachfolien-Regel.** Die Fachfarbe kommt nur über `data-fach` und die drei Variablen `--fach`, `--fach-t` und `--fach-text` in einen Baustein – nie als fest eingetragener Wert. Fest eingetragen sind die Fachfarben nur dort, wo alle drei Fächer nebeneinander stehen: Fach-Schild, Fachkachel und die drei Folien im Band ohne Fach. Ein Fach erscheint nie als Farbe allein, sondern immer mit Namen oder Kürzel.

**Die Markerfolien-Regel.** Volles Gelb (#ffd43b) ist die Markerfolie des Hauptwegs – „Stunde mit Claude planen“, „Einheit mit Claude planen“ – und sonst nichts. Für Aufgaben und Ziele gibt es nur die dünne Markerfolie `--gelb-t`.

**Die Signal-Regel.** Rot heißt Zwischenstopp, Live oder Fehler; Grün heißt erledigt bzw. gespeichert. Keine der beiden Farben schmückt. Eine Warnfarbe gibt es nicht: Ocker wurde bewusst entfernt, Warnungen stehen in Tinte mit Warnsymbol.

## Typography

**Display Font:** Atkinson Hyperlegible Next, eingebunden als „Atkinson Next“ (variabel, Gewicht 200–800; Rückfall system-ui, -apple-system, „Segoe UI“, Roboto, sans-serif) – für alle Überschriften; nur die größte Stufe, der Beamer-Code, steht in der Mono
**Body Font:** Atkinson Hyperlegible Next (dieselbe Familie, aufrecht und kursiv)
**Label/Mono Font:** Atkinson Hyperlegible Mono, eingebunden als „Atkinson Mono“ (Rückfall ui-monospace, „SF Mono“, Menlo, Consolas, monospace) – nur für Codes, IDs, Tastenkürzel und den Rohtext des Schulportal-Eintrags

**Gedrucktes Material (PDF):** Arbeitsblätter und weiteres Material gestaltet Claude als HTML-Seite; der Server druckt sie mit Chromium (`worker/render.js`). Dieselbe Schrift wie die Oberfläche – Unterricks reicht dem Drucker Atkinson Hyperlegible Next und Mono als eingebettete `@font-face` (Ausweichschrift DejaVu Sans für Griechisch, Hebräisch u. a.). Die Gestaltungsregeln für Claude (`MATERIAL_DESIGN_RULES` in `public/shared.js`): A4 mit 15–18 mm Rand, Kopf mit Name/Klasse/Datum, M1/M2 mit Quelle, Aufgaben mit fettem Operator und AFB, Schreiblinien 8–9 mm (Jg. 5/6: 10–11 mm), ab Jg. 7 11–12 pt (Jg. 5/6 ≥ 13 pt), in Schwarz-Weiß vollständig lesbar, Farbe nur als Akzent.

**Character:** Eine Schrift, die für Lesbarkeit gebaut ist: Ähnliche Zeichen wie 0 und O oder I und l bleiben unterscheidbar, am Beamer wie auf dem iPad, freundlich, ohne kindlich zu wirken. Die Mono-Schwester macht Codes zu Kennungen, die man aus der letzten Reihe abtippen kann.

### Hierarchy
- **Display** (800, min(11cqw, 24cqh) – relativ zur Folie, 1, Sperrung .1em, Mono): der Sitzungscode auf der Codefolie (`.codeslide .c`) – im Vollbild für den Beamer, im Präsentationsmodus und im Live-Fenster.
- **Sitzungscode** (800, clamp(2.2rem, 1.6rem + 2.2vw, 3.2rem), 1.1, Sperrung .08em, Mono, tabellarische Ziffern): `.code-big` im Codekasten der Seitenleiste.
- **Headline** (800, clamp(1.8rem, 1.25rem + 1.9vw, 2.6rem), 1.18, -.02em): `h1`, der Seitentitel im Kopfband, höchstens 34ch breit; auf schmalen Seiten ohne Fach 15ch neben den Folien.
- **Title** (800, 1.28rem, 1.18, -.01em): `h2`, Kartentitel; im Dialog 1.2rem.
- **Title small** (700, 1.08rem, 1.18): `h3`, Unterabschnitte; Klassengruppen in .98rem und `--muted`.
- **Body** (400, 1.0625rem, 1.55): Fließtext; die Hausaufgabe der Schüler:innen in 1.08rem. Unterzeilen im Band höchstens 70ch.
- **Label** (700, .95rem): Feldbeschriftungen, Brotkrumen, Kursmitglieder.
- **Knopf** (700, 1rem, 1.2): klein .92rem, groß 1.1rem; Navigation .98rem.
- **Chip** (700, .92rem, 1.2), **Abzeichen** (700, .82rem, 1.2), **Fach-Schild** (800, .78rem, 1.2).
- **Hinweis** (400, .9rem, `--muted`): Hilfetexte unter Feldern; Metadaten in Listen .88rem, Zustandszeile .86rem in 700.
- **Code-Eingabe** (400, 1.3rem, Sperrung .12em, Mono, Großbuchstaben): das Feld für den Sitzungscode; der Platzhalter steht in Atkinson Next.

### Named Rules
**Die Eine-Familie-Regel.** Eine Familie in drei Gewichten – 400 für Text, 700 für Bedienung und Beschriftung, 800 für Titel und Kennungen. Hierarchie entsteht über Größe und Gewicht, nie über eine zweite Schrift; weite Sperrung (ab .08em) und `text-transform: uppercase` sind Codes vorbehalten.

**Die Kennungs-Regel.** Codes stehen immer in Atkinson Mono und gesperrt (.08–.12em): im Codekasten und am Beamer in 800, in der Code-Eingabe in Großbuchstaben. In Abzeichen und IDs genügt die Mono ohne Sperrung. Zahlen und Zeiten im Text nutzen tabellarische Ziffern (`.num`, `time`).

**Die Letzte-Reihe-Regel.** Jedes Textpaar erreicht mindestens 4,5:1, hell wie dunkel; weiße Schrift im Kopfband liegt auch über der hellsten Folienstelle bei mindestens 6,1:1.

## Layout

**Rahmen.** `main` ist höchstens 1280px breit (`main.narrow` 780px: Schüler:innen-Seiten und Einstellungen), mit 1rem Seitenrand und 1.5rem bzw. 3.5rem Abstand oben und unten. Die Kopfleiste ist sticky, mindestens 62px hoch, ihr Inhalt ebenfalls höchstens 1280px breit. Das Kopfband läuft randlos über die ganze Breite, während sein Inhalt im Raster bleibt: `border-image: linear-gradient(var(--fach) 0 0) fill 0 / / 0 100vmax` malt die Bandfläche 100vmax über den Kasten hinaus, ohne waagerechten Bildlauf; mit `margin: -1.5rem 0 1.9rem` schließt es direkt an die Kopfleiste an.

**Sitzungsseite.** Zwei Spalten, `minmax(0, 1fr) 360px`, Abstand 1.25rem. Links in dieser Reihenfolge: Vertretung (Vorschlag bzw. aktiv), voriger Zwischenstopp, Hauptweg, Unterrichtseinheit, Backup-Chat, Schulportal-Eintrag, Hausaufgabe, Präsentation mit Claude, Material, Präsentation für den Unterricht, Feibeitsblatt. Rechts die Seitenleiste (sticky, `top: 78px`): Sitzungscode, Sitzungsdaten, Krankheitsvertretung. Unter 1000px wird die Seite einspaltig, die Seitenleiste ist dann nicht mehr sticky.

**Rhythmus.** Abstände in rem: Karten folgen mit 1.15rem Abstand (`.card + .card`, Seitenleiste), Stapel (`.stack`) mit .8rem, Felder mit .95rem, Zeilen (`.row`, umbrechend) mit .6rem, freistehende Listenzeilen mit .55rem, Chips mit .45rem. Karten haben innen 1.25rem/1.35rem.

**Auswahlraster.** Fachkacheln `repeat(auto-fill, minmax(230px, 1fr))` mit 1rem Abstand; Klassenknöpfe `minmax(68px, 1fr)` mit .5rem, in der Qualifikationsphase `minmax(96px, 1fr)`; die Kurszeile ist eine umbrechende Flex-Zeile (`gap: .55rem .9rem`).

**Zweispalter in Karten.** Schulportal-Eintrag (Text | Vorschau, `minmax(0, 1fr) minmax(0, 1fr)`, Abstand .9rem) und das Leupold-Schema (`minmax(140px, 1fr) minmax(0, 3fr) minmax(140px, 1fr)`) werden unter 800px einspaltig; die Upload-Zonen stehen nur nebeneinander, wenn jede mindestens 24rem breit sein kann (`repeat(auto-fit, minmax(min(100%, 24rem), 1fr))` – auf dem iPad hochkant untereinander); Sitzungsdaten (`minmax(0, 1fr)` × 2, .7rem) und Stundenfrage | Ablauf (`minmax(0, 1fr) minmax(0, 1.4fr)`) unter 560px.

**Nur senkrecht scrollen (Wunsch der Lehrkraft vom 10.11.2026).** Auf Handy und iPad ragt nichts über den Rand, und kein Bereich scrollt seitlich:
- Rasterspalten immer als `minmax(0, …)` (nie bloß `1fr` – das wächst mit dem breitesten Inhalt), auch implizite Raster (`.list`, `.side`, `.shownbox`, Dialoge) bekommen `grid-template-columns: minmax(0, 1fr)`.
- Auswahllisten sind höchstens so breit wie ihr Platz (`max-width: 100%; min-width: 0`) – ihre längste Option bestimmt sonst die Breite; lange Wörter brechen um (`overflow-wrap: break-word`, in Links, Code und Tabellenzellen `anywhere`, Überschriften mit Silbentrennung).
- Tabellen (Ablauf der Einheit, Planungsgrundlagen) werden bis 960px zu untereinander stehenden Karten: jede Zelle nennt ihre Spalte (`data-label`), `role="table"`/`row`/`cell` halten sie für Screenreader zusammen. Tabellen und Code im Chat brechen um, die Folien-Vorschau bricht in Zeilen um (höchstens 21rem hoch, dann senkrecht scrollbar).
- Bis 400px (iPhone SE) etwas kleinere Schrift: Grundschrift 1rem, `h1` 1.6rem, `h2` 1.16rem, Sitzungscode 2.1rem, Knöpfe mit weniger Innenabstand; der Code der Beamer-Folie mindestens 2.4rem.
- `html { overflow-x: clip }` ist nur das Sicherheitsnetz gegen seitliches Wackeln; der End-to-End-Test prüft je Seite auf iPhone SE, iPhone 13 und iPad, dass nichts übersteht (`test/e2e/mobile-audit.mjs`), und dass kein Textrest wie „null“ sichtbar ist.

**Breakpoints.** 1000px (Sitzungsseite einspaltig), 960px (Tabellen als Karten), 900px (schmale Seiten ohne Fach: Folien schmaler), 800px (Zweispalter in Karten), 560px (Handy), 400px (sehr schmale Handys: kleinere Schrift).

**Mobil (≤ 560px).** Seitenrand .75rem. Die Kopfleiste ist nicht mehr sticky, ihre Navigation bricht in eine eigene Zeile unter der Wortmarke um (`order: 3`, volle Breite, Links in .92rem). Im Band entfällt die letzte Brotkrume (die aktuelle Seite, `.cur`, wiederholt nur den Titel); Brotkrumen .84rem, Chips .86rem. Karten haben innen 1rem/.95rem (bis 400px .95rem/.85rem); Listenzeilen brechen um, ihre Aktionen bekommen eine eigene Zeile.

**Bedienung mit dem Finger.** Knöpfe und Felder sind mindestens 44px hoch, Klassenknöpfe 48px, große Knöpfe 54px; kleine Knöpfe (36px) nur für Nebenaktionen in dichten Zeilen.

### Named Rules
**Die Jetzt-zuerst-Regel.** Schüler:innen-Seiten sind einspaltig (`main.narrow`) und zeigen das Jetzt zuerst: die Vertretungsanleitung, wenn es eine gibt, dann Live-Fenster, Hausaufgabe und Material – ein nächster Schritt statt einer Fläche zum Suchen.

## Elevation & Depth

Flache Flächen mit Folien-Tiefe: Flächen sind flach und voll gefärbt; Tiefe entsteht, wenn Folien übereinanderliegen (multiply) und knapp über der Leuchtfläche schweben – mit weichen, nach unten versetzten Schatten mit negativer Ausbreitung. Es gibt zwei Stufen für Flächen (aufliegend, abgehoben) und drei besondere Schatten: Bandfolie, Abdeckblatt, Dialog. Harte Versatzschatten, Leuchten und Verläufe gibt es nicht.

### Shadow Vocabulary
- **Aufliegend** (`box-shadow: var(--shadow)` = `0 1px 2px rgba(0, 0, 0, .06), 0 8px 22px -12px rgba(0, 0, 0, .24)`; dunkel `0 1px 2px rgba(0, 0, 0, .35), 0 10px 24px -12px rgba(0, 0, 0, .65)`): Karten und Fachkacheln in Ruhe.
- **Abgehoben** (`box-shadow: var(--shadow-lift)` = `0 2px 4px rgba(0, 0, 0, .08), 0 18px 40px -18px rgba(0, 0, 0, .36)`; dunkel `0 2px 4px rgba(0, 0, 0, .4), 0 20px 44px -18px rgba(0, 0, 0, .75)`): Anmeldekarte, Kachel-Hover, laufendes Live-Fenster, Kontextmenü, Toasts.
- **Folienschatten** (`box-shadow: 0 12px 18px -14px rgba(19, 33, 59, .5)`): die Fachfolie im Kopfband; beim „Folie auflegen“ setzt er sich aus `0 30px 34px -16px rgba(19, 33, 59, .5)`.
- **Abdeckblatt** (`box-shadow: 0 -10px 18px -12px rgba(19, 33, 59, .42)`): nach oben geworfen, auf das, was schon aufgedeckt ist.
- **Dialog** (`box-shadow: 0 24px 64px -12px rgba(0, 0, 0, .45)`): über der Abdunklung `rgba(11, 17, 30, .55)`.
- **Auswahlring** (`box-shadow: 0 0 0 2px var(--tc), var(--shadow)`): gewählte Fachkachel. Felder im Fokus: `0 0 0 3px color-mix(in srgb, var(--fach-text) 28%, transparent)`.
- **Innere Haarlinie** (`box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fach) 24%, transparent)`): Dateisymbol; beim Abzeichen „Hausaufgabe“ mit `--gelb-kante` zu 60 %.

### Folien und Mischung
- **Fachseiten:** eine Folie in `--foil` (Radius 20px, `rotate(-2deg)` um die Unterkante, `width: min(36%, 460px)`, `bottom: -14px`). Die ganze Ebene `.foils` mischt sich per `mix-blend-mode: multiply` mit dem Band und ist durch `clip-path: inset(0 -100vmax -26px)` eine eigene Gruppe: über dem Band dunkler, unter der Bandkante hell. Hell hängt sie etwa 14–22px über die Bandkante, dunkel endet sie an der Kante (`clip-path: inset(0 -100vmax)`).
- **Seiten ohne Fach:** drei Folien in `--blau`, `--violett` und `--kupfer` (Radius 18px; -7deg, 4deg, -3deg) mischen sich nur untereinander – die Gruppe liegt mit `mix-blend-mode: normal` und Deckkraft .88 im Band, die Folien darin per multiply; nur Blau und Violett überlappen, alles bleibt im Band. Auf schmalen Seiten (unter 900px) werden die Folien schmaler, Titel (15ch) und Unterzeile (36ch) bleiben links daneben.
- **Anmeldung:** drei hell getönte Folien (#c9d6f4, #ddd2f3, #f3d5c3; Radius 28px; -9deg, 4deg, 7deg) per multiply auf der Leuchtfläche; dunkel in den vollen Fachfarben per `screen` mit Deckkraft .42.
- **Beamer-Code:** eine große Folie in `--foil` (70vmax × 46vmax, Radius 48px, -8deg) per multiply auf der Bandfarbe.
- **Logo:** das Folien-U – zwei versetzte U-Striche in Blau und Gelb, Gelb per multiply darüber (`icon.svg`).

### Named Rules
**Die Schwebe-Regel.** Schatten sind weich, nach unten versetzt und mit negativer Ausbreitung – eine Folie schwebt knapp über der Leuchtfläche. Nur das Abdeckblatt wirft seinen Schatten nach oben.

**Die Multiply-Regel.** Farbfolien mischen sich durch Übereinanderlegen (`mix-blend-mode: multiply`), nie durch Verläufe. Im Dunkelmodus endet die Bandfolie an der Bandkante – ein heller Überstand läse sich als Lichtfleck.

## Shapes

Abgerundete Rechtecke aus einer Familie, leicht gedrehte Folien, Pillen für kurze Zustände und Haarlinien.

- **Ecken:** 16px (`--radius`) für Karten, Kacheln, Live-Fenster und Ablagezonen; 18px für Dialoge; 20px für die Bandfolie; 12px für freistehende Listenzeilen, Klassenknöpfe, Codekasten, große Knöpfe, Schulportal-Vorschau, Toasts, Tabellenrahmen und Kontextmenü; 10px (`--radius-s`) für Knöpfe, Felder, Hinweise, Navigationslinks und verschachtelte Karten; 8px für Fach-Schilder, Leupold-Zellen, Menüeinträge und den Zwischenstopp-Reiter (nur oben gerundet); 6px für den Fokusring und Tastenkürzel; 999px für Chips, Abzeichen und Zähler.
- **Folien:** abgerundete Rechtecke, leicht gedreht – Band -2deg, Band ohne Fach -7deg/4deg/-3deg, Kachelecke 14deg (Hover 6deg), Anmeldung -9deg/4deg/7deg, Beamer -8deg.
- **Linien:** Haarlinien 1px `--line` für Trennungen, Kartenränder und Tabellenzeilen; Bedienkanten 1px `--line-ui`. Gestrichelt nur, was noch offen ist: Ablagezonen (2px `--line-ui`) und ein Änderungsvorschlag der KI für die Einheit (1px `--fach-text`). Der Vertretungsvorschlag hat einen 2px-Rahmen in Tinte.
- **Symbole:** eigene Strichzeichnungen aus `ICONS` in `ui.js` (trash, edit, x, expand, play, pause, check, left, right, up, down, alert): 24er-Raster, Strich 2, runde Enden und Ecken, ohne Füllung (nur play gefüllt), 1.15em groß in `currentColor`. Das Warnsymbol gibt es zusätzlich als CSS-Maske `--ico-alert`; der Winkel von Aufklappern ist eine gedrehte 2px-Ecke.

### Named Rules
**Die Eine-Kante-Regel.** Die einzige farbige Kante im System ist die 3px rote Oberkante des Abdeckblatts (`border-top: 3px solid var(--rot)`). Karten bekommen keine farbigen Seitenbalken.

## Components

### Buttons
Tastbar und ruhig: eine flache Folie mit Bedienkante, die beim Drücken 1px nachgibt.
- **Form:** sanft gerundet (`--radius-s`, 10px), mindestens 44px hoch, Innenabstand .6rem 1.05rem, 700 in 1rem; Symbol und Text mit .5rem Abstand.
- **Standard:** `--surface` mit 1px `--line-ui`, Schrift `--text`; Hover `--surface-2`; `:active` mit `translateY(1px)`. Übergänge .18s, das Nachgeben .12s, beide mit `--ease`.
- **Primär (`.primary`):** Tinte (`--ink`) mit weißer Schrift, eine Hauptaktion je Bereich; Hover `color-mix(in srgb, var(--ink) 82%, var(--fach))` – die Tinte nimmt einen Hauch Fachfarbe an. Dunkel umgekehrt (`text-dark` mit #13213b, Hover #fff).
- **Ghost (`.ghost`):** ohne Fläche und Kante für Nebenaktionen („Ausblenden“, „Klassen ändern“, Pfeile); Hover `--surface-2`.
- **Gefahr (`.danger`):** Schrift `--err`, Hover `--rot-t` mit Kante `color-mix(in srgb, var(--rot) 55%, var(--line-ui))` – für endgültige Aktionen (Löschen, Widerrufen), meist hinter einem Bestätigungsdialog.
- **Live (`.onair`):** `--rot` mit weißer Schrift, Hover `rot-tief` – nur „Präsentation für alle beenden“.
- **Größen:** `.small` 36px, .35rem .7rem, .92rem; `.big` 54px, .85rem 1.4rem, 1.1rem, Radius 12px; `.iconbtn` mindestens 36px breit, nur Symbol mit `aria-label`.
- **Zustände:** gesperrt mit Deckkraft .5 und `cursor: not-allowed`; beschäftigt (`busy()`) mit Drehkreis `.spin` (1em, 2px-Ring, .8s linear) und kurzem Text wie „Prüfe …“.
- **Fokus:** `outline: 3px solid var(--ring, var(--fach-text))`, Abstand 2px, Radius 6px; im Band und am Beamer ist `--ring` weiß, auf der Markerfolie #13213b.
- **Im Kopfband:** `rgba(10, 16, 30, .22)` mit Kante `rgba(255, 255, 255, .55)` und weißer Schrift, Hover `rgba(10, 16, 30, .34)`.
- **Auf der Markerfolie:** Primär in #13213b (Hover #24375c), andere Knöpfe `rgba(255, 255, 255, .55)` mit Kante `rgba(19, 33, 59, .45)`.

### Chips
Kennungen im Kopfband – Fach, Kurs, Datum, Dauer.
- **Stil:** Pille (999px) in `rgba(10, 16, 30, .2)` mit weißer Schrift, 700 in .92rem, Innenabstand .32rem .8rem, Abstand .45rem; mobil .86rem und .28rem .65rem.
- **Hervorgehoben (`.chip.strong`):** weiß mit Schrift in der Fachfarbe (`--fach`), immer vorn – „Stunde n von m“ in der Sitzung, der Fachname bei den Schüler:innen.
- Chips stehen nur im Kopfband und entstehen über `pageHead({ chips })`.

### Abzeichen
Zustände kurz und flach.
- **Form:** Pille, 700 in .82rem, Innenabstand .22rem .62rem, ohne Umbruch; ein Symbol davor mit .3rem Abstand.
- **Varianten:** neutral `--surface-2` mit `--muted` (Zähler, „kein Schlüssel“); erledigt `.ok` (`--gruen-t`, `--ok`, bei Bedarf mit Häkchen); Zwischenstopp `.stop` (`--rot-t`, `--err`, mit Pause-Symbol); Live `.onair` (`--rot`, weiß, mit pulsierendem Punkt `.dot`, 1.4s) – „LIVE“; Tinte `.ink` (`--ink`, weiß) für „Vertretung aktiv“; Hausaufgabe `.hw` (`--gelb-t` mit innerer Haarlinie in `--gelb-kante`) in der Sitzungsliste der Schüler:innen; `.mono` für Codes.
- **Im Kopfband:** `rgba(255, 255, 255, .94)` mit Schrift in der Fachfarbe, erledigt in `gruen-tief`. **Auf der Markerfolie:** #13213b mit gelber Schrift („Hauptweg“).

### Fach-Schild (`.ftag`)
- **Stil:** flach, Radius 8px, weiß in 800/.78rem, Innenabstand .34rem .5rem, mindestens 4.6rem breit, zentriert; Fläche nach `data-fach` (`--blau`, `--violett`, `--kupfer`, sonst `--marke`).
- **Einsatz:** immer mit Text (Kurzname: „PoWi“, „Ev. Religion“, „Ethik“) und nur am Zeilenanfang gemischter Listen wie „Zuletzt bearbeitet“; in Listen eines Fachs entfällt es.

### Cards / Containers
- **Ecken:** 16px (`--radius`); Dialoge 18px.
- **Fläche:** `--surface` auf `--ground`. Varianten: Hauptweg (Markergelb, siehe unten); Hausaufgabe der Schüler:innen und Vertretungsanleitung für Schüler:innen (`--gelb-t`); voriger Zwischenstopp (Kante `color-mix(in srgb, var(--rot) 35%, var(--line))`, Titel in `--err`); Vertretungsvorschlag (2px Tinte, dunkel `--line-ui`).
- **Schatten:** `--shadow`; die Anmeldekarte `--shadow-lift` (siehe Elevation & Depth).
- **Rand:** 1px `--line`.
- **Innenabstand:** 1.25rem 1.35rem (mobil 1rem .95rem); die Kopfzeile `.section-title` trägt links den Titel, rechts eine Aktion oder den Zustand, darunter .75rem.
- **Listen in Karten:** Haarlinien-Zeilen statt Kästen in Kästen – `.card .item` ohne Rand, Radius und Fläche, Innenabstand .75rem .4rem, dazwischen 1px `--line`; Link-Zeilen im Hover `--fach-t`. Eine Zeile: optional Fach-Schild oder Dateisymbol (`.ficon`, 42px, Radius 11px, `--fach-t` mit `--fach-text`), Name (700), Metazeile (.88rem, `--muted`), rechts Abzeichen und Aktionen. Außerhalb von Karten ist jede Zeile eine eigene Folie (`--surface`, 1px `--line`, Radius 12px, .75rem .9rem, Abstand .55rem).

### Inputs / Fields
- **Stil:** 1px `--line-ui`, Radius 10px, Fläche `--surface`, Innenabstand .6rem .75rem, mindestens 44px hoch; Textfelder ab 5rem, nur senkrecht vergrößerbar. Beschriftung darüber (700, .95rem), Hinweis darunter (.9rem, `--muted`), .95rem bis zum nächsten Feld.
- **Fokus:** Kante `--fach-text` und `0 0 0 3px color-mix(in srgb, var(--fach-text) 28%, transparent)`, Übergang .15s; Häkchen und Auswahl nehmen `accent-color: var(--fach-text)`.
- **Fehler:** `p.err` mit `role="alert"` direkt darunter, 700 in `--err`.
- **Code-Eingabe (`.codein`):** Mono 1.3rem, Sperrung .12em, Großbuchstaben; der Platzhalter („z. B. K7Q-M4X“) in Atkinson Next.
- **Zustandszeile (`stateLine()`, `.save-state`):** .86rem in 700 und `--muted`; „Gespeichert …“ grün mit Häkchen, ein Fehler rot mit Warnsymbol, „…“ beim Tippen ohne Symbol.

### Navigation
- **Kopfleiste (`topbar()`):** weiß (`--surface`), Haarlinie unten, sticky, mindestens 62px hoch. Links die Wortmarke (Folien-U in 34px und „Unterricks“ in 800/1.2rem), rechts die Navigation: Links in 700/.98rem, Innenabstand .5rem .8rem, Radius 10px; Hover `--surface-2`; die aktuelle Seite (`aria-current="page"`) in `--fach-t` mit `--fach-text`.
- **Brotkrumen:** nur über `pageHead()`; im Band weiß in 700/.95rem, Trennzeichen mit Deckkraft .65 und `aria-hidden`; die letzte Krume ist die aktuelle Seite (`aria-current="page"`).
- **Mobil (≤ 560px):** Kopfleiste nicht sticky, die Navigation bricht in eine eigene volle Zeile um, die aktuelle Brotkrume entfällt.
- **Fußzeile:** zentriert, .88rem, `--muted`, Link in 700.

### Kopfband mit Fachfolie (`pageHead()`)
Der Kopf jeder Seite: Fach, Kurs und Stand auf einen Blick.
- **Aufbau:** `header.pagehead` mit `.foils` (drei leere `i`, `aria-hidden`), Brotkrumen, `h1` (oder eine Zeile mit Aktion rechts), Unterzeile `.pagesub` (700, weiß, höchstens 70ch) und Chips.
- **Farbe:** Fläche `--fach`, Schrift immer weiß, Fokusring weiß; ohne Fach `--marke`.
- **Folien:** auf Fachseiten eine Fachfolie, ohne Fach die drei Fachfolien (siehe Elevation & Depth).
- **„Folie auflegen“:** `auflegen`, .75s mit `--ease` – die Folie ist von Anfang an sichtbar und senkt sich aus `translate(6px, -14px) rotate(-4deg) scale(1.025)` mit tieferem Schatten auf ihren Platz. Das geschieht nur beim ersten Kopfband nach dem Laden (`:root:not([data-laid])`; danach setzt `pageHead()` `data-laid` an `<html>`) und nie bei reduzierter Bewegung.

### Hauptweg-Markerfolie (`.claudeplan`)
- **Stil:** Karte in `--gelb` mit Kante `--gelb-kante`; alle Schrift #13213b, Hinweise mit Deckkraft .85; Abzeichen „Hauptweg“ in #13213b mit gelber Schrift; ein großer Primärknopf in #13213b (54px) – „Stunde mit Claude planen“ bzw. „Einheit mit Claude planen“; darunter der Verweis auf das Backup; Aufklapper mit Haarlinie `rgba(19, 33, 59, .22)`.
- **Platz:** vorn in der Hauptspalte (davor stehen nur Vertretung und voriger Zwischenstopp; über beiden Spalten nur die Zusammenfassung für die Lehrkraft). Das Backup bleibt erreichbar, drängt sich aber nicht vor – es ist eine normale Karte weiter unten.

### Zusammenfassung der Sitzung für die Lehrkraft (`.tsum`, `public/tsummary.js`, Nachtrag 21)
- **Platz:** die erste Karte der Sitzung, direkt unter dem Kopfband über die volle Breite (vor Hauptspalte und Seitenleiste) – in beiden Schulformen.
- **Stil:** normale Karte (`--surface`, kein Gelb – der Hauptweg bleibt die Markerfolie darunter). Kopfzeile `.tsum-head` (Fach · Jahrgang · Wochentag, Datum, Beginn) als Fläche in `--fach-t` mit Schrift `--text` in 700/.98rem, Radius 10px; darunter der Text `.tsum-text` gut lesbar in 1.04rem/1.62, höchstens 75ch breit, Absätze mit .65em Abstand (Zeilenumbrüche bleiben); „Stand: …“ in .86rem `--muted`.
- **Hinweis:** „Die Planung wurde danach geändert …“ bzw. der Satz zur Vertretung als `.notice.warn` (Tinte mit Warnsymbol, keine Signalfarbe).
- **Bearbeiten:** Knopf „Bearbeiten“ mit Stift-Symbol rechts im Kartenkopf (Zustand `stateLine()` daneben); das Textfeld wächst mit dem Text (bis gut zwei Drittel der Fensterhöhe), darunter Hinweis und Zeichenzähler, dann „Speichern“ (primär) und „Abbrechen“.

### Abdeckblatt am Zwischenstopp (`stopField()`, `.covered`)
- **Reiter (`.stopfield`):** `--rot`, weiß, 700 in .9rem, Innenabstand .32rem .75rem, nur oben gerundet (8px), Pause-Symbol und „**Zwischenstopp** – bis hierher geschafft, ab hier weiterarbeiten“; er sitzt auf der Kante des Blatts.
- **Blatt (`.covered`):** `--paper` mit Schrift `--muted`, Oberkante 3px `--rot`, Schatten nach oben, über die volle Breite der Vorschau (`margin: 0 -1rem -.85rem`). Der Inhalt bleibt lesbar, aber sichtbar gedimmt; `aria-label` „Noch nicht aufgedeckt (nach dem Zwischenstopp)“.
- **„Aufdecken“:** `aufdecken`, .45s mit `--ease` aus `translateY(-10px)` bei jedem Neuzeichnen – das Blatt gleitet, wenn der Zwischenstopp verschoben wird.
- **Einsatz:** überall, wo `paintPortalPreview()` einen Schulportal-Eintrag zeichnet – in der Vorschau der Sitzung und im Hinweis auf den vorigen Zwischenstopp.

### Sitzungscode
- **Codekasten (`.code-box`):** `--fach-t`, Radius 12px, zentriert, Innenabstand .9rem .6rem .8rem; der Code in `.code-big`, darunter die Zahl der freigeschalteten Geräte (klein, `--muted`). Erste Karte der Seitenleiste, mit „Kopieren“ und „Für den Beamer zeigen“.
- **Codefolie (`.codeslide`, `codeSlideDom()` in `public/codeslide.js`):** eine Folie für drei Orte – „Für den Beamer zeigen“ (`.codeshow`, Vollbild mit Knopf „Schließen“ unten rechts), Präsentationsmodus (vor Folie 1, an Unterricks-Codefolien der PDF, „Sitzungscode zeigen“) und das Live-Fenster der Schüler:innen. Fachfarbe mit großer Folie (`::after`), oben die Überschrift (Titel der Sitzung in 600 und Deckkraft .88; an Codefolien der PDF `.cs-task`: Aufforderung und Materialtitel in 800, je Zeile höchstens zwei Zeilen), darunter der Code in Mono 800 mit Sperrung .1em und rechts daneben der QR-Code zu unterricks.janrickmer.de auf einer weißen Karte (`.qrbox`, Radius bis 18px, Schatten `0 10px 30px rgba(10, 16, 30, .25)`, `image-rendering: pixelated`) mit der Adresse in 800, ganz unten die Anleitung. Alle Größen in Container-Einheiten (`container-type: size`, `cqw`/`cqh`): Die Folie füllt Vollbild wie 16:9-Kästchen gleich; unter 260px Höhe entfällt die Anleitung, hochkant steht der Code über dem QR-Code. Knopf in `.codeshow`: `rgba(10, 16, 30, .25)` mit Kante `rgba(255, 255, 255, .6)`.

### Live-Fenster der Schüler:innen (`.live`)
- **Ruhend (`.live.idle`):** ein helles, kompaktes Feld in `--fach-t` mit Kante `color-mix(in srgb, var(--fach) 22%, transparent)`, Radius 16px, ohne Schatten; Titel „Noch keine Live-Präsentation“ in 800/1.08rem und `--fach-text`.
- **Live:** erst wenn eine Folie läuft, wird es zur Projektionsfläche – `stage`, 16:9, Radius 16px, `--shadow-lift`, das Bild mit `object-fit: contain` auf #000 (bzw. die Codefolie, die die Fläche ganz füllt). Oben links die Abzeichen „LIVE“ und „Folie n / m“ (auf der Codefolie vor Folie 1 und bei „Sitzungscode zeigen“: „Sitzungscode“), unten rechts „Groß“ mit Erweitern-Symbol in `rgba(255, 255, 255, .14)` (Kante `rgba(255, 255, 255, .35)`, Hover `rgba(255, 255, 255, .24)`); im Vollbild ohne Radius.

### Folienfenster nach der Sitzung (`.slideview`, `public/slideviewer.js`, Nachtrag 19)
- Erst nach der Freigabe (5 Minuten nach dem Ende der Sitzung) unter dem Live-Fenster, statt des früheren Knopfs „… selbst öffnen“: Karte mit h2 „Präsentation aus dem Unterricht“ und – nur wenn die Lehrkraft die letzte gezeigte Folie markiert hat – „So weit, wie ihr im Unterricht gekommen seid.“ in `--muted`/.9rem. Darunter das Fenster: Projektionsfläche (`stage`, #0b111e, in beiden Modi gleich) mit 1px `--line` und Radius 10px im Seitenverhältnis der Folien (`--sv-ar` aus den Maßen der ersten Folie, sonst 16:9), höchstens 78 % der Fensterhöhe (dann eingepasst); das Folienbild mit `object-fit: contain`. Nichts liegt über der Folie.
- Leiste darunter: „Vorherige Folie“ (Pfeil links) · Zähler „Folie 3 von 7“ (700, tabellarische Ziffern, mittig) · „Nächste Folie“ (Pfeil rechts); am Anfang bzw. Ende `aria-disabled` (Deckkraft .5, der Fokus bleibt). Bis 560px nur die Pfeile (52 × 48px, der Name bleibt für Screenreader). Darunter der Primärknopf „Diese Präsentation herunterladen“ (Download-Symbol) und „Vollbild“ (Erweitern-Symbol); Meldungen dazu klein darunter (`role="status"`, z. B. „wird gerade vorbereitet“ – ruhig, keine rote Meldung).
- Laden: nach 250 ms ohne Bild ein weißer Drehkreis (2,4rem) über der gedimmten vorigen Folie (Deckkraft .35). Fehler ruhig im Fenster: Satz in 700 (#e8edf6) und „Erneut versuchen“ in `rgba(10, 16, 30, .62)` mit Kante `rgba(255, 255, 255, .55)`.
- Vollbild (bzw. ohne Vollbild-Schnittstelle als Ebene über der Seite): Fenster samt Leiste auf `stage`, die Folie so groß wie möglich, Knöpfe hell auf dunkel (`rgba(255, 255, 255, .14)`, Kante .45) und zusätzlich „Vollbild beenden“ (Kreuz) am Ende der Leiste.
- Bedienung: Pfeiltasten (auch Bild auf/ab, Pos1/Ende), solange das Fenster oder ein Knopf darin den Fokus hat; Wischen nach links/rechts über die Folie (senkrecht scrollt die Seite, `touch-action: pan-y pinch-zoom`). Eine unsichtbare Live-Region sagt „Folie 3 von 7“ an. Ohne Folienbilder (ältere Präsentation) nur der Satz „Die Folien lassen sich hier nicht anzeigen …“ in `--muted` und der Download.

### Druckaufträge für den nächsten Arbeitstag (`.printnext`, `public/printnext.js`)
- Karte ganz oben auf beiden Startseiten (Gymnasium und Übersicht „Grundschule“), direkt unter dem Kopfband und vor dem Wochenkalender. Fläche `--orange-t` mit 2px-Kante `--orange` (keine Seitenbalken); links das Drucker-Symbol (`icon("printer")`) weiß auf einem orangen Schild (48px, Radius 12px, `aria-hidden`), daneben h2 „Druckaufträge für den nächsten Arbeitstag“ und darunter in 700 der Tag („für morgen, Mittwoch, 19.11.2026“ bzw. der Satz zum übersprungenen Tag); rechts der Primärknopf „Alle Dateien herunterladen“ (auf dem Handy volle Breite), darunter die Statuszeile in 700.
- Je Sitzung eine Gruppe mit Haarlinie oben (`--orange` 30 % in `--line`): h3 als Link zur Sitzung (ganze Zeile, mindestens 44px) mit Beginn in `--muted`, Fach-Schild `.ftag` („Grundschule“ grün), Klasse bzw. Kurs und Titel; rechts „In der Sitzung bearbeiten“ (`btn ghost` mit Stift). Dateien wie in der Druckliste (`.item.printrow`: Dateisymbol, Druckname in 700, Größe bzw. Stand der Gestaltung in `--muted`), je Zeile „Herunterladen“ (`btn`, 44px). Darunter klein „Ohne Druckaufträge: …“ und der Hinweis zu „Alle Dateien herunterladen“ (einzelne Dateien, keine ZIP-Datei; der Browser fragt womöglich nach).

### Unterrichtsfreie Tage in den Einstellungen (`.freedays`, `public/freedays.js`, Nachtrag 24)
- Erste Karte der Einstellungen. h2 „Unterrichtsfreie Tage“, ein Satz zum Zweck, dann die Liste (`.list` mit Haarlinien): Bezeichnung in 700, darunter Zeitraum („Mo, 05.10.2026 – Fr, 16.10.2026“) und die Schule als Schild `.fd-scopetag` auf der Unterrichtsfrei-Schraffur; rechts „Bearbeiten“ und „Löschen“ (`btn small`, 44px, `aria-label` mit der Bezeichnung). Vergangene Einträge in `details.fd-past` „Vergangene anzeigen (n)“ (Zusammenfassung 44px).
- Formular unter einer Haarlinie: h3 „Unterrichtsfreien Tag eintragen“ (beim Bearbeiten „Eintrag bearbeiten: …“ mit „Abbrechen“), Bezeichnung, „Von“/„Bis“ nebeneinander (unter 560px untereinander), Fieldset „Betrifft“ mit drei Wahlflächen `.fd-radio` (44px, Kante `--line-ui`, gewählt Kante `--fach-text` auf `--fach-t`; unter 560px je eine Zeile) **ohne Vorauswahl**. Fehler: Feld bzw. Fieldset mit `aria-invalid` (Kante `--err`), Meldung `.err` unter den Feldern (`role="alert"`, `aria-describedby`), Fokus auf das Feld bzw. den ersten Radioknopf.
- Rückfrage „Sitzungen an unterrichtsfreien Tagen“ (breiter Dialog): Einleitungssatz, Tabelle Datum · Uhrzeit · Fach/Kurs (`.ftag`) · Klasse · Titel (unter 560px gestapelt mit Spaltennamen), Hinweise je Zeile („ohne Einheit – bitte selbst verschieben“ als `.warnc`, „wird nicht verschoben: …“ als `.err`), drei kurze Absätze zu den Antworten; Knöpfe „Abbrechen“, „Nur speichern – Sitzungen bleiben“, Primärknopf „Speichern und verschieben (empfohlen)“. Danach eine Statuszeile und `.notice.ok` mit den verschobenen Einheiten (Links), `.notice.err` für nicht verschobene, `.notice.warn` für Sitzungen ohne Einheit.
- Einheit: unter „Ferien und bekannte Ausfälle“ ein Kasten `.fd-unit` (Fläche `--frei-t`, 4px-Kante `--frei-k` links) mit den geltenden Tagen der Schule und dem Link „In den Einstellungen bearbeiten“ (44px); in der Tabelle unter dem Datum `.fd-row` „Liegt auf einem unterrichtsfreien Tag (…)“. Sitzung: im Kopfband ein Chip `.freechip` (gestrichelte weiße Kante, kaum Fläche). Nach dem Verschieben trägt die Einheit beider Schulformen den Kasten `.revisebox` („… wegen unterrichtsfreier Tage überarbeitet werden“), am Gymnasium dazu das Abzeichen „überarbeiten“ (`.badge.stop`) in der Liste der Klasse.

### Podcast für den kommenden Unterricht (`.podcast`, `public/podcast.js`, Nachtrag 22)
- Direkt unter dem Wochenkalender auf beiden Startseiten (Gymnasium und Übersicht „Grundschule“), ohne eigene Farbe. Ohne Podcast ein großer Standardknopf (`btn big`, 54px) mit Kopfhörer-Symbol (`icon("headphones")`) „Podcast für den kommenden Unterricht entwickeln“, auf dem Handy über die volle Breite; darunter eine Statuszeile in 700.
- Rückfrage „Für welchen Unterricht ist der Podcast gedacht?“ als Dialog mit zwei großen Wahlknöpfen untereinander (`.pc-choice`: Tag fett, darunter die Zahl der Stunden in 600); „Heute“ ist primär und hat den Fokus, „Nächster Schultag“ Standard; unten „Abbrechen“.
- Karte (`.card.podcast`) an derselben Stelle: links das Kopfhörer-Schild (48px, Radius 12px, Tinte mit weißem Symbol, dunkel #e8edf6 mit Tinte, `aria-hidden`), h2 „Podcast für den Unterricht am …“, darunter in 600 und `--muted`, für welchen Tag. Sitzungsliste als nummerierte Liste: Kopfzeile wie in der Zusammenfassung als Link (700, ganze Zeile ≥ 44px), Abzeichen „Zusammenfassung“ (`.ok`) bzw. neutral „Ersatz aus der Planung“ / „noch nicht geplant“, „Vertretung – nicht im Podcast“ (`.ink`); darunter je Sitzung kleine Hinweise in `--muted` (`.pc-sn`: „frühere Planung“, offener Teil der vorigen Stunde nach einem Zwischenstopp, „gekürzt“). Primärknopf „Auftrag für Claude in Chrome kopieren“ (Symbol `copy`), drei Schritte mit Tasten als `kbd`, das Ablagefeld wie im Materialkasten (`.drop`, gestrichelt, Symbol `upload`, beim Ziehen `.over` in der Fachtönung; Fortschritt als `progress` in Tinte mit Prozent und MB in tabellarischen Ziffern), „Ohne Claude (z. B. am iPad)“ als aufklappbarer Abschnitt mit Haarlinie und Pfeil wie `details.box`, „Abbrechen“ als Ghost-Knopf.
- Player (`.pc-item`): Schild und h2 „Podcast zum Unterricht am …“, darunter „KI-erzeugt mit Gemini Notebook“ (700, `--muted`). Eine Zeile mit „Abspielen“ (Symbol `play`) und „Pause“ (Symbol `pause`) – der gerade mögliche ist primär, der andere gesperrt (`aria-disabled`, Deckkraft .5; lag der Fokus auf dem Knopf, der gerade gesperrt wird, wandert er zum anderen) –, rechts der Schieberegler (`accent-color` Tinte, 44px hoch) und die Zeit „4:12 / 13:05“ in 700 und tabellarischen Ziffern; auf dem Handy die beiden Knöpfe nebeneinander über die volle Breite und der Regler darunter. Darunter klein Größe und Löschtag, rechts „Podcast löschen“ (Ghost, `.danger`, mit Rückfrage), unter allen Playern „Podcast für einen anderen Tag entwickeln“ (Ghost).

### Wochenkalender (`.weekcal`, `public/weekcal.js`)
- Karte ganz oben auf der Startseite der Lehrkraft, direkt unter dem Kopfband bzw. den Druckaufträgen und vor den Fachkacheln (für Screenreader folgt eine verborgene h2 „Fächer“). Kopf: h2 „Ihre Woche“, rechts Pfeil-Knöpfe (`icon("left")`/`icon("right")`, 44px, aria-label „Vorige Woche“/„Nächste Woche“), der Zeitraum mit KW (`aria-live`) und „Heute“ (in der laufenden Woche `aria-disabled`, behält den Fokus). Beim Blättern wird nur der Inhalt neu gebaut.
- **Ab 1000px Zeitraster:** links die Zeitachse (volle Stunden, Haarlinien `--line`), fünf Tagesspalten `minmax(0, 1fr)`; Einträge absolut nach Uhrzeit (`--m`, `--dur`, 1,35px je Minute, mindestens 40 Minuten hoch), Überschneidungen in Spuren nebeneinander. Über dem Raster je Tag die Zeile „ohne Uhrzeit“ (gleich hoch in allen Spalten). Heute: das Datum als Tinte-Marke, die Spalte zart getönt (`--marke` 6 %). **Unter 1000px** (Handy, iPad hochkant): Liste je Tag – Zeit links, rechts Fach-Schild, Klasse und Einheit.
- **Eintrag** (`a.wk-ev[data-fach]`): Tönung des Fachs (`--blau-t`/`--violett-t`/`--kupfer-t`) mit Kante 30 % Fachfarbe, Schrift immer `--text`/`--muted`; Fach als `.ftag` (Text, nie nur Farbe – hier stehen alle drei Fächer nebeneinander, daher fest eingetragene Fachfarben wie bei Kachel und Schild), Klasse fett, Titel der Einheit einzeilig in `--muted`, Klausur als neutrale `.badge`. Ein Eintrag ist ein Link auf die Klasse bzw. den Kurs; sein Name beginnt mit Wochentag und Datum (sr-only). „Entfällt: …“ und „kein Unterricht“ klein in `--muted`.

- **Unterrichtsfreie Tage** (Nachtrag 24): oben am Tag ein Band `.wk-fband` mit Schraffur (`--frei-t`/`--frei-s`), Kante `--frei-k` (unten 3px) und dem Text „Herbstferien – unterrichtsfrei (Gymnasium)“ (800, .76rem; beide Schulen „(Grundschule und Gymnasium)“); im Raster sind alle Bänder einer Woche gleich hoch (weekcal.js misst `--fb`, die Zeitachse rückt um dieselbe Höhe), Tage ohne Eintrag bekommen ein leeres Band. Ist der Tag für eine Schule frei, erscheinen die Stunden der anderen darunter wie immer; ist er für beide frei (`.free-all`), ist auch die Spur schraffiert und „kein Unterricht“ entfällt. Eine Sitzung, die trotzdem dort liegt (`.wk-ev.onfree`), hat eine gestrichelte Kante und das kleine Schild „unterrichtsfrei“ (auch im Linktext für Screenreader). Unter 1000px steht das Band über den Einträgen des Tages mit 4px-Kante links.
### Präsentationsmodus (`.presenter`)
- Vollbild auf #000; unten eine Leiste in `rgba(11, 17, 30, .94)` mit Schrift #e8edf6 und Knöpfen in #1d2840 mit Kante #34405a; die Foliennummer in 800 mit tabellarischen Ziffern; „Präsentation für alle beenden“ als Live-Knopf. Nach kurzer Ruhe blendet die Leiste aus (.3s), der Mauszeiger verschwindet. „Bis hier gezeigt“ ist ein normaler Leistenknopf (auf der Codefolie gesperrt); seine Rückmeldung steht daneben als Text (`.markstate`), weil Toasts im Vollbild nicht zu sehen sind. „Sitzungscode zeigen“ steht davor und heißt, solange die Codefolie eingeblendet ist, „Zurück zu Folie n“; die Foliennummer zeigt dann „Sitzungscode“.
- **Vorschau der nächsten Folie** (`.with-next`, Knopf „Vorschau“ mit `aria-pressed`, gedrückt in #2b4a8f mit Kante #6d8fd6): Die Fläche wird `stage` (#0b111e) mit Abstand `clamp(.75rem, 1.6vw, 1.6rem)`; links die aktuelle Folie, rechts im Verhältnis 1.85 : 1 die nächste – hochkant (Seitenverhältnis ≤ 1) darunter (1.7 : 1), beide dicht beieinander. Beide Folien stehen in Rahmen im Seitenverhältnis der Folien (`--ar`, aus dem ersten Folienbild, sonst 16:9), so groß wie die Fläche erlaubt (Container-Einheiten), auf #000 mit Radius 6px und Kante `0 0 0 1px rgba(255, 255, 255, .14)`. Über der nächsten Folie steht `.np-head`: „ALS NÄCHSTES“ in Versalien (800, .78em, Sperrung .06em, #9fb0cc) und dann „Folie n / m“ (bzw. „· Codefolie“, „Zurück zu Folie n / m“, „Ende der Präsentation“) in 700, #e8edf6, `clamp(.95rem, 1.5vw, 1.3rem)`, einzeilig. Nach der letzten Folie zeigt der Rahmen in #141c2e „Keine weitere Folie“ (#9fb0cc). Toasts stehen im Präsentationsmodus oben, weil unten die Leiste liegt. Meldungen zum Beamerfenster („verbunden“, „blockiert“, „nur ein Bildschirm erkannt“) stehen als Text in der Leiste (`.beamstate`), weil Toasts im Vollbild nicht zu sehen sind. Hat ein Knopf der Leiste den Tastaturfokus, bleibt sie sichtbar (`:focus-within`); der Fokusrahmen ist weiß (`--ring: #fff`).
- **Beamerfenster** (`.beamer`, `#/beamer`): nur die aktuelle Folie auf #000 – das Folienbild mit `object-fit: contain` bzw. die Codefolie, die die Fläche ganz füllt; davor der Wartetext in #9fb0cc. Unten liegt die Leiste wie im Präsentationsmodus, mit dem Hinweis zum Verschieben und Vollbild, „Vollbild“ (bzw. „Vollbild auf dem Beamer“) und „Fenster schließen“; Fehlermeldungen stehen darin in #ffd43b. Nach 2,5 s Ruhe blendet die Leiste aus, der Mauszeiger verschwindet.
- **Beamergerät** (`.beamer.bm-device`, `#/beamer` ohne Präsentationsfenster im selben Browser, Nachtrag 15): ohne Präsentation der **Beamer-Code** mittig auf #000 – darüber gegebenenfalls die Meldung (`.bm-msg`, #fff, 800, z. B. „Die Präsentation ist beendet.“ oder „Getrennt – …“), dann „BEAMER-CODE“ in Versalien (#9fb0cc, 800, Sperrung .08em), der Code „482 913“ in Mono 800 mit Sperrung .08em, `clamp(2.4rem, 13vw, 11rem)`, weiß auf einer Karte #13213b mit Kante `0 0 0 2px #34405a` und Radius bis 28px, darunter die Anleitung (#e8edf6, 700) und „Der Code gilt 10 Minuten …“ (#9fb0cc). Zwei Stunden unbeachtet (`.bm-pair.off`): statt Code und Anleitung der Hinweis „Seit zwei Stunden …“ (#e8edf6, 700) und der Knopf „Neuen Beamer-Code anzeigen“ (#1d2840, Kante #8796b3 – 7:1 auf Schwarz). Weiß auf Schwarz 21:1, #9fb0cc auf Schwarz 9,4:1 – hell wie dunkel gleich (ein Beamer zeigt Schwarz als „aus“). Mit Präsentation wie das Beamerfenster nur die Folie; die Leiste nennt, dass auf dem Gerät der Lehrkraft gesteuert wird, und hat nur „Vollbild“ und „Zur Startseite“ (Tippen zeigt sie wieder; „Fenster schließen“ nur, wenn ein Skript das Fenster geöffnet hat).
- **Timer** (Nachtrag 16, `public/timerband.js`): ein Band am **oberen Rand** der Präsentationsfläche – im Live-Fenster der Schüler:innen, im Beamerfenster, am Beamergerät und über der großen aktuellen Folie der Lehrkraft (nicht über der Vorschau), auch über der Codefolie. Es verdeckt nichts: Die Fläche bekommt eine eigene Rasterzeile (`.has-timer`), die Folie wird darunter eingepasst; bei der Lehrkraft mit Vorschau wird der Rahmen der aktuellen Folie um das Band höher. Text mittig in 800 mit tabellarischen Ziffern, Größe `clamp(1rem, min(3.2cqw, 5.6cqh), 4.5rem)` (relativ zur Fläche: bei den Schüler:innen nach der Breite des Live-Kästchens – `.live` ist ein Container, am Laptop rund 24px statt nach der Fensterbreite –, bei der Lehrkraft nach der Folienfläche, am Beamer nach dem Bildschirm, bei 1280 × 720 rund 40px; die Codefolie darunter ist oben eckig), Bandhöhe 1,6 × Schrift; unten ein Balken (mindestens 4px) mit dem Anteil der Restzeit. „Noch 4:12“ (ab einer Stunde „Noch 1:04:12“), „Pausiert – noch 4:12“, abgelaufen „Die Zeit ist um!“ in Rot ohne Balken – ohne `prefers-reduced-motion` dreimal kurz heller (#d93a2e, mit weißer Schrift noch 4,6 : 1), dann ruhig; mit reduzierter Bewegung kein Pulsieren. Keine Beschriftung, kein Ton. Im Präsentationsmodus der Knopf „Timer“ (Stoppuhr-Symbol, nach „Beamer verbinden“): ohne Timer „Timer“, sonst die Restzeit, Fläche in der Timer-Farbe (letzte Minute orange, abgelaufen rot „Zeit um“); bis 1000px Breite nur das Symbol (der Name „Timer 4:12“ bleibt für Screenreader) – sonst bräche die Leiste am iPad hochkant in eine dritte Zeile. Leere Statuszeilen der Leiste (`.beamstate`, `.devstate`, `.markstate`) nehmen keinen Abstand mehr ein. Das Feld „Timer“ ist ein Dialog wie „Beamer verbinden“ (`.tmc`, Farben wie `.modal`, oben angesetzt): Schnellwahl 1–20 Min als Knöpfe mit `aria-pressed` (gewählt: Tinte bzw. im Dunkelmodus #e8edf6), Feld „Minuten (1 bis 120)“, Hinweis, „Abbrechen“ und „Timer starten“; läuft er: die Restzeit groß in der Timer-Farbe, „Pause“/„Weiter“, „+1 Min“, „+5 Min“, „Timer beenden“ (nach Ablauf „Timer schließen“) und „Fertig“. Alle Ziele ≥ 44px.
- **„Beamer verbinden“** im Präsentationsmodus (auf allen Geräten): Knopf in der Leiste nach „Beamerfenster öffnen“; verbunden heißt er „Beamer verbunden“ (bzw. „2 Beamer verbunden“) – so bleibt die Leiste so schmal wie vorher, Zwischenstände („Beamer gekoppelt – verbindet sich …“, „Beamer getrennt“) stehen als Text daneben (`.devstate`) – „Beamer getrennt“ nur 6 s, damit die Leiste am iPad hochkant nicht dauerhaft in eine dritte Zeile bricht. Das Eingabefeld ist ein Dialog innerhalb der Präsentation (`.bmc`, Farben wie `.modal`, hell und dunkel, Radius 18px) über einer Abdeckung `rgba(0, 0, 0, .6)` – oben angesetzt (7vh), damit die Bildschirmtastatur des iPads es nicht verdeckt: Überschrift, Feld „Code vom Beamer eingeben“ in Mono 1.7rem (Ziffernfeld), Hinweis zum Spiegeln, Fehler in `--err`, „Abbrechen“ und „Verbinden“; verbunden darüber ein Kasten `--surface-2` mit „Beamer trennen“. Esc schließt, Tab bleibt im Dialog, Tippen daneben schließt und blättert nicht.

### Folienleiste der Präsentation (`.thumbs .thumb`)
- Waagerecht scrollende Leiste aller Folien (Höhe 74px, Radius 8px); Unterricks-Codefolien tragen das Abzeichen „Code“; die letzte gezeigte Folie trägt einen 3px-Ring in `--fach` und das Abzeichen „bis hier“ (`.badge.ink`), Folien danach erscheinen blass (Deckkraft .35, graustufig). Rechtsklick bzw. Kontextmenü-Taste öffnet das Kontextmenü; darunter die Auswahl „Letzte im Unterricht gezeigte Folie“ (`.shownbox`) und die Zeile zur Freigabe (`.presrel`).

### Fachkacheln (`.tile`)
- **Stil:** jedes Fach als eigene Folie – weiße Karte (Radius 16px, `--shadow`, Innenabstand 1.15rem 4.4rem 1.15rem 1.2rem), oben rechts eine Ecke der Fachfolie (92px, Radius 18px, 14deg gedreht, Deckkraft .92) hinter dem Text; Titel in 800/1.15rem, Unterzeile .92rem in `--muted`.
- **Hover:** hebt sich um 2px (`--shadow-lift`, Kante `color-mix(in srgb, var(--tc) 45%, var(--line))`), die Folie dreht sich auf 6deg und rückt nach innen (.22s bzw. .35s).
- **Gewählt (`aria-pressed="true"`):** Tönung des Fachs, Kante und 2px-Ring in der Fachfarbe.

### Klassen- und Kurs-Knöpfe
- **Klassenknopf (`.class-btn`):** 800 in 1.02rem, mindestens 48px hoch, Radius 12px, 1px `--line-ui`, `--surface`; Hover mit Kante `--fach-text` und Fläche `--fach-t`; gedrückt (`aria-pressed="true"`) `--fach` mit weißer Schrift. Gruppen je Jahrgangsstufe mit `h3` in .98rem und `--muted`. Ein Zähler `.n` (Pille oben rechts, 800/.74rem) nennt die Zahl der Sitzungen.
- **Kurszeile (`.course-row`):** in Ev. Religion und Ethik, wenn das Fach im Kursbetrieb läuft (`courseMode`), statt der Klassenknöpfe der Jahrgangsstufen 5–10 und der Einführungsphase – je Jahrgang eine umbrechende Zeile (`gap: .55rem .9rem`): der Kursknopf `.class-btn.course` („Kurs Jg. 8“, „Kurs E-Phase“; mindestens 9.5rem breit, seitlich .9rem), daneben die Klassen des Kurses in `.course-members` („Klassen 8A, 8C“; 700, .95rem, `--muted`) und der Ghost-Knopf „Klassen ändern“ mit Stift-Symbol. Ohne Kurs: der Standardknopf „Kurs anlegen“ und `.course-members` mit „Sie wählen, welche Klassen im Kurs vertreten sind.“ Ältere Sitzungen einzelner Klassen folgen als kleine Linkzeile. Die Klassen des Kurses wählt ein Dialog mit Klassenknöpfen (`aria-pressed`).

### Hinweise, Rückmeldungen, Dialoge
- **Hinweis (`.notice`):** Radius 10px, Innenabstand .75rem .95rem, .95rem; Standard `--fach-t` mit Kante `color-mix(in srgb, var(--fach) 22%, transparent)`; `.warn` auf `--paper` mit Warnsymbol und Kante `color-mix(in srgb, var(--line-ui) 70%, transparent)`; `.err` auf `--rot-t`; `.ok` auf `--gruen-t`.
- **Toast:** unten mittig, höchstens `min(92vw, 520px)` breit; Tinte mit weißer Schrift in 700/.96rem, Innenabstand .75rem 1.05rem, Radius 12px, `--shadow-lift`; Fehler in `rot-tief`, Erfolg in `gruen-tief`. Gleiche Meldungen stapeln sich nicht.
- **Dialog (`modal()`):** Abdunklung `rgba(11, 17, 30, .55)`; Fläche `--surface`, Radius 18px, höchstens 760px breit (`.wide` 1100px); Kopf mit `h2` (1.2rem) und Schließen-Knopf mit dem Symbol x; Fuß mit Haarlinie und Aktionen rechts. Bewegung `auflegen-modal`, .32s aus `translateY(10px) scale(.99)`.
- **Tastatur in Dialogen (Nachtrag 25, `openLayer()` in `ui.js`):** Der erste Fokus liegt auf dem ersten Eingabefeld bzw. Hauptknopf, sonst auf dem ersten Knopf unten („Abbrechen“), sonst auf „Schließen“. Tab und Umschalt+Tab bleiben im obersten offenen Dialog und laufen im Kreis (vom letzten Halt zum x und umgekehrt); Esc schließt nur den obersten Dialog, danach steht der Fokus wieder auf dem Auslöser (bzw. im Dialog darunter). Die Seite dahinter ist solange inert (auch für VoiceOver) – nur die Meldungen (Toasts) bleiben hörbar. Langer Text ohne Knöpfe wird selbst ein Halt, damit er sich per Tastatur rollen lässt. Dasselbe gilt für die Codefolie „Für den Beamer zeigen“ (Fokus auf „Schließen“), den Präsentationsmodus (Esc bleibt dort beim Vollbild), „Buchstabe freigeschaltet“ im Escape-Room (Esc wirkt wie der Knopf) und Folienfenster bzw. Live-Fenster im Vollbild oder als Ebene über der Seite (Esc beendet die Ebene). Kästchen und Optionsfelder zeigen im Tastaturfokus den Fokusrahmen (der blasse Schatten der Textfelder allein wäre kaum zu sehen). Wird der Auslöser inzwischen neu gezeichnet oder gelöscht, steht der Fokus danach auf dem neuen Element bzw. dem ersten Knopf des Eintrags, der jetzt an seiner Stelle steht (nie auf einem Eingabefeld); ein gesperrter Knopf im Dialog bekommt den Fokus zurück, sobald er wieder bedienbar ist. Verdeckt eine Meldung das fokussierte Element im Dialog (am Handy unten), steht sie solange am oberen Rand.
- **Kontextmenü (`.ctxmenu`):** `--surface`, 1px `--line`, Radius 12px, `--shadow-lift`; Einträge in 700 mit Radius 8px, Hover und Fokus `--surface-2`.
- **Aufklapper (`details.box`):** Haarlinie oben, Titel in 700 mit gezeichnetem Winkel, der sich beim Öffnen um 90° dreht (.2s).

### Roter Hinweis (`.alarm`) – nur für die Notfall-Feibeitsblätter
- Volle Fläche `--rot` mit weißer Schrift in 600/.95rem (Kontrast 5,6 : 1), Radius 10px, Innenabstand .8rem 1rem, Ring `0 0 0 3px color-mix(in srgb, var(--rot) 30%, transparent)`, Warnsymbol in Weiß; „Achtung!“ in 800. Er steht im eigenen Kästchen `.notfallbox` unter dem Material (Schrift .9rem, also kleiner als das Material), das zugeklappt ist: sichtbar nur die Titelzeile (`details.nfdetails > summary` mit `h2` in 1.05rem/800, Winkel wie beim Aufklapper, mindestens 44px hoch, Hover `--surface-2` nur mit Maus); aufgeklappt folgen der rote Hinweis und die Dateien (Abstand .9rem). Kein weiterer Einsatz: Rot als Fläche bleibt dieser einen Warnung (und dem Live-Knopf) vorbehalten.

### KI-Begriffshilfe (`.kihelp`)
- Eine normale Karte unter der Live-Präsentation (h2 1.1rem); Fragen in 700, Antworten auf `--paper` mit 1px `--line`, Radius 10px; der Verlauf scrollt ab 22rem. Die Einwilligung ist ein Dialog mit Liste (`.kiconsent`) und Kästchen (`.checkrow`); „Einwilligung zurücknehmen“ als Textknopf (`.linkbtn`, unterstrichen in `--fach-text`).

### Druckliste (`.printcard`, `.printrow`)
- Karte ganz unten in der Sitzung; je Datei der vollständige Druckname in 700, darunter in einer umbrechenden Zeile (`.pset`) Anzahl (Zahlfeld 5.2rem, „Exemplare“ in 700), beidseitig/einseitig und schwarz-weiß/Farbe als Auswahlfelder; Aktionen wie bei den übrigen Dateien. Darunter „Alle herunterladen (ZIP)“ und, als letzte Karte der Seite über die volle Breite, „Sitzung als Datei“ (`.sessionio`). Ebenso endet die Planungsseite einer Einheit mit „Einheit als Datei“ (`.sessionio.unitio`). Zeilen, deren Sitzung ihren Inhalt beim Anlegen aus der geladenen Datei bekommt, tragen in der Spalte „Sitzung“ das Abzeichen „Inhalt aus Datei“.
- **Unterricks zurücksetzen** (Einstellungen, letzte Karte `.card.dangerzone`): Rand in Rot gemischt (`color-mix` 45 % `--rot`), links ein 4px breiter roter Streifen (`inset 4px 0 0 var(--rot)`), Überschrift in `--err`; der Knopf „Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen“ ist `btn danger`. Die Schritte laufen in Dialogen: Passwort, „Vorher eine Sicherung herunterladen?“ (Abbrechen / Ohne Sicherung fortfahren (danger) / Sicherung herunterladen (primary)), Fortschritt mit `.progress`, letzte Bestätigung „Jetzt endgültig löschen“ (danger).

### Leupold-Schema und Einheit
- **Leupold-Schema (`.lp-grid`):** drei Spalten – Ausgangslage (`--fach-t`), Lernschritte (Zeilen Beschreibung | Titel, 1px `--line`, Radius 8px, `--surface`) und Lernaufgabe (`--gelb-t`); der Lernschritt der aktuellen Stunde als volle Fachfläche mit weißer Schrift in 800. Beschriftungen `.lp-cap` in 800/.85rem und `--fach-text`.
- **Einheitstabelle (`.unit-table`):** Haarlinien-Zeilen, Kopf in `--fach-t` mit 800/.85rem in `--fach-text`; Rahmen `.table-wrap` (1px `--line`, Radius 12px, waagerecht scrollbar).
- **Einheit in der Sitzung (`.unit-row`):** Stundenfrage und grober Ablauf als Tönungsflächen (`--fach-t`, Radius 12px); ein Änderungsvorschlag der KI steht gestrichelt in `--fach-text` (`.unit-change`) und gilt erst nach Bestätigung.

### Escape-Room (begrenzte Ausnahme)
Alles unter `.er` (`escape.js`; Schüler:innen unter `#/schueler/escape/…`, Vorschau der Lehrkraft unter `#/lk/escape/…`) behält die Gestaltung der Escape-Rooms der Lehrkraft: hell, seriös, Petrol und Ocker, dunkle Arena. Es ist nicht Teil dieses Systems; im Stylesheet steht es als letzter Abschnitt ab „Escape-Room (Gestaltung wie die Escape-Rooms der Lehrkraft …)“. Die Ausnahme ist an die Klasse `.er` und die Präfixe `.er-*` gebunden und bringt eigene Werte mit: `--er-bg` (#f4f1ea), `--er-ink` (#1d2733), `--er-pet` (#1f4e5f), `--er-och` (#a9772a), `--er-ok` (#2f7d41), `--er-err` (#b1442f), `--er-line` (#ddd5c6), `--er-mute` (#5f6670); Überschriften in Georgia, Text in system-ui (17px/1.6), immer hell (`color-scheme: light`), Radien überwiegend 6–8px, Karten mit 4px-Kante links, gesperrte Überzeilen in Großbuchstaben, eine Arena mit radialem Verlauf und Gold (#d6b25e), Häkchen und Kreuz als Zeichen. Der Escape-Room nutzt weder Kopfleiste noch Kopfband, Karten oder Knöpfe der Plattform.

Zur Plattform gehört dagegen `.escbox`, auch wenn es am Anfang dieses Abschnitts steht: der Kasten, der in der Vertretung auf den Escape-Room hinweist – ein Blatt Papier (`--paper`, Kante `--line-ui`, Radius 10px) mit Systemwerten – seit dem 10.11.2026 ohne Gelb, das bleibt dem Hauptweg vorbehalten.

**Die Ausnahme-bleibt-drinnen-Regel.** Nichts aus `.er-*` wandert in die Plattform: keine Seitenbalken, keine Überzeilen, keine Serifenschrift, keine Verläufe, keine Zeichen als Symbole, kein Ocker.

## Do's and Don'ts

### Do:
- **Do:** Setze das Fach über `pageHead({ fach })` bzw. `setFach()` und färbe Bausteine nur mit `--fach`, `--fach-t` und `--fach-text`.
- **Do:** Beginne jede Seite mit dem Kopfband aus `pageHead()` – Brotkrumen, Titel, Chips; in der Sitzung steht „Stunde n von m“ als weißer Chip vorn.
- **Do:** Stelle den Hauptweg (Markerfolie) an den Anfang der Hauptspalte und den Sitzungscode an den Anfang der Seitenleiste.
- **Do:** Trenne Listen in Karten mit Haarlinien (1px `--line`) und beginne Zeilen gemischter Listen mit dem Fach-Schild `.ftag` samt Text.
- **Do:** Markiere den Zwischenstopp mit Reiter und Abdeckblatt (3px rote Oberkante, Schatten nach oben); der Inhalt darunter bleibt lesbar.
- **Do:** Schreibe Warnungen in Tinte mit Warnsymbol (`.warnc`, `.notice.warn`) und Zustände mit `stateLine()`.
- **Do:** Nimm Symbole aus `ICONS` über `icon()` – 24er-Raster, Strich 2, runde Enden, `currentColor`.
- **Do:** Halte Bedienelemente mindestens 44px hoch (Klassenknöpfe 48px, große Knöpfe 54px).
- **Do:** Bewege nur mit `--ease` (`cubic-bezier(.16, 1, .3, 1)`) und nur als „Folie auflegen“ bzw. „Aufdecken“; bei `prefers-reduced-motion: reduce` steht alles still.
- **Do:** Zeige das Live-Fenster ruhend hell und kompakt; die dunkle Projektionsfläche erscheint erst, wenn eine Folie läuft.
- **Do:** Prüfe jedes neue Textpaar auf mindestens 4,5:1 – hell und dunkel.

### Don't:
- **Don't:** Volles Gelb außerhalb der Hauptweg-Karte – kein gelber Knopf, Zähler oder Chip. (Seit dem 10.11.2026 ist auch der Präsentations-Knopf neutral und der Zähler an den Klassenknöpfen in der Fachfarbe.)
- **Don't:** Rot für etwas anderes als Zwischenstopp, Live und Fehler; Grün für etwas, das nicht erledigt oder gespeichert ist.
- **Don't:** Eine Warnfarbe einführen – kein Ocker, kein Orange. (Einzige Ausnahme, auf Wunsch der Lehrkraft: Orange als Kennfarbe des Feldes „Druckaufträge für den nächsten Arbeitstag“ – nie als Warnung und nirgends sonst.)
- **Don't:** Graue Lernplattform-Karten mit einem einzigen Blau – jede Seite trägt ihr Fach bzw. die Marke flächig im Kopfband.
- **Don't:** Ein Fach nur durch Farbe kennzeichnen.
- **Don't:** Verläufe, Leuchten oder harte Versatzschatten; `linear-gradient(var(--fach) 0 0)` im Kopfband ist nur ein einfarbiger Kniff für die randlose Fläche.
- **Don't:** Farbige Seitenbalken an Karten; die einzige farbige Kante ist die rote Oberkante des Abdeckblatts.
- **Don't:** Unicode-Zeichen als Symbole – auch der Präsentationsmodus nutzt `icon("left")`/`icon("right")`.
- **Don't:** Eine zweite Schrift, Überzeilen (Kicker) über Überschriften oder gesperrte Großbuchstaben außerhalb von Codes.
- **Don't:** Die Bandfolie im Dunkelmodus über die Bandkante hängen lassen.
- **Don't:** Die älteren Aliase `--brand`, `--brand-2`, `--accent` und `--focus` für neue Bausteine; sie heißen `--fach`, `--fach-text`, `--gelb` und `--fach-text`.
- **Don't:** Schulnamen, Schullogos oder Schulfarben; nichts von außen laden – keine fremden Schriften, Skripte oder Bilder.
- **Don't:** Gestaltungsmittel des Escape-Rooms (`.er-*`) in die Plattform übernehmen.
