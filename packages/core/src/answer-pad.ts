import { layoutLabel } from './render.ts';

/** A key press the answer pad sends to the app in front (Orca). */
export type AnswerKeyCode =
  'Escape' | 'Space' | 'ArrowUp' | 'ArrowDown' | 'Return' | '1' | '2' | '3' | '4';

export interface AnswerKeySpec {
  code: AnswerKeyCode;
  /** Short name on the key (navigation keys). */
  name: string;
  /** 1-based option this key picks (the digit keys). */
  option?: number;
}

/**
 * The answer pad by 1-based key number on a 3 x 3 grid:
 *
 *   Esc     Select  ↑
 *   1       2       ↓
 *   3       4       Enter
 */
export const ANSWER_LAYOUT: Readonly<Record<number, AnswerKeySpec>> = {
  1: { code: 'Escape', name: 'Esc' },
  2: { code: 'Space', name: 'Select' },
  3: { code: 'ArrowUp', name: '↑' },
  4: { code: '1', name: '1', option: 1 },
  5: { code: '2', name: '2', option: 2 },
  6: { code: 'ArrowDown', name: '↓' },
  7: { code: '3', name: '3', option: 3 },
  8: { code: '4', name: '4', option: 4 },
  9: { code: 'Return', name: 'Enter' },
};

/** Is this key live: every key is, except an option the question does not have (when its options are known). */
export function answerKeyLive(spec: AnswerKeySpec, options: readonly string[]): boolean {
  return !spec.option || options.length === 0 || spec.option <= options.length;
}

const FONT = 'Helvetica, Arial, Liberation Sans, DejaVu Sans, sans-serif';
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** Navigation keys: dark gradient, a drawn glyph in the key's accent colour and its name below. */
const NAV_BG = { from: '#2b2e33', to: '#191b1e' };
const NAV_NAME = '#7d838b';
const ACCENT: Partial<Record<AnswerKeyCode, string>> = {
  Escape: '#b98783',
  Space: '#b9a77c',
  ArrowUp: '#8796ab',
  ArrowDown: '#8796ab',
  Return: '#7fa8a1',
};
const stroke = (c: string, w = 12) =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
/** Glyphs on the 144 grid, centred around y = 64. */
const NAV_GLYPH: Partial<Record<AnswerKeyCode, (c: string) => string>> = {
  Escape: (c) => `<path d="M52 44 L92 84 M92 44 L52 84" ${stroke(c)}/>`,
  Space: (c) => `<path d="M38 56 V80 H106 V56" ${stroke(c, 11)}/>`,
  ArrowUp: (c) => `<path d="M42 80 L72 50 L102 80" ${stroke(c, 13)}/>`,
  ArrowDown: (c) => `<path d="M42 50 L72 80 L102 50" ${stroke(c, 13)}/>`,
  Return: (c) =>
    `<path d="M102 38 V66 Q102 80 88 80 H50" ${stroke(c, 11)}/><path d="M64 64 L48 80 L64 96" ${stroke(c, 11)}/>`,
};
const OPTION = { from: '#cbb88a', to: '#a68d58', fg: '#26200f' };
const OFF = { bg: '#141414', fg: '#3a3a3a' };

const gradient = (from: string, to: string) =>
  `<rect width="144" height="144" fill="${to}"/>` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/>` +
  `<stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="144" height="144" fill="url(#g)"/>`;

/** A digit on a key cap: rounded square in `cap`, digit in `fg`, its top left corner at (x, y). */
const keyCap = (digit: string, x: number, y: number, s: number, cap: string, fg: string) =>
  `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s / 4}" fill="${cap}"/>` +
  `<text x="${x + s / 2}" y="${(y + s * 0.72).toFixed(1)}" font-size="${Math.round(s * 0.62)}" text-anchor="middle" fill="${fg}">${digit}</text>`;

/** One answer pad key as SVG (144 x 144 units, like `renderKey`). The digit keys show the option's text, if known. */
export function renderAnswerKey(
  spec: AnswerKeySpec,
  options: readonly string[],
  size = 144,
): string {
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144" ` +
    `data-state="answer" data-label="${esc(spec.name)}" data-line2="${spec.code}" font-family="${FONT}" font-weight="700">`;
  if (!answerKeyLive(spec, options)) {
    return (
      head +
      `<rect width="144" height="144" fill="${OFF.bg}"/>` +
      `<rect x="44" y="44" width="56" height="56" rx="14" fill="none" stroke="${OFF.fg}" stroke-width="3"/>` +
      `<text x="72" y="84" font-size="34" text-anchor="middle" fill="${OFF.fg}">${spec.name}</text></svg>`
    );
  }
  if (spec.option) {
    const text = options[spec.option - 1];
    if (!text)
      return (
        head +
        gradient(OPTION.from, OPTION.to) +
        keyCap(spec.name, 32, 32, 80, OPTION.fg, OPTION.from) +
        `</svg>`
      );
    const { lines, size: fs } = layoutLabel(text);
    const shown = lines.slice(0, 3);
    const lh = fs + 4;
    // The text block sits centred in the space under the key cap.
    const top = 58 + (80 - shown.length * lh) / 2 + fs * 0.8;
    const body = shown
      .map(
        (l, i) =>
          `<text x="72" y="${(top + i * lh).toFixed(1)}" font-size="${fs}" text-anchor="middle" fill="${OPTION.fg}">${esc(l)}</text>`,
      )
      .join('');
    return (
      head +
      gradient(OPTION.from, OPTION.to) +
      keyCap(spec.name, 52, 10, 40, OPTION.fg, OPTION.from) +
      body +
      `</svg>`
    );
  }
  const accent = ACCENT[spec.code] ?? '#e8edf3';
  return (
    head +
    gradient(NAV_BG.from, NAV_BG.to) +
    `<rect x="4" y="4" width="136" height="136" rx="12" fill="none" stroke="${accent}" stroke-width="2" opacity="0.25"/>` +
    (NAV_GLYPH[spec.code]?.(accent) ?? '') +
    `<text x="72" y="124" font-size="17" text-anchor="middle" fill="${NAV_NAME}">${esc(spec.name === '↑' ? 'Up' : spec.name === '↓' ? 'Down' : spec.name)}</text></svg>`
  );
}
