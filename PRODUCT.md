# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Lehrkraft (primär):** eine Gymnasiallehrkraft in Hessen mit den Fächern Politik und Wirtschaft, Evangelische Religion und Ethik.
  Sie plant am Laptop/PC Unterrichtseinheiten und einzelne Sitzungen, präsentiert im Klassenraum über den Beamer, verteilt
  Material und Feibeitsblätter und sieht Abgaben ein. Später sollen auch Kolleg:innen derselben Schule die Plattform nutzen
  (weiterhin privat betrieben).
- **Schüler:innen ab Jahrgang 7:** arbeiten mit iPads im Unterricht und zu Hause: Passwort, Fach und Klasse wählen,
  Sitzungscode eingeben, Live-Präsentation verfolgen, Material herunterladen (z. B. für GoodNotes), Hausaufgabe sehen,
  Feibeitsblatt öffnen, Escape-Room bei einer Vertretungsstunde spielen. In den Jahrgängen 5 und 6 gibt es keine iPads –
  dort nur ausdruckbares Material.

## Product Purpose

Unterricks bündelt die Unterrichtsplanung und den Unterricht selbst an einem Ort: Einheiten nach dem Leupold-Schema mit
Stundenfragen und Terminen, Sitzungen mit Schulportal-Eintrag, Material, Hausaufgabe, Präsentation und Feibeitsblatt, dazu
die Krankheitsvertretung. Gelungen ist es, wenn die Lehrkraft eine Stunde schnell und fundiert plant, im Unterricht nichts
suchen muss und die Schüler:innen ohne Erklärung finden, was sie gerade brauchen.

## Positioning

Claude (das Pro-Abo der Lehrkraft in claude.ai) plant über einen Connector direkt in der Plattform mit: Es liest Sitzung,
Einheit und Planungsgrundlagen (Schulcurriculum, KCGO, Abiturerlass) und speichert auf Wunsch Schulportal-Eintrag,
Hausaufgabe, Material und Feibeitsblatt-Entwürfe. Kostenlose Modelle (Groq, danach Cloudflare Workers AI) sind nur Backup.
Die Präsentation läuft live und synchron auf den iPads; eine Vertretungsstunde entsteht auf Knopfdruck, auf Wunsch als
Escape-Room mit Feibeitsblatt-Finale.

## Operating Context

- Lehrkraft: Laptop/PC zu Hause und in der Schule; claude.ai mit Connector „Unterricks“; Schulportal Hessen („Mein
  Unterricht“, Einträge per Kopieren); Feibeitsblatt als eigenes Werkzeug; Beamer im hellen Klassenraum (Sitzungscode,
  Präsentation, Escape-Room-Hinweise müssen aus der letzten Reihe lesbar sein).
- Schüler:innen: iPads im Hoch- und Querformat, Bedienung mit dem Finger, Schul-WLAN (alle hinter einer IP).
- Planung folgt dem Schuljahr: Stundenplan, Ferien, Klausurtermine, Kurshalbjahre Q1–Q4 mit Grund- und Leistungskurs.

## Capabilities and Constraints

- Web-App ohne Framework: ES-Module in `public/*.js`, eine `public/styles.css`, Auslieferung als Cloudflare Workers Static
  Assets; Free-Plan (10 ms CPU je Anfrage), Daten in der EU (D1, R2).
- Keine externen Schriften, Skripte oder Dienste zur Laufzeit (CSP `default-src 'self'`, `font-src 'self'`); eigene
  Schriftdateien im Projekt sind möglich.
- Oberfläche deutsch: Lehrkräfte werden gesiezt, Schüler:innen geduzt; echte Umlaute und „…“.
- Hell- und Dunkelmodus nach Geräteeinstellung.
- Die End-to-End-Tests sprechen Knöpfe und Überschriften über ihre Texte und Rollen an; Funktionen und Wortlaut bleiben bei
  einer Neugestaltung erhalten.

## Brand Commitments

- Der Name „Unterricks“ bleibt; das Logo darf neu gestaltet werden.
- Privates, nicht kommerzielles Angebot: kein Schulname, kein Schullogo, keine Schulfarben.

## Evidence on Hand

Keine Referenzen, Zitate oder Nutzerzahlen – nichts davon darf erfunden werden. Bildschirmfotos aller Ansichten entstehen im
End-to-End-Test unter `test-results/`.

## Product Principles

1. Der Hauptweg führt über Claude; die Oberfläche zeigt ihn zuerst, das Backup bleibt erreichbar, drängt sich aber nicht vor.
2. Im Klassenraum zählt Lesbarkeit aus der letzten Reihe.
3. Schüler:innen bekommen immer einen eindeutigen nächsten Schritt statt einer Fläche zum Suchen.
4. Nichts wirkt ungefragt: Vorschläge von KI oder Vertretung prüft und bestätigt die Lehrkraft.
5. Datensparsam und schnell: nichts von außen laden.

## Accessibility & Inclusion

Ausdrücklich gefordert: Lesbarkeit am Beamer in hellen Räumen, Bedienung per Finger auf dem iPad und eine einfache,
eindeutige Führung für jüngere Schüler:innen (ab Jahrgang 7). Darüber hinaus keine gesonderte Anforderung festgelegt;
technischer Mindeststandard des Projekts ist WCAG 2.2 AA (Kontraste, sichtbarer Fokus, Tastatur, Beschriftungen).
