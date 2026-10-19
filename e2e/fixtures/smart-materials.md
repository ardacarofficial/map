Nonperiodic negative corpus for smart selection, detector Round 2.

All sheets are 12×8 tiles, with a full opaque 6×6 block at col 2,row 1.
Tile sizes: 16 and 32 px. Stone uses review seed 1, plank seed 3, grass seed 7;
each tile has an independent tone and a continuous one-pixel neutral seam.
The 16 px stone block is pixel-identical to review/accepted-floor.ppm (RGB
SHA-256: de96719e184f540b8b506b1a029565a45b350339f8890335f8ddd64672f625e2).

Regenerate with `node e2e/fixtures/generate-materials.mjs`.
Measure exact review stone seeds and varied materials/framed grain with
`node e2e/fixtures/measure-smart-boundary.mjs 1000` (seeds 1..1000 per row).
Both scripts use the committed pure test generator smartStampBoundaryArt.ts.

Measured detector-3 → detector-4 acceptance, seeds 1..1000 for each row:

| Corpus | Tile px | Detector 3 | Detector 4 |
|---|---:|---:|---:|
| exact-review-stone-seeds | 16 | 194/1000 | 0/1000 |
| material-variations-seeds | 16 | 289/1000 | 0/1000 |
| framed-grain-seeds | 16 | 1000/1000 | 1000/1000 |
| exact-review-stone-seeds | 32 | 194/1000 | 0/1000 |
| material-variations-seeds | 32 | 292/1000 | 0/1000 |
| framed-grain-seeds | 32 | 1000/1000 | 1000/1000 |

Material variations cover 5×5..8×8, stone/plank/grass and D4. Framed grain
covers road/wall/water tones, b=2/3, positive centre spans, non-square sources
and D4. Independent fast-check properties also vary offsets, margin and spacing.
These are finite synthetic corpus measurements, not universal classification guarantees.
