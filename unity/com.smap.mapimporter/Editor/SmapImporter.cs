using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor.AssetImporters;
using UnityEngine;
using UnityEngine.Tilemaps;

namespace Smap.MapImporter
{
    /// <summary>
    /// Turns a <c>.smapmap</c> file (the editor's game JSON) into a prefab:
    /// a <see cref="Grid"/> root, one <see cref="Tilemap"/> per tile layer
    /// (bottom to top) and a "Collision (solid)" Tilemap with a merged
    /// <see cref="CompositeCollider2D"/>, plus "Entities" (one child with a
    /// <see cref="SmapEntity"/> per editor entity) and "Spawn" (<see cref="SmapSpawn"/>).
    ///
    /// Tileset PNGs next to the map are read as files. The importer builds its
    /// own Point-filtered, uncompressed copies as sub-assets and never touches
    /// the PNG's own import settings. Sprites, Tiles and textures are all
    /// sub-assets of this file.
    /// </summary>
    [ScriptedImporter(3, "smapmap")]
    public sealed class SmapImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext ctx)
        {
            SmapMap map;
            try
            {
                map = SmapMap.Parse(File.ReadAllText(ctx.assetPath));
            }
            catch (Exception e)
            {
                ctx.LogImportError($"{ctx.assetPath}: cannot read map JSON: {e.Message}");
                return;
            }
            var errors = map.Validate();
            if (errors.Count > 0)
            {
                foreach (var error in errors) ctx.LogImportError($"{ctx.assetPath}: {error}");
                return;
            }

            string folder = Path.GetDirectoryName(ctx.assetPath)?.Replace('\\', '/') ?? "Assets";
            var textures = LoadTextures(ctx, map, folder);

            var root = new GameObject(Path.GetFileNameWithoutExtension(ctx.assetPath));
            root.AddComponent<Grid>().cellSize = SmapCoords.CellSize(map.tileWidth, map.tileHeight);

            var tiles = new Dictionary<long, Tile>();
            for (int l = 0; l < map.layers.Length; l++)
            {
                var layer = map.layers[l];
                var go = new GameObject(string.IsNullOrEmpty(layer.name) ? $"Layer {l}" : layer.name);
                go.transform.SetParent(root.transform, false);
                var tilemap = go.AddComponent<Tilemap>();
                tilemap.color = new Color(1f, 1f, 1f, Mathf.Clamp01(layer.opacity));
                go.AddComponent<TilemapRenderer>().sortingOrder = l;

                var changes = new List<TileChangeData>(layer.cells.Length / SmapMap.CellStride);
                for (int i = 0; i < layer.cells.Length; i += SmapMap.CellStride)
                {
                    int x = layer.cells[i], y = layer.cells[i + 1], ts = layer.cells[i + 2], tileId = layer.cells[i + 3], flags = layer.cells[i + 4];
                    var tile = GetTile(ctx, map, textures, tiles, ts, tileId);
                    if (tile == null) continue;
                    changes.Add(new TileChangeData
                    {
                        position = SmapCoords.ToCell(x, y, map.height, map.yUp),
                        tile = tile,
                        color = Color.white,
                        transform = SmapCoords.OrientationMatrix(flags, map.tilesets[ts], map.tileWidth, map.tileHeight),
                    });
                }
                if (changes.Count > 0) tilemap.SetTiles(changes.ToArray(), true);
                tilemap.CompressBounds();
                if (!layer.visible) go.SetActive(false);
            }

            AddCollision(ctx, map, root);
            AddEntities(map, root);

            ctx.AddObjectToAsset("root", root);
            ctx.SetMainObject(root);
        }

        /// <summary>One importer-owned texture per tileset (null where the PNG is missing or unreadable).</summary>
        static Texture2D[] LoadTextures(AssetImportContext ctx, SmapMap map, string folder)
        {
            var textures = new Texture2D[map.tilesets.Length];
            for (int t = 0; t < map.tilesets.Length; t++)
            {
                var ts = map.tilesets[t];
                string path = folder + "/" + ts.image;
                // Reimport this map whenever the PNG changes (or appears).
                ctx.DependsOnSourceAsset(path);
                if (!File.Exists(path))
                {
                    ctx.LogImportError($"{ctx.assetPath}: tileset image \"{ts.image}\" not found next to the map (expected {path}).");
                    continue;
                }
                // Decode the file ourselves: works whatever the PNG's import settings are
                // (no Read/Write needed) and leaves those settings untouched. Keep the CPU
                // copy (markNonReadable: false): the sub-asset is serialized from it, and a
                // texture released with markNonReadable may be saved without pixels.
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = Path.GetFileNameWithoutExtension(ts.image) };
                if (!texture.LoadImage(File.ReadAllBytes(path), false))
                {
                    ctx.LogImportError($"{ctx.assetPath}: cannot decode {path}.");
                    UnityEngine.Object.DestroyImmediate(texture);
                    continue;
                }
                texture.filterMode = FilterMode.Point;
                texture.wrapMode = TextureWrapMode.Clamp;
                ctx.AddObjectToAsset($"texture/{t}", texture);
                textures[t] = texture;
            }
            return textures;
        }

        /// <summary>The Tile (and Sprite) for a tileset tile, created on first use.</summary>
        static Tile GetTile(AssetImportContext ctx, SmapMap map, Texture2D[] textures, Dictionary<long, Tile> tiles, int ts, int tileId)
        {
            long key = ((long)ts << 32) | (uint)tileId;
            if (tiles.TryGetValue(key, out var cached)) return cached;
            Tile tile = null;
            var texture = textures[ts];
            if (texture != null)
            {
                var set = map.tilesets[ts];
                var rect = SmapCoords.SpriteRect(set, tileId, texture.height);
                if (rect.xMin < 0 || rect.yMin < 0 || rect.xMax > texture.width || rect.yMax > texture.height)
                {
                    ctx.LogImportWarning($"{ctx.assetPath}: tile {tileId} lies outside {set.image} ({texture.width}x{texture.height}); skipped.");
                }
                else
                {
                    string name = $"{set.name}_{tileId}";
                    var sprite = Sprite.Create(texture, rect, SmapCoords.Pivot(set, map.tileWidth, map.tileHeight), map.tileWidth, 0, SpriteMeshType.FullRect);
                    sprite.name = name;
                    ctx.AddObjectToAsset($"sprite/{ts}/{tileId}", sprite);
                    tile = ScriptableObject.CreateInstance<Tile>();
                    tile.name = name;
                    tile.sprite = sprite;
                    tile.colliderType = Tile.ColliderType.None;
                    tile.flags = TileFlags.None; // per-cell transform (flips, rotations) and colour come from the Tilemap
                    ctx.AddObjectToAsset($"tile/{ts}/{tileId}", tile);
                }
            }
            tiles[key] = tile;
            return tile;
        }

        /// <summary>
        /// "Collision (solid)": an invisible Tilemap (no renderer) filled with a
        /// grid-shaped collider tile, merged by a static CompositeCollider2D.
        /// Only the exported manual Collision grid determines these cells; visual tiles never imply collision.
        /// Each collision kind gets its own object so it can have its own Unity layer.
        /// </summary>
        static void AddCollision(AssetImportContext ctx, SmapMap map, GameObject root)
        {
            bool[] solid = SmapCoords.DecodeRle(map.collision.solid, map.width * map.height);
            var positions = new List<Vector3Int>();
            for (int i = 0; i < solid.Length; i++)
            {
                if (solid[i]) positions.Add(SmapCoords.ToCell(i % map.width, i / map.width, map.height, map.yUp));
            }

            var go = new GameObject("Collision (solid)");
            go.transform.SetParent(root.transform, false);
            var tilemap = go.AddComponent<Tilemap>();
            var body = go.AddComponent<Rigidbody2D>();
            body.bodyType = RigidbodyType2D.Static;
            var tilemapCollider = go.AddComponent<TilemapCollider2D>();
            tilemapCollider.compositeOperation = Collider2D.CompositeOperation.Merge;
            var composite = go.AddComponent<CompositeCollider2D>();
            composite.geometryType = CompositeCollider2D.GeometryType.Polygons;
            if (positions.Count == 0) return;

            // A 1x1 white sprite keeps the collider tile well-formed; it is never drawn (no renderer).
            var pixel = new Texture2D(1, 1, TextureFormat.RGBA32, false) { name = "CollisionPixel", filterMode = FilterMode.Point };
            pixel.SetPixel(0, 0, Color.white);
            pixel.Apply(false, false); // keep the CPU copy; see LoadTextures
            ctx.AddObjectToAsset("collision/texture", pixel);
            var sprite = Sprite.Create(pixel, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f, 0, SpriteMeshType.FullRect);
            sprite.name = "CollisionSolid";
            ctx.AddObjectToAsset("collision/sprite", sprite);
            var tile = ScriptableObject.CreateInstance<Tile>();
            tile.name = "CollisionSolid";
            tile.sprite = sprite;
            tile.colliderType = Tile.ColliderType.Grid;
            ctx.AddObjectToAsset("collision/tile", tile);

            var tileArray = new TileBase[positions.Count];
            for (int i = 0; i < tileArray.Length; i++) tileArray[i] = tile;
            tilemap.SetTiles(positions.ToArray(), tileArray);
            tilemap.CompressBounds();
        }
    
        /// <summary>
        /// "Entities": one child per entity, named "type#id", at the centre of
        /// its box, holding the data in a <see cref="SmapEntity"/>. Entities on
        /// hidden layers are inactive, like hidden tile layers. "Spawn": the
        /// player's start with a <see cref="SmapSpawn"/> marker.
        /// </summary>
        static void AddEntities(SmapMap map, GameObject root)
        {
            var group = new GameObject("Entities");
            group.transform.SetParent(root.transform, false);
            foreach (var layer in map.entities)
            {
                foreach (var item in layer.items)
                {
                    var go = new GameObject($"{(string.IsNullOrEmpty(item.type) ? item.typeId : item.type)}#{item.id}");
                    go.transform.SetParent(group.transform, false);
                    go.transform.localPosition = SmapCoords.EntityCenter(item.x, item.y, item.width, item.height, map.height, map.tileWidth, map.tileHeight, map.yUp);
                    var entity = go.AddComponent<SmapEntity>();
                    entity.id = item.id;
                    entity.typeName = item.type;
                    entity.typeId = item.typeId;
                    entity.layerId = layer.id;
                    entity.layerName = layer.name;
                    entity.pixelPosition = new Vector2(item.x, item.y);
                    entity.cell = new Vector2Int(item.cellX, item.cellY);
                    entity.size = SmapCoords.EntitySize(item.width, item.height, map.tileWidth);
                    entity.color = EntityColor(item);
                    entity.fields = new List<SmapEntityField>(item.fields);
                    if (!layer.visible) go.SetActive(false);
                }
            }

            if (map.spawn == null) return;
            // The top-level spawn has no size; take it from the spawn entity (one cell if absent).
            var spawnItem = map.FindSpawnItem();
            float w = spawnItem?.width ?? map.tileWidth, h = spawnItem?.height ?? map.tileHeight;
            var spawnGo = new GameObject("Spawn");
            spawnGo.transform.SetParent(root.transform, false);
            spawnGo.transform.localPosition = SmapCoords.EntityCenter(map.spawn.x, map.spawn.y, w, h, map.height, map.tileWidth, map.tileHeight, map.yUp);
            var spawn = spawnGo.AddComponent<SmapSpawn>();
            spawn.pixelPosition = new Vector2(map.spawn.x, map.spawn.y);
            spawn.cell = new Vector2Int(map.spawn.cellX, map.spawn.cellY);
        }

        /// <summary>The exported type colour, else the built-in types' editor colours, else a stable hue per type id.</summary>
        static Color EntityColor(SmapEntityItem item)
        {
            if (!string.IsNullOrEmpty(item.color) && ColorUtility.TryParseHtmlString(item.color, out var c)) return c;
            if (item.typeId == SmapEntityTypes.Spawn) return new Color32(0x22, 0xc5, 0x5e, 0xff);
            if (item.typeId == SmapEntityTypes.Portal) return new Color32(0xa8, 0x55, 0xf7, 0xff);
            uint hash = 2166136261;
            foreach (char ch in item.typeId ?? "") hash = (hash ^ ch) * 16777619;
            return Color.HSVToRGB((hash % 360) / 360f, 0.65f, 0.95f);
        }
    }
}
