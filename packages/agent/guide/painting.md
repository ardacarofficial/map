# Choose a painting method that fits the art

All document changes belong to an edit; see [workflow](harita://guide/workflow). Use explicit map and layer IDs. Tile and collision coordinates are zero-based map cells, x right and y down; rectangles are half-open `{x,y,width,height}`. `read_region` uses a local legend for tile cells, so its numeric cell values are not persistent document palette indices. Writes use `{tilesetId,tileId,flags?}`, `null` to erase, or `{collision:0|1|2}` on collision layers.

## Flat art and reusable objects

Use `paint_rect` for broad single-tile surfaces, `paint_cells` for selected placements, `paint_line` for ordinary straight lines, and bounded `fill` for connected replacement. Split work according to tool budgets and the design's useful regions. `apply_operations` batches known existing-ID placements after preflight; it does not batch source preparation, creation or lifecycle calls.

Use `create_stamp` for a useful reusable object, not every incidental tile arrangement. A stamp can capture an atlas rectangle or an explicit map region and tile/collision layers. Name it by recognizable content, and use category/tags for discoverability. `place_stamp` copies ordinary cells; existing placements do not remain linked prefab instances. Map the returned source-layer IDs explicitly to your shared semantic target layers. In batches, mappings must refer to existing layers and cannot create layers. `emptyCells:"skip"` preserves holes; choose `"erase"` only when clearing the mapped footprint is intended.

## Connected edges and paths

For suitable edge/center artwork, call `prepare_smart_source` with an existing stamp or `{tilesetId,region}`. Inspect the returned `usages`, band `b` and layer mapping. Source IDs belong to that transaction and map. `force:true` bypasses detection; it does not establish that an object has meaningful connected edges.

`smart_brush` area mode takes `region`; road mode takes distinct `cells` at macro-cell top-lefts aligned to band `b`. `draw_path` takes map-cell `points`, snaps by the source band and uses width in macro cells. Its `kind:"river"` records intent; you still choose water art and place bridges separately. Connection repairs can extend beyond the requested cells, which matters at protected or collaboratively owned boundaries. Preview the actual result before expanding a pattern across the map.

## Manual collision and gameplay

Artwork does not generate collision. Use a collision layer to mark intended obstacles and openings: `0` means no decision, `1` blocked, `2` explicitly passable. The topmost nonzero collision decision wins, including on a hidden collision layer. A bridge may need a passable override above blocked water; validate the actual stack and route. Keep gameplay entities on purposeful entity layers, discover types with `list_entity_types`, and use `edit_entity` to move or correct existing IDs instead of accumulating duplicates.
