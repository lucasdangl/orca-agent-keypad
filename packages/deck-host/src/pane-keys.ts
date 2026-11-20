import {
  HoldGestures,
  deckLayout,
  formatKeyNumber,
  keyNumber,
  spinnerAdvances,
  renderKey,
  renderAnswerKey,
  answerKeyLive,
  answerPresses,
  ANSWER_LAYOUT,
  type OtherState,
  type AnswerPad,
  type DeckController,
  type LayoutCell,
  type SlotView,
} from '@orca-agent-deck/core';
import type { DevicePort, KeyBinding, KeyKind } from './port.ts';

const HINT_MS = 3000;

/**
 * The Orca panel, the one place a key is mapped. While it is open for mapping `pick` hands it a tapped key
 * (false: it could not be sent); `open` shows it at a held key's details (false: it could not be opened) or, while
 * the panel is already in view, hides the right sidebar instead ('hidden').
 */
export interface PanelPicker {
  selecting(): boolean;
  pick(key: number): boolean;
  open(key: number): Promise<boolean | 'hidden'>;
}
export const NO_PANEL: PanelPicker = {
  selecting: () => false,
  pick: () => false,
  open: () => Promise.resolve(false),
};

/** Log form of a slot id: Elgato contexts are long hex strings, the first 6 characters tell them apart. */
export const shortSlot = (id: string): string => (id.length > 12 ? id.slice(0, 6) : id);

/** The deck as the Orca panel draws it (the `deckState` frame without its envelope and pane list). */
export interface DeckStateView {
  connected: boolean;
  model: string | null;
  cols: number;
  rows: number;
  keys: { key: number; label: string; state: string; mapped: boolean }[];
  layout: LayoutCell[];
}

/** All Pane keys of the deck. Slot id = `KeyBinding.slotId`; state comes from the shared DeckController. */
export class PaneKeys {
  /** Pane keys on the device now, by slot id. */
  private readonly keys = new Map<string, KeyBinding>();
  /** Formatted key number per key, recomputed when the key appears (never persisted). */
  private readonly numbers = new Map<string, string>();
  /** Raw 1-based key number per key, for pairResult. */
  private readonly indexes = new Map<string, number>();
  /** Set once the controller exists. */
  private ctl: DeckController | undefined;
  private readonly create: () => Promise<DeckController>;
  private ready: Promise<DeckController> | undefined;
  /** Last image sent per key; keys are only updated on change (Mobile runs over Wi-Fi, the Keypad over USB). */
  private readonly sent = new Map<string, string>();
  private readonly views = new Map<string, SlotView>();
  private tick = 0;
  /** Spinner position, advanced by `spinnerAdvances` so a busy deck is not flooded with images. */
  private spin = 0;
  /** A refresh was asked for while one ran; run once more so a press is not shown stale. */
  private again = false;
  /** Short text shown on a key for a moment after a failed hold. */
  private readonly hints = new Map<string, { text: string; until: number }>();
  private readonly gestures: HoldGestures;
  private readonly panel: PanelPicker;
  private readonly port: DevicePort;
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  /** The answer pad while the pane in front in Orca waits for an answer (see `DeckController.answerPad`). */
  private pad: AnswerPad | null = null;
  /** Keys pressed while the pad was up: their key up must not focus a pane. */
  private readonly padPressed = new Set<string>();
  /** The free-text answer of the question on the pad (Other key): off, dictating, typing. */
  private other: OtherState = 'off';
  /** Key presses of pad keys run one after another, in press order. */
  private sending: Promise<void> = Promise.resolve();
  /** Runs after every refresh (the Stream Deck Property Inspector re-sends its pane list from here). */
  onRefreshed: (() => Promise<void>) | null = null;

  /** Brings Orca to the front (the same raise a focus press uses); a no-op where the OS does not allow it. */
  private readonly raise: () => Promise<unknown>;

  constructor(
    port: DevicePort,
    create: () => Promise<DeckController>,
    panel: PanelPicker = NO_PANEL,
    raise: () => Promise<unknown> = () => Promise.resolve(),
    o: { holdMs?: number; timers?: boolean } = {},
  ) {
    this.port = port;
    this.create = create;
    this.panel = panel;
    this.raise = raise;
    this.gestures = new HoldGestures((slot) => void this.onHold(slot), {
      ...(o.holdMs !== undefined ? { holdMs: o.holdMs } : {}),
    });
    if (o.timers === false) return;
    this.timers.push(setInterval(() => void this.refresh(), 2000));
    // Spinner advances an eighth turn per tick, or every other tick with more than 2 working keys.
    // A tick with nothing to animate does not repaint at all; keys that did not change are not re-sent.
    this.timers.push(
      setInterval(() => {
        this.tick++;
        if (this.animating()) void this.repaint();
      }, 250),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }

  /** Is anything on the deck changing with time: a spinner, a hint about to expire? */
  private animating(): boolean {
    if (this.hints.size > 0) return true;
    for (const id of this.keys.keys()) if (this.views.get(id)?.state === 'working') return true;
    return false;
  }

  /** Created on first use (Stream Deck: after the plugin connected, when settings can be read). */
  controller(): Promise<DeckController> {
    return (this.ready ??= this.create().then((c) => (this.ctl = c)));
  }

  /** Address of a key for pairResult: 1-based page (the device apps hide the current page, so 1) and key number. */
  address(slot: string): { page: number; index: number } {
    return { page: 1, index: this.indexes.get(slot) ?? 1 };
  }

  private columnsOf(device: string): number {
    return this.port.devices().find((d) => d.id === device)?.cols ?? 0;
  }

  /** The port's keys changed: pick up new Pane keys (carrying mappings over by position), drop gone ones. */
  async syncKeys(): Promise<void> {
    const now = this.port.keys().filter((k) => k.kind === 'pane');
    const ids = new Set(now.map((k) => k.slotId));
    for (const id of [...this.keys.keys()]) if (!ids.has(id)) this.forget(id);
    const added = now.filter((k) => !this.keys.has(k.slotId));
    for (const k of now) {
      this.keys.set(k.slotId, k);
      // Device apps that do not expose the current page get the key number only.
      if (k.coordinates) {
        const n = keyNumber(k.coordinates, this.columnsOf(k.device));
        this.indexes.set(k.slotId, n);
        this.numbers.set(k.slotId, formatKeyNumber(n));
      }
    }
    // Reinstalling gives keys new ids: carry the mapping over by device and position.
    for (const k of added) {
      if (!k.coordinates) continue;
      const c = await this.controller();
      c.locateSlot(
        k.slotId,
        { device: k.device, column: k.coordinates.column, row: k.coordinates.row },
        new Set(this.keys.keys()),
      );
    }
    if (added.length) await this.refresh();
  }

  private forget(id: string): void {
    this.keys.delete(id);
    this.sent.delete(id);
    this.views.delete(id);
    this.numbers.delete(id);
    this.indexes.delete(id);
  }

  has(slotId: string): boolean {
    return this.keys.has(slotId);
  }

  keyDown(slotId: string): void {
    const spec = this.padKey(slotId);
    if (spec) {
      this.padPressed.add(slotId);
      if (!answerKeyLive(spec, this.pad?.options ?? [])) return;
      // Sent on key down, like a keyboard. Never logs the option's text.
      const { presses, other } = answerPresses(spec.action, this.other);
      const changed = other !== this.other;
      this.other = other;
      this.port.log('info', `answer pad: ${spec.action} -> ${presses.join(' ')}`);
      this.sending = this.sending.then(async () => {
        for (const p of presses) {
          if (typeof p === 'number') await new Promise((r) => setTimeout(r, p));
          else
            await this.port
              .sendKey?.(p)
              .catch((e: unknown) =>
                this.port.log('warn', `answer pad: ${p} not sent: ${String(e)}`),
              );
        }
      });
      if (changed) void this.repaint();
      // The answer changes the agent's state: read Orca again soon so the pad goes away.
      setTimeout(() => void this.refresh(), 400);
      return;
    }
    this.gestures.keyDown(slotId);
  }

  /** The answer pad key on this slot, while the pad is up. */
  private padKey(slotId: string) {
    if (!this.pad || !this.port.sendKey) return undefined;
    const n = this.indexes.get(slotId);
    return n === undefined ? undefined : ANSWER_LAYOUT[n];
  }

  /** A tap focuses; a hold already acted while the key was down. */
  async keyUp(id: string): Promise<void> {
    if (this.padPressed.delete(id)) return;
    if (!this.gestures.keyUp(id)) return;
    const c = await this.controller();
    // With the Orca panel open for mapping a tap selects the key there (its details open).
    const key = this.panel.selecting() ? this.keyOfSlot(id) : null;
    if (key !== null && this.panel.pick(key)) {
      // The panel's details change in Orca: bring it forward, no pane focus change.
      void this.raise().catch(() => {});
      this.port.log(
        'info',
        `press slot=${shortSlot(id)} -> key ${key} opened in the Orca panel, Orca raised`,
      );
      return;
    }
    // A paired-server pane takes over a second to switch: mark the key focused at once so the
    // press is visibly taken. The next refresh shows what Orca really has selected.
    const v = this.views.get(id);
    if (v && v.state !== 'unmapped') {
      this.views.set(id, { ...v, focused: true });
      void this.repaint();
    }
    const t0 = Date.now();
    const r = await c.press(id);
    const host = c.slotHost(id);
    this.port.log(
      'info',
      `press slot=${shortSlot(id)} -> ${r} ${Date.now() - t0}ms${host ? ` (${host === 'local' ? 'local' : host.split(':')[0]})` : ''}`,
    );
    if (r === 'failed') await this.port.showAlert(id);
    void this.refresh();
  }

  /** Hold fires: the Orca panel opens at this key's details (mapping happens there, never from the deck). */
  async onHold(slot: string): Promise<void> {
    const key = this.keyOfSlot(slot);
    const t0 = Date.now();
    const opened = key !== null && (await this.panel.open(key));
    // Only a panel that did open brings Orca forward; a hide leaves Orca where it is.
    if (opened === true) await this.raise().catch(() => {});
    this.port.log(
      'info',
      `hold slot=${shortSlot(slot)} -> ${opened === 'hidden' ? 'sidebar hidden' : opened ? 'panel opened, Orca raised' : 'panel not opened'} ${Date.now() - t0}ms`,
    );
    if (opened) return;
    // Orca closed, the Orca plugin missing or an old Orca: say where else a key is mapped, long enough to read.
    this.hints.set(slot, { text: 'Map in Orca', until: Date.now() + HINT_MS });
    void this.repaint();
  }

  /** Redraw from the last views at once (no Orca round trip). */
  repaintNow(): void {
    void this.repaint();
  }

  /** The slot of a 1-based key number on the deck the Orca panel shows, or null. */
  slotOfKey(key: number): string | null {
    const dev = this.shownDevice();
    for (const k of this.keys.values())
      if (k.device === dev && this.indexes.get(k.slotId) === key) return k.slotId;
    return null;
  }

  /** The key number a slot has on the deck the Orca panel shows, or null. */
  keyOfSlot(slot: string): number | null {
    const k = this.keys.get(slot);
    return k && k.device === this.shownDevice() ? (this.indexes.get(slot) ?? null) : null;
  }

  /** The first connected device that has our Pane keys on it: the one the Orca panel draws. */
  private shownDevice(): string | null {
    const used = new Set([...this.keys.values()].map((k) => k.device));
    for (const d of this.port.devices()) if (d.connected && used.has(d.id)) return d.id;
    return null;
  }

  /** The deck as the Orca panel draws it (the `deckState` frame without its envelope). */
  deckState(): DeckStateView {
    const id = this.shownDevice();
    const dev = this.port.devices().find((d) => d.id === id);
    if (!dev) return { connected: false, model: null, cols: 0, rows: 0, keys: [], layout: [] };
    const keys = [...this.keys.values()]
      .filter((k) => k.device === id && this.indexes.has(k.slotId))
      .map((k) => {
        const v = this.views.get(k.slotId);
        const mapped = !!v && v.state !== 'unmapped';
        return {
          key: this.indexes.get(k.slotId) ?? 0,
          label: mapped ? v.label : '',
          state: v?.state ?? 'unmapped',
          mapped,
        };
      })
      .sort((x, y) => x.key - y.key);
    return {
      connected: true,
      model: dev.model,
      cols: dev.cols,
      rows: dev.rows,
      keys,
      // Our Pane, Status and Attention keys; everything else on the device is `other`.
      layout: deckLayout(
        dev.cols,
        dev.rows,
        this.port
          .keys()
          .filter((k) => k.device === id && !!k.coordinates)
          .map((k) => ({ kind: k.kind as KeyKind, coordinates: k.coordinates! })),
      ),
    };
  }

  /** A push from plugin A arrived: refresh now instead of waiting for the next poll. */
  nudge(): Promise<void> {
    return this.refresh();
  }

  /** Resolves when the refresh that is running, including the one it was asked to repeat, is done. */
  private running: Promise<void> | null = null;

  refresh(): Promise<void> {
    if (this.keys.size === 0) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          const views = await (await this.controller()).refresh([...this.keys.keys()]);
          for (const [id, v] of views) this.views.set(id, v);
          const pad = this.port.sendKey && this.ctl ? this.ctl.answerPad() : null;
          if (!!pad !== !!this.pad)
            this.port.log('info', pad ? 'answer pad up' : 'answer pad down');
          // A new question (or none) starts without a free-text answer.
          if (!pad || pad.paneKey !== this.pad?.paneKey) this.other = 'off';
          this.pad = pad;
          await this.repaint();
          if (this.onRefreshed && this.ctl) await this.onRefreshed();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async repaint(): Promise<void> {
    const now = Date.now();
    let working = 0;
    for (const id of this.keys.keys()) if (this.views.get(id)?.state === 'working') working++;
    if (spinnerAdvances(this.tick, working)) this.spin++;
    await Promise.all(
      [...this.keys.keys()].map(async (id) => {
        const v = this.views.get(id);
        if (!v) return;
        const hint = this.hints.get(id);
        if (hint && hint.until <= now) this.hints.delete(id);
        const shown = hint && hint.until > now && hint.text ? { ...v, label: hint.text } : v;
        const spec = this.padKey(id);
        const svg = spec
          ? renderAnswerKey(spec, this.pad?.options ?? [], { other: this.other })
          : renderKey(
              { ...shown, keyNumber: this.numbers.get(id) },
              { size: 144, spin: this.spin },
            );
        if (this.sent.get(id) === svg) return;
        this.sent.set(id, svg);
        await this.port.setImage(id, svg);
      }),
    );
  }
}
