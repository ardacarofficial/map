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
    /// </summary>
    [InitializeOnLoad]
    static class SmapFileWatcher
    {
        const double DebounceSeconds = 0.4;
        static readonly object Gate = new object();
        static readonly HashSet<string> Pending = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static long lastEventTimestamp;
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
                };
                watcher.Changed += (_, e) => Enqueue(e.FullPath);
                watcher.Created += (_, e) => Enqueue(e.FullPath);
                watcher.Renamed += (_, e) => Enqueue(e.FullPath); // safe-save: temp file renamed onto the target
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

        /// <summary>Called on a thread-pool thread: only record the path.</summary>
        static void Enqueue(string fullPath)
        {
            string ext = Path.GetExtension(fullPath);
            if (!ext.Equals(".smapmap", StringComparison.OrdinalIgnoreCase) && !ext.Equals(".png", StringComparison.OrdinalIgnoreCase)) return;
            lock (Gate)
            {
                Pending.Add(fullPath);
                lastEventTimestamp = Stopwatch.GetTimestamp();
            }
        }

        static void Drain()
        {
            string[] paths;
            lock (Gate)
            {
                if (Pending.Count == 0) return;
                double quiet = (Stopwatch.GetTimestamp() - lastEventTimestamp) / (double)Stopwatch.Frequency;
                if (quiet < DebounceSeconds) return; // the editor may still be writing
                if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
                paths = new string[Pending.Count];
                Pending.CopyTo(paths);
                Pending.Clear();
            }

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
