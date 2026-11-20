import type { Readable, Writable } from 'node:stream';
import { DeckHost, type DeckHostOptions } from '@orca-agent-deck/deck-host';
import { LogiPort } from './logi-port.ts';

export const DAEMON_VERSION = '0.1.0';

export interface DaemonOptions {
  input: Readable;
  output: Writable;
  logLine?: (line: string) => void;
  /** Exit when this pid is no longer our parent (the Logi plugin service). */
  parent?: number;
  host?: DeckHostOptions;
}

/**
 * Plugin B for the Logi keypad: deck-host on a LogiPort. Resolves when it is done (stdin closed or the parent
 * gone), after the bridge stopped and `bridge.json` is removed.
 */
export async function runDaemon(o: DaemonOptions): Promise<{ why: string }> {
  const port = new LogiPort({
    input: o.input,
    output: o.output,
    daemonVersion: DAEMON_VERSION,
    ...(o.logLine ? { logLine: o.logLine } : {}),
  });
  const host = new DeckHost(port, o.host);
  let gone: (why: string) => void = () => {};
  const parentGone = new Promise<string>((r) => (gone = r));
  // The bridge and the parent watch start with the first hello: before it the plugin has not said who it is.
  void port.ready.then(() =>
    host.start({
      ...(o.parent !== undefined ? { parent: o.parent } : {}),
      onGone: (why) => gone(why),
    }),
  );
  const why = await Promise.race([port.closed.then(() => 'stdin closed'), parentGone]);
  port.log('info', `logi plugin gone (${why}), exiting`);
  await host.stop();
  return { why };
}
