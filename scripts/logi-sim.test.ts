import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advance, setAgent, type BridgeSimulator } from '../packages/fake-orca/src/index.ts';
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
    expect(sim.received[0]).toEqual({ v: 1, type: 'ready', daemonVersion: '0.1.0' });
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
