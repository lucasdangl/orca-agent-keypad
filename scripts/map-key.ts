// `pnpm map-key list | <key> [paneKey] | clear <key>`: maps keys of a running plugin B (Logi daemon or Stream Deck
// plugin) without the Orca panel. It connects to B's bridge as plugin A would (the real plugin A is replaced while
// this runs, it reconnects by itself) and sends the same frames the panel's key picker sends. Without a paneKey the
// pane focused in Orca right now goes on the key. Development tool: the Orca panel (plugin A) is the real way.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BridgeSimulator } from '../packages/fake-orca/src/index.ts';

const [cmd, arg] = process.argv.slice(2);
const discovery = join(homedir(), '.orca-deck', 'bridge.json');
const a = new BridgeSimulator(discovery, { orca: 'map-key', plugin: 'map-key' });
await a.connect({ minor: 5 });
type Frame = Record<string, unknown>;
const deck = (await a.waitFor((m) => m.type === 'deckState', 5000)) as Frame;

if (!cmd || cmd === 'list') {
  console.log(`deck: ${String(deck['model'])} ${String(deck['cols'])}x${String(deck['rows'])}`);
  for (const k of (deck['keys'] as Frame[]) ?? [])
    console.log(
      `  key ${String(k['key'])}: ${k['mapped'] ? `${String(k['label'])} (${String(k['state'])})` : '-'}`,
    );
  console.log('panes (focused first):');
  for (const p of (deck['panes'] as Frame[]) ?? [])
    console.log(
      `  ${String(p['paneKey'])}  ${String(p['label'])}${p['focused'] ? '  [focused]' : ''}${p['onKey'] ? `  on key ${String(p['onKey'])}` : ''}`,
    );
} else {
  const clear = cmd === 'clear';
  const key = Number(clear ? arg : cmd);
  if (!Number.isInteger(key) || key < 1)
    throw new Error('usage: map-key list | <key> [paneKey] | clear <key>');
  const requestId = `map-key-${Date.now()}`;
  a.send(
    clear
      ? { v: 1, type: 'unmapKey', requestId, key }
      : {
          v: 1,
          type: 'assignKey',
          requestId,
          key,
          replace: true,
          ...(arg ? { paneKey: arg } : {}),
        },
  );
  console.log(
    await a.waitFor((m) => m.type === 'pairResult' && m['requestId'] === requestId, 5000),
  );
}
a.close();
process.exit(0);
