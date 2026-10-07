# Terrain templates (autotile)

The user marks a block of a tileset as "this terrain" and picks a template.
The template alone decides which tile of the block goes where; nobody writes
rules. Code: `packages/core/src/terrain.ts` (tables) and
`packages/core/src/autotile.ts` (derivation).

A terrain definition (stored in its tileset entry in `project.smap`):

| field | meaning |
|---|---|
| `id` | grid value painted into terrain layers, integer 1..65535, unique in the project |
| `name` | display name |
| `template` | `"blob47-godot"`, `"blob47-cr31"`, `"corner16"` or `"blob47"` (legacy) |
| `origin` | `{col, row}` of the block's top-left tile in the tileset grid |
| `variants` | optional `[{slot, tileIds}]`: extra tiles for a slot, anywhere in the same tileset |

Slot `s` of a block is the tile at `(origin.col + s % columns, origin.row + floor(s / columns))`
— a block cell index. Each template lists the mask every slot shows; some
layouts have unused cells. In code the list is `TERRAIN_TEMPLATES` (id,
family, language-neutral name, columns, rows, slot → mask table, `legacy`)
and `DEFAULT_TERRAIN_TEMPLATE` (`"blob47-godot"`) is the one new terrains
should start with.

| template | family | block | unused cells | sample |
|---|---|---|---|---|
| `blob47-godot` (default) | blob47 | 12×4 | (10, 1) | `blob47-godot-32.png` |
| `blob47-cr31` | blob47 | 7×7 | (6, 0), (0, 6) | `blob47-cr31-32.png` |
| `corner16` | corner16 | 4×4 | — | `wang16-32.png` |
| `blob47` (legacy, "smap-sorted") | blob47 | 8×6 | (7, 5) | `blob47-32.png` |

## corner16 — 2-corner Wang, 4×4 block

Corner bits: `NE = 1`, `SE = 2`, `SW = 4`, `NW = 8`. A set bit means that
corner of the tile shows the terrain. Slot = mask, row-major:

| | col 0 | col 1 | col 2 | col 3 |
|---|---|---|---|---|
| row 0 | 0 (none) | 1 NE | 2 SE | 3 NE SE |
| row 1 | 4 SW | 5 NE SW | 6 SE SW | 7 NE SE SW |
| row 2 | 8 NW | 9 NE NW | 10 SE NW | 11 NE SE NW |
| row 3 | 12 SW NW | 13 NE SW NW | 14 SE SW NW | 15 all |

`wang16-32.png` / `wang16-32.md` use exactly this layout.

**Painting semantics.** The terrain lives on cell corners (vertices). Painting
a cell puts the terrain on its four corners — the same as Tiled's corner
terrain brush. A vertex has the terrain when any in-map cell touching it is
painted. Result: a painted cell always gets slot 15 (fully covered); its 8
neighbours get the transition tiles (orthogonal neighbours half covered,
diagonal ones a quarter). Slot 0 is never placed (an unpainted cell with no
painted neighbour stays empty). Cells outside the map do not contribute; a
painted cell on the map edge still covers its outer corners itself, so the
edge draws no border. A 1-cell hole in a painted area is fully covered (all
four of its corners are touched by painted neighbours) — that is inherent to
corner tiles.

## blob47 family — 47-tile blob

Neighbour bits (cr31 convention): `N = 1, NE = 2, E = 4, SE = 8, S = 16,
SW = 32, W = 64, NW = 128`. A corner bit counts only when both adjacent edge
bits are set (`NE` needs `N` and `E`, ...); this reduction maps the 256 raw
masks onto exactly 47 masks. Every blob layout holds each of the 47 masks
exactly once (tested); only the arrangement differs.

### `blob47-godot` — 12×4, default

The Godot 3 "3×3 minimal" autotile template, decoded from the official
Godot docs image `tutorials/2d/img/autotile_template_3x3_minimal.png`
(godot-docs branches 3.2–3.6, identical; the docs' "top-down floor" template
uses the same arrangement). Ready-made blob tilesets (itch.io and the like)
are most often drawn on this sheet, so it is the default for new terrains.
Cell (10, 1) is blank.

| row | col 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 16 | 20 | 84 | 80 | 213 | 92 | 116 | 87 | 28 | 125 | 124 | 112 |
| 1 | 17 | 21 | 85 | 81 | 29 | 127 | 253 | 113 | 31 | 119 | – | 245 |
| 2 | 1 | 5 | 69 | 65 | 23 | 223 | 247 | 209 | 95 | 255 | 221 | 241 |
| 3 | 0 | 4 | 68 | 64 | 117 | 71 | 197 | 93 | 7 | 199 | 215 | 193 |

### `blob47-cr31` — 7×7

cr31's blob reference sheet (www.cr31.co.uk/stagecast/wang/blob.html, image
`art/atlas/blob/wangbl.png`; mirrored on boristhebrave.com). Every tile in the
source is labelled with its mask, and the art agrees. The source repeats the
empty tile at (6, 0) and (0, 6); here those cells are unused (mask 0 is (0, 0)).

| row | col 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 4 | 92 | 124 | 116 | 80 | – |
| 1 | 16 | 20 | 87 | 223 | 241 | 21 | 64 |
| 2 | 29 | 117 | 85 | 71 | 221 | 125 | 112 |
| 3 | 31 | 253 | 113 | 28 | 127 | 247 | 209 |
| 4 | 23 | 199 | 213 | 95 | 255 | 245 | 81 |
| 5 | 5 | 84 | 93 | 119 | 215 | 193 | 17 |
| 6 | – | 1 | 7 | 197 | 69 | 68 | 65 |

### `blob47` — legacy "smap-sorted", 8×6

The 47 reduced masks **sorted ascending**: slot = rank, cell (7, 5) unused.
This was the v0.3 draft layout; no real tileset uses it. It stays only so
existing files keep working (the template picker should hide it). Full
table in `blob47-32.md`.

**Painting semantics (all blob layouts).** A painted cell gets the tile for
its 8-neighbour mask; a neighbour bit is set when that neighbour holds the
same terrain **or lies outside the map** (the map edge draws no border).
Unpainted cells stay empty. Diagonal-only contact does not connect (corner
bits need both edges).

Another layout later (for example cr31's 8×6 sheet, or a tool's export) is one
more entry in `TERRAIN_TEMPLATES` with its slot → mask table; the derivation
stays the same.

## Variants

When a slot has variants its candidates are `[block tile, ...tileIds]`. Cell
(x, y) uses `candidates[hash(seed, x, y) % count]`, where `hash` is a
murmur3-style 32-bit mix (`cellHash`) and `seed` is stored in the level
file (default 0). Never a sequential RNG: undo and reopening always show the
same tile.

## Several terrains on one layer (v0.3 limitation)

Every terrain is drawn "over empty"; a different value counts as "not this
terrain". A painted cell uses its own terrain. An unpainted cell next to
corner16 terrains shows the transition of the smallest neighbouring corner16
terrain id. Terrain-to-terrain transition tiles are not supported; use one
terrain layer per terrain (each with its own derived tile layer) for clean
results.

## Derived tile layer

A terrain grid layer may link a tile layer (`targetLayerId`). The grid is the
source of truth; the linked layer is owned by it: every `paintTerrain`
recomputes the painted cells and their 8 neighbours, `defineTerrain` /
`removeTerrain` / `resizeMap` recompute the whole layer. Both the grid and the
derived tile changes are stored in the same undo step, so undo is byte-exact.
Hand edits in the derived layer are overwritten when terrain nearby changes.
