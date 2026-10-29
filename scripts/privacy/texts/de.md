name: Deutsch
title: Datenschutzerklärung
description: Wie viagem mit deinen Daten umgeht: was auf deinem Gerät bleibt, was über den Raumserver läuft, Cookies und Anzeigen von Google und deine Rechte nach LGPD und DSGVO.
updated: Aktualisiert am 28. Oktober 2026
back: ← Zurück zum Spiel
note: Unverbindliche Übersetzung; bei Abweichungen gilt die portugiesische Fassung.
---
## Wer wir sind
**viagem** ist ein kostenloses kooperatives Spiel, das im Browser läuft, unter {site}, entwickelt von einem unabhängigen Entwickler. Diese Seite erklärt, welche Daten das Spiel verwendet, warum und was du tun kannst, gemäß dem brasilianischen Datenschutzgesetz (LGPD, Gesetz 13.709/2018) und, für Spieler in Europa, der Datenschutz-Grundverordnung (DSGVO).

## Was wir nicht abfragen
Das Spiel hat keine Registrierung. Wir fragen weder E-Mail-Adresse, Passwort, Telefonnummer, Ausweis noch Zahlungsdaten ab, und wir verkaufen keine Daten von niemandem.

## Was auf deinem Gerät bleibt
Um sich an deine Auswahl zu erinnern, speichert das Spiel im lokalen Speicher des Browsers (`localStorage`), unter Schlüsseln, die mit `viagem:` beginnen:
- die Figur, die Farbe und den Abenteuernamen, die du gewählt hast;
- die Einstellungen für Ton, Musik und Vibration, den Kamerazoom, den Sparmodus und die Anzahl der Bots im Solospiel;
- die Tipps, die du schon gesehen hast, und ob du zustimmst, in den „peinlichen Momenten“ der Partie zu erscheinen;
- falls du aus einem Raum entfernt wurdest, einen vorübergehenden Hinweis, der dich bis zum Ablauf der Frist daran hindert, dorthin zurückzukehren.
Solange der Tab geöffnet ist, nutzt das Spiel außerdem `sessionStorage` (wird beim Schließen des Tabs gelöscht), um deinen Platz im Raum zu halten, wenn die Verbindung abbricht oder die Seite bei einem Update neu lädt.
Diese Daten bleiben auf deinem Gerät und werden nicht an uns gesendet. Du kannst sie jederzeit löschen, indem du die Websitedaten in den Browsereinstellungen löschst. Das Spiel speichert außerdem Bilder und Töne im Cache (Service Worker), damit es schneller lädt; dieser Cache enthält keine Daten über dich.

## Was über den Raumserver läuft
Wenn du einer Partie beitrittst, gehen dein Abenteuername, deine Figur und deine Aktionen im Spiel an den Raumserver (gehostet bei Cloudflare) und sind für die anderen Spieler im selben Raum sichtbar. Nur solange der Raum besteht, speichert der Server Namen und Figur jedes Spielers, einen verschlüsselten Zugangscode (damit du an deinen Platz zurückkehren kannst) und den Spielstand. Jeder Raum wird spätestens etwa 50 Minuten nach seiner Erstellung vollständig gelöscht; wir speichern weder einen Verlauf deiner Partien noch Konten.
Um Missbrauch zu verhindern, wird die IP-Adresse nur im Moment verwendet, um zu begrenzen, wie viele Räume pro Minute erstellt werden können; das Spiel speichert sie nicht. Die technischen Verbindungsprotokolle des Servers (wann eine Verbindung auf- und abgebaut wird, Latenz, Datenmenge) enthalten weder Namen noch IP.

## Hosting und technische Protokolle
Die Website wird bei GitHub Pages gehostet und der Raumserver bei Cloudflare. Wie bei jeder Website erhalten diese Dienste technische Verbindungsdaten (IP-Adresse, Browser, Datum und Uhrzeit), um die Seiten auszuliefern und sich vor Missbrauch zu schützen, gemäß den Datenschutzrichtlinien von [GitHub](github) und [Cloudflare](cloudflare).

## Cookies und Anzeigen von Google
Das Spiel finanziert sich durch Anzeigen von **Google AdSense** (H5 Games Ads), die nur zwischen den Partien erscheinen, nie während des Spiels. Dafür gilt:
- Google und seine Partner verwenden Cookies und ähnliche Kennungen, um Anzeigen auszuliefern, zu begrenzen, wie oft du dieselbe Anzeige siehst, Ergebnisse zu messen und Betrug zu verhindern.
- Google kann personalisierte Anzeigen auf Grundlage deiner Besuche auf dieser und anderen Websites zeigen. Siehe [wie Google Informationen von Websites verwendet, die seine Dienste nutzen](partners).
- Du kannst personalisierte Anzeigen in den [Google-Anzeigeneinstellungen](adsettings) deaktivieren, die anderer Unternehmen unter [aboutads.info](aboutads). Anzeigen erscheinen weiterhin, aber ohne Personalisierung.
- Wer aus der Europäischen Union, dem Europäischen Wirtschaftsraum, dem Vereinigten Königreich oder der Schweiz zugreift, sieht vor jedem Werbe-Cookie eine Einwilligungsmitteilung von Google (einer zertifizierten Plattform zur Verwaltung von Einwilligungen). Um deine Wahl später zu ändern, nutze den Link zu Datenschutz und Cookies, den diese Mitteilung auf der Seite hinterlässt, oder lösche die Cookies der Website im Browser, um die Mitteilung erneut zu sehen.
Wir blockieren Anzeigen für Glücksspiel, Casinos und andere sensible Kategorien. Wenn du einen Werbeblocker nutzt, funktioniert das Spiel ganz normal.

## Warum wir diese Daten verwenden
Wir verwenden die Spieldaten, damit die Partie funktioniert (Erbringung des Dienstes, den du angefordert hast). Die Anzeigen stützen sich auf das berechtigte Interesse, das Spiel kostenlos zu halten, und, wo das Gesetz es verlangt (wie in Europa nach der DSGVO und bei Cookies für personalisierte Anzeigen), auf deine Einwilligung, die du jederzeit widerrufen kannst.

## Kinder und Jugendliche
Das Spiel ist ein Zeichentrickspiel und fragt keine personenbezogenen Daten ab. Es richtet sich nicht an Kinder unter 13 Jahren, und wir erheben nicht wissentlich Daten von Kindern; wenn ein Elternteil oder Erziehungsberechtigter glaubt, dass ein Kind uns Daten geschickt hat, melde dich bei uns und wir löschen sie. Wir blockieren ungeeignete Anzeigenkategorien.

## Deine Rechte
Nach der LGPD (und in Europa nach der DSGVO) kannst du die Bestätigung verlangen, dass wir deine Daten verarbeiten, sowie Auskunft, Berichtigung, Anonymisierung oder Löschung, Datenübertragbarkeit, Informationen darüber, mit wem wir sie teilen, Widerspruch und den Widerruf der Einwilligung. Da fast alles auf deinem eigenen Gerät bleibt, reicht es meist, die Websitedaten im Browser zu löschen; die Daten eines Raums verschwinden von selbst, wenn er gelöscht wird. Für jede andere Anfrage, auch zur Löschung, nutze den Kontakt unten. Du kannst dich auch bei der brasilianischen Nationalen Datenschutzbehörde ([ANPD](anpd)) oder bei der Datenschutzbehörde deines Landes beschweren.

## Kontakt
Fragen oder Anliegen zum Datenschutz: schreib an {email} oder eröffne eine Unterhaltung unter {issues}.

## Änderungen
Wenn sich diese Erklärung ändert, ändert sich auch das Datum oben auf der Seite.
