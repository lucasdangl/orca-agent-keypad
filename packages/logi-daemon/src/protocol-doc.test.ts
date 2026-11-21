import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messageFromLogi, messageToLogi } from './protocol.ts';

const doc = readFileSync(new URL('../../../docs/device-protocol.md', import.meta.url), 'utf8');

/** Message types listed in the first column of the table under `## <heading>`. */
function documented(heading: string): string[] {
  const section = doc.split(/^## /m).find((s) => s.startsWith(heading));
  if (!section) throw new Error(`docs/device-protocol.md has no "${heading}" section`);
  return [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1] as string);
}

const types = (u: { options: readonly { shape: { type: { value: string } } }[] }) =>
  u.options.map((o) => o.shape.type.value);

describe('docs/device-protocol.md', () => {
  it('lists exactly the Logi -> daemon message types of protocol.ts', () => {
    expect(documented('Messages Logi -> daemon').sort()).toEqual(types(messageFromLogi).sort());
  });

  it('lists exactly the daemon -> Logi message types of protocol.ts', () => {
    expect(documented('Messages daemon -> Logi').sort()).toEqual(types(messageToLogi).sort());
  });
});
