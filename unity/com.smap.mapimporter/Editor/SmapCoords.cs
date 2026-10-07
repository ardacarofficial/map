using System;
using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>
    /// Coordinate conversions between the export format (y down, image origin
    /// top-left) and Unity (y up, texture origin bottom-left). Pure functions,
    /// no assets; covered by edit-mode tests.
    /// </summary>
    public static class SmapCoords
    {
        public const int FlipH = 1;
        public const int FlipV = 2;
        /// <summary>Reserved; the editor does not produce it yet and the importer ignores it.</summary>
        public const int FlipD = 4;

        /// <summary>Unity cell of export cell (x, y). With yUp false, row 0 (top) becomes the highest Unity row.</summary>
        public static Vector3Int ToCell(int x, int y, int mapHeight, bool yUp)
        {
            return new Vector3Int(x, yUp ? y : mapHeight - 1 - y, 0);
        }

        /// <summary>Pixel rectangle of a tile in its image, origin top-left (as the editor stores it).</summary>
        public static RectInt SourceRect(SmapTileset ts, int tileId)
        {
            int col = tileId % ts.columns;
            int row = tileId / ts.columns;
            return new RectInt(
                ts.margin + col * (ts.tileWidth + ts.spacing),
                ts.margin + row * (ts.tileHeight + ts.spacing),
                ts.tileWidth,
                ts.tileHeight);
        }

        /// <summary>The same rectangle in Unity texture space (origin bottom-left) for an image <paramref name="textureHeight"/> pixels tall.</summary>
        public static Rect SpriteRect(SmapTileset ts, int tileId, int textureHeight)
        {
            var src = SourceRect(ts, tileId);
            return new Rect(src.x, textureHeight - (src.y + src.height), src.width, src.height);
        }

        /// <summary>
        /// Sprite pivot that puts the sprite's bottom-left corner on the cell's
        /// bottom-left corner (the Tile is anchored at the cell centre). Equal
        /// tile sizes give (0.5, 0.5).
        /// </summary>
        public static Vector2 Pivot(SmapTileset ts, int mapTileWidth, int mapTileHeight)
        {
            return new Vector2(mapTileWidth * 0.5f / ts.tileWidth, mapTileHeight * 0.5f / ts.tileHeight);
        }

        /// <summary>Grid cell size in units, with pixels-per-unit = map tile width.</summary>
        public static Vector3 CellSize(int tileWidth, int tileHeight)
        {
            return new Vector3(1f, (float)tileHeight / tileWidth, 0f);
        }

        /// <summary>Per-cell transform for the flip flags (scale -1 on the flipped axis).</summary>
        public static Matrix4x4 FlipMatrix(int flags)
        {
            if ((flags & (FlipH | FlipV)) == 0) return Matrix4x4.identity;
            return Matrix4x4.Scale(new Vector3((flags & FlipH) != 0 ? -1f : 1f, (flags & FlipV) != 0 ? -1f : 1f, 1f));
        }

        /// <summary>
        /// Expands collision runs (alternating passable/solid, starting with
        /// passable) to <paramref name="length"/> flags.
        /// </summary>
        public static bool[] DecodeRle(int[] runs, int length)
        {
            var result = new bool[length];
            int pos = 0;
            for (int i = 0; i < runs.Length; i++)
            {
                int run = runs[i];
                if (run < 0 || pos + run > length) throw new ArgumentException($"collision run {i} is out of range");
                if ((i & 1) == 1) for (int k = pos; k < pos + run; k++) result[k] = true;
                pos += run;
            }
            if (pos != length) throw new ArgumentException($"collision runs cover {pos} cells, expected {length}");
            return result;
        }
    }
}
