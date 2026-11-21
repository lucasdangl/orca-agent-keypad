# Agent Keypad for Orca: Installation auf dem MX Creative Keypad

Jede Taste des Logi MX Creative Keypad zeigt einen Orca-Agent: einen Agent-Chat oder ein Terminal-Pane. Die Farbe zeigt den Zustand:

| Farbe | Bedeutung |
|---|---|
| Blau | Der Agent arbeitet. |
| Gelb | Der Agent wartet auf dich, mit einer Rückfrage oder einer Freigabe. |
| Orange | Der Agent hat seinen Turn mit einer Frage beendet. |
| Grün | Der Agent ist fertig. |

Ein Tap holt genau diesen Chat oder dieses Pane in Orca nach vorn.

Das System hat zwei Teile, und beide sind nötig:

| Teil | Wo | Aufgabe |
|---|---|---|
| **Orca Agent Keypad** (`OrcaKeypad.lplug4`) | Logi Options+ | Zeichnet die Tasten, startet den Daemon (Node), fokussiert in Orca |
| **Agent Keypad for Orca** (Plugin A) | Orca | Schickt Statuswechsel sofort, zeigt das Panel zum Belegen der Tasten |

## Voraussetzungen

- **macOS** mit **Logi Options+** und dem Logi Plugin Service **6.4 oder neuer**. Getestet ist 6.4.2.
- **MX Creative Keypad**, per USB oder Bluetooth verbunden.
- **Orca 1.4.248 oder neuer.**
- **Node.js 22.6 oder neuer.** Der Plugin Service startet Plugins mit einem minimalen `PATH`. Das Plugin sucht Node deshalb selbst, in dieser Reihenfolge:
  1. Plugin-Einstellung `nodePath` und Umgebungsvariable `ORCA_KEYPAD_NODE`. Beides ist für die Entwicklung gedacht, Options+ hat dafür keine Oberfläche.
  2. `/opt/homebrew/bin/node` und `/usr/local/bin/node`. Das ist der einfachste Weg: `brew install node`.
  3. Volta
  4. nvm, die neueste Version zuerst
  5. `command -v node` in deiner Login-Shell
  6. das Node, das Logi mitliefert

## 1. Orca-Plugin installieren

In Orca unter **Settings → Plugins → Install from Git** diese Adresse eintragen:

```
https://github.com/lucasdangl/orca-agent-keypad
```

Oder diesen Link öffnen:

```sh
open 'orca://plugins/lucasdangl.agent-keypad?catalog=https://github.com/lucasdangl/orca-agent-keypad.git'
```

Orca fragt nach einer Freigabe. Das Plugin läuft als eigener Node-Prozess, liest den Agent-Status und darf Workspaces öffnen und Panes fokussieren. Danach erscheint unten in der Statusleiste **Agent Keypad**.

Für die Entwicklung lädst du es direkt aus dem Repo:

```sh
orca plugin dev load orca-plugin    # liefert einen Fingerprint, dann:
orca plugin dev load orca-plugin --approve <fingerprint>
```

## 2. Logi-Plugin installieren

Das Paket `OrcaKeypad-<version>.lplug4` kommt aus dem Release oder aus `make package-logi`. Installieren:

```sh
LogiPluginTool install OrcaKeypad-0.4.0.lplug4
```

`LogiPluginTool` bekommst du mit `dotnet tool install --global LogiPluginTool`, es liegt dann in `~/.dotnet/tools`. Getestet ist die Installation mit dem Tool. Ein Doppelklick auf die `.lplug4`-Datei ist nicht getestet.

Wenn das Plugin läuft, steht in `~/Library/Application Support/Logi/LogiPluginService/PluginData/OrcaKeypad/daemon.log` die Zeile `daemon ready`. Eine Zeile `A connected` zeigt, dass Plugin A verbunden ist.

## 3. Tasten in Options+ anlegen

In Options+ das Keypad öffnen. Unter **Orca Agent Keypad** gibt es:

- **Orca Panes → Slot 1 … Slot 9**: Pane-Tasten. Die Nummer ist die Taste, die du im Orca-Panel belegst.
- **Orca Status**: Verbindung zu Orca und Setup-Prüfung. Grün mit „OK“, wenn alles läuft. Drücken liest Orca sofort neu ein.
- **Orca Attention**: Wie viele Agents auf dich warten. Die Taste **blinkt**, solange einer wartet. Drücken springt zum Agent, der am längsten wartet, jeder weitere Druck zum nächsten.
- **Orca Working**: Wie viele Agents gerade arbeiten. Drücken springt zu dem, der am längsten arbeitet, jeder weitere Druck zum nächsten.
- **Orca Done**: Wie viele Agents fertig sind, deren Ergebnis du noch nicht angesehen hast. Drücken öffnet den, der zuerst fertig war, und zählt ihn als gelesen. Als gelesen zählt ein Agent auch, wenn du seinen Chat in Orca selbst öffnest. Was schon fertig war, als das Plugin gestartet ist, zählt nicht mit.

Attention, Working und Done zählen **alle** Agents in Orca, auch Chats, die auf keiner Pane-Taste liegen. Wer nicht jeden Chat einzeln auf eine Taste legen will, kommt mit diesen Tasten aus.

Options+ schaltet das Keypad-Profil um, wenn Orca vorn ist. Leg die Tasten deshalb ins Profil **Orca** und ins **Standardprofil**, sonst verschwinden sie, sobald eine andere App vorn ist.

## 4. Tasten belegen

Pane-Tasten füllen sich von selbst: Jede freie Taste bekommt einen Agent-Chat, der noch auf keiner Taste liegt, und behält ihn, solange es ihn gibt. Terminals kommen nur auf eine Taste, wenn du sie von Hand belegst. Neue Chats rücken in freie Tasten nach. Wird ein Chat geschlossen, wird seine Taste nach kurzer Zeit frei. Eine Taste, die du im Panel mit **Unmap** leerst, bleibt dauerhaft leer.

**Antwort-Modus:** Steht in Orca ein Chat vorne, der eine Frage stellt oder eine Freigabe will, werden die Pane-Tasten zu Antworttasten. Ein Druck schickt Tastendrücke an Orca:

| | | |
|---|---|---|
| Esc | Other 🎤 | ↑ |
| 1 | 2 | ↓ |
| 3 | 4 | Send |

- **1–4** wählen eine Option, bei Mehrfachauswahl kreuzen sie an. Die Tasten zeigen den Text der Option. Optionen, die die Frage nicht hat, sind dunkel.
- **Send** schickt die Auswahl ab: ↑ ins Freitextfeld, dann Enter. Nach „Other“ schickt Send den Text ab.
- **Other 🎤** springt ins Freitextfeld der Frage und startet Orcas Diktat (Cmd+E). Die Taste wird dann zu einem roten **Stop**. Ein zweiter Druck beendet das Diktat. Send beendet es auch und schickt ab. Dafür muss in Orca unter **Settings → Voice** das Diktat eingeschaltet sein, mit dem Kürzel Cmd+E.

Ist die Frage beantwortet, zeigen die Tasten wieder die Chats. Die Belegung richtet sich nach der Position der Taste (Slot 1 = oben links).

**Leere Tasten:** Über das ganze Keypad fällt ein Matrix-Regen aus Code-Zeichen; jede Pane-Taste ohne Chat zeigt ihren Ausschnitt davon. Die Tasten 7, 8 und 9 werden zu Steuertasten, solange dort kein Chat liegt:

| Taste | Funktion |
|---|---|
| 7 **Sort** | Sortiert die automatisch belegten Tasten neu: die Chats in der Reihenfolge, in der Orca sie listet, Lücken werden geschlossen. Von Hand belegte Tasten bleiben. |
| 8 **Mic** | Holt den Chat, der vorne ist, in den Fokus und startet Orcas Diktat in seinem Eingabefeld (Cmd+E). Die Taste wird zu einem roten **Stop**; ein zweiter Druck beendet das Diktat. Läuft Musik, wird sie für das Diktat pausiert und danach fortgesetzt. |
| 9 **Send** | Enter, also Abschicken. Läuft das Diktat noch, beendet Send es vorher. |

**Zurücksetzen:** Eine Pane-Taste etwa 1 s halten setzt sie zurück auf Automatisch. Sie zeigt kurz „Auto“ und nimmt dann den nächsten freien Chat. Das gilt auch für Tasten, die du von Hand belegt oder mit Unmap geleert hast.

Von Hand belegen geht so:

1. Das Panel **Agent Keypad** öffnen: Ein Klick auf eine **leere** Pane-Taste öffnet es direkt bei dieser Taste. Sonst mit `Cmd+Option+K` oder einem Klick auf **Agent Keypad** in der Statusleiste von Orca.
2. Im Panel den Chat oder das Pane für die Taste wählen.

Belegungen bleiben über Neustarts erhalten. Sie liegen in `~/.orca-deck/mappings.json`.

## Fehlerbilder

| Was du siehst | Ursache | Abhilfe |
|---|---|---|
| Alle Tasten zeigen „Node 22.6+ not found“ | Kein passendes Node gefunden | `brew install node` (oder Node 22.6+ unter `/usr/local/bin`); das Plugin versucht es selbst wieder, nach spätestens 30 s |
| Status-Taste: `!` „Install the Orca plugin“ | Plugin A fehlt oder ist deaktiviert | Schritt 1 |
| Status-Taste: „slow updates“ | Plugin A ist nicht verbunden, Status kommt nur über die Abfrage alle 2 s | Plugin A in Orca aktivieren; es verbindet sich beim nächsten Agent-Ereignis |
| Status-Taste: `OFF` | Orca läuft nicht | Orca starten, die Tasten erholen sich selbst |
| Eine Taste zeigt immer dasselbe Bild, reagiert aber auf Druck | Das Symbol der Taste wurde in Options+ geändert. Options+ zeigt dann nur noch dieses Bild, die Live-Anzeige ist aus | Taste in Options+ neu belegen und das Symbol nicht ändern |
| Klick auf eine leere Taste zeigt kurz „Map in Orca“, kein Panel | Plugin A fehlt, oder Orca läuft nicht | Schritt 1, Orca starten |
| Kurzes rotes `!` nach einem Tap | Der Fokus ist fehlgeschlagen, z. B. weil der Chat geschlossen wurde | Taste neu belegen |
| Chat fehlt in der Liste im Panel | In dem Chat lief noch nie ein Agent | Einmal einen Prompt schicken |

Logs:

- `~/Library/Application Support/Logi/LogiPluginService/PluginData/OrcaKeypad/daemon.log` für das Logi-Plugin und den Daemon.
- `orca plugin logs lucasdangl.agent-keypad` für Plugin A, bei einem lokal geladenen Plugin `local.agent-keypad`.

Keines der Logs enthält Inhalte aus Terminals oder Chats.

## Deinstallieren

1. In Orca **Agent Keypad: Uninstall** zweimal ausführen. Das entfernt `~/.orca-deck`.
2. Das Plugin in Orca unter Settings → Plugins entfernen.
3. Das Logi-Plugin entfernen: `LogiPluginTool uninstall OrcaKeypad`.
