using System;
using System.Collections.Generic;
using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>
    /// The game export format ("smapExport": 1), shaped for <see cref="JsonUtility"/>:
    /// only flat arrays, so no JSON library is needed. Field names are the JSON keys.
    /// Spec: packages/core/src/export/FORMAT.md in the editor repository.
    /// </summary>
    [Serializable]
    public sealed class SmapMap
    {
        public const int SupportedVersion = 1;
        /// <summary>Ints per entry of <see cref="SmapLayer.cells"/>: x, y, tileset, tileId, flags.</summary>
        public const int CellStride = 5;

        public int smapExport;
        public int width;
        public int height;
        public int tileWidth;
        public int tileHeight;
        /// <summary>False for files written by the editor: (0,0) is the top-left cell.</summary>
        public bool yUp;
        public SmapTileset[] tilesets;
        public SmapLayer[] layers;
        public SmapCollision collision;
        /// <summary>Entity layers, bottom to top (v0.6; empty in older files).</summary>
        public SmapEntityLayer[] entities;
        /// <summary>The player's start, or null when the level has none.</summary>
        public SmapSpawnPoint spawn;

        /// <summary>Parses the JSON text. Throws <see cref="ArgumentException"/> on malformed JSON.</summary>
        public static SmapMap Parse(string json)
        {
            var map = JsonUtility.FromJson<SmapMap>(json);
            if (map == null) throw new ArgumentException("empty or invalid JSON");
            map.tilesets ??= Array.Empty<SmapTileset>();
            map.layers ??= Array.Empty<SmapLayer>();
            map.collision ??= new SmapCollision();
            map.collision.solid ??= Array.Empty<int>();
            foreach (var layer in map.layers) layer.cells ??= Array.Empty<int>();
            map.entities ??= Array.Empty<SmapEntityLayer>();
            foreach (var layer in map.entities)
            {
                layer.items ??= Array.Empty<SmapEntityItem>();
                foreach (var item in layer.items) item.fields ??= Array.Empty<SmapEntityField>();
            }
            ReadRawValues(map, json);
            return map;
        }

        /// <summary>
        /// Fills entity field values and the spawn's presence, which JsonUtility
        /// cannot read (see <see cref="SmapJsonValues"/>).
        /// </summary>
        static void ReadRawValues(SmapMap map, string json)
        {
            var raw = SmapJsonValues.Read(json);
            if (!raw.hasSpawn) map.spawn = null;
            for (int l = 0; l < map.entities.Length && l < raw.fieldValues.Count; l++)
            {
                var items = map.entities[l].items;
                for (int i = 0; i < items.Length && i < raw.fieldValues[l].Count; i++)
                {
                    var fields = items[i].fields;
                    var values = raw.fieldValues[l][i];
                    for (int f = 0; f < fields.Length && f < values.Count; f++)
                        fields[f] = SmapEntityField.FromValue(fields[f]?.name, fields[f]?.type, values[f]);
                }
            }
        }

        /// <summary>The entity that is the spawn point (type "spawn" at <see cref="spawn"/>), or null.</summary>
        public SmapEntityItem FindSpawnItem()
        {
            if (spawn == null) return null;
            foreach (var layer in entities)
                foreach (var item in layer.items)
                    if (item.typeId == SmapEntityTypes.Spawn && item.x == spawn.x && item.y == spawn.y) return item;
            return null;
        }

        /// <summary>Problems that make the file unusable; empty when valid.</summary>
        public List<string> Validate()
        {
            var errors = new List<string>();
            if (smapExport != SupportedVersion)
            {
                errors.Add($"smapExport is {smapExport}; this importer reads version {SupportedVersion}. Update the package.");
                return errors;
            }
            if (width < 1 || height < 1) errors.Add($"map size must be positive, got {width}x{height}");
            // The importer indexes cells with int (width * height); a larger map would overflow it.
            else if ((long)width * height > int.MaxValue) errors.Add($"map size {width}x{height} is too large");
            if (tileWidth < 1 || tileHeight < 1) errors.Add($"tile size must be positive, got {tileWidth}x{tileHeight}");
            for (int t = 0; t < tilesets.Length; t++)
            {
                var ts = tilesets[t];
                if (ts == null || string.IsNullOrEmpty(ts.image)) { errors.Add($"tilesets[{t}] has no image"); continue; }
                if (ts.tileWidth < 1 || ts.tileHeight < 1 || ts.columns < 1 || ts.rows < 1 || ts.margin < 0 || ts.spacing < 0)
                    errors.Add($"tilesets[{t}] ({ts.name}) has an invalid grid");
            }
            for (int l = 0; l < layers.Length; l++)
            {
                var cells = layers[l].cells;
                if (cells.Length % CellStride != 0) { errors.Add($"layers[{l}].cells length {cells.Length} is not a multiple of {CellStride}"); continue; }
                for (int i = 0; i < cells.Length; i += CellStride)
                {
                    int x = cells[i], y = cells[i + 1], ts = cells[i + 2], tile = cells[i + 3];
                    if (x < 0 || y < 0 || x >= width || y >= height) { errors.Add($"layers[{l}] cell ({x},{y}) is outside the map"); break; }
                    if (ts < 0 || ts >= tilesets.Length) { errors.Add($"layers[{l}] cell ({x},{y}) uses unknown tileset {ts}"); break; }
                    var set = tilesets[ts];
                    if (set != null && (tile < 0 || tile >= set.columns * set.rows)) { errors.Add($"layers[{l}] cell ({x},{y}) uses tile {tile} outside tileset {set.name}"); break; }
                }
            }
            long sum = 0;
            foreach (int run in collision.solid)
            {
                if (run < 0) { errors.Add("collision.solid has a negative run"); break; }
                sum += run;
            }
            for (int l = 0; entities != null && l < entities.Length; l++)
            {
                foreach (var item in entities[l].items)
                {
                    if (item == null || string.IsNullOrEmpty(item.id)) { errors.Add($"entities[{l}] has an entity without an id"); break; }
                    if (item.width <= 0 || item.height <= 0) errors.Add($"entity {item.id} has a non-positive size {item.width}x{item.height}");
                }
            }
            if (sum != (long)width * height) errors.Add($"collision.solid covers {sum} cells, expected {(long)width * height}");
            return errors;
        }
    }

    [Serializable]
    public sealed class SmapTileset
    {
        public string name;
        /// <summary>PNG file name, relative to the .smapmap file.</summary>
        public string image;
        public int tileWidth;
        public int tileHeight;
        public int columns;
        public int rows;
        public int margin;
        public int spacing;
    }

    [Serializable]
    public sealed class SmapLayer
    {
        public string id;
        public string name;
        public bool visible = true;
        public float opacity = 1f;
        /// <summary>Flat rows of x, y, tileset, tileId, flags (y down when yUp is false).</summary>
        public int[] cells;
    }

    /// <summary>Manual Collision grid exported as row-major RLE; no tile flags are consulted.</summary>
    [Serializable]
    public sealed class SmapCollision
    {
        /// <summary>Run lengths over the map, row-major from the first row, starting with a passable run.</summary>
        public int[] solid;
    }

    [Serializable]
    public sealed class SmapEntityLayer
    {
        public string id;
        public string name;
        public bool visible = true;
        public SmapEntityItem[] items;
    }

    [Serializable]
    public sealed class SmapEntityItem
    {
        public string id;
        /// <summary>Type name (the type id if the type was deleted).</summary>
        public string type;
        public string typeId;
        /// <summary>Top-left corner of the box in pixels (y down when yUp is false).</summary>
        public float x;
        public float y;
        public int cellX;
        public int cellY;
        /// <summary>Box size in pixels.</summary>
        public float width;
        public float height;
        /// <summary>Type colour "#rrggbb"; empty (type deleted) means a default colour.</summary>
        public string color;
        /// <summary>Values are filled by <see cref="SmapMap.Parse"/>, not by JsonUtility.</summary>
        public SmapEntityField[] fields;
    }

    [Serializable]
    public sealed class SmapSpawnPoint
    {
        /// <summary>Top-left corner of the spawn box in pixels (y down when yUp is false).</summary>
        public float x;
        public float y;
        public int cellX;
        public int cellY;
    }
}
