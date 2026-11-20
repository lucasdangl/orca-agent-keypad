// Plays the Logi C# plugin against the Logi daemon over its stdin/stdout (docs/device-protocol.md), with Orca and
// plugin A simulated: no keypad, no Options+ and no Orca needed. Used by `pnpm logi-sim` and scripts/logi-sim.test.ts.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { decodeKey, type DecodedKey } from '../packages/core/src/index.ts';
import { defaultMetaPath } from '../packages/adapter-runtime/src/index.ts';
import {
  BridgeSimulator,
  FakeRuntime,
  addPane,
  newState,
  writeStateFile,
  type SimState,
} from '../packages/fake-orca/src/index.ts';

export const REPO = resolve(import.meta.dirname, '..');
/** The daemon from source (no build needed) or the bundle `pnpm logi:build` makes. */
export const DAEMON_SOURCE = [
  '--experimental-strip-types',
  '--disable-warning=ExperimentalWarning',
  join(REPO, 'packages/logi-daemon/src/bin.ts'),
];
export const DAEMON_BUNDLE = [join(REPO, 'packages/logi-daemon/dist/daemon.mjs')];

type Msg = Record<string, unknown> & { type: string };

/**
 * A private Orca for the daemon: its own HOME (so `~/.orca-deck` and Orca's runtime file are throwaway), the fake
 * runtime socket on a SimState, and shims for `orca` (the CLI fallback) and `open` (the window raise) on PATH, so
 * nothing reaches the real Orca.
 */
export class FakeOrcaEnv {
  readonly s: SimState;
  readonly root: string;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly runtime: FakeRuntime;
  readonly openLog: string;
  readonly bridgeFile: string;

  private constructor(root: string, s: SimState) {
    this.root = root;
    this.s = s;
    this.home = join(root, 'h');
    this.openLog = join(root, 'open.log');
    this.bridgeFile = join(this.home, '.orca-deck', 'bridge.json');
    const bin = join(root, 'bin');
    const stateFile = join(root, 'state.json');
    this.env = {
      ...process.env,
      HOME: this.home,
      USERPROFILE: this.home,
      APPDATA: join(this.home, 'AppData'),
      XDG_CONFIG_HOME: join(this.home, '.config'),
      PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
      ORCA_BIN: join(bin, 'orca'),
      FAKE_ORCA_STATE: stateFile,
      ORCA_DECK_BRIDGE_PORTS: '0',
    };
    delete this.env['ORCA_DECK_HOST'];
    this.runtime = new FakeRuntime({
      state: () => this.s,
      sockPath: join(root, 'rt.sock'),
      metaPath: defaultMetaPath(process.platform, this.env, this.home),
    });
  }

  /** Panes `a`, `b`, `c` (Claude agents, done) unless `setup` builds another state. */
  static async create(setup?: (s: SimState) => void): Promise<FakeOrcaEnv> {
    const root = await mkdtemp(join(tmpdir(), 'logi-sim-'));
    const s = newState();
    if (setup) setup(s);
    else for (const k of ['a', 'b', 'c']) addPane(s, k, { title: `agent ${k}` });
    const e = new FakeOrcaEnv(root, s);
    const bin = join(root, 'bin');
    await mkdir(bin, { recursive: true });
    await mkdir(e.home, { recursive: true });
    await mkdir(dirname(defaultMetaPath(process.platform, e.env, e.home)), { recursive: true });
    const shim = async (name: string, js: string) => {
      await writeFile(join(bin, name), `#!/usr/bin/env node\n${js}\n`);
      await chmod(join(bin, name), 0o755);
    };
    await shim(
      'orca',
      `const { spawnSync } = require('node:child_process');
const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', ${JSON.stringify(join(REPO, 'packages/fake-orca/src/bin.ts'))}, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);`,
    );
    await shim(
      'open',
      `require('node:fs').appendFileSync(${JSON.stringify(e.openLog)}, process.argv.slice(2).join(' ') + '\\n');`,
    );
    e.persist();
    await e.runtime.start();
    return e;
  }

  /** Writes the state for the CLI shim (the runtime socket reads `s` directly). */
  persist(): void {
    writeStateFile(this.env['FAKE_ORCA_STATE']!, this.s);
  }

  /** Plugin A, connected to the daemon's bridge (found through the throwaway `bridge.json`). */
  pluginA(): BridgeSimulator {
    return new BridgeSimulator(this.bridgeFile);
  }

  /** The handle of a pane, as `terminal.focus` gets it. */
  handle(key: string): string {
    return this.s.panes.find((p) => p.key === key)!.handle;
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
    await rm(this.root, { recursive: true, force: true });
  }
}

/** The C# plugin's side of the device protocol, driving a daemon child process. */
export class LogiSim {
  readonly child: ChildProcess;
  /** Last image per slot (SVG). */
  readonly images = new Map<string, string>();
  readonly received: Msg[] = [];
  readonly stderr: string[] = [];
  readonly exited: Promise<number | null>;
  onImage: ((slot: string, svg: string) => void) | null = null;
  private waiters: (() => void)[] = [];

  constructor(args: string[], env: NodeJS.ProcessEnv, o: { logFile?: string } = {}) {
    this.child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((r) => this.child.once('exit', (code) => r(code)));
    createInterface({ input: this.child.stdout! }).on('line', (line) => {
      let m: Msg;
      try {
        m = JSON.parse(line) as Msg;
      } catch {
        this.stderr.push(`NOT JSON ON STDOUT: ${line.slice(0, 200)}`);
        return;
      }
      this.received.push(m);
      if (m.type === 'image') {
        this.images.set(m['slotId'] as string, m['svg'] as string);
        this.onImage?.(m['slotId'] as string, m['svg'] as string);
      }
      for (const w of this.waiters.splice(0)) w();
    });
    createInterface({ input: this.child.stderr! }).on('line', (line) => {
      this.stderr.push(line);
      if (o.logFile) appendFileSync(o.logFile, `${line}\n`);
    });
  }

  send(m: Record<string, unknown>): void {
    this.child.stdin!.write(`${JSON.stringify({ v: 1, ...m })}\n`);
  }

  hello(settings: Record<string, unknown> = {}): void {
    this.send({
      type: 'hello',
      pluginVersion: 'sim',
      device: { model: 'MX Creative Keypad', cols: 3, rows: 3 },
      imageSize: 116,
      settings,
    });
  }

  /** Pane slots 1..n (`logi:slot-<n>`), plus Status, Attention and Working keys when asked. */
  keys(n: number, extra: { status?: boolean; attention?: boolean; working?: boolean } = {}): void {
    this.send({
      type: 'keys',
      keys: [
        ...Array.from({ length: n }, (_, i) => ({
          slotId: `logi:slot-${i + 1}`,
          kind: 'pane',
          index: i + 1,
        })),
        ...(extra.status ? [{ slotId: 'logi:status', kind: 'status' }] : []),
        ...(extra.attention ? [{ slotId: 'logi:attention', kind: 'attention' }] : []),
        ...(extra.working ? [{ slotId: 'logi:working', kind: 'working' }] : []),
      ],
    });
  }

  tap(slot: string): void {
    this.send({ type: 'key', slotId: slot, edge: 'down' });
    this.send({ type: 'key', slotId: slot, edge: 'up' });
  }

  async hold(slot: string, ms = 1200): Promise<void> {
    this.send({ type: 'key', slotId: slot, edge: 'down' });
    await new Promise((r) => setTimeout(r, ms));
    this.send({ type: 'key', slotId: slot, edge: 'up' });
  }

  /** What a key shows, read back from the markers `renderKey` writes into the SVG. */
  shown(slot: string): DecodedKey | null {
    const svg = this.images.get(slot);
    return svg ? decodeKey(svg) : null;
  }

  /** Waits until `pred` holds, re-checked on every message from the daemon. */
  async until(pred: () => boolean, ms = 10_000): Promise<void> {
    const end = Date.now() + ms;
    while (!pred()) {
      const left = end - Date.now();
      if (left <= 0) throw new Error(`timeout; daemon log:\n${this.stderr.slice(-20).join('\n')}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.min(left, 100));
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  /** Closes stdin, as the C# plugin does when it unloads; resolves with the exit code. */
  close(): Promise<number | null> {
    this.child.stdin!.end();
    return this.exited;
  }

  kill(): void {
    if (this.child.exitCode === null) this.child.kill();
  }
}
