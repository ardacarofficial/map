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

        /// <summary>Per-cell transform for the flip flags (scale -1 on the flipped axis), for tiles as large as the cell.</summary>
        public static Matrix4x4 FlipMatrix(int flags)
        {
            if ((flags & (FlipH | FlipV)) == 0) return Matrix4x4.identity;
            return Matrix4x4.Scale(new Vector3((flags & FlipH) != 0 ? -1f : 1f, (flags & FlipV) != 0 ? -1f : 1f, 1f));
        }

        /// <summary>
        /// Per-cell transform for the flip flags that mirrors the sprite in place,
        /// like the editor and Tiled do. The Tilemap applies the matrix around the
        /// cell centre (the tile anchor); a tile smaller or larger than the cell is
        /// anchored bottom-left (<see cref="Pivot"/>), so its centre is off the cell
        /// centre and the mirror must be shifted back onto it. Equal sizes give
        /// <see cref="FlipMatrix(int)"/>. Units: pixels-per-unit = map tile width.
        /// </summary>
        public static Matrix4x4 FlipMatrix(int flags, SmapTileset ts, int mapTileWidth, int mapTileHeight)
        {
            bool h = (flags & FlipH) != 0, v = (flags & FlipV) != 0;
            if (!h && !v) return Matrix4x4.identity;
            // Sprite centre relative to the cell centre, in units.
            float cx = (ts.tileWidth - mapTileWidth) * 0.5f / mapTileWidth;
            float cy = (ts.tileHeight - mapTileHeight) * 0.5f / mapTileWidth;
            // Mirror about the sprite centre: x' = 2cx - x.
            var m = Matrix4x4.Scale(new Vector3(h ? -1f : 1f, v ? -1f : 1f, 1f));
            m.m03 = h ? 2f * cx : 0f;
            m.m13 = v ? 2f * cy : 0f;
            return m;
        }

        /// <summary>
        /// Local position (under the Grid root) of the centre of an entity box
        /// whose top-left corner is pixel (x, y) and size w × h pixels. Units:
        /// pixels-per-unit = map tile width, like the tiles. A one-cell entity
        /// lands on its cell's centre, where the Tilemap anchors a tile.
        /// With yUp false the map's top edge is at y = mapHeight × tileHeight pixels.
        /// </summary>
        public static Vector3 EntityCenter(float x, float y, float w, float h, int mapHeight, int tileWidth, int tileHeight, bool yUp)
        {
            float ux = (x + w * 0.5f) / tileWidth;
            float uy = yUp ? (y + h * 0.5f) / tileWidth : ((float)mapHeight * tileHeight - y - h * 0.5f) / tileWidth;
            return new Vector3(ux, uy, 0f);
        }

        /// <summary>Entity box size in units (pixels-per-unit = map tile width).</summary>
        public static Vector2 EntitySize(float w, float h, int tileWidth)
        {
            return new Vector2(w / tileWidth, h / tileWidth);
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
