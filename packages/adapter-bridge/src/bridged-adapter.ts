import type {
  AdapterHealth,
  AgentRawState,
  FocusResult,
  HostInfo,
  OrcaAdapter,
  PaneRef,
  PaneStatusEvent,
  Snapshot,
} from '@orca-agent-deck/core';
import type { BridgeServer } from './server.ts';

const RAW_STATES = new Set<AgentRawState>(['working', 'waiting', 'blocked', 'done', 'idle']);

/** A pushed status plus when B received it (B's clock; `stateStartedAt` may be a remote host's). */
export type PushedStatus = PaneStatusEvent & { arrivedAt: number };

/**
 * Latest agent status per pane as pushed by plugin A. Status events are idempotent: a message
 * older than what is stored never replaces it, so the replay A sends after every reconnect cannot
 * move a pane backwards. A repeat of the stored status keeps its first arrival time, and an
 * expired status is never taken back from a replay.
 *
 * "Older" is decided by `receivedAt` (when Orca delivered the event, all on A's clock), and only
 * between messages delivered at the same time by `stateStartedAt`. `stateStartedAt` alone is not an
 * order: when an agent goes back from `waiting` to `working` in the same turn, Orca reports the
 * turn's start again, which is older than the `waiting` (seen with Orca's agent chats; the key
 * then stayed on "needs you" for the rest of the turn).
 */
/** Where a pushed status stands among the pane's others: delivery time first, then the state's start. */
interface Order {
  receivedAt: number;
  stateStartedAt: number;
}

const compare = (a: Order, b: Order): number =>
  a.receivedAt - b.receivedAt || a.stateStartedAt - b.stateStartedAt;

export class BridgeStatusFeed {
  private readonly byPane = new Map<string, PushedStatus>();
  /** paneKey -> order of the stored status (see `newer`). */
  private readonly order = new Map<string, Order>();
  /** paneKey -> order of a status the poll showed was dropped by Orca. */
  private readonly expired = new Map<string, Order>();
  private seenA = false;
  private readonly listeners = new Set<() => void>();
  private readonly bridge: BridgeServer;
  private readonly now: () => number;

  constructor(bridge: BridgeServer, now: () => number = Date.now) {
    this.bridge = bridge;
    this.now = now;
    bridge.on('hello', () => {
      this.seenA = true;
      this.notify();
    });
    bridge.on('disconnect', () => this.notify());
    bridge.on('message', (m) => {
      if (m.type !== 'agentStatus') return;
      if (!RAW_STATES.has(m.state as AgentRawState)) return;
      const at: Order = { receivedAt: m.receivedAt, stateStartedAt: m.stateStartedAt };
      const dead = this.expired.get(m.paneKey);
      if (dead !== undefined && compare(at, dead) <= 0) return;
      const prev = this.byPane.get(m.paneKey);
      const prevAt = this.order.get(m.paneKey);
      if (prev && prevAt) {
        const c = compare(at, prevAt);
        if (c < 0) return;
        if (prev.state === m.state && prev.stateStartedAt === m.stateStartedAt) {
          // A repeat (Orca delivers a transition 2-3 times): keep the first arrival time.
          if (c > 0) this.order.set(m.paneKey, at);
          return;
        }
      }
      this.order.set(m.paneKey, at);
      this.byPane.set(m.paneKey, {
        paneKey: m.paneKey,
        state: m.state as AgentRawState,
        outcome: m.outcome ?? null,
        stateStartedAt: m.stateStartedAt,
        agentType: m.agentType ?? null,
        arrivedAt: this.now(),
      });
      this.notify();
    });
  }

  /** True once A has said hello since B started. An idle A still counts: its last state stays valid. */
  get hasBridge(): boolean {
    return this.seenA;
  }
  get connected(): boolean {
    return this.bridge.connection !== null;
  }
  status(paneKey: string): PushedStatus | undefined {
    return this.byPane.get(paneKey);
  }
  all(): PushedStatus[] {
    return [...this.byPane.values()];
  }
  /** Forgets a pane's status for good: Orca sends no event when an agent row goes away. */
  expire(paneKey: string): void {
    const at = this.order.get(paneKey);
    if (!this.byPane.has(paneKey) || !at) return;
    this.byPane.delete(paneKey);
    this.order.delete(paneKey);
    this.expired.set(paneKey, at);
  }
  /** Fires on every change; use it to refresh keys without waiting for the next poll. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

/**
 * Steady state = bridge status (push) over the base adapter (panes, handles, focus). The base
 * keeps polling for the pane list. Its own status rows are only used where the bridge has
 * nothing newer, which is also the degraded fallback when A is missing.
 */
export class BridgedAdapter implements OrcaAdapter {
  private readonly base: OrcaAdapter;
  private readonly feed: BridgeStatusFeed;
  private readonly now: () => number;
  /** When the previous poll started; null before the first one. */
  private lastPollAt: number | null = null;

  constructor(base: OrcaAdapter, feed: BridgeStatusFeed, now: () => number = Date.now) {
    this.base = base;
    this.feed = feed;
    this.now = now;
  }

  async health(): Promise<AdapterHealth> {
    const h = await this.base.health();
    return { ...h, live: h.orcaRunning && this.feed.hasBridge ? true : (h.live ?? false) };
  }

  async snapshot(): Promise<Snapshot> {
    const pollAt = this.now();
    const snap = await this.base.snapshot();
    const prevPoll = this.lastPollAt;
    this.lastPollAt = pollAt;
    if (!this.feed.hasBridge) return snap;
    const alive = new Set(snap.panes.map((p) => p.paneKey));
    const merged = new Map(snap.statuses.map((s) => [s.paneKey, s]));
    for (const { arrivedAt, ...pushed } of this.feed.all()) {
      if (!alive.has(pushed.paneKey)) continue; // pane is gone, drop its status
      const polled = merged.get(pushed.paneKey);
      if (!polled && prevPoll !== null && arrivedAt < prevPoll) {
        // Two polls since the push and Orca has no agent row for the pane: the agent is gone.
        this.feed.expire(pushed.paneKey);
        continue;
      }
      if (!polled || pushed.stateStartedAt >= polled.stateStartedAt) {
        // Keep what only the poll knows (tool name, agent type) when the state is unchanged.
        merged.set(pushed.paneKey, {
          ...(polled && polled.state === pushed.state ? polled : {}),
          ...pushed,
          agentType: pushed.agentType ?? polled?.agentType ?? null,
        });
      }
    }
    // A push-only pane (tmux hides the agent from Orca's pane identity) still gets its harness badge.
    const panes = snap.panes.map((p) =>
      p.agentType ? p : { ...p, agentType: merged.get(p.paneKey)?.agentType ?? null },
    );
    return { ...snap, panes, statuses: [...merged.values()] };
  }

  listHosts(): Promise<HostInfo[]> {
    return this.base.listHosts();
  }
  focus(pane: Parameters<OrcaAdapter['focus']>[0]): Promise<FocusResult> {
    return this.base.focus(pane);
  }
  get focusNote(): string {
    return this.base.focusNote ?? '';
  }
  get focusHostId(): string | null {
    return this.base.focusHostId ?? null;
  }
  focusedPaneKey(maxAgeMs?: number): Promise<string | null> {
    return this.base.focusedPaneKey?.(maxAgeMs) ?? Promise.resolve(null);
  }
  focusChatInput(): Promise<boolean> {
    return this.base.focusChatInput?.() ?? Promise.resolve(false);
  }
}

export type { PaneRef };
