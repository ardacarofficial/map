# Smap Map Importer (Unity)

Imports maps exported by the Harita Tasarlayıcı editor. Each `<level>.smapmap`
file becomes a prefab asset:

```text
main (Grid, cell size 1 × tileHeight/tileWidth)
├── Ground              Tilemap + TilemapRenderer (sorting order 0)
├── Deco                Tilemap + TilemapRenderer (sorting order 1), hidden layers inactive
└── Collision (solid)   Tilemap + Rigidbody2D (Static) + TilemapCollider2D (Merge) + CompositeCollider2D
```

The link works through files only. The editor writes files into your Unity
project, and Unity imports them. Nothing is synced live.

Requires Unity 6.3 LTS (`6000.3`) or newer.

## Install

1. Window › Package Manager › **+** › **Add package from disk…**
2. Select `unity/com.smap.mapimporter/package.json` from the editor repository.

The tilemap and 2D physics modules are pulled in as dependencies. Unity
creates the `.meta` files for the package on first load.

## Workflow

1. In the editor, export to a folder inside your Unity project's `Assets/`,
   for example `Assets/Maps/`. The export writes:
   - `main.smapmap`: the map (game JSON, see `packages/core/src/export/FORMAT.md`)
   - every tileset PNG the map uses, under the file names the map references
2. Unity imports `main.smapmap` as a prefab. Drag it into a scene.
3. Export again after changes, and the prefab updates in place. A small file
   watcher re-imports `.smapmap` files, and PNGs next to them, even while
   Unity is in the background. Unity does not do that on its own.

`.smapmap` is a dedicated extension because a `ScriptedImporter` cannot claim
`.json`.

## Coordinates

The editor uses y down: cell (0,0) is the top-left cell. Unity uses y up.
The importer flips at import time:

- Unity cell = `(x, height - 1 - y)`. The top-left editor cell ends up at the
  top-left of the Tilemap, and the map spans cells `0..width-1 × 0..height-1`.
- Sprite rectangles are flipped to Unity's bottom-left texture origin.

One Unity unit is one map tile: pixels-per-unit equals the map's tile width.

## Tileset PNGs and their import settings

The importer does **not** use or change the PNG's own import settings. It
reads the PNG file and creates its own texture inside the map asset, with
these settings:

- Point filter, no compression, no mipmaps, clamp
- sprites at PPU = tile width, full-rect mesh

The pixels therefore always stay sharp, whatever the PNG's Texture Import
Settings say. The PNG itself remains an ordinary texture asset that you can
ignore. Set it to Point/no compression anyway if you use it elsewhere.

If thin lines appear between tiles at some zoom levels, use a Pixel Perfect
Camera. The usual Tilemap advice applies.

## Collision

`collision.solid` in the file is the editor's derived collision: solid tiles,
plus the exceptions painted on collision layers. It fills the
"Collision (solid)" Tilemap. That Tilemap has no renderer. Its cells merge
into polygons through `CompositeCollider2D`
(`TilemapCollider2D.compositeOperation = Merge`). Each collision kind gets
its own GameObject, so you can give it its own Unity layer. v0.4 has one
kind: solid.

## Tests

Edit-mode tests for the coordinate conversions and the format parser live in
`Tests/Editor`. To run them, add the package to `testables` in your
project's `Packages/manifest.json`:

```json
"testables": ["com.smap.mapimporter"]
```

Then open Window › General › Test Runner › EditMode.

## Limits

- Diagonal flips are not produced by the editor yet. The importer ignores
  them with a warning.
- A tile larger or smaller than the map cell is anchored at the bottom-left
  of its cell, as in Tiled. Flipping it mirrors it in place (around its own
  centre), as in the editor and Tiled.
