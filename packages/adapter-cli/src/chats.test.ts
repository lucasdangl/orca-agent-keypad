import { expect, it } from 'vitest';
import { CliAdapter, type Exec } from './index.ts';

// Orca's agent chats (structured agent sessions) are no terminals: `worktree ps` lists their agent,
// `terminal.reveal` opens them, `session.tabs.list` says when one is in front (docs/logi-findings.md §8).

const CHAT = 'structured-agent-session-s1:leaf-1';
const ok = (result: unknown) => JSON.stringify({ ok: true, result });

const chatAgent = (extra: Record<string, unknown> = {}) => ({
  paneKey: CHAT,
  orcaSessionId: 's1',
  parentPaneKey: null,
  state: 'waiting',
  agentType: 'claude',
  conversationName: 'Fix the login',
  stateStartedAt: 1,
  ...extra,
});

const ps = (agents: unknown[], isActive = true) =>
  ok({
    worktrees: [
      {
        worktreeId: 'w',
        repo: 'app',
        branch: 'refs/heads/main',
        hostId: 'local',
        isActive,
        agents,
      },
    ],
  });

const terms = ok({
  terminals: [
    {
      handle: 'h1',
      worktreeId: 'w',
      tabId: 't1',
      leafId: 'l1',
      title: 'zsh',
      connected: true,
    },
  ],
  visualLayouts: [
    {
      worktreeId: 'w',
      root: {
        type: 'group',
        activeTabId: 't1',
        tabs: [{ tabId: 't1', activeLeafId: 'l1', panes: {} }],
      },
    },
  ],
});

function adapter(
  agents: unknown[],
  tabs: (() => string) | null = null,
): { a: CliAdapter; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (args) => {
    calls.push(args);
    const k = args.slice(0, 2).join(' ');
    if (k === 'terminal list') return terms;
    if (k === 'worktree ps') return ps(agents);
    if (k === 'host list') throw new Error('no hosts');
    if (k === 'session tabs') {
      if (!tabs) throw new Error('session tabs need the runtime socket');
      return tabs();
    }
    if (k === 'terminal reveal') return ok({ reveal: { navigated: true } });
    if (k === 'terminal show') return ok({ terminal: { tabId: 't1', leafId: 'l1' } });
    throw new Error(`unexpected ${k}`);
  };
  return { a: new CliAdapter(exec), calls };
}

it('lists an agent chat as a pane next to the terminals, with its status', async () => {
  const s = await adapter([chatAgent()]).a.snapshot();
  expect(s.panes.map((p) => p.paneKey)).toEqual(['t1:l1', CHAT]);
  expect(s.panes[1]).toMatchObject({
    kind: 'chat',
    handle: '',
    title: 'Fix the login',
    worktreeId: 'w',
    hostId: 'local',
    agentType: 'claude',
    repo: 'app',
    branch: 'main',
    connected: true,
  });
  expect(s.statuses.find((x) => x.paneKey === CHAT)?.state).toBe('waiting');
});

it('names a chat by its user-set name first and falls back to the agent', async () => {
  const named = await adapter([chatAgent({ displayName: 'Mine' })]).a.snapshot();
  expect(named.panes[1]?.title).toBe('Mine');
  const bare = await adapter([chatAgent({ conversationName: null })]).a.snapshot();
  expect(bare.panes[1]?.title).toBe('claude chat');
});

it('gives subagents of a chat no pane of their own', async () => {
  const sub = chatAgent({ paneKey: 'structured-agent-session-s1:sub', parentPaneKey: CHAT });
  const s = await adapter([chatAgent(), sub]).a.snapshot();
  expect(s.panes.filter((p) => p.kind === 'chat').map((p) => p.paneKey)).toEqual([CHAT]);
});

it('focuses a chat through terminal reveal with its tab and leaf, never terminal switch', async () => {
  const { a, calls } = adapter([chatAgent()]);
  const r = await a.focus({ paneKey: CHAT, hostId: 'local', handle: '', worktreeId: 'w' });
  expect(r).toEqual({ ok: true });
  expect(calls).toEqual([
    [
      'terminal',
      'reveal',
      '--worktree',
      'w',
      '--tab',
      'structured-agent-session-s1',
      '--leaf',
      'leaf-1',
      '--json',
    ],
  ]);
});

it('fails a chat focus without the runtime socket instead of switching some terminal', async () => {
  const calls: string[] = [];
  const a = new CliAdapter(async (args) => {
    calls.push(args.slice(0, 2).join(' '));
    throw new Error('reveal needs the runtime socket');
  });
  const r = await a.focus({ paneKey: CHAT, hostId: 'local', handle: '', worktreeId: 'w' });
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/runtime socket/);
  expect(calls).toEqual(['terminal reveal']);
});

it('focusedPaneKey names the chat in front, which the terminal layout does not know', async () => {
  const { a } = adapter([chatAgent()], () =>
    ok({ activeTabId: 'agent-session:s1', activeTabType: 'agent-session' }),
  );
  expect(await a.focusedPaneKey()).toBe(CHAT);
});

it('focusedPaneKey keeps the layout answer when a terminal is in front of a worktree with chats', async () => {
  const { a } = adapter([chatAgent()], () =>
    ok({ activeTabId: 't1::l1', activeTabType: 'terminal' }),
  );
  expect(await a.focusedPaneKey()).toBe('t1:l1');
});

it('focusedPaneKey answers null for a chat in front that worktree ps does not list yet', async () => {
  const { a } = adapter([chatAgent()], () =>
    ok({ activeTabId: 'agent-session:other', activeTabType: 'agent-session' }),
  );
  expect(await a.focusedPaneKey()).toBe(null);
});

it('focusedPaneKey falls back to the layout when the session tabs cannot be read', async () => {
  const { a } = adapter([chatAgent()], null);
  expect(await a.focusedPaneKey()).toBe('t1:l1');
});

it('focusedPaneKey does not ask for session tabs in a worktree without chats', async () => {
  const { a, calls } = adapter([], () => {
    throw new Error('not expected');
  });
  expect(await a.focusedPaneKey()).toBe('t1:l1');
  expect(calls.some((c) => c[0] === 'session')).toBe(false);
});
