# Harita MCP: authoring and editor control

The editor owns the live world. Read tools inspect it; `create_stamp` and map edits require the existing `begin_edit` → tools → `finish_edit` → user approval workflow. No MCP tool reads arbitrary paths, writes source PNGs, or approves its own work.

For authoring judgment, start with the [progressive map-design guide](guide/overview.md) or the repository [Harita map authoring skill](../../.agents/skills/harita-map-authoring/SKILL.md). The guide covers readable composition, reusable semantic layers, art discovery, region collaboration and visual review. MCP resources expose the same sections on demand; the tool catalogue remains the argument reference.

All transports publish the same concise [working guide](schema/workflow.txt) during initialization; the stdio proxy preserves upstream instructions. Inspect editor context, discover assets, plan bounded edits, preview and correct, then check integrity and explicit task goals before submitting for human review. After a timeout, read the session before deciding how to proceed; writes are never automatically replayed.

## Discover art efficiently

Call `get_session`, then `list_tilesets` with `includeDetails:false` for fast names, IDs, dimensions and counts without reading or hashing image pixels. This omits `fingerprint` and `tagCounts`. Omit the flag or use `includeDetails:true` when those details are needed; the existing default remains true. Tileset fingerprints are cached against the image identity and grid; replacing source pixels, changing the grid, or editing tags invalidates the relevant summary. Hosts without a trustworthy image identity use uncached fingerprints.

Use `get_tile_catalog` with `image: "sheet"` for a continuous atlas overview. Coordinate labels sit outside the artwork, so adjoining cells remain visually connected. Large overviews fit within the image budget. `image.sheet` describes the source pixel rectangle, displayed content rectangle, grid, and region in tile coordinates; `placements` is empty in this mode. Metadata `items` contains at most one bounded page. With `sheetRegion`, `offset` and `nextOffset` count row-major slots inside that region, skipping unused edited-atlas slots. Do not combine sheet mode with `tileIds`.

Use `image: "tiles"` and explicit `tileIds` for labeled detail (at most 64 image tiles), or `image: "none"` for metadata only (at most 128 items). Use the returned IDs and source rectangles; do not infer IDs from a contact-sheet position.

`list_stamps.query` searches names, categories, library tags, and current AI labels. `get_tags.query` searches semantic labels and notes, returning current records by default; an explicit `status` can request `all`, `current`, `missing`, or `stale`. Without a query the historical default remains `missing`. Search uses Turkish-aware normalization and a small explicit English/Turkish alias vocabulary, not an embedding model. Empty pages may still have `nextCursor`; continue until it is null. Cursors are bound to filters, world revision, and relevant tag contents.

## Match an explicit PNG reference

`get_editor_context` returns a bounded snapshot of the active world map/layer, selected tileset IDs and grid/region, stamp dimensions, region mask, and viewport. Its opaque `contextToken` changes when selection or viewport changes even if the map revision does not. A `truncated` selection/mask must not be treated as a complete selection; at most 4096 IDs/mask entries are returned. Temporary stamp-editor documents are not presented as world maps.

The user can select a rectangular tileset crop and click **Share selection as reference** in the AI tags section. The editor copies that explicitly selected crop, strips atlas gutters, and exposes `reference.selectionToken` through `get_editor_context`. Ingest it with `{context,selectedReferenceToken}` to obtain the same client/world-scoped `referenceId` used below. A newly shared crop replaces the pending selection token; already ingested handles keep their own bounded snapshot. Nothing is painted or matched automatically. Arbitrary screenshot cropping is not provided by this action.

A chat attachment is not automatically available to the editor. As an alternative to the explicit selection action, the client can supply raw PNG bytes as base64 (without a data URL prefix):

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

## Batch a known placement plan

`apply_operations` accepts one write context and 1–32 `{tool,args}` items. Child args have no context. Supported tools are `paint_cells`, `paint_rect`, `paint_line`, `place_stamp`, `place_entity`, and `edit_entity`. Stamps require explicit mappings to existing layers; layer creation is excluded.

```json
{
  "context":{"worldSessionId":"<session>","transactionId":"<edit>","expectedRevision":4,"idempotencyKey":"village-batch-001"},
  "operations":[
    {"tool":"place_stamp","args":{"mapId":"<map>","stampId":"<house>","at":{"x":2,"y":3},"layerMapping":[{"sourceLayerId":"<source>","targetLayerId":"<ground>"}]}},
    {"tool":"place_entity","args":{"mapId":"<map>","layerId":"<entities>","typeId":"spawn","at":{"x":4,"y":5}}}
  ]
}
```

The batch preflights every item in order, including duplicate spawn rules, portal destinations, protection, and cumulative budgets. A late invalid item leaves prior surrounding work and revision untouched. Only validated core commands replay, synchronously; no portal loading occurs after the first live write. Retry an identical outer payload/key to replay its result without duplicating entities. Responses contain short item results and the aggregate change summary.

The aggregate limit is 4096 planned cell writes, even across layers/maps; each child consumes one of the transaction's 256 mutation calls and its normal retained-memory budget. Temporary metadata/entity projections also fit within the existing 64 MiB memory budget; maps with very large existing metadata can therefore require smaller individual calls. Preflight entity IDs use the maximum valid length, so memory admission is conservative. Fill, source preparation, layer/map/stamp creation, lifecycle operations, and tags are not batch children. Approval remains one world undo action; discard restores the entire edit.

## Correct an existing entity

`read_region` with `includeEntities:true` returns each entity's `layerId`, including when several entity layers are requested. Use the existing entity ID with `edit_entity`:

```json
{"context":{"worldSessionId":"<session>","transactionId":"<edit>","expectedRevision":5,"idempotencyKey":"move-spawn-001"},"mapId":"<map>","entityId":"<spawn>","action":"move","at":{"x":6,"y":5}}
```

`action:"update"` takes `fields`, merged into existing values; `action:"remove"` takes no extra data. Moves use map cells. Portal point fields use native target-map pixels. IDs/types stay fixed, unknown fields and invalid targets reject, and initial/current layer locks and visibility are enforced. Corrections and removals retain normal idempotency, discard, approval, undo, and redo behavior.

## Verify explicit map goals

Keep `validate_map` for structural integrity. Each page scans at most 4096 records; follow every `nextCursor` with the same arguments and unchanged world until it is null. `valid:null` means validation is incomplete; require the final `valid:true` before treating integrity as verified. `validate_goals` checks caller-specified goals; it does not infer collision from artwork. Each request specifies one `mapId` and 1–16 checks:

```json
{
  "context":{"worldSessionId":"<session>"},"mapId":"<map>",
  "checks":[
    {"kind":"reachability","region":{"x":0,"y":0,"width":32,"height":16},"from":{"x":1,"y":8},"to":{"x":30,"y":8},"collisionLayerIds":["<collision>"],"blockedValues":[1],"emptyIsBlocked":false},
    {"kind":"entity_count","region":{"x":0,"y":0,"width":32,"height":16},"layerIds":["<entities>"],"typeId":"spawn","min":1,"max":1}
  ]
}
```

Reachability uses four orthogonal neighbors within the explicit region. Collision layers follow map stack order regardless of input order; the uppermost nonzero decision wins. The caller explicitly chooses blocked nonzero values (`1`, `2`, or both) and whether an undecided empty cell is blocked. Endpoints must be inside the region. A structurally valid map can fail this check if a bridge is disconnected.

To protect content, call with `{kind:"region_unchanged",region,layerIds}` **before editing**, retain its `digest`, then repeat with `expectedDigest`. The first capture returns `passed:null` and aggregate `valid:null`; it is not an assertion of success. Digests bind map ID, region, chosen layer identities, resolved tile IDs/orientations, collision values, entities whose anchors lie inside the region, and visibility/opacity of selected visual layers. Names and locks do not affect the digest; collision-layer visibility does not affect manual collision. Unrelated palette growth does not invalidate the digest. Entity counts also use anchors and explicit layers, with optional existing `typeId` and inclusive `min`/`max`.

Digests describe map content and layer presentation; they do not snapshot source PNG pixels. Each check permits 4096 cells per selected layer, with at most eight layers and 16384 aggregate cell-layer scans per request. Entity scans are separately bounded to 16384 visits; region digests include at most 256 entities per layer and at most 1 MiB of content per call. Checks are read-only; failures do not change pending edits. Review both the preview and the relevant structural/goal results before `finish_edit`.

## Validation

From the repository root:

```sh
pnpm test -- packages/agent/test packages/editor/src/agent
pnpm typecheck
pnpm lint
pnpm build
```

The new browser workflow is `e2e/tests/ai-assets.spec.ts`. Native deadline/security tests run with `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml -p smap-host --locked`.

## Local diagnostics and reproducible measurements

Use the AI activity panel's **Export diagnostics** action to save the currently filtered rows locally. The file contains tool outcomes, elapsed time, cell totals, and request/text/image/result byte counts, without raw arguments, images, client identities or credentials. No export runs automatically.

The [five representative scripted workloads and before/after results](bench/README.md) distinguish call/byte/capacity improvements from actual model quality or inference latency, which were not measured. These fixtures also exercise approval, exact undo/redo/discard, and preservation of earlier work after an invalid call.

## Editor and application controls

The catalogue includes document tools and explicit editor controls. `get_editor_state` inspects tool options, viewport, atlas filters, panel layout, colors, locale, effective/default shortcuts and capability boundaries. `list_editor_commands` lists real registered commands with current enablement, shortcuts and an explicit `remoteExecutable` flag. Document commands report typed-tool alternatives where available.

These controls work independently of a document edit, including while an AI proposal awaits approval:

| Tool | Controls |
| --- | --- |
| `configure_editor` | Active map/layer, tile/stamp/entity selection, rectangular marquee; tile/pixel mode and tools; brush size/shape/collision value; rectangle fill/outline/thickness; selection/pick scopes; basic and major grid, collision/minimap/rulers, hidden panels; camera level/world view, zoom, map-cell center or fit; atlas selection/filter/view/zoom; pixel brush/fill/colors/mirrors |
| `configure_layout` | Reveal/hide/move/reorder panels, split groups, expand/collapse/hide/resize dock zones, reset persisted layout |
| `configure_application` | Persist locale and validated shortcut overrides; `null` restores a binding's default, `[]` unbinds |
| `get_export_settings`, `configure_export` | Read/patch remembered target, PNG scale, Unity tile/collision/texture/automatic export preferences; no export delivery or destination change |
| `run_editor_command` | Execute enabled commands from an audited UI allowlist; document writes, file delivery and AI approval/discard are excluded |

UI tools accept an optional `{context:{worldSessionId}}` to reject a replaced world. UI-only tools can also work on the welcome screen. Use explicit setters for retries: command toggles are intentionally not replay-cached. UI state does not change document revision, create undo steps, or disappear when a proposal is discarded. Camera transitions may still animate after the reply.

```json
{"context":{"worldSessionId":"<session>"},"gridVisible":false,"majorGrid":{"interval":8,"x":0,"y":0},"brush":{"size":3,"shape":"circle"},"camera":{"view":"level","zoom":2,"center":{"x":12,"y":8}}}
```

`configure_editor` validates IDs and bounds before changing controls. Camera centers and marquees use target-map cells; a camera center requires level view. `frame:true` excludes explicit center/zoom. An oriented tile selection uses the explicit target layer or the target map's default tile layer. A settings draft or panel drag owns its UI state until completed, so conflicting preference/layout calls return `WRITER_BUSY`.

World/library changes use the reviewed document workflow:

| Tool | Changes inside `begin_edit` |
| --- | --- |
| `edit_map` | Rename a target map or set its signed whole-pixel world position; stable map ID/path retained |
| `edit_stamp` | Rename/category/tags/favorite, duplicate with a unique ID, or remove a library stamp; existing painted cells remain ordinary tiles |
| `get_world_settings`, `configure_world` | Inspect/patch defaults for future maps: tile size, dimensions, layer templates and background; existing map dimensions remain intact |

These metadata edits support the same revision checks, replay keys, discard and single approved world undo action as painting. Pending metadata never enters normal save/export. An agent cannot approve its own edits.

The surface is deliberately explicit: tileset image import/regridding/removal, custom entity-type editing, pixel painting, arbitrary filesystem delivery and OS/file dialogs remain human workflows or future typed tools. The command catalogue advertises these as unavailable for remote execution; there is no generic command-category, shell or evaluation escape hatch. Each native world window owns its endpoint/session; connect to that window's displayed MCP configuration.
