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

const NAV = { bg: '#26303d', fg: '#e8edf3' };
const STYLE: Partial<Record<AnswerKeyCode, { bg: string; fg: string }>> = {
  Escape: { bg: '#4a2326', fg: '#ffb3b3' },
  Return: { bg: '#1f4a33', fg: '#b6f2c9' },
};
const OPTION = { from: '#ffe28f', to: '#ffb21f', fg: '#2b1d00' };
const OFF = { bg: '#1c1c1c', fg: '#4a4a4a' };

/** One answer pad key as SVG (144 x 144 units, like `renderKey`). `label` is the option's text, if known. */
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
      `<text x="72" y="92" font-size="56" text-anchor="middle" fill="${OFF.fg}">${esc(spec.name)}</text></svg>`
    );
  }
  if (spec.option) {
    const text = options[spec.option - 1];
    const bg =
      `<rect width="144" height="144" fill="${OPTION.to}"/>` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${OPTION.from}"/>` +
      `<stop offset="1" stop-color="${OPTION.to}"/></linearGradient></defs><rect width="144" height="144" fill="url(#g)"/>`;
    if (!text) {
      return (
        head +
        bg +
        `<text x="72" y="96" font-size="64" text-anchor="middle" fill="${OPTION.fg}">${spec.name}</text></svg>`
      );
    }
    const { lines, size: fs } = layoutLabel(text);
    const body = lines
      .slice(0, 3)
      .map(
        (l, i) =>
          `<text x="72" y="${(78 + i * (fs + 4)).toFixed(1)}" font-size="${fs}" font-weight="600" text-anchor="middle" fill="${OPTION.fg}">${esc(l)}</text>`,
      )
      .join('');
    return (
      head +
      bg +
      `<circle cx="72" cy="30" r="18" fill="${OPTION.fg}" opacity="0.85"/>` +
      `<text x="72" y="39" font-size="26" text-anchor="middle" fill="${OPTION.from}">${spec.name}</text>` +
      body +
      `</svg>`
    );
  }
  const pal = STYLE[spec.code] ?? NAV;
  const big = spec.name.length <= 1;
  return (
    head +
    `<rect width="144" height="144" fill="${pal.bg}"/>` +
    `<text x="72" y="${big ? 100 : 86}" font-size="${big ? 72 : 34}" text-anchor="middle" fill="${pal.fg}">${esc(spec.name)}</text></svg>`
  );
}
