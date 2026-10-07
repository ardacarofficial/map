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
    /// <see cref="CompositeCollider2D"/>.
    ///
    /// Tileset PNGs next to the map are read as files. The importer builds its
    /// own Point-filtered, uncompressed copies as sub-assets and never touches
    /// the PNG's own import settings. Sprites, Tiles and textures are all
    /// sub-assets of this file.
    /// </summary>
    [ScriptedImporter(1, "smapmap")]
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
            bool warnedDiagonal = false;
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
                    if ((flags & SmapCoords.FlipD) != 0 && !warnedDiagonal)
                    {
                        warnedDiagonal = true;
                        ctx.LogImportWarning($"{ctx.assetPath}: diagonal flips are not supported yet and were ignored.");
                    }
                    changes.Add(new TileChangeData
                    {
                        position = SmapCoords.ToCell(x, y, map.height, map.yUp),
                        tile = tile,
                        color = Color.white,
                        transform = SmapCoords.FlipMatrix(flags, map.tilesets[ts], map.tileWidth, map.tileHeight),
                    });
                }
                if (changes.Count > 0) tilemap.SetTiles(changes.ToArray(), true);
                tilemap.CompressBounds();
                if (!layer.visible) go.SetActive(false);
            }

            AddCollision(ctx, map, root);

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
                    tile.flags = TileFlags.None; // per-cell transform (flips) and colour come from the Tilemap
                    ctx.AddObjectToAsset($"tile/{ts}/{tileId}", tile);
                }
            }
            tiles[key] = tile;
            return tile;
        }

        /// <summary>
        /// "Collision (solid)": an invisible Tilemap (no renderer) filled with a
        /// grid-shaped collider tile, merged by a static CompositeCollider2D.
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
    }
}
