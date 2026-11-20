namespace Loupedeck.OrcaKeypadPlugin
{
    using System;
    using System.IO;
    using System.IO.Compression;

    // Minimal RGBA PNG encoder. Spike A uses it to prove that PNG bytes produced
    // outside the Logi SDK (later: resvg in the Node daemon) load via BitmapImage.FromArray.
    internal static class PngEncoder
    {
        // Solid background plus a horizontal progress bar at the bottom (fraction 0..1).
        public static Byte[] SolidWithBar(Int32 size, UInt32 rgb, Double fraction)
        {
            var raw = new Byte[size * (1 + (size * 4))];
            var barTop = size - Math.Max(4, size / 10);
            var barEnd = (Int32)(size * Math.Clamp(fraction, 0, 1));
            var i = 0;
            for (var y = 0; y < size; y++)
            {
                raw[i++] = 0; // filter: none
                for (var x = 0; x < size; x++)
                {
                    var bar = y >= barTop && x < barEnd;
                    raw[i++] = bar ? (Byte)0xFF : (Byte)(rgb >> 16);
                    raw[i++] = bar ? (Byte)0xFF : (Byte)(rgb >> 8);
                    raw[i++] = bar ? (Byte)0xFF : (Byte)rgb;
                    raw[i++] = 0xFF;
                }
            }

            using var ms = new MemoryStream();
            ms.Write(new Byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
            var ihdr = new Byte[13];
            WriteBE(ihdr, 0, (UInt32)size);
            WriteBE(ihdr, 4, (UInt32)size);
            ihdr[8] = 8; // bit depth
            ihdr[9] = 6; // RGBA
            WriteChunk(ms, "IHDR", ihdr);
            using (var z = new MemoryStream())
            {
                using (var zs = new ZLibStream(z, CompressionLevel.Fastest, leaveOpen: true))
                {
                    zs.Write(raw);
                }
                WriteChunk(ms, "IDAT", z.ToArray());
            }
            WriteChunk(ms, "IEND", Array.Empty<Byte>());
            return ms.ToArray();
        }

        private static void WriteChunk(Stream s, String type, Byte[] data)
        {
            var len = new Byte[4];
            WriteBE(len, 0, (UInt32)data.Length);
            s.Write(len);
            var typeBytes = System.Text.Encoding.ASCII.GetBytes(type);
            s.Write(typeBytes);
            s.Write(data);
            var crc = Crc32(typeBytes, 0xFFFFFFFFu);
            crc = Crc32(data, crc) ^ 0xFFFFFFFFu;
            var c = new Byte[4];
            WriteBE(c, 0, crc);
            s.Write(c);
        }

        private static void WriteBE(Byte[] b, Int32 o, UInt32 v)
        {
            b[o] = (Byte)(v >> 24);
            b[o + 1] = (Byte)(v >> 16);
            b[o + 2] = (Byte)(v >> 8);
            b[o + 3] = (Byte)v;
        }

        private static readonly UInt32[] Table = BuildTable();

        private static UInt32[] BuildTable()
        {
            var t = new UInt32[256];
            for (UInt32 n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++)
                {
                    c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                }
                t[n] = c;
            }
            return t;
        }

        private static UInt32 Crc32(Byte[] data, UInt32 crc)
        {
            foreach (var b in data)
            {
                crc = Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
            }
            return crc;
        }
    }
}
