# First-touch source-cell regression measurements

Compared `9bce2b9`'s actual `pixelEditing.ts` / `worldEdit.ts` modules against the
fixed modules, in the same Vitest process. Each fixture paints a dense map with
ordinary 16 px source tiles, caches either one or three equally dense maps, then
commits eight one-pixel strokes in previously untouched source cells through
`preparePixelCommit`. Source decoding and fixture construction are excluded.
Temporary baseline modules were removed after measurement.

| Dense map | Cached maps | Live cell slots visited / stroke, before → after | Commit median ms, before → after |
| --- | ---: | ---: | ---: |
| 32 × 32 | 1 | 2,048 → 0 | 8.18 → 1.24 |
| 32 × 32 | 3 | 4,096 → 0 | 1.47 → 1.05 |
| 512 × 512 | 1 | 524,288 → 0 | 71.16 → 0.43 |
| 512 × 512 | 3 | 1,048,576 → 0 | 111.75 → 0.39 |

Counts instrument live layers only; the baseline additionally scans its parsed
copies. Timings are diagnostic wall-clock samples on the shared runner, not an
isolated p95 claim. The fixed path reads explicit owner/remapped cells and required
metadata. Unit regressions throw on live chunk enumeration. Thumbnail dependencies are indexed by tile and chunk, so image publication and edited metadata changes also avoid map enumeration. Browser regressions
also count traversal during real first-touch pointer release at both map sizes.

The atlas browser regression mounts the 1,024-slot edited grid, measures through
subsequent React frames and undo/redo, and requires zero `getAsset` calls. CPU
surfaces, alpha classification and empty-tile marks update from dirty tiles;
full content hashes and PNG encoding remain save/export work.

Production verification: `PERF_PORT=6085 PERF_LABEL=n17-fix3
PERF_PIXEL_TILES=1024 PERF_PIXEL_MAPS=3 pnpm perf pixel.perf.ts --grep 'DPR 1 '
--workers=1` passed (one production-build test). Across pencil/eraser at 1/8/32 px,
thread-tick JavaScript frame-work p95 was 2.88–6.09 ms (gate: 16.7 ms), and main-thread
task p95 was 5.24–9.79 ms. Upload p95 was 16 / 576 / 11,232 bytes respectively.
The affected browser run passed all 56 cases, including zero complete-atlas reads
through mounted-grid renders/undo/redo and zero live chunk enumeration during real
first-touch release at both dense map sizes.
