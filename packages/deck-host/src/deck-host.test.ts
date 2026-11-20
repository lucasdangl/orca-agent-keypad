import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeSimulator,
  FakeRuntime,
  addPane,
  advance,
  newState,
  setAgent,
  type SimState,
} from '@orca-agent-deck/fake-orca';
import { DeckHost } from './deck-host.ts';
import { FakePort } from './fake-port.ts';

// deck-host with no device app at all: a FakePort for the keys, the fake Orca runtime socket for reads and focus,
// and plugin A played by the BridgeSimulator. Conditions are waited for, never slept past.
const until = async (fn: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const SLOT = 'fake:slot-1';
const KEY_A = 'tab-1:leaf-a';

let dir: string;
let s: SimState;
/** What the runtime socket answers: frozen in the push test, so only plugin A's push can change the key. */
let polled: SimState;
let runtime: FakeRuntime;
let port: FakePort;
let host: DeckHost;
let a: BridgeSimulator;
const raise = vi.fn(async () => {});
const exec = vi.fn(async (): Promise<string> => {
  throw new Error('no CLI in this test');
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'deck-host-'));
  s = newState();
  addPane(s, 'a');
  addPane(s, 'b');
  polled = s;
  runtime = new FakeRuntime({
    state: () => polled,
    sockPath: join(dir, 'rt.sock'),
    metaPath: join(dir, 'orca-runtime.json'),
  });
  await runtime.start();
  port = new FakePort();
  host = new DeckHost(port, {
    runtimeMetaPath: join(dir, 'orca-runtime.json'),
    environmentsFile: join(dir, 'orca-environments.json'),
    mappingsPath: join(dir, 'mappings.json'),
    bridge: { discoveryPath: join(dir, 'bridge.json'), ports: [0] },
    exec,
    raise,
    timers: false,
  });
  await host.start();
  a = new BridgeSimulator(join(dir, 'bridge.json'));
  port.setKeys(port.paneKeys(3));
  // The first refresh (keys appeared) loads the pane list the mapping is made from, as the Orca panel's picker does.
  await until(() => port.images.size === 3);
  (await host.controller()).configure(SLOT, { paneKey: KEY_A });
  await host.panes.refresh();
});

afterEach(async () => {
  a.close();
  await host.stop();
  await runtime.stop();
  await rm(dir, { recursive: true, force: true });
});

describe('deck-host on a FakePort with fake Orca', () => {
  it('draws the mapped pane on its key and leaves the others empty', () => {
    expect(port.shown(SLOT)).toMatchObject({ state: 'completed', number: '1' });
    expect(port.shown('fake:slot-2')).toMatchObject({ state: 'unmapped', number: '2' });
  });

  it('a status push from plugin A colours the key without waiting for a poll', async () => {
    polled = structuredClone(s);
    await a.connect();
    advance(s, 1000);
    setAgent(s, 'a', 'waiting');
    a.sendStatus(s, 'a');
    await until(() => port.shown(SLOT)?.state === 'needs_input');
    // The socket still says done: the push alone changed the key.
    expect(polled.panes.find((p) => p.key === 'a')?.agent?.state).toBe('done');
  });

  it('a tap focuses the pane through terminal.focus and raises Orca', async () => {
    const handle = s.panes.find((p) => p.key === 'a')!.handle;
    port.key(SLOT, 'down');
    port.key(SLOT, 'up');
    await until(() => runtime.requests.some((r) => r.method === 'terminal.focus'));
    expect(runtime.requests.find((r) => r.method === 'terminal.focus')?.params).toMatchObject({
      terminal: handle,
    });
    expect(s.focusedHandle).toBe(handle);
    await until(() => raise.mock.calls.length > 0);
    expect(port.alerts).toEqual([]);
    expect(port.logs.some((l) => l.startsWith('info press slot=fake:slot-1 -> focused'))).toBe(
      true,
    );
  });

  it('a tap on an empty key does not focus anything', async () => {
    port.key('fake:slot-2', 'down');
    port.key('fake:slot-2', 'up');
    await until(() => port.logs.some((l) => l.includes('press slot=fake:slot-2')));
    expect(runtime.requests.some((r) => r.method === 'terminal.focus')).toBe(false);
  });

  it('reports the device to plugin A and the Orca panel', async () => {
    await a.connect({ minor: 5 });
    const st = (await a.waitFor((m) => m.type === 'deckState')) as Record<string, unknown>;
    expect(st).toMatchObject({ connected: true, model: 'Fake Keypad', cols: 3, rows: 3 });
    expect((st['keys'] as unknown[]).length).toBe(3);
  });

  it('keys that disappear are forgotten, keys that come back are drawn again', async () => {
    port.setKeys([]);
    await host.panes.syncKeys();
    port.images.clear();
    port.setKeys(port.paneKeys(3));
    await until(() => port.shown(SLOT)?.state === 'completed');
  });
});
