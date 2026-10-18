# Recent thumbnail measurements

Fixture: `generateBigProject()`, 1024×1024 cells, four fully painted tile layers,
32px overworld tiles. Measured in Chromium on the shared Linux container.

## Snapshot and PNG

```sh
PERF_PORT=5941 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  pnpm --filter @smap/e2e exec playwright test -c perf/thumbnail-bench.config.ts
```

The benchmark prepares the live overview, then schedules each sample through the
production idle scheduler. The timer includes the owned CPU snapshot copy and
PNG encoding; it excludes overview preparation and time waiting for idle.
Four warmups precede 31 measured samples. There is no encoded-image cache.

| Metric | Milliseconds |
|---|---:|
| Median | 2.5 |
| p95 | 6.4 |
| Maximum | 78.5 |

The p95 gate is ≤8ms. One sample reached 78.5ms during concurrent lane load;
all measured samples, including that outlier, are retained.

## Application harness

Production debug builds (`VITE_SMAP_DEBUG=1`), default minification and viewport,
SwiftShader, `PERF_PORT=5941 PERF_RUNS=3 PERF_ONLY=b,g`. Before is base `7099f10`;
after is this change. Open values are medians of three fresh contexts; save is
one measured Ctrl+S after a preparatory save.

The base harness expects brush/autosave to have seeded its saved indicator.
For these runs a temporary copy of `editor.perf.ts` inserted
`await page.keyboard.press("Control+s")` immediately inside `if (want("g"))`,
before the existing saved-indicator wait. The timed save itself was unchanged.
Both builds used the same copy. The shared harness file was left unchanged;
brush metrics were excluded as requested. Commands otherwise used `pnpm perf`,
with `PERF_NO_BUILD=1` / `PERF_DIST` to reuse the preserved base build.

| Harness metric | Before (ms) | After (ms) |
|---|---:|---:|
| b.open → first map frame | 2721.6 | 1554.2 |
| b.open → map complete | 4201.7 | 1868.7 |
| b.open → main thread quiet | 3509.0 | 1586.7 |
| b.open longest task | 1274.0 | 722.0 |
| g.save (Ctrl+S → saved) | 30986.2 | 4413.6 |
| g.save longest task | 24700.0 | 315.0 |

These are observed wall times under concurrent CPU/software-GPU load. In an
earlier after run, save was 590.1ms; the final run above is retained rather than
selecting the faster result. The values establish lower blocking in this
harness, with substantial host scheduling variability; Windows hardware latency remains
unmeasured.

`recent-thumbnail-performance.spec.ts` separately compares every RGBA channel
against the historical renderer output at eight map sizes (5×3 through
2051×39), including alpha, layer opacity, flips, partial chunks and integer
upscaling, and verifies save → reload → recent-project reopen.
