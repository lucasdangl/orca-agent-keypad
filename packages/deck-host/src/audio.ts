import { execFile } from 'node:child_process';

/**
 * Is sound playing right now (music, a video)? macOS: coreaudiod holds a power assertion with an `audio-out` resource
 * while an output plays (`pmset -g assertions`), whatever the player. False elsewhere and on any error.
 */
export function audioPlaying(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 1500 }, (err, out) => {
      resolve(!err && audioOutActive(String(out)));
    });
  });
}

/** `pmset -g assertions` output: does coreaudiod hold an assertion for an audio output? */
export function audioOutActive(pmset: string): boolean {
  return /coreaudiod\)[^\n]*output\.context/.test(pmset) || /Resources:\s*audio-out\b/.test(pmset);
}
