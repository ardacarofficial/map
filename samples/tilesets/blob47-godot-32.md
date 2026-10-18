# blob47-godot-32.png

32px tiles, 12 columns x 4 rows (384x128), row-major.
Layout: the Godot 3 "3x3 minimal" autotile template (godot-docs `tutorials/2d/img/autotile_template_3x3_minimal.png`), the layout most ready-made blob tilesets use.
Slot 22 (col 10, row 1) is unused and transparent.

Artwork: grass over dirt. A neighbour bit set = neighbour cell is also grass.

Bitmask (cr31 convention): N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128.
Reduction rule: a corner bit counts only if BOTH adjacent edge bits are set; this yields exactly 47 masks.
Visual: grass fills the tile; an 8px dirt border on each side whose edge bit is clear; an 8x8 dirt notch at each corner whose two edges are set but the corner bit is clear.

| slot | col,row | mask | set bits |
|---|---|---|---|
| 0 | 0,0 | 16 | S |
| 1 | 1,0 | 20 | E S |
| 2 | 2,0 | 84 | E S W |
| 3 | 3,0 | 80 | S W |
| 4 | 4,0 | 213 | N E S W NW |
| 5 | 5,0 | 92 | E SE S W |
| 6 | 6,0 | 116 | E S SW W |
| 7 | 7,0 | 87 | N NE E S W |
| 8 | 8,0 | 28 | E SE S |
| 9 | 9,0 | 125 | N E SE S SW W |
| 10 | 10,0 | 124 | E SE S SW W |
| 11 | 11,0 | 112 | S SW W |
| 12 | 0,1 | 17 | N S |
| 13 | 1,1 | 21 | N E S |
| 14 | 2,1 | 85 | N E S W |
| 15 | 3,1 | 81 | N S W |
| 16 | 4,1 | 29 | N E SE S |
| 17 | 5,1 | 127 | N NE E SE S SW W |
| 18 | 6,1 | 253 | N E SE S SW W NW |
| 19 | 7,1 | 113 | N S SW W |
| 20 | 8,1 | 31 | N NE E SE S |
| 21 | 9,1 | 119 | N NE E S SW W |
| 22 | 10,1 | - | (unused, transparent) |
| 23 | 11,1 | 245 | N E S SW W NW |
| 24 | 0,2 | 1 | N |
| 25 | 1,2 | 5 | N E |
| 26 | 2,2 | 69 | N E W |
| 27 | 3,2 | 65 | N W |
| 28 | 4,2 | 23 | N NE E S |
| 29 | 5,2 | 223 | N NE E SE S W NW |
| 30 | 6,2 | 247 | N NE E S SW W NW |
| 31 | 7,2 | 209 | N S W NW |
| 32 | 8,2 | 95 | N NE E SE S W |
| 33 | 9,2 | 255 | N NE E SE S SW W NW |
| 34 | 10,2 | 221 | N E SE S W NW |
| 35 | 11,2 | 241 | N S SW W NW |
| 36 | 0,3 | 0 | (none) |
| 37 | 1,3 | 4 | E |
| 38 | 2,3 | 68 | E W |
| 39 | 3,3 | 64 | W |
| 40 | 4,3 | 117 | N E S SW W |
| 41 | 5,3 | 71 | N NE E W |
| 42 | 6,3 | 197 | N E W NW |
| 43 | 7,3 | 93 | N E SE S W |
| 44 | 8,3 | 7 | N NE E |
| 45 | 9,3 | 199 | N NE E W NW |
| 46 | 10,3 | 215 | N NE E S W NW |
| 47 | 11,3 | 193 | N W NW |
