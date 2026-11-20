import { randomUUID } from 'node:crypto';
import {
  MappingStore,
  DeckController,
  attentionBlinks,
  attentionInfo,
  workingInfo,
  statusInfo,
  type SlotSettings,
} from '@orca-agent-deck/core';
import { makeExec, type Exec } from '@orca-agent-deck/adapter-cli';
import {
  RuntimeClient,
  RuntimeUnavailableError,
  createRuntimeAdapter,
  openPluginPanel,
} from '@orca-agent-deck/adapter-runtime';
import { BridgedAdapter } from '@orca-agent-deck/adapter-bridge';
import { makeRaiser } from '@orca-agent-deck/window-raiser';
import { watchHost } from './host-watch.ts';
import { FileSlotStorage, defaultMappingsPath } from './mapping-file.ts';
import { DeckBridge } from './bridge.ts';
import { Doctor } from './doctor-facts.ts';
import { InfoKeys } from './info-keys.ts';
import { PaneKeys } from './pane-keys.ts';
import type { DevicePort } from './port.ts';

type Slots = Record<string, SlotSettings>;

/** The Orca panel of plugin A (`orca-plugin.json`). */
const PANEL_ID = 'deck';
/** A hidden panel cannot say so, so its `panelSelect` lapses unless A renews it (A does, every second, while in view). */
const PANEL_SELECT_TTL_MS = 2500;
/** How long a hold waits for A before it just shows the panel. */
const HOLD_WAIT_MS = 1500;

export interface DeckHostOptions {
  /** Orca runtime file (default: Orca's `orca-runtime.json`). */
  runtimeMetaPath?: string;
  /** Orca's environments file, only its mtime is read (default: next to the runtime file). */
  environmentsFile?: string;
  /** `orca` CLI: the degraded fallback and the plugin install probe. */
  exec?: Exec;
  /** Brings Orca to the front (default: `open -b` on macOS). */
  raise?: () => Promise<unknown>;
  /** Mappings file (default `~/.orca-deck/mappings.json`). */
  mappingsPath?: string;
  /** Bridge discovery file and ports (default `~/.orca-deck/bridge.json`, 47800-47809). */
  bridge?: { discoveryPath?: string; ports?: readonly number[] };
  /** Hold delay (default 1 s). */
  holdMs?: number;
  /** Polling and repaint timers (default on; tests drive refreshes themselves). */
  timers?: boolean;
}

/**
 * Plugin B without a device app: the Orca adapters, the bridge to plugin A, the mapping store and the deck logic,
 * wired to one `DevicePort`. Call `start()` once the port can answer (Stream Deck: after `connect()`).
 */
export class DeckHost {
  readonly port: DevicePort;
  readonly bridge: DeckBridge;
  readonly panes: PaneKeys;
  readonly status: InfoKeys;
  readonly attention: InfoKeys;
  readonly working: InfoKeys;
  readonly doctor: Doctor;
  readonly runtime: RuntimeClient;
  private readonly o: DeckHostOptions;
  private readonly exec: Exec;
  private readonly raise: () => Promise<unknown>;
  private shared: Promise<DeckController> | undefined;
  /** A's `panelSelect`: the Orca panel is in view and open for mapping, so a tap on a key selects it there. */
  private panelSelecting = false;
  private panelSelectAt = 0;
  /** Holds waiting for A's `holdResult`, by request id. */
  private readonly holdWaits = new Map<string, (action: 'hidden' | 'show') => void>();
  /** Last `deckState` sent, so an unchanged deck is not sent again. */
  private lastDeck = '';
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private stopWatch: (() => void) | undefined;

  constructor(port: DevicePort, o: DeckHostOptions = {}) {
    this.port = port;
    this.o = o;
    this.exec = o.exec ?? makeExec();
    this.runtime = new RuntimeClient(o.runtimeMetaPath ? { metaPath: o.runtimeMetaPath } : {});
    const raiser = o.raise ? null : makeRaiser();
    this.raise =
      o.raise ??
      (async () => {
        const r = await raiser!.raise();
        port.log('info', `raise ok=${r.ok} ms=${r.ms}${r.error ? ` error=${r.error}` : ''}`);
      });
    this.bridge = new DeckBridge({
      log: (l, m) => port.log(l, m),
      exec: this.exec,
      ...o.bridge,
      deck: () => {
        const live = port.devices().filter((d) => d.connected);
        return {
          connected: live.length > 0,
          devices: live.map((d) => ({ model: d.model, keys: d.cols * d.rows })),
        };
      },
    });
    this.doctor = new Doctor(this.bridge, () => port.host());
    const timers = o.timers === false ? { timers: false } : {};
    this.panes = new PaneKeys(
      port,
      () => this.controller(),
      {
        // Only an A of minor 3 sends `panelSelect`, so one that did reads `keyPicked`.
        selecting: () =>
          this.panelSelecting && Date.now() - this.panelSelectAt < PANEL_SELECT_TTL_MS,
        pick: (key) => this.bridge.server.send({ v: 1, type: 'keyPicked', key }),
        // A held key: with the panel in view A hides the right sidebar; else show the panel (Orca's `plugins.open`),
        // then tell it which key's details to open.
        open: async (key) =>
          (await this.askHold(key)) === 'hidden' ? 'hidden' : this.showPanel(key),
      },
      this.raise,
      { ...(o.holdMs !== undefined ? { holdMs: o.holdMs } : {}), ...timers },
    );
    this.status = new InfoKeys(
      'status',
      port,
      () => this.controller(),
      (c) => this.doctor.statusModel(c),
      async (c) => {
        // Press = reconnect (refresh now).
        await c.refresh([]);
        return 'ok';
      },
      timers,
    );
    this.attention = new InfoKeys(
      'attention',
      port,
      () => this.controller(),
      (c) => {
        const ov = c.overview();
        // A page may have no Status key: a failed setup check (Orca off or too old) takes over this one.
        if (ov.mode === 'down' || ov.unsupported || ov.badResponse) return statusInfo(ov);
        return attentionInfo(ov.urgent, ov.topState, ov.offDeck);
      },
      // Number of panes that need you. Press = focus the most urgent, again = next. Blinks while one does.
      async (c) => ((await c.pressAttention()) === 'failed' ? 'failed' : 'ok'),
      { ...timers, blink: attentionBlinks },
    );
    this.working = new InfoKeys(
      'working',
      port,
      () => this.controller(),
      (c) => {
        const ov = c.overview();
        if (ov.mode === 'down' || ov.unsupported || ov.badResponse) return statusInfo(ov);
        return workingInfo(ov.working);
      },
      // Number of agents working. Press = focus the one working longest, again = next.
      async (c) => ((await c.pressWorking()) === 'failed' ? 'failed' : 'ok'),
      timers,
    );
    port.onKeysChanged(() => {
      void this.panes.syncKeys().catch(this.logFailure('key update'));
      void this.status.syncKeys().catch(this.logFailure('key update'));
      void this.attention.syncKeys().catch(this.logFailure('key update'));
      void this.working.syncKeys().catch(this.logFailure('key update'));
    });
    port.onKey((slot, edge) => {
      const kind = port.keys().find((k) => k.slotId === slot)?.kind;
      if (kind === 'pane') {
        if (edge === 'down') this.panes.keyDown(slot);
        else void this.panes.keyUp(slot).catch(this.logFailure('press'));
      } else if (kind && edge === 'down') {
        void { status: this.status, attention: this.attention, working: this.working }[kind]
          .press(slot)
          .catch(this.logFailure('press'));
      }
    });
    this.wireBridge();
    if (o.timers !== false)
      this.timers.push(
        setInterval(() => void this.pushDeck().catch(this.logFailure('deck push')), 1000),
      );
  }

  /** Only a message: an error here may carry runtime text, and a failed push must never take the plugin down. */
  private logFailure =
    (what: string) =>
    (e: unknown): void =>
      this.port.log('warn', `${what} failed: ${e instanceof Error ? e.name : 'error'}`);

  /** One controller shared by all keys, created on first use (the port's settings must be readable by then). */
  controller(): Promise<DeckController> {
    return (this.shared ??= this.createController());
  }

  // Slot mappings live in ~/.orca-deck/mappings.json; the device app's settings are only a cache and the
  // migration source (first run, damaged file).
  private async createController(): Promise<DeckController> {
    const port = this.port;
    const globals = (await port.settings.load()) as {
      slots?: Slots;
      hostAliases?: Record<string, string>;
    };
    let cache: Slots = globals.slots ?? {};
    const store = new MappingStore(
      new FileSlotStorage(
        this.o.mappingsPath ?? defaultMappingsPath(),
        {
          load: () => structuredClone(cache),
          save: (slots) => {
            cache = structuredClone(slots);
            port.settings.save({ slots: cache });
          },
        },
        (m) => port.log('info', m),
      ),
    );
    for (const d of store.dedupedOnLoad)
      port.log(
        'info',
        `mappings: pane ${d.paneKey} was on ${d.removed.length + 1} keys, kept the newest (${d.removed.length} cleared)`,
      );
    // Steady state reads the runtime socket (no process spawns); the CLI is the degraded fallback.
    const orca = createRuntimeAdapter({
      client: this.runtime,
      fallback: this.exec,
      ...(this.o.environmentsFile ? { environmentsFile: this.o.environmentsFile } : {}),
      onFallback: (r) => port.log('warn', `runtime socket unusable, using CLI: ${r}`),
      onRecover: () => port.log('info', 'runtime socket back, CLI fallback off'),
    });
    // Windows does not let the plugin raise Orca; Orca's reveal raises its own window.
    orca.revealLocal = process.platform === 'win32';
    orca.diag = (m) => port.log('info', m);
    const deck = new DeckController(
      new BridgedAdapter(orca, this.bridge.feed),
      store,
      this.raise,
      // Off for 0.1.0: it did not fill keys on a second machine. Keys show pinned panes only.
      { autofill: false },
    );
    deck.diag = (m) => port.log('info', m);
    // Answers to the Orca panel's key clicks (`assignKey`, `unmapKey`) go back over the bridge.
    deck.onPairingResult = (r) => {
      this.bridge.server.send({
        v: 1,
        type: 'pairResult',
        requestId: r.requestId,
        ...(r.ok
          ? { ok: true as const, slot: this.panes.address(r.slot), action: r.action }
          : { ok: false as const, reason: r.reason }),
      });
      // The Orca panel shows the result: tell it the keys as they are now, not a second later.
      void this.panes
        .nudge()
        .then(() => this.pushDeck(true))
        .catch(this.logFailure('deck push after a pairing result'));
    };
    // Short host names for the badge: setting `hostAliases` = { "ssh:build-1": "build" }.
    deck.hostAliases = globals.hostAliases ?? {};
    return deck;
  }

  /** Asks A (minor 5) what a hold does: it hides the right sidebar while the panel is in view. 'show' when A cannot say. */
  private askHold(key: number): Promise<'hidden' | 'show'> {
    if ((this.bridge.server.connection?.minor ?? 0) < 5) return Promise.resolve('show');
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const done = (action: 'hidden' | 'show') => {
        clearTimeout(timer);
        this.holdWaits.delete(requestId);
        resolve(action);
      };
      const timer = setTimeout(() => done('show'), HOLD_WAIT_MS);
      this.holdWaits.set(requestId, done);
      if (!this.bridge.server.send({ v: 1, type: 'holdKey', requestId, key })) done('show');
    });
  }

  /** Shows the Orca panel (Orca's `plugins.open`), then tells it which key's details to open. */
  private showPanel(key: number): Promise<boolean> {
    return openPluginPanel(this.runtime, PANEL_ID)
      .then(() => {
        const sent = this.bridge.server.send({ v: 1, type: 'keyPicked', key });
        // The panel is shown, but the Orca plugin's worker is not connected to say which key to open.
        if (!sent)
          this.port.log('warn', 'open panel: unavailable (the Orca plugin is not connected)');
        return sent;
      })
      .catch((e: unknown) => {
        this.port.log(
          'warn',
          `open panel: ${e instanceof RuntimeUnavailableError ? 'unavailable' : 'refused'}`,
        );
        return false;
      });
  }

  /** Tells A (the Orca panel) how the deck looks, when it changed or `force`d. Only an A that knows the frame gets it. */
  async pushDeck(force = false): Promise<void> {
    if ((this.bridge.server.connection?.minor ?? 0) < 1) return;
    const c = await this.controller();
    const state = {
      ...this.panes.deckState(),
      panes: c.panelPanes((slot) => this.panes.keyOfSlot(slot)),
    };
    const sig = JSON.stringify(state);
    if (!force && sig === this.lastDeck) return;
    if (this.bridge.server.send({ v: 1, type: 'deckState', ...state })) this.lastDeck = sig;
  }

  private wireBridge(): void {
    const server = this.bridge.server;
    const fail = this.logFailure;
    server.on('hello', () => {
      this.panelSelecting = false;
      void this.pushDeck(true).catch(fail('deck push'));
    });
    // A worker that went away cannot clear it: the deck presses go back to focusing.
    server.on('disconnect', () => (this.panelSelecting = false));
    server.on('message', (m) => {
      if (m.type === 'requestDeck') return void this.pushDeck(true).catch(fail('deck push'));
      if (m.type === 'holdResult') return void this.holdWaits.get(m.requestId)?.(m.action);
      if (m.type === 'panelSelect') {
        this.panelSelecting = m.on;
        this.panelSelectAt = Date.now();
        return;
      }
      if (m.type === 'openPanel') {
        const { requestId } = m;
        // Never terminal text: the runtime's error is reduced to who could not answer.
        void openPluginPanel(this.runtime, m.panelId)
          .then(() => ({ ok: true as const }))
          .catch((e: unknown) => {
            const reason: 'unavailable' | 'refused' =
              e instanceof RuntimeUnavailableError ? 'unavailable' : 'refused';
            this.port.log('warn', `open panel: ${reason}`);
            return { ok: false as const, reason };
          })
          .then((r) => server.send({ v: 1, type: 'openPanelResult', requestId, ...r }));
        return;
      }
      if (m.type !== 'assignKey' && m.type !== 'unmapKey') return;
      void (async () => {
        const c = await this.controller();
        // Clicks in the Orca panel: B checks the key exists on the deck it shows, never A.
        if (m.type === 'assignKey')
          return c.assignFocusedTo(
            m.requestId,
            this.panes.slotOfKey(m.key),
            m.replace,
            this.port.devices().some((d) => d.connected),
            m.paneKey ?? null,
            m.hostId ?? null,
          );
        c.unmapSlot(m.requestId, this.panes.slotOfKey(m.key));
        return this.panes.nudge();
      })().catch(fail('bridge request'));
    });
    this.bridge.feed.onChange(() => void this.panes.nudge().catch(fail('key refresh')));
  }

  /**
   * Starts the bridge and, with `parent`, exits the process once the device app that spawned it is gone (the
   * device apps do not report a closed connection reliably; a plugin whose host quit would stay as an orphan that
   * still owns a bridge port, and A would keep talking to it).
   */
  async start(o: { parent?: number; onGone?: (why: string) => void } = {}): Promise<void> {
    const h = this.port.host();
    this.port.log(
      'info',
      `host: ${h.host} (${h.basis}), app ${h.version}, os ${h.os}, node ${process.version}`,
    );
    await this.bridge.start();
    if (o.parent !== undefined)
      this.stopWatch = watchHost({
        parent: o.parent,
        onGone: (why) => {
          if (o.onGone) return o.onGone(why);
          this.port.log('info', `device app gone (${why}), exiting`);
          void this.stop().finally(() => process.exit(0));
        },
      });
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.panes.stop();
    this.status.stop();
    this.attention.stop();
    this.working.stop();
    this.stopWatch?.();
    await this.bridge.stop();
  }
}
