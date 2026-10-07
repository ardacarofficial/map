using System;
using System.Collections.Generic;
using System.IO;

namespace Smap.MapImporter
{
    /// <summary>
    /// The thread-safe, Unity-free part of <see cref="SmapFileWatcher"/>: collects
    /// changed paths from the watcher's thread-pool threads and hands them to the
    /// main thread once the folder has been quiet for the debounce time. When the
    /// watcher's buffer overflows (events were dropped), it asks for a full rescan:
    /// every <c>.smapmap</c> under the watched folder is reimported.
    /// </summary>
    public sealed class SmapWatchQueue
    {
        readonly object gate = new object();
        readonly HashSet<string> pending = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        readonly double debounceSeconds;
        double lastEvent = double.NegativeInfinity;
        bool rescan;

        public SmapWatchQueue(double debounceSeconds)
        {
            this.debounceSeconds = debounceSeconds;
        }

        /// <summary>True for the files the importer cares about (maps and tileset PNGs).</summary>
        public static bool IsRelevant(string path)
        {
            string ext = Path.GetExtension(path);
            return ext.Equals(".smapmap", StringComparison.OrdinalIgnoreCase) || ext.Equals(".png", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Any thread. <paramref name="now"/> in seconds on a monotonic clock.</summary>
        public void Add(string fullPath, double now)
        {
            if (!IsRelevant(fullPath)) return;
            lock (gate)
            {
                pending.Add(fullPath);
                lastEvent = now;
            }
        }

        /// <summary>Any thread: the watcher lost events (buffer overflow); rescan everything.</summary>
        public void Overflow(double now)
        {
            lock (gate)
            {
                rescan = true;
                lastEvent = now;
            }
        }

        /// <summary>
        /// Main thread. Null while nothing is pending or the folder is not yet quiet;
        /// otherwise the queued paths (all <c>.smapmap</c> files from
        /// <paramref name="listAllMaps"/> after an overflow), and the queue is emptied.
        /// </summary>
        public string[] Take(double now, Func<IEnumerable<string>> listAllMaps)
        {
            bool all;
            string[] paths;
            lock (gate)
            {
                if (pending.Count == 0 && !rescan) return null;
                if (now - lastEvent < debounceSeconds) return null; // the editor may still be writing
                all = rescan;
                rescan = false;
                paths = new string[pending.Count];
                pending.CopyTo(paths);
                pending.Clear();
            }
            if (!all) return paths;
            var merged = new HashSet<string>(paths, StringComparer.OrdinalIgnoreCase);
            foreach (string map in listAllMaps()) merged.Add(map);
            var result = new string[merged.Count];
            merged.CopyTo(result);
            return result;
        }
    }
}
