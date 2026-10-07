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

        [Test]
        public void FlipMatrixScalesFlippedAxes()
        {
            Assert.AreEqual(Matrix4x4.identity, SmapCoords.FlipMatrix(0));
            Assert.AreEqual(Matrix4x4.identity, SmapCoords.FlipMatrix(SmapCoords.FlipD));
            var h = SmapCoords.FlipMatrix(SmapCoords.FlipH);
            Assert.AreEqual(new Vector3(-1f, 1f, 1f), h.MultiplyVector(Vector3.one));
            var hv = SmapCoords.FlipMatrix(SmapCoords.FlipH | SmapCoords.FlipV);
            Assert.AreEqual(new Vector3(-1f, -1f, 1f), hv.MultiplyVector(Vector3.one));
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
