import type { AnswerKeyCode, DeckHostInfo } from '@orca-agent-deck/core';

/** What one of our keys is for. */
export type KeyKind = 'pane' | 'status' | 'attention' | 'working' | 'done';

/** One key the user put one of our actions on. */
export interface KeyBinding {
  /**
   * Stable id of the key. Elgato: the action context. Logi: `logi:slot-<n>`. Mappings are stored under it, so it must
   * survive restarts of the device app as long as the key keeps its action.
   */
  slotId: string;
  kind: KeyKind;
  /** Id of the device the key sits on (`DeviceInfo.id`). */
  device: string;
  /**
   * 0-based position on the device, when the device app tells it. Gives the key its number (`keyNumber`) and lets a
   * key with a new id inherit the mapping of a vanished key at the same place (`MappingStore.locate`).
   */
  coordinates?: { column: number; row: number };
}

/** A device the device app knows about. */
export interface DeviceInfo {
  id: string;
  /** Shown in the Orca panel and sent to plugin A (`helloAck.deck.devices[].model`). */
  model: string;
  cols: number;
  rows: number;
  connected: boolean;
}

/** A key edge. Gestures (tap, hold) are decided by deck-host, the same way for every device. */
export type KeyEdge = 'down' | 'up';

/**
 * The device side of plugin B: everything deck-host needs from the device app (Elgato Stream Deck, OpenDeck, Logi
 * Plugin Service). Implementations only translate; all deck logic lives in deck-host.
 */
export interface DevicePort {
  /** Keys that carry one of our actions right now (visible ones; the device app decides what that means). */
  keys(): KeyBinding[];
  /** Called after keys appeared or disappeared. */
  onKeysChanged(cb: () => void): void;
  /** Shows an image on a key: an SVG string as `renderKey` / `renderInfoKey` produce it (144 x 144 units). */
  setImage(slotId: string, svg: string): Promise<void>;
  /** Short failure feedback on a key (Elgato's alert triangle); a no-op where the device has none. */
  showAlert(slotId: string): Promise<void>;
  /** Key down / key up on one of our keys. */
  onKey(cb: (slotId: string, edge: KeyEdge) => void): void;
  devices(): DeviceInfo[];
  /** Small settings object the device app keeps for the plugin (a cache: `~/.orca-deck/mappings.json` is the master). */
  settings: {
    load(): Promise<Record<string, unknown>>;
    save(o: Record<string, unknown>): void;
  };
  /** Metadata only: never terminal content, pane previews or tokens. */
  log(level: 'info' | 'warn', msg: string): void;
  /** Which host app runs us, for the Setup doctor and the log. */
  host(): DeckHostInfo;
  /**
   * Sends a key press to the app in front (the answer pad). Absent where the device app cannot: the Pane keys then
   * never turn into the answer pad.
   */
  sendKey?(code: AnswerKeyCode): Promise<void>;
}
