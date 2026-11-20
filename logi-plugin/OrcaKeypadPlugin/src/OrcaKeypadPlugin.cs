namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // Orca Agent Keypad: every MX Creative Keypad key shows an Orca pane (agent state as colour and icon), a tap jumps
    // to it. The work happens in the Node daemon (packages/logi-daemon, started by KeypadHub); this plugin is the
    // device driver: it shows the daemon's images and reports key edges.
    public class OrcaKeypadPlugin : Plugin
    {
        internal static KeypadHub Hub { get; private set; }

        internal static class Commands
        {
            public static OrcaPaneCommand Pane { get; set; }

            public static OrcaStatusCommand Status { get; set; }

            public static OrcaAttentionCommand Attention { get; set; }
        }

        // Gets a value indicating whether this is an API-only plugin.
        public override Boolean UsesApplicationApiOnly => true;

        // Universal plugin: it works whichever application is in front (Orca usually is not).
        public override Boolean HasNoApplication => true;

        public OrcaKeypadPlugin()
        {
            PluginLog.Init(this.Log);
            PluginResources.Init(this.Assembly);
        }

        public override void Load()
        {
            FileLog.Init(this.GetPluginDataDirectory());
            FileLog.Info($"load: plugin {this.GetType().Assembly.GetName().Version}, service pid {Environment.ProcessId}");
            var hub = new KeypadHub(this) { Redraw = Redraw };
            Hub = hub;
            hub.Start();
        }

        public override void Unload()
        {
            FileLog.Info("unload");
            var hub = Hub;
            Hub = null;
            hub?.Dispose();
        }

        private static void Redraw(String slot)
        {
            if (slot == KeypadHub.StatusSlot)
            {
                Commands.Status?.Redraw();
            }
            else if (slot == KeypadHub.AttentionSlot)
            {
                Commands.Attention?.Redraw();
            }
            else if (KeypadHub.TryPaneIndex(slot, out var n))
            {
                Commands.Pane?.Redraw($"slot-{n}");
            }
        }
    }
}
