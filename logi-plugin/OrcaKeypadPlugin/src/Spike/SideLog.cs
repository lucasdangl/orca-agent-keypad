namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.IO;

    // The plugin log file is truncated whenever the plugin loads, so Unload lines vanish on a reload.
    // Spike-only: append lifecycle lines to <plugin data dir>/spike-lifecycle.log as well.
    internal static class SideLog
    {
        private static String _path;
        private static readonly Object Gate = new();

        public static void Init(String dataDir)
        {
            Directory.CreateDirectory(dataDir);
            _path = Path.Combine(dataDir, "spike-lifecycle.log");
        }

        public static void Write(String line)
        {
            PluginLog.Info(line);
            if (_path == null)
            {
                return;
            }
            lock (Gate)
            {
                File.AppendAllText(_path, $"{DateTime.Now:yyyy-MM-ddTHH:mm:ss.fff} {line}{Environment.NewLine}");
            }
        }
    }
}
