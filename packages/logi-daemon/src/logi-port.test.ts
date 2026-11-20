import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogiPort } from './logi-port.ts';

const make = (minImageMs = 100) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const sent: Record<string, unknown>[] = [];
  output.on('data', (b: Buffer) => {
    for (const l of b.toString().split('\n').filter(Boolean)) sent.push(JSON.parse(l));
  });
  const logs: string[] = [];
  const port = new LogiPort({ input, output, minImageMs, logLine: (l) => logs.push(l) });
  const write = (m: unknown) => input.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
  const flush = () => new Promise((r) => setImmediate(r));
  return { input, port, sent, logs, write, flush };
};

const hello = {
  v: 1,
  type: 'hello',
  pluginVersion: '1.0',
  device: { model: 'MX Creative Keypad', cols: 3, rows: 3 },
  imageSize: 116,
  settings: { slots: { x: 1 } },
};

afterEach(() => vi.useRealTimers());

describe('LogiPort', () => {
  it('answers hello, reports the device and hands out the stored settings', async () => {
    const { port, sent, write, flush } = make();
    write(hello);
    await flush();
    expect(sent).toEqual([{ v: 1, type: 'ready', daemonVersion: '0.0.0' }]);
    expect(port.devices()).toEqual([
      { id: 'logi', model: 'MX Creative Keypad', cols: 3, rows: 3, connected: true },
    ]);
    expect(await port.settings.load()).toEqual({ slots: { x: 1 } });
    expect(port.host()).toMatchObject({ host: 'logi', version: '1.0', basis: 'device-app' });
  });

  it('places slot n at its grid position; keys without an index have none', async () => {
    const { port, write, flush } = make();
    const changed = vi.fn();
    port.onKeysChanged(changed);
    write(hello);
    write({
      v: 1,
      type: 'keys',
      keys: [
        { slotId: 'logi:slot-1', kind: 'pane', index: 1 },
        { slotId: 'logi:slot-5', kind: 'pane', index: 5 },
        { slotId: 'logi:slot-9', kind: 'pane', index: 9 },
        { slotId: 'logi:status', kind: 'status' },
      ],
    });
    await flush();
    expect(changed).toHaveBeenCalled();
    expect(port.keys()).toEqual([
      { slotId: 'logi:slot-1', kind: 'pane', device: 'logi', coordinates: { column: 0, row: 0 } },
      { slotId: 'logi:slot-5', kind: 'pane', device: 'logi', coordinates: { column: 1, row: 1 } },
      { slotId: 'logi:slot-9', kind: 'pane', device: 'logi', coordinates: { column: 2, row: 2 } },
      { slotId: 'logi:status', kind: 'status', device: 'logi' },
    ]);
  });

  it('passes key edges on', async () => {
    const { port, write, flush } = make();
    const edges: string[] = [];
    port.onKey((s, e) => edges.push(`${s} ${e}`));
    write({ v: 1, type: 'key', slotId: 'logi:slot-2', edge: 'down' });
    write({ v: 1, type: 'key', slotId: 'logi:slot-2', edge: 'up' });
    await flush();
    expect(edges).toEqual(['logi:slot-2 down', 'logi:slot-2 up']);
  });

  it('ignores bad lines and logs their type only, never their content', async () => {
    const { sent, logs, write, flush } = make();
    write('not json SECRET');
    write({ v: 2, type: 'hello' });
    write({ v: 1, type: 'key', slotId: 'logi:slot-1', edge: 'sideways', note: 'SECRET' });
    await flush();
    expect(sent).toEqual([]);
    expect(logs).toHaveLength(3);
    expect(logs.join('\n')).not.toContain('SECRET');
    expect(logs[2]).toContain('malformed device message ignored (type key)');
  });

  it('sends at most one image per key per interval, the newest one last', async () => {
    vi.useFakeTimers();
    const { port, sent, flush } = make(100);
    await port.setImage('k', '<svg>1</svg>');
    await port.setImage('k', '<svg>2</svg>');
    await port.setImage('k', '<svg>3</svg>');
    await port.setImage('other', '<svg>o</svg>');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((m) => m['svg'])).toEqual(['<svg>1</svg>', '<svg>o</svg>']);
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
    await flush();
    expect(sent.map((m) => m['svg'])).toEqual(['<svg>1</svg>', '<svg>o</svg>', '<svg>3</svg>']);
  });

  it('closed resolves when stdin ends', async () => {
    const { input, port } = make();
    input.end();
    await port.closed;
  });
});
