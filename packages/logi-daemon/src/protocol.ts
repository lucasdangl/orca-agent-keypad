import { z } from 'zod';

/**
 * Device protocol between the Logi C# plugin ("Logi") and this daemon: NDJSON over the daemon's stdin (Logi ->
 * daemon) and stdout (daemon -> Logi), one JSON object per line. Logs go to stderr only. Documented in
 * docs/device-protocol.md; a test keeps the message tables there equal to the schemas here.
 */
export const DEVICE_PROTOCOL_VERSION = 1;

/** Longest line either side accepts; an SVG key image is 1-5 KB. */
export const MAX_LINE = 256 * 1024;

const base = <T extends string>(type: T) =>
  z.object({ v: z.literal(DEVICE_PROTOCOL_VERSION), type: z.literal(type) });

const slotId = z.string().min(1).max(64);

// Logi -> daemon
export const hello = base('hello').extend({
  pluginVersion: z.string().max(64),
  device: z.object({
    model: z.string().max(64),
    cols: z.number().int().positive().max(16),
    rows: z.number().int().positive().max(16),
  }),
  /** Key image size in px that the device asks for (MX Creative Keypad: 116). */
  imageSize: z.number().int().positive().max(1024),
  /** What the daemon last sent in `saveSettings` (the plugin keeps it in the Logi plugin settings). */
  settings: z.record(z.unknown()),
});
export const keys = base('keys').extend({
  keys: z
    .array(
      z.object({
        slotId,
        kind: z.enum(['pane', 'status', 'attention', 'working']),
        /** 1-based, row-major key number on the device grid, when the plugin knows it (`slot-<n>` = n). */
        index: z.number().int().positive().optional(),
      }),
    )
    .max(256),
});
export const key = base('key').extend({ slotId, edge: z.enum(['down', 'up']) });
export const deviceState = base('deviceState').extend({ connected: z.boolean() });

// daemon -> Logi
export const ready = base('ready').extend({ daemonVersion: z.string() });
export const image = base('image').extend({ slotId, svg: z.string() });
export const saveSettings = base('saveSettings').extend({ settings: z.record(z.unknown()) });
export const alert = base('alert').extend({ slotId });

export const messageFromLogi = z.discriminatedUnion('type', [hello, keys, key, deviceState]);
export const messageToLogi = z.discriminatedUnion('type', [ready, image, saveSettings, alert]);
export type MessageFromLogi = z.infer<typeof messageFromLogi>;
export type MessageToLogi = z.infer<typeof messageToLogi>;
export type Hello = z.infer<typeof hello>;
export type Keys = z.infer<typeof keys>;
