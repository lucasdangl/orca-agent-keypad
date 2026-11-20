namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // Shared state of Spike A: the image update interval, persisted via the plugin settings API.
    internal static class SpikeState
    {
        public static readonly Int32[] Intervals = { 1000, 500, 250, 125, 66, 33 };
        public const String IntervalSetting = "spikeIntervalMs";

        public static Int32 IntervalMs { get; private set; } = 1000;

        public static event Action IntervalChanged;

        public static void Load(Plugin plugin)
        {
            if (plugin.TryGetPluginSetting(IntervalSetting, out var s) && Int32.TryParse(s, out var ms) && ms > 0)
            {
                IntervalMs = ms;
            }
            PluginLog.Info($"spike: settings loaded, {IntervalSetting}={IntervalMs} (raw='{s}')");
        }

        public static void Next(Plugin plugin)
        {
            var idx = Array.IndexOf(Intervals, IntervalMs);
            IntervalMs = Intervals[(idx + 1) % Intervals.Length];
            plugin.SetPluginSetting(IntervalSetting, IntervalMs.ToString(), false);
            PluginLog.Info($"spike: interval -> {IntervalMs} ms (saved)");
            IntervalChanged?.Invoke();
        }
    }
}
