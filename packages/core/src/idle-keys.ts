import { keyMarkers } from './render.ts';

/**
 * Keypad extras for Pane keys without a chat: a Matrix-style rain of code glyphs over the empty keys, and the
 * control keys 7 / 8 / 9 (Sort, Mic, Send) while those are free. Frames are pure functions of a frame counter, so a
 * key that did not change is not sent again.
 */

const FONT_MONO = 'Menlo, Monaco, Consolas, DejaVu Sans Mono, monospace';
const FONT = 'Helvetica, Arial, Liberation Sans, DejaVu Sans, sans-serif';
const TEAL = '#7fa8a1';
const SAND = '#b9a77c';
const BLUE = '#8796ab';

/** Deterministic pseudo-random in [0, 1) for a seed (the rain must not flicker between repaints). */
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** The rain falls over the whole deck: 3 x 3 keys of 144 units, one column of glyphs every CELL units. */
const GRID = 3;
const CELL = 18;
const COLS = (GRID * 144) / CELL;
const ROWS = (GRID * 144) / CELL;
const TRAIL = 9;
const GLYPHS = '01{}()<>=;/*+-$#';

/**
 * An empty Pane key: its tile of a Matrix-style rain of code glyphs that falls over the whole 3 x 3 deck, so the empty
 * keys together show one picture. `col` / `row` are the key's 0-based place on the grid. Marked unmapped (with its
 * number) like an empty `renderKey`.
 */
export function renderIdleKey(
  col: number,
  row: number,
  frame: number,
  keyNumber?: string,
  size = 144,
): string {
  const x0 = col * 144;
  const y0 = row * 144;
  let glyphs = '';
  for (let c = 0; c < COLS; c++) {
    const x = c * CELL + CELL / 2;
    if (x < x0 || x >= x0 + 144) continue;
    // Each column has its own speed (1 or 2 cells a frame) and start, and a pause between drops.
    const speed = 1 + Math.floor(rnd(c + 1) * 2);
    const period = ROWS + TRAIL + Math.floor(rnd(c + 50) * ROWS);
    const head = Math.floor((frame * speed + Math.floor(rnd(c + 99) * period)) % period);
    for (let k = 0; k < TRAIL; k++) {
      const r = head - k;
      const y = r * CELL + CELL - 3;
      if (r < 0 || y < y0 || y >= y0 + 144 + CELL) continue;
      // A glyph changes now and then, not every frame.
      const g = GLYPHS[Math.floor(rnd(c * 131 + r * 7 + Math.floor(frame / 3)) * GLYPHS.length)];
      const fill = k === 0 ? '#c8efe3' : '#5f9e8c';
      const o = k === 0 ? 1 : Math.max(0.12, 0.85 - k * 0.09);
      glyphs += `<text x="${x - x0}" y="${y - y0}" font-size="15" text-anchor="middle" fill="${fill}" opacity="${o.toFixed(2)}">${g === '<' ? '&lt;' : g === '>' ? '&gt;' : g}</text>`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144" ` +
    keyMarkers('unmapped', '', '', undefined, keyNumber) +
    `font-family="${FONT_MONO}" font-weight="600">` +
    `<rect width="144" height="144" fill="#0b0e0d"/>` +
    // The Logi service draws an image of one single colour as plain white (docs/logi-findings.md §11); a key without a
    // glyph this frame keeps two nearly black units in a corner so it never is one.
    `<rect width="2" height="2" fill="#0c0f0e"/>` +
    glyphs +
    `</svg>`
  );
}

/** The keypad's control keys, shown on keys 7 / 8 / 9 while they have no chat. */
export type ControlKey = 'sort' | 'mic' | 'send';

/** Control key per 1-based key number. */
export const CONTROL_LAYOUT: Readonly<Record<number, ControlKey>> = {
  7: 'sort',
  8: 'mic',
  9: 'send',
};

const CONTROL: Record<ControlKey, { name: string; accent: string; glyph: (c: string) => string }> =
  {
    sort: {
      name: 'Sort',
      accent: BLUE,
      glyph: (c) =>
        `<path d="M44 38 V92 M32 80 L44 92 L56 80" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M74 44 H108 M74 64 H100 M74 84 H90" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/>`,
    },
    mic: {
      name: 'Mic',
      accent: SAND,
      glyph: (c) =>
        `<rect x="58" y="30" width="28" height="44" rx="14" fill="${c}"/>` +
        `<path d="M46 62 Q46 88 72 88 Q98 88 98 62 M72 88 V100" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>`,
    },
    send: {
      name: 'Send',
      accent: TEAL,
      glyph: (c) =>
        `<path d="M102 38 V66 Q102 80 88 80 H50" fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M64 64 L48 80 L64 96" fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
  };

/** A control key (muted, like the answer pad's navigation keys); the Mic turns into a red Stop while dictating. */
export function renderControlKey(
  kind: ControlKey,
  o: { dictating?: boolean; size?: number } = {},
): string {
  const size = o.size ?? 144;
  const k = CONTROL[kind];
  const live = kind === 'mic' && o.dictating === true;
  const accent = live ? '#d9625b' : k.accent;
  const name = live ? 'Stop' : k.name;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144" ` +
    `data-state="control" data-label="${name}" data-line2="${kind}" font-family="${FONT}" font-weight="700">` +
    `<rect width="144" height="144" fill="#191b1e"/>` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2e33"/>` +
    `<stop offset="1" stop-color="#191b1e"/></linearGradient></defs><rect width="144" height="144" fill="url(#g)"/>` +
    `<rect x="4" y="4" width="136" height="136" rx="12" fill="none" stroke="${accent}" stroke-width="${live ? 5 : 2}" opacity="${live ? 0.9 : 0.25}"/>` +
    k.glyph(accent) +
    `<text x="72" y="124" font-size="17" text-anchor="middle" fill="${live ? accent : '#7d838b'}">${name}</text></svg>`
  );
}
