namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Text.Json.Nodes;
    using System.Threading;

    // Between our commands and the daemon: forwards key edges and the keys on the device, keeps the newest image per

    // key and stores the daemon's settings. One per plugin (the commands find it through OrcaKeypadPlugin.Hub).
    internal sealed class KeypadHub : IDisposable
    {
        public const String SettingsKey = "deckSettings";
        public const String DaemonPathSetting = "daemonPath";
        public const Int32 Slots = 9;
        public const String StatusSlot = "logi:status";
        public const String AttentionSlot = "logi:attention";
        public const String WorkingSlot = "logi:working";
        public const String DoneSlot = "logi:done";

        // The MX Creative Keypad asks for 116 px images (docs/logi-findings.md); the Options+ UI asks other sizes.
        private const PluginImageSize KeypadSize = PluginImageSize.Width116;
        private static readonly TimeSpan AlertTime = TimeSpan.FromMilliseconds(1500);

        private readonly Plugin _plugin;
        private readonly DaemonProcess _daemon;
        private readonly ConcurrentDictionary<String, String> _svg = new();
        private readonly ConcurrentDictionary<String, DateTime> _alertUntil = new();

        // Keys the keypad has asked an image for since the plugin loaded: what we report in `keys`.
        private readonly ConcurrentDictionary<String, Boolean> _seen = new();
        private Timer _keysDebounce;
        private Boolean _ready;

        // Redraw one key: set by the commands (slot id -> their ActionImageChanged).
        public Action<String> Redraw { get; set; } = _ => { };

        public KeypadHub(Plugin plugin)
        {
            this._plugin = plugin;
            this._daemon = new DaemonProcess(this.Resolve);
            this._daemon.Started += this.OnStarted;
            this._daemon.Message += this.OnMessage;
        }

        public String Problem => this._daemon.Problem;

        public Boolean Ready => this._ready;

        public void Start() => ThreadPool.QueueUserWorkItem(_ => this._daemon.Start());

        public void Dispose()
        {
            this._keysDebounce?.Dispose();
            this._daemon.Stop();
        }

        private (String Node, String Script) Resolve()
        {
            var node = NodeLocator.Find(this._plugin);
            return (node?.Path, this.DaemonScript());
        }

        // daemon.mjs ships next to the plugin assembly (bin/daemon/daemon.mjs); the setting `daemonPath` or the

        // environment variable ORCA_KEYPAD_DAEMON point a development build elsewhere.
        private String DaemonScript()
        {
            if (this._plugin.TryGetPluginSetting(DaemonPathSetting, out var configured) && !String.IsNullOrWhiteSpace(configured))
            {
                return configured.Trim();
            }
            var env = Environment.GetEnvironmentVariable("ORCA_KEYPAD_DAEMON");
            if (!String.IsNullOrWhiteSpace(env))
            {
                return env;
            }
            var dir = Path.GetDirectoryName(this._plugin.AssemblyFilePath);
            return Path.Combine(dir ?? ".", "daemon", "daemon.mjs");
        }

        private void OnStarted()
        {
            this._ready = false;
            var settings = new JsonObject();
            if (this._plugin.TryGetPluginSetting(SettingsKey, out var stored) && !String.IsNullOrEmpty(stored))
            {
                try
                {
                    settings = JsonNode.Parse(stored) as JsonObject ?? new JsonObject();
                }
                catch
                {
                    FileLog.Warning("stored deck settings are not JSON, starting empty");
                }
            }
            this._daemon.Send(new JsonObject
            {
                ["type"] = "hello",
                ["pluginVersion"] = this._plugin.GetType().Assembly.GetName().Version?.ToString(3) ?? "0.0.0",
                ["device"] = new JsonObject { ["model"] = "MX Creative Keypad", ["cols"] = 3, ["rows"] = 3 },
                ["imageSize"] = 116,
                ["settings"] = settings,
            });
            this.SendKeys();

            // Keys drawn before (placeholders, images of the last daemon) are drawn again as the new one sends them.
        }

        private void OnMessage(JsonObject m)
        {
            switch ((String)m["type"])
            {
                case "ready":
                    this._ready = true;
                    FileLog.Info($"daemon ready: {(String)m["daemonVersion"]}");
                    this.RedrawAll();
                    return;
                case "image":
                {
                    var slot = (String)m["slotId"];
                    var svg = (String)m["svg"];
                    if (slot == null || svg == null)
                    {
                        return;
                    }
                    this._svg[slot] = svg;
                    this.Redraw(slot);
                    return;
                }
                case "alert":
                {
                    var slot = (String)m["slotId"];
                    if (slot == null)
                    {
                        return;
                    }
                    this._alertUntil[slot] = DateTime.UtcNow + AlertTime;
                    this.Redraw(slot);

                    // Back to the key image when the alert is over.
                    _ = System.Threading.Tasks.Task.Delay(AlertTime + TimeSpan.FromMilliseconds(50)).ContinueWith(_ => this.Redraw(slot));
                    return;
                }
                case "sendKey":
                    this.SendKey((String)m["key"]);
                    return;
                case "saveSettings":
                    if (m["settings"] is JsonObject s)
                    {
                        this._plugin.SetPluginSetting(SettingsKey, s.ToJsonString(), false);
                    }
                    return;
                default:
                    return;
            }
        }

        // The answer pad: one key press to the app in front (Orca), without modifiers. The key name is logged, never text.
        private void SendKey(String key)
        {
            var modifiers = ModifierKey.None;
            VirtualKeyCode? code = key switch
            {
                "Escape" => VirtualKeyCode.Escape,
                "ArrowUp" => VirtualKeyCode.ArrowUp,
                "ArrowDown" => VirtualKeyCode.ArrowDown,
                "Cmd+E" => VirtualKeyCode.KeyE,
                "Return" => VirtualKeyCode.Return,
                "1" => VirtualKeyCode.Key1,
                "2" => VirtualKeyCode.Key2,
                "3" => VirtualKeyCode.Key3,
                "4" => VirtualKeyCode.Key4,
                _ => null,
            };
            if (code == null)
            {
                FileLog.Info($"sendKey: unknown key '{key}'");
                return;
            }
            if (key == "Cmd+E")
            {
                modifiers = ModifierKey.Command;
            }
            try
            {
                this._plugin.ClientApplication.SendKeyboardShortcut(code.Value, modifiers);
            }
            catch (Exception e)
            {
                FileLog.Info($"sendKey {key} failed: {e.GetType().Name}: {e.Message}");
            }
        }

        private void RedrawAll()
        {
            foreach (var slot in this._seen.Keys.ToArray())
            {
                this.Redraw(slot);
            }
        }

        // The keypad asked an image for a key: it is on the device (a page or profile that shows it).
        public void Seen(String slot, PluginImageSize size)
        {
            if (size != KeypadSize || !this._seen.TryAdd(slot, true))
            {
                return;
            }
            FileLog.Info($"key on the keypad: {slot}");

            // Keys come in a burst when a page appears: send them once.
            this._keysDebounce?.Dispose();
            this._keysDebounce = new Timer(_ => this.SendKeys(), null, 150, Timeout.Infinite);
        }

        private void SendKeys()
        {
            var keys = new JsonArray();
            foreach (var slot in this._seen.Keys.OrderBy(s => s, StringComparer.Ordinal))
            {
                var k = new JsonObject { ["slotId"] = slot };
                if (slot == StatusSlot)
                {
                    k["kind"] = "status";
                }
                else if (slot == AttentionSlot)
                {
                    k["kind"] = "attention";
                }
                else if (slot == WorkingSlot)
                {
                    k["kind"] = "working";
                }
                else if (slot == DoneSlot)
                {
                    k["kind"] = "done";
                }
                else if (TryPaneIndex(slot, out var n))
                {
                    k["kind"] = "pane";
                    k["index"] = n;
                }
                else
                {
                    continue;
                }
                keys.Add(k);
            }
            this._daemon.Send(new JsonObject { ["type"] = "keys", ["keys"] = keys });
        }

        public static String PaneSlot(String parameter) => $"logi:{parameter}";

        public static Boolean TryPaneIndex(String slot, out Int32 n)
        {
            n = 0;
            return slot != null && slot.StartsWith("logi:slot-", StringComparison.Ordinal)
                && Int32.TryParse(slot.AsSpan("logi:slot-".Length), out n) && n >= 1 && n <= Slots;
        }

        public void KeyEdge(String slot, Boolean down) =>
            this._daemon.Send(new JsonObject { ["type"] = "key", ["slotId"] = slot, ["edge"] = down ? "down" : "up" });

        // The image for a key: the daemon's SVG at the size the service asks for, a short alert, or a placeholder

        // while the daemon is starting (or cannot start).
        public BitmapImage Image(String slot, PluginImageSize size, String fallbackLabel)
        {
            var px = Pixels(size);
            if (this._alertUntil.TryGetValue(slot, out var until))
            {
                if (until > DateTime.UtcNow)
                {
                    return Placeholder(size, "!", new BitmapColor(0xB0, 0x20, 0x20));
                }
                this._alertUntil.TryRemove(slot, out _);
            }
            if (this._svg.TryGetValue(slot, out var svg))
            {
                var sized = svg.Replace("width=\"144\" height=\"144\" viewBox", $"width=\"{px}\" height=\"{px}\" viewBox");
                if (BitmapImage.TryCreateFromSvg(sized, out var img))
                {
                    return img;
                }
            }
            var problem = this.Problem;
            return Placeholder(size, problem ?? fallbackLabel, problem != null ? new BitmapColor(0x5A, 0x2A, 0x2A) : new BitmapColor(0x2B, 0x2B, 0x2B));
        }

        private static Int32 Pixels(PluginImageSize size) => size switch
        {
            PluginImageSize.Width90 => 80,
            PluginImageSize.Width60 => 50,
            _ => 116,
        };

        private static BitmapImage Placeholder(PluginImageSize size, String text, BitmapColor bg)
        {
            using var b = new BitmapBuilder(size == PluginImageSize.None ? PluginImageSize.Width116 : size);
            b.Clear(bg);
            b.DrawText(text);
            return b.ToImage();
        }
    }
}
