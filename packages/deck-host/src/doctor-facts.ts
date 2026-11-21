import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  doctorInfo,
  runChecks,
  tmuxMissingVars,
  type Check,
  type DeckController,
  type DeckHostInfo,
  type DoctorFacts,
  type InfoModel,
} from '@orca-agent-deck/core';
import { resolveOrcaBinCached, type ResolvedBin } from '@orca-agent-deck/adapter-cli';
import type { DeckBridge } from './bridge.ts';

// Device apps start plugins with a minimal PATH, so look where tmux is usually installed.
const TMUX = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) =>
  existsSync(p),
);
const TMUX_TTL_MS = 60_000;

/** Longest the Setup list waits for one probe; the inspector gives up after 5 s (10 s while Orca is read through the CLI). */
const PROBE_MS = 4000;

/** `p`, or undefined after `ms` or when it fails: the caller carries on with what it already knows. */
function within(p: Promise<unknown>, ms: number): Promise<unknown> {
  let stop = () => {};
  const deadline = new Promise<undefined>((done) => {
    const t = setTimeout(done, ms);
    stop = () => clearTimeout(t);
  });
  return Promise.race([p.catch(() => undefined), deadline]).finally(stop);
}

/** Setup doctor: the facts behind the Status key and the Setup list. */
export class Doctor {
  private bin: ResolvedBin | undefined;
  private tmux: { missing: string[] | null; at: number } = { missing: null, at: 0 };

  private readonly bridge: DeckBridge;
  private readonly host: () => DeckHostInfo;

  constructor(bridge: DeckBridge, host: () => DeckHostInfo) {
    this.bridge = bridge;
    this.host = host;
    void resolveOrcaBinCached().then((b) => (this.bin = b));
  }

  /** Re-reads tmux's update-environment; no tmux or no server running = not checked (null). */
  readTmux(): Promise<void> {
    if (!TMUX) return Promise.resolve();
    return new Promise((done) =>
      execFile(
        TMUX,
        ['show-options', '-g', 'update-environment'],
        { timeout: 2000 },
        (err, out) => {
          this.tmux = { missing: err ? null : tmuxMissingVars(out), at: Date.now() };
          done();
        },
      ),
    );
  }

  facts(c: DeckController): DoctorFacts {
    if (Date.now() - this.tmux.at > TMUX_TTL_MS) {
      this.tmux.at = Date.now();
      void this.readTmux();
    }
    const o = c.overview();
    return {
      orcaRunning: o.mode !== 'down',
      orcaVersion: o.version,
      orcaUnsupported: o.unsupported,
      orcaResponseBad: o.badResponse,
      binSource: this.bin?.source ?? null,
      binReason: this.bin?.reason,
      liveLink: o.mode === 'down' ? null : o.fast ? 'socket' : 'cli',
      // The key counts the same hosts (`overview().hostsDown`), so key and list cannot disagree.
      hostsDown: o.mode === 'down' ? null : o.hostsDownNames,
      mappedSlots: c.mappedSlotCount(),
      orcaPlugin: this.bridge.orcaPluginState(),
      orcaPluginVersion: this.bridge.orcaPluginVersion(),
      tmuxMissing: this.tmux.missing,
      host: this.host(),
      nodeVersion: process.version,
    };
  }

  /** Worst Setup doctor result, else adapter health: the Status key. */
  statusModel(c: DeckController): InfoModel {
    const o = c.overview();
    return doctorInfo(runChecks(this.facts(c)), {
      mode: o.mode === 'live' ? 'live' : 'degraded',
      version: o.version,
      hostsDown: o.hostsDown,
      orcaPlugin: this.bridge.orcaPluginState(),
    });
  }

  /**
   * Every check, fresh: refresh, tmux and the plugin probe run first. Every probe gets a deadline below the
   * inspector's own: a hung one (a host that does not answer, a queued refresh behind it) must not keep the whole
   * list from being sent. The list then shows what is known.
   */
  async checks(c: DeckController): Promise<{ checks: Check[]; slow: boolean }> {
    await Promise.all(
      [c.refresh([]), this.readTmux(), this.bridge.refreshInstalled()].map((p) =>
        within(p, PROBE_MS),
      ),
    );
    // The inspector waits longer for an answer while every read spawns the CLI.
    return { checks: runChecks(this.facts(c)), slow: !c.overview().fast };
  }
}
