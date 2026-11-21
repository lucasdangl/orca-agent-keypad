namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    public class OrcaStatusCommand : OrcaInfoCommand
    {
        public OrcaStatusCommand()
            : base("Orca Status", "Connection to Orca and setup checks; press to reconnect", KeypadHub.StatusSlot, "Status")
        {
        }

        protected override Boolean OnLoad()
        {
            OrcaKeypadPlugin.Commands.Status = this;
            return true;
        }
    }
}
