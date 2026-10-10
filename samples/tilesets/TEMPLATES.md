# Terrain templates (autotile)

Terrain is a **brush on ordinary tile layers** (CLAUDE.md › Veri kararları ›
Autotile, October 2026 — the Tiled / Godot model). The real data are the
tiles on the layer; the terrain information is a set of **tags on tileset
tiles**. There is no terrain grid layer and no derived layer any more.

The user never writes rules. In the editor:

1. Tileset ⚙ **Düzenle → Arazi**, drag a **rough rectangle** over the block
   (a single click inside it works too). The program finds the template and
   the exact block origin from the pixels (core `detectTerrainBlock`,
   `packages/core/src/terrainDetect.ts`) and outlines the best candidate;
   the Denetçi's ARAZİ card lists the other candidates with their scores.
2. Name, colour, the set to add to (new set, or an existing set of the same
   kind) and — for corner sets — the background terrain → **Tanımla**. The
   template is applied as a **tagging macro** (`tagBlockWithTemplate`,
   `packages/core/src/terrainSet.ts`) in one undo step (`setTerrainSet`).
3. Paint: the terrain brush works on the **active tile layer** with the
   brush, rectangle, fill and eraser (`paintTerrainBrush`). Tiles without a
   tag in the set ("manual" tiles) are never changed unless the brush paints
   that very cell. Right click on a tagged tile picks its terrain.
4. **Düzelt**: tiles the template got wrong (or extra variants anywhere in
   the tileset) are tagged by hand — click a tile corner (corner sets) or a
   zone of the tile (blob sets: centre = membership, the eight outer zones =
   neighbour bits).

## Stored data (`project.smap`, per tileset, `terrainSets`)

```json
{ "id": "terrain-1", "name": "Çimen & Toprak", "kind": "corner",
  "terrains": [{ "id": 1, "name": "Çimen", "color": "#5fb85f" },
               { "id": 2, "name": "Toprak", "color": "#b5895a" }],
  "background": 2,
  "tiles": [{ "tileId": 0, "corners": [2, 2, 2, 2] }, ...] }
```

| field | meaning |
|---|---|
| `kind` | `"corner"`: each tag lists the terrain on the tile's corners `[nw, ne, se, sw]` (0 = none). `"blob"`: each tag is `{terrainId, mask}` (8-neighbour mask, reduced) |
| `terrains` | `{id 1..255, name, color "#rrggbb"}`, sorted by id |
| `background` | terrain the eraser leaves (0 / missing = empty cells) |
| `tiles` | tags, sorted by tile id, at most one per tile |

Several terrains of one corner set meet and **transition** into each other
(grass / dirt / water ...): tag the dirt block with background = grass and
the solver uses those tiles between grass and dirt. A blob terrain is drawn
"over anything else".

## Templates (tagging macros)

Slot `s` of a block is the tile at `(origin.col + s % columns, origin.row + floor(s / columns))`.
Each template lists the mask every slot shows; some layouts have unused cells.
In code: `TERRAIN_TEMPLATES` (`packages/core/src/terrain.ts`).

| template | set kind | block | unused cells | sample |
|---|---|---|---|---|
| `blob47-godot` | blob | 12×4 | (10, 1) | `blob47-godot-32.png` |
| `blob47-cr31` | blob | 7×7 | (6, 0), (0, 6) | `blob47-cr31-32.png` |
| `corner16` | corner | 4×4 | — | `wang16-32.png` |
| `blob47` (legacy, "smap-sorted") | blob | 8×6 | (7, 5) | `blob47-32.png` |

### corner16 — 2-corner Wang, 4×4 block

Corner bits: `NE = 1`, `SE = 2`, `SW = 4`, `NW = 8`. A set bit means that
corner shows the terrain being defined; a clear bit shows the background
(0 = none). Slot = mask, row-major:

| | col 0 | col 1 | col 2 | col 3 |
|---|---|---|---|---|
| row 0 | 0 (none) | 1 NE | 2 SE | 3 NE SE |
| row 1 | 4 SW | 5 NE SW | 6 SE SW | 7 NE SE SW |
| row 2 | 8 NW | 9 NE NW | 10 SE NW | 11 NE SE NW |
| row 3 | 12 SW NW | 13 NE SW NW | 14 SE SW NW | 15 all |

`wang16-32.png` / `wang16-32.md` use exactly this layout (grass over dirt:
define "Toprak" from the block with no background first, or define "Çimen"
with background "Toprak" to get the transitions).

### blob47 family — 47-tile blob

Neighbour bits (cr31 convention): `N = 1, NE = 2, E = 4, SE = 8, S = 16,
SW = 32, W = 64, NW = 128`. A corner bit counts only when both adjacent edge
bits are set; this reduction maps the 256 raw masks onto exactly 47 masks.
Every blob layout holds each of the 47 masks exactly once; only the
arrangement differs.

#### `blob47-godot` — 12×4

The Godot 3 "3×3 minimal" autotile template (godot-docs
`tutorials/2d/img/autotile_template_3x3_minimal.png`). Ready-made blob
tilesets are most often drawn on this sheet. Cell (10, 1) is blank.

| row | col 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 16 | 20 | 84 | 80 | 213 | 92 | 116 | 87 | 28 | 125 | 124 | 112 |
| 1 | 17 | 21 | 85 | 81 | 29 | 127 | 253 | 113 | 31 | 119 | – | 245 |
| 2 | 1 | 5 | 69 | 65 | 23 | 223 | 247 | 209 | 95 | 255 | 221 | 241 |
| 3 | 0 | 4 | 68 | 64 | 117 | 71 | 197 | 93 | 7 | 199 | 215 | 193 |

#### `blob47-cr31` — 7×7

cr31's blob reference sheet (www.cr31.co.uk/stagecast/wang/blob.html). The
source repeats the empty tile at (6, 0) and (0, 6); here those cells are unused.

| row | col 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 4 | 92 | 124 | 116 | 80 | – |
| 1 | 16 | 20 | 87 | 223 | 241 | 21 | 64 |
| 2 | 29 | 117 | 85 | 71 | 221 | 125 | 112 |
| 3 | 31 | 253 | 113 | 28 | 127 | 247 | 209 |
| 4 | 23 | 199 | 213 | 95 | 255 | 245 | 81 |
| 5 | 5 | 84 | 93 | 119 | 215 | 193 | 17 |
| 6 | – | 1 | 7 | 197 | 69 | 68 | 65 |

#### `blob47` — legacy "smap-sorted", 8×6

The 47 reduced masks sorted ascending (slot = rank, cell (7, 5) unused). The
v0.3 draft layout; kept only so old files keep working. Detection tries it
only on request. Full table in `blob47-32.md`.

## Painting semantics (core `terrainBrush.ts`)

- **Corner sets**: the brush sets the terrain on the painted cells' corners
  (vertices); every touched cell gets the tile whose tagged corners match
  (flips of tagged tiles count). Where no tile matches, intermediate
  terrains of the set may spread up to `maxExpand` (default 4) cells to
  build a transition path; a terrain without transitions stays where it is
  painted.
- **Blob sets**: painted cells join the terrain; each cell of the terrain
  gets the tile for its 8-neighbour mask (neighbours of the same terrain, or
  outside the map, connect). The eraser removes membership (or paints the
  set's background).
- Manual (untagged) tiles are kept, and count as "not this terrain".
- Variant choice between several tiles with the same tags is
  `hash(seed, x, y)` — undo and reopening always show the same tile.
- Fill covers the 4-connected region of the same terrain (or of the same
  tile, for transition / manual tiles).

## Old files

Projects from before October 2026 had terrain grid layers ("Çimen (arazi)")
writing into a derived tile layer, and `terrains` (template + origin) on the
tileset. On open they are migrated without a visible change: the tileset
terrains become terrain sets (the same template applied as tags, set id
`terrain-<id>`), the grid layers are dropped and their derived tiles stay as
ordinary tiles. The project is marked changed and a toast says "Proje yeni
arazi biçimine taşındı"; the next save writes the new format.
