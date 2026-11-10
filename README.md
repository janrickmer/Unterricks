# Unterricks

Digitale Unterrichtsplattform für Politik und Wirtschaft, Evangelische Religion und Ethik: Unterrichtssitzungen mit KI planen,
Schulportal-Eintrag erzeugen, Prompts für Claude, Material in zwei getrennten Bereichen, Live-Präsentation auf den Geräten der
Schüler:innen, Feibeitsblätter direkt anlegen und Abgaben einsehen – plus Connector, mit dem Claude (Pro-Abo) in claude.ai
direkt mit den Sitzungen arbeitet.

**Architektur, Prüfergebnis zur Claude-Integration, Kosten und Grenzen:** [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) ·
**Gestaltung („Folie & Aufdecken“):** [DESIGN.md](DESIGN.md)

## Einrichtung (einmalig, ca. 15 Minuten)

1. **Cloudflare-Konto** (dasselbe wie für Feibeitsblatt): Im Dashboard **R2 Object Storage** einmal aktivieren
   (Plan wählen; kostenlos bis 10 GB/Monat, Cloudflare verlangt dafür ein hinterlegtes Zahlungsmittel).
2. **API-Token** anlegen (Dashboard → Mein Profil → API-Tokens): Vorlage *„Cloudflare Workers bearbeiten“* und zusätzlich
   *Konto → D1 → Bearbeiten* – wie beim Feibeitsblatt. Fehlt in der Vorlage *Workers R2 Storage: Bearbeiten*, bitte ergänzen.
   Das vorhandene Feibeitsblatt-Token funktioniert, wenn es diese Rechte hat.
3. Im GitHub-Repository unter *Settings → Secrets and variables → Actions* anlegen:
   - `CLOUDFLARE_API_TOKEN` (Pflicht), `CLOUDFLARE_ACCOUNT_ID` (optional),
   - `SETUP_CODE` (empfohlen: ein beliebiger Code, der die Ersteinrichtung des Lehrkraft-Zugangs schützt).
4. Auf `main` bzw. den Arbeitsbranch `ccr-a0b9567a-04ain7` pushen (jeder Push veröffentlicht automatisch, sobald die
   Unit-Tests grün sind) oder den Workflow **Deploy** von Hand starten (*Actions → Deploy → Run workflow*). Er legt Datenbank und Dateiablage in der EU an,
   veröffentlicht den Worker und erzeugt `SETTINGS_SECRET`. Am Ende steht die Adresse im Protokoll
   (`https://unterricks.<subdomain>.workers.dev`).
5. Seite öffnen → unten **„Lehrkräfte“** → Benutzername und Passwort festlegen (einmalig).
6. **Einstellungen → Claude-Connector:** Adresse erzeugen und in claude.ai als benutzerdefinierten Connector eintragen. Beim
   ersten Einsatz in einem Chat fragt claude.ai, ob der Connector verbunden werden und zugreifen darf – erlauben.
7. **Einstellungen → KI-Modelle (Backup):** einen kostenlosen Groq-Schlüssel eintragen. Reihenfolge beim Planen:
   **1. Claude** (Pro-Abo, Connector) → **2. Groq** im Chat der Plattform, wenn das Claude-Kontingent erschöpft ist →
   **3. Cloudflare Workers AI** automatisch, wenn auch das Groq-Kontingent erschöpft ist oder Groq nicht antwortet. Weitere
   Anbieter (Gemini, Cerebras, OpenRouter) lassen sich als Ausweichmodelle ergänzen.

8. **Optional – eigene Adresse `https://unterricks.janrickmer.de` über GitHub Pages** (der Server bleibt der Worker):
   1. DNS: `CNAME unterricks → janrickmer.github.io` (bei Strato bereits eingetragen). Falls noch nicht geschehen, die Domain
      `janrickmer.de` in den GitHub-Kontoeinstellungen unter *Pages → Verified domains* bestätigen (TXT-Eintrag bei Strato) –
      das schützt die Subdomains davor, dass ein fremdes Repository sie übernimmt.
   2. Im Repository *Settings → Pages → Build and deployment → Source* auf **„GitHub Actions“** stellen, unter *Custom domain*
      `unterricks.janrickmer.de` eintragen und speichern; sobald der DNS-Check grün ist, **„Enforce HTTPS“** einschalten.
   3. Den Workflow **Deploy** starten: Nach dem Worker baut der Job „Oberfläche auf GitHub Pages veröffentlichen“ die Seite mit
      der Worker-Adresse (`dist-pages/`) und veröffentlicht sie. Ist Pages nicht eingerichtet, gibt er nur einen Hinweis aus.
   Die Worker-Adresse funktioniert weiter. Anfragen von der Pages-Seite erlaubt der Worker nur für die Adressen in
   `PAGES_ORIGINS` (`wrangler.jsonc`). Der Connector für claude.ai bleibt die Worker-Adresse. **Datenschutz:** Beim Laden der
   Seite über GitHub Pages erhält GitHub, Inc. (USA) die IP-Adresse der Besucher:innen – Unterricks hat bisher keinen eigenen
   Datenschutzhinweis; das sollte vor dem Einsatz mit Schüler:innen ergänzt werden.

Feibeitsblatt braucht keine Änderung. Die Adressen stehen in `wrangler.jsonc` (`FEIBEITSBLATT_API`, `FEIBEITSBLATT_URL`) und in
`public/_headers` (CSP, `connect-src`).

## Bedienung in Kürze

* **Schüler:innen:** Seite öffnen → Passwort „Feindt“ → Fach und Klasse → Sitzungscode. Danach merkt sich das Gerät die Sitzung.
  Spätestens 90 Minuten nach der Passworteingabe wird abgemeldet; nach erneuter Eingabe von „Feindt“ geht es genau dort weiter
  (freigeschaltete Sitzungen und im Browser Gespeichertes bleiben, ein laufender Escape-Room wird wiederhergestellt).
  In Ev. Religion und Ethik wählen sie ebenfalls ihre eigene Klasse – die Plattform ordnet sie dem Kurs ihres Jahrgangs zu.
  Oben läuft die Live-Präsentation, darunter Material (Download, z. B. für GoodNotes) und Feibeitsblätter.
* **Lehrkraft:** Einmalig unter **Planungsgrundlagen** je Fach Schulcurriculum, KCGO, E-Phasen-Curriculum und Abiturerlass
  (je Q-Kurs) als PDF hochladen und die Fach-Einstellungen prüfen. Dann: Fach → Klasse/Kurs → **Unterrichtseinheit planen**
  (Rahmendaten → „Einheit mit Claude planen“ → Leupold-Schema und Tabelle prüfen → „Einheit festlegen und Sitzungen anlegen“) →
  Sitzung öffnen → **„Stunde mit Claude planen“** (Prompt kopieren, in claude.ai mit dem Connector einfügen; Claude speichert
  Schulportal-Eintrag, Hausaufgabe, Materialien und Feibeitsblatt-Entwurf auf Wunsch direkt in der Sitzung – beim Zurückkehren
  erscheinen sie) → Schulportal-Eintrag prüfen und kopieren → „Prompt für die Präsentation kopieren“ → in claude.ai einfügen →
  die von Claude erzeugte **PDF** hochladen (Claude liefert nur die PDF, keine PowerPoint-Datei; Folie 1 zeigt immer den
  Sitzungscode und den QR-Code zu Unterricks) → im Unterricht „Ich bin im Unterricht und starte
  die Präsentation für alle.“ Den Sitzungscode zeigt „Für den Beamer zeigen“. Am Stundenende: Hausaufgabe eintragen und per
  Rechtsklick im Verlaufsplan „Zwischenstopp einfügen“, falls nicht alles geschafft wurde. „Für das Schulportal kopieren“ bei der
  Hausaufgabe liefert sie im Format der Lehrkraft: **Hausaufgabe zum 25. November 2026:** (Datum der nächsten Sitzung), eine
  Leerzeile, je Zeile ein Stichpunkt und zuletzt „Unter https://unterricks.janrickmer.de kannst du diese Sitzung mit dem Code …
  aufrufen …“ (dieser Hinweis erscheint nur im Schulportal). Der Prompt „Stunde mit Claude planen“ beginnt mit dem Chat-Namen,
  z. B. „Jg. 8 - PoWi - Sitzung 1 - Das Bundesverfassungsgericht“ (Jahrgang bzw. „E-Phase“/„Q2 GK“, Fach, Stunde in der
  Einheit, Titel der Sitzung); den Namen vergibt claude.ai selbst – passt er nicht, im Dialog „Chat-Namen kopieren“ und in
  claude.ai über „Umbenennen“ einfügen.
* **Feibeitsblatt-Verbindung:** Türcode und Feibeitsblatt-Passwort nur einmal eingeben (Haken „Verbindung verschlüsselt in meinem
  Benutzerkonto speichern“). Danach verbindet sich Unterricks auf jedem Gerät, auf dem Sie sich mit Ihrem Passwort anmelden,
  automatisch; Geräte, die schon vorher angemeldet waren, entsperren sie einmal mit dem Unterricks-Passwort. Der Server sieht dabei
  weder Passwort noch Schlüssel.
* **Beginn, Hausaufgabe, Präsentation:** Den Beginn der Sitzung tragen Sie im Stundenplan der Einheit (je Wochentag) oder in der
  Sitzung ein. Schüler:innen sehen die Hausaufgabe ab 15 Minuten vor dem Ende und können die Präsentation 5 Minuten nach dem Ende selbst
  öffnen – ohne Beginn weder noch. Am Ende der Stunde markieren Sie die letzte gezeigte Folie (im Vollbild „Bis hier gezeigt“ oder in
  der Sitzung, auch per Rechtsklick); Schüler:innen bekommen dann nur die Folien bis dorthin. „Für den Beamer zeigen“ zeigt neben dem
  Code einen QR-Code zu unterricks.janrickmer.de.
* **Material:** auch Links mit Titel (für Schüler:innen oder nur für Sie). Ganz unten in der Sitzung: **„Von der Lehrkraft
  auszudrucken“** – nur PDF, alles A4 (andere Formate rechnet Unterricks um), Name wie „28x - beidseitig - sw - Arbeitsblatt.pdf“,
  einzeln oder alle als ZIP; Claude kann Druckvorlagen über den Connector ablegen. Darunter **„Sitzung als Datei herunterladen“** und
  **„Sitzung aus Datei laden“**, um eine gehaltene Sitzung in einer anderen Lerngruppe erneut durchzuführen (Datum, Beginn und Dauer
  bleiben, Datumsangaben in den Texten werden angepasst, Feibeitsblätter kommen als Entwürfe).
* **KI-Begriffshilfe:** Während der Stunde können Schüler:innen unter der Live-Präsentation Fachbegriffe kurz und einfach erklären
  lassen – nur nach ihrer Einwilligung, mit der kostenlosen KI; in den Sitzungsdaten abschaltbar. Bitte vor dem Einsatz prüfen, ob
  das an Ihrer Schule zulässig ist (siehe docs/ARCHITEKTUR.md, 4k).
* **Feibeitsblatt-Entwürfe:** Je Aufgabe steht ein **„Auftrag an die KI“** – keine Musterlösung, sondern die Anweisung an die
  korrigierende KI des Feibeitsblatts, worauf sie beim Lesen der Antwort achten soll, damit ihre Rückmeldung zeigt, was schon gut ist und
  was verbessert werden sollte. Unterricks ergänzt jeden Auftrag um die **altersgemäße Erwartung** der Lerngruppe (z. B. „Jahrgangsstufe
  7: eine kurze, richtige Antwort in eigenen Worten genügt …“), weil das Feibeitsblatt den Jahrgang nicht kennt; im Editor sichtbar und
  änderbar.
* **Notfall-Feibeitsblätter:** Zu jedem Feibeitsblatt der Sitzung legt Unterricks automatisch dessen analoges Arbeitsblatt
  (im Feibeitsblatt „Analoges Arbeitsblatt als PDF herunterladen“, dieselbe Datei) als PDF unter „Material – Für Schüler:innen
  zugänglich“ ab, sobald die Sitzung mit dem Feibeitsblatt verbunden ist. Nach dem Bestätigen der Checkliste wird es mit dem
  QR-Code zur Checkliste erneuert; entfernen Sie das Blatt aus der Sitzung, verschwindet auch sein Notfall-Feibeitsblatt. Zum
  Finale eines Escape-Rooms gibt es keines. Die Schüler:innen sehen die Notfall-Feibeitsblätter in einem eigenen Kästchen unter dem
  Material mit dem roten Hinweis, dass sie nur bei technischen Problemen gedacht sind. In den Jahrgängen 5 und 6 (nur analoges
  Material) gibt es keine. **Bestehende Sitzungen**, deren Feibeitsblätter schon vorher verknüpft waren, bekommen ihr
  Notfall-Feibeitsblatt automatisch nachgeholt: Sobald Sie als Lehrkraft angemeldet und mit Feibeitsblatt verbunden sind (gespeicherte
  Verbindung), ergänzt Unterricks die fehlenden im Hintergrund – erzeugt werden sie in Ihrem Browser, lassen Sie Unterricks also
  geöffnet, bis es fertig ist (ein unterbrochener Lauf geht beim nächsten Öffnen weiter). Den Stand sehen Sie unter
  *Einstellungen → Feibeitsblatt*; dort erneuert „Alle prüfen und aktualisieren“ auch veraltete (z. B. nach dem Bestätigen einer
  Checkliste). Haben Sie ein Notfall-Feibeitsblatt „nur für Lehrkräfte“ gestellt, bleibt auch das erneuerte dort.
* **Kurse in Ev. Religion und Ethik (Jg. 5–10, E-Phase):** Je Jahrgang gibt es einen Kurs mit Schüler:innen aus mehreren
  Klassen. Fach wählen → beim Jahrgang **„Kurs anlegen“** → alle Klassen ankreuzen, die im Kurs vertreten sind (später über
  „Klassen ändern“ anpassbar). Sitzungen und Einheiten, die bisher in einer dieser Klassen lagen, ziehen dabei in den Kurs um.
  Politik und Wirtschaft bleibt im Klassenverband, die Qualifikationsphase bei GK/LK.
  Ist das Claude-Kontingent erschöpft, plant der Chat **„Backup: Planung mit kostenloser KI“** in derselben Sitzung weiter
  (Groq, danach automatisch Workers AI); „Schulportal-Eintrag erstellen“ baut dann auf diesem Verlauf auf.
  Bei Krankheit: „Lehrkraft ist zu dieser Sitzung krank – Alternative entwickeln“ → Claude entwickelt die Vertretung (z. B. einen
  Escape-Room nach dem bekannten Aufbau mit Feibeitsblatt-Finale) → Vorschau ansehen, prüfen und bestätigen (die ursprüngliche
  Planung wird archiviert und bleibt wiederherstellbar). Für das Anlegen des Feibeitsblatts beim Bestätigen muss die Sitzung mit
  dem Feibeitsblatt verbunden sein (Türcode + Passwort im Abschnitt „Feibeitsblatt“).

## Entwicklung

```bash
npm install
npm run dev          # http://localhost:8787 (D1, R2 und Durable Objects lokal)
npm test             # Unit-Tests
npm run test:e2e     # End-to-End: Lehrkraft + Schüler:in in Chromium, Mock-KI, Nachbau der Feibeitsblatt-API
```

`public/fbanalog.js` (das analoge Arbeitsblatt für die Notfall-Feibeitsblätter) ist aus dem Feibeitsblatt übernommen und wird
nicht von Hand geändert: Nach einer Änderung im Feibeitsblatt `node scripts/fbanalog-sync.mjs <Pfad zu feibeitsblatt/index.html>
[Stand, z. B. Commit]` ausführen (übernimmt die benannten Bausteine unverändert) und `npm test` laufen lassen.

Der End-to-End-Test braucht Playwright mit Chromium (`require("playwright")`) und legt Screenshots in `test-results/` ab. Er prüft
auch die GitHub-Pages-Fassung: `PAGES_API=<Worker-Adresse> npm run build` erzeugt `dist-pages/`, der Test liefert sie von einer
zweiten Adresse aus (CORS, WebSocket, Links zum Worker, keine CSP-Fehler, Schutz gegen Einbetten). Am Ende öffnet er alle Seiten und
die wichtigsten Dialoge auf iPhone SE, iPhone 13 und iPad und prüft, dass man nur senkrecht scrollen muss (nichts ragt über den Rand,
nichts scrollt seitlich – Fundstellen in `test-results/mobile-audit.json`); mit `MOBILE_SHOTS=1` legt er von jeder Seite ein
Bildschirmfoto in `test-results/mobil/` ab.
