namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // Spike A helper: each press steps the image update interval 1000 -> 500 -> 250 -> 125 -> 66 -> 33 ms.
    // Also checks: does ProcessButtonEvent2 returning true suppress RunCommand?
    public class SpikeRateCommand : PluginDynamicCommand
    {
        private DateTime _lastPress = DateTime.MinValue;

        public SpikeRateCommand()
            : base(displayName: "Spike: Update-Rate", description: "Steps the image update interval", groupName: "Orca Spike")
        {
        }

        protected override Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 e)
        {
            PluginLog.Info($"spikeA: rate ProcessButtonEvent2 type={e.EventType} duration={e.PressDuration} -> handled=true");
            if (e.EventType == DeviceButtonEventType.Press)
            {
                this._lastPress = DateTime.UtcNow;
                SpikeState.Next(this.Plugin);
                this.ActionImageChanged();
            }
            return true;
        }

        protected override void RunCommand(String actionParameter)
        {
            var viaEvent = (DateTime.UtcNow - this._lastPress).TotalSeconds < 2;
            PluginLog.Info($"spikeA: rate RunCommand (button event seen in last 2 s: {viaEvent})");
            if (!viaEvent)
            {
                // Fallback when the service does not route raw button events to commands.
                SpikeState.Next(this.Plugin);
                this.ActionImageChanged();
            }
        }

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) =>
            $"Rate{Environment.NewLine}{SpikeState.IntervalMs} ms";
    }
}
