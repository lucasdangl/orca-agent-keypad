namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;

    // Finds a Node >= 22.6 for the daemon. The Logi Plugin Service runs plugins with PATH=/usr/bin:/bin:/usr/sbin:/sbin
    // (docs/logi-findings.md), so `node` has to be found by absolute path. Order: plugin setting `nodePath`, Homebrew,
    // Volta, nvm (newest), what a login shell finds, and last the Node that the Logi Plugin Service brings for its own
    // Node.js plugin host (undocumented, may change with Options+ updates).
    internal static class NodeLocator
    {
        public const String NodePathSetting = "nodePath";
        private static readonly Version Min = new(22, 6, 0);

        public sealed record Found(String Path, String Source, Version Version);

        public static Found Find(Plugin plugin)
        {
            foreach (var (source, path) in Candidates(plugin))
            {
                if (String.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    continue;
                }
                var v = VersionOf(path);
                if (v == null)
                {
                    FileLog.Warning($"node [{source}] {path}: does not answer -v");
                    continue;
                }
                if (v < Min)
                {
                    FileLog.Warning($"node [{source}] {path}: v{v} is older than {Min}");
                    continue;
                }
                FileLog.Info($"node [{source}] {path} v{v}");
                return new Found(path, source, v);
            }
            return null;
        }

        private static IEnumerable<(String Source, String Path)> Candidates(Plugin plugin)
        {
            if (plugin.TryGetPluginSetting(NodePathSetting, out var configured) && !String.IsNullOrWhiteSpace(configured))
            {
                yield return ("setting", configured.Trim());
            }
            var env = Environment.GetEnvironmentVariable("ORCA_KEYPAD_NODE");
            if (!String.IsNullOrWhiteSpace(env))
            {
                yield return ("env", env);
            }
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            yield return ("homebrew", "/opt/homebrew/bin/node");
            yield return ("homebrew", "/usr/local/bin/node");
            yield return ("volta", Path.Combine(home, ".volta/bin/node"));
            var nvm = Path.Combine(home, ".nvm/versions/node");
            if (Directory.Exists(nvm))
            {
                var newest = Directory.GetDirectories(nvm)
                    .Select(d => (Dir: d, V: ParseVersion(Path.GetFileName(d))))
                    .Where(x => x.V != null)
                    .OrderByDescending(x => x.V);
                foreach (var (dir, _) in newest)
                {
                    yield return ("nvm", Path.Combine(dir, "bin/node"));
                }
            }
            yield return ("login-shell", LoginShellNode());
            yield return ("logi-bundled", Path.Combine(home, "Library/Application Support/Logi/LogiPluginService/PluginHosts/node22/node/bin/node"));
        }

        private static Version ParseVersion(String s)
        {
            s = s.Trim().TrimStart('v');
            var dash = s.IndexOf('-');
            if (dash >= 0)
            {
                s = s[..dash];
            }
            return Version.TryParse(s, out var v) ? v : null;
        }

        private static Version VersionOf(String node)
        {
            var output = Run(node, new[] { "-v" });
            return output == null ? null : ParseVersion(output);
        }

        // What `command -v node` finds in a login shell (asdf, fnm, a PATH from .zprofile).
        private static String LoginShellNode()
        {
            var shell = Environment.GetEnvironmentVariable("SHELL");
            if (String.IsNullOrEmpty(shell) || !File.Exists(shell))
            {
                shell = "/bin/zsh";
            }
            var output = Run(shell, new[] { "-lc", "command -v node" });
            return String.IsNullOrWhiteSpace(output) ? null : output.Trim().Split('\n').Last().Trim();
        }

        private static String Run(String file, String[] args)
        {
            try
            {
                var psi = new ProcessStartInfo(file)
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    RedirectStandardInput = true,
                    CreateNoWindow = true,
                };
                foreach (var a in args)
                {
                    psi.ArgumentList.Add(a);
                }
                using var p = Process.Start(psi);
                p.StandardInput.Close();
                var read = p.StandardOutput.ReadToEndAsync();
                if (!p.WaitForExit(5000))
                {
                    p.Kill(true);
                    return null;
                }
                return p.ExitCode == 0 ? read.Result : null;
            }
            catch
            {
                return null;
            }
        }
    }
}
