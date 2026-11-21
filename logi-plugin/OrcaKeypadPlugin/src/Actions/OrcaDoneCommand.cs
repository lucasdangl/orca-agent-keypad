namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    public class OrcaDoneCommand : OrcaInfoCommand
    {
        public OrcaDoneCommand()
            : base("Orca Done", "How many agents finished and are unread; press to open the one that finished first", KeypadHub.DoneSlot, "Done")
        {
        }

        protected override Boolean OnLoad()
        {
            OrcaKeypadPlugin.Commands.Done = this;
            return true;
        }
    }
}
