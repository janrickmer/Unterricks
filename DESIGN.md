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
  # Projektionsfläche des Live-Fensters (in beiden Modi gleich)
  stage: "#0b111e"
  stage-text: "#cfd8e6"
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

**Character:** Eine Schrift, die für Lesbarkeit gebaut ist: Ähnliche Zeichen wie 0 und O oder I und l bleiben unterscheidbar, am Beamer wie auf dem iPad, freundlich, ohne kindlich zu wirken. Die Mono-Schwester macht Codes zu Kennungen, die man aus der letzten Reihe abtippen kann.

### Hierarchy
- **Display** (800, clamp(3.5rem, 15vw, 12rem), 1, Sperrung .1em, Mono): der Sitzungscode im Vollbild für den Beamer (`.codeshow .c`).
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

**Zweispalter in Karten.** Schulportal-Eintrag (Text | Vorschau, `1fr 1fr`, Abstand .9rem), Upload-Zonen und das Leupold-Schema (`minmax(140px, 1fr) minmax(0, 3fr) minmax(140px, 1fr)`) werden unter 800px einspaltig; Sitzungsdaten (`1fr 1fr`, .7rem) und Stundenfrage | Ablauf (`minmax(0, 1fr) minmax(0, 1.4fr)`) unter 560px. Breite Tabellen scrollen in `.table-wrap` waagerecht.

**Breakpoints.** 1000px (Sitzungsseite einspaltig), 900px (schmale Seiten ohne Fach: Folien schmaler), 800px (Zweispalter in Karten), 560px (Handy).

**Mobil (≤ 560px).** Seitenrand .75rem. Die Kopfleiste ist nicht mehr sticky, ihre Navigation bricht in eine eigene Zeile unter der Wortmarke um (`order: 3`, volle Breite, Links in .92rem). Im Band entfällt die letzte Brotkrume (die aktuelle Seite, `.cur`, wiederholt nur den Titel); Brotkrumen .84rem, Chips .86rem. Karten haben innen 1rem/.95rem; Listenzeilen brechen um, ihre Aktionen bekommen eine eigene Zeile.

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
- **Platz:** vorn in der Hauptspalte (davor stehen nur Vertretung und voriger Zwischenstopp). Das Backup bleibt erreichbar, drängt sich aber nicht vor – es ist eine normale Karte weiter unten.

### Abdeckblatt am Zwischenstopp (`stopField()`, `.covered`)
- **Reiter (`.stopfield`):** `--rot`, weiß, 700 in .9rem, Innenabstand .32rem .75rem, nur oben gerundet (8px), Pause-Symbol und „**Zwischenstopp** – bis hierher geschafft, ab hier weiterarbeiten“; er sitzt auf der Kante des Blatts.
- **Blatt (`.covered`):** `--paper` mit Schrift `--muted`, Oberkante 3px `--rot`, Schatten nach oben, über die volle Breite der Vorschau (`margin: 0 -1rem -.85rem`). Der Inhalt bleibt lesbar, aber sichtbar gedimmt; `aria-label` „Noch nicht aufgedeckt (nach dem Zwischenstopp)“.
- **„Aufdecken“:** `aufdecken`, .45s mit `--ease` aus `translateY(-10px)` bei jedem Neuzeichnen – das Blatt gleitet, wenn der Zwischenstopp verschoben wird.
- **Einsatz:** überall, wo `paintPortalPreview()` einen Schulportal-Eintrag zeichnet – in der Vorschau der Sitzung und im Hinweis auf den vorigen Zwischenstopp.

### Sitzungscode
- **Codekasten (`.code-box`):** `--fach-t`, Radius 12px, zentriert, Innenabstand .9rem .6rem .8rem; der Code in `.code-big`, darunter die Zahl der freigeschalteten Geräte (klein, `--muted`). Erste Karte der Seitenleiste, mit „Kopieren“ und „Für den Beamer zeigen“.
- **Beamer (`.codeshow`, `showCode()`):** Vollbild in der Fachfarbe mit großer Folie, der Code in Display-Größe; Knöpfe `rgba(10, 16, 30, .25)` mit Kante `rgba(255, 255, 255, .6)`. Neben dem Code (umbrechend darunter) der QR-Code zu unterricks.janrickmer.de auf einer weißen Karte (`.qrbox`, Radius 18px, Schatten `0 10px 30px rgba(10, 16, 30, .25)`, `clamp(160px, 30vmin, 340px)`, `image-rendering: pixelated`), darunter die Adresse in 800.

### Live-Fenster der Schüler:innen (`.live`)
- **Ruhend (`.live.idle`):** ein helles, kompaktes Feld in `--fach-t` mit Kante `color-mix(in srgb, var(--fach) 22%, transparent)`, Radius 16px, ohne Schatten; Titel „Noch keine Live-Präsentation“ in 800/1.08rem und `--fach-text`.
- **Live:** erst wenn eine Folie läuft, wird es zur Projektionsfläche – `stage`, 16:9, Radius 16px, `--shadow-lift`, das Bild mit `object-fit: contain` auf #000. Oben links die Abzeichen „LIVE“ und „Folie n / m“, unten rechts „Groß“ mit Erweitern-Symbol in `rgba(255, 255, 255, .14)` (Kante `rgba(255, 255, 255, .35)`, Hover `rgba(255, 255, 255, .24)`); im Vollbild ohne Radius.

### Präsentationsmodus (`.presenter`)
- Vollbild auf #000; unten eine Leiste in `rgba(11, 17, 30, .94)` mit Schrift #e8edf6 und Knöpfen in #1d2840 mit Kante #34405a; die Foliennummer in 800 mit tabellarischen Ziffern; „Präsentation für alle beenden“ als Live-Knopf. Nach kurzer Ruhe blendet die Leiste aus (.3s), der Mauszeiger verschwindet. „Bis hier gezeigt“ ist ein normaler Leistenknopf; seine Rückmeldung steht daneben als Text (`.markstate`), weil Toasts im Vollbild nicht zu sehen sind.

### Folienleiste der Präsentation (`.thumbs .thumb`)
- Waagerecht scrollende Leiste aller Folien (Höhe 74px, Radius 8px); die letzte gezeigte Folie trägt einen 3px-Ring in `--fach` und das Abzeichen „bis hier“ (`.badge.ink`), Folien danach erscheinen blass (Deckkraft .35, graustufig). Rechtsklick bzw. Kontextmenü-Taste öffnet das Kontextmenü; darunter die Auswahl „Letzte im Unterricht gezeigte Folie“ (`.shownbox`) und die Zeile zur Freigabe (`.presrel`).

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
- **Kontextmenü (`.ctxmenu`):** `--surface`, 1px `--line`, Radius 12px, `--shadow-lift`; Einträge in 700 mit Radius 8px, Hover und Fokus `--surface-2`.
- **Aufklapper (`details.box`):** Haarlinie oben, Titel in 700 mit gezeichnetem Winkel, der sich beim Öffnen um 90° dreht (.2s).

### Roter Hinweis (`.alarm`) – nur für die Notfall-Feibeitsblätter
- Volle Fläche `--rot` mit weißer Schrift in 600/.95rem (Kontrast 5,6 : 1), Radius 10px, Innenabstand .8rem 1rem, Ring `0 0 0 3px color-mix(in srgb, var(--rot) 30%, transparent)`, Warnsymbol in Weiß; „Achtung!“ in 800. Er eröffnet das eigene Kästchen `.notfallbox` unter dem Material (Schrift .9rem, also kleiner als das Material). Kein weiterer Einsatz: Rot als Fläche bleibt dieser einen Warnung (und dem Live-Knopf) vorbehalten.

### KI-Begriffshilfe (`.kihelp`)
- Eine normale Karte unter der Live-Präsentation (h2 1.1rem); Fragen in 700, Antworten auf `--paper` mit 1px `--line`, Radius 10px; der Verlauf scrollt ab 22rem. Die Einwilligung ist ein Dialog mit Liste (`.kiconsent`) und Kästchen (`.checkrow`); „Einwilligung zurücknehmen“ als Textknopf (`.linkbtn`, unterstrichen in `--fach-text`).

### Druckliste (`.printcard`, `.printrow`)
- Karte ganz unten in der Sitzung; je Datei der vollständige Druckname in 700, darunter in einer umbrechenden Zeile (`.pset`) Anzahl (Zahlfeld 5.2rem, „Exemplare“ in 700), beidseitig/einseitig und schwarz-weiß/Farbe als Auswahlfelder; Aktionen wie bei den übrigen Dateien. Darunter „Alle herunterladen (ZIP)“ und, als letzte Karte der Seite über die volle Breite, „Sitzung als Datei“ (`.sessionio`).

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
- **Don't:** Eine Warnfarbe einführen – kein Ocker, kein Orange.
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
