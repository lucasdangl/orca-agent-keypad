import {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  type TitleParametersDidChangeEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from '@elgato/streamdeck';
import streamDeck from '@elgato/streamdeck';
import type { DeckController } from '@orca-agent-deck/core';
import { shortSlot, type DeckHost, type KeyKind } from '@orca-agent-deck/deck-host';
import type { ElgatoPort } from '../elgato-port.ts';
import { isCurrentPi, replyToPi } from './pi.ts';

type PluginEvent = Parameters<NonNullable<SingletonAction['onSendToPlugin']>>[0];

interface PiMessage {
  type?: string;
  paneKey?: string | null;
}

/** Common part of our three actions: forward the SDK's key events to the port, keep the key title empty. */
abstract class PortAction extends SingletonAction {
  protected abstract readonly kind: KeyKind;
  protected readonly port: ElgatoPort;
  protected readonly host: DeckHost;

  constructor(port: ElgatoPort, host: DeckHost) {
    super();
    this.port = port;
    this.host = host;
  }

  /** The key image carries the whole label; a title set in the Stream Deck app is wiped at once. */
  override async onTitleParametersDidChange(ev: TitleParametersDidChangeEvent): Promise<void> {
    if (ev.payload.title && ev.action.isKey()) await ev.action.setTitle('');
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    this.port.appear(this.kind, ev);
    // Titles from earlier versions persist in the profile and would be drawn over the image.
    await ev.action.setTitle('');
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.port.disappear(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    this.port.edge(ev.action.id, 'down');
  }

  override onKeyUp(ev: KeyUpEvent): void {
    this.port.edge(ev.action.id, 'up');
  }
}

/** One Pane key per slot; slot id = action context. Its Property Inspector pins, relabels or unmaps. */
@action({ UUID: 'pl.1am.orca-agent-deck.pane' })
export class PaneAction extends PortAction {
  protected readonly kind = 'pane' as const;
  /** The slot whose inspector is open: it gets the pane list again when a refresh changes it. */
  private piOpen: string | null = null;
  private piSent = '';

  constructor(port: ElgatoPort, host: DeckHost) {
    super(port, host);
    host.panes.onRefreshed = async () => {
      if (this.piOpen) await this.replyState(await host.controller(), this.piOpen, false);
    };
  }

  /** The PI asks for its state on load and sends `configure` to pin, relabel or unmap. */
  override async onSendToPlugin(ev: PluginEvent): Promise<void> {
    const c = await this.host.controller();
    const panes = this.host.panes;
    const m = ev.payload as PiMessage;
    if (m.type === 'clear') {
      c.clear(ev.action.id);
      await panes.refresh();
    } else if (m.type === 'configure') {
      // Picking a pane pins it; no pane means back to auto-fill (or just empty while it is off).
      c.configure(ev.action.id, {
        paneKey: m.paneKey ?? null,
      });
      await panes.refresh();
    } else {
      // A `load` can arrive before the first snapshot is in (the app opens the inspector as the plugin starts).
      await panes.refresh();
    }
    const current = isCurrentPi(ev.action.id);
    if (current) this.piOpen = ev.action.id;
    streamDeck.logger.info(
      `pi ${m.type ?? 'load'} slot=${shortSlot(ev.action.id)} -> ${current ? `reply ${c.listPanes().length} panes` : 'not the open inspector, no reply'}`,
    );
    await this.replyState(c, ev.action.id);
  }

  private async replyState(c: DeckController, id: string, force = true): Promise<void> {
    const payload = {
      type: 'state',
      panes: c.listPanes((slot) => this.host.panes.keyOfSlot(slot)),
      config: c.slotConfig(id),
    };
    const sig = JSON.stringify(payload);
    if (!force && sig === this.piSent) return;
    this.piSent = sig;
    await replyToPi(id, payload);
  }

  override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent): Promise<void> {
    this.piOpen = ev.action.id;
    await this.host.panes.refresh();
    await this.onSendToPlugin({ action: ev.action, payload: { type: 'load' } } as never);
  }

  override onPropertyInspectorDidDisappear(ev: { action: { id: string } }): void {
    if (this.piOpen === ev.action.id) this.piOpen = null;
  }
}

/** Worst Setup doctor result, else adapter health. Press = reconnect. Its inspector shows the Setup checks. */
@action({ UUID: 'pl.1am.orca-agent-deck.status' })
export class StatusAction extends PortAction {
  protected readonly kind = 'status' as const;

  /** Setup tab: send every check result to the Property Inspector. */
  override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent): Promise<void> {
    await this.sendChecks(ev.action.id);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<never, never>): Promise<void> {
    await this.sendChecks(ev.action.id);
  }

  private async sendChecks(id: string): Promise<void> {
    // A hidden PI's `load` must not cost a refresh and tmux spawn.
    if (!isCurrentPi(id)) return;
    const c = await this.host.controller();
    await replyToPi(id, { type: 'checks', ...(await this.host.doctor.checks(c)) });
  }
}

/** Number of panes that need you. Press = focus the most urgent, again = next. */
@action({ UUID: 'pl.1am.orca-agent-deck.attention' })
export class AttentionAction extends PortAction {
  protected readonly kind = 'attention' as const;
}
