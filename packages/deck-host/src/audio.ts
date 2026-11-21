import { execFile } from 'node:child_process';

/** Pauses playing music for a dictation; `pause` answers how to play it again, null when nothing was paused. */
export type PauseMedia = () => Promise<(() => Promise<void>) | null>;

/** Players `pauseMusic` controls: the app name of their process and of their AppleScript dictionary. */
export const MUSIC_PLAYERS = ['Spotify', 'Music'] as const;

type Run = (file: string, args: string[]) => Promise<string>;

/** Runs a program, answers its output. */
const run: Run = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 3000 }, (err, out) =>
      err ? reject(err) : resolve(String(out)),
    );
  });

/**
 * macOS: pauses Spotify and Apple Music where they play, through AppleScript, and plays exactly those again after.
 * Only running players are asked (`tell application` would start one), so a player that is not open stays closed.
 * The media key the Logi SDK sends does not reach the players (tested 2026-11-21, docs/logi-findings.md §12). The
 * first time, macOS asks whether the Logi plugin service may control the player.
 */
export function pauseMusic(exec: Run = run, checkEveryMs = 1000): PauseMedia {
  return async () => {
    if (process.platform !== 'darwin') return null;
    const paused: string[] = [];
    for (const app of MUSIC_PLAYERS) {
      const running = await exec('/usr/bin/pgrep', ['-xq', app]).then(
        () => true,
        () => false,
      );
      if (!running) continue;
      const r = await exec('/usr/bin/osascript', [
        '-e',
        `tell application "${app}"`,
        '-e',
        'if player state is playing then',
        '-e',
        'pause',
        '-e',
        'return "paused"',
        '-e',
        'end if',
        '-e',
        'end tell',
      ]).catch(() => '');
      if (r.trim() === 'paused') paused.push(app);
    }
    if (paused.length === 0) return null;
    return async () => {
      for (const app of paused) await playUntilPlaying(exec, app, 4, checkEveryMs);
    };
  };
}

/**
 * Plays a player again and checks that it keeps playing: when the microphone stops, a Bluetooth headset switches back
 * from its headset profile and the player can pause on that route change. Checks for a few seconds, plays again when
 * it stopped.
 */
async function playUntilPlaying(exec: Run, app: string, checks = 4, everyMs = 1000): Promise<void> {
  const state = () =>
    exec('/usr/bin/osascript', ['-e', `tell application "${app}" to player state as string`])
      .then((s) => s.trim())
      .catch(() => '');
  const play = () =>
    exec('/usr/bin/osascript', ['-e', `tell application "${app}" to play`]).catch(() => '');
  await play();
  for (let i = 0; i < checks; i++) {
    await new Promise((r) => setTimeout(r, everyMs));
    if ((await state()) !== 'playing') await play();
  }
}
