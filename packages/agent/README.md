# MCP asset discovery and capture

The editor owns the live world. Read tools inspect it; `create_stamp` and map edits require the existing `begin_edit` → tools → `finish_edit` → user approval workflow. No MCP tool reads arbitrary paths, writes source PNGs, or approves its own work.

## Discover art efficiently

Call `get_session`, then `list_tilesets`. Tileset fingerprints are cached against the image identity and grid; replacing source pixels, changing the grid, or editing tags invalidates the relevant summary. Hosts without a trustworthy image identity use uncached fingerprints.

Use `get_tile_catalog` with `image: "sheet"` for a continuous atlas overview. Coordinate labels sit outside the artwork, so adjoining cells remain visually connected. Large overviews fit within the image budget. `image.sheet` describes the source pixel rectangle, displayed content rectangle, grid, and region in tile coordinates; `placements` is empty in this mode. Metadata `items` contains at most one bounded page. With `sheetRegion`, `offset` and `nextOffset` count row-major slots inside that region, skipping unused edited-atlas slots. Do not combine sheet mode with `tileIds`.

Use `image: "tiles"` and explicit `tileIds` for labeled detail (at most 64 image tiles), or `image: "none"` for metadata only (at most 128 items). Use the returned IDs and source rectangles; do not infer IDs from a contact-sheet position.

`list_stamps.query` searches names, categories, library tags, and current AI labels. `get_tags.query` searches semantic labels and notes, returning current records by default; an explicit `status` can request `all`, `current`, `missing`, or `stale`. Without a query the historical default remains `missing`. Search uses Turkish-aware normalization and a small explicit English/Turkish alias vocabulary, not an embedding model. Empty pages may still have `nextCursor`; continue until it is null. Cursors are bound to filters, world revision, and relevant tag contents.

## Match an explicit PNG reference

A chat attachment is not automatically available to the editor. The client must supply raw PNG bytes as base64 (without a data URL prefix):

```json
{"context":{"worldSessionId":"<session>"},"pngBase64":"<base64 PNG>"}
```

Pass this to `visual_ingest_reference`. The returned `referenceId` belongs to that client and world session; disconnecting, changing worlds, or disposing the runtime releases it. The request must fit 1 MiB. References are limited to 2048 pixels per side, 4 million pixels, 32 handles, and 64 MiB of retained decoded pixels. Unsupported PNGs, fully transparent references, and over-budget inputs fail explicitly.

Then call `visual_match_reference`:

```json
{"context":{"worldSessionId":"<session>"},"referenceId":"<reference>","tilesetIds":["<tileset>"],"topK":8,"maxScale":4}
```

Matching compares canonical RGBA against tile-aligned single- or multi-cell atlas regions. It skips atlas margins/spacing, tries eight D4 orientations and integer nearest-neighbor scales, and ignores hidden RGB only when alpha is zero. Partial alpha must match exactly. `maxScale` is 1–8; `topK` is 1–32. Equivalent symmetric orientations for the same region and scale collapse to the lowest flag.

Results are `matched`, `ambiguous`, or `no_match`, with compact candidates containing `tilesetId`, top-left `tileId`, region, D4 `flags`, integer `scale`, and `match: "exact_rgba"`. More matches than `topK` produce `ambiguous` with `truncated: true`. Work-budget exhaustion is an error, never a false `no_match`. These are exact comparison results, not confidence probabilities. Fractionally scaled, compressed, background-composited, or arbitrarily cropped screenshots are outside this matcher; isolate a clean tile-aligned PNG reference first.

## Capture and place a stamp

Begin an edit naming the target map. Supply the latest returned revision and a fresh idempotency key on each write:

```json
{
  "context":{"worldSessionId":"<session>","transactionId":"<edit>","expectedRevision":1,"idempotencyKey":"capture-house-001"},
  "source":{"tilesetId":"<tileset>","region":{"x":2,"y":3,"width":2,"height":3}},
  "name":"House",
  "category":"Buildings",
  "tags":["house","ev"]
}
```

Alternatively, `source` is `{mapId, region, layerIds}` with explicit tile/collision layers from a transaction map. Map capture preserves stack order, palette references, and flip flags; entity layers are not supported. The capture budget is 4096 cells across selected layers. An empty capture fails.

`create_stamp` returns its generated `stampId` and `sourceLayerIds`. Discover/preview it with `list_stamps`, then use `place_stamp` with explicit layer mapping. A visual match's flags describe how source art matches the reference; stamp capture itself preserves the source orientation. Apply the corresponding transform when placing if needed.

Stamp library tags are stored in the stamp; independent AI labels remain the separate `set_tags` operation. Before human approval the stamp is tentative and cannot be saved. Discard restores the library and map. Approval groups stamp creation and placement into one world undo entry; undo/redo and normal save/reopen preserve the result. Source PNGs remain unchanged.

## Validation

From the repository root:

```sh
pnpm test -- packages/agent/test packages/editor/src/agent
pnpm typecheck
pnpm lint
pnpm build
```

The new browser workflow is `e2e/tests/ai-assets.spec.ts`. Native deadline/security tests run with `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml -p smap-host --locked`.
