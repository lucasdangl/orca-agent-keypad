namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    public class OrcaWorkingCommand : OrcaInfoCommand
    {
        public OrcaWorkingCommand()
            : base("Orca Working", "How many agents are working; press to jump to one, again for the next", KeypadHub.WorkingSlot, "Working")
        {
        }

        protected override Boolean OnLoad()
        {
            OrcaKeypadPlugin.Commands.Working = this;
            return true;
        }
    }
}
