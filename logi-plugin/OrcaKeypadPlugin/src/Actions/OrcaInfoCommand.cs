namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // "Orca Status", "Orca Attention" and "Orca Working": one key each, drawn and handled by the daemon like the Pane keys.
    public abstract class OrcaInfoCommand : PluginDynamicCommand
    {
        private readonly String _slot;
        private readonly String _label;

        protected OrcaInfoCommand(String displayName, String description, String slot, String label)
            : base(displayName, description, "Orca")
        {
            this._slot = slot;
            this._label = label;
        }

        internal void Redraw() => this.ActionImageChanged();

        protected override BitmapImage GetCommandImage(String actionParameter, PluginImageSize imageSize)
        {
            var hub = OrcaKeypadPlugin.Hub;
            if (hub == null)
            {
                return null;
            }
            hub.Seen(this._slot, imageSize);
            return hub.Image(this._slot, imageSize, this._label);
        }

        protected override Boolean ProcessButtonEvent2(String actionParameter, DeviceButtonEvent2 buttonEvent)
        {
            var hub = OrcaKeypadPlugin.Hub;
            if (hub != null)
            {
                KeyEvents.Forward(hub, this._slot, buttonEvent);
            }
            return true;
        }
    }
}
