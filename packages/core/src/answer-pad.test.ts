import { expect, it } from 'vitest';
import { ANSWER_LAYOUT, answerKeyLive, renderAnswerKey } from './answer-pad.ts';

it('lays out Esc / Select / arrows / 1-4 / Enter on the 3 x 3 grid', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ANSWER_LAYOUT[n]?.code)).toEqual([
    'Escape',
    'Space',
    'ArrowUp',
    '1',
    '2',
    'ArrowDown',
    '3',
    '4',
    'Return',
  ]);
});

it('shows the option text on its digit key and dims options the question does not have', () => {
  const opts = ['Yes, ship it', 'No'];
  expect(renderAnswerKey(ANSWER_LAYOUT[4]!, opts)).toContain('>Yes, ship it<');
  expect(answerKeyLive(ANSWER_LAYOUT[7]!, opts)).toBe(false);
  expect(renderAnswerKey(ANSWER_LAYOUT[7]!, opts)).toContain('fill="#141414"');
  // Options unknown (a permission prompt): every digit stays live.
  expect(answerKeyLive(ANSWER_LAYOUT[8]!, [])).toBe(true);
  expect(renderAnswerKey(ANSWER_LAYOUT[1]!, opts)).toContain('>Esc<');
  expect(renderAnswerKey(ANSWER_LAYOUT[3]!, opts)).toContain('>Up<');
});
