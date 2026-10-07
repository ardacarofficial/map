using NUnit.Framework;

namespace Smap.MapImporter.Tests
{
    public class SmapMapTests
    {
        // Same shape as the editor's export test fixture (packages/core/test/export.test.ts).
        const string Sample = @"{
  ""smapExport"": 1,
  ""width"": 4,
  ""height"": 3,
  ""tileWidth"": 32,
  ""tileHeight"": 32,
  ""yUp"": false,
  ""tilesets"": [
    { ""name"": ""Grass"", ""image"": ""grass.png"", ""tileWidth"": 32, ""tileHeight"": 32, ""columns"": 8, ""rows"": 8, ""margin"": 0, ""spacing"": 0 }
  ],
  ""layers"": [
    { ""id"": ""ground"", ""name"": ""Ground"", ""visible"": true, ""opacity"": 0.5, ""cells"": [
      0, 0, 0, 1, 0,
      3, 0, 0, 9, 1
    ] }
  ],
  ""collision"": { ""solid"": [0, 1, 10, 1] }
}";

        [Test]
        public void ParsesTheExportFormat()
        {
            var map = SmapMap.Parse(Sample);
            Assert.IsEmpty(map.Validate());
            Assert.AreEqual(4, map.width);
            Assert.IsFalse(map.yUp);
            Assert.AreEqual("grass.png", map.tilesets[0].image);
            Assert.AreEqual(0.5f, map.layers[0].opacity);
            CollectionAssert.AreEqual(new[] { 0, 0, 0, 1, 0, 3, 0, 0, 9, 1 }, map.layers[0].cells);
            CollectionAssert.AreEqual(new[] { 0, 1, 10, 1 }, map.collision.solid);
        }

        [Test]
        public void RejectsUnknownVersion()
        {
            var map = SmapMap.Parse(Sample.Replace(@"""smapExport"": 1", @"""smapExport"": 2"));
            Assert.AreEqual(1, map.Validate().Count);
        }

        [Test]
        public void RejectsBadCellsAndCollision()
        {
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("3, 0, 0, 9, 1", "3, 0, 0, 9")).Validate());
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("3, 0, 0, 9, 1", "4, 0, 0, 9, 1")).Validate());
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("3, 0, 0, 9, 1", "3, 0, 1, 9, 1")).Validate());
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("3, 0, 0, 9, 1", "3, 0, 0, 64, 1")).Validate());
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("[0, 1, 10, 1]", "[0, 1, 10]")).Validate());
        }
    }
}
