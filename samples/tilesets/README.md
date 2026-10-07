# Sample tilesets

All PNG, RGBA, no margin or spacing.

| file | tile size | columns | rows | image size | notes |
|---|---|---|---|---|---|
| overworld-32.png | 32 | 8 | 8 | 256x256 | 64 tiles; alpha on tree(11), bush(12), flowers(13), chest(16), cactus(38), mushroom(39); tiles 40-63 are numbered filler |
| dungeon-16.png | 16 | 6 | 4 | 96x64 | 24 tiles, dark palette; tile 7 has alpha (torch) |
| blob47-32.png | 32 | 8 | 6 | 256x192 | 47 blob autotile tiles (last slot empty); see blob47-32.md |
| wang16-32.png | 32 | 4 | 4 | 128x128 | 16 corner-Wang tiles; see wang16-32.md |

Terrain templates (`corner16`, `blob47`) and how the editor derives tiles from them: see TEMPLATES.md.
