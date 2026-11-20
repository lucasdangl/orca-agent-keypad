// `pnpm logi-sim [--bundle] [--out tmp/keys]`: the Logi keypad without the keypad. Starts the Logi daemon, plays the
// C# plugin over its stdin/stdout and writes every key image to <out>/<slot>.svg plus <out>/index.html (a 3 x 3 grid
// that reloads itself). Orca and plugin A are simulated (scripts/logi-sim-lib.ts): nothing touches the real Orca or
// ~/.orca-deck. Type `help` for the commands.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { addPane, advance, setAgent, type AgentState } from '../packages/fake-orca/src/index.ts';
import { DAEMON_BUNDLE, DAEMON_SOURCE, FakeOrcaEnv, LogiSim, REPO } from './logi-sim-lib.ts';

const args = process.argv.slice(2);
const out = resolve(
  args.includes('--out') ? args[args.indexOf('--out') + 1]! : join(REPO, 'tmp/keys'),
);
const daemon = args.includes('--bundle') ? DAEMON_BUNDLE : DAEMON_SOURCE;
const SLOTS = 9;

mkdirSync(out, { recursive: true });
const fileOf = (slot: string) => `${slot.replace(/[^a-z0-9-]/gi, '_')}.svg`;
const order = [
  ...Array.from({ length: SLOTS }, (_, i) => `logi:slot-${i + 1}`),
  'logi:status',
  'logi:attention',
];
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>logi-sim</title>
<body style="background:#111;color:#999;font:12px system-ui;margin:16px">
<div id="g" style="display:grid;grid-template-columns:repeat(3,116px);gap:8px"></div>
<p>Status and Attention:</p><div id="i" style="display:flex;gap:8px"></div>
<script>
const slots = ${JSON.stringify(order.map((s) => [s, fileOf(s)]))};
function draw() {
  const t = Date.now();
  g.innerHTML = slots.slice(0, ${SLOTS}).map(([s, f]) => '<img title="' + s + '" width="116" height="116" src="' + f + '?' + t + '" onerror="this.style.visibility=\\'hidden\\'">').join('');
  i.innerHTML = slots.slice(${SLOTS}).map(([s, f]) => '<img title="' + s + '" width="116" height="116" src="' + f + '?' + t + '" onerror="this.style.display=\\'none\\'">').join('');
}
draw(); setInterval(draw, 500);
</script>`,
);

const orca = await FakeOrcaEnv.create((s) => {
  addPane(s, 'a', { title: 'api refactor' });
  addPane(s, 'b', { title: 'docs review', agent: 'codex' });
  addPane(s, 'c', { title: 'payments' });
  addPane(s, 'd', { title: 'zsh', agent: null });
});
const sim = new LogiSim(daemon, orca.env, { logFile: join(out, 'daemon.log') });
sim.onImage = (slot, svg) => writeFileSync(join(out, fileOf(slot)), svg);
sim.hello();
sim.keys(SLOTS, { status: true, attention: true });
await sim.until(() => sim.images.size > 0);
const a = orca.pluginA();
await a.connect({ minor: 5 });
let req = 0;
const map = async (key: number, pane: string) => {
  a.send({
    v: 1,
    type: 'assignKey',
    requestId: `sim-${++req}`,
    key,
    replace: true,
    paneKey: `tab-1:leaf-${pane}`,
  });
  return a.waitFor((m) => m.type === 'pairResult' && m['requestId'] === `sim-${req}`);
};
await map(1, 'a');
await map(2, 'b');
await map(3, 'c');
await map(4, 'd');

const STATES: AgentState[] = ['working', 'waiting', 'blocked', 'done', 'idle'];
const HELP = `commands:
  tap <key>                tap Pane key 1-9 (focuses its pane in the fake Orca)
  hold <key>               hold it 1.2 s (asks plugin A to open the panel)
  state <pane> <state>     ${STATES.join('|')} for pane a-d (pushed by plugin A)
  quiet <pane> <state>     the same without a push (the daemon finds it on its 2 s poll)
  map <key> <pane>         put pane a-d on key 1-9 (the Orca panel's key picker)
  focused                  which pane the fake Orca has focused
  quit                     close stdin as the C# plugin does when it unloads
images: ${join(out, 'index.html')}   daemon log: ${join(out, 'daemon.log')}`;
console.log(HELP);

const rl = createInterface({ input: process.stdin, prompt: 'logi-sim> ' });
rl.prompt();
for await (const line of rl) {
  const [cmd, x, y] = line.trim().split(/\s+/);
  try {
    if (!cmd) {
      // empty line
    } else if (cmd === 'tap' && x) sim.tap(`logi:slot-${x}`);
    else if (cmd === 'hold' && x) await sim.hold(`logi:slot-${x}`);
    else if ((cmd === 'state' || cmd === 'quiet') && x && STATES.includes(y as AgentState)) {
      advance(orca.s, 1000);
      setAgent(orca.s, x, y as AgentState);
      orca.persist();
      if (cmd === 'state') a.sendStatus(orca.s, x);
    } else if (cmd === 'map' && x && y) console.log(await map(Number(x), y));
    else if (cmd === 'focused')
      console.log(orca.s.panes.find((p) => p.handle === orca.s.focusedHandle)?.key ?? 'none');
    else if (cmd === 'quit') break;
    else console.log(HELP);
  } catch (e) {
    console.log(String(e));
  }
  rl.prompt();
}
a.close();
console.log(`daemon exited with ${await sim.close()}`);
await orca.stop();
process.exit(0);
