# Unterricks

Digitale Unterrichtsplattform für Politik und Wirtschaft, Evangelische Religion und Ethik: Unterrichtssitzungen mit KI planen,
Schulportal-Eintrag erzeugen, Prompts für Claude, Material in zwei getrennten Bereichen, Live-Präsentation auf den Geräten der
Schüler:innen, Feibeitsblätter direkt anlegen und Abgaben einsehen – plus Connector, mit dem Claude (Pro-Abo) in claude.ai
direkt mit den Sitzungen arbeitet.

**Architektur, Prüfergebnis zur Claude-Integration, Kosten und Grenzen:** [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## Einrichtung (einmalig, ca. 15 Minuten)

1. **Cloudflare-Konto** (dasselbe wie für Feibeitsblatt): Im Dashboard **R2 Object Storage** einmal aktivieren
   (Plan wählen; kostenlos bis 10 GB/Monat, Cloudflare verlangt dafür ein hinterlegtes Zahlungsmittel).
2. **API-Token** anlegen (Dashboard → Mein Profil → API-Tokens): Vorlage *„Cloudflare Workers bearbeiten“* und zusätzlich
   *Konto → D1 → Bearbeiten* – wie beim Feibeitsblatt. Fehlt in der Vorlage *Workers R2 Storage: Bearbeiten*, bitte ergänzen.
   Das vorhandene Feibeitsblatt-Token funktioniert, wenn es diese Rechte hat.
3. Im GitHub-Repository unter *Settings → Secrets and variables → Actions* anlegen:
   - `CLOUDFLARE_API_TOKEN` (Pflicht), `CLOUDFLARE_ACCOUNT_ID` (optional),
   - `SETUP_CODE` (empfohlen: ein beliebiger Code, der die Ersteinrichtung des Lehrkraft-Zugangs schützt).
4. Auf `main` pushen bzw. den Workflow **Deploy** von Hand starten. Er legt Datenbank und Dateiablage in der EU an,
   veröffentlicht den Worker und erzeugt `SETTINGS_SECRET`. Am Ende steht die Adresse im Protokoll
   (`https://unterricks.<subdomain>.workers.dev`).
5. Seite öffnen → unten **„Lehrkräfte“** → Benutzername und Passwort festlegen (einmalig).
6. **Einstellungen → KI-Modelle:** mindestens einen kostenlosen Schlüssel eintragen (empfohlen: Google AI Studio für Gemini
   und/oder Groq) und je Aufgabe das Modell wählen. Ohne Schlüssel läuft Cloudflare Workers AI (schwächer, kleines Kontingent).
7. **Einstellungen → Claude-Connector:** Adresse erzeugen und in claude.ai als benutzerdefinierten Connector eintragen.

Feibeitsblatt braucht keine Änderung. Die Adressen stehen in `wrangler.jsonc` (`FEIBEITSBLATT_API`, `FEIBEITSBLATT_URL`) und in
`public/_headers` (CSP, `connect-src`).

## Bedienung in Kürze

* **Schüler:innen:** Seite öffnen → Passwort „Feindt“ → Fach und Klasse → Sitzungscode. Danach merkt sich das Gerät die Sitzung.
  Oben läuft die Live-Präsentation, darunter Material (Download, z. B. für GoodNotes) und Feibeitsblätter.
* **Lehrkraft:** Einmalig unter **Planungsgrundlagen** je Fach Schulcurriculum, KCGO, E-Phasen-Curriculum und Abiturerlass
  (je Q-Kurs) als PDF hochladen und die Fach-Einstellungen prüfen. Dann: Fach → Klasse/Kurs → **Unterrichtseinheit planen**
  (Rahmendaten → „Einheit mit Claude planen“ → Leupold-Schema und Tabelle prüfen → „Einheit festlegen und Sitzungen anlegen“) →
  Sitzung öffnen → im Chat planen → „Schulportal-Eintrag erstellen“ (bearbeiten, kopieren) → „Prompt für die Präsentation
  kopieren“ → in claude.ai einfügen → die von Claude erzeugte **PDF** hochladen → im Unterricht „Ich bin im Unterricht und starte
  die Präsentation für alle.“ Den Sitzungscode zeigt „Für den Beamer zeigen“. Am Stundenende: Hausaufgabe eintragen und per
  Rechtsklick im Verlaufsplan „Zwischenstopp einfügen“, falls nicht alles geschafft wurde.
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

Der End-to-End-Test braucht Playwright mit Chromium (`require("playwright")`) und legt Screenshots in `test-results/` ab.
