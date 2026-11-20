namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // Phase 0 spike plugin: Spike A (images, events, parameters) lives in Actions/,
    // Spike B (node child process) in Spike/NodeChild.cs.
    public class OrcaKeypadPlugin : Plugin
    {
        private NodeChild _node;

        // Gets a value indicating whether this is an API-only plugin.
        public override Boolean UsesApplicationApiOnly => true;

        // Universal plugin: no application binding.
        public override Boolean HasNoApplication => true;

        public OrcaKeypadPlugin()
        {
            PluginLog.Init(this.Log);
            PluginResources.Init(this.Assembly);
        }

        public override void Load()
        {
            SideLog.Init(this.GetPluginDataDirectory());
            SideLog.Write($"spike: Load, data dir={this.GetPluginDataDirectory()}");
            SpikeState.Load(this);
            this._node = new NodeChild(this);
            this._node.Start();
        }

        public override void Unload()
        {
            SideLog.Write("spike: Unload");
            this._node?.Dispose();
            this._node = null;
        }
    }
}
