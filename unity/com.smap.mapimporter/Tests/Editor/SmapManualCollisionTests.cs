using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;
using UnityEngine.Tilemaps;

namespace Smap.MapImporter.Tests
{
    public class SmapManualCollisionTests
    {
        // Frozen by the TypeScript game exporter at e94d93d. The engine wire version remains 1.
        static string Fixture(string name)
        {
            var package = PackageInfo.FindForAssembly(typeof(SmapManualCollisionTests).Assembly);
            return File.ReadAllText(Path.Combine(package.resolvedPath, "Tests", "Fixtures", name + ".smapmap"));
        }

        [Test]
        public void ParsesAndDecodesFrozenManualGridInEditorRowOrder()
        {
            var map = SmapMap.Parse(Fixture("manual-collision"));
            Assert.IsEmpty(map.Validate());
            Assert.AreEqual(1, map.smapExport);
            Assert.AreEqual(16, map.tileWidth);
            Assert.AreEqual(32, map.tileHeight);
            var decoded = SmapCoords.DecodeRle(map.collision.solid, map.width * map.height);
            CollectionAssert.AreEqual(new[] { true, true, false, false, false, false, true, false, false, true, false, false }, decoded);
            var cells = decoded.Select((blocked, i) => (blocked, i)).Where(p => p.blocked)
                .Select(p => SmapCoords.ToCell(p.i % map.width, p.i / map.width, map.height, map.yUp)).ToArray();
            CollectionAssert.AreEqual(new[] { new Vector3Int(0, 2, 0), new Vector3Int(1, 2, 0), new Vector3Int(2, 1, 0), new Vector3Int(1, 0, 0) }, cells);
            Assert.IsFalse(SmapCoords.DecodeRle(SmapMap.Parse(Fixture("all-passable")).collision.solid, 12).Any(v => v));
        }

        [TestCase("manual-collision", 4)]
        [TestCase("all-passable", 0)]
        public void ImportsVersionOneWithOnlyExplicitlyBlockedColliderCells(string fixture, int expected)
        {
            const string path = "Assets/__smap_manual_collision_test.smapmap";
            try
            {
                File.WriteAllText(path, Fixture(fixture));
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                var root = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                Assert.IsNotNull(root, "Frozen v1 exports must remain importable");
                var maps = root.GetComponentsInChildren<Tilemap>(true);
                Assert.AreEqual(expected == 0 ? 0 : 1, maps.Length);
                if (expected == 0) return;
                var collision = maps.Single();
                Assert.IsNotNull(collision.GetComponent<TilemapCollider2D>());
                Assert.IsNotNull(collision.GetComponent<CompositeCollider2D>());
                Assert.IsNull(collision.GetComponent<TilemapRenderer>());
                int count = 0;
                foreach (var p in collision.cellBounds.allPositionsWithin) if (collision.HasTile(p)) count++;
                Assert.AreEqual(expected, count);
                Assert.IsTrue(collision.HasTile(new Vector3Int(0, 2, 0)));
                Assert.IsTrue(collision.HasTile(new Vector3Int(2, 1, 0)));
                Assert.IsFalse(collision.HasTile(new Vector3Int(0, 0, 0)));
            }
            finally { AssetDatabase.DeleteAsset(path); }
        }
    }
}
