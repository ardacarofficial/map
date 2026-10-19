# Raster API (format 6)

`MapStore` owns mutation. Pass `{ rasterAssets: new RasterAssets() }` to its
constructor; the same registry may be injected into several world map stores.
`store.rasterAssets` exposes only readers. `getTile`, `getAsset` and `info`
return detached snapshots; their byte arrays never alias live data or history.
RGBA8 is tight, straight alpha, with RGB zero whenever alpha is zero. Revisions
increase on writes and replay; they are cache tokens, not persisted history ids.

Load decoded PNGs through `loadRasterAsset` after metadata setup and
`clearHistory()`, before enabling edits. `setEditedTileset` synchronizes participant metadata
without applying shared pixels twice. Geometry and edited content hashes are
checked before mutation. Decode, encode, disk IO, source tracking and world
history orchestration belong to the editor/coordinator lanes. Core does not
load PNGs, rewrite originals or decide copy-on-write scope.

For one gesture:

1. `beginTransaction(label)`.
2. `allocateEditedTile({tileWidth,tileHeight,pixels,source?})` clones supplied
   native bytes. Its result is `{assetId,tileId,paletteIndex}`. Source provenance
   may point to an unavailable source: the clone is self-contained. Empty-cell
   edits omit `source`. Crop/padding/flip planning belongs to the caller.
3. `remapCells({layerId,cells,tilesetId,tileId})` retains each owner's flags.
   Explicit cells must be in bounds; locked layers ignore valid remaps. The
   target must already have a palette entry (allocation provides it).
4. `editTilePixels({assetId,tileId,x,y,width,height,after,before?})` writes an
   edited slot. Optional `before` guards against stale planning. `patchPixels`
   accepts multiple `PixelRectPatch` values, prevalidates all bounds, byte
   lengths, expected bytes and nonoverlap before applying any.
5. `commit()`; on cancellation/error call `rollback()`.

An operation validates before its first write. A sequence dispatched inside a
transaction is not a prevalidated batch: use rollback on a failed later op.
Allocation, edited palette additions, pixels, tileset metadata and ordinary
cell writes share one history step. Undo restores the pre-allocation document
and raster; redo uses the same ids. For source palette additions inside an atomic edit, dispatch
`addPaletteEntry` with `undoable: true`. Ordinary legacy additions without that
flag retain their append-only semantics. If such additions follow an allocation,
undo keeps the allocated palette slot as well to preserve their stable indices. Nonundoable palette growth clears redo dependent on journaled palette additions
(`historyChanged: true`), including additions during cancelled replacement
allocations. World history must mirror that invalidation across participants. History byte accessors return copies.
History coalesces full-tile before/after snapshots between allocation barriers;
dispatch events and returned patches retain exact requested dirty rectangles.

Atlases use 16 columns, native tile dimensions and zero margin/spacing. Slots
append; a full page starts the next deterministic `edited-WxH-N` id. Pages
hold at most 4096 tiles and 64 MiB RGBA8 (whichever limit comes first). Decoded source assets also have a 65536
tile bound. The
registry must be loaded before appending to an existing edited asset. Removed
metadata does not discard retained raster bytes; world lifecycle/usage policy
belongs to the coordinator. Do not regenerate edited assets as road recipes.

Pixel dispatch/undo/redo/rollback events contain tile-local `pixelRects`.
Allocation emits a full-tile rectangle, including removal on undo. Metadata
changes emit `structure: ['tilesets']`; renderers should distinguish raster
content changes from layout changes using these rectangles and revisions.

`rasterContentHash(width,height,bytes)` is SHA-256 over two unsigned big-endian
32-bit dimensions followed by canonical RGBA. `encodeRgbaPng` is synchronous,
pure and dependency-free (RGBA8/filter 0/stored DEFLATE/CRC32/Adler32). Schedule
encoding outside pointer sampling. Batch planned writes per gesture/frame;
metadata hashing processes the bounded edited atlas and is not a preview API.
PNG bytes are persisted externally at `editedImagePath(id,hash)`. No raw pixels
are embedded in project JSON. Exporters consume its ordinary PNG path.

Colour palettes use `ColorPalette {name,colors}` with ordered `#rrggbbaa`
values. Project `colorPalettes` is independent of tile-reference collections.
`parseColorPalette`/`serializeColorPalette` read/write `.smap-colors.json`,
version 1. Built-in UI/app settings and disk adapters are separate lanes.

Collection normalization always writes `rows`. The input `Collection.rows`
remains optional for existing core/editor callers; omitted input derives the
migration height `max(2,maxOccupiedY+2)`. New explicit layouts allow 1–256 rows
and columns and 65536 positions. Parsed legacy oversize layouts retain all
references; `setCollection` can retain/shrink their dimensions, never grow
them. Occupied references outside explicit dimensions are rejected.

Shared registries track allocated tile counts as well as grid capacity. A stale
participant must synchronize tileset metadata before allocating or editing;
the store refuses stale counts instead of overwriting another map's live slot.
The world coordinator must still validate all history heads before shared
replay; a local undo cannot infer world chronology.
