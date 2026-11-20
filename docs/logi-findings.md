# Logi Actions SDK: Findings aus Phase 0

Stand 2026-11-20. Gemessen auf macOS (Apple Silicon) mit Logi Options+, Logi Plugin Service **6.4.2.3414**, LogiPluginTool **6.4.2.3599**, NuGet `LogiPluginApi` **6.4.2.3567**, .NET SDK **10.0.404**, MX Creative Keypad per USB. Spike-Code: `logi-plugin/OrcaKeypadPlugin/`.

Quellen je Aussage: **[Doku]** = <https://logitech.github.io/actions-sdk-docs/>, **[API]** = Reflection und XML-Doku der `PluginApi.dll` aus dem NuGet-Paket, **[Test]** = im Spike auf dem echten Keypad gemessen.

## Kurzfassung für die Phasen 1–5

| Frage (PLAN.md §3) | Ergebnis |
|---|---|
| 1. C# SDK auf macOS | Funktioniert mit `dotnet` CLI. `logiplugintool generate`, `dotnet build` legt den `.link` an und lädt das Plugin automatisch neu. |
| 2. Bildgröße | Das Keypad fordert **`PluginImageSize.Width116` = 116×116 px** an. Options+ fragt beim Druck einmal zusätzlich `Width90` (80×80) an. **Der Daemon rendert 116 px.** |
| 2. PNG aus Bytes | **Ja:** `BitmapImage.FromArray(byte[])`, auch mit fremd erzeugten PNGs (eigener Encoder im Spike). |
| 2. SVG direkt | **Ja, und das ist der empfohlene Weg:** `BitmapImage.FromSvg(xml)` stellt die SVGs aus `core/render.ts` auf dem Keypad korrekt dar (Sichtvergleich mit dem Browser). **Der Daemon schickt SVG, resvg entfällt.** |
| 2. Update-Rate | 9 Tasten bei 66 ms (≈15 fps je Taste) laufen flüssig. **33 ms hängt sichtbar**, obwohl der Service jeden Aufruf bedient. Empfehlung: **≤ 10 fps je Taste**, Spinner mit 100–125 ms. |
| 3. Key-Down/Up | **Ja.** `ProcessButtonEvent2` liefert `Press`, `LongPress` (nach ~500 ms), `RepeatPress` (alle ~33 ms) und `Release`. **Hold lässt sich nativ umsetzen,** ein Befehl „Taste zuordnen“ ist unnötig. |
| 4. Parametrisierte Befehle | **Ja.** Ein Befehl `Orca Pane` mit `slot-1 … slot-9` erscheint in Options+ als 9 einzelne Befehle in der Gruppe „Orca Panes“. |
| 5. Kindprozess / Node | Erlaubt. `PATH` im Service ist nur `/usr/bin:/bin:/usr/sbin:/sbin`, `node` muss also absolut aufgelöst werden. Der Kindprozess darf `~/Library/Application Support/orca/orca-runtime.json` lesen. |
| 6. Orca | Orca **1.4.264** läuft, `orca status --json` antwortet (≥ 1.4.248 erfüllt). |

## 1. Toolchain und Projekt

- .NET 10 ist Pflicht: „Install the .NET 10 SDK“, und für Plugin Service < 6.4 gilt .NET 8 **[Doku: plugin-development/introduction]**. Wir installieren mit `brew install --cask dotnet-sdk@10`. Der Cask `dotnet-sdk` liefert inzwischen .NET 11, beide SDKs liegen parallel unter `/usr/local/share/dotnet`.
- `dotnet tool install --global LogiPluginTool` liegt danach in `~/.dotnet/tools`, das gehört in den `PATH`.
- `logiplugintool generate OrcaKeypad` erzeugt `OrcaKeypadPlugin/` mit:
  - `src/OrcaKeypadPlugin.csproj` (`net10.0`, `PackageReference LogiPluginApi 6.*`),
  - `package/metadata/LoupedeckPackage.yaml`,
  - Beispiel-Actions, `.vscode`-Tasks.
- `dotnet build` (im Ordner `src/`):
  - Baut nach `bin/Debug/bin/`.
  - Schreibt `~/Library/Application Support/Logi/LogiPluginService/Plugins/OrcaKeypadPlugin.link` (Pfad auf `bin/Debug/`).
  - Schickt `open loupedeck:plugin/OrcaKeypad/reload`. Das Plugin ist nach etwa 100–130 ms neu geladen **[Test]**.
- Manuell neu laden: `open "loupedeck:plugin/OrcaKeypad/reload"` **[Test]**.
- `supportedDevices: - LogitechCreativeFamily` ist gültig. Der Alias steht in `DeviceTypeAliases`, ebenso `MxCreativeKeypad` (= `Loupedeck70`) **[API]**. Die Doku nennt in der YAML-Beschreibung nur `LoupedeckCt`/`LoupedeckLive`.
- Packen und Prüfen: `logiplugintool pack`, `verify` und `install` gibt es laut Hilfe des Tools. Ausprobiert wird das erst in Phase 5.

## 2. Logs und Plugin-Daten

- Plugin-Log: `~/Library/Application Support/Logi/LogiPluginService/Logs/plugin_logs/OrcaKeypad.log` **[Test]**.
  - **Die Datei wird bei jedem Laden des Plugins neu angelegt.** Was vor einem Reload passiert ist, auch `Unload`, ist danach weg.
  - Für Lebenszyklus-Diagnose im echten Plugin brauchen wir deshalb eine eigene, angehängte Logdatei (im Spike: `PluginData/OrcaKeypad/spike-lifecycle.log`).
- Plugin-Datenverzeichnis: `Plugin.GetPluginDataDirectory()` liefert `~/Library/Application Support/Logi/LogiPluginService/PluginData/OrcaKeypad` **[Test]**.
- Plugin-Settings **[API, Test]**:
  - `TryGetPluginSetting` / `SetPluginSetting(name, value, backupOnline)` funktionieren und überleben einen Reload.
  - Nur String-Werte, laut Doku verschlüsselt gespeichert.
  - Im Spike: `spikeIntervalMs`.

## 3. Tastenbilder

- `GetCommandImage(actionParameter, imageSize)` wird für Tasten auf dem Keypad mit **`Width116`** aufgerufen. `new BitmapBuilder(imageSize)` ist dann 116×116 **[Test]**.
- Beim Druck auf eine Taste fragt der Service einmal `Width90` an, das ergibt einen 80×80-Builder **[Test]**. Wahrscheinlich ist das die Vorschau in Options+.
  - Der Wert `Width90` heißt so, liefert aber laut API-Doku und Test 80×80 **[API, Test]**.
  - Phase 3: Die Bildgröße kommt pro Aufruf mit. Das C#-Plugin skaliert notfalls selbst (`BitmapBuilder.DrawImage(bytes, x, y, w, h, rotation)`) oder hält zwei Größen im Cache.
- PNG aus Bytes **[API, Test]**:
  - `BitmapImage.FromArray(byte[])` lädt ein PNG, das unser eigener Encoder erzeugt hat. Das ist dasselbe Szenario wie resvg im Daemon.
  - `TryCreateFromArray` gibt es als Variante ohne Exception.
  - Weitere Wege: `FromBase64String`, `FromSvg(xml)`, `FromFile`.
  - **`FromSvg` getestet [Test]:** 8 Tasten mit echten `renderKey`-SVGs. Getestete Zustände: working mit Spinner, needs_input, awaiting_reply, completed fokussiert mit Rahmen, idle, offline, unmapped und Host-Badge.
    - Das Plugin ersetzt nur `width/height="144"` durch die angeforderte Größe (`viewBox` bleibt 144) und ruft `BitmapImage.FromSvg(xml)` auf.
    - Text, Schrift (`Helvetica…`-Stack), Umbrüche, Agent-Badges, Zustandsicons und Fokus-Rahmen stimmen im Sichtvergleich mit dem Browser überein.
    - `FromSvg` kostet < 1 ms und liefert ein Vektorbild (`IsVectorImage=true`, `Width/Height=-1`). Gerastert wird erst im Service, auf die Größe der Taste.
    - Die Update-Raten aus der Tabelle unten wurden mit PNG gemessen. SVG-Rasterung im Service ist bei 1 s Intervall unauffällig. Bei hohen Raten haben wir nicht gemessen, das ist für unsere ≤ 10 fps auch nicht nötig.
- Neu zeichnen: `ActionImageChanged("slot-n")` löst genau einen `GetCommandImage`-Aufruf für diesen Parameter aus **[Test]**.
- **Belegung erkennen [Test]:** Der Service ruft `GetCommandImage` nur für Parameter auf, die gerade auf einer sichtbaren Taste liegen. Slot 9 bekam nach dem Tausch gegen die Rate-Taste 0 Aufrufe.
  - Ein API-Event „Belegung geändert“ gibt es nicht (Doku und API geben nichts her).
  - Phase 3: Belegung aus den `GetCommandImage`-Aufrufen ableiten, also „Slot ist sichtbar, wenn in den letzten N Sekunden ein Bild angefragt wurde“. Oder, wie PLAN.md vorsieht, einfach alle 9 Slots melden.

### Update-Rate (9 Tasten gleichzeitig, `ActionImageChanged` pro Slot)

| Intervall | Aufrufe `GetCommandImage` (pro Slot) | Auf dem Keypad |
|---|---|---|
| 1000 ms | 5/5 in 5 s | flüssig |
| 250 ms | alle bedient | flüssig |
| 125 ms | alle bedient | flüssig |
| 66 ms | alle bedient (~135/s gesamt) | flüssig |
| 33 ms | alle bedient (~240/s gesamt bei 8 Tasten) | **hängt** |

Der Service drosselt nicht und lässt nichts aus. Der Engpass liegt dahinter, beim USB-Transfer und Display. **Für den Daemon:** Nur geänderte Bilder senden (das macht er schon), Spinner mit höchstens ~8–10 fps. Upstream rendert Pane-Tasten alle 2 s und bei Push, das liegt weit unter der Grenze.

## 4. Tasten-Events

`PluginDynamicCommand` erbt von `PluginDynamicAction`:

```csharp
protected virtual Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 buttonEvent);
// DeviceButtonEvent2.EventType: None, Press, LongPress, RepeatPress, Release
protected virtual void RunCommand(String actionParameter);
```

Die Doku beschreibt `ProcessButtonEvent` nur für Dynamic Folders. Für Commands steht die Methode in der API und wird auf dem Keypad auch aufgerufen **[API, Test]**.

Gemessener Ablauf auf dem Keypad **[Test]**:

| Geste | Ereignisse |
|---|---|
| Kurzer Tap | `Press` → `RunCommand` (≈ 4 ms später) → `Release` (≈ 160 ms nach Press) |
| Halten ≈ 2,7 s | `Press` → `RunCommand` → `LongPress` (+500 ms) → `RepeatPress` alle ≈ 33 ms → `Release` |

- `ProcessButtonEvent2` gibt `false` zurück (nicht behandelt): `RunCommand` folgt **direkt auf `Press`**, also schon beim Drücken, und nur einmal, nicht bei den Repeats.
- `ProcessButtonEvent2` gibt `true` zurück: **`RunCommand` wird nicht aufgerufen** (Rate-Taste, mehrfach getestet).
- `PressDuration` ist auf dem Keypad immer `0`. Die Haltedauer müssen wir selbst messen.
- `DeviceType` = `Loupedeck70` (MX Creative Keypad).
- `ControlId` ist die physische Taste: Pane 5 lag auf `control=4`. Das ist nützlich für die Position, aber nur innerhalb des Events verfügbar.
- `DeviceId` ist ein IOKit-Pfad. **Er enthält nichts Persönliches, gehört aber trotzdem nicht in Logs, die Nutzer teilen.**

**Folge für Phase 3:** Tap und Hold werden komplett in `ProcessButtonEvent2` behandelt, mit Rückgabe `true`:

- `LongPress` → `press hold`, einmal pro Druck. `RepeatPress` ignorieren.
- `Release` ohne vorheriges `LongPress` → `press tap`.

Damit bleibt das bestehende Verhalten der Upstream-Gesten erhalten: Tap beim Loslassen, Hold nach Schwelle. Upstream nutzt 1 s Hold, Logi meldet `LongPress` nach 500 ms. Entweder übernehmen wir die 500 ms, oder wir messen selbst ab `Press` und senden `hold` erst nach 1 s.

Der Ersatzbefehl „Taste zuordnen“ aus PLAN.md wird nicht gebraucht.

## 5. Parametrisierte Befehle

- Aufbau [Doku: add-a-command-with-a-parameter; API]:
  - `base()` aufrufen, dann `DisplayName` und `GroupName` setzen.
  - `AddParameter("slot-n", "Orca Pane n", "Orca Panes")` für n = 1…9.
- In Options+ erscheinen die 9 Parameter als einzelne, ziehbare Befehle unter *Orca Agent Keypad (Spike) → Orca Panes* **[Test]**.
- Einschränkung laut Doku: ein String-Parameter pro Befehl. Das genügt.
- `ParametersChanged()` gibt es für Änderungen zur Laufzeit. Nicht benötigt.

## 6. Kindprozess (Spike B)

Gemessen mit `NodeChild.cs` **[Test]**:

- Das Plugin läuft **im Prozess `LogiPluginService`** (die PID war 1043). `process.ppid` des Node-Kindes ist genau diese PID.
  - `watchHost({ parent: process.ppid })` funktioniert damit unverändert.
  - Aber: Der Prozess ist für alle Plugins gemeinsam. Wird nur unser Plugin entladen, bleibt der Parent am Leben. Deshalb braucht es zusätzlich das stdin-EOF.
- Umgebung im Service:
  - `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, also **kein Homebrew, kein nvm, kein Volta**.
  - `HOME` und `USER` sind korrekt.
  - `cwd=/Applications/Utilities/LogiPluginService.app`.
- `Process.Start` mit absolutem Pfad, `UseShellExecute=false` und umgeleitetem stdin/stdout/stderr funktioniert:
  - stdout kommt zeilenweise über `OutputDataReceived`.
  - stderr kommt getrennt.
  - stdin → Node funktioniert (Echo-Test).
- Sandbox: Der Node-Kindprozess darf `~/Library/Application Support/orca/orca-runtime.json` lesen. Den Unix-Socket selbst testet erst Phase 2 mit dem echten Daemon.
- Lebenszyklus beim Reload des Plugins:
  - `Unload()` wird aufgerufen, wir schließen stdin.
  - Node bekommt `end` und beendet sich nach **8 ms** mit Code 0.
  - Danach startet `Load()` neu. Der alte Prozess ist weg, wir finden keine Waisen.
- Node-Kandidaten auf diesem Mac:

| Quelle | Pfad | vorhanden |
|---|---|---|
| Plugin-Setting `nodePath` | (leer) | – |
| `PATH` des Service | `/usr/bin/node` usw. | nein |
| Homebrew arm64 | `/opt/homebrew/bin/node` (v26.1) | **ja**, gewählt |
| Homebrew x64 | `/usr/local/bin/node` | nein |
| Volta / nvm | `~/.volta/bin/node`, `~/.nvm/versions/node/*/bin/node` | nein |
| Logi-eigenes Node | `~/Library/Application Support/Logi/LogiPluginService/PluginHosts/node22/node/bin/node` (v22.23.4, arm64, signiert) | ja |
| Login-Shell | `/bin/zsh -lc 'command -v node'` → `/opt/homebrew/bin/node` | ja |

**Empfehlung für Phase 3:** Reihenfolge Setting `nodePath` → `/opt/homebrew/bin/node` → `/usr/local/bin/node` → Volta → nvm (neueste Version) → Login-Shell-Probe → Logi-eigenes Node 22.

- Das Logi-eigene Node ist **undokumentiert**. Es gehört zum Node.js-SDK-Host und kann sich mit Updates ändern. Deshalb ist es nur der letzte Fallback, ähnlich wie Upstream das von Elgato mitgelieferte Node nutzt.
- Node ≥ 22.6 prüfen (`--experimental-strip-types` brauchen wir nur in Dev, das Bundle ist reines JS).

## 7. Weitere Beobachtungen

- In `LoupedeckSettings.ini` steht `CurrentApplication/Loupedeck70=com.stablyai.orca`. Options+ kennt Orca also als App und schaltet das Keypad-Profil um, wenn Orca vorn ist.
  - Unser Plugin ist universell (`HasNoApplication`). Der Nutzer legt die Befehle in das Profil, das er will.
  - Für `docs/install-logi.md` (Phase 5): die Pane-Tasten ins Profil „Orca“ **und** ins Standardprofil legen, sonst verschwinden sie, wenn Orca nicht vorn ist.
- Auf dem Rechner ist schon ein Fremd-Plugin installiert („ClaudeConsole“). Es meldet beim Start „already loaded“. Das ist harmlos und betrifft uns nicht.
- `ProcessButtonEvent2` und `GetCommandImage` laufen auf wechselnden Threadpool-Threads. Der Bild-Cache in Phase 3 muss threadsicher sein (`ConcurrentDictionary`).

## 8. Orca-Agent-Sessions (Chats) — gefunden beim Hardware-Test in Phase 3

Getestet am 2026-11-20 mit Orca 1.4.264 **[Test]**.

- Agents, die Orca als **Chat** startet (der native Agent-Chat, `kind: "chat"`), sind **keine Terminal-Panes**.
  - Sie fehlen in `terminal.list`, deshalb kennt upstream `orca-agent-deck` sie nicht.
  - In `worktree ps` stehen sie trotzdem unter `agents` mit Status, und zwar mit `paneKey` = `structured-agent-session-<orcaSessionId>:<leafId>`, `conversationName` und `agentType`.
- Runtime-Methode **`agent.list`** (das, was `orca agent list --json` zeigt): liefert Chats und Terminal-Agents.
  - Felder: `orcaSessionId`, `kind` (`chat` | `terminal`), `agent`, `state` (`working` | `blocked` | `waiting` | `done`), `worktreeId`, `workspace`, `repo`, `hostId`, `paneKey`, `title`, `updatedAt`.
  - `lastAssistantMessage` enthält Inhalt und darf **nie** geloggt werden.
- **Hineinspringen:** `terminal.reveal { worktreeId, tabId, leafId, executionHostId }` mit `tabId:leafId` aus dem Chat-`paneKey` antwortet `navigated: true`. Orca zeigt danach genau diesen Chat-Tab (vom Nutzer bestätigt).
  - Einen CLI-Befehl dafür gibt es nicht: `terminal switch` braucht einen Terminal-Handle. Chats gehen also nur über den Runtime-Socket.
- **Welcher Tab ist vorn?** Der Layout-Baum (`terminal.list --include-visual-layouts`) kennt nur Terminals. Steht ein Chat vorn, nennt er trotzdem den zuletzt gezeigten Terminal-Tab als aktiv **[Test]**.
  - Die Runtime-Methode `session.tabs.list { worktree: "id:<worktreeId>" }` meldet `activeTabType: "agent-session"` und `activeTabId: "agent-session:<sessionId>"` **[Test]**. Damit findet Hold-zum-Belegen den Chat.
  - Daneben gibt es `agentSession.reveal`. Ungetestet, weil `terminal.reveal` reicht.
- Ein Chat ohne Agent-Eintrag (noch nie gelaufen) fehlt in `worktree ps` und bekommt keinen Pane **[Test]**.
- **Gebaut (Phase 3b):** Ein Daemon auf dem echten Keypad listet beide laufenden Chats als Panes und erkennt den Chat, der vorn ist, als fokussiert **[Test]**.
- **Hardware-Test am 2026-11-20** **[Test]**:
  - Chat-Tasten über Halten und das Orca-Panel belegt.
  - Ein Tap öffnet den Chat, der Fokus dauert rund 55 ms.
  - Der Nutzer hat bestätigt, dass es funktioniert.
- **Voraussetzung:** Plugin A muss in Orca installiert sein.
  - Ohne Plugin A öffnet Halten nichts, im Log steht dann `open panel: refused`. Der Doctor bzw. die Status-Taste sollte das klar melden (Phase 4/5).
  - Für die Entwicklung: `orca plugin dev load orca-plugin` mit Freigabe (Plugin-Key `local.agent-deck`).
- **Status-Push für Chats:** Orca sendet `agent.status.changed` auch für Chats, mit `mainAgent.state` und `stateStartedAt`. Belegt durch eine Aufzeichnung von Plugin A **[Test]**.
- **`stateStartedAt` ist keine Reihenfolge** **[Test]**:
  - Geht ein Agent im selben Turn von `waiting` zurück auf `working`, meldet Orca als `stateStartedAt` wieder den Beginn des Turns. Der liegt vor dem `waiting`.
  - Der Bridge-Feed hat das neue `working` deshalb als „älter“ verworfen. Die Taste und der Attention-Zähler blieben für den Rest des Turns auf „needs you“.
  - Fix: Der Feed ordnet nach `receivedAt` (Zustellzeit, die Uhr von Plugin A) und erst bei Gleichstand nach `stateStartedAt`. Den Upstream betrifft das genauso.
- Auf diesem Rechner laufen **alle** Agents als Chats. Die Terminal-Panes sind einfache Shells. Ohne Chat-Unterstützung zeigt das Keypad deshalb keinen einzigen Agent.

## Folge für Phase 2

- Device-Protokoll: `image` trägt `svg: string` (UTF-8, wie `renderKey` es liefert) statt `png: base64`.
- Kein `@resvg/resvg-js`, kein natives Binary im Bundle. `daemon.mjs` ist reines JS.
- `hello.imageSize` wird trotzdem übertragen, weil das C#-Plugin die SVG-Größe pro Aufruf setzt (116 bzw. 80).

## Offen (bewusst nicht in Phase 0)

- **`AutoRepeatOnLongPress = false`** ist als Property in der API vorhanden, aber nicht getestet. Für unsere Logik ist es egal, weil wir `RepeatPress` ignorieren.
- **Absturz des Plugin Service:** Erwartet ist, dass stdin EOF und der Wechsel der ppid den Daemon beenden. Das haben wir nicht getestet, weil wir dafür den Service hart beenden müssten. Das gehört zur Abnahme von Phase 3 („Options+ beenden“).
- **Mehrere Seiten / Profile:** Wie oft der Service beim Seitenwechsel `GetCommandImage` aufruft, ist nicht gemessen.
