import { renderInfoKey, type DeckController, type InfoModel } from '@orca-agent-deck/core';
import type { DevicePort, KeyKind } from './port.ts';

/** Half a blink period: the key is bright this long, then dark this long. */
export const BLINK_MS = 500;

/**
 * The Status, Attention or Working keys: show `model()` of the shared controller, redrawn on change. A key whose
 * content `blink` says asks for the user alternates between its colour and a dark phase every `BLINK_MS`.
 */
export class InfoKeys {
  private readonly sent = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private blinkTimer: ReturnType<typeof setInterval> | undefined;
  /** The content of the last repaint: the blink redraws it without asking Orca again. */
  private last: InfoModel | null = null;
  /** True in the dark phase of a blink. */
  private dark = false;
  private readonly blink: (m: InfoModel) => boolean;
  readonly kind: Exclude<KeyKind, 'pane'>;
  private readonly port: DevicePort;
  private readonly create: () => Promise<DeckController>;
  private readonly model: (c: DeckController) => InfoModel;
  private readonly act: (c: DeckController) => Promise<'ok' | 'failed'>;

  constructor(
    kind: Exclude<KeyKind, 'pane'>,
    port: DevicePort,
    create: () => Promise<DeckController>,
    model: (c: DeckController) => InfoModel,
    act: (c: DeckController) => Promise<'ok' | 'failed'>,
    o: { timers?: boolean; blink?: (m: InfoModel) => boolean } = {},
  ) {
    this.kind = kind;
    this.port = port;
    this.create = create;
    this.model = model;
    this.act = act;
    this.blink = o.blink ?? (() => false);
    if (o.timers !== false) {
      this.timer = setInterval(() => void this.repaint(), 1000);
      if (o.blink) this.blinkTimer = setInterval(() => void this.blinkTick(), BLINK_MS);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.blinkTimer);
  }

  /** One blink step: flips the phase of a blinking key and redraws it from the last content. */
  async blinkTick(): Promise<void> {
    if (!this.last || !this.blink(this.last)) {
      this.dark = false;
      return;
    }
    this.dark = !this.dark;
    await this.paint(this.last);
  }

  private slots(): string[] {
    return this.port
      .keys()
      .filter((k) => k.kind === this.kind)
      .map((k) => k.slotId);
  }

  /** The port's keys changed: forget gone keys (a key that comes back is drawn again), draw new ones. */
  async syncKeys(): Promise<void> {
    const ids = new Set(this.slots());
    for (const id of [...this.sent.keys()]) if (!ids.has(id)) this.sent.delete(id);
    await this.repaint();
  }

  /** Acts on key down, as the Stream Deck plugin always did. */
  async press(slotId: string): Promise<void> {
    const c = await this.create();
    if ((await this.act(c)) === 'failed') await this.port.showAlert(slotId);
  }

  async repaint(): Promise<void> {
    const ids = this.slots();
    if (ids.length === 0) return;
    const c = await this.create();
    await c.refresh([]);
    this.last = this.model(c);
    if (!this.blink(this.last)) this.dark = false;
    await this.paint(this.last);
  }

  private async paint(m: InfoModel): Promise<void> {
    const ids = this.slots();
    const svg = renderInfoKey(m, { size: 144, blinkOff: this.dark });
    await Promise.all(
      ids.map(async (id) => {
        if (this.sent.get(id) === svg) return;
        this.sent.set(id, svg);
        await this.port.setImage(id, svg);
      }),
    );
  }
}
