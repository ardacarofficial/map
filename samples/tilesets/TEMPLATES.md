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
| `template` | `"corner16"` or `"blob47"` |
| `origin` | `{col, row}` of the block's top-left tile in the tileset grid |
| `variants` | optional `[{slot, tileIds}]`: extra tiles for a slot, anywhere in the same tileset |

Slot `s` of a block is the tile at `(origin.col + s % columns, origin.row + floor(s / columns))`.

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

## blob47 — 47-tile blob, 8×6 block

Neighbour bits (cr31 convention): `N = 1, NE = 2, E = 4, SE = 8, S = 16,
SW = 32, W = 64, NW = 128`. A corner bit counts only when both adjacent edge
bits are set (`NE` needs `N` and `E`, ...); this reduction maps the 256 raw
masks onto exactly 47 masks. The block holds those 47 reduced masks **sorted
ascending**: slot = rank, at column `slot % 8`, row `floor(slot / 8)`. The 48th
cell (col 7, row 5) is unused. The full slot → mask table is in
`blob47-32.md` (index 0 = mask 0 = isolated tile, index 46 = mask 255 = fully
surrounded).

**Painting semantics.** A painted cell gets the tile for its 8-neighbour mask;
a neighbour bit is set when that neighbour holds the same terrain **or lies
outside the map** (the map edge draws no border). Unpainted cells stay empty.
Diagonal-only contact does not connect (corner bits need both edges).

**Why this layout.** CLAUDE.md wants the layout most ready-made tilesets
use. There is no single blob layout every tileset follows (cr31's 7×7 picture
sheet, Godot 3's 12×4 "3x3 minimal" sheet, RPG Maker's A2 sub-tile format
and tool-specific exports all differ), and the cr31 picture arrangement
could not be reproduced here with certainty. The ascending-mask layout is
unambiguous, documented tile by tile, and already used by `blob47-32.png`,
so it is the v0.3 standard. **The sample PNG does not need to be
regenerated.** Supporting another layout later means adding another
template value with its own slot table; the derivation stays the same.

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
