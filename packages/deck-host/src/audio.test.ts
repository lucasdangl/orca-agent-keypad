import { expect, it } from 'vitest';
import { pauseMusic } from './audio.ts';

it.runIf(process.platform === 'darwin')(
  'pauses only the running players that play, and plays exactly those again',
  async () => {
    const calls: string[] = [];
    const exec = async (file: string, args: string[]) => {
      calls.push([file.split('/').pop(), ...args.filter((a) => a !== '-e')].join(' '));
      if (file.endsWith('pgrep')) {
        if (args[1] === 'Spotify') return '';
        throw new Error('no process'); // Music is not open
      }
      return args.includes('pause') ? 'paused\n' : '';
    };
    const play = await pauseMusic(exec, 1)();
    expect(calls.some((c) => c.startsWith('osascript') && c.includes('"Music"'))).toBe(false);
    expect(calls.filter((c) => c.startsWith('osascript'))).toHaveLength(1);
    expect(play).not.toBeNull();
    await play!();
    // Played, then checked: the mock never reports "playing", so it plays again after each check.
    const after = calls.slice(calls.findIndex((c) => c.endsWith('to play')));
    expect(after[0]).toBe('osascript tell application "Spotify" to play');
    expect(after.filter((c) => c.endsWith('to play'))).toHaveLength(5);
    expect(after.every((c) => c.includes('"Spotify"'))).toBe(true);
  },
);

it.runIf(process.platform === 'darwin')('pauses nothing when no player plays', async () => {
  const exec = async (file: string) => (file.endsWith('pgrep') ? '' : '\n');
  expect(await pauseMusic(exec, 1)()).toBeNull();
});
