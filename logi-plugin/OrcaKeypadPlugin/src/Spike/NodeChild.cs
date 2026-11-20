namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;

    // Spike B: can the plugin start `node` as a child process, which PATH does the plugin
    // service give us, and does stdout arrive line by line?
    internal sealed class NodeChild : IDisposable
    {
        public const String NodePathSetting = "nodePath";

        // The child prints one diagnostics line, then {t:...} every second, and exits on stdin EOF
        // (what the real daemon will do) or when its parent pid changes.
        private const String Script =
            "const fs=require('fs'),os=require('os'),path=require('path');" +
            "const rt=path.join(os.homedir(),'Library/Application Support/orca/orca-runtime.json');" +
            "let rtOk;try{fs.accessSync(rt,fs.constants.R_OK);rtOk=true}catch(e){rtOk=String(e.code)}" +
            "console.log(JSON.stringify({hello:1,pid:process.pid,ppid:process.ppid,node:process.version,execPath:process.execPath,cwd:process.cwd(),home:os.homedir(),PATH:process.env.PATH,orcaRuntimeReadable:rtOk}));" +
            "console.error('stderr works');" +
            "const pp=process.ppid;" +
            "setInterval(()=>{console.log(JSON.stringify({t:Date.now()}));if(process.ppid!==pp){console.error('parent gone');process.exit(3)}},1000);" +
            "process.stdin.on('data',d=>console.log(JSON.stringify({echo:String(d).trim()})));" +
            "process.stdin.on('end',()=>{console.error('stdin EOF, exiting');process.exit(0)});";

        private readonly Plugin _plugin;
        private Process _proc;

        public NodeChild(Plugin plugin) => this._plugin = plugin;

        public void Start()
        {
            LogEnvironment();
            var node = this.ResolveNode();
            if (node == null)
            {
                PluginLog.Error("spikeB: no node binary found");
                return;
            }

            var psi = new ProcessStartInfo(node)
            {
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-e");
            psi.ArgumentList.Add(Script);
            try
            {
                this._proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                this._proc.OutputDataReceived += (_, e) =>
                {
                    if (e.Data != null)
                    {
                        PluginLog.Info($"spikeB: node stdout: {e.Data}");
                    }
                };
                this._proc.ErrorDataReceived += (_, e) =>
                {
                    if (e.Data != null)
                    {
                        SideLog.Write($"spikeB: node stderr: {e.Data}");
                    }
                };
                var proc = this._proc;
                proc.Exited += (_, _) => SideLog.Write($"spikeB: node pid={proc.Id} exited code={SafeExitCode(proc)}");
                this._proc.Start();
                this._proc.BeginOutputReadLine();
                this._proc.BeginErrorReadLine();
                SideLog.Write($"spikeB: started {node} pid={this._proc.Id} (plugin pid={Environment.ProcessId})");
                this._proc.StandardInput.WriteLine("{\"ping\":1}");
                this._proc.StandardInput.Flush();
            }
            catch (Exception ex)
            {
                PluginLog.Error(ex, $"spikeB: failed to start {node}");
            }
        }

        private static String SafeExitCode(Process p)
        {
            try
            {
                return p.ExitCode.ToString();
            }
            catch
            {
                return "?";
            }
        }

        private static void LogEnvironment()
        {
            PluginLog.Info($"spikeB: plugin pid={Environment.ProcessId} process={Process.GetCurrentProcess().ProcessName} user={Environment.UserName} cwd={Environment.CurrentDirectory}");
            PluginLog.Info($"spikeB: PATH={Environment.GetEnvironmentVariable("PATH")}");
            PluginLog.Info($"spikeB: HOME={Environment.GetEnvironmentVariable("HOME")} SHELL={Environment.GetEnvironmentVariable("SHELL")}");
        }

        private String ResolveNode()
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var candidates = new List<(String Source, String Path)>();
            if (this._plugin.TryGetPluginSetting(NodePathSetting, out var configured) && !String.IsNullOrWhiteSpace(configured))
            {
                candidates.Add(("setting", configured));
            }
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(':', StringSplitOptions.RemoveEmptyEntries))
            {
                candidates.Add(("PATH", Path.Combine(dir, "node")));
            }
            candidates.Add(("fixed", "/opt/homebrew/bin/node"));
            candidates.Add(("fixed", "/usr/local/bin/node"));
            candidates.Add(("fixed", Path.Combine(home, ".volta/bin/node")));
            var nvm = Path.Combine(home, ".nvm/versions/node");
            if (Directory.Exists(nvm))
            {
                foreach (var d in Directory.GetDirectories(nvm).OrderByDescending(d => d, StringComparer.Ordinal))
                {
                    candidates.Add(("nvm", Path.Combine(d, "bin/node")));
                }
            }
            candidates.Add(("logi-bundled", Path.Combine(home, "Library/Application Support/Logi/LogiPluginService/PluginHosts/node22/node/bin/node")));
            candidates.Add(("login-shell", LoginShellNode()));

            String chosen = null;
            foreach (var (source, path) in candidates)
            {
                var ok = path != null && File.Exists(path);
                PluginLog.Info($"spikeB: candidate [{source}] {path ?? "(none)"} exists={ok}");
                if (ok && chosen == null)
                {
                    chosen = path;
                }
            }
            PluginLog.Info($"spikeB: chosen node={chosen ?? "(none)"}");
            return chosen;
        }

        // What a login shell would resolve, for comparison only (spawns zsh -lc once).
        private static String LoginShellNode()
        {
            try
            {
                var psi = new ProcessStartInfo("/bin/zsh") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
                psi.ArgumentList.Add("-lc");
                psi.ArgumentList.Add("command -v node");
                using var p = Process.Start(psi);
                var output = p.StandardOutput.ReadToEnd().Trim();
                p.WaitForExit(3000);
                return output.Length > 0 ? output : null;
            }
            catch (Exception ex)
            {
                PluginLog.Warning(ex, "spikeB: login shell probe failed");
                return null;
            }
        }

        public void Dispose()
        {
            var p = this._proc;
            this._proc = null;
            if (p == null || p.HasExited)
            {
                return;
            }
            try
            {
                SideLog.Write($"spikeB: closing node stdin (pid={p.Id})");
                p.StandardInput.Close();
                if (!p.WaitForExit(2000))
                {
                    SideLog.Write("spikeB: node did not exit on stdin EOF, killing");
                    p.Kill();
                }
            }
            catch (Exception ex)
            {
                PluginLog.Warning(ex, "spikeB: stopping node failed");
            }
        }
    }
}
