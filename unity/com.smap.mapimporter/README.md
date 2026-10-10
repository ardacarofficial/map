# Smap Map Importer (Unity)

Imports maps exported by the Harita Tasarlayıcı editor. Each `<level>.smapmap`
file becomes a prefab asset:

```text
main (Grid, cell size 1 × tileHeight/tileWidth)
├── Ground              Tilemap + TilemapRenderer (sorting order 0)
├── Deco                Tilemap + TilemapRenderer (sorting order 1), hidden layers inactive
├── Collision (solid)   Tilemap + Rigidbody2D (Static) + TilemapCollider2D (Merge) + CompositeCollider2D
├── Entities
│   ├── Chest#c1        SmapEntity (one child per entity, named "<type>#<id>")
│   └── Portal#door     SmapEntity
└── Spawn               SmapSpawn (only when the level has a start point)
```

`SmapEntity` and `SmapSpawn` live in the runtime assembly `Smap.MapImporter`
(auto-referenced), so game scripts can use them. The importer itself is
editor-only.

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
- Tile orientations (flags H/V/D, defined in the editor's y-down space) are
  converted to y-up: the diagonal flip becomes the other diagonal, so a
  rotated tile turns the same way in Unity as in the editor.

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

## Entities and the spawn point

Entity types and their fields are defined in the editor. The export writes
every entity with its type and field values, and the importer turns each one
into a GameObject under "Entities":

- Position: the **centre** of the entity's box, in the same units as the
  tiles (1 unit = map tile width). A one-cell entity sits exactly where the
  Tilemap puts a tile of that cell (`Tilemap.GetCellCenterLocal`).
- `SmapEntity`: `id`, `typeName`, `typeId`, layer id and name, the box `size`
  in units, the editor's `pixelPosition` (top-left, y down) and `cell`, and
  `fields`, the type's fields in definition order.
- Field values: `TryGet(name, out string | int | float | bool | Vector2)`.
  `string` works for every kind, as text (`"3"`, `"true"`, `"x,y"`). `int` and
  `float` work for number fields, `bool` for bool fields, `Vector2` for point
  fields. An unset `levelRef` or `point` returns `false`.
- Entities on a hidden layer are inactive, like hidden tile layers.
- Gizmos: each entity draws a box in its type's colour (spawn green, portal
  purple, other types a fixed colour per type id). The spawn draws a small
  flag.

The **spawn point** is also a separate "Spawn" child with a `SmapSpawn`
component at the centre of the spawn box. The importer adds no player logic.
Your game reads the point and starts the player there.

**Portals** (v1.1) are ordinary entities with `typeId == "portal"` and two
fields: `targetLevel` (the target level's id) and `targetPoint` (pixels in
the target level, y down). They are data only. Nothing teleports. What
entering one does is up to your game.

```csharp
using Smap.MapImporter;
using UnityEngine;

public class LevelStart : MonoBehaviour
{
    public Transform player;

    void Start()
    {
        // Start the player at the editor's spawn point.
        var spawn = FindFirstObjectByType<SmapSpawn>();
        if (spawn != null) player.position = spawn.transform.position;

        foreach (var e in FindObjectsByType<SmapEntity>(FindObjectsSortMode.None))
        {
            if (e.typeId == "chest" && e.TryGet("count", out int count))
                Debug.Log($"{e.id}: chest with {count} items at {e.transform.position}");

            if (e.typeId == SmapEntityTypes.Portal
                && e.TryGet(SmapEntityTypes.PortalTargetLevel, out string level)
                && e.TryGet(SmapEntityTypes.PortalTargetPoint, out Vector2 pixels))
                Debug.Log($"{e.id} leads to level {level}, pixel {pixels}");
        }
    }
}
```

To turn a portal's `targetPoint` into a position in the target level, use
that level's map: x = `px / tileWidth`, y = `(height * tileHeight - py) / tileWidth`
(the importer's rule for a point; see `SmapCoords.EntityCenter`).

## Tests

Edit-mode tests for the coordinate conversions (tiles, entities, spawn), the
format parser and entity field values live in
`Tests/Editor`. To run them, add the package to `testables` in your
project's `Packages/manifest.json`:

```json
"testables": ["com.smap.mapimporter"]
```

Then open Window › General › Test Runner › EditMode.

## Limits

- All eight tile orientations (X/Y flips and 90° rotations, flags H/V/D)
  are imported as the cell's transform (`SmapCoords.OrientationMatrix`).
- A tile larger or smaller than the map cell is anchored at the bottom-left
  of its cell, as in Tiled. Flipping or rotating it keeps its (rotated)
  rectangle anchored bottom-left, as in the editor and Tiled.
