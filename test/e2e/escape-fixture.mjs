// escape-fixture.mjs – frei erfundener Escape-Room für Tests (E2E: Durchlauf aller Stationen; Unit: save_selbstlern mit Escape-Room-Station)
// Escape-Room wie ihn Claude liefert (alle sieben Rätseltypen)
export function escapeFixture() {
  const sec = (k) => ({ ueberschrift: "Thema " + k, text: "Sachtext zum Thema " + k + ". Die Gewaltenteilung verteilt Macht auf Legislative, Exekutive und Judikative." });
  const station = (i, teile) => ({ titel: "Station" + i + " Prüfung", ort: "Saal " + i, bibliothek: { einleitung: "Lies genau.", abschnitte: [sec(1), sec(2), sec(3)] },
    raetsel: { auftrag: "Löse das Rätsel " + i + ".", teile, erfolg: "Raum " + i + " ist geschafft." }, erlaeuterung: "Erläuterung zu Station " + i + ": Die Lösung ergibt sich aus Abschnitt 1." });
  return { name: "Mission Gewaltenteilung", titel: "Mission Gewaltenteilung", untertitel: "Rette die Verfassung von Karlsruhe.", loesungswort: "GERICH",
    rahmen: { sprecher: "Präsidentin des Gerichts", auftrag: "Das Archiv wurde durcheinandergebracht. Hilf uns!", rolle: "Du bist die neue Archivarin." },
    stationen: [
      station(1, [{ typ: "einfachwahl", frage: "Wer beschließt Gesetze?", optionen: [{ text: "Der Bundestag", richtig: true }, { text: "Das Bundesverfassungsgericht" }, { text: "Die Bundesregierung" }], abschnitt: 1, anfang: "Der Bu", loesung: "Der Bundestag" },
        { typ: "koerbe", frage: "Sortiere die Organe.", koerbe: [{ name: "Legislative", anfang: "Leg" }, { name: "Judikative", anfang: "Jud" }], karten: [{ text: "Bundestag", korb: 1, abschnitt: 1 }, { text: "Bundesrat", korb: 1 }, { text: "Amtsgericht", korb: 2 }, { text: "Verfassungsgericht", korb: 2 }] }]),
      station(2, [{ typ: "zuordnung", frage: "Ordne zu.", optionen: ["prüft Gesetze", "beschließt Gesetze", "führt Gesetze aus"], zeilen: [{ text: "Das BVerfG", antwort: "prüft Gesetze", abschnitt: 2 }, { text: "Der Bundestag", antwort: "beschließt Gesetze" }, { text: "Die Verwaltung", antwort: "führt Gesetze aus" }] },
        { typ: "mehrfachwahl", frage: "Welche Aussagen stimmen?", optionen: [{ text: "Gerichte sind unabhängig.", richtig: true }, { text: "Richter sind weisungsgebunden.", erklaerung: "Nein, sie sind unabhängig." }, { text: "Gesetze binden die Verwaltung.", richtig: true }], abschnitt: 2 }]),
      station(3, [{ typ: "luecken", frage: "Ergänze.", text: "Die [[1]] ist die gesetzgebende Gewalt, die [[2]] die rechtsprechende.", luecken: [{ nr: 1, loesungen: ["Legislative"], abschnitt: 1 }, { nr: 2, loesungen: ["Judikative", "Rechtsprechung"], abschnitt: 1 }] },
        { typ: "zahl", frage: "Wie viele Richter:innen hat das BVerfG?", einheit: "Richter:innen", min: 16, max: 16, woerter: ["sechzehn"], abschnitt: 3, hinweis: "Zwei Senate zu je acht.", loesung: "16" }]),
      station(4, [{ typ: "luecken", frage: "Wähle aus.", text: "Das Grundgesetz trat [[1]] in Kraft.", luecken: [{ nr: 1, loesungen: ["1949"], abschnitt: 2 }], wortbank: ["1949", "1919", "1990"] },
        { typ: "einfachwahl", frage: "Wo sitzt das BVerfG?", optionen: [{ text: "Karlsruhe", richtig: true }, { text: "Berlin" }], abschnitt: 3, anfang: "Ka" }]),
      station(5, [{ typ: "koerbe", frage: "Verfahren oder Organ?", koerbe: [{ name: "Verfahren" }, { name: "Organ" }], karten: [{ text: "Normenkontrolle", korb: 1 }, { text: "Verfassungsbeschwerde", korb: 1 }, { text: "Bundesrat", korb: 2 }, { text: "Bundespräsident", korb: 2 }] },
        { typ: "zuordnung", frage: "Wer klagt?", optionen: ["Bürger:in", "Landesregierung"], zeilen: [{ text: "Verfassungsbeschwerde", antwort: "Bürger:in" }, { text: "Abstrakte Normenkontrolle", antwort: "Landesregierung" }] }]),
      station(6, [{ typ: "mehrfachwahl", frage: "Was schützt die Demokratie?", optionen: [{ text: "Gewaltenteilung", richtig: true }, { text: "Machtkonzentration" }, { text: "Grundrechte", richtig: true }] },
        { typ: "schlussstein", frage: "Wie lautet das Lösungswort?", loesungen: ["GERICH", "Gericht"], hinweis1: "Sieh dir die Buchstaben an.", hinweis2: "Es beginnt mit G.", loesung: "GERICH" }]),
    ],
    finale: { ueberschrift: "Das Archiv ist gerettet", text: "Du hast alle Räume gelöst.", warum: "GERICH steht für das Gericht, das die Verfassung hütet.", rueckblick: ["Gewaltenteilung", "Organe", "Verfahren", "Grundgesetz", "Karlsruhe", "Schutz"], schluss: "Weiter zum Finale!" },
    feibeitsblatt: { titel: "Finale: Mission Gewaltenteilung", aufgaben: [{ text: "Beurteile, ob das BVerfG zu mächtig ist.", ki_auftrag: "Pro/Contra, eigenes Urteil" }] } };
}
