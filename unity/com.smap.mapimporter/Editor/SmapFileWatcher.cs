using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>
    /// Unity does not pick up file changes while it is in the background. This
    /// watcher sees the editor writing <c>.smapmap</c> files (and tileset PNGs
    /// next to them) under Assets/ and queues <see cref="AssetDatabase.ImportAsset(string)"/>
    /// on the main thread, debounced, so the prefab updates without focusing Unity.
    /// Disposed before every domain reload; the static constructor recreates it.
    /// If the watcher's buffer overflows (many files written at once), events are
    /// lost, so every <c>.smapmap</c> under Assets/ is reimported instead.
    /// </summary>
    [InitializeOnLoad]
    static class SmapFileWatcher
    {
        const double DebounceSeconds = 0.4;
        /// <summary>64 KB, the largest size that works on network shares (default 8 KB overflows on a big export).</summary>
        const int BufferBytes = 64 * 1024;
        static readonly SmapWatchQueue Queue = new SmapWatchQueue(DebounceSeconds);
        static FileSystemWatcher watcher;
        static readonly string DataPath = Path.GetFullPath(Application.dataPath);

        static SmapFileWatcher()
        {
            if (Application.isBatchMode) return;
            try
            {
                watcher = new FileSystemWatcher(DataPath)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                    InternalBufferSize = BufferBytes,
                };
                // Called on thread-pool threads: only record (no Unity API here).
                watcher.Changed += (_, e) => Queue.Add(e.FullPath, Now());
                watcher.Created += (_, e) => Queue.Add(e.FullPath, Now());
                watcher.Renamed += (_, e) => Queue.Add(e.FullPath, Now()); // safe-save: temp file renamed onto the target
                watcher.Error += (_, e) => Queue.Overflow(Now()); // InternalBufferOverflowException or a lost watch: rescan
                watcher.EnableRaisingEvents = true;
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogWarning($"Smap: file watcher unavailable ({e.Message}); maps update when Unity regains focus.");
                watcher = null;
                return;
            }
            EditorApplication.update += Drain;
            AssemblyReloadEvents.beforeAssemblyReload += Dispose;
            EditorApplication.quitting += Dispose;
        }

        static double Now() => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;

        static IEnumerable<string> AllMaps()
        {
            try
            {
                return Directory.GetFiles(DataPath, "*.smapmap", SearchOption.AllDirectories);
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogWarning($"Smap: cannot list maps after a watcher overflow ({e.Message}).");
                return Array.Empty<string>();
            }
        }

        static void Drain()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            string[] paths = Queue.Take(Now(), AllMaps);
            if (paths == null) return;

            var assetPaths = new List<string>();
            foreach (string full in paths)
            {
                if (!File.Exists(full)) continue;
                // PNGs only matter next to a map; the map depends on them (DependsOnSourceAsset).
                if (full.EndsWith(".png", StringComparison.OrdinalIgnoreCase) &&
                    Directory.GetFiles(Path.GetDirectoryName(full) ?? DataPath, "*.smapmap").Length == 0) continue;
                string assetPath = ToAssetPath(full);
                if (assetPath != null) assetPaths.Add(assetPath);
            }
            if (assetPaths.Count == 0) return;

            AssetDatabase.StartAssetEditing();
            try
            {
                foreach (string assetPath in assetPaths) AssetDatabase.ImportAsset(assetPath);
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }
        }

        /// <summary>"C:/Game/Assets/Maps/a.smapmap" → "Assets/Maps/a.smapmap"; null outside Assets.</summary>
        static string ToAssetPath(string fullPath)
        {
            string full = Path.GetFullPath(fullPath);
            if (!full.StartsWith(DataPath, StringComparison.OrdinalIgnoreCase)) return null;
            return ("Assets" + full.Substring(DataPath.Length)).Replace('\\', '/');
        }

        static void Dispose()
        {
            EditorApplication.update -= Drain;
            AssemblyReloadEvents.beforeAssemblyReload -= Dispose;
            EditorApplication.quitting -= Dispose;
            if (watcher == null) return;
            watcher.EnableRaisingEvents = false;
            watcher.Dispose();
            watcher = null;
        }
    }
}
