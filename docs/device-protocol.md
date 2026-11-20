# Device protocol (Logi plugin <-> Logi daemon)

Reference for the messages between **Logi**, the C# plugin that the Logi Plugin Service (Options+) loads, and the **daemon**, plugin B for the keypad (`packages/logi-daemon`, bundled as `daemon.mjs`). Logi starts the daemon as its child process. Source of truth: `packages/logi-daemon/src/protocol.ts` (zod schemas). A test (`protocol-doc.test.ts`) fails when the message types there and the tables below differ. Why the protocol looks like this: [logi-findings.md](logi-findings.md).

## Model

- **Logi is the device, the daemon is plugin B.** Logi reports keys and key edges and shows the images it gets. Everything else stays in the daemon (deck-host, the same code as the Stream Deck plugin): Orca reads, the bridge to plugin A, mappings, tap and hold.
- **Transport:** NDJSON. Logi writes to the daemon's stdin, the daemon writes to its stdout, one UTF-8 JSON object per line. The daemon's stderr is its log. Logi copies it into the plugin log. Nothing else is ever written to stdout.
- Every message has `v` (protocol version, `1`) and `type`. A line that is not JSON, has another `v` or fails validation is logged by type only (never its content) and ignored.
- At most 256 KiB per line. Real messages are a few KB at most (an SVG key image).
- **Lifecycle:** Logi starts the daemon, then sends `hello`. The daemon answers `ready` and starts the bridge. Closing the daemon's stdin (plugin unload, service quit) makes it stop the bridge, remove `bridge.json` and exit 0. It also exits when its parent process changes or is gone (checked every 2 s).

## Messages Logi -> daemon

| type | Fields | Meaning |
| --- | --- | --- |
| `hello` | `pluginVersion: string`, `device: { model: string, cols: int, rows: int }`, `imageSize: int`, `settings: object` | First message. `device` is the grid of the keypad (MX Creative Keypad: 3 x 3), `imageSize` the key size in px (116). `settings` is what the daemon last sent in `saveSettings` (`{}` on the first run). A second `hello` (the plugin reloaded) is answered again and may change the grid. |
| `keys` | `keys: { slotId: string, kind: "pane" \| "status" \| "attention" \| "working" \| "done", index?: int }[]` | Every key that shows one of our commands, the whole list each time. `slotId` is stable: `logi:slot-<n>` for the Pane command with parameter `slot-<n>`, `logi:status`, `logi:attention`, `logi:working`, `logi:done`. `index` is the 1-based key number on the grid (`slot-<n>` = n). It numbers the key and is the position the Orca panel draws it at. |
| `key` | `slotId: string`, `edge: "down" \| "up"` | A key went down or up. Logi sends `Press` as `down` and `Release` as `up`. It drops `LongPress` and `RepeatPress`: the daemon decides tap or hold (1 s) itself, as on the Stream Deck. |
| `deviceState` | `connected: boolean` | The keypad was plugged in or out. Before the first one the daemon assumes connected. |

## Messages daemon -> Logi

| type | Fields | Meaning |
| --- | --- | --- |
| `ready` | `daemonVersion: string` | Answer to every `hello`. |
| `image` | `slotId: string`, `svg: string` | New image for a key: the SVG of `renderKey` / `renderInfoKey`, 144 x 144 units with `width`/`height` 144. Logi sets `width`/`height` to the size the service asks for and shows it with `BitmapImage.FromSvg`. Only changed images are sent, at most one per key every 100 ms. |
| `saveSettings` | `settings: object` | Store this object in the plugin settings and send it back in the next `hello`. A cache only: `~/.orca-deck/mappings.json` is the master copy of the mappings. |
| `alert` | `slotId: string` | Short failure feedback on a key (a press that could not focus its pane). |
| `sendKey` | `key: "Escape" \| "Space" \| "ArrowUp" \| "ArrowDown" \| "Return" \| "1" \| "2" \| "3" \| "4"` | Press this key in the app in front (the answer pad, while the chat in front in Orca waits for an answer). Logi sends it with `ClientApplication.SendKeyboardShortcut`, without modifiers. |

## Versioning

- `v` is the major version. A breaking change bumps it, and daemon and plugin ship together in one `.lplug4` anyway.
- Adding an optional field needs no bump: zod strips unknown keys.
