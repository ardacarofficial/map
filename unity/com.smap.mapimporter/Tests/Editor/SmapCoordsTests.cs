using System;
using NUnit.Framework;
using UnityEngine;

namespace Smap.MapImporter.Tests
{
    public class SmapCoordsTests
    {
        static readonly SmapTileset Grass = new SmapTileset { name = "Grass", image = "grass.png", tileWidth = 32, tileHeight = 32, columns = 8, rows = 8 };
        static readonly SmapTileset Items = new SmapTileset { name = "Items", image = "items.png", tileWidth = 16, tileHeight = 16, columns = 4, rows = 2, margin = 1, spacing = 2 };

        [Test]
        public void TopLeftCellBecomesTopUnityRow()
        {
            Assert.AreEqual(new Vector3Int(0, 2, 0), SmapCoords.ToCell(0, 0, 3, false));
            Assert.AreEqual(new Vector3Int(3, 0, 0), SmapCoords.ToCell(3, 2, 3, false));
            Assert.AreEqual(new Vector3Int(1, 1, 0), SmapCoords.ToCell(1, 1, 3, false));
            Assert.AreEqual(new Vector3Int(1, 0, 0), SmapCoords.ToCell(1, 0, 3, true));
        }

        [Test]
        public void SourceRectIsTopLeftOrigin()
        {
            Assert.AreEqual(new RectInt(32, 0, 32, 32), SmapCoords.SourceRect(Grass, 1));
            Assert.AreEqual(new RectInt(224, 224, 32, 32), SmapCoords.SourceRect(Grass, 63));
            Assert.AreEqual(new RectInt(19, 19, 16, 16), SmapCoords.SourceRect(Items, 5));
        }

        [Test]
        public void SpriteRectIsFlippedToBottomLeftOrigin()
        {
            // Top row of a 256 px image → y = 224 in texture space.
            Assert.AreEqual(new Rect(32, 224, 32, 32), SmapCoords.SpriteRect(Grass, 1, 256));
            Assert.AreEqual(new Rect(224, 0, 32, 32), SmapCoords.SpriteRect(Grass, 63, 256));
            // 72x36 image, margin 1, spacing 2: tile 5 = col 1, row 1 → src y 19 → 36 - (19 + 16) = 1.
            Assert.AreEqual(new Rect(19, 1, 16, 16), SmapCoords.SpriteRect(Items, 5, 36));
        }

        [Test]
        public void PivotAnchorsBottomLeft()
        {
            Assert.AreEqual(new Vector2(0.5f, 0.5f), SmapCoords.Pivot(Grass, 32, 32));
            Assert.AreEqual(new Vector2(1f, 1f), SmapCoords.Pivot(Items, 32, 32));
        }

        [Test]
        public void CellSizeUsesTileWidthAsUnit()
        {
            Assert.AreEqual(new Vector3(1f, 1f, 0f), SmapCoords.CellSize(32, 32));
            Assert.AreEqual(new Vector3(1f, 1.5f, 0f), SmapCoords.CellSize(16, 24));
        }

        static Vector3 Apply(Matrix4x4 m, float x, float y) => m.MultiplyPoint3x4(new Vector3(x, y, 0f));

        static void AssertNear(Vector3 expected, Vector3 actual, string what)
        {
            Assert.That(Vector3.Distance(expected, actual), Is.LessThan(1e-5f), $"{what}: expected {expected}, got {actual}");
        }

        /// <summary>
        /// Where the sprite's own corners go, by name, for a cell-sized tile: (-.5, .5)
        /// = sprite top-left etc. Written by hand from the editor's y-down rule
        /// (D = transpose first, then H, V) seen in Unity's y-up space.
        /// Order: top-left, top-right, bottom-left corners of the source sprite.
        /// </summary>
        static readonly (int flags, string name, Vector2 tl, Vector2 tr, Vector2 bl)[] Corners =
        {
            (0, "none", new Vector2(-.5f, .5f), new Vector2(.5f, .5f), new Vector2(-.5f, -.5f)),
            (1, "H", new Vector2(.5f, .5f), new Vector2(-.5f, .5f), new Vector2(.5f, -.5f)),
            (2, "V", new Vector2(-.5f, -.5f), new Vector2(.5f, -.5f), new Vector2(-.5f, .5f)),
            (3, "H+V (180)", new Vector2(.5f, -.5f), new Vector2(-.5f, -.5f), new Vector2(.5f, .5f)),
            // Transpose: top-left stays, top-right ↔ bottom-left.
            (4, "D (transpose)", new Vector2(-.5f, .5f), new Vector2(-.5f, -.5f), new Vector2(.5f, .5f)),
            // 90° clockwise: top-left → top-right, top-right → bottom-right, bottom-left → top-left.
            (5, "D+H (cw)", new Vector2(.5f, .5f), new Vector2(.5f, -.5f), new Vector2(-.5f, .5f)),
            // 90° counter-clockwise: top-left → bottom-left, top-right → top-left, bottom-left → bottom-right.
            (6, "D+V (ccw)", new Vector2(-.5f, -.5f), new Vector2(-.5f, .5f), new Vector2(.5f, -.5f)),
            // Anti-transpose: top-left ↔ bottom-right, top-right stays.
            (7, "D+H+V", new Vector2(.5f, -.5f), new Vector2(.5f, .5f), new Vector2(-.5f, -.5f)),
        };

        [Test]
        public void OrientationMatrixHandlesAllEightCombinations()
        {
            foreach (var (flags, name, tl, tr, bl) in Corners)
            {
                var m = SmapCoords.OrientationMatrix(flags);
                AssertNear(tl, Apply(m, -.5f, .5f), name + " top-left");
                AssertNear(tr, Apply(m, .5f, .5f), name + " top-right");
                AssertNear(bl, Apply(m, -.5f, -.5f), name + " bottom-left");
                // Same result through the sized overload for a cell-sized tile.
                var sized = SmapCoords.OrientationMatrix(flags, Grass, 32, 32);
                AssertNear(tl, Apply(sized, -.5f, .5f), name + " sized top-left");
                AssertNear(bl, Apply(sized, -.5f, -.5f), name + " sized bottom-left");
            }
        }

        [Test]
        public void OrientationMatrixMatchesTheEditorPixelRule()
        {
            // The editor's rule on pixel centres of a 4x4 tile (y down), converted to Unity units
            // around the cell centre: (u, v) → D ? (v, u) : (u, v) → H mirrors x, V mirrors y.
            const int n = 4;
            for (int flags = 0; flags < 8; flags++)
            {
                var m = SmapCoords.OrientationMatrix(flags);
                for (int v = 0; v < n; v++)
                {
                    for (int u = 0; u < n; u++)
                    {
                        int x = (flags & SmapCoords.FlipD) != 0 ? v : u;
                        int y = (flags & SmapCoords.FlipD) != 0 ? u : v;
                        if ((flags & SmapCoords.FlipH) != 0) x = n - 1 - x;
                        if ((flags & SmapCoords.FlipV) != 0) y = n - 1 - y;
                        var source = new Vector3((u + .5f) / n - .5f, .5f - (v + .5f) / n, 0f);
                        var expected = new Vector3((x + .5f) / n - .5f, .5f - (y + .5f) / n, 0f);
                        AssertNear(expected, m.MultiplyPoint3x4(source), $"flags {flags} pixel ({u},{v})");
                    }
                }
            }
        }

        [Test]
        public void OrientationMatrixComposesLikeRotations()
        {
            var cw = SmapCoords.OrientationMatrix(SmapCoords.FlipD | SmapCoords.FlipH);
            var ccw = SmapCoords.OrientationMatrix(SmapCoords.FlipD | SmapCoords.FlipV);
            var half = SmapCoords.OrientationMatrix(SmapCoords.FlipH | SmapCoords.FlipV);
            var p = new Vector3(0.3f, -0.1f, 0f);
            AssertNear(p, (cw * cw * cw * cw).MultiplyPoint3x4(p), "cw x4");
            AssertNear(half.MultiplyPoint3x4(p), (cw * cw).MultiplyPoint3x4(p), "cw x2 = 180");
            AssertNear(p, (cw * ccw).MultiplyPoint3x4(p), "cw then ccw");
            for (int flags = 0; flags < 8; flags++)
            {
                // Every orientation is its own kind: determinant ±1, and the mirrors (odd bit count) are involutions.
                var m = SmapCoords.OrientationMatrix(flags);
                Assert.AreEqual(1f, Mathf.Abs(m.m00 * m.m11 - m.m01 * m.m10), 1e-6f, $"flags {flags} determinant");
            }
        }

        [Test]
        public void OrientationMatrixKeepsOffSizeTilesInPlace()
        {
            Assert.AreEqual(Matrix4x4.identity, SmapCoords.OrientationMatrix(0, Items, 32, 32));
            // 16 px tile on a 32 px cell sits in the cell's bottom-left quarter: x, y in [-0.5, 0] around the
            // cell centre. Flipped or rotated, it must stay there, not jump to another quarter.
            var v = SmapCoords.OrientationMatrix(SmapCoords.FlipV, Items, 32, 32);
            AssertNear(new Vector3(-0.5f, 0f, 0f), v.MultiplyPoint3x4(new Vector3(-0.5f, -0.5f, 0f)), "V bottom-left");
            AssertNear(new Vector3(0f, -0.5f, 0f), v.MultiplyPoint3x4(new Vector3(0f, 0f, 0f)), "V top-right");
            var h = SmapCoords.OrientationMatrix(SmapCoords.FlipH, Items, 32, 32);
            AssertNear(new Vector3(0f, -0.5f, 0f), h.MultiplyPoint3x4(new Vector3(-0.5f, -0.5f, 0f)), "H bottom-left");
            var cw = SmapCoords.OrientationMatrix(SmapCoords.FlipD | SmapCoords.FlipH, Items, 32, 32);
            // Sprite top-left (-0.5, 0) → top-right (0, 0); bottom-left (-0.5, -0.5) → top-left (-0.5, 0).
            AssertNear(new Vector3(0f, 0f, 0f), cw.MultiplyPoint3x4(new Vector3(-0.5f, 0f, 0f)), "cw top-left");
            AssertNear(new Vector3(-0.5f, 0f, 0f), cw.MultiplyPoint3x4(new Vector3(-0.5f, -0.5f, 0f)), "cw bottom-left");
            // 64x64 tile on a 32x16 cell (1 x 0.5 units): spans x [-0.5, 1.5], y [-0.25, 1.75].
            var big = new SmapTileset { name = "Big", image = "big.png", tileWidth = 64, tileHeight = 64, columns = 1, rows = 1 };
            var hv = SmapCoords.OrientationMatrix(SmapCoords.FlipH | SmapCoords.FlipV, big, 32, 16);
            AssertNear(new Vector3(1.5f, 1.75f, 0f), hv.MultiplyPoint3x4(new Vector3(-0.5f, -0.25f, 0f)), "big 180");
            AssertNear(new Vector3(-0.5f, -0.25f, 0f), hv.MultiplyPoint3x4(new Vector3(1.5f, 1.75f, 0f)), "big 180 back");
        }

        [Test]
        public void DiagonalFlipTransposesNonSquareTilesBottomLeft()
        {
            // 16x32 tile on a 16x16 cell (unit = 16 px): spans x [-0.5, 0.5], y [-0.5, 1.5].
            var tall = new SmapTileset { name = "Tall", image = "tall.png", tileWidth = 16, tileHeight = 32, columns = 1, rows = 1 };
            var cw = SmapCoords.OrientationMatrix(SmapCoords.FlipD | SmapCoords.FlipH, tall, 16, 16);
            // Rotated: 32x16, x [-0.5, 1.5], y [-0.5, 0.5]. Source top-left (-0.5, 1.5) → top-right (1.5, 0.5).
            AssertNear(new Vector3(1.5f, 0.5f, 0f), cw.MultiplyPoint3x4(new Vector3(-0.5f, 1.5f, 0f)), "tall cw top-left");
            // Source bottom-left (-0.5, -0.5) → top-left (-0.5, 0.5); bottom-right (0.5, -0.5) → bottom-left (-0.5, -0.5).
            AssertNear(new Vector3(-0.5f, 0.5f, 0f), cw.MultiplyPoint3x4(new Vector3(-0.5f, -0.5f, 0f)), "tall cw bottom-left");
            AssertNear(new Vector3(-0.5f, -0.5f, 0f), cw.MultiplyPoint3x4(new Vector3(0.5f, -0.5f, 0f)), "tall cw bottom-right");
        }

        [Test]
        public void DecodeRleAlternatesStartingPassable()
        {
            CollectionAssert.AreEqual(new[] { false, false, true, true, true, false }, SmapCoords.DecodeRle(new[] { 2, 3, 1 }, 6));
            CollectionAssert.AreEqual(new[] { true, true }, SmapCoords.DecodeRle(new[] { 0, 2 }, 2));
            Assert.Throws<ArgumentException>(() => SmapCoords.DecodeRle(new[] { 2, 3 }, 4));
            Assert.Throws<ArgumentException>(() => SmapCoords.DecodeRle(new[] { 2 }, 3));
        }
    }
}
