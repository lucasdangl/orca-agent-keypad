import { expect, it } from 'vitest';
import { audioOutActive } from './audio.ts';

it('sees playing audio in the coreaudiod output assertion of pmset', () => {
  const playing = `Listed by owning process:
   pid 528(coreaudiod): [0x0001582400018656] 00:00:12 PreventUserIdleSystemSleep named: "com.apple.audio.70-F9-4A-94-C8-CF:output.context.preventuseridlesleep"
\tResources: audio-out 70-F9-4A-94-C8-CF:output
   pid 401(powerd): [0x00015] 00:10:00 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"`;
  expect(audioOutActive(playing)).toBe(true);
  expect(
    audioOutActive(
      'Listed by owning process:\n   pid 401(powerd): [0x1] PreventUserIdleSystemSleep named: "Powerd - display"',
    ),
  ).toBe(false);
});
