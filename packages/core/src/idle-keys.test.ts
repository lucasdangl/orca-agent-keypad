import { expect, it } from 'vitest';
import { renderIdleKey } from './idle-keys.ts';

const fills = (svg: string) =>
  new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]));

it('never draws a key of one single colour, which the Logi service shows as white', () => {
  let empty = 0;
  for (let frame = 0; frame < 120; frame++) {
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        const svg = renderIdleKey(col, row, frame);
        if (!svg.includes('<text')) empty++;
        expect(fills(svg).size).toBeGreaterThan(1);
      }
    }
  }
  // The rain does leave keys without a glyph now and then: the case this guards.
  expect(empty).toBeGreaterThan(0);
});
