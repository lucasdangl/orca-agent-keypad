import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addChat,
  addPane,
  advance,
  setAgent,
  type BridgeSimulator,
} from '../packages/fake-orca/src/index.ts';
import { DAEMON_VERSION } from '../packages/logi-daemon/src/daemon.ts';
import { DAEMON_SOURCE, FakeOrcaEnv, LogiSim } from './logi-sim-lib.ts';

// Phase 2 acceptance: the Logi daemon as a child process, driven over the device protocol the way the C# plugin
// does, with Orca and plugin A simulated. Each test waits for conditions, never for fixed times.
let orca: FakeOrcaEnv;
let sim: LogiSim;
let a: BridgeSimulator;

const SLOT1 = 'logi:slot-1';

beforeEach(async () => {
  orca = await FakeOrcaEnv.create();
  sim = new LogiSim(DAEMON_SOURCE, orca.env);
  sim.hello();
  sim.keys(3, { status: true });
  await sim.until(() => existsSync(orca.bridgeFile) && sim.images.size === 4);
  a = orca.pluginA();
  await a.connect({ minor: 5 });
  // Plugin A's Orca panel puts pane `a` on key 1.
  a.send({
    v: 1,
    type: 'assignKey',
    requestId: 'r1',
    key: 1,
    replace: true,
    paneKey: 'tab-1:leaf-a',
  });
  await a.waitFor((m) => m.type === 'pairResult');
  await sim.until(() => sim.shown(SLOT1)?.state === 'completed');
}, 20_000);

afterEach(async () => {
  a?.close();
  sim?.kill();
  await orca?.stop();
});

describe('logi daemon over the device protocol', () => {
  it('answers hello and draws every key as SVG, numbered by its slot', () => {
    expect(sim.received[0]).toEqual({ v: 1, type: 'ready', daemonVersion: DAEMON_VERSION });
    expect(sim.shown(SLOT1)).toMatchObject({ state: 'completed', number: '1' });
    expect(sim.shown('logi:slot-2')).toMatchObject({ state: 'unmapped', number: '2' });
    expect(sim.images.get('logi:status')).toMatch(/^<svg /);
    expect(sim.stderr.filter((l) => l.startsWith('NOT JSON'))).toEqual([]);
  });

  it('reports the keypad to plugin A and stores the mapping through saveSettings', async () => {
    const st = (await a.waitFor((m) => m.type === 'deckState')) as Record<string, unknown>;
    expect(st).toMatchObject({ connected: true, model: 'MX Creative Keypad', cols: 3, rows: 3 });
    const saved = sim.received.filter((m) => m.type === 'saveSettings').at(-1)!;
    expect(JSON.stringify(saved['settings'])).toContain('tab-1:leaf-a');
  });

  it('a status change shows on the key (push from plugin A)', async () => {
    advance(orca.s, 1000);
    setAgent(orca.s, 'a', 'waiting');
    a.sendStatus(orca.s, 'a');
    await sim.until(() => sim.shown(SLOT1)?.state === 'needs_input');
    advance(orca.s, 1000);
    setAgent(orca.s, 'a', 'working');
    a.sendStatus(orca.s, 'a');
    await sim.until(() => sim.shown(SLOT1)?.state === 'working');
  });

  it('a status change shows on the key without plugin A (2 s poll)', async () => {
    a.close();
    advance(orca.s, 1000);
    setAgent(orca.s, 'a', 'waiting');
    await sim.until(() => sim.shown(SLOT1)?.state === 'needs_input');
  });

  it('a tap focuses the pane in Orca and raises the window', async () => {
    sim.tap(SLOT1);
    await sim.until(() => orca.s.focusedHandle === orca.handle('a'));
    expect(orca.runtime.requests.some((r) => r.method === 'terminal.focus')).toBe(true);
    await sim.until(() => existsSync(orca.openLog));
    expect(readFileSync(orca.openLog, 'utf8')).toContain('-b com.stablyai.orca');
  });

  it('a hold asks plugin A about the panel instead of focusing', async () => {
    const asked = a.waitFor((m) => m.type === 'holdKey', 5000);
    await sim.hold(SLOT1, 1300);
    expect(await asked).toMatchObject({ type: 'holdKey', key: 1 });
    expect(orca.s.focusedHandle).toBe(null);
  });

  it('closing stdin stops the daemon cleanly and removes bridge.json', async () => {
    expect(await sim.close()).toBe(0);
    expect(existsSync(orca.bridgeFile)).toBe(false);
  });
});

// Phase 3b: an Orca agent chat on a key (docs/logi-findings.md §8), through the real daemon process.
describe('logi daemon with an Orca agent chat', () => {
  const CHAT = 'structured-agent-session-session-c:leaf-c';
  let o: FakeOrcaEnv;
  let d: LogiSim;
  let pa: BridgeSimulator;

  afterEach(async () => {
    pa?.close();
    d?.kill();
    await o?.stop();
  });

  it('shows the chat working, waiting and done; a tap opens it through terminal.reveal', async () => {
    o = await FakeOrcaEnv.create((st) => {
      addPane(st, 'a', { title: 'agent a' });
      addChat(st, 'c', { name: 'Fix the login' });
    });
    d = new LogiSim(DAEMON_SOURCE, o.env);
    d.hello();
    d.keys(3);
    await d.until(() => existsSync(o.bridgeFile) && d.images.size === 3);
    pa = o.pluginA();
    await pa.connect({ minor: 5 });
    pa.send({ v: 1, type: 'assignKey', requestId: 'c1', key: 2, replace: true, paneKey: CHAT });
    expect(await pa.waitFor((m) => m.type === 'pairResult')).toMatchObject({ ok: true });
    const SLOT2 = 'logi:slot-2';
    await d.until(() => d.shown(SLOT2)?.label === 'Fix the login');

    advance(o.s, 1000);
    setAgent(o.s, 'c', 'working', 'Bash');
    await d.until(() => d.shown(SLOT2)?.state === 'working');
    advance(o.s, 1000);
    setAgent(o.s, 'c', 'waiting');
    await d.until(() => d.shown(SLOT2)?.state === 'needs_input');
    advance(o.s, 1000);
    setAgent(o.s, 'c', 'done');
    await d.until(() => d.shown(SLOT2)?.state === 'completed');

    d.tap(SLOT2);
    await d.until(() => o.s.focusedHandle === 'chat-c');
    expect(o.runtime.requests.find((r) => r.method === 'terminal.reveal')?.params).toMatchObject({
      tabId: 'structured-agent-session-session-c',
      leafId: 'leaf-c',
    });
    expect(o.runtime.requests.some((r) => r.method === 'terminal.focus')).toBe(false);
  }, 30_000);
});
