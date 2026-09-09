Übersetzen Sie das Web mit den Anbietern Ihrer Wahl

LinguaLens ist eine Browser-Übersetzungserweiterung, die auf Flexibilität ausgelegt ist. Anders als Tools, die an einen einzelnen Cloud-Anbieter gebunden sind, lässt LinguaLens Sie entscheiden, wo jede Übersetzung ausgeführt wird: auf Ihrem eigenen Rechner mit lokalen LLMs, über große Cloud-APIs, über ein OpenAI-kompatibles Gateway oder über eine anpassbare HTTP-API-Vorlage. Legen Sie einen Standardanbieter fest, fügen Sie eine optionale Fallback-Kette hinzu, und die Übersetzung läuft weiter, selbst wenn Ihr primärer Dienst nicht verfügbar ist.

WARUM LINGUALENS

• Bringen Sie Ihr eigenes Backend mit — Keine Bindung an einen Übersetzungsdienst.
• Local-First-Option — Nutzen Sie Ollama oder LM Studio, damit sensible Texte auf Ihrem Rechner bleiben.
• Cloud, wenn nötig — OpenAI, DeepSeek, DeepL, Google Cloud Translation und mehr.
• OpenAI-kompatible Endpunkte — Funktioniert mit jedem Gateway oder Proxy, der /v1/chat/completions bereitstellt.
• Benutzerdefinierte HTTP-API — Konfigurieren Sie Methode, Header, JSON-Body-Vorlage und Antwortpfad für proprietäre Systeme.
• Robuster Workflow — Geordnete Fallback-Anbieter, falls der Standard mitten in der Sitzung ausfällt.
• Ehrliches Datenschutzmodell — LinguaLens betreibt keine eigenen Übersetzungsserver; Sie entscheiden, wer Ihren Text erhält.
• Mehrsprachige Oberfläche — 9 UI-Sprachen: English, 中文 (vereinfacht/traditionell), 日本語, 한국어, Français, Deutsch, Español, Русский.

ÜBERSETZUNGSANBIETER

Lokal
• Ollama (Standardvoreinstellung) — http://localhost:11434
• LM Studio — Verwendet die native lokale API von LM Studio

Cloud-Voreinstellungen
• OpenAI — api.openai.com
• DeepSeek — api.deepseek.com
• DeepL — Kostenloser oder Pro-API-Endpunkt
• Google Cloud Translation — translation.googleapis.com

Erweitert
• OpenAI-kompatibel — Beliebige benutzerdefinierte Basis-URL mit /v1/chat/completions
• Benutzerdefinierte API — Vollständig konfigurierbare HTTP-Anfragevorlage

Überprüfen Sie die Konnektivität jedes Anbieters in den Einstellungen vor dem Speichern. API-Schlüssel (falls erforderlich) werden lokal im Browserspeicher abgelegt.

FUNKTIONEN

Auswahlübersetzung
Wählen Sie Text auf einer beliebigen Webseite aus — einschließlich im Browser geöffneter PDF-Dokumente. Wählen Sie aus vier Auslösemodi: ein schwebendes Symbol neben Ihrer Auswahl (Standard), Sofortübersetzung bei Auswahl, Modifikatortaste gedrückt halten zum Auslösen oder Auslöser deaktivieren. Öffnen Sie das Panel, um Ergebnisse anzuzeigen, bei Fehlern zu wiederholen, die Übersetzung zu kopieren oder zu schließen. Heften Sie das Panel an, um es über mehrere Auswahlen hinweg geöffnet zu halten. Auch über das Kontextmenü verfügbar, oder drücken Sie Alt+T, um die aktuelle Auswahl in einem Schritt zu übersetzen. Wechseln Sie den aktiven Übersetzungsanbieter oder die Zielsprache — mit sofortiger Neuübersetzung — über die Panel-Kopfzeile. Auf Seiten, auf denen Content-Scripts nicht ausgeführt werden können (browserinterne Seiten, Erweiterungsstores), leitet Rechtsklick auf Übersetzen die Auswahl an das Seitenpanel weiter, das sich automatisch öffnet.

Zweisprachige Ganzseitenübersetzung
Verwandeln Sie Artikel, Dokumente und lange Seiten in zweisprachige oder ersetzende Leseansicht, ohne die Seite zu verlassen. Wechseln Sie jederzeit über die Statusleiste zwischen den Modi. Starten Sie über das Popup („Diese Seite übersetzen"), das Seiten-Kontextmenü oder Alt+Shift+T. Eine Statusleiste zeigt den Fortschritt und ermöglicht das Anhalten der Übersetzung, das Wiederherstellen des Originaltexts oder das Wechseln des Anzeigemodus.

Seitenübersetzungsmodi
• Qualität — Größere Abschnitte, besserer Kontext für LLM-Übersetzung
• Geschwindigkeit — Kleinere Abschnitte, schnellere progressive Aktualisierungen

Popup-Übersetzer
Klicken Sie auf das Symbol in der Symbolleiste, um Text einzufügen oder einzugeben, eine Zielsprache auszuwählen und sofort zu übersetzen. Springen Sie zu den Einstellungen oder starten Sie die Ganzseitenübersetzung im aktiven Tab.

Seitenleiste (Chrome 114+)
Öffnen Sie einen eigenen Übersetzungsarbeitsbereich aus dem Popup. Legen Sie Quell- und Zielsprache fest, tauschen Sie Sprachen, zeigen Sie Ergebnisse an und durchsuchen Sie den lokal auf Ihrem Gerät gespeicherten Übersetzungsverlauf.

Einstellungen & Einführung
Bei der ersten Installation öffnen sich die Einstellungen automatisch mit einer kurzen Einrichtungsanleitung. Konfigurieren Sie Sprachen, Standardanbieter, Fallback-Reihenfolge, LLM-Prompt-Vorlagen (Basis und zusätzlich) und anbieterspezifische Optionen wie das Deaktivieren der „Thinking"-Ausgabe bei unterstützten Modellen für schnellere, sauberere Übersetzungen.

Leistung
Der integrierte Übersetzungscache reduziert wiederholte API-Aufrufe für identischen Text während des Surfens.

TASTATURKÜRZEL

Alt+T — Auswahl übersetzen
Alt+Shift+T — Ganze Seite übersetzen
Alt+M — Auswahl-Auslösemodus wechseln (Symbol → Sofort → Modifikatortaste → Aus)

Wenn Tastenkürzel mit anderen Erweiterungen kollidieren, weisen Sie die LinguaLens-Kürzel unter chrome://extensions/shortcuts neu zu.

ERSTE SCHRITTE

1. Installieren Sie LinguaLens. Die Einstellungen öffnen sich beim ersten Start.
2. Scrollen Sie zu Übersetzungsanbieter. Aktivieren Sie mindestens ein Backend.
3. Legen Sie Basis-URL, Modell und API-Schlüssel fest, falls erforderlich. Klicken Sie auf Überprüfen, dann auf Einstellungen speichern.
4. Öffnen Sie eine normale https-Seite und testen Sie die Auswahl- oder Ganzseitenübersetzung.

Ollama-Tipp: Führen Sie `ollama pull llama3` aus und starten Sie Ollama mit OLLAMA_ORIGINS="chrome-extension://*", falls der Browser keine Verbindung herstellen kann.

DATENSCHUTZ

LinguaLens betreibt keine eigenen Übersetzungsserver. Der von Ihnen übersetzte Text wird nur an die von Ihnen aktivierten Anbieter gesendet. Einstellungen und API-Schlüssel verbleiben auf Ihrem Gerät. Siehe die URL der Datenschutzerklärung in diesem Eintrag. Überprüfen Sie die Richtlinien von Drittanbietern für jede von Ihnen genutzte Cloud-API.

EINSCHRÄNKUNGEN

• Die Ganzseitenübersetzung funktioniert nicht auf eingeschränkten Seiten (chrome://, browserinterne Seiten usw.); die Auswahlübersetzung wird dort an das Seitenpanel weitergeleitet (Chromium 114+)
• Erfordert mindestens einen konfigurierten, funktionierenden Anbieter zum Übersetzen
• Die Seitenleiste erfordert Chromium 114+
• Sehr lange Seiten können Zeit und mehrere API-Aufrufe in Anspruch nehmen

SUPPORT

Probleme & Feedback: https://github.com/q-jade/lingualens/issues
Projektseite: https://github.com/q-jade/lingualens

Lesen Sie ausländische Nachrichten, technische Dokumentation, Forschung und Foren mit dem Übersetzungsworkflow, den Sie steuern.
