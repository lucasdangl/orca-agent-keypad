import { renderInfoKey, type DeckController, type InfoModel } from '@orca-agent-deck/core';
import type { DevicePort, KeyKind } from './port.ts';

/** The Status or the Attention keys: show `model()` of the shared controller, redrawn on change. */
export class InfoKeys {
  private readonly sent = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
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
    o: { timers?: boolean } = {},
  ) {
    this.kind = kind;
    this.port = port;
    this.create = create;
    this.model = model;
    this.act = act;
    if (o.timers !== false) this.timer = setInterval(() => void this.repaint(), 1000);
  }

  stop(): void {
    clearInterval(this.timer);
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
    const svg = renderInfoKey(this.model(c), { size: 144 });
    await Promise.all(
      ids.map(async (id) => {
        if (this.sent.get(id) === svg) return;
        this.sent.set(id, svg);
        await this.port.setImage(id, svg);
      }),
    );
  }
}
