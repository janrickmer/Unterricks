# Unterricks

Digitale Unterrichtsplattform für Politik und Wirtschaft, Evangelische Religion und Ethik: Unterrichtssitzungen mit KI planen,
Schulportal-Eintrag erzeugen, Prompts für Claude, Material in zwei getrennten Bereichen, Live-Präsentation auf den Geräten der
Schüler:innen, Feibeitsblätter direkt anlegen und Abgaben einsehen – plus Connector, mit dem Claude (Pro-Abo) in claude.ai
direkt mit den Sitzungen arbeitet. Für den Unterricht an einer **Grundschule** gibt es einen eigenen Bereich: Kurse der Jahrgänge
1–4, Verlaufspläne mit gelb markierten PDF-Dateien, Bildkarten, eine Elternansicht über einen geheimen Link und das Verschieben der
Stunden bei Krankheit (siehe [Grundschule](#grundschule)).

**Architektur, Prüfergebnis zur Claude-Integration, Kosten und Grenzen:** [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) ·
**Gestaltung („Folie & Aufdecken“):** [DESIGN.md](DESIGN.md)

## Einrichtung (einmalig, ca. 15 Minuten)

1. **Cloudflare-Konto** (dasselbe wie für Feibeitsblatt): Im Dashboard **R2 Object Storage** einmal aktivieren
   (Plan wählen; kostenlos bis 10 GB/Monat, Cloudflare verlangt dafür ein hinterlegtes Zahlungsmittel).
2. **API-Token** anlegen (Dashboard → Mein Profil → API-Tokens): Vorlage *„Cloudflare Workers bearbeiten“* und zusätzlich
   *Konto → D1 → Bearbeiten* – wie beim Feibeitsblatt. Fehlt in der Vorlage *Workers R2 Storage: Bearbeiten*, bitte ergänzen.
   Das vorhandene Feibeitsblatt-Token funktioniert, wenn es diese Rechte hat. Scheitert der Deploy an der Bindung `BROWSER`
   (PDF-Druck mit Cloudflare Browser Run), dem Token zusätzlich *Konto → Browser Rendering → Bearbeiten* geben.
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
  (je Q-Kurs; bei Ev. Religion auch das Schulcurriculum der Grundschule, Jahrgänge 1–4) als PDF hochladen und die Fach-Einstellungen
  prüfen. Jede Planungsgrundlage lässt sich aus der Planung heraus in einem neuen Tab öffnen (Original-PDF; ältere ohne PDF als Text,
  bis Sie mit „Original-PDF hinzufügen“ dieselbe Datei nachreichen). Dann: Fach → Klasse/Kurs → **Kurseinstellungen** (wann der Kurs
  stattfindet und wie viele Schüler:innen dazugehören – neue Einheiten übernehmen den Stundenplan, Claude nimmt die Schülerzahl als Zahl
  der Ausdrucke) → **Unterrichtseinheit planen**
  (Rahmendaten → „Einheit mit Claude planen“ → Leupold-Schema und Tabelle prüfen → „Einheit festlegen und Sitzungen anlegen“) →
  Sitzung öffnen → **„Stunde mit Claude planen“** (Prompt kopieren, in claude.ai mit dem Connector einfügen; Claude speichert
  Schulportal-Eintrag, Hausaufgabe, Materialien und Feibeitsblatt-Entwurf auf Wunsch direkt in der Sitzung – beim Zurückkehren
  erscheinen sie) → Schulportal-Eintrag prüfen und kopieren → „Prompt für die Präsentation kopieren“ → in claude.ai einfügen →
  die von Claude erzeugte **PDF** hochladen (Claude liefert nur die PDF, keine PowerPoint-Datei; die Präsentation ist zeitlos –
  ohne Datum, Klasse und Sitzungscode, Hausaufgabe „bis zur nächsten Unterrichtssitzung“ –, damit sie in ein paar Jahren in einer
  anderen Klasse desselben Jahrgangs wieder passt; Folie 1 ist eine gestaltete Titelfolie) → im Unterricht „Ich bin im Unterricht und
  starte die Präsentation für alle.“ Vor Folie 1 zeigt Unterricks dann automatisch die **Codefolie** – dieselbe wie „Für den Beamer
  zeigen“, mit dem Sitzungscode und dem QR-Code der **aktuellen** Sitzung – am Beamer und live auf den iPads. Wo die Präsentation den
  Code noch einmal zeigen soll, setzt Claude eine **Unterricks-Codefolie** (eine Folie mit der Zeile „Unterricks-Codefolie: …“); jede
  Materialfolie mit Material aus Unterricks ist eine – mit der Aufforderung und dem Titel des Materials, z. B. dem Namen des
  Feibeitsblatts, als Überschrift über Code und QR-Code (ausgedrucktes Material und Jahrgang 5/6 ohne iPads: gewöhnliche Folie mit
  „(auf Papier)“). Unterricks erkennt diese Folien beim Hochladen (die Meldung nennt sie, im Folienstreifen tragen sie „Code“) und
  zeigt im Unterricht an ihrer Stelle die Codefolie. „Sitzungscode zeigen“ (Taste C) blendet sie jederzeit ein. Im Präsentationsmodus
  sehen Sie groß die aktuelle Folie und daneben kleiner die **nächste** („Als Nächstes“; hochkant darunter). „Vorschau“ (Taste V)
  blendet sie aus und ein – Unterricks merkt sich die Wahl. Ist der Bildschirm auf den Beamer **gespiegelt**, sieht die Klasse die
  Vorschau mit: Blenden Sie sie dann aus, oder richten Sie den Beamer als **erweiterten Bildschirm** ein und öffnen Sie
  „Beamerfenster öffnen“. Das ist ein zweites Fenster nur mit der aktuellen Folie. Sie ziehen es auf den Beamer und klicken dort auf
  „Vollbild“; in Chrome und Edge geht das direkt über „Vollbild auf dem Beamer“. Gesteuert wird weiter im Präsentationsfenster, Pfeiltasten und
  Presenter wirken auch im Beamerfenster. Ein offenes Beamerfenster übernimmt jede neu gestartete Präsentation von selbst.
  **Beamer über ein zweites Gerät – z. B. Schul-iPad an Apple TV:** Ein iPad spiegelt per AirPlay immer den ganzen Bildschirm. Damit die
  Klasse trotzdem nur die aktuelle Folie sieht, öffnen Sie auf einem zweiten Gerät am Beamer (ein Schul-iPad, das an Apple TV spiegelt, oder
  ein PC bzw. Laptop am Beamer) `unterricks.janrickmer.de/#/beamer` – am besten als Lesezeichen bzw. auf dem Home-Bildschirm; auf der
  Startseite steht unten „Dieses Gerät als Beamer verwenden“. Das Gerät zeigt groß einen sechsstelligen **Beamer-Code** (10 Minuten
  gültig, danach erscheint von selbst ein neuer; beim Neuladen bleibt er stehen; hat zwei Stunden lang niemand einen Code eingegeben oder das Gerät berührt, holt es keinen
  neuen mehr – dann dort auf „Neuen Beamer-Code anzeigen“ tippen). In der Präsentation auf Ihrem iPad tippen Sie auf **„Beamer verbinden“** (auf allen
  Geräten, auch auf dem iPad) und geben den Code ein – das Feld öffnet sich in der Präsentation, das Vollbild bleibt. Spiegeln Sie Ihr
  iPad dann nicht. Nach etwa 2 Sekunden zeigt das Gerät am Beamer nur die aktuelle Folie (bzw. die Codefolie); Ihr iPad zeigt weiter die
  aktuelle und die nächste Folie und steuert, der Knopf heißt dann „Beamer verbunden“. Tasten und ein Presenter wirken nur auf Ihrem
  Gerät, nicht am Beamergerät. Die Kopplung gilt für diese Sitzung bis zu 6 Stunden, auch nach dem Neuladen des Beamergeräts; „Beamer
  verbunden“ → **„Beamer trennen“** löst sie (der Beamer zeigt dann „Getrennt“ und einen neuen Code). Nach „Präsentation für alle beenden“
  zeigt der Beamer „Die Präsentation ist beendet.“ und einen neuen Code für die nächste Stunde in diesem Raum; startet dieselbe Sitzung
  erneut, zeigt er sie wieder, ein Code aus einer anderen Sitzung holt ihn dorthin. Grenzen: Ein spiegelndes iPad behält sein
  Seitenverhältnis (Ränder am Beamer). Am Beamer-iPad die **„Automatische Sperre“** (Einstellungen → Anzeige & Helligkeit) auf „Nie“
  stellen – Unterricks hält den Bildschirm wach, wo der Browser das erlaubt; sperrt sich das iPad trotzdem, bricht AirPlay ab. Das
  Beamergerät braucht keine Anmeldung, zeigt nur, was auch die Schüler:innen live sehen (die nächste Folie lädt es nur unsichtbar vor), und zählt nicht als Schüler:in.
  **Timer für Arbeitsaufträge:** Im Präsentationsmodus öffnet **„Timer“** (Stoppuhr in der Leiste, am Laptop auch Taste T) ein Feld in der
  Präsentation – das Vollbild bleibt: Dauer wählen (1, 2, 3, 5, 10, 15 oder 20 Minuten oder eigene Minuten von 1 bis 120) und „Timer starten“.
  Der Timer steht dann **oben über der Präsentation**: live auf den iPads der Schüler:innen, im Beamerfenster, am Beamergerät und bei Ihnen über
  der großen aktuellen Folie (nicht über der Vorschau) – die Folie rückt darunter, nichts wird verdeckt. Er zeigt „Noch 4:12“ mit einem schmalen
  Balken, in der **letzten Minute orange**; ist die Zeit um, wird er **rot** und zeigt „Die Zeit ist um!“, bis Sie ihn schließen – ohne Ton,
  ohne Beschriftung. Während er läuft, zeigt der Knopf die Restzeit (am iPad hochkant nur die Stoppuhr in der Farbe des Timers, damit die Leiste
  nicht höher wird) und öffnet „Pause“/„Weiter“, „+1 Min“, „+5 Min“ (insgesamt höchstens 180 Minuten) und „Timer beenden“; nach Ablauf „+1 Min“,
  „+5 Min“ (der Timer beginnt dann mit dieser Zeit neu) und „Timer schließen“. Folienwechsel, „Sitzungscode zeigen“ und „Schließen“ des
  Präsentationsfensters lassen ihn weiterlaufen, „Präsentation für alle beenden“ beendet ihn. Die Restzeit rechnet der Server – falsch gehende
  Uhren der iPads spielen keine Rolle.
  **Notizen zu den Folien (nur für Sie):** Der Präsentations-Prompt bittet Claude, zu jeder Folie Stichpunkte für Sie zu schreiben (was Sie
  sagen, fragen oder beachten, Impulse, erwartete Antworten, Zeit) – nicht auf den Folien, sondern als **unsichtbaren Dateianhang** der PDF
  (`unterricks-notizen.json`); kann Claude keine Datei einbetten, steht der Block im Chat und Sie fügen ihn in Unterricks ein. Beim Hochladen
  übernimmt Unterricks die Notizen („Notizen zu n Folien übernommen“). In der Präsentationsansicht erscheinen sie als Stichpunkte **unter der
  großen aktuellen Folie** – aber **nur, wenn das Beamerbild getrennt läuft**: mit verbundenem Beamerfenster (erweiterter Bildschirm) oder
  Beamergerät („Beamer verbinden“). Ein einzeln gespiegeltes iPad (z. B. per AirPlay an Apple TV) oder ein gespiegelter Laptop zeigt sie
  nie – sonst sähe die Klasse sie mit; dort bleibt alles, wie es war (Folie und Vorschau), und die Leiste sagt kurz, wann Notizen erscheinen.
  Auch ein Beamerfenster zählt nur, solange es zu sehen ist und – in Chrome und Edge – ein zweiter Bildschirm erkannt ist (ein Beamerfenster auf
  demselben, gespiegelten Bildschirm oder ein zweiter Tab am iPad ist kein getrenntes Beamerbild).
  „Vorschau“ (Taste V) blendet Vorschau und Notizen gemeinsam aus. Ein eigener Knopf am iPad, der nur die Folien an Apple TV schickt, ist
  nicht zuverlässig möglich (AirPlay spiegelt) – deshalb gibt es zusätzlich unter **„Material nur für die Lehrkraft“** die **„Präsentation
  mit Anmerkungen – <Titel>.pdf“**: jede Folie, dahinter eine Anmerkungsfolie mit ihren Notizen (z. B. zum Ausdrucken neben dem iPad). In der
  Präsentationskarte der Sitzung zeigt **„Notizen ansehen und bearbeiten“** je Folie das Vorschaubild und ein Textfeld (ein Stichpunkt je
  Zeile); „Notizen speichern“ (mit Versionsschutz) erneuert die Anmerkungs-PDF, die PDF der Präsentation bleibt unverändert. Schüler:innen
  sehen die Notizen **nie**: weder live noch im Beamerfenster oder am Beamergerät, nicht in den Folienbildern und nicht in der PDF nach der
  Stunde – sie bekommen eine bereinigte Fassung ohne Anhänge und ohne Kommentare (Links bleiben), auch gekürzt bis zur markierten Folie;
  solange die fehlt, bekommen sie gar keine. Bereinigt wird auch, wenn Claude die Notizen entgegen dem Prompt anders in die PDF geschrieben
  hat (Kommentare oder Formen mit Text, Metadaten, Dokumenteigenschaften) – dann übernimmt Unterricks sie aber nicht als Notizen; bitten Sie
  Claude in dem Fall um den JSON-Block für „JSON aus dem Chat einfügen“. Nicht entfernen lässt sich Text, der unsichtbar auf den Folien selbst steht (z. B. weiße
  Schrift oder ausgeblendete Ebenen) – deshalb bittet der Prompt ausdrücklich nur um den Dateianhang. Ältere Präsentationen
  mit einem Code auf den Folien: Unterricks ersetzt ihn beim Hochladen durch den Code dieser Sitzung (wo das nicht sicher geht, z. B.
  bei einem unruhigen Foto hinter dem Code, bleibt die Folie unverändert und die Meldung nennt sie). Am Stundenende: Hausaufgabe eintragen und per
  Rechtsklick im Verlaufsplan „Zwischenstopp einfügen“, falls nicht alles geschafft wurde. In der nächsten Sitzung zeigt dann die Karte
  „Die letzte Stunde wurde nicht vollständig beendet“, was nicht geschafft wurde. Beim Planen mit Claude („Stunde mit Claude planen“)
  erklärt Claude zuerst den offenen Teil und fragt, ob er in diese Stunde übernommen oder darauf verzichtet wird (die Karte zeigt danach
  „Entschieden am …“). Übernehmen: Was keinen Platz mehr hat, rückt in die nächste Stunde der Einheit usw. – die Termine bleiben; für den
  Überhang am Ende fragt Claude, ob die Einheit um eine Stunde verlängert werden kann (bis zum nächsten Termin laut Stundenplan – Claude nennt
  ihn; nach Ihrer Zustimmung trägt Claude das selbst ein, mit Sitzung) oder ob gekürzt wird (drei Vorschläge, einer als Favorit). Verzichten: In der Zeile
  der vorigen Stunde steht danach, was tatsächlich behandelt wurde und worauf verzichtet wurde. Angepasst wird die Einheit erst, wenn Sie
  die Planung der neuen Stunde bestätigt haben. Setzen Sie den Zwischenstopp, nachdem die nächste Sitzung schon geplant ist, öffnen Sie
  dort erneut „Stunde mit Claude planen“. „Für das Schulportal kopieren“ bei der
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
* **Druckaufträge für den nächsten Arbeitstag:** Ganz oben auf beiden Startseiten (Startseite „Gymnasium“ und Übersicht
  „Grundschule“) steht ein oranges Feld mit Drucker-Symbol. Es zeigt die Druckaufträge **beider Schulformen** für den nächsten Tag mit
  Unterricht: Montag bis Donnerstag den folgenden Tag, Freitag bis Sonntag den Montag; ist dort laut Stundenplan kein Unterricht (Ferien,
  Feiertag oder ein ausgefallener Termin – maßgeblich sind die Stundenpläne der Einheiten und die Termine der Sitzungen, Ausfall-Einträge
  der Grundschule zählen nicht), nennt das Feld den freien Tag und zeigt den nächsten Tag mit Unterricht (höchstens 70 Tage voraus).
  Nach Sitzung gruppiert (Beginn, Fach und Klasse bzw. Grundschulkurs, Titel – ein Klick öffnet die Sitzung) stehen alle Dateien genau
  so wie in deren Liste „Von der Lehrkraft auszudrucken“, z. B. „28x - beidseitig - sw - Arbeitsblatt.pdf“ (in der Grundschule auch
  Arbeitsblätter der Kinder mit „Auch ausdrucken“). Jede Datei lässt sich einzeln herunterladen; **„Alle Dateien herunterladen“** lädt
  alle nacheinander als einzelne PDF-Dateien – bewusst keine ZIP-Datei – mit kurzer Pause dazwischen (Ihr Browser fragt beim ersten Mal
  womöglich, ob die Seite mehrere Dateien herunterladen darf). Von Claude gestaltete Vorlagen, die noch als PDF gedruckt werden, kommen
  erst danach dazu und werden genannt. Anzahl, Druckart und Namen ändern Sie in der Sitzung („In der Sitzung bearbeiten“ springt zu
  deren Druckliste); das Feld selbst ist nur eine Übersicht.
* **Wochenkalender:** Ganz oben auf Ihrer Startseite (unter den Druckaufträgen) steht die Woche (Mo–Fr) mit Ihrem Unterricht – aus den Stundenplänen Ihrer
  Unterrichtseinheiten (Wochentag, Uhrzeit, Dauer, Zeitraum, Ferien/Ausfälle). Mit ‹ › blättern Sie, „Heute“ führt zurück; am
  Wochenende zeigt er die kommende Woche. Unterricht ohne eingetragene Uhrzeit steht in der Zeile „ohne Uhrzeit“. Ein Klick auf einen
  Eintrag öffnet die Klasse bzw. den Kurs. Auf dem Handy und dem iPad hochkant erscheint die Woche als Liste je Tag. Der Kalender zeigt
  immer beide Schulformen – auf der Startseite „Gymnasium“ ebenso wie im Bereich „Grundschule“; Termine der Grundschule sind mit
  „Grundschule“ gekennzeichnet und öffnen den Grundschulkurs.
* **Aufforderungen an die Lehrkraft unterstrichen:** Muss die Lehrkraft an einer Stelle auf Material zurückgreifen, das nur sie hat
  (z. B. einen Vorlesetext oder eine Lösung), schreiben Claude und die kostenlose KI das als eigenen, unterstrichenen Stichpunkt in die
  Phase, z. B. `- __Lehrkraft liest den Vorlesetext ~~Die Arche Noah~~ vor.__` im Schulportal-Eintrag (bzw. im Verlaufsplan der
  Grundschule mit dem gelb markierten PDF-Verweis). Materialtitel, Leitfragen und Codes bleiben kursiv.
* **Beginn, Hausaufgabe, Präsentation:** Den Beginn der Sitzung tragen Sie im Stundenplan der Einheit (je Wochentag) oder in der
  Sitzung ein. Schüler:innen sehen die Hausaufgabe ab 15 Minuten vor dem Ende und können die Präsentation 5 Minuten nach dem Ende selbst
  öffnen – ohne Beginn weder noch. Am Ende der Stunde markieren Sie die letzte gezeigte Folie (im Vollbild „Bis hier gezeigt“ oder in
  der Sitzung, auch per Rechtsklick); Schüler:innen bekommen dann nur die Folien bis dorthin. Nach der Freigabe zeigt die Schüleransicht
  die Präsentation in einem Folienfenster (zuerst Folie 1, „Vorherige Folie“/„Nächste Folie“, Wischen und Pfeiltasten, Vollbild; mit
  Markierung „Folie 3 von 7“ und „So weit, wie ihr im Unterricht gekommen seid.“), darunter „Diese Präsentation herunterladen“ – die PDF
  bis zur Markierung als Datei. Folien nach der Markierung liefert der Server auch auf Umwegen nicht aus. „Für den Beamer zeigen“ zeigt neben dem
  Code einen QR-Code zu unterricks.janrickmer.de – dieselbe Codefolie erscheint beim Start der Präsentation vor Folie 1.
* **Arbeitsblätter und Material von Claude:** Claude gestaltet Arbeitsblätter, Texte, Schaubilder, Kärtchen und Erwartungshorizonte
  selbst als HTML-Seite und legt sie über den Connector ab (`add_material_pdf`); Unterricks druckt sie unverändert mit Chromium als
  A4-PDF (Cloudflare Browser Run, kostenlos bis 10 Minuten Browserzeit am Tag – das reicht für weit über hundert Seiten). Für
  Schüler:innen, nur für Sie oder in die Druckliste. Schüler:innen sehen ein Material, sobald seine PDF gedruckt ist; in der Sitzung
  steht dann „PDF, von Claude gestaltet · 2 Seiten“. Ist der Drucker gerade ausgelastet, druckt Unterricks nach, sobald Sie die
  Sitzung oder die Startseite öffnen („wartet auf den PDF-Drucker …“; der Tab kann dabei weiterarbeiten); meldet er einen Fehler, steht dort „Druck fehlgeschlagen“ mit „Erneut drucken“ – Claude kann die
  Gestaltung dann mit derselben Datei überarbeiten. Bei einer Krankheitsvertretung gibt es vor dem Bestätigen „Vorschau als PDF“. Der
  Chat mit kostenloser KI bleibt der Rückfall: „Als Material übernehmen“ setzt daraus eine einfache PDF ohne eigene Gestaltung.
  Nach dem Ausrollen prüft `https://<Worker-Adresse>/api/health/pdf` den Druck (höchstens einmal je Stunde; `?pdf=1` zeigt die
  Testseite).
* **Material:** auch Links mit Titel (für Schüler:innen oder nur für Sie). Ganz unten in der Sitzung: **„Von der Lehrkraft
  auszudrucken“** – nur PDF, alles A4 (andere Formate rechnet Unterricks um), Name wie „28x - beidseitig - sw - Arbeitsblatt.pdf“,
  einzeln oder alle als ZIP; Claude gestaltet Druckvorlagen über den Connector selbst (mit Anzahl, beidseitig und Farbe). Darunter **„Sitzung als Datei herunterladen“** und
  **„Sitzung aus Datei laden“**, um eine gehaltene Sitzung in einer anderen Lerngruppe erneut durchzuführen (Datum, Beginn und Dauer
  bleiben, Datumsangaben in den Texten werden angepasst, Feibeitsblätter kommen als Entwürfe).
* **Einheit als Datei:** Auf der Planungsseite einer Einheit, Karte **„Einheit als Datei“**, gibt es zwei Knöpfe.
  * **„Einheit als Datei herunterladen“** erzeugt eine ZIP-Datei. Darin liegt die Einheitsdatei mit Rahmendaten, Leupold-Schema und
    Ablauf. Dazu kommt je Sitzung ein Ordner, chronologisch nummeriert („01 - 12.11.2026 - …“), mit der Sitzungsdatei.
  * **„Einheit aus Datei laden“** geht nur in eine Einheit, zu der es noch keine Sitzungen gibt (auch über „Gesicherte Einheit laden“ in
    „Planung mit Claude“). Titel, Leupold-Schema und Ablauf kommen aus der Datei. Die Rahmendaten bleiben, die Termine werden neu
    verteilt. Die gesicherten Sitzungen warten auf diesem Gerät. Bei „Einheit festlegen und Sitzungen anlegen“ bekommt jede Sitzung
    ihren Inhalt (Materialien, Präsentation, Planungsverlauf, Hausaufgabe, Feibeitsblatt-Entwürfe), mit angepassten Datumsangaben.
  * Geladen werden kann auch nur die Einheitsdatei (.json) aus einer Sicherung. Dann kommt nur die Planung.
* **Unterricks zurücksetzen** (Einstellungen, ganz unten): **„Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen“**.
  * Gelöscht werden alle Unterrichtseinheiten und Sitzungen mit allem, was dazugehört – in der Grundschule auch Verlaufspläne,
    Bildkarten und Elternlinks (die verteilten Links funktionieren danach nicht mehr).
  * Es bleiben: Zugang, Planungsgrundlagen (mit ihren PDF-Dateien), Fach-Einstellungen mit Kursen, Kurseinstellungen (Stundenplan und
    Schülerzahl), die Grundschulkurse, KI, Connector, Feibeitsblatt-Verbindung, Schülerpasswort und Schülergeräte. Die Feibeitsblätter
    und ihre Abgaben bleiben im Feibeitsblatt.
  * Zuerst fragt Unterricks Ihr Passwort ab (zwei Fehlversuche sperren wie bei der Anmeldung 30 Minuten). Dann bietet es eine
    Sicherung als ZIP-Datei an: 1. Ebene Fächer, 2. Ebene Einheiten mit der Einheitsdatei, 3. Ebene die Sitzungen, chronologisch
    nummeriert, je als Sitzungsdatei. Sitzungen ohne Einheit liegen in „… - Sitzungen ohne Einheit“.
  * Vertretene Sitzungen bringen ihre ursprüngliche Planung mit (in der Sitzungsdatei unter „archive“ und im Ordner „archiv/“).
  * Die Grundschule liegt im Ordner „Grundschule/<Kurs> - <Einheit>/…“. Ihre Sitzungsdateien enthalten Verlaufsplan, Inhalt und
    Hinweis für die Eltern, Material und Bildkarten mit Erzähltexten; ein ausgefallener Termin steht als eigener Ordner
    „… - Unterricht ausgefallen“. Wieder in die Grundschule laden lassen sie sich bisher nicht („Lies mich.txt“ sagt es).
  * Gelöscht wird erst nach einer letzten Bestätigung mit Kästchen. Dort lässt sich die Sicherung auch erneut herunterladen. Hat sich
    seit der Sicherung etwas geändert (z. B. über Claude), löscht Unterricks nichts und bittet, neu zu sichern.
* **KI-Begriffshilfe:** Während der Stunde können Schüler:innen unter der Live-Präsentation Fachbegriffe kurz und einfach erklären
  lassen – nur nach ihrer Einwilligung, mit der kostenlosen KI; in den Sitzungsdaten abschaltbar. Bitte vor dem Einsatz prüfen, ob
  das an Ihrer Schule zulässig ist (siehe docs/ARCHITEKTUR.md, 4k).
* **Feibeitsblatt-Entwürfe:** Je Aufgabe steht ein **„Auftrag an die KI“** – keine Musterlösung, sondern die Anweisung an die
  korrigierende KI des Feibeitsblatts, worauf sie beim Lesen der Antwort achten soll, damit ihre Rückmeldung zeigt, was schon gut ist und
  was verbessert werden sollte. Unterricks ergänzt jeden Auftrag um die **altersgemäße Erwartung** der Lerngruppe (z. B. „Jahrgangsstufe
  7: eine kurze, richtige Antwort in eigenen Worten genügt …“), weil das Feibeitsblatt den Jahrgang nicht kennt; im Editor sichtbar und
  änderbar.
  **Links** zu anderen Internetseiten im Material und in der Aufgabenstellung schreiben Sie (und Claude) als `[Linktext](https://…)` oder als
  vollständige Adresse `https://…` – im Feibeitsblatt werden sie anklickbar und öffnen sich für die Schüler:innen in einem neuen Tab; der
  Editor zeigt unter dem Feld, welche Links erkannt wurden (**fett** geht in beiden Feldern mit `**…**`). Schon angelegte Feibeitsblätter
  ändern sich dadurch nicht (Feibeitsblätter sind unveränderlich) – wer dort anklickbare Links möchte, legt das Blatt neu an.
* **Notfall-Feibeitsblätter:** Zu jedem Feibeitsblatt der Sitzung legt Unterricks automatisch dessen analoges Arbeitsblatt
  (im Feibeitsblatt „Analoges Arbeitsblatt als PDF herunterladen“, dieselbe Datei) als PDF unter „Material – Für Schüler:innen
  zugänglich“ ab, sobald die Sitzung mit dem Feibeitsblatt verbunden ist. Nach dem Bestätigen der Checkliste wird es mit dem
  QR-Code zur Checkliste erneuert; entfernen Sie das Blatt aus der Sitzung, verschwindet auch sein Notfall-Feibeitsblatt. Zum
  Finale eines Escape-Rooms gibt es keines. Die Schüler:innen sehen die Notfall-Feibeitsblätter in einem eigenen, **zugeklappten**
  Kästchen „Notfall-Feibeitsblätter (nur bei technischen Problemen)“ unter dem Material; erst wenn sie es aufklappen, erscheinen der rote
  Hinweis, dass sie nur bei technischen Problemen gedacht sind, und die PDF-Dateien – so öffnen sie zuerst das Material. In den Jahrgängen 5 und 6 (nur analoges
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

## Grundschule

Menü **„Grundschule“** (zwischen „Gymnasium“ und „Planungsgrundlagen“). Ganz oben stehen die **Druckaufträge für den nächsten
Arbeitstag** (dasselbe Feld wie auf der Startseite „Gymnasium“, mit beiden Schulformen), darunter der Wochenkalender beider Schulformen,
„Ihre Kurse“ und „Zuletzt bearbeitet“.

* **Kurs anlegen:** Knopf **„Neuen Kurs anlegen“** im Kopf der Seite → Jahrgang 1–4, eine bis drei Klassen (a, b, c – z. B. alle Kinder aus
  2a oder gemischt 2a und 2b), Fach **„Religion (evangelisch)“** oder **„Anderes Fach“** mit Namen und optional einer Beschreibung, was
  die Kinder in diesem Kurs lernen sollen (Claude kennt so das Ziel des Kurses). Dazu im selben Schritt die Termine pro Woche (mit
  Uhrzeit), die Zahl der Kinder und das Schuljahr; bei einem anderen Fach als Religion lässt sich gleich ein Curriculum oder eine andere
  Planungsgrundlage als PDF hochladen. Planungsgrundlage eines Religionskurses ist das Schulcurriculum Ev. Religion (Grundschule) unter
  *Planungsgrundlagen → Evangelische Religion* („Schulcurriculum Grundschule (Jahrgänge 1–4)“).
* **Kursseite:** Unterrichtseinheiten mit ihren Sitzungen, Kurseinstellungen, „Fach, Klassen und Beschreibung“, die Planungsgrundlagen
  des Kurses (ließ sich die Original-PDF nicht speichern, reichen Sie sie dort mit „Original-PDF hinzufügen“ nach) und **„Neue
  Unterrichtseinheit planen“**. Einheiten planen Sie wie am Gymnasium (Rahmendaten → „Einheit mit Claude
  planen“ → Leupold-Schema und Tabelle → „Einheit festlegen und Sitzungen anlegen“) – ohne Klausurtermin, nur mit analogem Material.
* **Sitzung (Lehreransicht):** Ganz oben der **Verlaufsplan** (Phasen mit Minuten und Sozialform). Claude schreibt ihn beim Planen
  („Stunde mit Claude planen“ → `save_verlaufsplan`); mit **„Bearbeiten“** ändern Sie ihn selbst (wird automatisch gespeichert,
  daneben die Vorschau). Die PDF-Dateien stehen dort, wo sie benutzt werden, **gelb markiert und unterstrichen** – ein Klick öffnet die
  PDF in einem neuen Tab („PDF-Verweis einfügen …“ beim Bearbeiten). Wurden Sie nicht fertig: **„Zwischenstopp eintragen …“**, Rechtsklick
  auf eine Zeile oder am iPad eine Zeile antippen. In der nächsten Sitzung steht direkt unter dem Verlaufsplan, was nicht geschafft wurde;
  beim Planen mit Claude geht es wie am Gymnasium weiter (übernehmen oder verzichten, danach passt Claude die Einheit an – das Material
  aus dem offenen Teil verweist Claude weiter). Darunter der Stundenentwurf, die Einordnung in die Einheit, „Stunde mit Claude
  planen“, die **Bildkarten**, der **Materialkasten** (PDFs für die Kinder – mit „Auch ausdrucken (22×)“ zusätzlich auf der Druckliste
  – und Material nur für Sie; jede Datei sagt, ob Eltern sie sehen), die Druckliste, **„Inhalt und Hausaufgabe (für die Eltern)“**
  (Claude formuliert den Inhalt in 2–3 Sätzen, Sie können ihn ändern) und ganz unten die Karte **„Elternansicht“**. Kein
  Schulportal-Eintrag, keine Präsentation, kein Sitzungscode.
* **Bildkarten:** Claude gestaltet sie beim Planen selbst (eine Karte je Seite, mit einem gekürzten Erzähltext je Karte zum
  Nacherzählen), oder Sie laden eine PDF hoch (eine Seite = eine Karte). Die Erzähltexte prüfen und ändern Sie unter jeder Karte.
  Hochgeladene Bildkarten sehen Eltern erst, wenn Sie „Eltern dürfen diese Bildkarten sehen“ ankreuzen – Bildkarten von Verlagen dürfen
  meist nicht online weitergegeben werden. Die Bilder für die Elternansicht erstellt Ihr Browser, sobald Sie Unterricks öffnen.
* **Elternansicht:** **„Sitzungslink für Eltern kopieren“** legt einen geheimen, nicht erratbaren Link in die Zwischenablage (zum
  Weitergeben, z. B. per Elternbrief oder Messenger). Wer ihn hat, sieht diese Sitzung und alle vorherigen Sitzungen dieses Kurses im
  Schuljahr – jede erst, wenn sie laut Plan zu Ende ist (vorher „Diese Unterrichtssitzung hat noch nicht stattgefunden.“). Eltern sehen:
  den **„Hinweis der Lehrkraft“** (optional, ganz oben in einem roten Feld), die Bildkarten zum Durchklicken mit dem Erzähltext, den
  „Inhalt der Unterrichtsstunde“, die „Hausaufgabe“ (nur, wenn eine eingetragen ist), das „Material für die Schüler“ (nur PDFs der
  Kinder) und „Vorherige Unterrichtssitzungen dieses Schuljahres ansehen“. Bei einem Zwischenstopp nur das Material bis dorthin. Nie
  Ideen, Verlaufsplan, Code oder Material nur für Sie. **„Elternansicht ausprobieren“** zeigt Ihnen die Ansicht schon vorher. Ist ein
  Link in falsche Hände geraten: „Link erneuern“ – der bisherige funktioniert dann nicht mehr. Bitte in Hinweisen und Texten für Eltern
  keine Namen von Kindern nennen.
* **Krankheit:** Karte „Krankheit“ → **„Krankmeldung: Diese Stunde fällt aus“**. Eine Vorschau zeigt, wohin die Stunden rücken: Diese
  und alle folgenden Stunden der Einheit wandern um je einen Termin nach hinten (mit Verlaufsplan und Material); die letzte Stunde, die
  hinter das Ende der Einheit rutscht, bleibt ohne Datum in der Einheit stehen. Eltern sehen für den ausgefallenen Termin, dass der
  Unterricht leider nicht stattfinden konnte (der bisherige Elternlink gilt für diesen Termin weiter). In der Einheit und in jeder ihrer
  Sitzungen steht dann ein **roter Kasten** „Die Einheit muss wegen der Ausfälle überarbeitet werden“ mit **„Einheit mit Claude
  überarbeiten“** (kopiert den passenden Prompt; Claude passt die Einheit mit `save_unit_plan` an und verteilt die Termine neu),
  „Erledigt – Hinweis entfernen“ und – solange die Einheit seither nicht geändert wurde – „Krankmeldung rückgängig machen“.
  Vertretungsmaterial entsteht in der Grundschule nicht.

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
