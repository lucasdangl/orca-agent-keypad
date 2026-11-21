import { keyMarkers } from './render.ts';

/**
 * Keypad extras for Pane keys without a chat: small looping animations with a coding theme on the empty keys, and the
 * control keys 7 / 8 / 9 (Sort, Mic, Send) while those are free. Frames are pure functions of a frame counter, so a
 * key that did not change is not sent again.
 */

const FONT_MONO = 'Menlo, Monaco, Consolas, DejaVu Sans Mono, monospace';
const FONT = 'Helvetica, Arial, Liberation Sans, DejaVu Sans, sans-serif';
const BG = '#16181c';
const DIM = '#3a3f47';
const TEAL = '#7fa8a1';
const SAND = '#b9a77c';
const BLUE = '#8796ab';
const ROSE = '#b98783';
const TEXT = '#c9ced6';

/** Number of different idle animations; key n shows animation (n - 1) % IDLE_VARIANTS. */
export const IDLE_VARIANTS = 6;

/** Deterministic pseudo-random in [0, 1) for a seed (the animations must not flicker between repaints). */
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Code being typed: lines of syntax-coloured bars grow one by one under a blinking cursor, then start over. */
function typing(f: number): string {
  const lines = [
    [
      { w: 22, c: ROSE },
      { w: 40, c: BLUE },
    ],
    [
      { w: 12, c: DIM },
      { w: 30, c: TEAL },
      { w: 18, c: SAND },
    ],
    [
      { w: 12, c: DIM },
      { w: 46, c: BLUE },
    ],
    [
      { w: 24, c: DIM },
      { w: 28, c: SAND },
      { w: 14, c: TEAL },
    ],
    [
      { w: 12, c: DIM },
      { w: 20, c: ROSE },
    ],
    [{ w: 10, c: BLUE }],
  ];
  const total = lines.reduce((s, l) => s + l.reduce((t, b) => t + b.w, 0), 0);
  const step = 18;
  let left = (f * step) % (total + step * 6);
  let out = '';
  let cx = 22;
  let cy = 24;
  lines.forEach((l, i) => {
    let x = 22;
    const y = 26 + i * 16;
    for (const b of l) {
      const w = Math.max(0, Math.min(b.w, left));
      if (w > 0) out += `<rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="${b.c}"/>`;
      if (left > 0) {
        cx = x + w + 3;
        cy = y - 2;
      }
      left -= b.w;
      x += b.w + 5;
    }
  });
  return (
    out + (f % 2 === 0 ? `<rect x="${cx}" y="${cy}" width="3" height="12" fill="${TEXT}"/>` : '')
  );
}

/** A terminal: `$ npm test` is typed, dots run, then a check and the prompt again. */
function terminal(f: number): string {
  const cmd = 'npm test';
  const t = f % 24;
  const typed = cmd.slice(0, Math.min(cmd.length, t));
  let out =
    `<text x="20" y="52" font-family="${FONT_MONO}" font-size="16" fill="${TEAL}">$</text>` +
    `<text x="36" y="52" font-family="${FONT_MONO}" font-size="16" fill="${TEXT}">${typed}</text>`;
  if (t < 9) {
    if (f % 2 === 0)
      out += `<rect x="${(37 + typed.length * 9.6).toFixed(1)}" y="40" width="9" height="15" fill="${TEXT}"/>`;
  } else if (t < 17) {
    out += `<text x="20" y="76" font-family="${FONT_MONO}" font-size="16" fill="${DIM}">${'.'.repeat(((t - 9) % 4) + 1)}</text>`;
  } else {
    out +=
      `<text x="20" y="76" font-family="${FONT_MONO}" font-size="14" fill="${TEAL}">42 passed</text>` +
      `<text x="20" y="100" font-family="${FONT_MONO}" font-size="16" fill="${TEAL}">$</text>` +
      (f % 2 === 0 ? `<rect x="36" y="88" width="9" height="15" fill="${TEXT}"/>` : '');
  }
  return out;
}

/** A git graph: commits appear on main and on a feature branch, which merges back; then it starts over. */
function gitGraph(f: number): string {
  const t = f % 16;
  const main = [30, 54, 78, 102, 126].slice(0, Math.min(5, 1 + Math.floor(t / 2)));
  let out = `<path d="M44 ${main[0]} V${main[main.length - 1]}" stroke="${BLUE}" stroke-width="4" fill="none"/>`;
  if (t >= 3) {
    const ys = [66, 84, 102].slice(0, Math.min(3, Math.floor((t - 3) / 2) + 1));
    out += `<path d="M44 54 Q44 62 96 66 V${ys[ys.length - 1]}" stroke="${SAND}" stroke-width="4" fill="none"/>`;
    if (t >= 11)
      out += `<path d="M96 102 Q96 120 44 126" stroke="${SAND}" stroke-width="4" fill="none"/>`;
    for (const y of ys)
      out += `<circle cx="96" cy="${y}" r="7" fill="${BG}" stroke="${SAND}" stroke-width="4"/>`;
  }
  for (const y of main)
    out += `<circle cx="44" cy="${y}" r="7" fill="${BG}" stroke="${BLUE}" stroke-width="4"/>`;
  return out;
}

/** `{ … }`: three dots bounce inside curly braces, like a build waiting. */
function braces(f: number): string {
  const dots = [0, 1, 2]
    .map((i) => {
      const up = (f + i) % 3 === 0 ? -8 : 0;
      return `<circle cx="${56 + i * 16}" cy="${74 + up}" r="5" fill="${[TEAL, SAND, ROSE][i]}"/>`;
    })
    .join('');
  return (
    `<text x="20" y="92" font-family="${FONT_MONO}" font-size="52" fill="${BLUE}">{</text>` +
    `<text x="94" y="92" font-family="${FONT_MONO}" font-size="52" fill="${BLUE}">}</text>` +
    dots
  );
}

/** Falling bits: columns of 0 and 1 drift down, the head of each column brighter. */
function bits(f: number): string {
  let out = '';
  for (let col = 0; col < 6; col++) {
    const x = 18 + col * 21;
    const speed = 1 + Math.floor(rnd(col + 1) * 2);
    const head = ((f * speed + Math.floor(rnd(col + 7) * 10)) % 11) * 14;
    for (let k = 0; k < 4; k++) {
      const y = head - k * 14;
      if (y < 14 || y > 138) continue;
      const ch = rnd(col * 31 + y) > 0.5 ? '1' : '0';
      out += `<text x="${x}" y="${y}" font-family="${FONT_MONO}" font-size="14" fill="${k === 0 ? TEAL : DIM}">${ch}</text>`;
    }
  }
  return out;
}

/** `</>` with a widening ring, like an editor waiting for input. */
function tag(f: number): string {
  const p = f % 4;
  return (
    `<circle cx="72" cy="72" r="${46 + p * 4}" fill="none" stroke="${TEAL}" stroke-width="3" opacity="${(0.5 - p * 0.12).toFixed(2)}"/>` +
    `<text x="72" y="84" font-family="${FONT_MONO}" font-size="34" text-anchor="middle" fill="${TEXT}">&lt;/&gt;</text>`
  );
}

const VARIANTS = [typing, terminal, gitGraph, braces, bits, tag];

/** An empty Pane key: animation `variant` at `frame`, marked unmapped (with its number) like an empty `renderKey`. */
export function renderIdleKey(
  variant: number,
  frame: number,
  keyNumber?: string,
  size = 144,
): string {
  const draw = VARIANTS[((variant % IDLE_VARIANTS) + IDLE_VARIANTS) % IDLE_VARIANTS]!;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144" ` +
    keyMarkers('unmapped', '', '', undefined, keyNumber) +
    `font-family="${FONT}" font-weight="600">` +
    `<rect width="144" height="144" fill="${BG}"/>` +
    draw(frame) +
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
