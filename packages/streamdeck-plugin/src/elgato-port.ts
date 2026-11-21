import streamDeck, { type WillAppearEvent } from '@elgato/streamdeck';
import type { DeckHostInfo } from '@orca-agent-deck/core';
import type {
  DeviceInfo,
  DevicePort,
  KeyBinding,
  KeyEdge,
  KeyKind,
} from '@orca-agent-deck/deck-host';
import { currentHost } from './host.ts';

const image = (svg: string) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;

/** The part of a key action that the port uses. */
interface KeyAction {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

/**
 * `DevicePort` over the Elgato Stream Deck SDK (also OpenDeck). The action classes in `actions/` feed it the SDK
 * events; deck-host does the rest. Slot id = the action context.
 */
export class ElgatoPort implements DevicePort {
  private readonly present = new Map<string, { binding: KeyBinding; action: KeyAction }>();
  private readonly keysChanged: (() => void)[] = [];
  private readonly keyCbs: ((slot: string, edge: KeyEdge) => void)[] = [];

  /** A key with one of our actions became visible (`willAppear`). */
  appear(kind: KeyKind, ev: WillAppearEvent): void {
    if (!ev.action.isKey()) return;
    const coords = 'coordinates' in ev.payload ? ev.payload.coordinates : undefined;
    this.present.set(ev.action.id, {
      binding: {
        slotId: ev.action.id,
        kind,
        device: ev.action.device.id,
        ...(coords ? { coordinates: { column: coords.column, row: coords.row } } : {}),
      },
      action: ev.action,
    });
    for (const cb of this.keysChanged) cb();
  }

  /** `willDisappear`: page switch, profile switch, key removed. */
  disappear(id: string): void {
    if (!this.present.delete(id)) return;
    for (const cb of this.keysChanged) cb();
  }

  edge(id: string, edge: KeyEdge): void {
    for (const cb of this.keyCbs) cb(id, edge);
  }

  keys(): KeyBinding[] {
    return [...this.present.values()].map((p) => p.binding);
  }
  onKeysChanged(cb: () => void): void {
    this.keysChanged.push(cb);
  }
  async setImage(slotId: string, svg: string): Promise<void> {
    await this.present.get(slotId)?.action.setImage(image(svg));
  }
  async showAlert(slotId: string): Promise<void> {
    await this.present.get(slotId)?.action.showAlert();
  }
  onKey(cb: (slot: string, edge: KeyEdge) => void): void {
    this.keyCbs.push(cb);
  }
  devices(): DeviceInfo[] {
    return [...streamDeck.devices].map((d) => ({
      id: d.id,
      model: String(d.type),
      cols: d.size.columns,
      rows: d.size.rows,
      connected: d.isConnected,
    }));
  }
  // Settings can only be read once connected (awaiting them before connect never settles: exit 13), which is
  // why deck-host creates its controller lazily.
  settings = {
    load: async (): Promise<Record<string, unknown>> =>
      (await streamDeck.settings.getGlobalSettings()) as Record<string, unknown>,
    save: (o: Record<string, unknown>): void =>
      void streamDeck.settings.setGlobalSettings(o as never),
  };
  log(level: 'info' | 'warn', msg: string): void {
    if (level === 'warn') streamDeck.logger.warn(msg);
    else streamDeck.logger.info(msg);
  }
  host(): DeckHostInfo {
    return currentHost();
  }
}
