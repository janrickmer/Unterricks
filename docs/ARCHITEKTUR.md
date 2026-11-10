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
| Feibeitsblatt-Passwort | **Bei jeder Anmeldung** neu eingeben (Schlüssel nur im Arbeitsspeicher) |
| Schülerzugang | **Gerätegebunden**, ohne Konten und ohne Personendaten |
| Datum (Ergänzung) | **Pflicht** beim Anlegen, jederzeit änderbar; beim Ändern auf Wunsch **alle späteren Sitzungen** derselben Klasse im Fach um denselben Abstand mitverschieben |
| Hausaufgabe (Ergänzung) | eigenes Feld je Sitzung; Schüler:innen sehen sie „bis zur nächsten Sitzung“ (Datum automatisch) |
| Zwischenstopp (Ergänzung) | per Rechtsklick **vor** der angeklickten Zeile, **nur intern** (nicht im Schulportal); **nur Markierung** – beim Planen der nächsten Stunde ein Hinweis mit dem Eintrag der letzten Stunde |

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
 │   └── kostenlose KI: Gemini · Groq · Cerebras · OpenRouter · Workers AI  │       │
 └──────────────────────────────────────────────────────────────────────────┘       │
                                                                                     ▼
                                                      Feibeitsblatt-Worker (bestehend, unverändert)
                                                      feibeitsblatt.feindt.workers.dev – Lehrkraft-API (CORS *)
```

* **Hosting:** ein Cloudflare Worker (Free-Plan) mit statischer Seite (`public/` → `dist/`), wie beim Feibeitsblatt.
  Deployment per GitHub Actions (`.github/workflows/deploy.yml`).
* **Datenbank:** D1 (SQLite) in der EU. Tabellen legt der Worker selbst an (`worker/db.js`).
* **Dateien:** R2 in der EU. Der Worker begrenzt die Ablage auf 9 GB, damit sie im kostenlosen Kontingent bleibt (`STORAGE_LIMIT_BYTES`).
* **Live-Synchronisation:** ein Durable Object je Sitzung (SQLite-Backend, im Free-Plan verfügbar) mit WebSocket-Hibernation.
  Fällt der WebSocket aus, fragt der Browser den Stand alle 2 s über HTTP ab.
* **Keine Fremdbibliotheken zur Laufzeit** außer PDF.js (Folienbilder im Browser der Lehrkraft) und pdf-lib (Textmaterial → PDF),
  beide gebündelt unter `/vendor/` (keine CDN-Abhängigkeit).

## 3. Komponenten und Dateien

| Bereich | Datei | Inhalt |
|---|---|---|
| Gemeinsam | `public/shared.js` | Fächer, Klassen, Codes, Schulportal-Format, fester System-Prompt, Claude-Prompts |
| Server | `worker/index.js` | Routing, Fehler, Sicherheitskopfzeilen |
| | `worker/auth.js` | Lehrkraft (PBKDF2 im Browser, Token), Schüler:innen (gemeinsames Passwort), Sperren |
| | `worker/lessons.js` | Sitzungen, Chat, Schulportal (mit Versionsschutz), Feibeitsblatt-Entwürfe/-Verknüpfungen |
| | `worker/files.js` | Uploads, Textmaterial, Präsentation + Folienbilder, signierte Download-Links |
| | `worker/student.js` | Sitzungscode einlösen, Schüleransicht, 90-Minuten-Freigabe |
| | `worker/live.js` | Durable Object `LiveRoom`, Live-Tickets |
| | `worker/ai.js` | kostenlose KI-Anbieter, Modell je Aufgabe, Ausweichliste |
| | `worker/mcp.js` | Connector für claude.ai (MCP) |
| Oberfläche | `public/app.js` | Router, Startseite, Schüleransicht |
| | `public/teacher.js`, `public/session.js` | Lehrkräfteansicht, Sitzungsansicht |
| | `public/fbclient.js` | Feibeitsblatt-Client (Schlüsselableitung, Anlegen, Entschlüsseln) |
| | `public/presenter.js` | PDF → Folienbilder, Präsentationsmodus, Beamer-Code |
| | `public/pdfmaker.js`, `public/markdown.js` | Textmaterial als PDF, sicheres Markdown |

## 4. Abläufe und Abhängigkeiten

1. **Anmeldung und dauerhafte Zuordnung der Schüler:innen.** Passwort „Feindt“ (Groß-/Kleinschreibung egal) → der Server vergibt ein
   zufälliges Geräte-Token (im Browser gespeichert, auf dem Server nur als Hash). Klasse und Fach werden am Gerät gespeichert.
   Ein Sitzungscode wird nur angenommen, wenn er zu genau dieser Klasse und diesem Fach gehört. Danach steht die Freischaltung
   (mit dem Zeitpunkt des **ersten** Betretens) dauerhaft in `student_access`. Bei späteren Besuchen ist das Gerät angemeldet und
   die Sitzung steht in der Liste – ohne erneute Code-Eingabe. Jede Schüler-Abfrage prüft serverseitig diese Freischaltung.
2. **Sitzungen.** Fach → Klasse → Sitzung (Titel, Thema, Datum, Dauer, Ideen). Jede Sitzung hat einen eigenen 6-stelligen Code.
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
6. **Präsentation und Live-Synchronisation.** Upload der PDF → der Browser der Lehrkraft rendert jede Seite mit PDF.js
   (1920 px) und lädt sie als Bild hoch. „Ich bin im Unterricht …“ öffnet das Vollbild und meldet die Folie an das Durable
   Object. Alle Schüler:innen der Sitzung bekommen per WebSocket die aktuelle Folie als **signierten Link nur für diese Folie** –
   sie können nicht vorblättern. Die vollständige PDF gibt der Server erst 90 Minuten nach dem ersten Betreten frei.
7. **Material.** Zwei Bereiche (Schüler:innen / nur Lehrkraft). Jede Schüler-Abfrage filtert serverseitig auf den
   Schülerbereich; Downloads laufen über kurzlebige signierte Links. KI-Material wird mit „Als Material übernehmen“ als
   Textmaterial gespeichert; Schüler:innen laden es als PDF (mit Namens-/Datumszeile) herunter, z. B. für GoodNotes.
8. **Feibeitsblatt.** Siehe Abschnitt 6.
9. **Einsicht in Schülerbearbeitungen.** Siehe Abschnitt 6.
10. **Claude.** Siehe Abschnitt 5.

## 4a. Datum, Hausaufgabe und Zwischenstopp (Ergänzung vom 10.11.2026)

* **Datum.** Ohne Datum lässt sich keine Sitzung anlegen (auch nicht über den Connector). Ändern Sie das Datum (z. B. bei
  Krankheit) und es gibt spätere Sitzungen derselben Klasse im selben Fach, zeigt ein Dialog die neuen Termine (mit Warnung, falls
  einer auf ein Wochenende fällt) und bietet „Nur diese Sitzung“, „Alle folgenden mitverschieben“ oder „Abbrechen“. Das
  Mitverschieben geschieht in einer Datenbank-Transaktion; andere Klassen und Fächer bleiben unberührt. Verschoben wird um
  Kalendertage (z. B. Di → Mi = alle folgenden einen Tag später).
* **Hausaufgabe.** Feld „Hausaufgabe bis zur nächsten Sitzung“ in jeder Sitzung (automatisch gespeichert, Schulportal-Zeichen
  erlaubt, eigener Knopf zum Kopieren in das Hausaufgaben-Feld des Schulportals). Fällig ist sie zur zeitlich nächsten Sitzung
  derselben Klasse im selben Fach; das Datum wird bei jeder Anzeige neu bestimmt und wandert deshalb beim Verschieben mit.
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
    claude.ai erzeugte PPTX/PDF): Diese laden Sie herunter und in der Plattform hoch.
  - Die Connector-Adresse enthält einen geheimen Schlüssel (wer sie kennt, hat Zugriff auf alle Sitzungen). Sie wird nur einmal
    angezeigt und lässt sich in den Einstellungen widerrufen. Alternativ kann der Schlüssel als `Authorization: Bearer` gesendet werden.
  - Anthropic kann die Connector-Funktion und ihre Menüs ändern; maßgeblich ist die verlinkte Hilfeseite.
* **Modellauswahl.** In der Plattform: frei je Aufgabe (Planung, Ideen, Material, Schulportal, Feibeitsblatt) aus den kostenlosen
  Anbietern, mit „Modelle laden“ (aktuelle Liste des Anbieters) und Ausweichliste. Das **Claude-Modell** wählen Sie in claude.ai
  (Modellauswahl im Chat). Ohne API kann die Plattform Claude-Modelle nicht ansteuern.
  Die Claude-Prompts (Unterrichtsidee, Präsentation) sind feste Vorlagen ohne KI-Aufruf und deshalb immer reproduzierbar.

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
* **Schüleransicht.** Kein PDF, sondern Titel, Code und „Code kopieren und Feibeitsblatt öffnen“ (kopiert den Code und öffnet
  feibeitsblatt.janrickmer.de; Feibeitsblatt kennt keinen Direktlink mit vorausgefülltem Code).
* **Einsicht in Abgaben.** „Abgaben ansehen“ lädt die Abgaben, entschlüsselt sie im Browser und zeigt je Schüler:in die
  Antworten, die erste Fassung, das KI-Feedback und die finale KI-Rückmeldung (nur wenn ihr Prüfwert zur abgegebenen Fassung
  passt – wie im Feibeitsblatt). Optional alle 30 s aktualisieren.
* **Eingeschränkt / im Feibeitsblatt verblieben:** Tippzeit-Auswertung, PDF-Export, Löschen von Abgaben, Bilder, Videos,
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
* **Seite:** strikte CSP (keine fremden Skripte), keine `innerHTML`-Übernahme fremder Daten, keine Protokolle bei Cloudflare.
* **Grenzen des Schülerzugangs:** Das gemeinsame Passwort ist keine echte Authentifizierung – wer Passwort und Code kennt,
  kommt in die Sitzung. Die 90-Minuten-Frist gilt je Gerät; ein Gerätewechsel startet sie neu (später, nie früher).

## 8. Kosten und Kontingente (kostenlos betreibbar)

| Dienst | Kostenlos enthalten | Hinweis |
|---|---|---|
| Cloudflare Workers | 100 000 Anfragen/Tag, 10 ms CPU je Anfrage | Live-Folien laufen über WebSockets (schonend) |
| D1 | 5 GB je Konto, 500 MB je Datenbank | reicht für Texte und Metadaten vieler Schuljahre |
| R2 | 10 GB/Monat | Aktivierung mit Zahlungsmittel; Plattform begrenzt auf 9 GB |
| Durable Objects | im Free-Plan (SQLite-Backend) | ein Objekt je Sitzung |
| Workers AI | 10 000 Neurons/Tag (konto­weit, geteilt mit Feibeitsblatt) | Rückfall ohne Schlüssel |
| Gemini / Groq / Cerebras / OpenRouter | Gratis-Kontingente der Anbieter | Schlüssel in den Einstellungen; Grenzen ändern sich |
| Claude | Ihr Pro-Abo (Connector) | keine API-Kosten |

## 9. Bewusst getroffene Annahmen (änderbar)

* Schüler:innen bleiben nach der ersten Passworteingabe auf ihrem Gerät angemeldet (wie ihre Sitzungscodes).
* Das Schülerpasswort ist in den Einstellungen änderbar (Vorgabe „Feindt“), Groß-/Kleinschreibung spielt keine Rolle.
* Die 90 Minuten zählen ab dem **ersten** Betreten der Sitzung auf dem Gerät.
* Ein Sitzungscode gilt nur für die Klasse und das Fach der Sitzung.
