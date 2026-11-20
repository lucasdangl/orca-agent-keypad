namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // "Orca Pane 1" .. "Orca Pane 9": one parameter per key (slot-<n>), dragged onto keypad keys in Options+.
    // The daemon decides what a key shows and what a tap or hold does; this command only passes the key edges on.
    public class OrcaPaneCommand : PluginDynamicCommand
    {
        public OrcaPaneCommand()
            : base()
        {
            this.DisplayName = "Orca Pane";
            this.GroupName = "Orca";
            for (var i = 1; i <= KeypadHub.Slots; i++)
            {
                this.AddParameter($"slot-{i}", $"Orca Pane {i}", "Orca");
            }
        }

        protected override Boolean OnLoad()
        {
            OrcaKeypadPlugin.Commands.Pane = this;
            return true;
        }

        internal void Redraw(String parameter) => this.ActionImageChanged(parameter);

        protected override String GetCommandDisplayName(String actionParameter, PluginImageSize imageSize) =>
            actionParameter != null && actionParameter.StartsWith("slot-") ? $"Orca Pane {actionParameter[5..]}" : "Orca Pane";

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var hub = OrcaKeypadPlugin.Hub;
            if (hub == null || actionParameter == null)
            {
                return null;
            }
            var slot = KeypadHub.PaneSlot(actionParameter);
            hub.Seen(slot, imageSize);
            return hub.Image(slot, imageSize, $"Orca {actionParameter[5..]}");
        }

        // Press -> key down, Release -> key up. LongPress and RepeatPress are dropped: the daemon times the hold
        // (1 s) itself. Returning true keeps the service from also calling RunCommand on press.
        protected override Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 buttonEvent)
        {
            var hub = OrcaKeypadPlugin.Hub;
            if (hub != null && actionParameter != null)
            {
                KeyEvents.Forward(hub, KeypadHub.PaneSlot(actionParameter), buttonEvent);
            }
            return true;
        }
    }
}
