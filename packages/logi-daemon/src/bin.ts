// Entry point of the Logi daemon (`daemon.mjs`): the Logi C# plugin starts it as a child process and talks to it in
// NDJSON on stdin/stdout. stdout is the protocol: everything else, any console output included, goes to stderr.
import { runDaemon } from './daemon.ts';

for (const k of ['log', 'info', 'debug'] as const) console[k] = console.error;

await runDaemon({ input: process.stdin, output: process.stdout, parent: process.ppid });
// Timers of the adapters (pollers, retries) must not keep an orphan alive.
process.exit(0);
