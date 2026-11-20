import { expect, it } from 'vitest';
import { ANSWER_LAYOUT, answerKeyLive, answerPresses, renderAnswerKey } from './answer-pad.ts';

it('lays out Esc / Other / arrows / 1-4 / Send on the 3 x 3 grid', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ANSWER_LAYOUT[n]?.action)).toEqual([
    'Escape',
    'Other',
    'ArrowUp',
    '1',
    '2',
    'ArrowDown',
    '3',
    '4',
    'Send',
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
  // Other turns into a red Stop while dictating.
  expect(renderAnswerKey(ANSWER_LAYOUT[2]!, opts)).toContain('>Other<');
  expect(renderAnswerKey(ANSWER_LAYOUT[2]!, opts, { other: 'dictating' })).toContain('>Stop<');
});

it('Send submits the options with →, a free-text answer with Enter (stopping dictation first)', () => {
  expect(answerPresses('Send', 'off')).toEqual({ presses: ['ArrowRight'], other: 'off' });
  expect(answerPresses('Send', 'typing')).toEqual({ presses: ['Return'], other: 'off' });
  expect(answerPresses('Send', 'dictating').presses).toEqual(['Cmd+E', 700, 'Return']);
});

it('Other goes into the free-text field and dictates; again stops, again dictates more', () => {
  expect(answerPresses('Other', 'off')).toEqual({
    presses: ['ArrowUp', 'Cmd+E'],
    other: 'dictating',
  });
  expect(answerPresses('Other', 'dictating')).toEqual({ presses: ['Cmd+E'], other: 'typing' });
  expect(answerPresses('Other', 'typing')).toEqual({ presses: ['Cmd+E'], other: 'dictating' });
  expect(answerPresses('Escape', 'dictating')).toEqual({
    presses: ['Cmd+E', 'Escape'],
    other: 'off',
  });
  expect(answerPresses('2', 'off')).toEqual({ presses: ['2'], other: 'off' });
});
