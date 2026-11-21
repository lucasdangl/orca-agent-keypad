namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.IO;

    // The plugin log (Logs/plugin_logs/OrcaKeypad.log) is truncated every time the plugin loads, so what happened
    // before a reload or crash is lost there. Lifecycle lines and the daemon's stderr also go to
    // <plugin data dir>/daemon.log, appended, rotated to daemon.log.1 at 1 MB. Never terminal content or tokens: the
    // daemon logs metadata only.
    internal static class FileLog
    {
        private const Int64 MaxBytes = 1024 * 1024;
        private static readonly Object Gate = new();
        private static String _path;

        public static String Path => _path;

        public static void Init(String dataDir)
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                _path = System.IO.Path.Combine(dataDir, "daemon.log");
            }
            catch (Exception ex)
            {
                PluginLog.Warning(ex, "cannot create the plugin data directory");
            }
        }

        public static void Info(String line)
        {
            PluginLog.Info(line);
            Append(line);
        }

        public static void Warning(String line)
        {
            PluginLog.Warning(line);
            Append(line);
        }

        // Daemon stderr: it carries its own timestamp and level.
        public static void Daemon(String line)
        {
            PluginLog.Info($"daemon: {line}");
            Append($"daemon: {line}", stamp: false);
        }

        private static void Append(String line, Boolean stamp = true)
        {
            if (_path == null)
            {
                return;
            }
            lock (Gate)
            {
                try
                {
                    var info = new FileInfo(_path);
                    if (info.Exists && info.Length > MaxBytes)
                    {
                        File.Move(_path, _path + ".1", overwrite: true);
                    }
                    var text = stamp ? $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ} plugin: {line}" : line;
                    File.AppendAllText(_path, text + Environment.NewLine);
                }
                catch
                {
                    // Logging must never take the plugin down.
                }
            }
        }
    }
}
