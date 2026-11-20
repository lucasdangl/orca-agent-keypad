import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { AnswerKeyCode, DeckHostInfo, DeckOs } from '@orca-agent-deck/core';
import type { DeviceInfo, DevicePort, KeyBinding, KeyEdge } from '@orca-agent-deck/deck-host';
import {
  DEVICE_PROTOCOL_VERSION,
  MAX_LINE,
  messageFromLogi,
  type Hello,
  type Keys,
  type MessageToLogi,
} from './protocol.ts';

/** The one device the Logi plugin drives (the plugin service shows us one keypad's worth of slots). */
export const LOGI_DEVICE = 'logi';

/**
 * Fewest milliseconds between two images for the same key. Phase 0 measured 9 keys at 15 fps as smooth and 30 fps
 * as stalling; deck-host's spinner stays at 4 fps, so this only catches bursts.
 */
export const MIN_IMAGE_MS = 100;

const OS: Partial<Record<NodeJS.Platform, DeckOs>> = {
  darwin: 'mac',
  win32: 'windows',
  linux: 'linux',
};

export interface LogiPortOptions {
  input: Readable;
  output: Writable;
  /** Log sink (default: stderr). Never stdout: that is the protocol. */
  logLine?: (line: string) => void;
  minImageMs?: number;
  daemonVersion?: string;
}

/** `DevicePort` over the device protocol (docs/device-protocol.md): NDJSON on stdin/stdout to the Logi C# plugin. */
export class LogiPort implements DevicePort {
  private hello: Hello | null = null;
  private connected = true;
  private rawKeys: Keys['keys'] = [];
  private bindings: KeyBinding[] = [];
  private readonly keysChanged: (() => void)[] = [];
  private readonly keyCbs: ((slot: string, edge: KeyEdge) => void)[] = [];
  private readonly output: Writable;
  private readonly logLine: (line: string) => void;
  private readonly minImageMs: number;
  private readonly daemonVersion: string;
  /** Per key: when the last image went out, and the newest one held back while it was too soon. */
  private readonly lastImage = new Map<string, number>();
  private readonly held = new Map<string, { svg: string; timer: ReturnType<typeof setTimeout> }>();
  private resolveReady!: (h: Hello) => void;
  /** Resolves with the first `hello`. */
  readonly ready: Promise<Hello> = new Promise((r) => (this.resolveReady = r));
  private resolveClosed!: () => void;
  /** Resolves when Logi closes our stdin (the plugin unloads or the plugin service quits). */
  readonly closed: Promise<void> = new Promise((r) => (this.resolveClosed = r));

  constructor(o: LogiPortOptions) {
    this.output = o.output;
    this.logLine = o.logLine ?? ((l) => process.stderr.write(`${l}\n`));
    this.minImageMs = o.minImageMs ?? MIN_IMAGE_MS;
    this.daemonVersion = o.daemonVersion ?? '0.0.0';
    // Logi went away while we wrote (EPIPE): the same as a closed stdin.
    o.output.on('error', () => this.resolveClosed());
    const rl = createInterface({ input: o.input, crlfDelay: Infinity });
    rl.on('line', (line) => this.receive(line));
    rl.on('close', () => {
      for (const h of this.held.values()) clearTimeout(h.timer);
      this.held.clear();
      this.resolveClosed();
    });
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    if (line.length > MAX_LINE)
      return this.log('warn', `device message over ${MAX_LINE} bytes ignored`);
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return this.log('warn', 'device message is not JSON, ignored');
    }
    const v = (raw as { v?: unknown } | null)?.v;
    if (v !== DEVICE_PROTOCOL_VERSION)
      return this.log(
        'warn',
        `device protocol v${String(v)} not supported (v${DEVICE_PROTOCOL_VERSION}), ignored`,
      );
    const parsed = messageFromLogi.safeParse(raw);
    // Never the content: type only.
    if (!parsed.success) {
      const type = (raw as { type?: unknown }).type;
      return this.log(
        'warn',
        `malformed device message ignored (type ${typeof type === 'string' ? type.slice(0, 32) : '?'})`,
      );
    }
    const m = parsed.data;
    switch (m.type) {
      case 'hello': {
        const first = this.hello === null;
        this.hello = m;
        this.log(
          'info',
          `device: ${m.device.model} ${m.device.cols}x${m.device.rows}, image ${m.imageSize}px, plugin ${m.pluginVersion}`,
        );
        this.send({ v: 1, type: 'ready', daemonVersion: this.daemonVersion });
        if (first) this.resolveReady(m);
        // A second hello (the plugin reloaded without restarting us) may bring another grid.
        else this.applyKeys();
        return;
      }
      case 'keys':
        this.rawKeys = m.keys;
        return this.applyKeys();
      case 'key':
        for (const cb of this.keyCbs) cb(m.slotId, m.edge);
        return;
      case 'deviceState':
        if (m.connected === this.connected) return;
        this.connected = m.connected;
        this.log('info', `device ${m.connected ? 'connected' : 'disconnected'}`);
        // deck-host reads `devices()` when it reports the deck; a key refresh picks it up at once.
        for (const cb of this.keysChanged) cb();
        return;
    }
  }

  /** Bindings with positions: key number n sits at column (n-1) % cols, row (n-1) / cols of the hello's grid. */
  private applyKeys(): void {
    const cols = this.hello?.device.cols ?? 0;
    const rows = this.hello?.device.rows ?? 0;
    this.bindings = this.rawKeys.map((k) => {
      const b: KeyBinding = { slotId: k.slotId, kind: k.kind, device: LOGI_DEVICE };
      if (k.index !== undefined && cols > 0 && k.index <= cols * rows)
        b.coordinates = { column: (k.index - 1) % cols, row: Math.floor((k.index - 1) / cols) };
      return b;
    });
    for (const cb of this.keysChanged) cb();
  }

  private send(m: MessageToLogi): void {
    this.output.write(`${JSON.stringify(m)}\n`);
  }

  keys(): KeyBinding[] {
    return this.bindings;
  }
  onKeysChanged(cb: () => void): void {
    this.keysChanged.push(cb);
  }

  async setImage(slotId: string, svg: string): Promise<void> {
    const held = this.held.get(slotId);
    if (held) {
      // A newer image replaces the held one; it goes out when the held one would have.
      held.svg = svg;
      return;
    }
    const wait = (this.lastImage.get(slotId) ?? -Infinity) + this.minImageMs - Date.now();
    if (wait <= 0) return this.sendImage(slotId, svg);
    const timer = setTimeout(() => {
      const h = this.held.get(slotId);
      this.held.delete(slotId);
      if (h) this.sendImage(slotId, h.svg);
    }, wait);
    timer.unref?.();
    this.held.set(slotId, { svg, timer });
  }

  private sendImage(slotId: string, svg: string): void {
    this.lastImage.set(slotId, Date.now());
    this.send({ v: 1, type: 'image', slotId, svg });
  }

  async showAlert(slotId: string): Promise<void> {
    this.send({ v: 1, type: 'alert', slotId });
  }
  async sendKey(code: AnswerKeyCode): Promise<void> {
    this.send({ v: 1, type: 'sendKey', key: code });
  }
  onKey(cb: (slot: string, edge: KeyEdge) => void): void {
    this.keyCbs.push(cb);
  }
  devices(): DeviceInfo[] {
    const h = this.hello;
    if (!h) return [];
    return [
      {
        id: LOGI_DEVICE,
        model: h.device.model,
        cols: h.device.cols,
        rows: h.device.rows,
        connected: this.connected,
      },
    ];
  }
  settings = {
    // The plugin sends its stored copy in `hello`; deck-host only asks once the first keys are there.
    load: async (): Promise<Record<string, unknown>> =>
      structuredClone((await this.ready).settings),
    save: (o: Record<string, unknown>): void =>
      this.send({ v: 1, type: 'saveSettings', settings: o }),
  };
  log(level: 'info' | 'warn', msg: string): void {
    this.logLine(`${new Date().toISOString()} ${level.toUpperCase()} ${msg}`);
  }
  host(): DeckHostInfo {
    return {
      os: OS[process.platform] ?? 'other',
      host: 'logi',
      version: this.hello?.pluginVersion ?? '?',
      basis: 'device-app',
    };
  }
}
