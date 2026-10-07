using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Smap.MapImporter.Tests
{
    public class SmapEntityTests
    {
        // Written by the editor's exportGameJson (packages/core) for a 5x4 map with
        // 32x16 px cells: a spawn, an NPC with one field of every kind, and a portal.
        const string Sample = @"{
  ""smapExport"": 1,
  ""width"": 5,
  ""height"": 4,
  ""tileWidth"": 32,
  ""tileHeight"": 16,
  ""yUp"": false,
  ""tilesets"": [
    {
      ""name"": ""Grass"",
      ""image"": ""grass.png"",
      ""tileWidth"": 32,
      ""tileHeight"": 16,
      ""columns"": 8,
      ""rows"": 8,
      ""margin"": 0,
      ""spacing"": 0
    }
  ],
  ""layers"": [
    {
      ""id"": ""ground"",
      ""name"": ""Ground"",
      ""visible"": true,
      ""opacity"": 1,
      ""cells"": [
        0, 0, 0, 1, 0
      ]
    }
  ],
  ""collision"": {
    ""solid"": [
      20
    ]
  },
  ""entities"": [
    {
      ""id"": ""things"",
      ""name"": ""Things"",
      ""visible"": true,
      ""items"": [
        {
          ""id"": ""start"",
          ""type"": ""Spawn"",
          ""typeId"": ""spawn"",
          ""x"": 64,
          ""y"": 32,
          ""cellX"": 2,
          ""cellY"": 2,
          ""width"": 32,
          ""height"": 16,
          ""fields"": []
        },
        {
          ""id"": ""bob"",
          ""type"": ""Npc \""Bob\"""",
          ""typeId"": ""npc"",
          ""x"": 128,
          ""y"": 0,
          ""cellX"": 4,
          ""cellY"": 0,
          ""width"": 64,
          ""height"": 32,
          ""fields"": [
            {
              ""name"": ""line"",
              ""type"": ""string"",
              ""value"": ""Merhaba, \""yolcu\""\nç""
            },
            {
              ""name"": ""hp"",
              ""type"": ""int"",
              ""value"": -3
            },
            {
              ""name"": ""speed"",
              ""type"": ""float"",
              ""value"": 1.25
            },
            {
              ""name"": ""hostile"",
              ""type"": ""bool"",
              ""value"": true
            },
            {
              ""name"": ""mood"",
              ""type"": ""enum"",
              ""value"": ""calm""
            },
            {
              ""name"": ""home"",
              ""type"": ""levelRef"",
              ""value"": null
            },
            {
              ""name"": ""goal"",
              ""type"": ""point"",
              ""value"": {
                ""x"": 8,
                ""y"": 4
              }
            }
          ]
        }
      ]
    },
    {
      ""id"": ""hidden"",
      ""name"": ""Hidden"",
      ""visible"": true,
      ""items"": [
        {
          ""id"": ""door"",
          ""type"": ""Portal"",
          ""typeId"": ""portal"",
          ""x"": 0,
          ""y"": 48,
          ""cellX"": 0,
          ""cellY"": 3,
          ""width"": 32,
          ""height"": 16,
          ""fields"": [
            {
              ""name"": ""targetLevel"",
              ""type"": ""levelRef"",
              ""value"": ""lvl-dungeon""
            },
            {
              ""name"": ""targetPoint"",
              ""type"": ""point"",
              ""value"": {
                ""x"": 64,
                ""y"": 96
              }
            }
          ]
        }
      ]
    }
  ],
  ""spawn"": {
    ""x"": 64,
    ""y"": 32,
    ""cellX"": 2,
    ""cellY"": 2
  }
}";

        [Test]
        public void ParsesEntitiesAndSpawn()
        {
            var map = SmapMap.Parse(Sample);
            Assert.IsEmpty(map.Validate());
            Assert.AreEqual(2, map.entities.Length);
            Assert.AreEqual("things", map.entities[0].id);
            var bob = map.entities[0].items[1];
            Assert.AreEqual("bob", bob.id);
            Assert.AreEqual("Npc \"Bob\"", bob.type);
            Assert.AreEqual("npc", bob.typeId);
            Assert.AreEqual(128f, bob.x);
            Assert.AreEqual(64f, bob.width);
            Assert.AreEqual(4, bob.cellX);
            Assert.IsNotNull(map.spawn);
            Assert.AreEqual(64f, map.spawn.x);
            Assert.AreEqual(32f, map.spawn.y);
            Assert.AreEqual(2, map.spawn.cellY);
            Assert.AreSame(map.entities[0].items[0], map.FindSpawnItem());
        }

        [Test]
        public void ReadsEveryFieldKind()
        {
            var fields = SmapMap.Parse(Sample).entities[0].items[1].fields;
            CollectionAssert.AreEqual(new[] { "line", "hp", "speed", "hostile", "mood", "home", "goal" }, fields.Select(f => f.name).ToArray());

            Assert.IsTrue(SmapEntityField.Find(fields, "line").TryGet(out string line));
            Assert.AreEqual("Merhaba, \"yolcu\"\n\u00e7", line);
            Assert.IsTrue(SmapEntityField.Find(fields, "hp").TryGet(out int hp));
            Assert.AreEqual(-3, hp);
            Assert.IsTrue(SmapEntityField.Find(fields, "hp").TryGet(out string hpText));
            Assert.AreEqual("-3", hpText);
            Assert.IsTrue(SmapEntityField.Find(fields, "speed").TryGet(out float speed));
            Assert.AreEqual(1.25f, speed);
            Assert.IsFalse(SmapEntityField.Find(fields, "speed").TryGet(out int _), "1.25 is not an int");
            Assert.IsTrue(SmapEntityField.Find(fields, "hostile").TryGet(out bool hostile));
            Assert.IsTrue(hostile);
            Assert.IsFalse(SmapEntityField.Find(fields, "hostile").TryGet(out float _));
            Assert.IsTrue(SmapEntityField.Find(fields, "mood").TryGet(out string mood));
            Assert.AreEqual("calm", mood);
            var home = SmapEntityField.Find(fields, "home");
            Assert.AreEqual("levelRef", home.type);
            Assert.IsFalse(home.hasValue);
            Assert.IsFalse(home.TryGet(out string _), "null levelRef is unset");
            Assert.IsTrue(SmapEntityField.Find(fields, "goal").TryGet(out Vector2 goal));
            Assert.AreEqual(new Vector2(8, 4), goal);
            Assert.AreEqual("8,4", SmapEntityField.Find(fields, "goal").stringValue);
            Assert.IsNull(SmapEntityField.Find(fields, "missing"));
        }

        [Test]
        public void PortalIsPlainData()
        {
            var portal = SmapMap.Parse(Sample).entities[1].items[0];
            Assert.AreEqual(SmapEntityTypes.Portal, portal.typeId);
            Assert.IsTrue(SmapEntityField.Find(portal.fields, SmapEntityTypes.PortalTargetLevel).TryGet(out string level));
            Assert.AreEqual("lvl-dungeon", level);
            Assert.IsTrue(SmapEntityField.Find(portal.fields, SmapEntityTypes.PortalTargetPoint).TryGet(out Vector2 target));
            Assert.AreEqual(new Vector2(64, 96), target);
        }

        [Test]
        public void NullSpawnAndMissingKeys()
        {
            string sample = Sample.Replace("\r\n", "\n"); // in case git checked the source out with CRLF
            int at = sample.IndexOf("  \"spawn\"");
            var noSpawn = SmapMap.Parse(sample.Substring(0, at) + "  \"spawn\": null\n}\n");
            Assert.IsNull(noSpawn.spawn, "JsonUtility reads null as a zeroed object; Parse must undo that");
            Assert.IsNull(noSpawn.FindSpawnItem());
            // A v0.4 file has neither key.
            int ent = sample.IndexOf(",\n  \"entities\"");
            var old = SmapMap.Parse(sample.Substring(0, ent) + "\n}\n");
            Assert.IsEmpty(old.Validate());
            Assert.IsEmpty(old.entities);
            Assert.IsNull(old.spawn);
        }

        [Test]
        public void EntityCentreMatchesTileCellCentre()
        {
            // 32x16 px cells: 1 unit wide, 0.5 units tall; map 4 rows => top edge at y = 2 units.
            var map = SmapMap.Parse(Sample);
            var spawn = map.entities[0].items[0]; // one cell at editor cell (2,2)
            var centre = SmapCoords.EntityCenter(spawn.x, spawn.y, spawn.width, spawn.height, map.height, map.tileWidth, map.tileHeight, map.yUp);
            var cell = SmapCoords.ToCell(2, 2, map.height, map.yUp);
            var cellSize = SmapCoords.CellSize(map.tileWidth, map.tileHeight);
            Assert.AreEqual(new Vector3((cell.x + 0.5f) * cellSize.x, (cell.y + 0.5f) * cellSize.y, 0f), centre);
            Assert.AreEqual(new Vector3(2.5f, 0.75f, 0f), centre);

            // 64x32 px NPC whose top-left is the top-right cell: centre one cell right of it, one row down.
            var bob = map.entities[0].items[1];
            Assert.AreEqual(new Vector3(5f, 1.5f, 0f), SmapCoords.EntityCenter(bob.x, bob.y, bob.width, bob.height, map.height, map.tileWidth, map.tileHeight, map.yUp));
            Assert.AreEqual(new Vector2(2f, 1f), SmapCoords.EntitySize(bob.width, bob.height, map.tileWidth));

            // Bottom-left cell, and a y-up file (no flip).
            Assert.AreEqual(new Vector3(0.5f, 0.25f, 0f), SmapCoords.EntityCenter(0, 48, 32, 16, 4, 32, 16, false));
            Assert.AreEqual(new Vector3(0.5f, 0.25f, 0f), SmapCoords.EntityCenter(0, 0, 32, 16, 4, 32, 16, true));
        }

        [Test]
        public void RejectsBadEntities()
        {
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("\"id\": \"bob\"", "\"id\": \"\"")).Validate());
            Assert.IsNotEmpty(SmapMap.Parse(Sample.Replace("\"width\": 64", "\"width\": 0")).Validate());
        }
    }
}
