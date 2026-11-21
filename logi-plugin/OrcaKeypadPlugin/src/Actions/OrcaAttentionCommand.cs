namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    public class OrcaAttentionCommand : OrcaInfoCommand
    {
        public OrcaAttentionCommand()
            : base("Orca Attention", "Blinks while an agent needs you; press to jump to the one waiting longest, again for the next", KeypadHub.AttentionSlot, "Attention")
        {
        }

        protected override Boolean OnLoad()
        {
            OrcaKeypadPlugin.Commands.Attention = this;
            return true;
        }
    }
}
