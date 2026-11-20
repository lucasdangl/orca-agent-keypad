import { layoutLabel } from './render.ts';

/** A key press the answer pad sends to the app in front (Orca). `Cmd+E` is Orca's default dictation shortcut. */
export type AnswerKeyCode =
  'Escape' | 'ArrowUp' | 'ArrowDown' | 'Return' | '1' | '2' | '3' | '4' | 'Cmd+E';

/**
 * What a pad key does: one key press, or `Other` (into the free-text field and dictate) / `Send` (submit), whose key
 * presses depend on what was done before (see `answerPresses`).
 */
export type AnswerAction = AnswerKeyCode | 'Other' | 'Send';

export interface AnswerKeySpec {
  action: AnswerAction;
  /** Short name on the key. */
  name: string;
  /** 1-based option this key picks (the digit keys). */
  option?: number;
}

/**
 * The answer pad by 1-based key number on a 3 x 3 grid:
 *
 *   Esc     Other   ↑
 *   1       2       ↓
 *   3       4       Send
 */
export const ANSWER_LAYOUT: Readonly<Record<number, AnswerKeySpec>> = {
  1: { action: 'Escape', name: 'Esc' },
  2: { action: 'Other', name: 'Other' },
  3: { action: 'ArrowUp', name: '↑' },
  4: { action: '1', name: '1', option: 1 },
  5: { action: '2', name: '2', option: 2 },
  6: { action: 'ArrowDown', name: '↓' },
  7: { action: '3', name: '3', option: 3 },
  8: { action: '4', name: '4', option: 4 },
  9: { action: 'Send', name: 'Send' },
};

/**
 * Where the free-text answer stands: `off` (options only), `dictating` (Orca's dictation runs in the answer field),
 * `typing` (dictation stopped, the text is in the field).
 */
export type OtherState = 'off' | 'dictating' | 'typing';

/** A press of an answer pad key in Orca's question card: the key presses to send, a pause in ms, and the next state. */
export function answerPresses(
  action: AnswerAction,
  other: OtherState,
): { presses: (AnswerKeyCode | number)[]; other: OtherState } {
  switch (action) {
    case 'Other':
      // ↑ from the first option wraps to the free-text field (the card's ↑/↓ cycle through options, then the field).
      if (other === 'off') return { presses: ['ArrowUp', 'Cmd+E'], other: 'dictating' };
      return { presses: ['Cmd+E'], other: other === 'dictating' ? 'typing' : 'dictating' };
    case 'Send':
      // Enter in the free-text field submits the ticked options and the text, also with an empty field (Enter on an
      // option only toggles it in a multi-select). From the options, ↑ goes into the field first (seen in Orca).
      if (other === 'dictating') return { presses: ['Cmd+E', 700, 'Return'], other: 'off' };
      return { presses: other === 'typing' ? ['Return'] : ['ArrowUp', 'Return'], other: 'off' };
    case 'Escape':
      return { presses: other === 'dictating' ? ['Cmd+E', 'Escape'] : ['Escape'], other: 'off' };
    default:
      return { presses: [action], other };
  }
}

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
const ACCENT: Partial<Record<AnswerAction, string>> = {
  Escape: '#b98783',
  Other: '#b9a77c',
  ArrowUp: '#8796ab',
  ArrowDown: '#8796ab',
  Send: '#7fa8a1',
};
const stroke = (c: string, w = 12) =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
/** Glyphs on the 144 grid, centred around y = 64. */
const NAV_GLYPH: Partial<Record<AnswerAction, (c: string) => string>> = {
  Escape: (c) => `<path d="M52 44 L92 84 M92 44 L52 84" ${stroke(c)}/>`,
  // A microphone.
  Other: (c) =>
    `<rect x="58" y="30" width="28" height="44" rx="14" fill="${c}"/>` +
    `<path d="M46 62 Q46 88 72 88 Q98 88 98 62 M72 88 V100" ${stroke(c, 7)}/>`,
  ArrowUp: (c) => `<path d="M42 80 L72 50 L102 80" ${stroke(c, 13)}/>`,
  ArrowDown: (c) => `<path d="M42 50 L72 80 L102 50" ${stroke(c, 13)}/>`,
  Send: (c) =>
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

/**
 * One answer pad key as SVG (144 x 144 units, like `renderKey`). The digit keys show the option's text, if known; the
 * Other key turns into a red Stop while dictation runs.
 */
export function renderAnswerKey(
  spec: AnswerKeySpec,
  options: readonly string[],
  o: { other?: OtherState; size?: number } = {},
): string {
  const size = o.size ?? 144;
  const dictating = spec.action === 'Other' && o.other === 'dictating';
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144" ` +
    `data-state="answer" data-label="${esc(spec.name)}" data-line2="${dictating ? 'dictating' : spec.action}" font-family="${FONT}" font-weight="700">`;
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
  const accent = dictating ? '#d9625b' : (ACCENT[spec.action] ?? '#e8edf3');
  const name = dictating
    ? 'Stop'
    : spec.name === '↑'
      ? 'Up'
      : spec.name === '↓'
        ? 'Down'
        : spec.name;
  return (
    head +
    gradient(NAV_BG.from, NAV_BG.to) +
    `<rect x="4" y="4" width="136" height="136" rx="12" fill="none" stroke="${accent}" stroke-width="${dictating ? 5 : 2}" opacity="${dictating ? 0.9 : 0.25}"/>` +
    (NAV_GLYPH[spec.action]?.(accent) ?? '') +
    `<text x="72" y="124" font-size="17" text-anchor="middle" fill="${dictating ? accent : NAV_NAME}">${esc(name)}</text></svg>`
  );
}
