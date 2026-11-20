namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.Text.Json.Nodes;
    using System.Threading;

    // The Node daemon (daemon.mjs, plugin B for the keypad) as our child process. Talks the device protocol

    // (docs/device-protocol.md): one JSON object per line on its stdin and stdout; its stderr is its log.

    // Restarts it after a crash, 1 s doubling to 30 s (back to 1 s once a run lasted a minute). Stop() closes its

    // stdin, which makes it stop its bridge, remove bridge.json and exit.
    internal sealed class DaemonProcess : IDisposable
    {
        private const Int32 MinBackoffMs = 1000;
        private const Int32 MaxBackoffMs = 30_000;
        private static readonly TimeSpan StableRun = TimeSpan.FromMinutes(1);

        private readonly Func<(String Node, String Script)> _resolve;
        private readonly Object _gate = new();
        private Process _proc;
        private Boolean _stopping;
        private Int32 _backoffMs = MinBackoffMs;
        private DateTime _startedAt;
        private Timer _restart;

        // A message from the daemon (already parsed). Called on a thread-pool thread.
        public event Action<JsonObject> Message;

        // The daemon (re)started: the owner sends hello and keys.
        public event Action Started;

        // Why the daemon cannot run (no Node, no daemon.mjs), or null while it can.
        public String Problem { get; private set; }

        public DaemonProcess(Func<(String Node, String Script)> resolve) => this._resolve = resolve;

        public void Start()
        {
            lock (this._gate)
            {
                this._stopping = false;
                this.StartLocked();
            }
        }

        private void StartLocked()
        {
            if (this._stopping || this._proc != null)
            {
                return;
            }
            (String node, String script) = (null, null);
            try
            {
                (node, script) = this._resolve();
            }
            catch (Exception ex)
            {
                FileLog.Warning($"daemon: cannot resolve node or daemon.mjs: {ex.Message}");
            }
            if (node == null || script == null || !File.Exists(script))
            {
                this.Problem = node == null ? "Node 22.6+ not found" : "daemon.mjs missing";
                FileLog.Warning($"daemon not started: {this.Problem} (script={script ?? "?"})");
                this.ScheduleRestartLocked();
                return;
            }
            this.Problem = null;
            var psi = new ProcessStartInfo(node)
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = Path.GetDirectoryName(script),
            };
            psi.ArgumentList.Add(script);

            // The service's PATH is /usr/bin:/bin:/usr/sbin:/sbin. Put the dirs where `orca` and `tmux` usually live

            // in front, for the CLI fallback and the Setup doctor (the daemon also finds Orca's app bundle itself).
            var path = Environment.GetEnvironmentVariable("PATH") ?? "/usr/bin:/bin:/usr/sbin:/sbin";
            psi.Environment["PATH"] = $"{Path.GetDirectoryName(node)}:/opt/homebrew/bin:/usr/local/bin:{path}";
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (_, e) => this.OnLine(e.Data);
            p.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null)
                {
                    FileLog.Daemon(e.Data);
                }
            };
            p.Exited += (_, _) => this.OnExited(p);
            try
            {
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                this.Problem = "Node could not be started";
                FileLog.Warning($"daemon: start failed: {ex.Message}");
                p.Dispose();
                this.ScheduleRestartLocked();
                return;
            }
            this._proc = p;
            this._startedAt = DateTime.UtcNow;
            FileLog.Info($"daemon started: pid {p.Id}, {node} {script}");
            ThreadPool.QueueUserWorkItem(_ => this.Started?.Invoke());
        }

        private void OnLine(String line)
        {
            if (String.IsNullOrWhiteSpace(line))
            {
                return;
            }
            JsonObject m;
            try
            {
                m = JsonNode.Parse(line) as JsonObject;
            }
            catch
            {
                m = null;
            }

            // Never the content in the log.
            if (m == null)
            {
                FileLog.Warning($"daemon: stdout line is not a JSON object ({line.Length} chars), ignored");
                return;
            }
            try
            {
                this.Message?.Invoke(m);
            }
            catch (Exception ex)
            {
                FileLog.Warning($"daemon: handling {m["type"]} failed: {ex.Message}");
            }
        }

        private void OnExited(Process p)
        {
            lock (this._gate)
            {
                Int32 code;
                try
                {
                    code = p.ExitCode;
                }
                catch
                {
                    code = -1;
                }
                if (this._proc != p)
                {
                    return;
                }
                this._proc = null;
                p.Dispose();
                if (this._stopping)
                {
                    FileLog.Info($"daemon exited: code {code}");
                    return;
                }
                if (DateTime.UtcNow - this._startedAt > StableRun)
                {
                    this._backoffMs = MinBackoffMs;
                }
                FileLog.Warning($"daemon exited unexpectedly: code {code}, restart in {this._backoffMs} ms");
                this.ScheduleRestartLocked();
            }
        }

        private void ScheduleRestartLocked()
        {
            if (this._stopping)
            {
                return;
            }
            var wait = this._backoffMs;
            this._backoffMs = Math.Min(this._backoffMs * 2, MaxBackoffMs);
            this._restart?.Dispose();
            this._restart = new Timer(
                _ =>
                {
                    lock (this._gate)
                    {
                        this.StartLocked();
                    }
                },
                null,
                wait,
                Timeout.Infinite);
        }

        public void Send(JsonObject m)
        {
            m["v"] = 1;
            var line = m.ToJsonString();
            lock (this._gate)
            {
                var p = this._proc;
                if (p == null)
                {
                    return;
                }
                try
                {
                    p.StandardInput.WriteLine(line);
                    p.StandardInput.Flush();
                }
                catch (Exception ex)
                {
                    // The daemon is going away; Exited restarts it.
                    FileLog.Warning($"daemon: write failed: {ex.GetType().Name}");
                }
            }
        }

        public void Stop()
        {
            Process p;
            lock (this._gate)
            {
                this._stopping = true;
                this._restart?.Dispose();
                this._restart = null;
                p = this._proc;
            }
            if (p == null)
            {
                return;
            }
            try
            {
                // stdin EOF: the daemon stops its bridge, removes bridge.json and exits 0.
                p.StandardInput.Close();
                if (!p.WaitForExit(3000))
                {
                    FileLog.Warning("daemon did not exit on stdin EOF, killing it");
                    p.Kill(true);
                }
            }
            catch (Exception ex)
            {
                FileLog.Warning($"daemon: stop failed: {ex.Message}");
            }
        }

        public void Dispose() => this.Stop();
    }
}
