namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.Collections.Concurrent;
    using System.Threading;

    // Spike A: one parameterized command "Orca Pane" with parameters slot-1 .. slot-9.
    // Every slot shows a counter that a timer advances (default 1/s). The image is built from
    // PNG bytes encoded outside the SDK (BitmapImage.FromArray) with text drawn on top.
    // Logs: requested PluginImageSize, builder size, real GetCommandImage rate, all button events.
    public class OrcaPaneCommand : PluginDynamicCommand
    {
        private const Int32 Slots = 9;
        private readonly Int32[] _counter = new Int32[Slots + 1];
        private readonly Int32[] _ticks = new Int32[Slots + 1];
        private readonly Int32[] _renders = new Int32[Slots + 1];
        private readonly ConcurrentDictionary<String, Boolean> _seenSizes = new();
        private Timer _timer;
        private Timer _statsTimer;
        private DateTime _statsSince = DateTime.UtcNow;

        public OrcaPaneCommand()
            : base()
        {
            this.DisplayName = "Orca Pane";
            this.GroupName = "Orca";
            for (var i = 1; i <= Slots; i++)
            {
                this.AddParameter($"slot-{i}", $"Orca Pane {i}", "Orca Panes");
            }
        }

        protected override Boolean OnLoad()
        {
            SpikeState.IntervalChanged += this.Restart;
            this._timer = new Timer(_ => this.Tick(), null, SpikeState.IntervalMs, SpikeState.IntervalMs);
            this._statsTimer = new Timer(_ => this.LogStats(), null, 5000, 5000);
            PluginLog.Info($"spikeA: OrcaPaneCommand loaded, interval={SpikeState.IntervalMs} ms");
            return true;
        }

        protected override Boolean OnUnload()
        {
            SpikeState.IntervalChanged -= this.Restart;
            this._timer?.Dispose();
            this._statsTimer?.Dispose();
            return true;
        }

        private void Restart()
        {
            this.LogStats();
            this._timer?.Change(SpikeState.IntervalMs, SpikeState.IntervalMs);
        }

        private void Tick()
        {
            for (var i = 1; i <= Slots; i++)
            {
                Interlocked.Increment(ref this._counter[i]);
                Interlocked.Increment(ref this._ticks[i]);
                this.ActionImageChanged($"slot-{i}");
            }
        }

        private void LogStats()
        {
            var secs = (DateTime.UtcNow - this._statsSince).TotalSeconds;
            this._statsSince = DateTime.UtcNow;
            var parts = new String[Slots];
            for (var i = 1; i <= Slots; i++)
            {
                var t = Interlocked.Exchange(ref this._ticks[i], 0);
                var r = Interlocked.Exchange(ref this._renders[i], 0);
                parts[i - 1] = $"s{i}:{t}/{r}";
            }
            PluginLog.Info($"spikeA: rate interval={SpikeState.IntervalMs}ms window={secs:F1}s ticks/renders {String.Join(" ", parts)}");
        }

        private static Int32 SlotIndex(String p) =>
            p != null && p.StartsWith("slot-") && Int32.TryParse(p.AsSpan(5), out var n) && n >= 1 && n <= Slots ? n : 0;

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) =>
            actionParameter == null ? "Orca Pane" : $"Orca Pane {SlotIndex(actionParameter)}";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var n = SlotIndex(actionParameter);
            if (n > 0)
            {
                Interlocked.Increment(ref this._renders[n]);
            }
            var count = n > 0 ? Volatile.Read(ref this._counter[n]) : 0;
            using var builder = new BitmapBuilder(imageSize);
            if (this._seenSizes.TryAdd($"{imageSize}", true))
            {
                PluginLog.Info($"spikeA: first GetCommandImage for imageSize={imageSize} ({(Int32)imageSize}) param={actionParameter} -> builder {builder.Width}x{builder.Height}");
            }
            UInt32[] colors = { 0x1E5AA8, 0xC8A000, 0x2E8B57, 0x8B2E2E };
            var png = PngEncoder.SolidWithBar(builder.Width, colors[count % colors.Length], (count % 10) / 9.0);
            var bg = BitmapImage.FromArray(png);
            builder.SetBackgroundImage(bg);
            builder.DrawText($"P{n}\n{count}");
            return builder.ToImage();
        }

        // Called by the service for raw button events (if it routes them to commands at all).
        protected override Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 e)
        {
            PluginLog.Info($"spikeA: ProcessButtonEvent2 param={actionParameter} type={e.EventType} duration={e.PressDuration} device={e.DeviceType} deviceId={e.DeviceId} control={e.ControlId} ts={e.TimeStamp}");
            return false; // not handled: lets us see whether RunCommand still fires
        }

        protected override void RunCommand(String actionParameter)
        {
            PluginLog.Info($"spikeA: RunCommand param={actionParameter}");
        }
    }
}
