# Smart brush preparation profile

Chromium / SwiftShader, production debug build, 1440×900 viewport, five fresh
browser contexts per sheet size. Each imports the authored 32px road fixture into
a padded sheet, then makes its first 3×3 selection through the real Tileset UI.
Warm samples repeat that selection. Cold means first brush preparation after
import; source PNG decoding, required for displaying the sheet, precedes selection
in both versions. Baseline: 20322eb with the same timing spans and workload.

| Sheet | Cold before (ms) | Cold after (ms) | Warm before (ms) | Warm after (ms) |
| --- | ---: | ---: | ---: | ---: |
| 256×256 | 563.9 | 15.4 | 0.1 | 0.2 |
| 2048×2048 | 1786.5 | 16.5 | 0.2 | 0.2 |

2048×2048 median spans (independent medians do not sum to the total):

| Stage | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Source PNG decode inside preparation | 0 (already decoded) | 0 (already decoded) |
| Detector selection crop read | 0.7 | 0.8 |
| Detector | 0.6 | 0.7 |
| Selection cache key | 0.1 | <0.1 |
| Source PNG SHA-256 | 23.3 | cached at image publication |
| Generated metadata | 3.0 | 3.4 |
| Bake source pixels | 54.2 (whole sheet) | <0.1 (reuse selected crop) |
| Quarter assemblies | 31.3 | 4.3 |
| Generated PNG encoding | 1646.9 | deferred to save/export |
| Generated bitmap | 4.8 (PNG decode) | 0.1 (RGBA transfer) |
| Image publication | 0.5 | 0.6 |
| Brush session/store signal | 0.1 | 0.1 |

The original HTML canvas PNG encoder receives the same RGBA on save/export.
Byte equality is tested against the legacy whole-sheet path for opaque and
translucent artwork. PNG encoding can still take time when saving; it no longer
blocks preview or painting. Concurrent requests share one encoding per image
revision, and failed encodings remain retryable. Hashes are shared per immutable
PNG buffer, including in-flight work; generated atlas publication does not hash
or encode assets that are not themselves regeneration sources.

Preparation publishes the ready bitmap before selection-triggered rendering when
provenance is already cached. Its readiness timer ends after bitmap publication
and brush session signaling; no readiness promise is left waiting on PNG work.
The pending-gesture path still handles hash misses and asynchronous preparation.
No worker or speculative pointerdown bake is needed at these measured costs.

Reproduce (Chromium must already be installed):

```sh
PERF_PORT=5761 PERF_LABEL=smart-brush PERF_RUNS=5 PERF_ASSERT_TARGETS=1 pnpm perf smart-brush.perf.ts
```

Per-stage `performance.now()` spans and raw samples are emitted to
`e2e/perf/results/<PERF_LABEL>-256.json` and `-2048.json`. Spans and the preparation
gate exist only in development or `VITE_SMAP_DEBUG=1` builds.

Raw cold samples (ms), before → after:

- 256×256: [1148.9, 631.6, 483.6, 529.4, 563.9] → [11.3, 14.4, 15.7, 19.1, 15.4]
- 2048×2048: [1786.5, 1957.0, 1922.3, 1615.1, 1610.7] → [16.5, 17.6, 16.0, 15.9, 16.7]
