import {
  BridgeServer,
  BridgeStatusFeed,
  PluginInstallProbe,
  portsFromEnv,
  type DeckInfo,
} from '@orca-agent-deck/adapter-bridge';
import { makeExec, type Exec } from '@orca-agent-deck/adapter-cli';

/** `asleep` = A connected earlier and Orca idled its worker (normal). `missing` = never connected. */
export type OrcaPluginState = 'connected' | 'asleep' | 'missing' | 'outdated';

/** An outdated A retries every 30 s at most; one missed retry still counts. */
const OUTDATED_MS = 90_000;

export interface DeckBridgeOptions {
  deck: () => DeckInfo;
  log: (level: 'info' | 'warn', msg: string) => void;
  /** Discovery file (default `~/.orca-deck/bridge.json`). */
  discoveryPath?: string;
  /** Candidate ports; default `ORCA_DECK_BRIDGE_PORTS` or 47800-47809. */
  ports?: readonly number[];
  /** CLI for the plugin install probe. */
  exec?: Exec;
}

/** The bridge server towards plugin A, plus what the Setup doctor asks about it. */
export class DeckBridge {
  readonly server: BridgeServer;
  readonly feed: BridgeStatusFeed;
  private started = false;
  private readonly probe: PluginInstallProbe;
  private readonly log: DeckBridgeOptions['log'];

  constructor(o: DeckBridgeOptions) {
    this.log = o.log;
    // `ORCA_DECK_BRIDGE_PORTS` replaces the default port range (see `portsFromEnv`); the replay suite uses it so test
    // instances never share a port with a running Agent Deck for Orca. A finds B through the discovery file only.
    let ports = o.ports;
    if (!ports) {
      const env = portsFromEnv(process.env.ORCA_DECK_BRIDGE_PORTS);
      if (env.bad)
        o.log('warn', 'ORCA_DECK_BRIDGE_PORTS is not a list of ports, using the default range');
      ports = env.ports;
    }
    this.server = new BridgeServer({
      ...(ports ? { ports } : {}),
      ...(o.discoveryPath ? { discoveryPath: o.discoveryPath } : {}),
      deck: o.deck,
      // Metadata only; the bridge never logs tokens or terminal content.
      log: (m) => o.log('info', m),
    });
    // Created up front so the adapter can read the feed before (or without) the server starting.
    this.feed = new BridgeStatusFeed(this.server);
    // Orca starts A's worker on the first event, so before that "never connected" is not "missing":
    // ask Orca whether the plugin is installed (rarely, the CLI spawn is only for the Setup doctor).
    const exec = o.exec ?? makeExec();
    this.probe = new PluginInstallProbe((args) => exec(args));
  }

  /** Starts the bridge once. A failure here must never take the deck down (B works without A). */
  async start(): Promise<void> {
    if (this.started) return;
    try {
      await this.server.start();
      this.started = true;
    } catch (e) {
      this.log('warn', `bridge not started: ${String(e)}`);
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.server.stop();
  }

  /** Forces a fresh install probe and waits for it (the Setup tab's "Check again"). */
  refreshInstalled(): Promise<void> {
    return this.probe.refresh(true);
  }

  orcaPluginState(): OrcaPluginState | null {
    if (!this.started) return null;
    if (this.feed.connected) return 'connected';
    // An older Orca plugin keeps retrying with the old hello: it never gets in until it is updated.
    if (this.server.outdatedPeerAt && Date.now() - this.server.outdatedPeerAt < OUTDATED_MS)
      return 'outdated';
    if (this.feed.hasBridge) return 'asleep';
    void this.probe.refresh();
    // Unanswered probe: unknown, not missing.
    if (this.probe.installed === null) return null;
    return this.probe.installed ? 'asleep' : 'missing';
  }

  orcaPluginVersion(): string | null {
    return this.server.connection?.pluginVersion ?? null;
  }
}
