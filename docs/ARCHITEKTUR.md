# Unterricks – Architektur, Prüfergebnisse und Grenzen

Stand: 10.11.2026. Dieses Dokument beschreibt, wie die Plattform aufgebaut ist und welche Funktionen vollständig, eingeschränkt
oder bewusst nicht umgesetzt sind – mit Begründung. Es gibt keine Platzhalter-Funktionen: Was in der Oberfläche steht, ist
implementiert und im End-to-End-Test geprüft (Ausnahmen unten ausdrücklich genannt).

## 1. Entscheidungen der Lehrkraft (Rückfragen vom 10.11.2026)

| Frage | Entscheidung |
|---|---|
| Dateiablage | Cloudflare R2 (einmalige Aktivierung im Cloudflare-Konto mit Zahlungsmittel; bis 10 GB kostenlos) |
| KI-Wege | **Kostenlose Modelle** in der Plattform + **Connector für claude.ai** (Pro-Abo). Keine kostenpflichtige Claude-API |
| Präsentation | **Nur PDF** hochladen (Live-Ansicht und späterer Download) |
| Lehrkräfte | **Nur eine Lehrkraft** (wie Feibeitsblatt) |
| Lehrkraft-Sperre | 2 Fehlversuche → 30 min **je Gerät**; eigene, bekannte Geräte bleiben nutzbar; unbekannte Geräte zusammen höchstens 20 Fehlversuche je Stunde |
| Schulportal-Format | Formatierung laut Schulportal Hessen, Artikel 664; Struktur nach dem Beispiel der Lehrkraft |
| Feibeitsblatt-Passwort | ursprünglich bei jeder Anmeldung neu; **seit dem 10.11.2026 einmalig eingeben und Ende-zu-Ende verschlüsselt im Benutzerkonto speichern** (abwählbar), siehe 4g |
| Schülerzugang | **Gerätegebunden**, ohne Konten und ohne Personendaten |
| Datum (Ergänzung) | **Pflicht**, jederzeit änderbar – es wird **nur diese Sitzung** geändert (das Mitverschieben folgender Sitzungen entfällt seit der Ergänzung vom 10.11.2026; bei Krankheit gibt es stattdessen die Vertretungsalternative) |
| Hausaufgabe (Ergänzung) | eigenes Feld je Sitzung; Schüler:innen sehen sie „bis zur nächsten Sitzung“ (Datum automatisch) |
| Zwischenstopp (Ergänzung) | per Rechtsklick **vor** der angeklickten Zeile, **nur intern** (nicht im Schulportal); **nur Markierung** – beim Planen der nächsten Stunde ein Hinweis mit dem Eintrag der letzten Stunde |
| KI für Einheitenplanung und Vertretung | **Claude mit dem Pro-Abo über den Connector**; vorher fragt die Plattform Sprachmodell und Aufwand ab (Einstellung erfolgt in claude.ai) |
| Sitzungen aus der Einheit | **Automatisch mit Datum**: die festgelegte Einheit erzeugt je Zeile eine Sitzung (Termine aus Stundenplan, Zeitraum, Ferien, Klausur) |
| Oberstufe | **Grund- und Leistungskurs parallel** je Kurshalbjahr (Q1 GK … Q4 LK) |
| Ursprüngliche Planung bei Krankheit | **Archivieren** (wiederherstellbar, in eine andere Sitzung übertragbar) |
| Escape-Rooms | **Die Plattform hostet sie** (Vorlage mit dem bekannten Aufbau, Finale im Feibeitsblatt), siehe 4c |
| Foto-Abgabe | **Feibeitsblatt erweitert** um die Antwortart „Foto“ (Zweig `claude/foto-antwort` im Feibeitsblatt; wirksam, sobald er dort veröffentlicht ist), siehe 4b |
| Gestaltung (Ergänzung) | **Neuer Look „Folie & Aufdecken“** (Overhead-Folien in den Fachfarben, gelbe Markerfolie für den Hauptweg, Abdeckblatt am Zwischenstopp), freundlich und farbig, für Beamer, iPads und jüngere Schüler:innen – siehe [DESIGN.md](../DESIGN.md) |
| Eigene Adresse (Ergänzung) | **Oberfläche über GitHub Pages** unter `unterricks.janrickmer.de`, Server bleibt der Worker (keine Änderung an den übrigen Subdomains und an den Proton-Mail-Einträgen), siehe 4e |
| Kurse in Ev. Religion/Ethik (Ergänzung) | **Jg. 5–10 und E-Phase: ein Kurs je Jahrgang** mit Schüler:innen aus mehreren Klassen; die Lehrkraft wählt die Klassen, Schüler:innen wählen **wie bisher ihre Klasse**, siehe 4d |
| Chat-Name (Ergänzung) | Prompt „Stunde mit Claude planen“ beginnt mit „Jg. 8 - PoWi - Sitzung 1 - Titel“: **Titel der Sitzung**, **Stunde in der Einheit**, **nur der Jahrgang**, Oberstufe als „E-Phase“ bzw. „Q2 GK“ |
| Klassen je Jahrgang (Ergänzung) | **Acht Klassen a–h** in den Jahrgängen 5–10 und in der E-Phase (Jg. 11): 5A–10H, EA–EH (`public/shared.js`, `LETTERS`); Q-Phase unverändert GK/LK je Kurshalbjahr |
| Präsentation für Schüler:innen (Ergänzung) | Selbst öffnen erst **5 Minuten nach dem Ende der Sitzung** (Beginn + Dauer, statt 90 Minuten nach dem ersten Betreten); ohne Beginn **gesperrt**; die Lehrkraft markiert die **letzte gezeigte Folie** (Vollbild „Bis hier gezeigt“ oder in der Sitzung, auch per Rechtsklick) – Schüler:innen bekommen dann eine **gekürzte PDF** nur bis dorthin, siehe 4h. (Diese vier Einzelfragen blieben unbeantwortet; umgesetzt sind die empfohlenen Antworten.) |
| Hausaufgabe für Schüler:innen (Ergänzung) | erst **15 Minuten vor dem Ende der Sitzung** sichtbar (auch serverseitig), ohne Beginn verborgen, siehe 4h |
| Beginn der Sitzung (Ergänzung) | Uhrzeit **im Stundenplan der Einheit** je Wochentag (neue Sitzungen bekommen sie) und **in jeder Sitzung änderbar** |
| Notfall-Feibeitsblätter bei Schüler:innen (Ergänzung) | **eigenes Kästchen unter dem Material**, kleinere Schrift, beginnt mit dem roten Hinweis „Achtung! Eigentlich sollst du …“ (Wortlaut der Lehrkraft; nur das Komma vor „soll“ entfernt) |
| Beamer-Folie (Ergänzung) | Sitzungscode **mit QR-Code** zu https://unterricks.janrickmer.de |
| Links als Material (Ergänzung) | in **beiden Bereichen** (Schüler:innen / nur Lehrkraft) Links mit **Titel** und Internetadresse (nur http/https) |
| Druckliste (Ergänzung) | Karte **„Von der Lehrkraft auszudrucken“** ganz unten: **nur PDF**, alles **A4** (andere Formate beim Hochladen umgerechnet, mit Hinweis), Name **„28x - beidseitig - sw - Name.pdf“**, einzeln oder **als ZIP**; Claude legt Vorlagen über den Connector ab (`add_print_material`), siehe 4i |
| Sitzung als Datei (Ergänzung) | ganz unten **„Sitzung als Datei herunterladen“** („Unterrickssitzung - Fach - Jahrgang - Einheit - Sitzung Nr. n.zip“) und daneben **„Sitzung aus Datei laden“**; beim Laden bleiben Datum, Beginn und Dauer der geöffneten Sitzung, Datumsangaben in den Texten werden angepasst, siehe 4j |
| KI-Begriffshilfe (Ergänzung) | kleiner KI-Chat **unter der Live-Präsentation**, nur während der Stunde, nur Fachbegriffe/Unterrichtsinhalt in einer Sprache passend zur Jahrgangsstufe, **nur nach Einwilligung** („datenschutzrechtlich nicht für die Schule vorgesehen“), kostenlose KI; je Sitzung abschaltbar, siehe 4k |
| Notfall-Feibeitsblatt (Ergänzung) | Zu jedem Feibeitsblatt einer Sitzung **automatisch** das analoge Arbeitsblatt des Feibeitsblatts als PDF unter „Material – Für Schüler:innen zugänglich“ (dieselbe Datei wie im Feibeitsblatt), siehe 4f |
| Hausaufgabe im Schulportal (Ergänzung) | Kopie im Format „**Hausaufgabe zum 25. November 2026:**“, Leerzeile, Stichpunkte; zuletzt „Unter https://unterricks.janrickmer.de … mit dem Code ~~ABC-123~~ …“ (nur im Schulportal); ohne Hausaufgabe nur dieser Hinweis |

## 2. Gesamtarchitektur

```
 Browser Schüler:in (iPad)            Browser Lehrkraft (Laptop/Beamer)                 claude.ai (Pro-Abo)
 ┌──────────────────────┐            ┌──────────────────────────────────┐             ┌───────────────────┐
 │ Passwort → Klasse/   │            │ Planung · Schulportal · Prompts  │             │ Claude + Connector│
 │ Fach → Sitzungscode  │            │ Material · Präsentation (PDF.js) │             │ „Unterricks“      │
 │ Live-Fenster · Mat.  │            │ Feibeitsblatt-Client (WebCrypto) │──HTTPS────┐ └─────────┬─────────┘
 └─────────┬────────────┘            └──────────────┬───────────────────┘           │           │ MCP (Streamable HTTP)
           │ HTTPS + WebSocket                      │ HTTPS + WebSocket             │           │
 ┌─────────▼────────────────────────────────────────▼──────────────────────┐       │           │
 │ Cloudflare Worker „unterricks“ (worker/)                                 │◄──────┼───────────┘
 │  /api/*  Auth · Sitzungen · Chat · Schulportal · Dateien · Live · KI    │       │
 │  /mcp    Connector für claude.ai                                         │       │
 │   ├── D1  unterricks-db (EU): Sitzungen, Chat, Dateien-Metadaten, …     │       │
 │   ├── R2  unterricks-files (EU): Dateien, Präsentations-PDF, Folienbilder│       │
 │   ├── Durable Object LiveRoom (je Sitzung): Live-Folie per WebSocket     │       │
 │   └── kostenlose KI: Groq · Gemini · Cerebras · OpenRouter · Workers AI  │       │
 └──────────────────────────────────────────────────────────────────────────┘       │
                                                                                     ▼
                                                      Feibeitsblatt-Worker (bestehend, unverändert)
                                                      feibeitsblatt.feindt.workers.dev – Lehrkraft-API (CORS *)
```

* **Hosting:** ein Cloudflare Worker (Free-Plan) mit statischer Seite (`public/` → `dist/`), wie beim Feibeitsblatt.
  Deployment per GitHub Actions (`.github/workflows/deploy.yml`): automatisch bei jedem Push auf `main` oder den Arbeitsbranch
  `ccr-a0b9567a-04ain7` (nach den Unit-Tests), sonst von Hand. Zusätzlich dieselbe Seite über GitHub Pages
  (`unterricks.janrickmer.de`, `dist-pages/`), die den Worker als Server nutzt (Abschnitt 4e).
* **Datenbank:** D1 (SQLite) in der EU. Tabellen legt der Worker selbst an (`worker/db.js`).
* **Dateien:** R2 in der EU. Der Worker begrenzt die Ablage auf 9 GB, damit sie im kostenlosen Kontingent bleibt (`STORAGE_LIMIT_BYTES`).
* **Live-Synchronisation:** ein Durable Object je Sitzung (SQLite-Backend, im Free-Plan verfügbar) mit WebSocket-Hibernation.
  Fällt der WebSocket aus, fragt der Browser den Stand alle 2 s über HTTP ab.
* **Keine Fremdbibliotheken zur Laufzeit** außer PDF.js (Folienbilder im Browser der Lehrkraft) und pdf-lib (Textmaterial → PDF),
  beide gebündelt unter `/vendor/` (keine CDN-Abhängigkeit).

## 3. Komponenten und Dateien

| Bereich | Datei | Inhalt |
|---|---|---|
| Gemeinsam | `public/shared.js` | Fächer, Klassen/Kurse, Fach-Einstellungen, Codes, Schulportal-Format, fester System-Prompt, Claude-Prompts |
| | `public/planning.js` | Einheiten: Termine, Plan/Leupold-Schema, Zeilen, Claude-Prompts für Einheit und Vertretung |
| | `public/bases-detect.js` | Planungsgrundlagen: Abschnitte erkennen, welche Seiten für welche Klasse gelten, was fehlt |
| Server | `worker/index.js` | Routing, Fehler, Sicherheitskopfzeilen |
| | `worker/auth.js` | Lehrkraft (PBKDF2 im Browser, Token), Schüler:innen (gemeinsames Passwort), Sperren |
| | `worker/lessons.js` | Sitzungen, Chat, Schulportal (mit Versionsschutz), Feibeitsblatt-Entwürfe/-Verknüpfungen |
| | `worker/files.js` | Uploads, Textmaterial, Präsentation + Folienbilder, signierte Download-Links |
| | `worker/student.js` | Sitzungscode einlösen, Schüleransicht, zeitgesteuerte Freigabe (Präsentation, Hausaufgabe), KI-Begriffshilfe |
| | `worker/live.js` | Durable Object `LiveRoom`, Live-Tickets |
| | `worker/ai.js` | kostenlose KI-Anbieter, Modell je Aufgabe, Ausweichliste |
| | `worker/mcp.js` | Connector für claude.ai (MCP) |
| | `worker/bases.js` | Fach-Einstellungen, Planungsgrundlagen (Seitentexte), Zusammenstellung je Klasse/Kurs |
| | `worker/units.js` | Unterrichtseinheiten (Versionsschutz), Sitzungen aus der Einheit |
| | `worker/substitute.js` | Krankheitsvertretung: Vorschlag, Bestätigen (Archiv), Wiederherstellen, Übertragen |
| Oberfläche | `public/app.js` | Router, Startseite, Schüleransicht |
| | `public/teacher.js`, `public/session.js` | Lehrkräfteansicht (Fach → Klasse/Kurs → Einheiten), Sitzungsansicht |
| | `public/units.js`, `public/bases.js` | Seite der Unterrichtseinheit (Leupold-Schema, Tabelle), Planungsgrundlagen |
| | `public/substitute.js`, `public/claude.js` | Krankheitsvertretung in der Sitzung; Übergabe an Claude (Modell/Aufwand) |
| | `public/escape.js`, `public/escape-data.js` | Escape-Room-Vorlage (Oberfläche, Überblick-PDF); Prüfen/Bewerten, Zwischenstand, Feibeitsblatt-Datensatz |
| | `public/fbclient.js` | Feibeitsblatt-Client (Schlüsselableitung, Anlegen, Entschlüsseln) |
| | `public/fblink.js` | gespeicherte Feibeitsblatt-Verbindung (Schlüssel aus dem Unterricks-Passwort, IndexedDB) |
| | `public/pdfcut.js`, `public/a4.js`, `public/zip.js` | Präsentation kürzen, Druckvorlagen auf A4, ZIP schreiben/lesen |
| | `public/sessionfile.js` | Sitzung als Datei: Name, Datumsanpassung, Feibeitsblatt → Entwurf, Prüfung |
| | `public/notfall.js`, `public/fbanalog.js` | Notfall-Feibeitsblatt: Blatt, Checkliste und Bilder laden; das analoge Arbeitsblatt (aus dem Feibeitsblatt übernommen per `scripts/fbanalog-sync.mjs`) |
| | `public/presenter.js` | PDF → Folienbilder, Präsentationsmodus, Beamer-Code |
| | `public/pdfmaker.js`, `public/markdown.js` | Textmaterial als PDF, sicheres Markdown |

## 4. Abläufe und Abhängigkeiten

1. **Anmeldung und dauerhafte Zuordnung der Schüler:innen.** Passwort „Feindt“ (Groß-/Kleinschreibung egal) → der Server vergibt ein
   zufälliges Geräte-Token (im Browser gespeichert, auf dem Server nur als Hash). Klasse und Fach werden am Gerät gespeichert.
   Ein Sitzungscode wird nur angenommen, wenn er zu genau dieser Klasse und diesem Fach gehört. Danach steht die Freischaltung
   (mit dem Zeitpunkt des **ersten** Betretens) dauerhaft in `student_access`. Bei späteren Besuchen ist das Gerät angemeldet und
   die Sitzung steht in der Liste – ohne erneute Code-Eingabe. Jede Schüler-Abfrage prüft serverseitig diese Freischaltung.
   **Anmeldung höchstens 90 Minuten (Wunsch der Lehrkraft vom 10.11.2026):** `student_devices.auth_until` = Passworteingabe + 90 min
   (`STUDENT_LOGIN_MIN` in `public/shared.js`). Danach lehnt der Server jede Anfrage mit **403** `session_expired` ab – bewusst nicht 401,
   denn ältere, noch geöffnete Seiten löschten bei 401 den Token und mit ihm Freischaltungen, Fach und Klasse; unbekannte Geräte weiter mit
   401 `unauthorized`. Geräte von vor der Regel (ohne Frist) bekommen beim ersten Kontakt die 90 Minuten (kein Massen-Abmelden beim
   Ausrollen). Der Browser zählt mit (Zeitgeber auf die Restzeit aus den Antworten, `u.sauth`; geprüft auch nach dem Ruhezustand über
   `visibilitychange`/`pageshow` und in anderen Tabs über `storage` – abgelaufen wird vermerkt, nicht gelöscht) und zeigt dann die
   Passwortabfrage mit Hinweis. Der Token bleibt dabei gespeichert: Das erneute Passwort verlängert die Anmeldung desselben Geräts –
   Freischaltungen, Fach, Klasse und alles im Browser Gespeicherte (z. B. die Einwilligung zur KI-Begriffshilfe) bleiben, und es geht auf
   der vorigen Seite weiter (`u.sback`). Ein laufender Escape-Room sichert seinen Stand beim Abmelden im Browser (`u.esc.<Sitzung>`,
   Format und Prüfsumme der Zwischenstand-Datei; ein gerade gelöster Rätselraum wird als nächste Station gesichert) und fragt nach der
   Anmeldung „Weiter im Escape-Room? … Stand von Anna M. – Bist du das?“ (geteilte iPads), bevor er genau dort weitermacht. Gesicherte
   Stände werden beim nächsten Öffnen von Unterricks nach einem Tag gelöscht.
2. **Sitzungen.** Fach → Klasse/Kurs → Unterrichtseinheit → Sitzungen (siehe 4b). Jede Sitzung hat einen eigenen 6-stelligen Code.
3. **KI-gestützte Planung.** Der Chat schickt bei jeder Nachricht den festen System-Prompt (wörtlich nach Vorgabe) + Fach,
   Klasse/Jahrgang und alle Sitzungsdaten (inkl. Materialtexten und aktuellem Schulportal-Eintrag). Die Antwort wird gestreamt
   (der Worker reicht den Datenstrom nur durch, der Browser setzt die Antwort zusammen und speichert sie). Drei Modi: Planung,
   Ideen weiterentwickeln, Material erstellen – je mit eigenem Modell.
4. **Schulportal-Eintrag.** Die KI liefert eine Struktur (JSON), die Plattform setzt daraus den Text im Schulportal-Format
   zusammen (**fett**, ~~kursiv~~, „--> Nächste Stunde“). So können KI-Texte keine falschen Formatzeichen erzeugen (in Markdown
   bedeutet `~~` durchgestrichen, im Schulportal kursiv). Das Textfeld ist frei bearbeitbar, speichert automatisch (1,2 s nach
   der letzten Eingabe und beim Verlassen) und zeigt eine Vorschau. Jede Speicherung hat eine Versionsnummer: Eine ältere Fassung
   kann eine neuere nie still überschreiben (409 → Auswahl im Dialog) – auch nicht durch Claude über den Connector.
5. **Präsentations-Prompt.** Der Knopf ist erst aktiv, wenn das Textfeld einen Eintrag enthält. Der Prompt wird beim Klick
   **aus dem aktuellen Inhalt des Textfelds** gebaut (einschließlich gerade getippter, noch nicht gespeicherter Änderungen),
   in die Zwischenablage kopiert und dieser Stand sofort gespeichert. Eine ältere Fassung kann so nicht hineingeraten.
   Claude soll die Präsentation **nur als PDF** liefern (16:9, eine Seite je Folie, Text als Text) – keine PowerPoint-Datei; die PDF
   wird in Unterricks hochgeladen. **Folie 1 ist immer die Einstiegsfolie:** Sitzungscode der Sitzung (groß, Festbreitenschrift) und
   der QR-Code zu https://unterricks.janrickmer.de samt Adresse als Text, damit die Schüler:innen scannen und den Code eingeben. Den
   QR-Code bekommt Claude als genaues Modulmuster (`QR_UNTERRICKS`, 29 × 29, dasselbe wie `public/qr-unterricks.svg`; Unit-Test
   vergleicht mit `qrMatrix`, ausgelesen mit zxing geprüft) und soll ihn danach zeichnen statt ihn neu zu erzeugen. **Materialfolien:**
   Sollen die Schüler:innen mit Material arbeiten (Feibeitsblatt, Arbeitsblatt, Text, Link …), zeigt die Folie nur die Aufforderung
   (Sozialform, ggf. Aufgaben und Zeit), den Titel des Materials genau wie in Unterricks (Beispiel aus den Materialien der Sitzung) und
   wieder denselben QR-Code samt Sitzungscode – keine Inhalte oder Lösungen des Materials, keinen Code eines Feibeitsblatts (den kopiert
   Unterricks beim Öffnen selbst; zwei Codes auf einer Folie verwechseln Schüler:innen leicht), keine Notfall-Feibeitsblätter. Material
   „von der Lehrkraft auszudrucken“ sehen die Schüler:innen in Unterricks nicht (`area = 'print'`): Arbeiten sie nur damit, steht
   „(auf Papier)“ beim Titel und QR-Code, Sitzungscode und Hinweis auf Unterricks entfallen. In Jahrgang 5/6 (keine iPads,
   `isAnalogClass`) zeigen Materialfolien nur Aufforderung und Titel „(auf Papier)“; Folie 1 bleibt, mit dem Satz „Zu Hause findest du
   diese Sitzung in Unterricks: …“. Fehlt ein Material ganz (oder steht es nur „nur Lehrkraft“; in Jg. 5/6: jedes, das nicht auf der
   Druckliste steht), nennt Claude es im Chat. **Zeitlos:** Die Präsentation soll in ein paar Jahren in einer anderen Klasse desselben
   Jahrgangs noch passen – keine Daten der Lerngruppe (das Datum der Stunde steht gar nicht mehr im Prompt; Hausaufgabe „bis zur nächsten
   Unterrichtssitzung“), keine Klasse und keine Namen (höchstens `groupShort`, z. B. „Jg. 8“, auch im Dateinamen), Zeitgebundenes mit
   Jahreszahl statt „aktuell“; einzige Ausnahme ist der Sitzungscode. Hinweise für die
   Lehrkraft (statt Sprechernotizen) gibt Claude im Chat bzw. auf Wunsch über `add_text_material` (nur für die Lehrkraft).
6. **Präsentation und Live-Synchronisation.** Upload der PDF → der Browser der Lehrkraft rendert jede Seite mit PDF.js
   (1920 px) und lädt sie als Bild hoch. „Ich bin im Unterricht …“ öffnet das Vollbild und meldet die Folie an das Durable
   Object. Alle Schüler:innen der Sitzung bekommen per WebSocket die aktuelle Folie als **signierten Link nur für diese Folie** –
   sie können nicht vorblättern. Die PDF zum Selbstöffnen gibt der Server erst 5 Minuten nach dem Ende der Sitzung frei – bei markierter
   letzter Folie nur gekürzt (siehe 4h).
7. **Material.** Zwei Bereiche (Schüler:innen / nur Lehrkraft). Jede Schüler-Abfrage filtert serverseitig auf den
   Schülerbereich; Downloads laufen über kurzlebige signierte Links. KI-Material wird mit „Als Material übernehmen“ als
   Textmaterial gespeichert; Schüler:innen laden es als PDF (mit Namens-/Datumszeile) herunter, z. B. für GoodNotes.
8. **Feibeitsblatt.** Siehe Abschnitt 6.
9. **Einsicht in Schülerbearbeitungen.** Siehe Abschnitt 6.
10. **Claude.** Siehe Abschnitt 5.

## 4a. Datum, Hausaufgabe und Zwischenstopp (Ergänzung vom 10.11.2026)

* **Datum.** Jede Sitzung hat ein Datum (es kommt aus der Einheit). Ändern Sie es, wird nur diese Sitzung geändert; das neue
  Datum steht auch in der Zeile der Unterrichtseinheit. Folgende Sitzungen werden nicht mehr mitverschoben (Vorgabe vom 10.11.2026).
* **Hausaufgabe.** Feld „Hausaufgabe bis zur nächsten Sitzung“ in jeder Sitzung (automatisch gespeichert, Schulportal-Zeichen
  erlaubt, eigener Knopf zum Kopieren in das Hausaufgaben-Feld des Schulportals). Fällig ist sie zur zeitlich nächsten Sitzung
  derselben Klasse im selben Fach; das Datum wird bei jeder Anzeige neu bestimmt.
  Schüler:innen sehen sie im Sitzungsraum direkt unter dem Live-Fenster („Bis zur nächsten Sitzung am Di, 17.11.2026:“) und als
  Markierung in ihrer Sitzungsliste. Sie geht außerdem in den KI-Kontext, den Connector und den Präsentations-Prompt (letzte Folie).
* **Zwischenstopp.** Rechtsklick auf eine Zeile des Verlaufsplans – im Textfeld oder in der Vorschau – → „⏸ Zwischenstopp
  einfügen“. Die Plattform setzt eine eigene Zeile `⏸ Zwischenstopp` **vor** die angeklickte Zeile (ab hier offen); in der Vorschau
  erscheint sie als kleines Feld. Je Eintrag gibt es höchstens einen Zwischenstopp (erneutes Einfügen verschiebt ihn); entfernen per
  Rechtsklick auf das Feld oder Knopf. Auf dem iPad (kein Rechtsklick): Zeile in der Vorschau antippen oder Knopf „Zwischenstopp
  einfügen“ (vor der Zeile mit der Schreibmarke). Umschalt + Rechtsklick öffnet weiterhin das normale Menü des Browsers.
  Der Zwischenstopp ist **intern**: „Eintrag kopieren“ und der Präsentations-Prompt lassen ihn weg. Wer den Text von Hand im
  Textfeld markiert und kopiert, kopiert ihn allerdings mit – dafür ist der Knopf da.
* **Hinweis in der nächsten Stunde.** Öffnen Sie die nächste Sitzung derselben Klasse (die zeitlich direkt folgende) oder legen Sie
  eine neue an, erscheint der Hinweis „Die letzte Stunde wurde nicht vollständig beendet“ mit dem Schulportal-Eintrag der letzten
  Sitzung samt markiertem Zwischenstopp. Inhalte werden nicht automatisch übernommen (Entscheidung der Lehrkraft). Maßgeblich für
  den Hinweis beim Anlegen ist die zuletzt gehaltene Sitzung (Datum bis heute).

## 4b. Unterrichtseinheiten, Planungsgrundlagen, Krankheitsvertretung (Ergänzung vom 10.11.2026)

* **Fächer und Jahrgänge.** Unter *Planungsgrundlagen → Fach → Fach-Einstellungen* steht, in welchen Jahrgängen ein Fach
  unterrichtet wird. Vorgabe für Politik und Wirtschaft: Jahrgänge 6, 8, 9, 10 (Hinweis: nur 1. Halbjahr), E-Phase und Q-Phase;
  Jahrgang 7 entfällt. Lehrkraft und Schüler:innen sehen bei der Klassenwahl nur diese Jahrgänge; der Server lehnt andere ab.
  Die Q-Phase hat je Kurshalbjahr einen **Grund- und einen Leistungskurs** (Q1 GK … Q4 LK) – KCGO und Abiturerlass unterscheiden
  grundlegendes und erhöhtes Niveau. Die „Planungsregeln für die KI“ (Vorgabe: die Hinweise der Lehrkraft zu Schulcurriculum,
  KCGO, Abiturerlass und G9) gehen in jeden Planungs-Prompt.
* **Jahrgänge 5 und 6 (keine iPads).** Die KI plant dort nur analoges, ausdruckbares Material (PDF); die Sitzungsansicht bietet
  kein Feibeitsblatt an, Vertretungen ohne digitale Formate. Der Sitzungscode funktioniert trotzdem (z. B. für Materialdownload).
* **Planungsgrundlagen.** Die Lehrkraft lädt je Fach die Vorgaben als PDF hoch: Schulcurriculum (Sek I), KCGO, schulinternes
  E-Phasen-Curriculum, Abiturerlass (je Abiturjahrgang, den Q-Kursen zugeordnet), Sonstiges. Der **Browser** liest den Text jeder
  Seite (PDF.js), die PDF selbst wird nicht gespeichert – schulinterne Dokumente liegen also nur als Text in der eigenen Datenbank,
  nicht im öffentlichen Repository. Die Plattform erkennt die Abschnitte (geprüft an den echten Dokumenten: KCGO-Kapitel 2,
  3.2, 3.3 und Kurshalbjahre E1–Q4; Fachteil im Abiturerlass; Jahrgänge im Schulcurriculum „(8_1)“ bzw. „Jahrgang 6“;
  E1/E2 im E-Phasen-Curriculum); die Lehrkraft kann jede Seitenangabe korrigieren. Für jede Klasse bzw. jeden Kurs stellt die
  Plattform daraus die geltenden Seiten zusammen (Vorrang: Fachteil des Erlasses, Kurshalbjahr/Jahrgang, verbindliche Regeln,
  Grundlagen) und zeigt, was fehlt. Für Ev. Religion und Ethik kennt die Plattform die schulischen Vorgaben nicht: Sie fordert zum
  Hochladen auf, die Vollständigkeit bestätigt die Lehrkraft (Häkchen in den Fach-Einstellungen).
  Grenze: Eingescannte PDFs ohne Textebene lehnt die Plattform ab (keine Texterkennung im Browser).
* **Unterrichtseinheit.** Nach der Klassenwahl wird zuerst die Einheit geplant: (1) Rahmendaten – Sitzungen pro Woche mit Länge,
  Beginn, Ende, Klausurtermin, Ferien/Ausfälle → die Plattform berechnet die Termine; (2) Planungsgrundlagen-Status;
  (3) „Einheit mit Claude planen“: Modell/Aufwand wählen, Prompt kopieren, in claude.ai einfügen. Claude liest die Grundlagen
  mit `get_planning_basis`, fragt in Politik und Wirtschaft nach der Planungsgrundlage (priorisierter und sekundärer Vorschlag mit
  Begründung), schlägt drei zentrale Lernaufgaben vor, entwickelt nach Ihrer Entscheidung das Leupold-Schema und die Tabelle und
  speichert mit `save_unit_plan`; (4) Leupold-Schema (links Ausgangslage, Mitte Lernschritte als Tätigkeitsbeschreibung mit
  Operatoren + Titel, rechts Lernaufgabe) und (5) Tabelle (Spalte 1 Stundenfrage, Spalte 2 grober Ablauf) sind bearbeitbar und
  bleiben das ganze Schuljahr änderbar; Claude und die Lehrkraft können sich nicht still überschreiben (Versionsschutz).
  (6) „Einheit festlegen und Sitzungen anlegen“ erzeugt je Zeile eine Sitzung mit Datum und Dauer; die Stundenfrage wird zum Titel.
  Eine freie Sitzung ohne Einheit gibt es nicht mehr (auch nicht über den Connector).
* **Stundenplanung mit Bezug zur Einheit.** Die Sitzung zeigt Einheit, Stunde x von n, Stundenfrage, groben Ablauf und das
  Leupold-Schema (Lernschritt der Stunde fett). Der Planungsassistent bekommt die Einheit mit und die feste Regel, sich auf
  Lernaufgabe, Lernschritt und Stundenfrage zu beziehen; der Ablauf ist nur Inspiration. Weicht er begründet ab, schlägt er die
  Änderung in einem Block vor, den die Lehrkraft mit „In die Einheit übernehmen“ in die Tabelle schreibt (Claude über den
  Connector: `update_unit_row`, nur nach Zustimmung).
* **Krankheit.** Jede Sitzung hat den Knopf „Lehrkraft ist zu dieser Sitzung krank – Alternative entwickeln“. Die Plattform fragt
  Modell und Aufwand ab und kopiert einen Prompt: Claude liest die geplante Stunde, untersucht Kompetenz, Stundenfrage und
  Lerninhalte und entwickelt eine Vertretung für ca. 80 % der Zeit mit chronologischer Anleitung, Material, Schulportal-Eintrag,
  Hinweisen für die Vertretungslehrkraft und einer **Abgabe** (ab Jahrgang 7 Pflicht: Feibeitsblatt; Jahrgang 5/6: Papier) und
  speichert sie mit `save_substitute_plan` als Vorschlag. Die Lehrkraft prüft ihn (das Feibeitsblatt im bekannten Editor) und
  bestätigt: Dann legt der Browser das Feibeitsblatt an, die ursprüngliche Planung (Schulportal-Eintrag, Hausaufgabe, Material,
  Feibeitsblatt-Verknüpfungen) wird **archiviert**, das Vertretungsmaterial eingesetzt, und die Schüler:innen sehen ganz oben
  „Heute ohne deine Lehrkraft“ mit der Schritt-für-Schritt-Anleitung. Wiederherstellen und Übertragen der archivierten Planung in
  eine andere Sitzung sind jederzeit möglich.
* **Foto-Abgabe (Lernprodukte).** Aufgaben mit der Antwortart „Foto“ (`{type:"photo"}`, höchstens 3 je Blatt, ohne Auftrag an
  die KI – Fotos gehen im Feibeitsblatt nie an die KI). Die Schüler:innen fotografieren ihr Lernprodukt im Feibeitsblatt; der Browser
  verkleinert das Bild (längste Seite ≤ 1280 px, ≤ 200 KB, ohne EXIF-Daten) und gibt es verschlüsselt ab. Unterricks zeigt das Foto
  in „Abgaben ansehen“ (nur nach Prüfung: JPEG als data:-URL in der Form des Feibeitsblatts) zum Vergrößern und Speichern.
  Voraussetzung ist die Erweiterung des Feibeitsblatts (Zweig `claude/foto-antwort`, dort per Pull Request nach `main` zu
  veröffentlichen). Kennt das Feibeitsblatt die Antwortart noch nicht, meldet Unterricks das beim Anlegen klar.
  Grenzen (laut Erweiterung): mit Fotos je Abgabe etwa 0,2–0,8 MB – die kostenlose D1-Datenbank des Feibeitsblatts (500 MB) und das
  Abgabe-Kontingent je Schulnetz (60 MB/Stunde) füllen sich schneller; auf echten Geräten (Kamera, HEIC) noch nicht erprobt.

## 4c. Escape-Room-Vorlage der Plattform (Ergänzung vom 10.11.2026)

* **Aufbau wie in den bekannten Escape-Rooms der Lehrkraft** (Vorbild: „FastFashion“, datengetriebene Fassung; Rätselarten auch
  aus „Stunde Null“): Anmeldung (Vorname, Nachname, Geburtsdatum, Klasse/Kurs – vorausgefüllt) → Einführung mit Rahmengeschichte und
  „So läuft es ab“ → sechs Stationen, jede **Bibliothek** (nummerierte Sachtext-Abschnitte, Warnung „kein Weg zurück – mach dir
  Notizen“) und **Rätselraum** (1–3 Teile) → je gelöstem Raum ein Buchstabe des 6-buchstabigen Lösungsworts (Siegel in der
  Kopfleiste) → Finale mit dunkler Arena und Tunnel ins Feibeitsblatt.
* **Rätselarten:** Einfachwahl, Mehrfachwahl, Zuordnung, zwei Körbe, Lückentext (frei oder mit Wortbank inkl. Ablenkern), Zahl
  (mit „ca.“, Einheiten, Zahlwörtern), Schlussstein (letzte Station). Unvollständige Eingaben zählen nicht als Versuch.
  Freie Antworten werden wie in „FastFashion“ verglichen (Groß-/Kleinschreibung, Anführungszeichen, Satzzeichen am Ende, Umlaute
  ä/ae, Leerzeichen und Bindestriche egal). Hilfe in drei Stufen je Versuch: **wo es stand** (Abschnitt), **wie die Antwort
  beginnt**, **die Lösung**. Fehler werden nur beim **ersten Versuch** festgehalten; ein schneller Doppeltipp zählt nicht doppelt.
* **Zwischenstand-Datei** (ab Station 2 und im Finale): `.txt` mit verschleiertem Inhalt und Prüfsumme, gilt nur für diesen Raum;
  Laden auf der Anmeldeseite, die Nutzung steht später in der Überblick-PDF. Ohne Datei geht der Fortschritt beim Neuladen verloren
  (wie in den bekannten Räumen gibt es keine Speicherung im Browser oder auf dem Server); die Seite fragt vorher nach.
* **Überblick-PDF** „Überblick deiner Antworten & Erläuterungen“ (Angaben, Bestätigungscode, Fehler im ersten Versuch je Station),
  „Lösungserläuterungen“, „Verwendung von Zwischenstand-Dateien“ – mit Link zum Feibeitsblatt und dem Datensatz als eingebettete
  Datei (`feibeitsblatt-escape.json`, Kennzeichen `/FbEscape 1`), damit das Finale später über „Zwischenstand-PDF hochladen“
  fortgesetzt werden kann.
* **Finale im Feibeitsblatt (Schnittstelle v1, unverändert):** Beim Bestätigen der Vertretung legt der Browser der Lehrkraft das
  Finale-Blatt mit `escape = {id, name}` an (Kennung je Raum `unterricks-…`). Der Tunnel öffnet
  `FEIBEITSBLATT_URL#escape=<Hülle>` im selben Tab; die Hülle `{kind:"feibeitsblatt-escape", v:1, d, s}` enthält Code, Raum,
  Person, Bestätigungscode, Lösungswort, Versuche und Fehler im ersten Versuch je Station, Lösungserläuterungen und
  Zwischenstands-Protokoll; `s` ist die Prüfsumme des Feibeitsblatts (Testvektoren identisch). Die Auswertung (KI-Rückmeldung,
  Abgaben) bleibt im Feibeitsblatt; Unterricks zeigt das Finale-Blatt in der Sitzung („Abgaben ansehen“), Schüler:innen sehen es
  nicht als normales Feibeitsblatt (sie erreichen es nur über den Tunnel).
* **Inhalte von Claude:** `save_substitute_plan` mit `escape_room`. Die Plattform prüft streng (genau 6 Stationen, Lösungswort aus
  6 Buchstaben A–Z, genau eine richtige Option bei Einfachwahl, Zuordnungs-Antworten wörtlich in den Optionen, jede Lücke genau
  einmal, Abschnittsnummern, Finale-Aufgaben …) und meldet Fehler mit genauer Stelle an Claude zurück. Die Lehrkraft sieht den Raum
  vor dem Bestätigen in einer **Vorschau** (mit Sprung zu jeder Station).
* **Gestaltung:** helles, seriöses Design wie „Stunde Null“ (Petrol/Ocker, Serifen-Überschriften, Karten mit Ockerkante, dunkle
  Arena mit goldenem Tunnel) – mit Systemschriften, ohne externe Schriftarten.
* **Geprüft:** End-to-End-Test spielt alle sechs Stationen mit allen Rätselarten durch (Hilfe-Stufen, Fehler, Lösungswort,
  Überblick-PDF, Zwischenstand, Tunnel; Prüfsumme und Datensatz werden nachgerechnet). Gegen das echte Feibeitsblatt wurde der Weg
  durch Lesen seines Codes abgeglichen (Prüfsumme, Hülle, PDF-Leser); ein Durchlauf mit dem echten Feibeitsblatt steht noch aus.

## 4d. Kurse in Ev. Religion und Ethik (Ergänzung vom 10.11.2026)

* **Kennung:** Je Jahrgang 5–10 und E-Phase gibt es in Ev. Religion und Ethik höchstens einen Kurs mit der Kennung
  `<Jahrgang>-K` (`8-K`, `E-K`; `public/shared.js`: `COURSE_CLASSES`, `isCourseClass`, Anzeige `classShort` → „Kurs Jg. 8“,
  „Kurs E-Phase“). Sitzungen und Einheiten des Kurses tragen diese Kennung wie sonst eine Klasse; Jahrgangsstufe, analoges
  Material in Jg. 5/6 und Planungsgrundlagen richten sich nach dem Jahrgang (`gradeKey`).
* **Klassen des Kurses:** in den Fach-Einstellungen (`settings.subjects.<fach>.courses = {"8": ["8A", "8B", "8D"]}`), gesetzt über
  `PUT /api/teacher/subjects/:fach` mit `courses` (nur echte Klassen dieses Jahrgangs, mindestens eine; Politik und Wirtschaft
  → 400). Beim Speichern ziehen Sitzungen und Einheiten, die bisher in einer dieser Klassen lagen, in den Kurs um (je Jahrgang
  gibt es nur einen Kurs); die Antwort nennt die Zahl (`moved`).
* **Schüler:innen** wählen weiter ihre eigene Klasse. Beim Einlösen eines Codes prüft der Worker bei Kurs-Sitzungen, ob die
  Klasse zum Kurs gehört (`courseMembers`, eine D1-Abfrage mehr nur in diesem Fall). Schüler:innen einer später entfernten
  Klasse behalten die schon freigeschalteten Sitzungen. Im Escape-Room wird ihre eigene Klasse vorbelegt, nicht die Kurskennung.
* **Oberfläche:** Fach → je Jahrgang „Kurs anlegen“ bzw. „Kurs Jg. 8“ mit „Klassen ändern“; ältere Sitzungen in einzelnen
  Klassen außerhalb des Kurses bleiben verlinkt. Der Hinweis beim Sitzungscode nennt die Klassen des Kurses. Der Connector
  (`worker/mcp.js`) kennt die Kurse (`8-K` in der Klassenliste, Hinweis in den Anweisungen).

## 4e. Eigene Adresse über GitHub Pages (Ergänzung vom 10.11.2026)

* **Aufbau:** `PAGES_API=<Worker-Adresse> npm run build` erzeugt `dist-pages/`: dieselben Dateien wie `dist/`, dazu in
  `index.html` `<meta name="unterricks-api">` (Server-Adresse) und die CSP als `<meta http-equiv>` (GitHub Pages setzt keine
  eigenen Header; `_headers` entfällt). Im Browser setzt `public/ui.js` (`API`, `apiUrl`, `wsUrl`) alle Pfade `/api/…` – auch
  signierte Links aus Antworten (Downloads, Folien) und den WebSocket der Live-Präsentation – auf den Worker.
* **Worker:** CORS nur für die Herkünfte in `PAGES_ORIGINS` (`wrangler.jsonc`, `https://unterricks.janrickmer.de`; lokal für
  Tests auch `http://localhost:PORT`), Vorabanfragen (OPTIONS) 204 bzw. 403. Angemeldet wird ausschließlich per
  `Authorization: Bearer`, nie per Cookie – fremde Seiten erhalten dadurch nichts.
* **Schutz gegen Einbetten:** `frame-ancestors` wirkt nicht als `<meta>`; deshalb zeigt `app.js` in einem fremden Rahmen nichts an.
* **Veröffentlichung:** Job „pages“ im Workflow **Deploy** (nach dem Worker, mit dessen Adresse; `actions/upload-pages-artifact`
  v5.0.0 und `actions/deploy-pages` v5.0.1, per Commit-SHA gepinnt; alle Actions des Workflows laufen auf Node.js 24 – seit dem
  10.11.2026 auch `actions/checkout` v7.0.1 und `actions/setup-node` v7.1.0, weil GitHub Node.js 20 abkündigt). Er läuft nur, wenn im Repository Pages mit der Quelle
  „GitHub Actions“ eingerichtet ist, sonst gibt er einen Hinweis aus. Die eigene Domain wird in den Pages-Einstellungen
  eingetragen (eine `CNAME`-Datei wertet GitHub bei Actions nicht aus).
* **Datenschutz:** GitHub, Inc. (USA) erhält beim Laden der Seite die IP-Adresse. Unterricks hat bisher keinen eigenen
  Datenschutzhinweis – vor dem Einsatz mit Schüler:innen ergänzen (nicht Teil dieser Ergänzung).
* **Getestet:** End-to-End mit einer zweiten Herkunft (statischer Server, keine Header): Anmeldung von Lehrkraft und Schüler:in,
  alle Anfragen am Worker, WebSocket, Download-Link, keine CSP- oder CORS-Fehler, eingebettet keine Anzeige. Mit der echten
  Domain noch nicht – das geht erst nach dem Einrichten von Pages.

## 4f. Notfall-Feibeitsblätter (Ergänzung vom 10.11.2026)

* **Was:** Das analoge Arbeitsblatt eines Feibeitsblatts (im Feibeitsblatt „Analoges Arbeitsblatt als PDF herunterladen“) heißt in
  Unterricks **Notfall-Feibeitsblatt**. Zu jedem mit der Sitzung verknüpften Blatt liegt es als PDF „Notfall-Feibeitsblatt – <Titel>.pdf“
  unter „Material – Für Schüler:innen zugänglich“ – für den Fall, dass digital nichts geht.
* **Dieselbe Datei wie im Feibeitsblatt:** `public/fbanalog.js` enthält den Code des Feibeitsblatts unverändert (`makeAnalogPdf` mit
  allen Bausteinen: PDF ohne Bibliothek, Bilder, Tabellen, Weltkarte, Foto-Rahmen, QR-Codes zu Videos und zur Checkliste). Erzeugt wird
  er von `scripts/fbanalog-sync.mjs` aus `index.html` des Feibeitsblatts (benannte Deklarationen und die markierten Blöcke VIDEO,
  PDFPLAIN, QR, WORLDMAP) – nicht von Hand ändern. `test/unit/fbanalog.test.mjs` prüft Aufbau, Inhalt und QR-Code.
* **Ablauf:** Der Browser der Lehrkraft erzeugt die PDF (`public/notfall.js`), sobald die Verbindung zum Feibeitsblatt besteht – beim
  Anlegen, Verknüpfen, Verbinden und Öffnen der Sitzung. Er liest das Blatt und die bestätigte Checkliste über die
  Lehrkraft-Schnittstelle und die Bilder über die öffentliche; fehlt ein Bild, entsteht keine (unvollständige) PDF. Hochgeladen wird über
  `POST /api/teacher/lessons/:id/sheets/:code/notfall?sig=…` (nur PDF, nur verknüpfte Blätter, nie zum Finale eines Escape-Rooms); die
  neue PDF ersetzt die bisherige desselben Blattes (`files.fb_code`). `fb_sig` hält den Stand fest (`v1`, `-qr` mit QR-Code zur
  bestätigten Checkliste, `-ki` mit dem Satz zur KI-Rückmeldung) – ändert er sich, wird die PDF erneuert (z. B. nach dem Bestätigen
  der Checkliste). Entfernen des Blattes aus der Sitzung löscht sie mit; bei der Krankheitsvertretung wandert sie wie das übrige
  Material ins Archiv. Beim Übertragen der archivierten Planung in eine andere Sitzung wird sie nicht mitkopiert – sie entsteht dort,
  sobald das Feibeitsblatt mit der Zielsitzung verknüpft ist.
* **Inhalt:** nur, was auch auf dem gedruckten Arbeitsblatt des Feibeitsblatts steht – nie Aufträge an die KI, Länder der
  Weltkarte, Checklistenpunkte oder Abgaben.
* **Nachholen für bestehende Sitzungen (Wunsch der Lehrkraft vom 10.11.2026):** Blätter, die verknüpft wurden, bevor es
  Notfall-Feibeitsblätter gab (oder ohne Verbindung zum Feibeitsblatt), bekommen ihre PDF ohne dass jede Sitzung geöffnet werden muss.
  `GET /api/teacher/notfall` nennt alle verknüpften Blätter (ohne Finale eines Escape-Rooms, ohne die analogen Jahrgänge 5 und 6) mit
  dem Stand ihres Notfall-Feibeitsblatts (`fileId`, `sig`). Der Browser der Lehrkraft (`notfallBackfill` in `public/teacher.js`) startet
  einmal je Seitenaufruf im Hintergrund, sobald die Verbindung zum Feibeitsblatt besteht (gespeicherte Verbindung, sonst nach dem
  Verbinden bzw. Entsperren in einer Sitzung): Er erzeugt je Blatt **eine** PDF und lädt sie in jede Sitzung hoch, der sie fehlt;
  Meldung am Ende, Stand und Fehler (z. B. Blatt im Feibeitsblatt gelöscht) unter *Einstellungen → Feibeitsblatt*. „Alle prüfen und
  aktualisieren“ erneuert dort zusätzlich veraltete (anderer `sig`). Sitzungsseite und Hintergrundlauf arbeiten nie gleichzeitig an
  derselben Sitzung und demselben Blatt (`notfallOnce` in `public/notfall.js`: der zweite wartet und übernimmt das Ergebnis); kommen
  trotzdem zwei Uploads gleichzeitig an (zwei Geräte), löscht jeder nur ältere Einträge (`rowid`), so bleibt genau die zuletzt angelegte
  PDF stehen; die ältere Anfrage bekommt diese als Antwort (`superseded: true`). Wurde das Blatt während des Hochladens aus der Sitzung
  entfernt, verwirft der Server die neue PDF (404) – das Entfernen löscht dafür erst die Verknüpfung, dann die PDFs. Bleibt ein Blatt
  dauerhaft ohne PDF (z. B. im Feibeitsblatt gelöscht), meldet der Hintergrundlauf das je Gerät nur einmal; die Einzelheiten stehen in den
  Einstellungen. Ein abgebrochener Lauf (Abmelden, abgelaufene Anmeldung) beginnt beim nächsten Seitenaufruf neu; eine späte
  401-Antwort aus der Zeit vor dem erneuten Anmelden meldet nicht ab (`tapi` vergleicht die Anmeldung, mit der die Anfrage lief).
  Wurde ein Notfall-Feibeitsblatt „nur für Lehrkräfte“ gestellt, bleibt auch das erneuerte dort.

## 4g. Feibeitsblatt-Verbindung einmalig speichern (Ergänzung vom 10.11.2026)

* **Ende-zu-Ende verschlüsselt:** Aus dem Unterricks-Passwort leitet der Browser per PBKDF2-SHA-256 (600 000 Iterationen) 64 Byte ab.
  Die ersten 32 sind wie bisher der Anmeldeschlüssel (bestehende Zugänge gelten weiter), die zweiten 32 verlassen den Browser nie und
  ergeben per HKDF (`unterricks/fb-link/v1`) einen AES-GCM-Schlüssel. Damit verschlüsselt der Browser den **Feibeitsblatt-Schlüssel**
  (das PBKDF2-Ergebnis des Feibeitsblatt-Passworts, nie das Passwort selbst) und die Adresse der Schnittstelle. Der Server bewahrt nur
  den Umschlag `{v, iv, ct}` auf (`settings.fb_link`, `GET`/`PUT`/`DELETE /api/teacher/fb-link`).
* **Je Gerät:** Nach der Anmeldung mit dem Passwort liegt der Schlüssel **nicht exportierbar** in IndexedDB; Unterricks verbindet sich
  danach bei jedem Öffnen einer Sitzung automatisch. Abmelden löscht ihn auf dem Gerät. Geräte, die schon vorher angemeldet waren (oder
  ohne IndexedDB), entsperren die Verbindung einmal mit dem Unterricks-Passwort (eine erneute Anmeldung mit denselben Sperren).
* **Passwortwechsel:** Der Browser entschlüsselt den Umschlag mit dem alten und verschlüsselt ihn mit dem neuen Schlüssel; der Server
  speichert ihn im selben Batch wie das neue Passwort (ohne neuen Umschlag wird er gelöscht). Ändert sich das Feibeitsblatt-Passwort,
  meldet die Sitzung „gilt nicht mehr“ – neu verbinden ersetzt sie. „Gespeicherte Verbindung löschen“ (Sitzung, Einstellungen) gilt für
  alle Geräte.

## 4h. Beginn der Sitzung: Hausaufgabe, Präsentation, letzte gezeigte Folie (Ergänzung vom 10.11.2026)

* **Beginn:** `lessons.start_time` („HH:MM“), im Stundenplan der Einheit je Wochentag vorbelegt (`params.weekdays[].time` → Termine →
  Zeilen → Sitzungen) und in der Sitzung änderbar (auch `update_lesson` mit `beginn`). `lessonTimes` (`public/shared.js`) rechnet mit
  Europe/Berlin samt Sommerzeit: Hausaufgabe ab Ende − 15 min, Präsentation ab Ende + 5 min. Ohne Beginn oder Dauer bleiben beide für
  Schüler:innen verborgen – auch in der Sitzungsliste und per Schnittstelle. Die Schüleransicht lädt sich zu diesen Zeitpunkten neu.
* **Letzte gezeigte Folie:** im Vollbild „Bis hier gezeigt“ (aktuelle Folie), in der Sitzung per Auswahl oder Rechtsklick auf eine
  Folie. Der Browser der Lehrkraft kürzt die PDF mit pdf-lib (`public/pdfcut.js`, Seiten unverändert kopiert) und lädt sie hoch
  (`PUT /api/teacher/files/:id/shown?until=n`, R2 `…-bis`, `files.shown_until`/`cut_size`). Schüler:innen bekommen danach nur diese
  Datei („… (Folie 1–n).pdf“, eigener signierter Link); fehlt sie, gibt es nichts (nie die vollständige). Die Live-Anzeige bleibt
  unberührt.

## 4i. Druckliste „Von der Lehrkraft auszudrucken“ (Ergänzung vom 10.11.2026)

* Bereich `print` (für Schüler:innen nie sichtbar) mit `files.print_copies`, `print_duplex`, `print_color`. Nur PDF (Kennung `%PDF-`
  im Browser und auf dem Server geprüft). Vor dem Hochladen rechnet `public/a4.js` jede Seite, die nicht A4 ist, auf A4 um (Hoch- bzw.
  Querformat wie die Seite, auch gedrehte Seiten) und meldet, wie viele Seiten betroffen waren.
* Name beim Herunterladen `printFileName`: „28x - beidseitig - sw - Name.pdf“; neue Vorlagen übernehmen die zuletzt verwendete Anzahl
  der Klasse, sonst 1, beidseitig, schwarz-weiß. „Alle herunterladen (ZIP)“ packt im Browser (`public/zip.js`, ohne Kompression).
* Claude legt Vorlagen mit `add_print_material` an (Markdown → A4-PDF beim Herunterladen, mit Anzahl, beidseitig und Farbe); der
  Prompt „Stunde mit Claude planen“ nennt das Werkzeug. Bei einer Vertretung kommt die Druckliste mit ins Archiv.

## 4j. Sitzung als Datei (Ergänzung vom 10.11.2026)

* **Herunterladen:** ZIP mit `sitzung.json` (Titel, Thema, Ideen, Hausaufgabe, Schulportal-Eintrag, Planungsverlauf, Materialien,
  Links, Druckliste, Feibeitsblätter als Entwürfe – ihr Inhalt kommt bei bestehender Verbindung aus dem Feibeitsblatt, ohne Bilder und
  Weltkarten) und den Dateien unter `dateien/`. Notfall-Feibeitsblätter, Archiv und Vertretung bleiben draußen.
* **Laden:** in der geöffneten Sitzung nach einer Übersicht; Titel, Thema, Ideen, Hausaufgabe, Schulportal-Eintrag und Planungsverlauf
  ersetzen den bisherigen Stand (`POST /api/teacher/lessons/:id/import`, ein Batch), Materialien, Links, Druckvorlagen, Präsentation
  und Entwürfe kommen dazu. **Datum, Beginn und Dauer bleiben die der geöffneten Sitzung.** `adaptDates` ersetzt in den Texten das
  Datum der ursprünglichen Sitzung und das ihrer nächsten Sitzung durch die der neuen (Schreibweisen 25.11.2026, 25.11., 2026-11-25,
  25. November, mit Wochentag); andere Datumsangaben bleiben und werden zum Prüfen genannt. Feibeitsblätter kommen als Entwürfe – mit
  „Feibeitsblatt jetzt anlegen“ bekommt jedes einen neuen Code für die neue Lerngruppe.

## 4k. KI-Begriffshilfe für Schüler:innen (Ergänzung vom 10.11.2026)

* Unter der Live-Präsentation, **nur zwischen Beginn und Ende** der Sitzung, je Sitzung abschaltbar (`lessons.student_ai`).
* **Einwilligung** vor der ersten Frage (je Sitzung und Gerät gemerkt): freiwillig, „datenschutzrechtlich nicht für die Schule
  vorgesehen“, welche Dienste die Fragen bekommen (`PROVIDER_WHO`), keine persönlichen Daten eingeben, Antworten können falsch sein.
* `POST /api/student/lessons/:id/ask`: kostenlose KI über die Aufgabe `erklaeren` (ohne eigene Einstellung die der Unterrichtsplanung,
  zuletzt Workers AI); System-Prompt `studentHelpPrompt` (nur Fachbegriffe und Unterrichtsinhalt, kurz, Sprache der Jahrgangsstufe,
  keine Lösungen von Aufgaben, keine persönlichen Daten). An die KI gehen nur Regeln, Fach, Lerngruppe, Thema, Stundenverlauf und die
  Frage samt den letzten drei Fragen/Antworten aus dem Browser – keine Kennung des Geräts. Nichts wird gespeichert oder protokolliert.
  Grenzen: 12 Fragen je Gerät und 10 Minuten, 300 je Sitzung und Stunde.
* **Vom Betreiber zu prüfen:** Ob die Einwilligung von Schüler:innen unter 16 Jahren trägt (Art. 8 DSGVO, in Deutschland 16 Jahre),
  ob die Nutzungsbedingungen der KI-Dienste die Nutzung durch Minderjährige erlauben und ob die Schule bzw. das Land (Hessen) solche
  Dienste im Unterricht zulässt. Unterricks hat bisher keinen eigenen Datenschutzhinweis.

## 5. Prüfung der direkten Claude-Integration

**Ergebnis: Die Verbindung des persönlichen Claude-Pro-Kontos mit einer eigenen Plattform ist nicht erlaubt. Umgesetzt ist
stattdessen der von Anthropic vorgesehene Weg in umgekehrter Richtung (Connector in claude.ai).**

* **Technisch möglich?** Ein Login mit dem Claude-Konto in einer fremden Webseite gibt es nicht als öffentliche Schnittstelle;
  denkbar wären nur inoffizielle Wege (Tokens aus der Claude-Anmeldung abgreifen). Anthropic behält sich ausdrücklich vor, dagegen
  ohne Vorankündigung vorzugehen; laut Fachpresse werden solche Zugriffe seit Anfang 2026 auch technisch blockiert.
* **Erlaubt Anthropic das?** Nein. Wortlaut der offiziellen Bedingungen („Legal and compliance“, Claude-Code-Dokumentation):
  *„Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests
  through Free, Pro, Max, or Ultra plan credentials on behalf of their users. Moreover, developers may not collect, store, or
  intermediate Claude.ai credentials or session tokens.“* OAuth-Anmeldungen sind „exclusively“ für Claude Code und Anthropics
  eigene Anwendungen gedacht; Entwickler sollen API-Schlüssel aus der Claude Console verwenden.
  Quelle: https://code.claude.com/docs/en/legal-and-compliance
* **Pro-Abo verbinden?** Nicht in der Plattform. **Erlaubt** ist der umgekehrte Weg: „Custom Connectors“ (Remote-MCP) sind laut
  Anthropic-Hilfe in den Plänen Free (ein Connector), Pro, Max, Team und Enterprise verfügbar; auf Pro richtet man sie selbst unter
  „Connectors“ ein. Quelle: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
  → Umgesetzt in `worker/mcp.js`: Claude liest in claude.ai die Sitzungen und speichert auf Wunsch Planung, Schulportal-Eintrag,
  Textmaterial und Feibeitsblatt-Entwürfe zurück. Es entstehen keine API-Kosten; es gelten die Nutzungsgrenzen des Pro-Abos.
* **Muss die API verwendet werden?** Für Claude **innerhalb** der Plattform: ja, zwingend (API-Schlüssel aus der Claude Console).
  Das wurde auf Wunsch der Lehrkraft nicht eingebaut. Die Plattform ist so gebaut, dass ein Anbieter „Claude-API“ später als
  weiterer Eintrag in `worker/ai.js` ergänzt werden kann.
* **Abo und API getrennt?** Ja. Laut Anthropic-Hilfe enthält das Pro-Abo keine API-Nutzung; die API wird separat nach Verbrauch
  in der Claude Console abgerechnet. Quelle: https://support.claude.com/en/articles/9876003
* **Kosten (nur falls später die API genutzt wird).** Preise je 1 Mio. Token (Eingabe/Ausgabe), Stand 03.11.2026:
  Claude Opus 5.5 4 $/20 $, Claude Sonnet 5.5 2 $/10 $, Claude Haiku 5.5 0,10 $/0,50 $, Claude Fable 5.2 8 $/40 $.
  Grobe Schätzung für eine geplante Stunde (≈ 15 Chat-Runden, wachsender Verlauf, mit Prompt-Caching): Opus 5.5 ≈ 0,50–2 $,
  Sonnet 5.5 ≈ 0,25–1 $, Haiku 5.5 wenige Cent. Bei 4 Stunden je Woche und 40 Schulwochen also grob 80–320 $ im Jahr mit Opus 5.5 (mit Sonnet 5.5 etwa die Hälfte).
  Das ist eine Schätzung, keine Zusage; die tatsächlichen Kosten hängen von Länge und Zahl der Nachrichten ab.
* **Einschränkungen.**
  - Der Connector wird in claude.ai je Chat aktiviert; Claude arbeitet dort, nicht in der Plattform (Wechsel der Seite bleibt nötig).
  - Über den Connector lassen sich Text, Struktur und Material als Text übertragen, **keine Binärdateien** (z. B. die in
    claude.ai erzeugte PDF der Präsentation): Diese laden Sie herunter und in der Plattform hoch.
  - Die Connector-Adresse enthält einen geheimen Schlüssel (wer sie kennt, hat Zugriff auf alle Sitzungen). Sie wird nur einmal
    angezeigt und lässt sich in den Einstellungen widerrufen. Alternativ kann der Schlüssel als `Authorization: Bearer` gesendet werden.
  - Anthropic kann die Connector-Funktion und ihre Menüs ändern; maßgeblich ist die verlinkte Hilfeseite.
* **Reihenfolge beim Planen (Vorgabe der Lehrkraft):** 1. **Claude** über den Connector (Hauptweg: „Stunde mit Claude planen“ in
  jeder Sitzung, „Einheit mit Claude planen“, Vertretung) → 2. **Groq** im Chat der Plattform („Backup“), wenn das
  Claude-Kontingent erschöpft ist – den Wechsel entscheidet die Lehrkraft, denn ihr Claude-Kontingent ist für die Plattform nicht
  sichtbar → 3. **Cloudflare Workers AI**, automatisch. Unter den kostenlosen Diensten steht Groq vorn (`DEFAULT_ORDER` in `ai.js`).
  Groq meldet Grenzen genau („Limit 8000, Used …, Requested …“, „try again in 1.5s“). Vor dem Wechsel zum nächsten Dienst bessert
  `callTask` deshalb beim selben Dienst höchstens zweimal nach (`adjustFor`): Eine einzelne Anfrage über der Minutengrenze (laut
  Groq-Tabelle für `openai/gpt-oss-120b` 8 000 Token pro Minute; gezählt Eingabe + erlaubte Antwortlänge, Fehler 413) bekommt eine
  kürzere Antwortlänge bzw. einen gekürzten Verlauf; bei einer kurzen Wartezeit (≤ 30 s, `retry-after`) wartet die Plattform.
  Erst ein erschöpftes Kontingent (lange Wartezeit) oder ein anderer Fehler führt zu Workers AI.
* **Modellauswahl.** In der Plattform: frei je Aufgabe (Planung, Ideen, Material, Schulportal, Feibeitsblatt) aus den kostenlosen
  Anbietern, mit „Modelle laden“ (aktuelle Liste des Anbieters) und Ausweichliste. Das **Claude-Modell** wählen Sie in claude.ai
  (Modellauswahl im Chat). Ohne API kann die Plattform Claude-Modelle nicht ansteuern.
  Die Claude-Prompts (Stunde, Einheit, Vertretung, Präsentation) sind feste Vorlagen ohne KI-Aufruf und deshalb immer
  reproduzierbar. Der Prompt „Stunde mit Claude planen“ (`claudeLessonPrompt` in `planning.js`) beginnt mit der festen Rolle,
  enthält Sitzung, Einheit (Regel: Ablauf nur Inspiration, Abweichungen mit `update_unit_row` festhalten), eine nicht beendete
  vorige Stunde und den bisherigen Chat-Verlauf und nennt die Werkzeuge zum Speichern (`save_schulportal_entry` mit
  `base_version`, `save_planning_result`, `add_text_material`, `propose_feibeitsblatt` – auch mit Foto-Aufgabe –, `update_lesson`
  für Hausaufgabe und Sitzungsdaten). Beim Zurückkehren übernimmt die Sitzungsseite Hausaufgabe, Sitzungsdaten, Material,
  Entwürfe, Verlauf und Schulportal-Eintrag – nie in ein Feld, das gerade bearbeitet wird.

## 6. Feibeitsblatt-Integration

* **Direkt angebunden, ohne Änderung am Feibeitsblatt.** Die Lehrkraft-API von Feibeitsblatt erlaubt Aufrufe von fremden
  Seiten (CORS `*`, Anmeldung per `Authorization: Bearer`). Der Browser der Lehrkraft leitet aus Türcode-Antwort und
  Feibeitsblatt-Passwort genau wie Feibeitsblatt selbst die Schlüssel ab (PBKDF2-SHA-256 mit 600 000 Iterationen, HKDF
  `feibeitsblatt/enc/v1` und `feibeitsblatt/auth/v1`), meldet sich an und öffnet den privaten RSA-Schlüssel (nicht exportierbar,
  nur im Arbeitsspeicher). Der Unterricks-Server sieht weder Passwort noch Schlüssel noch Abgaben im Klartext.
* **Ablauf.** Die KI schlägt im Chat bei passender Gelegenheit ein Feibeitsblatt vor → „Feibeitsblatt-Entwurf aus dem Chat“
  (oder Claude über den Connector) erzeugt einen Entwurf → die Lehrkraft prüft und ändert Titel, Aufgaben, Material,
  **„Auftrag an die KI“ je Aufgabe** (die Einstellung der KI-Rückmeldung) und Antwortart (Textfeld/Tabelle) → „Feibeitsblatt
  jetzt anlegen“ legt das Blatt über die Feibeitsblatt-API an → geführter Abschluss mit optionaler KI-Checkliste. Außerdem
  einstellbar: Wartezeit auf die finale KI-Rückmeldung (30/60/90 s, gilt im Feibeitsblatt global).
* **Auftrag an die KI ≠ Musterlösung.** Das Feld (im Feibeitsblatt intern `solution`) sagt der korrigierenden KI, worauf sie beim Lesen
  der Schülerantwort achten soll, damit ihre Rückmeldung zeigt, was schon gut ist und was verbessert werden sollte (Feibeitsblatt:
  „Grundlage deiner Beratung, keine Lösung, die wörtlich erreicht werden muss“). So steht es in allen Prompts (`FEIBEITSBLATT_INFO`,
  Entwurf aus dem Chat, Connector `propose_feibeitsblatt`, Vertretung, Escape-Finale) und im Editor; liefert eine KI bzw. der Connector
  trotzdem „Musterlösung: …“, wird daraus ein Auftrag („Achte darauf, ob die Antwort diese Inhalte sinngemäß enthält …“, `kiAuftragText`,
  nur in `insertDraft` – was die Lehrkraft schreibt, wird nie umgeschrieben, der Editor warnt nur). **Altersgemäße Erwartung:** Das
  Feibeitsblatt kennt den Jahrgang nicht – deshalb hängt Unterricks an jeden nicht leeren Auftrag genau einen Absatz „Altersgemäße
  Erwartung (Jahrgangsstufe 7): …“ an (`ageExpectation`/`withAgeExpectation`). Er legt nur das Anspruchsniveau fest („keine zusätzliche
  Anforderung und kein eigener Prüfpunkt – maßgeblich ist, was Aufgabe und Operator verlangen“): Jg. 7/8 einfache, richtige Aussagen in
  eigenen Worten statt ausdifferenzierter Lösung; 9/10 erste Fachbegriffe, Begründungen wo verlangt; E-Phase; Q-Phase Grund- bzw.
  Leistungskurs nach dem Niveau der Abiturprüfung. Sichtbar und änderbar im Editor, beim Anlegen ergänzt, falls er fehlt (auch für Blätter
  der Vertretung); ein automatisch erzeugter Absatz einer anderen Lerngruppe (z. B. aus einer Sitzungsdatei) wird ersetzt, ein von der
  Lehrkraft geänderter bleibt; ein Auftrag, der nur noch aus dem Absatz besteht, gilt als leer (kein KI-Feedback).
* **Schüleransicht.** Kein PDF, sondern Titel, Code und „Code kopieren und Feibeitsblatt öffnen“ (kopiert den Code und öffnet
  feibeitsblatt.janrickmer.de; Feibeitsblatt kennt keinen Direktlink mit vorausgefülltem Code).
* **Einsicht in Abgaben.** „Abgaben ansehen“ lädt die Abgaben, entschlüsselt sie im Browser und zeigt je Schüler:in die
  Antworten, die erste Fassung, das KI-Feedback und die finale KI-Rückmeldung (nur wenn ihr Prüfwert zur abgegebenen Fassung
  passt – wie im Feibeitsblatt). Optional alle 30 s aktualisieren.
* **Eingeschränkt / im Feibeitsblatt verblieben:** Tippzeit-Auswertung, Sicherung als PDF-Datei (das analoge Arbeitsblatt dagegen
  legt Unterricks als Notfall-Feibeitsblatt ab, siehe 4f), Löschen von Abgaben, Bilder, Videos,
  Weltkarten-Aufgaben, Escape-Room-Anbindung und die Wahl des KI-Anbieters für die Rückmeldungen. Feibeitsblätter sind nach dem
  Anlegen unveränderlich (Eigenschaft des Feibeitsblatts) – Änderungen heißt: neues Blatt.
* **Getestet gegen einen Nachbau.** Der End-to-End-Test prüft den Client gegen einen Nachbau der Feibeitsblatt-Schnittstelle mit
  identischem Krypto-Verfahren (`test/e2e/mocks.mjs`). Ein Test gegen den echten Feibeitsblatt-Worker war in der Testumgebung nicht
  möglich (das Ausführen des fremden Repositorys war dort gesperrt) und steht beim ersten echten Einsatz noch aus.

## 7. Sicherheit

* **Lehrkraft:** Passwort wird nur im Browser verarbeitet (PBKDF2, 600 000 Iterationen); der Server speichert einen Hash des
  abgeleiteten Schlüssels. Sperre laut Abschnitt 1. Optionaler `SETUP_CODE` schützt die einmalige Einrichtung.
* **Trennung Schüler/Lehrkraft:** getrennte Tokens; jede Schüler-Abfrage prüft Freischaltung und Bereich serverseitig; Downloads
  und Folien nur über kurzlebige HMAC-signierte Links; HTML/SVG-Dateien werden nie im Kontext der Seite ausgeführt (Download mit
  `Content-Security-Policy: sandbox`).
* **Seite:** strikte CSP (keine fremden Skripte), keine `innerHTML`-Übernahme fremder Daten, keine Protokolle bei Cloudflare. Auf
  GitHub Pages steht die CSP als `<meta>`; CORS nur für `PAGES_ORIGINS` (Abschnitt 4e).
* **Grenzen des Schülerzugangs:** Das gemeinsame Passwort ist keine echte Authentifizierung – wer Passwort und Code kennt,
  kommt in die Sitzung. Die Freigaben (Hausaufgabe, Präsentation, Begriffshilfe) richten sich nach Datum, Beginn und Dauer der Sitzung
  (Ortszeit Europe/Berlin), nicht mehr nach dem Gerät.
* **Gespeicherte Feibeitsblatt-Verbindung:** Ende-zu-Ende verschlüsselt (Abschnitt 4g). Der Server kann sie nicht öffnen; wer nur ein
  Anmelde-Token der Lehrkraft hätte (ohne das Gerät), könnte den Umschlag abrufen und das Unterricks-Passwort offline durchprobieren
  (600 000 PBKDF2-Runden je Versuch) – deshalb ein langes Passwort wählen. „Alle anderen Geräte abmelden“ entzieht verlorenen Geräten den Zugang.

## 8. Kosten und Kontingente (kostenlos betreibbar)

| Dienst | Kostenlos enthalten | Hinweis |
|---|---|---|
| Cloudflare Workers | 100 000 Anfragen/Tag, 10 ms CPU je Anfrage | Live-Folien laufen über WebSockets (schonend) |
| D1 | 5 GB je Konto, 500 MB je Datenbank | reicht für Texte und Metadaten vieler Schuljahre |
| R2 | 10 GB/Monat | Aktivierung mit Zahlungsmittel; Plattform begrenzt auf 9 GB |
| Durable Objects | im Free-Plan (SQLite-Backend) | ein Objekt je Sitzung |
| Workers AI | 10 000 Neurons/Tag (konto­weit, geteilt mit Feibeitsblatt) | Rückfall ohne Schlüssel |
| Groq (Backup nach Claude) | laut Groq-Tabelle für `openai/gpt-oss-120b`: 30 Anfragen/Minute, 1 000/Tag, 8 000 Token/Minute, 200 000 Token/Tag | genaue Werte des eigenen Kontos: console.groq.com → Settings → Limits; Grenzen ändern sich |
| Gemini / Cerebras / OpenRouter | Gratis-Kontingente der Anbieter | optional als Ausweichmodelle; Grenzen ändern sich |
| Claude | Ihr Pro-Abo (Connector) | keine API-Kosten |

## 9. Bewusst getroffene Annahmen (änderbar)

* Schüler:innen bleiben nach der ersten Passworteingabe auf ihrem Gerät angemeldet (wie ihre Sitzungscodes).
* Das Schülerpasswort ist in den Einstellungen änderbar (Vorgabe „Feindt“), Groß-/Kleinschreibung spielt keine Rolle.
* Ohne eingetragenen Beginn bleiben Hausaufgabe, Präsentation und KI-Begriffshilfe für Schüler:innen verborgen (die Sitzung weist darauf hin).
* Ohne Markierung der letzten gezeigten Folie bekommen Schüler:innen nach der Freigabe die ganze Präsentation.
* Ein Sitzungscode gilt nur für die Klasse und das Fach der Sitzung.
