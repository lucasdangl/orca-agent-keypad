namespace Loupedeck.OrcaKeypadPlugin
{
    using System;

    // Press -> key down, Release -> key up; LongPress and RepeatPress are dropped (the daemon times the hold).
    internal static class KeyEvents
    {
        public static void Forward(KeypadHub hub, String slot, DeviceButtonEvent2 e)
        {
            switch (e.EventType)
            {
                case DeviceButtonEventType.Press:
                    hub.KeyEdge(slot, down: true);
                    break;
                case DeviceButtonEventType.Release:
                    hub.KeyEdge(slot, down: false);
                    break;
                default:
                    break;
            }
        }
    }
}
