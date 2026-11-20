# PLAN: Orca Agent Keypad (Logi MX Keypad ↔ Orca)

Ziel: Jede Taste des Logi MX (Creative) Keypad zeigt eine Orca-Session (Agent-Status als Farbe/Icon, Name, Spinner). Ein Druck auf die Taste springt in diesen Pane und holt Orca nach vorn.

Basis ist ein Fork von **[1am/orca-agent-deck](https://github.com/1am/orca-agent-deck)** (MIT, v0.3.1). Das Projekt macht genau das für Stream Deck. Wir tauschen nur die Geräteseite aus.

> Für Claude Code: Diese Datei ist die Arbeitsgrundlage. Arbeite Phase für Phase. Nach jeder Phase müssen `pnpm typecheck` und `pnpm test` grün sein, dann wird committet. Lies vorher `docs/architecture.md` und `docs/bridge-protocol.md`.

---

## 1. Ausgangslage im Repo (Stand Nov 2026)

| Teil | Ort | Rolle | Was wir damit machen |
|---|---|---|---|
| **Plugin A** | `orca-plugin/` (`main.mjs`, `panel.jsx`, `orca-plugin.json`) | Läuft in Orca als `trusted-worker`, bekommt `agent.status.changed` und schickt `agentStatus` per WebSocket an B. Liefert außerdem das Mapping-Panel in Orca. | **Bleibt fast unverändert.** Nur ID, Texte („Stream Deck“ → „Keypad“) und Panel-Key anpassen. |
| **Plugin B** | `packages/streamdeck-plugin/` | Node-Prozess, den die Elgato-App startet. Betreibt den Bridge-Server (`127.0.0.1:47800-47809`, `~/.orca-deck/bridge.json`), spricht mit dem Orca-Runtime-Socket, zeichnet die Tasten (SVG), verarbeitet Tap und Hold. | **Wird aufgeteilt** in einen geräteneutralen Node-Daemon und ein dünnes Logi-C#-Plugin. |
| `packages/core` | | Reine Logik: `DeckController`, Mapping, `render.ts` (SVG), Gesten, Status | Unverändert wiederverwenden |
| `packages/adapter-runtime`, `adapter-cli`, `adapter-bridge`, `window-raiser` | | Orca-Socket, CLI-Fallback, Bridge-Server, Fenster nach vorn (`open -b com.stablyai.orca`) | Unverändert wiederverwenden |
| `packages/fake-orca`, `test/replay*` | | Simulator und Replay-Tests ohne echtes Orca | Für Tests weiter nutzen |

Die einzige Elgato-Abhängigkeit steckt in `packages/streamdeck-plugin/src` (`plugin.ts`, `actions/*.ts`, `host*.ts`, `mapping-file.ts`, Property Inspector).

## 2. Architekturentscheidung

**Warum nicht alles in C# neu schreiben?** Plugin B hat rund 5.000 Zeilen getestete TypeScript-Logik. Das Logi Node.js SDK läuft (Alpha) nur unter Windows. Auf dem Mac bleibt für das Logi-Plugin also nur C#.

**Lösung: Das C#-Plugin ist nur der Geräte-Treiber, die Logik bleibt in Node.**

```
Orca App
 ├─ Runtime (unix socket) ◄──────────────┐  terminal.list / worktree.ps / terminal.focus
 └─ Plugin A (trusted-worker)            │
       │ agentStatus (ws, HMAC)          │
       ▼                                 │
 deck-daemon (Node 22, Kindprozess) ─────┘
   = bisheriges Plugin B ohne @elgato/*
   core + adapter-* + window-raiser
       ▲  │  NDJSON über stdin/stdout ("Device-Protokoll")
       │  ▼
 Logi C#-Plugin (Logi Plugin Service in Options+)
   startet den Daemon, zeigt PNGs auf den Tasten, meldet Druck
       │
       ▼
 MX Keypad (9 LCD-Tasten)
```

Gründe:
- Der Logi-Plugin-Service startet unser C#-Plugin, das C#-Plugin startet den Daemon als Kindprozess. Das entspricht genau dem Modell der Elgato-App. `host-watch.ts` (Exit, wenn der Parent-Prozess verschwindet) funktioniert unverändert.
- stdin/stdout statt eines weiteren Ports: kein Token, keine Firewall-Frage, Lebenszyklus automatisch gekoppelt.
- Plugin A und das Bridge-Protokoll bleiben unverändert. Das Orca-Panel zum Zuordnen der Tasten funktioniert weiter.

**Nicht gleichzeitig mit der Stream-Deck-Version betreiben.** Beide B-Seiten schreiben `~/.orca-deck/bridge.json`.

## 3. Offene Punkte, die Phase 0 klären muss (nicht raten)

1. **Logi C# SDK auf macOS:** Projekt mit dem Logi Plugin Tool erzeugen, mit `dotnet build` bauen und im Logi Plugin Service laden. Visual Studio for Mac ist eingestellt, also Rider oder VS Code mit `dotnet` CLI.
2. **Dynamische Bilder:** Wie oft darf ein Tastenbild aktualisiert werden, ohne dass es ruckelt? Welche Pixelgröße hat die MX-Keypad-Taste (`PluginImageSize`)? Lässt sich ein PNG aus Bytes laden? Doku: `csharp/tutorial/change-a-button-image`, `csharp/api/PluginImageSize`.
3. **Tasten-Events:** Gibt es getrennte Key-Down- und Key-Up-Events (für Hold = Taste zuordnen), oder nur „Command ausgeführt“? Doku: `csharp/api/PluginDynamicAction`, `PluginDynamicCommand`. Falls es nur Press gibt, wird Hold durch einen eigenen Befehl „Taste zuordnen“ ersetzt (siehe Phase 3).
4. **Parametrisierte Befehle:** Lässt sich ein Befehl „Orca Pane“ mit Parameter `slot-1 … slot-9` anlegen, den der Nutzer in Options+ auf die Tasten zieht (`add-a-command-with-a-parameter`)?
5. **Kindprozess:** Darf das Plugin `node` starten? Welcher `PATH` gilt im Plugin-Service? Erwartung: der Login-`PATH` gilt **nicht**, der absolute Pfad muss aufgelöst werden (`/opt/homebrew/bin/node`, `~/.nvm/...`, `~/.volta/...`, oder in den Settings konfigurierbar).
6. **Orca-Version:** Orca ≥ 1.4.248 (`engines` in `orca-plugin.json`), `orca` CLI registriert (`orca status --json`).

Die Ergebnisse kommen nach `docs/logi-findings.md`. Erst danach folgen die Phasen 1–5.

---

## Phase 0 – Setup und Spikes (½–1 Tag)

- [x] Fork von `1am/orca-agent-deck` nach `lucasdangl/orca-agent-keypad` (öffentlich, GitHub-Forks lassen sich nicht privat machen), Branch `logi`.
- [x] `nvm use` (Node ≥ 22.6, `.nvmrc`), `pnpm i`, `pnpm typecheck && pnpm test` grün **vor** jeder Änderung.
- [x] .NET SDK installieren (Version laut Logi-Doku), Logi Plugin Tool für macOS von <https://www.logitech.com/software/marketplace/developer.html>.
- [x] **Spike A:** Hello-World-Logi-Plugin `OrcaKeypad` mit einem parametrisierten Befehl (9 Slots). Jede Taste zeigt ein Bild mit Zähler, das jede Sekunde wechselt. Klärt Punkte 2–4.
- [x] **Spike B:** Das C#-Plugin startet `node -e "setInterval(()=>console.log(JSON.stringify({t:Date.now()})),1000)"` und loggt stdout. Klärt Punkt 5.
- [x] `docs/logi-findings.md` schreiben: Bildgröße, maximale Update-Rate, Events, Node-Pfad, Log-Ort.

**Abnahme:** Auf dem echten Keypad zählen 9 Tasten hoch. Das Plugin-Log zeigt die Zeilen des Node-Kindprozesses.

## Phase 1 – Geräteneutralen Daemon herauslösen (1–2 Tage)

Ziel: Die Logik aus `streamdeck-plugin` läuft ohne `@elgato/streamdeck`.

- [x] Neues Paket `packages/deck-host` mit der Schnittstelle `DevicePort` (`packages/deck-host/src/port.ts`). Abweichungen vom ursprünglichen Entwurf, begründet durch Phase 0:
  ```ts
  interface DevicePort {
    keys(): KeyBinding[];                 // { slotId, kind: 'pane'|'status'|'attention', device, coordinates? }
    onKeysChanged(cb: () => void): void;
    setImage(slotId: string, svg: string): Promise<void>;   // SVG aus render.ts, Logi nutzt BitmapImage.FromSvg
    showAlert(slotId: string): Promise<void>;
    onKey(cb: (slotId: string, edge: 'down'|'up') => void): void;  // rohe Flanken, Tap/Hold entscheidet deck-host
    devices(): DeviceInfo[];              // { id, model, cols, rows, connected }
    settings: { load(): Promise<Record<string, unknown>>; save(o: Record<string, unknown>): void };
    log(level: 'info'|'warn', msg: string): void;
    host(): DeckHostInfo;                 // für den Setup-Doctor
  }
  ```
  - **Flanken statt Gesten:** Das Keypad liefert `Press`/`Release` (Phase 0). deck-host wertet sie mit demselben `HoldGestures` (1 s) aus wie bisher, damit Tap/Hold auf allen Geräten gleich wirkt.
  - **`coordinates` statt `index`:** liefert Tastennummer und `MappingStore.locate` in einem; Logi meldet Slot n als Spalte `(n-1)%3`, Zeile `(n-1)/3`.
- [x] Die Logik aus `plugin.ts`, `actions/pane-slot.ts`, `actions/status.ts`, `actions/attention.ts` und `actions/info-key.ts` gegen `DevicePort` umschreiben und nach `packages/deck-host/src` verschieben. `SingletonAction`, `WillAppearEvent` und `streamDeck.logger` werden durch den Port ersetzt. `bridge.ts`, `mapping-file.ts` und `host-watch.ts` ziehen mit um.
- [x] Die Slot-ID kommt vom Port (`KeyBinding.slotId`): Elgato behält den Action-Context, Logi nutzt stabil `logi:slot-<n>`. `MappingStore.locate` (Zuordnung nach Position) bleibt für den Wechsel zwischen Hosts erhalten.
- [x] Optional, aber empfohlen: `streamdeck-plugin` auf `deck-host` mit einem `ElgatoPort` umstellen, damit die bestehenden Tests (`pane-slot-raise.test.ts`, `replay-b`) die Logik weiter absichern. Wenn das zu aufwendig ist, die Tests nach `deck-host` portieren und einen `FakePort` nutzen.
- [x] Der Property Inspector (`ui/*.html`, `pi*.ts`) bleibt nur im Elgato-Plugin (`actions/keys.ts`); deck-host kennt ihn nicht. Für Logi fällt er weg. Konfiguriert wird über das Orca-Panel (Plugin A), das es schon gibt.

**Abnahme:** `pnpm test` grün. Ein Vitest-Test mit `FakePort` und `fake-orca` zeigt: Ein Status-Push färbt die Taste, ein Tap ruft `terminal.focus` auf.

## Phase 2 – Device-Protokoll und Daemon (1 Tag)

- [ ] Neues Paket `packages/logi-daemon`: Einstiegspunkt `bin.ts`, implementiert `DevicePort` über **NDJSON auf stdin/stdout** (eine JSON-Zeile pro Nachricht, Logs ausschließlich auf stderr).
- [ ] Nachrichten (Version `v: 1`, mit zod validieren wie in `adapter-bridge/src/protocol.ts`):

  | Richtung | type | Felder |
  |---|---|---|
  | Logi → Daemon | `hello` | `pluginVersion`, `device: {model, cols, rows}`, `imageSize: number`, `settings: object` |
  | Logi → Daemon | `keys` | `keys: {slotId, kind, index}[]` (welche Slots in Options+ belegt sind) |
  | Logi → Daemon | `key` | `slotId`, `edge: 'down' \| 'up'` (aus `ProcessButtonEvent2`: `Press` → down, `Release` → up; `LongPress`/`RepeatPress` ignorieren) |
  | Logi → Daemon | `deviceState` | `connected: boolean` |
  | Daemon → Logi | `image` | `slotId`, `svg: string` (Phase 0: `BitmapImage.FromSvg` rendert `render.ts` korrekt, siehe `docs/logi-findings.md`) |
  | Daemon → Logi | `saveSettings` | `settings: object` |
  | Daemon → Logi | `alert` | `slotId` (kurzes Fehlerfeedback) |

- [ ] ~~SVG → PNG im Daemon mit `@resvg/resvg-js`~~ Entfällt laut Phase 0: Der Daemon schickt das SVG aus `render.ts` unverändert, das C#-Plugin setzt `width`/`height` auf die angeforderte Größe und nutzt `BitmapImage.FromSvg`.
- [ ] Bildrate drosseln, auf das Ergebnis aus Phase 0 abgestimmt. Nur geänderte Bilder senden (diese Logik gibt es schon: „setImage only if changed“). Das Spinner-Tempo über `spinnerAdvances` anpassen.
- [ ] `watchHost({ parent: process.ppid })` bleibt: Der Daemon beendet sich, wenn das C#-Plugin weg ist. Zusätzlich beendet er sich bei EOF auf stdin.
- [ ] Bundle mit rollup, analog zu `packages/streamdeck-plugin/rollup.config.mjs`, zu **einer** Datei `daemon.mjs` ohne native Abhängigkeiten.
- [ ] Testharness `scripts/logi-sim.ts`: spielt das C#-Plugin über stdin/stdout nach und schreibt die Bilder als PNG nach `tmp/keys/`. Damit lässt sich ohne Hardware testen.

**Abnahme:** `fake-orca` und `logi-sim` laufen, Status-Wechsel erscheinen als PNG-Dateien, ein simulierter `press` fokussiert den Pane im Fake.

## Phase 3 – Logi C#-Plugin (1–2 Tage)

Ordner `logi-plugin/OrcaKeypadPlugin/` (vom Logi Plugin Tool erzeugt).

- [ ] **Lebenszyklus:** Beim Laden des Plugins `node daemon.mjs` als Kindprozess starten (Node-Pfad aus den Plugin-Settings, sonst Kandidatenliste aus Phase 0). stdout zeilenweise lesen, stderr ins Logi-Log. Bei Absturz mit Backoff neu starten (1 s → 30 s). Beim Entladen stdin schließen und den Prozess beenden.
- [ ] **Befehle:**
  - `Orca Pane` (parametrisiert, `slot-1 … slot-9`): Bild = letztes PNG für diesen Slot, Druck = `press tap`.
  - `Orca Status` (eine Taste: Verbindung, Anzahl Agents nach Zustand).
  - `Orca Attention` (springt zum Agent, der am längsten auf dich wartet).
  - Falls Phase 0 kein Key-Down/Up ergibt: `Orca: Taste zuordnen` als eigener Befehl. Danach markiert der nächste Druck auf eine Pane-Taste diese als Ziel für den gerade fokussierten Orca-Pane. Das ersetzt `hold`.
- [ ] **Bild-Cache:** `Dictionary<slotId, byte[]>`. Bei `image` aktualisieren und das Neuzeichnen für genau diese Taste auslösen. Ohne Bild ein neutrales Platzhalter-Icon zeigen.
- [ ] **Belegung melden:** Welche Slots auf dem Gerät liegen, an den Daemon (`keys`) senden. Falls das SDK das nicht verrät: alle 9 Slots als belegt melden. Der Daemon rendert dann unbenutzte Slots, das ist harmlos.
- [ ] **Settings:** `saveSettings` über die Plugin-Settings-API des Logi SDK speichern und bei `hello` zurückgeben. `~/.orca-deck/mappings.json` bleibt die maßgebliche Kopie.
- [ ] Icons und Metadaten: Plugin-Name „Orca Agent Keypad“, Icon im Recovio-Stil (keine Elgato- oder Orca-Logos).

**Abnahme:** Auf dem echten Keypad zeigen die Tasten echte Orca-Panes. Ein Tap springt in den Pane, Orca kommt nach vorn. Ein Agent, der auf Input wartet, wird gelb oder orange.

## Phase 4 – Plugin A anpassen (½ Tag)

- [ ] In `orca-plugin/orca-plugin.json`: `id` → `agent-keypad`, `name` → „Agent Keypad for Orca“, Beschreibungen und Tooltips „Stream Deck“ → „Logi Keypad“. Den Shortcut `Mod+Alt+K` beibehalten oder ändern.
- [ ] Die Plugin-Keys, die B bei `openPanel` probiert (`1am.agent-deck`, `local.agent-deck`), auf den neuen Key umstellen (`local.agent-keypad` bzw. `<owner>.agent-keypad`). Danach in `adapter-runtime` / `plugin.ts` → `deck-host` suchen.
- [ ] `panel.jsx`: Gerätetexte anpassen. Das Raster kommt aus `deckState.cols/rows` (3×3), also keine Logikänderung.
- [ ] Bridge-Protokoll **nicht** ändern (`v: 1`, Minor 5). `helloAck.deck.devices[].model` = `"MX Keypad"`.
- [ ] Installation in Orca: Settings → Plugins → Install from Git (eigener Fork) oder lokal.

**Abnahme:** Nach `orca plugin logs local.agent-keypad` verbindet sich A mit dem Daemon (HMAC-Handshake ok). Statuswechsel kommen sofort an, nicht erst nach dem 2-s-Poll.

## Phase 5 – Paketieren, Installieren, Doku (½ Tag)

- [ ] `make package-logi`: Daemon-Bundle bauen, ins Plugin-Verzeichnis kopieren, mit dem Logi Plugin Tool validieren und paketieren.
- [ ] `make package-orca` wie gehabt, mit neuer ID.
- [ ] `docs/install-logi.md`: Voraussetzungen (Options+ mit Plugin-Support, Orca ≥ 1.4.248, Node 22, `orca` CLI), Installation beider Plugins, Tasten in Options+ belegen, Fehlerbilder.
- [ ] `NOTICE.md` und `LICENSE` beibehalten (MIT, Original-Autor nennen). Der Fork bleibt privat, außer du willst ihn veröffentlichen.

## Tests und Abnahme gesamt

- [ ] `pnpm typecheck`, `pnpm test`, `make replay` grün.
- [ ] Manuell: 3 Worktrees mit je einem Claude-Code-Agent. Tasten zeigen working (blau, Spinner) → needs input (gelb) → completed (grün). Tap fokussiert den richtigen Pane.
- [ ] Orca beenden: Tasten zeigen „offline“ statt Fehler. Orca starten: erholt sich ohne Neustart von Options+.
- [ ] Options+ beenden: Daemon-Prozess ist nach ≤ 2 s weg (`ps aux | grep daemon.mjs`), `bridge.json` ist entfernt.
- [ ] Mac Sleep/Wake: erholt sich (siehe `docs/known-issues.md`).
- [ ] Sicherheit: Bridge nur auf `127.0.0.1`, `bridge.json` mit 0600, keine Terminal-Inhalte in Logs (die Regeln aus dem Original-Repo gelten weiter).

## Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Das Logi SDK kann kein Key-Down/Up | Befehl „Taste zuordnen“ statt Hold, Zuordnung über das Orca-Panel |
| Bild-Updates sind zu langsam oder gedrosselt | Spinner abschalten, nur Zustandswechsel neu zeichnen |
| Node fehlt oder ist nicht im `PATH` des Plugin-Service | Pfad in den Settings, sauberer Fehler auf der Status-Taste („Node nicht gefunden“) |
| Upstream (`1am/orca-agent-deck`) ändert sich | Upstream als Remote behalten, `core`/`adapter-*` regelmäßig mergen. Unsere Änderungen liegen in `deck-host`, `logi-daemon` und `logi-plugin` |
| Orca ändert die Runtime-Socket-API | Liegt in `adapter-runtime`, der CLI-Fallback greift automatisch |

---

## Start-Prompt für Claude Code

```
Lies PLAN.md, docs/architecture.md und docs/bridge-protocol.md.
Wir arbeiten nach PLAN.md. Starte mit Phase 0: Prüfe, dass pnpm typecheck und
pnpm test auf dem unveränderten Fork grün sind. Lies dann die Logi Actions SDK
Doku (https://logitech.github.io/actions-sdk-docs/llms.txt) und baue Spike A
und Spike B im Ordner logi-plugin/. Schreib die Ergebnisse nach
docs/logi-findings.md. Rate keine SDK-APIs: Wenn die Doku etwas offen lässt,
schreib einen kleinen Test oder frag mich. Hör nach Phase 0 auf und fass
die Findings zusammen, bevor du Phase 1 beginnst.
```

Danach pro Phase: „Weiter mit Phase N laut PLAN.md, Findings aus docs/logi-findings.md beachten.“ Phase 1 und Phase 3 lassen sich in Orca gut parallel in zwei Worktrees bauen, sobald das Device-Protokoll aus Phase 2 feststeht. Dafür Phase 2 zuerst als Schnittstellen-Commit festziehen.

