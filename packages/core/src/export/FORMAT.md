# Game export format (`smapExport` 1)

The engine-facing map format written by `exportGameJson(doc)` and, under the
`.smapmap` extension, by `exportUnityMap(doc, levelName)`. It is separate from
the editor's save format (`smap-level`): no palette, no chunks, no editor
state (locks, grid layers, seeds). One format serves "JSON dışa aktarma"
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

Options (`exportGameJson(doc, options)`, `exportUnityMap(doc, name, options)`):
`layers` limits `layers` (and the tilesets / images) to the given tile layer
ids; `collision: false` writes an all-passable `collision.solid` (one run of
`width * height`). Collision always uses every manual Collision grid,
including hidden grids, independently of `layers`. Entities are always written.

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
| 4 | `flags`   | `1` = flip horizontally, `2` = flip vertically, `4` = diagonal (x/y swap), see [Orientation](#orientation) |

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

Grid layers are folded into `collision`; they do not appear in the visual `layers` array.

### Collision

`collision.solid` comes only from manual Collision grids (`deriveCollision`).
The topmost nonzero value wins: 1 blocks movement, 2 allows movement;
zero inherits the next grid below, and no value means passable. Hidden and
locked grids still contribute. Tile artwork never implies collision. It is run-length encoded over the whole map, row-major from the
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

Flip flags are visual: a vertical flip stays a vertical flip. The diagonal
flag, however, is defined in y-down image space (see below); an engine with
y up must convert it (the Unity importer does, `SmapCoords.OrientationMatrix`).

### Orientation

The three flag bits give the eight orientations of a tile (Tiled's rule and
bit meaning). In the tile's own pixel space (`u` right, `v` **down**), the
diagonal flip is applied first, then the mirrors:

1. `4` (D): transpose, pixel `(u, v)` → `(v, u)`. A `w × h` tile becomes `h × w`.
2. `1` (H): mirror horizontally inside the (transposed) rectangle.
3. `2` (V): mirror vertically inside it.

| flags | result |
|-------|--------|
| 0 | as drawn |
| 1 | mirrored left-right |
| 2 | mirrored top-bottom |
| 3 | rotated 180° |
| 4 | transposed (mirrored about the top-left → bottom-right diagonal) |
| 5 | rotated 90° clockwise |
| 6 | rotated 90° counter-clockwise |
| 7 | mirrored about the other diagonal |

A tile mirrors and rotates in place, within its own rectangle: the
(transposed) rectangle stays anchored bottom-left of its cell, also for a
tile larger or smaller than the map cell. An engine that rotates around the
cell centre must shift it back.

**y-up engines.** With `y_up = -v`, the transpose `(u, v) → (v, u)` becomes
`(x, y) → (-y, -x)` (the other diagonal) around the tile centre; H and V stay
`x → -x` and `y → -y`. The full linear part in y-up space is
`V · H · A`, with `A = [[0, -1], [-1, 0]]` when D is set, otherwise the
identity. Example: flags `5` (D+H) gives `[[0, 1], [-1, 0]]`, a clockwise
quarter turn.

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
at 1 and grows by each tileset's `tilecount`. Godot 4 (via a Tiled importer)
and Phaser read this file.

Manual Collision is an invisible `objectgroup` named `Collision`, with the
string property `smapRole=collision`. If a visual/entity layer uses that
name, the export group gets the first available `Collision 2`, `Collision 3`,
etc. Its invisible rectangle objects use pixel coordinates with y down.
Identical horizontal blocked-cell runs merge across adjacent rows; objects
are ordered by starting y, then x. There are no per-tile solidity properties
and no collision-loss warning. Entity and collision object ids share one
sequence.

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

## Editor format compatibility

The separate editor format uses `documentFormatVersion: 5` (v4 removed terrain metadata). Raw migration
removes legacy marking metadata and invisible legacy grids without deriving
or changing tile cells, palette order, flips, layer properties or source PNGs.
Saved nine-slice stamps retain their generated PNG slots and a smart-owned
complete road profile, including custom variants. The game wire format above
remains `smapExport: 1`, with stride 5 and the same collision RLE.

### Editor format 5: thick smart sources

The v4→v5 migration changes only version headers (including embedded recipes). Cells,
palette entries, flags, saved preferences and layout-1 slot ids are unchanged.
`Stamp.nineSlice.border` is a positive integer b; thick sources have dimensions
at least 2b+1 in each axis; dimensions need not be multiples of b. `smartDisabled` keeps the plain-block preference.
Generated layout 2 additionally stores `border: b`. Its permanent slot order is:
source row-major; widths w=1..2b−1 (each w×sourceHeight row-major); heights
h=1..2b−1 (each sourceWidth×h); compact h-major then w-major patches; finally
47 ascending blob masks, each a b×b row-major patch. With S=b(2b−1), the bank
starts at WH+S(H+W)+S² and contains 47b² tiles. Regeneration retains this exact
order, identity, grid and capacity. A macro role whose edge/centre span is shorter
than b wraps within that span, never into the opposite outer band. This extends
validation to previously unsupported sizes without changing any existing format-5
slots or pixels; no migration or additional format bump is needed. Layout 1 is
byte-for-byte unchanged.

Selection identity is independent of detector/cache versions. The original b=1
selection-id ABI is retained; matching archived direct-selection recipes also
retain their existing ids, atlas and road family after reselection. Detector 4
requires coherent outer-boundary evidence for thick bands and full-span segments:
mirrored opposite profiles match within RGBA delta 16 for at least 95% of pixels
at **every** segment position. Each corner's inward-facing boundary profile
continues both adjacent edge profiles (tile gutters excluded; a constant RGB tint
offset is allowed). Every tile at every edge depth must differ from its centre
phase. Globally periodic material is rejected; nonperiodicity and unrelated tile
colours do not establish a boundary. Full-span segments do not count as observed
repetition. Small pixel grain is tolerated; asymmetric or incoherent artwork may
conservatively remain plain. Full 3×3 selections retain their unconditional rule.
This classifier change does not change recipe identity, atlas slots or format 5.

Road logical cells are b×b map tiles aligned to (0,0), including clipped map-edge
cells. D4 orientation transforms both patch positions and each tile's pixels.
Area uses free tile coordinates; short axes splice the outer bands at
ceil(targetPixels/2), with no resampling. Map borders use area artwork clipped
to the requested tile band and gaps. Game/Unity export schemas are unchanged;
generated tiles export as ordinary tile references and PNGs.

## Defold

`exportDefold(doc, levelName, imageBytes, options)` plans pure `{path,text}` /
`{path,bytes}` files for Defold 1.9.8 (commit
`67542769598a1b794877c96f740f3f527f63f491`). The editor adapter is
`export/targets/defold.ts`; folder picking, persistence and writing belong to
the common export dialog. No import or live link is involved.

Choose the Defold **project root** as the destination. `projectSubfolder`
defaults to `exported`; the map name is appended. For map `forest`, add
`/exported/forest/map.collection` to the game's collection. Each used tileset
has a PNG and `.tilesource` retaining tile dimensions and spacing. Defold's
margin surrounds **every tile**, while the editor's margin surrounds the whole
image. A nonzero outer margin is therefore cropped from the exported PNG copy;
native `tile_margin` and companion JSON `margin` become 0. Tile samples, channel
depth, palettes, transparency and colour profiles are preserved losslessly;
source/project PNGs remain unchanged. Zero-margin PNGs are copied byte for byte.
Resource references start with `/` relative to the Defold project, while file
paths are relative without `/`. Windows separators in the subfolder normalize
to `/`; OS drive/UNC paths and traversal are preflight errors. Generated numeric
resource names avoid basename collisions, reserved filenames and string escaping.

A tile layer is split into one `.tilemap` component per used tileset, in source
order. Layer z values increase in document/source order within `[0,1)`. Visibility
is preserved. File tile IDs are **zero-based**, including visible tile 0; empty
cells are omitted. File cell coordinates are `(x, -editorY-1)`. Thus the map's
top-left pixel is the native origin and the map extends toward negative Y.
Lua `set_tile`/`get_tile` use one-based coordinates and tile numbers instead.
H/V/diagonal flags map through the pinned renderer's corner permutations, with
editor flags 0..7 becoming native H/V/rotate90 masks `[0,1,2,3,6,4,7,5]`.

Collision uses **all resolved manual Collision grids**, including hidden grids
and passable overrides, independently of visual selection or empty artwork.
Identical horizontal runs merge across adjacent rows into static boxes. Box data
is half extents `(widthPx/2,heightPx/2,0.5)` with identity rotation, mass 0,
friction 0.1, restitution 0, group `map`, mask `default`. Batches of at most 16
boxes each get a separate collision component/GO; no excess rectangles are dropped.
Visual GOs also batch at 16 components. Large packages can require increasing
the host project's `physics.max_collision_objects`, `collection.max_instances`,
`tilemap.max_count` and `tilemap.max_tile_count` settings to the exported counts.

`game.json` retains the existing `smapExport:1` schema, entities (including
portal fields), spawn and collision RLE. Its image names reference the packaged
PNGs, with their normalized margin. Its coordinates remain **Y down**; consumers convert entity box origins
with `nativeY=-y-height` and point/spawn/portal positions with `nativeY=-y`.
Entities are companion data for game code, not automatically instantiated GOs.
Include the JSON path in the host project's `[resource] custom_resources` when
loading it with `sys.load_resource`; referencing the collection alone does not
bundle companion data. The engine-verification fixture demonstrates this setting.

`layers` and `collision` follow the existing exporter options. Preflight blocks
non-unit tile-layer opacity, mismatched tile/cell dimensions, rotated nonsquare
footprints, overlapping oversized art, missing PNGs or invalid tile references.
Native tile IDs must be below 65535 (the runtime's empty-cell sentinel). The
entire package fails together, with translated editor errors. Output order,
numeric names and LF text are deterministic. Official pinned schema snapshots,
strict protobuf-text tests and the engine verification provenance are in
`packages/core/test/fixtures/defold/README.md`.
