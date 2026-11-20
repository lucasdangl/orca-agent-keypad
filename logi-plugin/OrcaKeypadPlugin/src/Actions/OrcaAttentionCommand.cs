namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    public class OrcaAttentionCommand : OrcaInfoCommand
    {
        public OrcaAttentionCommand()
            : base("Orca Attention", "Agents waiting for you; press to jump to the one waiting longest", KeypadHub.AttentionSlot, "Attention")
        {
        }

        protected override Boolean OnLoad()
        {
            OrcaKeypadPlugin.Commands.Attention = this;
            return true;
        }
    }
}
