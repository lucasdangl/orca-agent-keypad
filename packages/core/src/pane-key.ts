/** A pane key is `${tabId}:${leafId}`, stable across handle changes; it is stored and sent as is. */
export const paneKey = (tabId: string, leafId: string): string => `${tabId}:${leafId}`;

/** Tab id prefix of Orca's agent chats (structured agent sessions): `structured-agent-session-<sessionId>`. */
export const CHAT_TAB_PREFIX = 'structured-agent-session-';

/** Is this the pane key of an Orca agent chat? */
export const isChatPaneKey = (key: string): boolean => key.startsWith(CHAT_TAB_PREFIX);

/** The two parts of a pane key; a missing part is an empty string. */
export function splitPaneKey(key: string): { tabId: string; leafId: string } {
  const [tabId = '', leafId = ''] = key.split(':');
  return { tabId, leafId };
}
