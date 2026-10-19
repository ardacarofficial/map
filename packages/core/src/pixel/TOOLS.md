# Pure pixel APIs

All exports are available from `@smap/core`. No API mutates raster data, allocates
edited assets, dispatches operations, or owns history. Apply a complete gesture's
plans through P0's pixel/cell transaction adapter; preview uses the same plans.

- `Rgba8` is `{r,g,b,a}`, all channels 0–255, straight alpha. `canonicalRgba`
  rounds/clamps channels (NaN→0); alpha zero forces RGB zero. Painting overwrites,
  never blends. `rgbToHsv`/`rgbToHsl` take a remembered hue for achromatic input.
  `Hsva`/`Hsla` use floating hue degrees (wrapped to [0,360)), saturation/value/
  lightness in [0,1], alpha in bytes. Keep their floating precision until the RGB
  boundary for exact RGB8 round trips. Direct HSV↔HSL preserves hue. HEX parsing
  requires `#` and supports 3/4/6/8 digits; formatting defaults to lowercase
  `#rrggbbaa` (pass `false` for RGB-only output).
- `RasterView {width,height,get(x,y):Rgba8}` exposes one immutable native tile.
  Returned colours must already be canonical RGBA8; an adapter can read four
  consecutive bytes from P0's arrays. `PixelGrid {tileWidth,tileHeight,getTile}`
  resolves world cells to `{raster,flags?}` or `null` (unavailable/outside).
- World pixel **centres** use integer x/y, with y down. Floor pointer coordinates
  before calling. Negative world pixels use floor division into cells and positive
  local offsets. Dimensions and coordinates must be safe integers; brush sizes
  are 1–64 (same maximum/tip convention as Tile mode). Callers clip paths to the
  finite map before planning; APIs materialize their output, not an infinite canvas.
- `planPixelStroke(samples,grid,{color,size?,shape?,erase?,mirror?})` bridges all
  coalesced samples with canonical Bresenham, unions square/circle tip spans and
  deduplicates the whole gesture. Pass the accumulated press→release samples for
  each preview/commit; plans are full gesture snapshots, not incremental deltas.
  `erase:true` writes `{r:0,g:0,b:0,a:0}`. Even tips extend one extra pixel top/left;
  circle sizes 1/2/3/5 cover 1/4/5/21 pixels, matching existing Tile geometry.
- `planPixelLine` shares the pencil tip; `planPixelRectangle` uses inclusive
  corners and a one-pixel outline or filled interior. `planPixelPoints` accepts
  arbitrary coverage (also useful for a custom tool). Output is ordered by cell
  y/x, then source pixel y/x, with unique changed `writes` and tight `dirtyRect`.
  Unchanged pixels create no plan. No-op plans therefore need no COW allocation.
- `planPixelFill(raster,seed,color,mode?)` returns a tile-local `PixelWritePlan`.
  `contiguous` is 4-neighbour exact RGBA matching; `global` finds every exact
  match in that raster. Bounds never cross a tile. Same-colour/outside seeds
  return no writes and `dirtyRect:null`. `planPixelFillAt(worldSeed,grid,color,mode?)`
  resolves/inverts the owner cell and returns the same per-cell plan shape as pencil.
  Fill has no brush tip or mirror option;
  callers can choose mirrored seeds explicitly, keeping each fill tile-bounded.
- `PixelMirrorAxes {horizontal?,vertical?,origin}`: horizontal reflects y about
  `origin.y`; vertical reflects x about `origin.x`. Pixel centres are integers:
  use `(width-1)/2` for an extent's centre (integer for odd sizes, half integer for
  even). Move the origin by integer/half-integer increments. Mirrors transform
  **coverage pixels**, preserving exact symmetry for even tips; axis pixels and
  intersecting copies are written once. `mirrorPixels` returns the unique closure.
- `sourceToPlacedPixel` transposes D first, then mirrors H/V, using the cell flag
  bits. `placedToSourcePixel` undoes mirrors then transpose, matching renderer UVs.
  `placedPixelSize` swaps the native extent for D. `composePixelFlags(before,after)`
  and `inversePixelFlags` form D4; they ignore palette bits and return unsigned flags.
  The mapping helpers are affine and do not clip; callers supply in-bounds pixels.

The grid planner requires oriented raster dimensions to match the cell's pixel
extent. It rejects mismatches rather than rescaling art. Native small/oversized
anchoring, empty-cell transparent views, COW identity, all-world usage discovery,
lock/visibility policy and one-step undo belong to the adapter/coordinator lanes.
Rectangular D4 helpers swap extents; a non-square tile stretched into an unchanged
non-square renderer cell is not an integer pixel bijection and must be normalized
by that adapter before editing. Plans retain cell identity even if cells share a
raster, so the coordinator can resolve scope and conflicting source writes.

`test/pixel` contains fast-check colour/HEX, line/footprint, fill-oracle, mirror and
D4 laws plus planner checks. The warm 32px/200-sample micro-benchmark logs p50/p95;
its local target is <2ms, with a 100ms CI bound for shared-runner scheduling noise:
`pnpm test --project core packages/core/test/pixel/planner.test.ts --silent=false`.
