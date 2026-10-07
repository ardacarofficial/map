# Game export format (`smapExport` 1)

The engine-facing map format written by `exportGameJson(doc)` and, under the
`.smapmap` extension, by `exportUnityMap(doc, levelName)`. It is separate from
the editor's save format (`smap-level`): no palette, no chunks, no editor
state (locks, terrain grids, seeds). One format serves "JSON dışa aktarma"
and the Unity importer (`unity/com.smap.mapimporter`).

## Files

```text
<Assets folder>/
├── main.smapmap     this JSON (UTF-8, LF, deterministic)
├── grass.png        every tileset image referenced by "tilesets[].image"
└── items.png
```

`ExportResult.images` lists `{ sourcePath, fileName }` pairs. The editor
copies each project PNG (`sourcePath`) to `fileName` next to the map. Image
names are the basenames of the tileset paths, made unique case-insensitively
(`tiles.png`, `Tiles-2.png`). Only tilesets used by at least one exported cell
appear.

## Structure

```jsonc
{
  "smapExport": 1,          // format version, bumped only on breaking changes
  "width": 40,              // map size in cells
  "height": 30,
  "tileWidth": 32,          // map cell size in pixels
  "tileHeight": 32,
  "yUp": false,             // coordinates are the editor's: (0,0) = top-left cell, y grows downward
  "tilesets": [
    {
      "name": "Grass",
      "image": "grass.png",  // relative to the map file
      "tileWidth": 32, "tileHeight": 32,
      "columns": 8, "rows": 8,
      "margin": 0,           // pixels around the image edge
      "spacing": 0           // pixels between tiles
    }
  ],
  "layers": [               // tile layers, bottom (drawn first) to top
    {
      "id": "ground",        // stable editor layer id
      "name": "Ground",
      "visible": true,
      "opacity": 1,          // 0..1
      "cells": [             // flat rows of 5 ints: x, y, tileset, tileId, flags
        0, 0, 0, 1, 0,
        3, 0, 0, 9, 1
      ]
    }
  ],
  "collision": {
    "solid": [12, 3, 1185]  // run lengths, see below
  },
  "entities": [             // v0.6: entity layers, bottom to top (may be [])
    {
      "id": "things",        // stable editor layer id
      "name": "Things",
      "visible": true,
      "items": [
        {
          "id": "c1",          // stable entity id, unique in the level
          "type": "Chest",     // type name (the type id if the type was deleted)
          "typeId": "chest",   // stable type id; "spawn" and "portal" are built in
          "x": 96, "y": 0,     // pixels, top-left corner of the entity box, y down
          "cellX": 3, "cellY": 0, // cell under (x, y): floor(x / tileWidth), floor(y / tileHeight)
          "width": 16, "height": 16, // pixels; one map cell unless set in the editor
          "color": "#a855f7", // the type's colour "#rrggbb" ("" if the type was deleted)
          "fields": [          // the type's fields in definition order
            { "name": "count", "type": "int", "value": 3 },
            { "name": "kind", "type": "enum", "value": "gold" }
          ]
        }
      ]
    }
  ],
  "spawn": { "x": 32, "y": 64, "cellX": 1, "cellY": 2 }  // v0.6: or null
}
```

Key order is fixed and always as shown. All fields are always present
(`entities` may be empty and `spawn` may be `null`).

`entities` and `spawn` were added in v0.6 without bumping `smapExport`:
readers that do not know them ignore them (Unity's `JsonUtility` skips
unknown fields, so the v0.4 importer keeps working).

### Cells

Each layer's `cells` is a flat integer array, one 5-tuple per non-empty cell,
sorted by `y`, then `x`:

| # | Field     | Meaning |
|---|-----------|---------|
| 0 | `x`       | column, `0 ≤ x < width` |
| 1 | `y`       | row, `0 ≤ y < height`, **0 = top row** |
| 2 | `tileset` | index into `tilesets` |
| 3 | `tileId`  | tile index in the tileset grid, row-major: `row * columns + col` |
| 4 | `flags`   | `1` = flip horizontally, `2` = flip vertically, `4` = diagonal (reserved, not produced yet) |

The tile's source rectangle in its image (pixels, origin top-left):
`x = margin + col * (tileWidth + spacing)`, `y = margin + row * (tileHeight + spacing)`.

**Why sparse rows, not dense arrays:** most layers above the ground are
largely empty, so rows are smaller there. Each row names its own tile, so
no palette or GID table has to be decoded. Flags live in their own small
field instead of the top bits, so values never overflow a signed 32-bit
`int` (C# `int`, Unity `JsonUtility`). A flat array instead of nested arrays
is readable by Unity's `JsonUtility`, so the importer needs no JSON library.
A dense ground layer costs about 5× more numbers than a dense array would.
That stays acceptable at the sizes this editor targets.

Grid layers (terrain and collision) are **not** exported. A terrain grid's
look is in its derived tile layer, which is exported like any tile layer.
Collision exceptions are folded into `collision`.

### Collision

`collision.solid` is the derived collision (`deriveCollision`): solid tiles
on any tile layer (hidden layers too), overridden by collision exception
layers. It is run-length encoded over the whole map, row-major from the
top-left cell (`index = y * width + x`). Runs alternate passable/solid and
**always start with a passable run**, which may be `0`. The runs sum to
`width * height`.

```text
cells  0 0 1 1 1 0   →  [2, 3, 1]
cells  1 1           →  [0, 2]
```

Later collision kinds become sibling keys of `solid`.

### Entities

Entity positions are **pixels** in the map's own space, `yUp: false`:
origin at the top-left corner of the map, y down, `(x, y)` = top-left
corner of the entity's `width × height` box. The editor snaps entities to
cell corners, so normally `x = cellX * tileWidth`. An engine with y up
converts at import, e.g. the box's bottom edge:
`engineY = height * tileHeight - (y + boxHeight)`.

Field `value`s by `type`:

| `type`     | `value` |
|------------|---------|
| `string`   | string |
| `int`      | integer |
| `float`    | number |
| `bool`     | `true` / `false` |
| `enum`     | one of the type's enum strings |
| `levelRef` | target level **id** (stable, from the project's level list) or `null` |
| `point`    | `{ "x", "y" }` in pixels (same convention as `x`, `y`) or `null` |

An entity whose stored value no longer fits its type (the type was edited)
exports the field's default. Fields the type no longer has are not exported.

Built-in types:

- `spawn` — the player's start. At most one per level; also written as the
  top-level `spawn` (`null` when the level has none).
- `portal` (v1.1) — fields `targetLevel` (`levelRef`) and `targetPoint`
  (`point`, pixels in the target level). An editor marker only; the game
  decides what entering it does. A portal whose level was deleted keeps the
  dangling id.

### Coordinates

The file uses the editor's convention (`yUp: false`). An engine with y up
flips **at import**:

- cell: `engineY = height - 1 - y`
- sprite rectangle in a bottom-left-origin texture: `texY = imageHeight - (srcY + tileHeight)`

Flip flags are visual and need no conversion. A vertical flip stays a
vertical flip. A tile mirrors in place, within its own rectangle; a tile
larger or smaller than the map cell stays anchored bottom-left of its cell
(Tiled's rule), so an engine that flips around the cell centre must shift it
back (the Unity importer does, `SmapCoords.FlipMatrix`).

## Determinism

The same document always yields the same bytes. Palette order, chunk
insertion order and undo history do not affect the output, and a
save/reload round trip yields the same export. Line endings are `\n`, with
a trailing newline.

## Tiled (TMJ)

`exportTmj(doc, levelName, { imagePath? })` writes `<level>.tmj`:
orthogonal, `right-down`, finite, `version` "1.10". Tile layers are dense
GID arrays (one map row per line), and tilesets are embedded. GID =
`firstgid + tileId` with Tiled's flip bits (H `0x80000000`, V `0x40000000`,
D `0x20000000`), the same layout as the editor's cells. `firstgid` starts
at 1 and grows by each tileset's `tilecount`. Solid tiles get the bool tile
property `solid: true`. Collision exception layers cannot be expressed
without objects, so they are not exported, and `warnings` says so. Godot 4
(via a Tiled importer) and Phaser read this file.

Entity layers become object layers (`"type": "objectgroup"`,
`draworder: "topdown"`) in their place in the layer order; layer `id`s
count tile and object layers together. Each entity is a rectangle object:
`x`, `y` its top-left pixel, `width` / `height` its box, `name` its entity
id, `type` its type name (Tiled 1.9+ calls it "class" in the editor and
still writes `type` in JSON). Custom `properties`, sorted by name: the
string `typeId`, plus one per type field: `int` → `int`, `float` →
`float`, `bool` → `bool`, `string` / `enum` / `levelRef` → `string`
(`""` when unset), `point` → `string` `"x,y"` (`""` when unset). Object
ids are 1, 2, … in layer then entity order; `nextobjectid` follows them.
