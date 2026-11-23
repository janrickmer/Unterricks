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
   (`https://unterricks.<subdomain>.workers.dev`). Außerdem trägt er für die Dateiablage eine **Lebenszyklus-Regel** ein
   (`podcast-sicherheitsnetz`: Dateien unter `podcast/` verfallen nach 90 Tagen) – ein Sicherheitsnetz für Podcasts, die das Aufräumen von
   Unterricks einmal nicht erwischt. Fehlt dem Token das Recht dafür, meldet der Workflow nur eine Warnung (der Deploy läuft weiter);
   die Regel lässt sich dann im Dashboard unter *R2 → unterricks-files → Settings → Object lifecycle rules* von Hand anlegen.
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
`public/_headers` (CSP, `connect-src`). Eingebettet werden darf nur der Videoplayer von `https://www.youtube-nocookie.com` (CSP `frame-src`,
gleich in `public/_headers`, im Worker und – für GitHub Pages – in `scripts/build.mjs`; ein Unit-Test vergleicht alle drei).

## Bedienung in Kürze

* **Schüler:innen:** Seite öffnen → Passwort „Feindt“ → Fach und Klasse → Sitzungscode. Danach merkt sich das Gerät die Sitzung.
  Spätestens 90 Minuten nach der Passworteingabe wird abgemeldet; nach erneuter Eingabe von „Feindt“ geht es genau dort weiter
  (freigeschaltete Sitzungen und im Browser Gespeichertes bleiben, ein laufender Escape-Room wird wiederhergestellt).
  In Ev. Religion und Ethik wählen sie ebenfalls ihre eigene Klasse – die Plattform ordnet sie dem Kurs ihres Jahrgangs zu.
  Oben läuft die Live-Präsentation, darunter Material (Download, z. B. für GoodNotes) und Feibeitsblätter – Material mit eigener
  Materialfolie erscheint erst, wenn die Lehrkraft diese Folie live zeigt.
  Unter dem Feld für den Sitzungscode steht immer, wo es ihn gibt: Die Lehrkraft zeigt ihn zu Beginn der Stunde, und er steht im
  Schulportal im Feld „Hausaufgabe“. Hat eine spätere Sitzung des Kurses schon begonnen (laut Datum und Beginn – oder ihre
  Live-Präsentation läuft an ihrem Tag schon), steht in der älteren Sitzung ganz oben ein roter Hinweis „Das ist nicht die aktuellste
  Sitzung“ mit dem Knopf „Aktuellste Sitzung laden“ (führt zur Eingabe des Sitzungscodes). Ohne Neuladen erscheint er zum geplanten
  Beginn, beim Aufwachen des Geräts und – startet die Lehrkraft die Präsentation früher – in der halben Stunde vor dem Beginn
  spätestens nach einer Minute, solange die Seite offen ist. Eine Präsentation, die die Lehrkraft an einem früheren Tag nur angesehen
  und mit „Schließen“ offen gelassen hat, zählt nicht.
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
  **YouTube-Videos in der Präsentation (Videofolien):** Steht im Schulportal-Eintrag (in einer Phase) oder bei den Links der Sitzung ein
  YouTube-Video, nennt der Präsentations-Prompt es Claude mit der Phase, dem Link und – falls angegeben, z. B. „(1:30–4:05)“ hinter dem Link oder
  `?t=90` im Link – dem Ausschnitt und beschreibt genau die **Videofolie**: oben „Video: <Titel>“, darunter der Link (auch anklickbar), bei einem
  Ausschnitt „Ausschnitt: 1:30–4:05“, ein schlichtes Abspielsymbol und eine **unsichtbare Zeile**
  `Unterricks-Video: https://www.youtube.com/watch?v=… | Start: 1:30 | Ende: 4:05 | Titel: …`, an der Unterricks die Folie beim Hochladen
  erkennt (die Meldung nennt die Videofolien). Unter **„Videofolien“** in der Präsentationskarte prüfen und ändern Sie sie (Folie, Link, Start,
  Ende, Titel) oder legen sie selbst fest – auch für eigene PDFs ohne die Zeile; „Videofolien aus der PDF übernehmen“ macht das rückgängig.
  Im Unterricht steht auf einer Videofolie unter der Folie ein Feld mit Titel, Ausschnitt und den Knöpfen „Video abspielen“ bzw. „Pause“,
  „−10 s“, „+10 s“, „Von vorn“, „Video schließen“ und „Auf YouTube öffnen“. **„Weiter“** (→, Leertaste, Presenter, Tippen rechts) startet auf
  einer Videofolie zuerst das Video, ein weiteres „Weiter“ geht zur nächsten Folie. Wo das Video spielt, entscheidet Unterricks: an einem
  **verbundenen Beamergerät** („Beamer verbinden“, über den Server), sonst in einem **verbundenen Beamerfenster**, sonst **in der Präsentation
  selbst** (iPad bzw. Laptop gespiegelt) – nie doppelt. Das Feld sagt, wo, und meldet „Spielt am Beamer.“, „Pausiert.“, „Ausschnitt zu Ende.“
  (das Ende des Ausschnitts hält Unterricks selbst ein). Verliert der Beamer nur kurz die Verbindung (WLAN), läuft das Video dort weiter;
  „Beamer trennen“ beendet es sofort. Mit mehreren Beamern gibt nur der erste den Ton. Tippen Sie ins Video, steuern Pfeiltasten und Presenter
  danach trotzdem die Präsentation.
  Verlangt der Browser am Beamer für den Ton erst eine Bedienung an diesem Gerät (z. B. am iPad, das an Apple TV spiegelt), sagt das Feld es,
  und am Beamer steht „Video abspielen“ – einmal dort tippen bzw. direkt auf das Video. Lässt YouTube das Einbetten eines Videos nicht zu, sagt
  das Feld auch das; dann hilft „Auf YouTube öffnen“. Die **Schüler:innen** sehen live nur die Folie (mit Titel und Link) – auf ihren Geräten
  lädt nichts von YouTube; nach der Stunde steht im Folienfenster unter der Videofolie „Video auf YouTube ansehen: „…““ (öffnet YouTube in
  einem neuen Tab). Eingebettet wird nur der Player von youtube-nocookie.com, und erst, wenn Sie das Video abspielen: Google erhält dabei die
  IP-Adresse des Geräts, auf dem es spielt (Beamergerät, Beamerfenster bzw. Ihr Gerät), nie die der Schüler:innen. Grenzen: abgespielt mit
  einem echten YouTube-Video ließ es sich in der Testumgebung nicht (dort gibt es keine Videowiedergabe) – geprüft sind das Steuerprotokoll des
  Players und alle Abläufe mit einer Attrappe; bitte einmal am Schul-iPad und am Beamer ausprobieren.
  **Notizen zu den Folien (nur für Sie):** Der Präsentations-Prompt bittet Claude, zu jeder Folie Stichpunkte für Sie zu schreiben – **zuerst
  immer eine klare Anweisung, was Sie jetzt tun** („Lehrkraft: Erklärt kurz, was Martin Luther am Ablasshandel kritisiert hat.“ oder „Lehrkraft:
  Startet die Partnerarbeit (10 Min.) und geht herum.“; was Sie mit der Codefolie vor Folie 1 tun, steht als erster Satz der Anweisung zu
  Folie 1), danach die Hintergründe (was Sie sagen oder fragen, Impulse, erwartete Antworten, Zeit). Diese Anweisung ist hervorgehoben: in der
  Präsentationsansicht „Lehrkraft:“ fett in Orange – an der Codefolie vor Folie 1, mit der jede Stunde beginnt, steht schon die Anweisung aus
  Folie 1 –, in der „Präsentation mit Anmerkungen“ der ganze Stichpunkt fett, in der PowerPoint-Datei (geteilte Einheit, Ordner „Alle
  Unterlagen dieser Sitzung“) „Lehrkraft:“ fett; im Notizfeld der Sitzung ist sie die erste Zeile (eine Zeile, die Sie selbst mit „Lehrkraft:“
  beginnen, wird ebenso hervorgehoben; schreibt Claude „**Lehrkraft:**“, entfernt Unterricks die Sternchen). Eine „Präsentation mit
  Anmerkungen“ aus der Zeit vor dieser Hervorhebung bekommt den Fettdruck erst, wenn Sie die Präsentation neu hochladen oder „Notizen
  speichern“. In der geteilten Einheit stehen die Notizen wörtlich – auch der Satz zur Unterricks-Codefolie bei Folie 1, den Kolleg:innen ohne
  Unterricks überspringen können. Wie alle Notizen gehört die Anweisung laut Prompt nie auf
  die Folien – auch nicht unsichtbar –, sondern nur in den **unsichtbaren Dateianhang** der PDF
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
  Zeile); „Notizen speichern“ (mit Versionsschutz) erneuert die Anmerkungs-PDF, die PDF der Präsentation bleibt unverändert. Grenzen: je Folie
  höchstens 12 Stichpunkte mit je 300 Zeichen – was darüber hinausgeht, kürzt Unterricks beim Speichern und sagt es vorher am Feld und danach in
  der Meldung; in der Anmerkungs-PDF erscheinen Zeichen, die die Standardschrift nicht kennt (z. B. Emojis oder griechische Buchstaben), als „?“.
  Eine neu hochgeladene PDF ersetzt mit der alten Präsentation auch deren Notizen (es gelten die der neuen PDF); findet Unterricks im Anhang
  keine lesbaren Notizen, sagt es die Meldung nach dem Hochladen. Schüler:innen
  sehen die Notizen **nie**: weder live noch im Beamerfenster oder am Beamergerät, nicht in den Folienbildern und nicht in der PDF nach der
  Stunde – sie bekommen eine bereinigte Fassung ohne Anhänge und ohne Kommentare (Links bleiben), auch gekürzt bis zur markierten Folie;
  solange die fehlt, bekommen sie gar keine. Bereinigt wird auch, wenn Claude die Notizen entgegen dem Prompt anders in die PDF geschrieben
  hat (Kommentare oder Formen mit Text, Metadaten, Dokumenteigenschaften) – dann übernimmt Unterricks sie aber nicht als Notizen; bitten Sie
  Claude in dem Fall um den JSON-Block für „JSON aus dem Chat einfügen“. Nicht entfernen lässt sich Text, der unsichtbar auf den Folien selbst steht (z. B. weiße
  Schrift oder ausgeblendete Ebenen) – deshalb bittet der Prompt ausdrücklich nur um den Dateianhang. Ältere Präsentationen
  mit einem Code auf den Folien: Unterricks ersetzt ihn beim Hochladen durch den Code dieser Sitzung (wo das nicht sicher geht, z. B.
  bei einem unruhigen Foto hinter dem Code, bleibt die Folie unverändert und die Meldung nennt sie). Am Stundenende: Hausaufgabe eintragen und die letzte gezeigte Folie
  markieren – den Zwischenstopp im Schulportal-Eintrag trägt Unterricks dann selbst ein (siehe „Zwischenstopp aus der Präsentation“ unten); von Hand
  geht es weiter per Rechtsklick im Schulportal-Eintrag „Zwischenstopp einfügen“, falls nicht alles geschafft wurde. In der nächsten Sitzung zeigt dann die Karte
  „Die letzte Stunde wurde nicht vollständig beendet“, was nicht geschafft wurde. Beim Planen mit Claude („Stunde mit Claude planen“)
  erklärt Claude zuerst den offenen Teil und fragt, ob er in diese Stunde übernommen oder darauf verzichtet wird (die Karte zeigt danach
  „Entschieden am …“). Ist danach auch der Schulportal-Eintrag dieser Sitzung gespeichert (von Claude oder von Ihnen auf der Seite), ist der
  Hinweis erledigt und die Karte verschwindet ganz – beim Zurückkehren in den Tab, ohne Neuladen; die Zusammenfassung, das Datum oder eine
  geladene Sitzungsdatei allein reichen dafür nicht. Wird der Zwischenstopp der vorigen Sitzung verschoben oder ihr Eintrag geändert, gilt die
  Entscheidung nicht mehr und die Karte erscheint wieder (die Karte auf der Seite der Klasse bleibt wie bisher). Übernehmen: Was keinen Platz mehr hat, rückt in die nächste Stunde der Einheit usw. – die Termine bleiben; für den
  Überhang am Ende fragt Claude, ob die Einheit um eine Stunde verlängert werden kann (bis zum nächsten Termin laut Stundenplan – Claude nennt
  ihn; nach Ihrer Zustimmung trägt Claude das selbst ein, mit Sitzung) oder ob gekürzt wird (drei Vorschläge, einer als Favorit). Ist eine
  spätere Stunde, in die Inhalte nachrücken, schon geplant, sagt Claude es Ihnen: Deren Sitzung samt Material und Druckliste (und damit die
  Druckaufträge) passt sich nicht von selbst an – planen Sie sie dort mit „Stunde mit Claude planen“ neu. Verzichten: In der Zeile
  der vorigen Stunde steht danach, was tatsächlich behandelt wurde und worauf verzichtet wurde. Angepasst wird die Einheit erst, wenn Sie
  die Planung der neuen Stunde bestätigt haben. Setzen Sie den Zwischenstopp, nachdem die nächste Sitzung schon geplant ist, öffnen Sie
  dort erneut „Stunde mit Claude planen“. „Für das Schulportal kopieren“ bei der
  Hausaufgabe liefert sie im Format der Lehrkraft: **Hausaufgabe zum 25. November 2026:** (Datum der nächsten Sitzung), eine
  Leerzeile, je Zeile ein Stichpunkt und zuletzt „Unter https://unterricks.janrickmer.de kannst du diese Sitzung mit dem Code …
  aufrufen … Das Passwort, das du am Anfang brauchst, um *Unterricks* zu öffnen, lautet *Feindt*.“ (im selben Stichpunkt; im
  Schulportal kursiv als `~~Unterricks~~` und `~~Feindt~~`) – eingesetzt wird das Schülerpasswort aus den Einstellungen; lässt es
  sich gerade nicht laden, kopiert Unterricks nichts (dieser Hinweis erscheint nur im Schulportal). Enthält das Passwort Zeichen, die
  das Schulportal als Formatierung liest (z. B. `~~` oder einen Backtick), steht es als Quellcode statt kursiv bzw. fehlt der Satz –
  die Meldung nach dem Kopieren sagt es. Der Prompt „Stunde mit Claude planen“ beginnt mit dem Chat-Namen,
  z. B. „Jg. 8 - PoWi - Sitzung 1 - Das Bundesverfassungsgericht“ (Jahrgang bzw. „E-Phase“/„Q2 GK“, Fach, Stunde in der
  Einheit, Titel der Sitzung); den Namen vergibt claude.ai selbst – passt er nicht, im Dialog „Chat-Namen kopieren“ und in
  claude.ai über „Umbenennen“ einfügen.
* **Zusammenfassung der Sitzung für die Lehrkraft:** Gibt man Claude im Chat frei, die Planung abzulegen (auch nur einen Teil davon), schreibt
  Claude als letzten Speicherschritt – ohne eigene Rückfrage – auch eine kurze Zusammenfassung des Ablaufs, so, dass eine Lehrkraft, die nicht
  mitgeplant hat, versteht, was in der Stunde passieren wird (Ablauf mit ungefähren Minuten und Sozialformen, was die Lehrkraft tut und sagt, was
  die Schüler:innen tun, Materialien mit Titel, ein schon angelegtes Feibeitsblatt mit Code, erwartete Ergebnisse, Hausaufgabe, Stolperstellen;
  schlichte, gut vorlesbare Sätze ohne Abkürzungen, etwa 120–300 Wörter, ohne Namen von Schüler:innen). Connector: `update_lesson` mit
  `zusammenfassung_lehrkraft` (höchstens 4000 Zeichen, leer = löschen); fehlt sie oder beschreibt sie eine frühere Planung, erinnert die Antwort
  von `save_schulportal_entry` bzw. `save_verlaufsplan` daran; beim Umbau in eine Selbstlern-Phase bleibt sie, wie sie ist (sie beschreibt dann
  die ursprüngliche Planung). `get_lesson` zeigt sie im
  Abschnitt „Zusammenfassung der Sitzung für die Lehrkraft“. Sie steht in der Sitzung **ganz oben** (Gymnasium und
  Grundschule) in der Karte „Zusammenfassung der Sitzung für die Lehrkraft“. Die erste Zeile setzt Unterricks **automatisch** aus den
  aktuellen Sitzungsdaten – Fach, Jahrgang, Wochentag mit Datum und Beginn, z. B. „Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) ·
  Dienstag, 17.11.2026, 8:00 Uhr“ (ohne Uhrzeit „Beginn noch nicht eingetragen“); sie stimmt deshalb auch nach dem Verschieben. Darunter
  der Text, „Stand: …“ und – wurde der Schulportal-Eintrag bzw. Verlaufsplan danach geändert (ein Zwischenstopp zählt nicht) – der
  Hinweis „Die Planung wurde danach geändert – die Zusammenfassung ist vielleicht nicht mehr aktuell.“ Mit **„Bearbeiten“** ändern Sie
  sie selbst (leeren und speichern = löschen); hat Claude inzwischen eine neue Fassung gespeichert, fragt Unterricks wie beim
  Schulportal-Eintrag, welche gilt. Plant Claude ohne Connector, gibt es die Zusammenfassung am Ende zum Kopieren aus. Schüler:innen,
  Eltern, Beamer und Live-Präsentation sehen sie nie; sie kommt mit „Sitzung als Datei“ (Datumsangaben angepasst; war sie schon beim
  Herunterladen nicht mehr aktuell, bleibt der Hinweis) und der Sicherung mit.
* **Kurzplan für die Lehrkraft (Nachtrag 42):** Zusammen mit der Zusammenfassung schreibt Claude beim Planen für jede Phase des
  Schulportal-Eintrags bzw. Verlaufsplans 1–3 kurze, klare Anweisungen, was Sie dort tun (z. B. „Lehrkraft erklärt kurz, was Martin Luther am
  Ablasshandel kritisiert hat.“). Unterricks zeigt ihn **nur in „Ich bin jetzt im Unterricht“** statt des langen Verlaufsplans (siehe dort).
  Connector: `update_lesson` mit `kurzplan_lehrkraft` ([] = löschen; die Antwort nennt Phasen, die es im Plan nicht gibt), `get_lesson` zeigt ihn
  im Abschnitt „Kurzplan für die Lehrkraft“ samt Hinweis, wenn die Planung danach geändert wurde; ändert `save_schulportal_entry` bzw.
  `save_verlaufsplan` die Planung so, dass er nicht mehr passt, erinnert die Antwort daran. Beim Umbau in eine Selbstlern-Phase bleibt er (solange sie
  bzw. eine bestätigte Vertretung gilt, fordert `get_lesson` keinen neuen an).
* **Feibeitsblatt-Verbindung:** Türcode und Feibeitsblatt-Passwort nur einmal eingeben (Haken „Verbindung verschlüsselt in meinem
  Benutzerkonto speichern“). Danach verbindet sich Unterricks auf jedem Gerät, auf dem Sie sich mit Ihrem Passwort anmelden,
  automatisch; Geräte, die schon vorher angemeldet waren, entsperren sie einmal mit dem Unterricks-Passwort. Der Server sieht dabei
  weder Passwort noch Schlüssel.
* **Druckaufträge für den nächsten Arbeitstag:** Ganz oben auf beiden Startseiten (Startseite „Gymnasium“ und Übersicht
  „Grundschule“) steht ein oranges Feld mit Drucker-Symbol. Es zeigt die Druckaufträge **beider Schulformen** für den nächsten Tag mit
  Unterricht: Montag bis Donnerstag den folgenden Tag, Freitag bis Sonntag den Montag; ist dort laut Stundenplan kein Unterricht (Ferien,
  Feiertag oder ein ausgefallener Termin – maßgeblich sind die Stundenpläne der Einheiten mit den unterrichtsfreien Tagen aus den
  Einstellungen und die Termine der Sitzungen, Ausfall-Einträge der Grundschule zählen nicht), nennt das Feld den freien Tag und zeigt den
  nächsten Tag mit Unterricht (höchstens 70 Tage voraus) – unterrichtsfreie Tage mit Bezeichnung und Schule, z. B. „Von Montag, 05.10.2026,
  bis Freitag, 16.10.2026, ist unterrichtsfrei (Herbstferien, beide Schulen) – deshalb die Druckaufträge für …“. Dieselbe Regel bestimmt beim
  Podcast den „nächsten Schultag“.
  Nach Sitzung gruppiert (Beginn, Fach und Klasse bzw. Grundschulkurs, Titel – ein Klick öffnet die Sitzung) stehen alle Dateien genau
  so wie in deren Liste „Von der Lehrkraft auszudrucken“, z. B. „28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf“ (in der Grundschule auch
  Arbeitsblätter der Kinder mit „Auch ausdrucken“ und die Bildkarten der Sitzung, z. B. „1x - farbig - einseitig - Reli2 - Bildkarten – Josef.pdf“). Jede Datei lässt sich einzeln herunterladen; **„Alle Dateien herunterladen“** lädt
  seit dem 16.11.2026 (Nachtrag 36) alle Dateien des Tages als **eine ZIP-Datei**, z. B. „Druckaufträge - Dienstag, 17.11.2026.zip“ (vorher einzeln
  nacheinander). Am iPad öffnen Sie sie in der App „Dateien“: Antippen entpackt sie in einen Ordner. Heißen zwei Dateien gleich (z. B. dasselbe
  Arbeitsblatt für die 8A und die 8B), bekommt die zweite in der ZIP-Datei „ (2)“ – damit nichts überschrieben wird. Dateien einer Sitzung mit
  gleichen Druckangaben stehen als **Sitzungspaket** da (siehe unten) – im Feld oben mit „Herunterladen“, die einzelnen Dateien klein darunter, in
  der ZIP-Datei als eine PDF. Lässt sich eine Datei nicht
  laden, fehlt nur sie, und die Meldung unter dem Knopf nennt sie. Von Claude gestaltete Vorlagen, die noch als PDF gedruckt werden, kommen
  erst danach dazu und werden genannt. Anzahl, Druckart und Namen ändern Sie in der Sitzung („In der Sitzung bearbeiten“ springt zu
  deren Druckliste); das Feld selbst ist nur eine Übersicht.
* **Druckaufträge bis zum Ende der jeweiligen Sitzung (seit dem 16.11.2026):** Die Druckaufträge einer Sitzung bleiben im Feld, bis
  die Sitzung wirklich vorbei ist – geplantes Ende = Startzeit der Sitzung (aus dem Stundenplan ihrer Einheit bzw. von Hand in der Sitzung
  geändert) plus ihre Dauer; eine Sitzung ohne Uhrzeit bleibt bis zum Ende des Tages. Morgens stehen deshalb oft zwei Tage im Feld, z. B. um
  8:00 Uhr an einem Montag mit Stunden um 9:00 und 11:00: **„Heute, Montag, 16.11.2026“** mit beiden Stunden und **„Morgen, Dienstag,
  17.11.2026“**; der Titel heißt dann „Druckaufträge für heute und den nächsten Arbeitstag“, bei den Stunden von heute steht auch das Ende
  („09:00–09:45“). Jede Stunde verschwindet einzeln, sobald sie vorbei ist (um 9:50 Uhr steht unter „Heute“ nur noch die 11:00-Stunde), nach der
  letzten Stunde des Tages nur noch der nächste Arbeitstag – wie bisher. Das geschieht auch, wenn die Startseite offen bleibt: Unterricks lädt
  das Feld zum Ende der Stunde von selbst neu (die Uhr des Servers entscheidet), ohne die Seite neu zu laden; eine Zeile, in der Sie gerade
  eine Datei herunterladen, bleibt bis zum Ende des Downloads stehen, und der Tastaturfokus bleibt, wo er war. Ist das Netz gerade weg (z. B. kurz
  nach dem Aufwachen des iPads), bleiben die bisherigen Druckaufträge stehen, und Unterricks versucht es von selbst noch einmal. Den nächsten Arbeitstag bestimmt
  Unterricks wie bisher (unterrichtsfreie Tage, Ausfall-Einträge zählen nie). Hat heute keine der noch anstehenden Stunden Druckaufträge,
  sieht das Feld aus wie bisher. **„Alle Dateien herunterladen“** gibt es dann **je Tag** (unter „Heute“ nur die Dateien von heute, unter
  dem nächsten Arbeitstag nur dessen Dateien) – je Tag eine ZIP-Datei (Nachtrag 36), mit den Druck-Namen und den Bildkarten wie oben. Der rote
  Kasten folgt derselben Regel: Gegenstände für die heute noch anstehenden Stunden und für den nächsten Arbeitstag, je Tag beschriftet
  („Für heute und den nächsten Arbeitstag einpacken“).
* **Für den nächsten Arbeitstag einpacken:** Braucht eine Sitzung desselben Tages etwas, das Sie von zu Hause oder aus dem Lehrerzimmer
  mitbringen müssen (z. B. eine Bibel oder einen Beutel), steht direkt unter den Druckaufträgen ein **roter Kasten** mit diesen Gegenständen
  als Stichpunkte – für beide Schulformen, für denselben Tag wie die Druckaufträge (auch mit unterrichtsfreien Tagen; Ausfall-Einträge zählen
  nicht; ist eine Stunde des Gymnasiums eine Selbstlern-Phase (oder gilt dort noch eine ältere Vertretung), fehlen deren Gegenstände – Sie
  kommen ja nicht). Ein Klick (oder
  Enter) auf einen Gegenstand klappt in kleinerer Schrift auf, **an welcher Stelle und in welcher Lerngruppe** er
  gebraucht wird; die Lerngruppe führt zur Sitzung. Brauchen mehrere Stunden denselben Gegenstand, steht er einmal da (z. B. „Beutel ·
  2 Stunden“), aufgeklappt mit je einem Eintrag pro Stunde. Ohne Gegenstände gibt es den Kasten nicht. Die Gegenstände trägt **Claude beim
  Planen** ein („Stunde mit Claude planen“, Gymnasium und Grundschule – je Gegenstand höchstens zwei Sätze: wo in der Stunde und in welcher
  Lerngruppe); Sie ergänzen, ändern oder löschen sie auf der Sitzungsseite in der Karte **„Mitbringen“** (rechts unter den Sitzungsdaten;
  höchstens 10 je Sitzung). Hat Claude die Liste inzwischen geändert, übernimmt die Karte Ihre Änderung in den neuen Stand. Die Gegenstände
  kommen mit der Sitzungsdatei und der Sicherung mit; beim Laden einer Sitzungsdatei passt Unterricks Datum und Lerngruppe in den Hinweisen an.
  Schüler:innen und Eltern sehen sie nie.
* **Wochenkalender:** Ganz oben auf Ihrer Startseite (unter den Druckaufträgen) steht die Woche (Mo–Fr) mit Ihrem Unterricht – aus den Stundenplänen Ihrer
  Unterrichtseinheiten (Wochentag, Uhrzeit, Dauer, Zeitraum, Ferien/Ausfälle). Mit ‹ › blättern Sie, „Heute“ führt zurück; am
  Wochenende zeigt er die kommende Woche. Unterricht ohne eingetragene Uhrzeit steht in der Zeile „ohne Uhrzeit“. Ein Klick auf einen
  Eintrag öffnet die Klasse bzw. den Kurs. Auf dem Handy und dem iPad hochkant erscheint die Woche als Liste je Tag. Der Kalender zeigt
  immer beide Schulformen – auf der Startseite „Gymnasium“ ebenso wie im Bereich „Grundschule“; Termine der Grundschule sind mit
  „Grundschule“ gekennzeichnet und öffnen den Grundschulkurs. **Unterrichtsfreie Tage** (Einstellungen) stehen als schraffiertes Band
  oben am Tag, z. B. „Herbstferien – unterrichtsfrei (Gymnasium)“; der Unterricht der anderen Schule erscheint an dem Tag weiter, ist der
  Tag für beide Schulen frei, ist der ganze Tag schraffiert. Eine Sitzung, die trotzdem an einem solchen Tag liegt (nach „Nur speichern“),
  steht mit der Markierung „unterrichtsfrei“ da und öffnet die Sitzung.
* **Unterrichtsfreie Tage** (Einstellungen, ganz oben): Tragen Sie Ferien, Feiertage, Pädagogische Tage oder Brückentage als **Zeitraum mit
  Bezeichnung** ein („Von“ und „Bis“; ein einzelner Tag: „Bis“ wie „Von“) und wählen Sie bei **„Betrifft“**, ob der Eintrag die
  **Grundschule**, das **Gymnasium** oder **beide Schulen** betrifft – die Wahl ist Pflicht, es gibt keine Vorauswahl. Unterricks kennt
  keine Feiertage von selbst, auch keine halben Tage. An diesen Tagen gibt es für die betroffene Schule keine Termine: Der Kalender zeigt sie
  als unterrichtsfrei, „Sitzungen verfügbar“, „Termine neu verteilen“, die Krankmeldung der Grundschule, Claudes Planung (`extend_unit`,
  `save_unit_plan`), Druckaufträge und Podcast lassen sie aus. Liegen an den neuen Tagen schon Sitzungen (heute oder später, ohne
  Ausfall-Einträge) oder Stunden einer Einheit, fragt Unterricks vor dem Speichern mit einer Liste (Datum, Uhrzeit, Fach/Kurs, Klasse,
  Titel): **„Speichern und verschieben“** (empfohlen) rückt sie und alle folgenden Stunden ihrer Einheit auf die nächsten freien Termine
  laut Stundenplan – wie die Krankmeldung, aber ohne Ausfall-Eintrag; was hinter das Ende rutscht, bleibt ohne Termin –, danach steht in
  jeder betroffenen Einheit ein Hinweis mit **„Einheit mit Claude überarbeiten“** (Grundschule: der rote Kasten, Grund „unterrichtsfreie
  Tage“; Gymnasium: derselbe Kasten auf der Einheitsseite und auf den Sitzungsseiten der Einheit, dazu „überarbeiten“ in der Liste der Klasse;
  Sitzungen ohne Termin stehen dort am Ende und tragen „ohne Termin“). **„Nur speichern – Sitzungen
  bleiben“** lässt die Sitzungen, wo sie sind; sie tragen dann in Sitzung, Tabelle der Einheit und Kalender den Hinweis „Liegt auf einem
  unterrichtsfreien Tag (…)“. Sitzungen ohne Einheit verschieben Sie selbst (die Liste nennt sie). Wurde eine Einheit inzwischen woanders
  geändert, bleibt der Eintrag trotzdem gespeichert und die Meldung nennt sie. **Löschen** macht die Tage wieder zu Unterrichtstagen –
  verschobene Sitzungen rücken nicht zurück. Ein Datum, das Sie (oder Claude) direkt auf einen unterrichtsfreien Tag legen, lehnt Unterricks
  ab: „Am … ist unterrichtsfrei (Herbstferien, Gymnasium). Bitte einen anderen Tag wählen.“ Ebenso legt „Krankmeldung rückgängig machen“ keine
  Stunde zurück auf einen Tag, der inzwischen für die Grundschule unterrichtsfrei ist – dann passen Sie die Termine von Hand an. In den Rahmendaten jeder Einheit stehen die
  geltenden Tage ihrer Schule zur Ansicht („In den Einstellungen bearbeiten“); „Ferien und bekannte Ausfälle“ der Einheit bleibt für Ausfälle
  nur dieser Klasse (z. B. eine Exkursion). Claude sieht die Tage in `get_unit` (Abschnitt „Unterrichtsfreie Tage (…)“, im Zeitraum und bis acht
  Wochen danach) und in den Prompts („Unterrichtsfreie Tage: …“); Stunden, die nach „Nur speichern“ an einem solchen Tag liegen, nennen
  `get_unit`, `get_lesson` und der Prompt „Einheit mit Claude überarbeiten“ ausdrücklich – Claude fragt dann, ob sie verschoben werden sollen.
* **Podcast für den kommenden Unterricht:** Direkt unter dem Wochenkalender (Startseite „Gymnasium“ und Übersicht „Grundschule“ –
  derselbe Podcast) steht der Knopf mit Kopfhörer-Symbol **„Podcast für den kommenden Unterricht entwickeln“**. Ein Podcast erklärt den
  Ablauf **aller Stunden eines Tages** beider Schulformen in der Reihenfolge, in der Sie unterrichten. Ablauf:
  1. Klick auf den Knopf: Steht heute noch Unterricht bevor (eine Sitzung, deren Beginn später ist als jetzt; eine Sitzung ohne
     eingetragenen Beginn zählt bis 18 Uhr), fragt Unterricks „Für welchen Unterricht ist der Podcast gedacht?“ – „Heute, …“ oder
     „Nächster Schultag, …“. Sonst gilt gleich der nächste Schultag (wie bei den Druckaufträgen: Freitag bis Sonntag der Montag, Ferien und
     Ausfälle laut Stundenplan übersprungen). Selbstlern-Phasen (und ältere, bestätigte Vertretungen) gehören nicht dazu – die Karte nennt sie
     mit „Selbstlern-Phase – nicht im Podcast“.
  2. Die Karte nennt die Sitzungen des Tages mit ihrer Kopfzeile (Fach, Jahrgang, Wochentag, Datum, Beginn). Grundlage ist die
     **„Zusammenfassung der Sitzung für die Lehrkraft“**; fehlt sie, nimmt Unterricks **Thema und Schulportal-Eintrag** (Grundschule:
     **Verlaufsplan**) – ohne Schulportal-Zeichen und ohne die Zeile „⏸ Zwischenstopp“ – und sagt vorher, für welche Sitzungen das gilt.
     Endete die vorige Stunde eines Kurses mit einem **Zwischenstopp** und steht der offene Teil noch nicht in der Planung dieser Stunde
     (noch nicht entschieden bzw. „übernehmen“ entschieden, aber noch nicht neu geplant), nennt der Podcast ihn dazu („Achtung: In der
     vorigen Stunde dieses Kurses … wurde nicht alles geschafft …“), und die Karte sagt es bei der Sitzung – am besten planen Sie die
     Stunde vorher mit Claude. Der Quelltext ist auf etwa 20 000 Zeichen begrenzt (je Sitzung höchstens 4 000 samt offenem Teil, bei vielen
     Stunden etwas weniger – dann steht „Für den Podcast gekürzt.“ dabei).
  3. **„Auftrag für Claude in Chrome kopieren“**, dann in **Claude in Chrome** (Seitenleiste mit Strg+E bzw. Cmd+E) einfügen und Enter.
     Claude öffnet Gemini Notebook (notebook.google.com) in einem neuen Tab, legt das Notizbuch „Unterricks-Podcast TT.MM.JJJJ“ mit dem
     Quelltext als „Kopierter Text“ an, erzeugt im Bereich „Studio“ die „Audio-Zusammenfassung“ (Format „Detaillierte Analyse“, Deutsch;
     die Steueranweisung bittet um höchstens 12 bis 15 Minuten), wartet und lädt die Folge herunter. Fragt Google nach Anmeldung oder
     Bestätigung, hält Claude an – das erledigen Sie selbst.
  4. **Ziehen Sie die heruntergeladene Datei** aus den Downloads von Chrome (Download-Symbol oben rechts) auf das Feld **„Podcast-Datei
     hier ablegen oder auswählen“** (auch daneben auf die Seite; oder Feld anklicken bzw. antippen und die Datei auswählen). Erlaubt:
     M4A bzw. MP4-Audio, WAV, MP3, AAC, Ogg, WebM (Unterricks prüft die ersten Bytes, nicht nur die Endung), höchstens 95 MB.
  5. Sobald Sie Claude bestätigt haben, dass der Podcast in Unterricks zu sehen ist, fragt Claude, ob es das Notizbuch in Gemini Notebook
     löschen soll, und löscht nach Ihrer Zustimmung nur dieses Notizbuch.

  Danach steht an der Stelle des Knopfes der **Player** „Podcast zum Unterricht am Montag, 16. November 2026“ mit „Abspielen“, „Pause“,
  Schieberegler zum Spulen (Pfeiltasten ±5 s, Bild auf/ab ±30 s) und Zeitangabe, darunter „KI-erzeugt mit Gemini Notebook“, „Podcast
  löschen“ (mit Rückfrage) und „Podcast für einen anderen Tag entwickeln“. **Ohne Claude (z. B. am iPad):** aufklappbar in der Karte stehen
  Quelltext und Steueranweisung zum einzelnen Kopieren und die Schritte in Gemini Notebook von Hand.
  * **Voraussetzungen:** Claude in Chrome ist eine Browser-Erweiterung – nur in Chrome am Computer und mit einem bezahlten Claude-Tarif;
    Browser-Aufträge verbrauchen deutlich mehr Claude-Kontingent als ein Chat. Gemini Notebook nutzen Sie mit **Ihrem** Google-Konto (mit
    einem Schulkonto sind womöglich nur wenige Audio-Zusammenfassungen am Tag möglich, z. B. drei). Unterricks steuert Gemini Notebook nicht
    selbst (es gibt keine offizielle Schnittstelle dafür) und gibt Claude nie selbst einen Auftrag – er steht nur in Ihrer Zwischenablage.
  * **Länge:** In Gemini Notebook lässt sich die Länge auf Deutsch nicht fest vorgeben (laut Google-Hilfe gibt es die Längenauswahl nur auf
    Englisch); die Steueranweisung bittet um höchstens 12 bis 15 Minuten, garantiert ist das nicht.
  * **Datenfluss:** An Google gehen über Ihr Konto nur die Zusammenfassungen bzw. die Planung der Stunden (Quelltext unter „Ohne Claude“ zum
    Nachlesen). Unterricks speichert keine Namen von Schüler:innen, Claude schreibt die Zusammenfassungen ohne Namen, und die Steueranweisung
    verbietet Namen ausdrücklich; stehen trotzdem Namen in einer Zusammenfassung oder Planung (z. B. von Hand ergänzt), gehen sie mit – prüfen
    Sie den Quelltext im Zweifel vor dem Kopieren. Claude in Chrome sieht die Tabs, in denen es arbeitet –
    am besten ein eigenes Chrome-Profil nur für diese Arbeit verwenden. In Unterricks liegt die Folge in R2 (EU) und ist nur für Sie
    abspielbar (über einen signierten Link, 12 Stunden gültig) – nie für Schüler:innen, Eltern, am Beamer oder in der Präsentation. Die
    heruntergeladene Datei bleibt außerdem in Ihrem Download-Ordner, bis Sie sie löschen (die Karte erinnert daran), und in Gemini Notebook,
    bis Claude bzw. Sie das Notizbuch gelöscht haben.
  * **Löschen:** Ein Podcast je Tag (eine neue Datei ersetzt die alte). Ist der Unterrichtstag vorbei, erscheint wieder der Knopf; die Datei
    wird **zwei Tage nach dem Unterrichtstag** automatisch gelöscht (Podcast für Montag → ab Mittwoch 0:00 Uhr) – beim nächsten Öffnen einer
    Startseite bzw. im gelegentlichen Aufräumen; die Lebenszyklus-Regel für R2 (siehe Einrichtung, Schritt 4) ist das Sicherheitsnetz. Podcasts sind nicht
    in der Sicherung und nicht in Sitzungsdateien; „Unterricks zurücksetzen“ löscht sie mit.
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
* **Zwischenstopp aus der Präsentation (Nachtrag 34):** Den Zwischenstopp setzen Sie am Ende der Stunde nur noch einmal – mit der letzten gezeigten
  Folie (Auswahl „Letzte im Unterricht gezeigte Folie“, Rechtsklick auf eine Folie oder „Bis hier gezeigt“ in der Präsentation; am iPad die Auswahl oder „Bis hier gezeigt“). Unterricks
  trägt ihn dann selbst in den Schulportal-Eintrag ein und speichert ihn (mit demselben Hinweis zur nächsten Sitzung wie von Hand); die Meldung nennt
  die Phase, z. B. „Zwischenstopp im Schulportal-Eintrag vor „3) Partnerarbeit“ eingetragen.“ (in der Präsentation steht es kurz neben „Bis hier
  gezeigt“). Woher Unterricks die Phase einer Folie kennt: Der Präsentations-Prompt bittet Claude, auf jede Folie unsichtbar eine Zeile
  „Unterricks-Phase: 3“ zu schreiben (die Nummer der Phase **3)** im Schulportal-Eintrag) – als unsichtbaren Text oder winzig in der Farbe des
  Hintergrunds. Sie erscheint nicht in den Folienbildern (Beamer, Schüler:innen) und nie in der Überschrift einer Codefolie; nur in der Textebene der
  PDF, die Schüler:innen nach der Stunde herunterladen können, steht sie weiter (z. B. beim Markieren von Text) – harmlos, kein Geheimnis.
  **Regel** (Ihre Entscheidung „vor diese Phase“): Gehört die Folie nach der letzten gezeigten noch zur selben Phase, ist die Phase angefangen, aber nicht
  geschafft – der Zwischenstopp kommt **vor** sie; sonst vor die nächste Phase des Eintrags (auch eine Phase ohne eigene Folien gilt dann als nicht
  geschafft). Folien ohne Phase (z. B. Quellen) zählen nicht. Ist die letzte Phase gezeigt, ist die Stunde geschafft – kein Zwischenstopp. Heben Sie die
  Markierung auf („Markierung aufheben“ bzw. „Letzte Folie: alle Folien freigeben“), entfernt Unterricks den Zwischenstopp nur, wenn er noch dort steht,
  wo Unterricks ihn eingetragen hat; einen, den Sie selbst gesetzt oder verschoben haben, lässt es stehen. Eine neue Markierung setzt ihn immer neu.
  Steht die Phase nicht (mehr) im Eintrag (z. B. umnummeriert), ändert Unterricks nichts und sagt es. **Präsentationen ohne diese Zeile** (ältere
  oder eigene PowerPoint-Exporte): kein automatischer Zwischenstopp – das steht an der Auswahl der letzten Folie. Unter **„Phasen der Folien“** in der
  Präsentationskarte legen Sie dann je Phase des Schulportal-Eintrags fest, bei welcher Folie sie beginnt (vorbelegt aus den Zeilen der PDF; auch
  zum Korrigieren); „Phasen aus der PDF übernehmen“ macht das rückgängig. Haben Sie die letzte Folie schon markiert, trägt Unterricks den
  Zwischenstopp gleich beim Speichern der Zuordnung ein (einen, den Sie selbst gesetzt oder verschoben haben, lässt es dabei stehen). Die Zuordnung
  kommt mit in „Sitzung als Datei“ und in die Sicherung. Phasen nach „--> Nächste Stunde“ zählen mit: Endet die Stunde wie geplant vor ihnen, steht
  der Zwischenstopp vor der ersten von ihnen – so bleibt sichtbar, was noch offen ist (so von Ihnen am 16.11.2026 bestätigt). Haben Sie an einem anderen Gerät markiert, holt die Seite vor
  dem Markieren bzw. Aufheben erst den neuesten Stand.
  Den Zwischenstopp von Hand setzen und verschieben können Sie wie bisher; in der Grundschule (ohne Präsentation) ändert sich nichts.
* **„Ich bin jetzt im Unterricht“ (Nachtrag 35):** Ganz oben in jeder Sitzung (über der Zusammenfassung) steht dieser Knopf. Er zeigt die Sitzung
  kompakt für die Stunde selbst, in dieser Reihenfolge:
  1. **Präsentation:** „Präsentation live starten“ (derselbe Präsentationsmodus wie „Ich bin im Unterricht und starte die Präsentation für alle.“ –
     läuft sie schon, auch auf einem anderen Gerät, geht es an der laufenden Stelle weiter; „Bis hier gezeigt“ trägt den Zwischenstopp ein wie oben),
     „Präsentation als PDF-Datei herunterladen“ (die PDF, wie Sie sie hochgeladen haben) und – gibt es Notizen – „Präsentation mit Anmerkungen
     herunterladen“ (nur für Sie). Die Dateien werden wirklich heruntergeladen, auch über unterricks.janrickmer.de und am iPad. Daneben der Stand:
     „LIVE · Folie 5 / 12 · 23 verbunden“ bzw. „Gerade nicht live.“
  2. **Verlaufsplan – kompakt (Nachtrag 42):** je Phase nur die fette Überschrift und darunter, etwas größer, **was Sie als Lehrkraft tun** – z. B.
     „Lehrkraft liest den Erzähltext ‚Josef‘ bis Nr. 3 vor und legt dabei die Bildkarten 1–3 hin.“ Diesen **„Kurzplan für die Lehrkraft“** schreibt Claude
     beim Planen gleich mit (je Phase 1–3 kurze Anweisungen; Connector: `update_lesson` mit `kurzplan_lehrkraft`, `get_lesson` zeigt ihn). Gibt es
     keinen (ältere Sitzungen) oder passt er nicht mehr, weil der Schulportal-Eintrag danach geändert wurde, kürzt Unterricks selbst: die Phasen mit Ihren
     unterstrichenen Aufgaben (__…__), bei einer Phase ohne solche Zeile ihr erster Stichpunkt, gekürzt. Ein kleiner Satz darüber sagt, was Sie sehen
     („Kurzplan von Claude“ bzw. „Automatisch gekürzt – …“). „--> Nächste Stunde“ und der Zwischenstopp stehen an ihrer Stelle; liegt der
     Zwischenstopp mitten in einer Phase, steht darüber nur ihr Anfang und der offene Rest als „(Fortsetzung)“ darunter (die Anweisungen von Claude
     gelten für die ganze Phase und tragen dann einen kurzen Hinweis). Der **vollständige
     Verlaufsplan** ist darunter aufklappbar („Vollständigen Verlaufsplan anzeigen“). Den Kurzplan sehen Sie nur hier – nicht in der vollständigen
     Ansicht, nicht in „Alle Unterlagen dieser Sitzung“, und Schüler:innen, Eltern und Beamer nie; er kommt mit „Sitzung als Datei“ und in die Sicherung.
     Ein **grüner Pfeil** am rechten Rand („jetzt“) zeigt auf die
     Phase, in der die Live-Präsentation gerade ist – er folgt jeder Folie ohne Neuladen, auch wenn Sie an einem anderen Gerät oder in einem anderen
     Tab blättern. Die Codefolie vor Folie 1 gehört zur Phase von Folie 1, eine Folie ohne Phase zur Phase der Folie davor. Läuft die Präsentation nicht
     live oder tragen die Folien keine Phasen (siehe „Phasen der Folien“), gibt es keinen Pfeil; ein ruhiger Satz darüber sagt, warum. Einen
     Zwischenstopp setzen Sie hier auch von Hand: Rechtsklick auf eine Phase (am iPad: antippen) – er steht dann vor ihr; genauer im aufgeklappten
     vollständigen Verlaufsplan (jede Zeile) oder mit „Zwischenstopp eintragen …“ (per Tastatur).
  3. **Material** als Tabelle: links **„Für Schüler:innen sichtbar“** (Feibeitsblätter mit „Code kopieren und Feibeitsblatt öffnen“ wie bei den
     Schüler:innen, Material und Links für Schüler:innen, zuletzt die Notfall-Feibeitsblätter), rechts **„Nur für die Lehrkraft“** (Ihr Material,
     Notfall-Feibeitsblätter für Lehrkräfte und alles von der Druckliste, markiert **„zum Ausdrucken“**, unter dem Namen der Druckliste). Jeder
     Eintrag öffnet bzw. lädt wie in der vollständigen Ansicht. Am Handy stehen die Spalten untereinander, jede mit ihrer Überschrift.
  4. **Hausaufgabe:** dasselbe Feld wie in der vollständigen Ansicht (gleiches Speichern, gleiche Hinweise, „Für das Schulportal kopieren“).

  **„Vollständige Ansicht“** führt zurück. Umschalten verliert nichts (Hausaufgabe und Schulportal-Eintrag sind dieselben Felder) und beendet nie
  eine laufende Präsentation. Was ein anderes Gerät ändert (z. B. „Bis hier gezeigt“ am iPad, während der Laptop die kompakte Ansicht zeigt), steht
  hier nach spätestens 20 Sekunden – sofort, wenn Sie ins Fenster zurückkehren oder die Präsentation beginnt bzw. endet. Gerade nach dem Öffnen rollt
  die Seite nicht von selbst zur aktuellen Phase. Die kompakte Ansicht bleibt beim Neuladen dieses Tabs erhalten und endet, wenn Sie die Sitzung verlassen. In einer
  **Selbstlern-Phase** (und bei einer älteren, laufenden Vertretung) gibt es den Knopf nicht – Sie sind dann nicht im Unterricht; nach
  „Wiederherstellen“ ist er wieder da.
* **Arbeitsblätter und Material von Claude:** Claude gestaltet Arbeitsblätter, Texte, Schaubilder, Kärtchen und Erwartungshorizonte
  selbst als HTML-Seite und legt sie über den Connector ab (`add_material_pdf`); Unterricks druckt sie unverändert mit Chromium als
  A4-PDF (Cloudflare Browser Run, kostenlos bis 10 Minuten Browserzeit am Tag – das reicht für weit über hundert Seiten). Für
  Schüler:innen, nur für Sie oder in die Druckliste. Schüler:innen sehen ein Material, sobald seine PDF gedruckt ist; in der Sitzung
  steht dann „PDF, von Claude gestaltet · 2 Seiten“. Ist der Drucker gerade ausgelastet, druckt Unterricks nach, sobald Sie die
  Sitzung oder die Startseite öffnen („wartet auf den PDF-Drucker …“; der Tab kann dabei weiterarbeiten); meldet er einen Fehler, steht dort „Druck fehlgeschlagen“ mit „Erneut drucken“ – Claude kann die
  Gestaltung dann mit derselben Datei überarbeiten. Der
  Chat mit kostenloser KI bleibt der Rückfall: „Als Material übernehmen“ setzt daraus eine einfache PDF ohne eigene Gestaltung.
  Nach dem Ausrollen prüft `https://<Worker-Adresse>/api/health/pdf` den Druck (höchstens einmal je Stunde; `?pdf=1` zeigt die
  Testseite).
* **Material:** auch Links mit Titel (für Schüler:innen oder nur für Sie). Ganz unten in der Sitzung: **„Von der Lehrkraft
  auszudrucken“** – nur PDF, alles A4 (andere Formate rechnet Unterricks um), Name wie „28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf“
  (siehe **Dateinamen der Druckliste**), einzeln oder alle als ZIP; Claude gestaltet Druckvorlagen über den Connector selbst (mit Anzahl, beidseitig und Farbe). Darunter **„Sitzung als Datei herunterladen“** und
  **„Sitzung aus Datei laden“**, um eine gehaltene Sitzung in einer anderen Lerngruppe erneut durchzuführen (Datum, Beginn und Dauer
  bleiben, Datumsangaben in den Texten werden angepasst, Feibeitsblätter kommen als Entwürfe). Ganz unten (Gymnasium und Grundschule):
  **„Alle Unterlagen herunterladen (ZIP)“** – ein Ordner mit Verlaufsplan (PDF), am Gymnasium der Präsentation als PDF und PowerPoint (Ihre Notizen in
  der Referentenansicht) samt Notizen zu den Folien, den Druckvorlagen unter ihrem Druck-Namen und allem übrigen Material, nach Schüler:innen und
  Lehrkraft getrennt; was fehlt (z. B. noch nicht gedruckt), nennt ein Hinweis.
* **Dateinamen der Druckliste:** Jede Datei, die Sie ausdrucken (Druckliste der Sitzung, in der Grundschule auch Arbeitsblätter mit
  „Auch ausdrucken“, Bildkarten und die Konzentrationsaufgabe, „Druckaufträge für den nächsten Arbeitstag“, ZIP-Datei, einzelne Downloads),
  heißt **„Anzahl - sw/farbig - einseitig/beidseitig - Kurs - Titel.pdf“**, z. B. „23x - sw - einseitig - Reli4 - Die Arche Noah.pdf“,
  „1x - farbig - einseitig - Reli2 - Bildkarten Arche Noah.pdf“ oder „5x - sw - beidseitig - Reli2 - Konzentrationsaufgabe – Schöpfung.pdf“.
  Der Kurs ist die Kurzform des Fachs mit dem Jahrgang, ohne Leerzeichen: Ev. Religion „Reli“, Politik und Wirtschaft „PoWi“, Ethik „Eth“;
  Klasse 8a oder Kurs 8-K → „PoWi8“, „Reli8“, „Eth8“; E-Phase (Klassen EA–EH, Kurs E-K) → „PoWiE“, „ReliE“; Qualifikationsphase mit
  Kurshalbjahr und Grund- bzw. Leistungskurs → „PoWiQ3LK“, „ReliQ1GK“. Grundschule: Religion → „Reli“ + Jahrgang („Reli4“), ein anderes
  Fach → die ersten vier Buchstaben seines Namens + Jahrgang („Sachunterricht“ → „Sach3“). Der Name entsteht beim Herunterladen – auch schon
  vorhandene Dateien heißen so, und ändern Sie Fach oder Jahrgang eines Grundschulkurses, heißen seine Dateien gleich danach entsprechend.
  Den Titel wählen Sie wie bisher („Umbenennen“ in der Druckliste); Anzahl, schwarz-weiß/farbig und einseitig/beidseitig stellen Sie in
  der Zeile ein – in dieser Reihenfolge. Laden Sie eine früher heruntergeladene Druckdatei wieder hoch (z. B. für eine andere Klasse), behält
  Unterricks nur ihren Titel: „23x - sw - einseitig - Reli4 - Die Arche Noah.pdf“ heißt in einer Sitzung der Reli3 mit 21 Exemplaren
  „21x - sw - einseitig - Reli3 - Die Arche Noah.pdf“ – nie doppelt.
* **Sitzungspaket (seit dem 23.11.2026, Nachtrag 42):** Sollen mehrere Dateien einer Sitzung gleich oft, gleich farbig und gleich ein- bzw.
  beidseitig gedruckt werden (z. B. Bildkarten und Erzählkarten für den Sitzkreis, je 1x, einseitig, farbig), fasst Unterricks sie beim Drucken
  zu **einer** PDF-Datei zusammen – ein Druckauftrag statt vieler. Sie heißt nach dem bekannten Muster, nur mit dem Titel „Sitzungspaket“, z. B.
  **„1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf“**. Darin stehen die Materialien in der Reihenfolge, in der der Verlaufsplan sie braucht:
  in der Grundschule nach den PDF-Verweisen des Verlaufsplans, am Gymnasium nach der Stelle, an der der Schulportal-Eintrag ihren Titel nennt
  (kursiv, z. B. „~~AB - Gewaltenteilung~~“); nicht genannte stehen dahinter. Beim beidseitigen Druck beginnt jedes Material auf einem neuen Blatt
  (nach einem Material mit ungerader Seitenzahl eine Leerseite; die Datei endet mit einer geraden Seitenzahl, damit auch die nächste Kopie auf
  einem neuen Blatt beginnt). Das Paket gilt überall beim Drucken: in der Druckliste der Sitzung (oben die Paketzeile mit „Herunterladen“ und der
  Reihenfolge, darunter klein die einzelnen Dateien – ändern Sie dort Anzahl, Farbe oder Druckart einer Datei, kommt sie aus dem Paket bzw. in ein anderes),
  in „Alle herunterladen (ZIP)“, in den „Druckaufträgen …“ der Startseiten samt der ZIP-Datei des Tages (zwei gleich benannte Pakete zweier
  Sitzungen bekommen „ (2)“), in „Ich bin jetzt im Unterricht“ und im Ordner „Zum Ausdrucken“ von „Alle Unterlagen dieser Sitzung“ (der
  Verlaufsplan im Ordner nennt dann das Paket und den Teil, z. B. „Zum Ausdrucken/… - Sitzungspaket.pdf (Teil 2)“; ein Arbeitsblatt der Kinder
  mit „Auch ausdrucken“, das in einem Paket steckt, liegt zusätzlich als eigene Datei in „Material für die Kinder“). Was noch nicht als PDF
  gedruckt ist oder sich nicht lesen lässt, bleibt draußen und wird genannt – mit dem Grund, z. B. „wird gerade als PDF gedruckt“ oder „der
  PDF-Druck hat nicht geklappt – in der Sitzung „Erneut drucken““; ist erst eine Datei eines Pakets fertig, kommt sie einzeln. Lässt sich ein
  Paket im Browser nicht zusammenfügen, liegen seine Dateien in den ZIP-Dateien einzeln (mit Hinweis); „Herunterladen“ des Pakets sagt es und
  nennt die Dateien, die Sie dann über ihre eigenen Zeilen darunter herunterladen. Die Dokumenteigenschaften der Paket-PDF (Betreff) nennen,
  welche Datei auf welchen Seiten steht. Das Paket wird nicht gespeichert – es entsteht jedes Mal neu aus den Druckangaben, die Namen der
  einzelnen Dateien bleiben, wie sie sind.
* **Einheit als Datei:** Auf der Planungsseite einer Einheit, Karte **„Einheit als Datei“**, gibt es zwei Knöpfe.
  * **„Einheit als Datei herunterladen“** erzeugt eine ZIP-Datei. Darin liegt die Einheitsdatei mit Rahmendaten, Leupold-Schema und
    Ablauf. Dazu kommt je Sitzung ein Ordner, chronologisch nummeriert („01 - 12.11.2026 - …“), mit der Sitzungsdatei.
  * **„Einheit aus Datei laden“** geht nur in eine Einheit, zu der es noch keine Sitzungen gibt (auch über „Gesicherte Einheit laden“ in
    „Planung mit Claude“). Titel, Leupold-Schema und Ablauf kommen aus der Datei. Die Rahmendaten bleiben, die Termine werden neu
    verteilt. Die gesicherten Sitzungen warten auf diesem Gerät. Bei „Einheit festlegen und Sitzungen anlegen“ bekommt jede Sitzung
    ihren Inhalt (Materialien, Präsentation, Planungsverlauf, Hausaufgabe, Feibeitsblatt-Entwürfe), mit angepassten Datumsangaben.
  * Geladen werden kann auch nur die Einheitsdatei (.json) aus einer Sicherung. Dann kommt nur die Planung.
* **Mit Kolleg:innen teilen:** Ganz unten auf der Seite jeder Einheit (Gymnasium und Grundschule) erzeugt **„Unterrichtseinheit mit KollegInnen
  teilen“** einen ZIP-Ordner zum Weitergeben:
  * **„Leupold-Schema - <Titel>.pdf“** – das Schema, darunter zu jeder Sitzung ein kurzer Absatz: was passiert, die zentrale Kompetenz (in der
    Oberstufe aus dem KCGO, sonst aus der hinterlegten Planungsgrundlage bzw. dem Curriculum der Grundschule) und das Ziel der Sitzung. Die Absätze
    schreibt Claude: **„Absätze mit Claude schreiben“** kopiert den Prompt; Claude liest Einheit, Planungsgrundlagen und Sitzungen über den Connector,
    zeigt Ihnen die Absätze und speichert sie nach Ihrer Zustimmung. Unter **„Absätze prüfen und bearbeiten“** ändern Sie sie. Beim Planen einer
    Stunde mit Claude entsteht der Absatz künftig gleich mit.
  * **„Erklärung - Das ist ein Feibeitsblatt.pdf“** (nur wenn die Einheit Feibeitsblätter nutzt): was ein Feibeitsblatt ist und wie es funktioniert;
    fett der Hinweis, dass Kolleg:innen das digitale Feibeitsblatt nach Absprache mit Ihnen nutzen können (die Abgaben kämen bei Ihnen an) – sonst
    bearbeiten die Schüler:innen das Notfall-Feibeitsblatt auf dem Tablet als Dokument.
  * je geplanter Sitzung ein Ordner **„Sitzung 1“, „Sitzung 2“ …** (Nummer der Stunde in der Einheit) mit der Präsentation – als PDF und als
    PowerPoint-Datei (jede Folie als Bild, Links anklickbar; Ihre Notizen zu den Folien stehen in den Notizen der Folie, also in der
    Referentenansicht von PowerPoint; den Folientext kann man in PowerPoint nicht ändern) –, den Notizen zu den Folien (eigene PDF), dem Verlaufsplan und allen PDF-Dateien der Sitzung (für Schüler:innen samt Notfall-Feibeitsblättern, Druckliste, Material für die
    Lehrkraft, in der Grundschule samt Bildkarten). In der Präsentation fallen reine Codefolien weg; Materialfolien bleiben, ihre kleine
    Unterricks-Zeile wird überdeckt. Jede Folie trägt unten klein und blass „Copyright Jan-Rickmer Feindt“ (ebenso Leupold-Schema, Erklärung,
    „Fehlende Sitzungen“ und die Verlaufspläne). Ältere Präsentationen mit aufgedrucktem Sitzungscode: der Code wird überdeckt; ein QR-Code zu
    Unterricks kann noch zu sehen sein – das sagt ein Hinweis nach dem Herunterladen. Bei einer Selbstlern-Phase bzw. Vertretung kommt die
    ursprüngliche Planung in den Ordner. Was fehlt (z. B. ein Notfall-Feibeitsblatt oder eine Präsentation), zählt der Dialog „Hinweise zum
    Ordner“ nach dem Herunterladen auf.
  * **„Fehlende Sitzungen.pdf“**, wenn noch nicht alle Stunden geplant sind: die noch nicht geplanten Stunden mit Stundenfrage und grobem Ablauf.
* **Unterricks zurücksetzen** (Einstellungen, ganz unten): **„Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen“**.
  * Gelöscht werden alle Unterrichtseinheiten und Sitzungen mit allem, was dazugehört – in der Grundschule auch Verlaufspläne,
    Bildkarten und Elternlinks (die verteilten Links funktionieren danach nicht mehr).
  * Es bleiben: Zugang, Planungsgrundlagen (mit ihren PDF-Dateien), Fach-Einstellungen mit Kursen, Kurseinstellungen (Stundenplan und
    Schülerzahl), die Grundschulkurse, die unterrichtsfreien Tage, KI, Connector, Feibeitsblatt-Verbindung, Schülerpasswort und Schülergeräte.
    Die Feibeitsblätter und ihre Abgaben bleiben im Feibeitsblatt. Die unterrichtsfreien Tage stehen zum Nachlesen in der Sicherung
    („Unterrichtsfreie Tage.txt“).
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
  lassen – nur nach ihrer Einwilligung, mit der kostenlosen KI; in den Sitzungsdaten abschaltbar. In einer Selbstlern-Phase steht sie ganz
  unten und gibt es bis zur nächsten Sitzung mit Ihnen (siehe „Ohne Lehrkraft: Selbstlern-Phase“). Bitte vor dem Einsatz prüfen, ob
  das an Ihrer Schule zulässig ist (siehe docs/ARCHITEKTUR.md, 4k und 4x) – das gilt ebenso für den Erklär-Chatbot und eingebettete YouTube-Videos.
* **Feibeitsblatt-Entwürfe:** Je Aufgabe steht ein **„Auftrag an die KI“** – keine Musterlösung, sondern die Anweisung an die
  korrigierende KI des Feibeitsblatts, worauf sie beim Lesen der Antwort achten soll, damit ihre Rückmeldung zeigt, was schon gut ist und
  was verbessert werden sollte. Unterricks ergänzt jeden Auftrag um die **altersgemäße Erwartung** der Lerngruppe (z. B. „Jahrgangsstufe
  7: eine kurze, richtige Antwort in eigenen Worten genügt …“), weil das Feibeitsblatt den Jahrgang nicht kennt; im Editor sichtbar und
  änderbar.
  **Links** zu anderen Internetseiten im Material und in der Aufgabenstellung schreiben Sie (und Claude) als `[Linktext](https://…)` oder als
  vollständige Adresse `https://…` – im Feibeitsblatt werden sie anklickbar und öffnen sich für die Schüler:innen in einem neuen Tab; der
  Editor zeigt unter dem Feld, welche Links erkannt wurden (**fett** geht in beiden Feldern mit `**…**`). Schon angelegte Feibeitsblätter
  ändern sich dadurch nicht (Feibeitsblätter sind unveränderlich) – wer dort anklickbare Links möchte, legt das Blatt neu an.
  **Bilder, PDF-Dateien und YouTube-Videos** (Nachtrag 37): Claude kann einer Aufgabe außer Text auch **Bilder und PDF-Dateien dieser
  Sitzung** (hochgeladen oder von Claude als PDF gestaltet) und **YouTube-Videos** als Material mitgeben. Der Entwurf zeigt sie je Aufgabe
  in einer eigenen Gruppe – Bilder mit Vorschau, Anzeige (groß unter der Aufgabenstellung oder klein daneben) und Bildbeschreibung zum
  Vorlesen, PDF-Dateien mit Größe, Videos mit Startzeit und Link; alles lässt sich dort entfernen. Dateien aus **„Nur für die Lehrkraft“**
  sind erlaubt (z. B. ein PDF, das Claude nur für das Feibeitsblatt gestaltet), tragen aber einen Warnhinweis: Im Feibeitsblatt sieht sie
  jede:r mit dem Code. Beim Anlegen überträgt Unterricks die Bilder (verkleinert auf höchstens 1600 px und 500 KB) und die PDF-Dateien
  (höchstens 6 MB je Datei, 20 MB je Blatt) ins Feibeitsblatt; fehlt eine Datei inzwischen oder wird ein gestaltetes PDF noch gedruckt,
  wird das Blatt erst gar nicht angelegt. Scheitert das Übertragen einer Datei, nennt die Bestätigung sie mit „Erneut versuchen“. Videos
  anderer Seiten bleiben Links im Material. Eine Sitzungsdatei nimmt nur die Videos eines Entwurfs mit, keine Bilder und PDF-Dateien.
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
* **Material erscheint mit seiner Materialfolie (Nachtrag 44):** Hat ein Material für Schüler:innen bzw. ein Feibeitsblatt eine eigene
  Materialfolie in der Präsentation (eine Unterricks-Codefolie, deren Überschrift seinen Titel nennt), sehen die Schüler:innen es erst,
  wenn Sie diese Folie live zeigen – dann erscheint es ohne Neuladen in ihrer Ansicht unter „Material“ (markiert „neu“), das
  Notfall-Feibeitsblatt mit seinem Feibeitsblatt. Einmal freigegeben bleibt es sichtbar, auch nach der Stunde – auch wenn Sie danach
  „Bis hier gezeigt“ setzen. Wurde die Folie nie live gezeigt (auch wenn Sie die Präsentation gar nicht live über Unterricks zeigen, z. B.
  die PDF direkt), wird das Material wie die Präsentation 5 Minuten nach dem Ende der Sitzung frei (nur bis zur markierten letzten
  gezeigten Folie) – in der Stunde selbst geben Sie es dann mit „Jetzt freigeben“ frei. Material ohne eigene Materialfolie, Sitzungen ohne
  Präsentation, ohne Beginn oder Dauer, Selbstlern-Phasen und die Jahrgänge 5/6 bleiben wie bisher. In der Sitzung und in „Ich bin jetzt im
  Unterricht“ steht am Material klein, ab welcher Folie es erscheint bzw. seit wann es sichtbar ist; mit **„Jetzt freigeben“** zeigen Sie
  ein wartendes Material sofort (z. B. wenn der Beamer streikt). Scheitert bei einem iPad das Nachladen (WLAN), versucht die Seite es von
  selbst noch einmal. Der Server gibt wartendes Material auch über die Schnittstelle nicht heraus, und die KI-Begriffshilfe kennt die Codes
  der Feibeitsblätter nicht. Hinweis: Veröffentlichen Sie den Code eines Feibeitsblatts schon vorher im Schulportal, kennen die
  Schüler:innen ihn von dort.
* **Feibeitsblatt aus einer früheren Sitzung (Nachtrag 45):** Ist ein Feibeitsblatt mit dieser Sitzung und mit einer früheren Sitzung
  desselben Kurses verknüpft („Vorhandenes Feibeitsblatt verknüpfen“ oder Claude mit `link_feibeitsblatt`, z. B. nach einem
  Zwischenstopp), steht es bei den Schüler:innen als **„Wieder gebraucht“**: ein Feld für ihre Zwischenstand-PDF, dann „Im Feibeitsblatt
  weiterarbeiten“ – Feibeitsblatt öffnet sich in einem neuen Tab mit ihrem Zwischenstand (die PDF geht nur von Tab zu Tab, nie über
  einen Server). Kann das Feibeitsblatt die Übergabe noch nicht, sagt Unterricks nach 10 Sekunden, wie man die PDF dort selbst
  hochlädt. Darunter klein der Code und „Von vorn beginnen“ (Code kopieren und Feibeitsblatt öffnen wie bisher). Vor dem ersten Einsatz
  einmal auf einem echten iPad ausprobieren: Safari kann den Unterricks-Tab im Hintergrund anhalten – dann käme die PDF erst an, wenn
  man kurz zu Unterricks zurückwechselt.
* **Kurse in Ev. Religion und Ethik (Jg. 5–10, E-Phase):** Je Jahrgang gibt es einen Kurs mit Schüler:innen aus mehreren
  Klassen. Fach wählen → beim Jahrgang **„Kurs anlegen“** → alle Klassen ankreuzen, die im Kurs vertreten sind (später über
  „Klassen ändern“ anpassbar). Sitzungen und Einheiten, die bisher in einer dieser Klassen lagen, ziehen dabei in den Kurs um.
  Politik und Wirtschaft bleibt im Klassenverband, die Qualifikationsphase bei GK/LK.
  Ist das Claude-Kontingent erschöpft, plant der Chat **„Backup: Planung mit kostenloser KI“** in derselben Sitzung weiter
  (Groq, danach automatisch Workers AI); „Schulportal-Eintrag erstellen“ baut dann auf diesem Verlauf auf.
* **Ohne Lehrkraft: Selbstlern-Phase** (ersetzt seit dem 15.11.2026 die Krankheitsvertretung, nur Gymnasium): Können Sie zu einer Sitzung
  nicht da sein, klicken Sie in der Sitzung (Karte „Ohne Lehrkraft“) auf **„Präsenz der Lehrkraft nicht möglich – Unterricht in
  Selbstlern-Phase umbauen“**. Wie bei „Stunde mit Claude planen“ wählen Sie Sprachmodell und Aufwand, kopieren den Prompt und öffnen
  claude.ai. Claude liest die Sitzung (`get_lesson`: Thema, Stundenfrage, geplanter Inhalt, Material, Zeile der Einheit), behält
  Lerninhalte und Stundenziel und stellt Ihnen **mindestens drei Ideen** für eine Selbstlern-Sitzung vor, die ganz ohne Lehrkraft
  funktioniert – als Stationen in einer festen Reihenfolge: eine **selbst durchklickbare, erklärende Präsentation**, ein
  **Feibeitsblatt**, ein **KI-Chatbot, dem die Schüler:innen erklären, was sie erarbeitet haben** (er fragt kritisch nach), ein
  **YouTube-Video** (nur ein Video, dessen Link Sie Claude geben – Claude erfindet keine), ein **Escape-Room** nach dem bekannten
  Aufbau, Material oder ein einfacher Arbeitsauftrag. Erst wenn Sie einer Idee **ausdrücklich zustimmen**, legt Claude das Material an und
  stellt die Sitzung mit `save_selbstlern` in einem Schritt um. Muss vorher Material von Hand gelöscht werden (der Connector kann nichts
  löschen), nennt Claude Ihnen im Chat genau welche Dateien (Titel und Bereich) und wartet auf Ihre Bestätigung.
  Beim Umstellen wird die **ursprüngliche Planung archiviert** (Schulportal-Eintrag, Hausaufgabe, Material und Feibeitsblätter, auf
  die keine Station verweist – für die Schüler:innen unsichtbar). Claude schreibt den **Schulportal-Eintrag** für die Selbstlern-Phase neu
  (die Schüler:innen öffnen die Sitzung mit dem Code), und die **Hausaufgabe** lautet: alle Stationen bis zum Beginn der nächsten Stunde
  **mit Ihnen** erledigen (mit Datum, wenn diese Sitzung schon angelegt ist; Selbstlern-Phasen dazwischen zählen nicht) – die
  Schüler:innen sehen sie **von Anfang an**, nicht erst 15 Minuten vor dem Ende. Die Karte **„Selbstlern-Phase“** oben in der Sitzung zeigt,
  was die Schüler:innen ganz oben lesen, den Ablaufplan mit allen Stationen (Material, Video-Link, was dem Chatbot erklärt wird und – nur
  für Sie – woran er eine gute Erklärung erkennt), die Hausaufgabe, einen Hinweis für die Aufsicht und die archivierte Planung.
  Feibeitsblätter der Stationen legen Sie dort mit „Feibeitsblatt prüfen und anlegen“ an (beim Escape-Room das Finale). Mit
  **„Wiederherstellen – zurück zur normalen Sitzung“** kehrt die ursprüngliche Planung zurück; das Material der Selbstlern-Phase wird
  dabei gelöscht (der Dialog nennt es). „Ursprüngliche Planung in eine andere Sitzung übernehmen“ kopiert sie z. B. in die nächste Stunde.
  Die Selbstlern-Phase lässt sich mit Claude jederzeit überarbeiten (derselbe Knopf). **Jahrgang 5/6** (keine iPads): derselbe Knopf, aber
  **analoge Stationen** – Laufzettel, Arbeitsblätter je Station und eine Lösungskontrolle auf Ihrer Druckliste (Anzahl = Schülerzahl);
  die Aufsicht teilt nur aus. Die Druckaufträge für den nächsten Arbeitstag kennzeichnen solche Sitzungen mit „Selbstlern-Phase –
  Ausdrucke für die Aufsicht“. Ältere Vertretungsvorschläge bleiben lesbar (verwerfen), ältere aktive Vertretungen lassen sich wie bisher
  wiederherstellen.
  **Das sehen die Schüler:innen (ab Jahrgang 7, mit iPads):** Ganz oben die Erklärung, dass Sie zu dieser Sitzung nicht da sein können und es
  deshalb einen Selbstlern-Unterricht gibt (samt dem Satz von Claude), darunter den **Ablaufplan** – die Stationen nummeriert in der richtigen
  Reihenfolge, je mit Arbeitsauftrag, Minuten und ihrem Element: die **Präsentation** zum Durchklicken im Folienfenster (die Folien entstehen auf
  dem iPad aus der PDF, „Präsentation herunterladen“ darunter), das **Feibeitsblatt** mit „Code kopieren und Feibeitsblatt öffnen“, der
  **Erklär-Chatbot** (die Schüler:innen erklären, der Chatbot fragt nach – eine Rückfrage auf einmal, kurz und in der Sprache des Jahrgangs; „Gespräch
  beenden und Rückmeldung bekommen“ liefert eine kurze Rückmeldung, was gut erklärt war und was sie sich noch einmal ansehen sollten), das
  **YouTube-Video** (erst nach einem Klick eingebettet, siehe unten) und der Escape-Room. Jede Station lässt sich abhaken – das merkt sich nur das
  Gerät. Darunter die **Hausaufgabe** (von Anfang an), weiteres Material und **ganz unten die KI-Begriffshilfe** für Fachbegriffe und
  Verständnisfragen (kurz, in der Sprache der Altersgruppe; sie erledigt keine Stationen und keine Hausaufgaben). Es gibt kein Live-Fenster und
  nicht die Präsentation der ursprünglichen Planung. **Erklär-Chatbot und KI-Begriffshilfe gibt es ab dem Beginn der Sitzung bis zum Beginn der
  nächsten Sitzung mit Ihnen** (die Stationen sind bis dahin Hausaufgabe; ist die nächste Sitzung noch nicht angelegt, bis 7 Tage nach dem Ende);
  nach der Abmeldung nach 90 Minuten geht es mit dem Passwort weiter, ein Gespräch beginnt dann neu. Den Schalter für die KI-Begriffshilfe in
  den Sitzungsdaten gibt es weiter; der Erklär-Chatbot gehört zur Station. In Jahrgang 5/6 (auf Papier) sehen die Schüler:innen den Hinweis und die
  Stationen als Schritte, die Hausaufgabe und „Den Laufzettel und die Arbeitsblätter der Stationen bekommst du ausgedruckt.“ – ohne Live-Fenster.
  In keiner Selbstlern-Phase sehen die Schüler:innen die Präsentation der ursprünglichen Planung. Auf der Sitzungsseite sagen auch Hausaufgabe
  („für Schüler:innen von Anfang an sichtbar“, fällig zur nächsten Sitzung mit Ihnen) und Sitzungsdaten, was in der Selbstlern-Phase gilt. Fehlen Sie
  mehrere Tage, nennt der vorgeschlagene Hausaufgaben-Text immer den aktuellen Termin der nächsten Sitzung mit Ihnen (ein eigener Text bleibt, wie er ist).
  **Zusammenspiel:** Endete die vorige Stunde mit einem **Zwischenstopp**, fragt Claude im Chat zur Selbstlern-Phase zuerst, ob der offene Teil
  als Station in die Selbstlern-Phase kommt oder ob darauf verzichtet wird; nach dieser Entscheidung und dem Umstellen verschwindet der Hinweis
  „Die letzte Stunde wurde nicht vollständig beendet“ wie nach einer normalen Planung (nach „Wiederherstellen“ gilt er für die ursprüngliche
  Planung wieder). Planen Sie danach die **nächste Stunde mit Ihnen**, nennt `get_lesson` Claude die Selbstlern-Phase davor samt Stationen und der
  jetzt fälligen Hausaufgabe – Claude fragt Sie, ob die Stunde mit einer kurzen Besprechung der Ergebnisse beginnt. Die Karte „Mitbringen“ einer
  Selbstlern-Sitzung sagt, warum ihre Gegenstände nicht im roten Kasten der Startseite stehen. „Sitzung als Datei herunterladen“ enthält bei einer
  Selbstlern-Phase ihre jetzige Fassung (der Hinweis danach sagt es); die ursprüngliche Planung steht in der großen Sicherung.
  **Datenschutz (für Schüler:innen und Eltern):** Beide KI-Chatbots nutzen dieselben kostenlosen KI-Dienste wie die KI-Begriffshilfe und dieselbe
  Einwilligung (einmal je Sitzung und Gerät, gilt für beide; jederzeit zurücknehmbar). An den KI-Dienst gehen nur der eingetippte Text, das Thema der
  Sitzung und beim Erklär-Chatbot der Auftrag der Station – nie Namen oder eine Kennung des Geräts; Unterricks speichert die Gespräche nicht. Wer
  keine KI nutzen möchte, schreibt die Erklärung ins Heft. Ein **YouTube-Video** lädt die Seite erst nach dem Klick auf „Video von YouTube laden“
  (über youtube-nocookie.com, ohne Vorschaubild); dabei erhält Google unter anderem die IP-Adresse und kann Cookies setzen, Daten können in die USA
  gelangen – so steht es auch über dem Knopf. Die Zustimmung zum Video speichert Unterricks nicht. „Video in neuem Tab öffnen“ öffnet YouTube direkt.
* **Speicher (Fußzeile):** Ganz unten auf jeder Seite der Lehrkräfteansicht steht, wie viel des Speichers von Unterricks belegt ist, z. B.
  **„Speicher: 12 % belegt“**. Es gibt zwei Grenzen: **Dateien** (Material, Präsentationen, Bildkarten, PDFs der Planungsgrundlagen, Podcasts)
  höchstens **9 GB**, die **Datenbank** (Sitzungen, Einheiten, Texte, Chats) höchstens **500 MB** – so bleibt Unterricks im kostenlosen
  Angebot von Cloudflare. Angezeigt wird der knappere der beiden Werte; ein Klick bzw. Antippen zeigt beide („Dateien: 1,1 von 9 GB ·
  Datenbank: 40 von 500 MB“). Ab 80 % erscheint ein Warnsymbol mit dem Hinweis, bei Gelegenheit nicht mehr benötigte Dateien oder Sitzungen
  zu löschen, ab 95 % steht der Wert rot mit „fast voll“ da (bei vollem Dateispeicher lassen sich keine Dateien mehr hochladen). Die Zahl wird
  alle paar Minuten aktualisiert und beim Aufklappen neu abgefragt. Schüler:innen, Eltern und der Beamer sehen sie nie.
* **Nach einem Update von Unterricks:** Ein Tab, der schon vorher offen war, merkt das beim nächsten Seitenwechsel (z. B. beim Klick auf
  eine Sitzung) und lädt sich dann an derselben Stelle neu – Sie müssen nichts tun. Solange ein Dialog offen ist, eine Präsentation läuft
  (auch am Beamergerät und im Live-Fenster der Schüler:innen) oder noch etwas gespeichert, hochgeladen oder heruntergeladen wird, lädt er
  nicht von selbst neu; fehlt dann ein Programmteil, erscheint der Hinweis „Unterricks wurde aktualisiert“ mit „Jetzt neu laden“. Der Knopf
  speichert vorher, was sich speichern lässt (im Escape-Room geht es danach an derselben Stelle weiter); gibt es noch ungespeicherte
  Änderungen, z. B. eine Zusammenfassung in Bearbeitung, lädt er nicht neu, sondern bittet Sie, erst zu speichern.

## Grundschule

Menü **„Grundschule“** (zwischen „Gymnasium“ und „Planungsgrundlagen“). Ganz oben stehen die **Druckaufträge für den nächsten
Arbeitstag** (dasselbe Feld wie auf der Startseite „Gymnasium“, mit beiden Schulformen), darunter der Wochenkalender beider Schulformen,
der **Podcast für den kommenden Unterricht** (derselbe wie auf der Startseite „Gymnasium“), „Ihre Kurse“ und „Zuletzt bearbeitet“.

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
* **Sitzung (Lehreransicht):** Ganz oben die **Zusammenfassung der Sitzung für die Lehrkraft** (wie am Gymnasium, Kopfzeile z. B.
  „Religion · Jahrgang 2 (Klassen 2a, 2b) · Montag, 16.11.2026, 9:50 Uhr“), darunter der **Verlaufsplan** (Phasen mit Minuten und Sozialform). Claude schreibt ihn beim Planen
  („Stunde mit Claude planen“ → `save_verlaufsplan`); mit **„Bearbeiten“** ändern Sie ihn selbst (wird automatisch gespeichert,
  daneben die Vorschau). Die PDF-Dateien stehen dort, wo sie benutzt werden, **gelb markiert und unterstrichen** – ein Klick öffnet die
  PDF in einem neuen Tab („PDF-Verweis einfügen …“ beim Bearbeiten). Wurden Sie nicht fertig: **„Zwischenstopp eintragen …“**, Rechtsklick
  auf eine Zeile oder am iPad eine Zeile antippen. In der nächsten Sitzung steht direkt unter dem Verlaufsplan, was nicht geschafft wurde;
  beim Planen mit Claude geht es wie am Gymnasium weiter (übernehmen oder verzichten, danach passt Claude die Einheit an – das Material
  aus dem offenen Teil verweist Claude weiter); ist entschieden und danach der Verlaufsplan dieser Sitzung gespeichert, verschwindet der Hinweis. Darunter der Stundenentwurf, die Einordnung in die Einheit, „Stunde mit Claude
  planen“, die **Bildkarten**, der **Materialkasten** (PDFs für die Kinder – mit „Auch ausdrucken (22×)“ zusätzlich auf der Druckliste
  – und Material nur für Sie; jede Datei sagt, ob Eltern sie sehen), die Druckliste (samt Bildkarten), **„Inhalt und Hausaufgabe (für die Eltern)“**
  (Claude formuliert den Inhalt in 2–3 Sätzen, Sie können ihn ändern), die Karte **„Elternansicht“** und ganz unten **„Alle Unterlagen dieser
  Sitzung“** (ZIP-Ordner mit Verlaufsplan, Material für die Kinder und für Sie, Druckvorlagen unter ihrem Druck-Namen und Verweisen auf andere
  Sitzungen). Kein
  Schulportal-Eintrag, keine Präsentation, kein Sitzungscode.
* **„Ich bin jetzt im Unterricht“ (wie am Gymnasium, Nachtrag 35):** ganz oben in der Sitzung; kompakt mit dem **Verlaufsplan** – seit Nachtrag 42
  je Phase nur, was Sie tun (der „Kurzplan für die Lehrkraft“, den Claude beim Planen schreibt – die gelben PDF-Verweise Ihrer unterstrichenen
  Aufforderungen stehen darunter als „Material: …“; ohne ihn die unterstrichenen Aufforderungen samt gelben PDF-Verweisen bzw. der erste
  Stichpunkt), der vollständige Verlaufsplan aufklappbar (PDF-Verweise anklickbar, Zwischenstopp per
  „Zwischenstopp eintragen …“, Rechtsklick oder Antippen einer Phase bzw. Zeile) –, dem **Material** als Tabelle – links „Für die
  Kinder sichtbar“ (mit dem Hinweis, ob Eltern es sehen), rechts „Nur für die Lehrkraft“ samt allem, was Sie ausdrucken (Arbeitsblätter mit
  „Auch ausdrucken“, Konzentrationsaufgabe, Bildkarten – markiert **„zum Ausdrucken“**) – und der **Hausaufgabe** (dasselbe Feld). Ohne Präsentation
  und ohne Pfeil. „Vollständige Ansicht“ führt zurück.
* **Bildkarten:** Claude gestaltet sie beim Planen selbst (eine Karte je Seite, mit einem gekürzten Erzähltext je Karte zum
  Nacherzählen), oder Sie laden eine PDF hoch (eine Seite = eine Karte). Die Erzähltexte prüfen und ändern Sie unter jeder Karte.
  Hochgeladene Bildkarten sehen Eltern erst, wenn Sie „Eltern dürfen diese Bildkarten sehen“ ankreuzen – Bildkarten von Verlagen dürfen
  meist nicht online weitergegeben werden. Die Bilder für die Elternansicht erstellt Ihr Browser, sobald Sie Unterricks öffnen.
  **Erzählen Sie im Sitzkreis eine Geschichte, gestaltet Claude immer Bildkarten dazu** (das steht so im Prompt „Stunde mit Claude planen“
  und beim Überarbeiten einer Einheit; erzählt der Verlaufsplan eine Geschichte und fehlen Bildkarten, erinnert Unterricks Claude beim
  Lesen der Sitzung und beim Speichern des Verlaufsplans).
* **Bildkarten auf der Druckliste:** Neue Bildkarten – von Claude gestaltet oder von Ihnen hochgeladen – stehen von selbst auf Ihrer
  Druckliste „Von der Lehrkraft auszudrucken“ als **„1x - farbig - einseitig - <Kurs> - <Titel>.pdf“**, z. B. „1x - farbig - einseitig - Reli2 - Bildkarten Arche Noah.pdf“ (1 Exemplar, einseitig, farbig) und damit
  auch in den Druckaufträgen für den nächsten Arbeitstag und in der ZIP-Datei der Druckliste – immer die vollständige PDF mit allen Karten
  (A4 quer, eine Karte je Seite) in ihrer aktuellen Gestaltung. Anzahl, beidseitig/einseitig und Farbe ändern Sie dort wie bei jeder
  Druckvorlage; **„Nicht ausdrucken“** (in der Druckliste) bzw. der Schalter **„Auf der Druckliste …“** bei den Bildkarten nimmt sie
  herunter und wieder auf – die Bildkarten, ihre Erzähltexte und die Elternansicht bleiben dabei unverändert. Gestaltet Claude Bildkarten
  neu, bleibt Ihre Einstellung (auch „nicht auf der Liste“). Ist die PDF neu gestalteter Bildkarten noch nicht gedruckt (oder der Druck
  ist fehlgeschlagen), sagt die Zeile das und bietet „Erneut drucken“ an; die ZIP-Datei nennt sie unter dem Knopf, statt sie stillschweigend
  wegzulassen. Die ZIP-Datei und „Alle Dateien herunterladen“ holen vorher den aktuellen Stand – auch Bildkarten, die Claude angelegt
  oder neu gestaltet hat, während die Seite offen war, sind dabei (bzw. werden genannt); die alten Karten einer neu gestalteten PDF kommen
  nie in die Druckdateien. Hochgeladene Bildkarten in einem anderen Format (z. B. A5 vom Verlag) kommen in den Druckdateien auf A4
  (Quer- bzw. Hochformat bleibt); gespeichert bleibt Ihre PDF, wie sie war. Bildkarten, die vor dem 16.11.2026 angelegt wurden, stehen
  nicht auf der Liste – mit dem Schalter nehmen Sie sie bei Bedarf auf.
* **Wiederverwendete Bildkarten (seit dem 16.11.2026):** Verweist der Verlaufsplan einer Sitzung auf Bildkarten einer **anderen** Sitzung
  desselben Kurses (z. B. dieselben Karten zu Josef in der nächsten Stunde noch einmal), stehen sie **auch auf der Druckliste dieser
  Sitzung** – wie neue Bildkarten mit 1 Exemplar, einseitig, farbig, mit dem Kurs dieser Sitzung im Namen, in der ZIP-Datei, in den
  Druckaufträgen der Startseite und in „Ich bin jetzt im Unterricht“. In der Zeile steht, aus welcher Sitzung sie kommen. Anzahl, Farbe und
  einseitig/beidseitig ändern Sie hier nur für diese Sitzung; **„Nicht ausdrucken“** nimmt sie nur hier herunter, darunter steht dann
  **„Wieder ausdrucken“**. Die Druckliste der Sitzung, der die Bildkarten gehören, bleibt unverändert. Entfernen Sie den Verweis aus dem
  Verlaufsplan, verschwinden sie auch von dieser Druckliste. Das gilt für alle Bildkarten, auch ältere. Heruntergeladen (einzeln, als ZIP-Datei
  und in „Ich bin jetzt im Unterricht“) heißt die Datei immer nach den Druckangaben dieser Sitzung – auch bei Bildkarten, die Claude gestaltet
  hat. Stehen dieselben Bildkarten in zwei Sitzungen der Druckaufträge (z. B. heute in der Sitzung, der sie gehören, und morgen noch einmal),
  hat jede Sitzung dort ihre eigene Zeile mit ihrem eigenen Namen.
* **Konzentrationsaufgabe:** Zu jeder Sitzung, die Sie mit Claude planen („Stunde mit Claude planen“, auch wenn Claude beim Überarbeiten
  einer Einheit eine Sitzung neu plant), gestaltet Claude zusammen mit dem übrigen Material die **„Konzentrationsaufgabe“** – für Kinder, die
  ihre Aufmerksamkeit in Plenumsphasen nur bündeln können, wenn sie den Sitzkreis verlassen und beim Zuhören etwas ausmalen. Aufbau:
  höchstens **zwei A4-Seiten**; die erste Seite und die **obere Hälfte der zweiten** sind **Ausmalbilder** zum Inhalt der Stunde in ihrer
  Reihenfolge (z. B. Bilder zur Geschichte, die Sie erzählen). Die **untere Hälfte der zweiten Seite** hat einen **Lückentext**, eine
  **Ankreuzaufgabe** und ein **Suchsel** zum Inhalt der Stunde, im Schwierigkeitsgrad passend zum Jahrgang des Kurses (Jahrgang 1: zwei, drei
  kurze Sätze in Großbuchstaben mit Bildern im Wörterkasten, Suchsel 6 × 6 nur waagerecht; bis Jahrgang 4: fünf, sechs Sätze, ein Wort zu viel im
  Wörterkasten, Suchsel 9 × 9 waagerecht und senkrecht; die gesuchten Wörter stehen immer darunter). Brauchen die Aufgaben mehr als die halbe
  Seite (meist ab Jahrgang 2, damit man in die Lücken gut schreiben kann), wird das Ausmalbild oben auf der zweiten Seite kleiner. Daneben im Seitenrand das Symbol einer
  **roten Karte** mit dem Satz „Diese Aufgaben sind nur Pflicht, wenn du eine rote Karte bekommen hast.“ (seit dem 23.11.2026; schon fertige
  Konzentrationsaufgaben bleiben, wie sie sind, bis Claude sie überarbeitet). Claude stellt sie Ihnen mit dem übrigen Material vor; nach Ihrer Freigabe steht sie **nur** auf
  Ihrer Druckliste „Von der Lehrkraft auszudrucken“ als **„5x - sw - beidseitig - <Kurs> - Konzentrationsaufgabe – <Thema>.pdf“** (z. B. „5x - sw - beidseitig - Reli2 - Konzentrationsaufgabe – Schöpfung.pdf“) und damit auch in den
  Druckaufträgen für den nächsten Arbeitstag – nie in der Elternansicht und nie für die Kinder (als Bildkarten, die Eltern sehen, nimmt
  Unterricks sie gar nicht erst an). Anzahl und Druckart ändern Sie dort wie bei
  jeder Druckvorlage. Im Verlaufsplan nennt Claude sie in der ersten Plenumsphase (gelb markiert). Fehlt sie noch, erinnert Unterricks Claude
  beim Lesen der Sitzung und beim Speichern des Verlaufsplans; hat sie mehr als zwei Seiten, sagt Unterricks es Claude beim Ablegen.
* **Elternansicht:** **„Sitzungslink für Eltern kopieren“** legt einen geheimen, nicht erratbaren Link in die Zwischenablage (zum
  Weitergeben, z. B. per Elternbrief oder Messenger). Wer ihn hat, sieht diese Sitzung und alle vorherigen Sitzungen dieses Kurses im
  Schuljahr – jede erst, wenn sie laut Plan zu Ende ist (vorher „Diese Unterrichtssitzung hat noch nicht stattgefunden.“). Eltern sehen:
  den **„Hinweis der Lehrkraft“** (optional, ganz oben in einem roten Feld), die Bildkarten zum Durchklicken mit dem Erzähltext, den
  „Inhalt der Unterrichtsstunde“, die „Hausaufgabe“ (nur, wenn eine eingetragen ist), das „Material für die Schüler“ (nur PDFs der
  Kinder) und „Vorherige Unterrichtssitzungen dieses Schuljahres ansehen“. Bei einem Zwischenstopp nur das Material bis dorthin. Nie
  Ideen, Verlaufsplan, Zusammenfassung für die Lehrkraft, Code oder Material nur für Sie. **„Elternansicht ausprobieren“** zeigt Ihnen die Ansicht schon vorher. Ist ein
  Link in falsche Hände geraten: „Link erneuern“ – der bisherige funktioniert dann nicht mehr. Bitte in Hinweisen und Texten für Eltern
  keine Namen von Kindern nennen.
* **Krankheit:** Karte „Krankheit“ → **„Krankmeldung: Diese Stunde fällt aus“**. Eine Vorschau zeigt, wohin die Stunden rücken: Diese
  und alle folgenden Stunden der Einheit wandern um je einen Termin nach hinten (mit Verlaufsplan und Material; unterrichtsfreie Tage der
  Grundschule aus den Einstellungen überspringen sie); die letzte Stunde, die
  hinter das Ende der Einheit rutscht, bleibt ohne Datum in der Einheit stehen. Eltern sehen für den ausgefallenen Termin, dass der
  Unterricht leider nicht stattfinden konnte (der bisherige Elternlink gilt für diesen Termin weiter). In der Einheit und in jeder ihrer
  Sitzungen steht dann ein **roter Kasten** „Die Einheit muss wegen der Ausfälle überarbeitet werden“ mit **„Einheit mit Claude
  überarbeiten“** (kopiert den passenden Prompt; Claude passt die Einheit mit `save_unit_plan` an und verteilt die Termine neu),
  „Erledigt – Hinweis entfernen“ und – solange die Einheit seither nicht geändert wurde – „Krankmeldung rückgängig machen“.
  Eine Selbstlern-Phase (früher Vertretungsmaterial) gibt es in der Grundschule nicht.

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
Bildschirmfoto in `test-results/mobil/` ab. Danach bedient er Dialoge nur mit der Tastatur: Tab und Umschalt+Tab bleiben im obersten
offenen Dialog (nie auf der Seite dahinter), Esc schließt bei zwei Dialogen übereinander nur den oberen, der Fokus geht an den Auslöser
zurück – auch wenn die Seite ihn inzwischen neu gezeichnet oder gelöscht hat, in Codefolie, Präsentationsmodus und Escape-Room; am Handy
verdeckt eine Meldung den fokussierten Knopf im Dialog nicht; mit `DIALOG_SHOTS=1` legt er Bildschirmfotos mit sichtbarem Fokusrahmen
in `test-results/dialoge/` ab.

`npm run build` legt jeden Stand in einen eigenen Ordner `/v/<Stand>/` (Stand = Prüfsumme über `public/` und die Bibliotheken, für Worker
und GitHub Pages gleich); `index.html` lädt `app.js` dieses Stands, die Startdatei `/boot.js` springt nur ein, wenn es den Stand nicht mehr
gibt (veraltetes `index.html`), und erfragt ihn dann über `/version.json`. So mischt ein offener Tab nach einem Deploy nie alte und neue
Programmteile (Fehler vom 14.11.2026, Einzelheiten in `docs/ARCHITEKTUR.md`, 4t).
`public/` bleibt unversioniert. Der End-to-End-Test spielt das mit zwei Ständen nach (Schritt „Nach einem Update“, auch mit einem
eigenen `wrangler dev` auf Port 8795 – vor einem Lauf frei halten); mit `UPDATE_SHOTS=1` legt er Bildschirmfotos der Hinweise in
`test-results/update/` ab.

Die Grenzen der Speicheranzeige (Fußzeile der Lehrkraft) lassen sich als Variablen des Workers setzen: `STORAGE_LIMIT_BYTES` (Dateien in R2,
Vorgabe 9 GB – darüber lehnt der Worker Uploads ab) und `DB_LIMIT_BYTES` (Datenbank, Vorgabe 500 MB des kostenlosen D1-Plans; nur für die Anzeige).
