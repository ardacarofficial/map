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
        /// <summary>
        /// Diagonal flip: x/y swap in the export's y-down tile space, applied before
        /// <see cref="FlipH"/> and <see cref="FlipV"/> (Tiled's rule). D+H = 90° clockwise,
        /// H+V = 180°, D+V = 90° counter-clockwise.
        /// </summary>
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

        /// <summary>
        /// The 2x2 linear part of an orientation in Unity's y-up space (rows of
        /// <c>[m00 m01; m10 m11]</c>). The export defines the flags in y-down tile
        /// space: D transposes <c>(u, v) → (v, u)</c>, then H mirrors x and V mirrors y.
        /// With <c>y = -v</c> the transpose becomes the other diagonal,
        /// <c>(x, y) → (-y, -x)</c>, so the result is <c>V · H · A</c> with
        /// <c>A = [[0, -1], [-1, 0]]</c> when D is set.
        /// </summary>
        public static void OrientationLinear(int flags, out float m00, out float m01, out float m10, out float m11)
        {
            float h = (flags & FlipH) != 0 ? -1f : 1f;
            float v = (flags & FlipV) != 0 ? -1f : 1f;
            if ((flags & FlipD) != 0)
            {
                m00 = 0f; m01 = -h;
                m10 = -v; m11 = 0f;
            }
            else
            {
                m00 = h; m01 = 0f;
                m10 = 0f; m11 = v;
            }
        }

        /// <summary>
        /// Per-cell transform for the orientation flags (all eight combinations of
        /// H, V and D) of a tile exactly as large as the cell, around the cell centre.
        /// </summary>
        public static Matrix4x4 OrientationMatrix(int flags)
        {
            if ((flags & (FlipH | FlipV | FlipD)) == 0) return Matrix4x4.identity;
            OrientationLinear(flags, out float m00, out float m01, out float m10, out float m11);
            var m = Matrix4x4.identity;
            m.m00 = m00; m.m01 = m01;
            m.m10 = m10; m.m11 = m11;
            return m;
        }

        /// <summary>
        /// Per-cell transform for the orientation flags that mirrors / rotates the
        /// sprite in place, like the editor and Tiled do. The Tilemap applies the
        /// matrix around the cell centre (the tile anchor). A tile is anchored
        /// bottom-left of its cell (<see cref="Pivot"/>), and so is its oriented
        /// rectangle, which is transposed (<c>h × w</c>) when D is set. So the sprite
        /// centre <c>c</c> is mapped to the oriented rectangle's centre <c>c'</c>:
        /// <c>p' = c' + L (p - c)</c>. Equal sizes give <see cref="OrientationMatrix(int)"/>.
        /// Units: pixels-per-unit = map tile width.
        /// </summary>
        public static Matrix4x4 OrientationMatrix(int flags, SmapTileset ts, int mapTileWidth, int mapTileHeight)
        {
            if ((flags & (FlipH | FlipV | FlipD)) == 0) return Matrix4x4.identity;
            bool d = (flags & FlipD) != 0;
            float unit = mapTileWidth;
            // Sprite centre relative to the cell centre, before and after, in units.
            float cx = (ts.tileWidth - mapTileWidth) * 0.5f / unit;
            float cy = (ts.tileHeight - mapTileHeight) * 0.5f / unit;
            int w2 = d ? ts.tileHeight : ts.tileWidth;
            int h2 = d ? ts.tileWidth : ts.tileHeight;
            float cx2 = (w2 - mapTileWidth) * 0.5f / unit;
            float cy2 = (h2 - mapTileHeight) * 0.5f / unit;
            OrientationLinear(flags, out float m00, out float m01, out float m10, out float m11);
            var m = Matrix4x4.identity;
            m.m00 = m00; m.m01 = m01;
            m.m10 = m10; m.m11 = m11;
            m.m03 = cx2 - (m00 * cx + m01 * cy);
            m.m13 = cy2 - (m10 * cx + m11 * cy);
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
