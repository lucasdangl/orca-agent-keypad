import {
  decodeKey,
  type AnswerKeyCode,
  type DeckHostInfo,
  type DecodedKey,
} from '@orca-agent-deck/core';
import type { DeviceInfo, DevicePort, KeyBinding, KeyEdge } from './port.ts';

/**
 * A `DevicePort` in memory: tests (and simulators) put keys on it, press them and read back what deck-host drew.
 * Default device: a 3 x 3 keypad with id `fake`.
 */
export class FakePort implements DevicePort {
  private bindings: KeyBinding[] = [];
  private devs: DeviceInfo[];
  private keysChanged: (() => void)[] = [];
  private keyCbs: ((slot: string, edge: KeyEdge) => void)[] = [];
  /** Last image per slot. */
  readonly images = new Map<string, string>();
  readonly alerts: string[] = [];
  /** Key presses sent by the answer pad. */
  readonly sentKeys: AnswerKeyCode[] = [];
  readonly logs: string[] = [];
  stored: Record<string, unknown>;

  constructor(
    o: { devices?: DeviceInfo[]; settings?: Record<string, unknown>; quiet?: boolean } = {},
  ) {
    this.devs = o.devices ?? [
      { id: 'fake', model: 'Fake Keypad', cols: 3, rows: 3, connected: true },
    ];
    this.stored = o.settings ?? {};
    this.quiet = o.quiet ?? true;
  }
  private readonly quiet: boolean;

  /** Puts keys on the device (replacing the current set) and tells deck-host. */
  setKeys(keys: KeyBinding[]): void {
    this.bindings = keys;
    for (const cb of this.keysChanged) cb();
  }

  /** Pane keys 1..n on device `fake`, row-major on its grid, slot ids `fake:slot-<n>`. */
  paneKeys(n: number, device = this.devs[0]!): KeyBinding[] {
    return Array.from({ length: n }, (_, i) => ({
      slotId: `${device.id}:slot-${i + 1}`,
      kind: 'pane' as const,
      device: device.id,
      coordinates: { column: i % device.cols, row: Math.floor(i / device.cols) },
    }));
  }

  key(slot: string, edge: KeyEdge): void {
    for (const cb of this.keyCbs) cb(slot, edge);
  }

  /** What deck-host drew on a key, read back from the markers `renderKey` puts into the SVG. */
  shown(slot: string): DecodedKey | null {
    const svg = this.images.get(slot);
    return svg ? decodeKey(svg) : null;
  }

  setDevices(devices: DeviceInfo[]): void {
    this.devs = devices;
  }

  keys(): KeyBinding[] {
    return this.bindings;
  }
  onKeysChanged(cb: () => void): void {
    this.keysChanged.push(cb);
  }
  async setImage(slotId: string, svg: string): Promise<void> {
    this.images.set(slotId, svg);
  }
  async showAlert(slotId: string): Promise<void> {
    this.alerts.push(slotId);
  }
  async sendKey(code: AnswerKeyCode): Promise<void> {
    this.sentKeys.push(code);
  }
  onKey(cb: (slot: string, edge: KeyEdge) => void): void {
    this.keyCbs.push(cb);
  }
  devices(): DeviceInfo[] {
    return this.devs;
  }
  settings = {
    load: async (): Promise<Record<string, unknown>> => structuredClone(this.stored),
    save: (o: Record<string, unknown>): void => {
      this.stored = structuredClone(o);
    },
  };
  log(level: 'info' | 'warn', msg: string): void {
    this.logs.push(`${level} ${msg}`);
    if (!this.quiet) console.log(`[${level}] ${msg}`);
  }
  host(): DeckHostInfo {
    return { os: 'mac', host: 'unknown', version: 'fake', basis: 'none' };
  }
}
