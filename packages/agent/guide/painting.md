# Choose a painting method that fits the art

All document changes belong to an edit; see [workflow](harita://guide/workflow). Use explicit map and layer IDs. Tile and collision coordinates are zero-based map cells, x right and y down; rectangles are half-open `{x,y,width,height}`. Writes use `{tilesetId,tileId,flags?}`, `null` to erase, or `{collision:0|1|2}` on collision layers.

`read_region` returns the grid format by default: per layer `rows` (one character per cell) and a `legend` mapping each character to a tile, `{collision:n}` or `null` for `"."`. Its symbols are local to that response. `paint_grid` accepts the same shape (`origin`, `rows`, `legend`, or `layers:[...]`), plus `"keep"` and `{random:[...],seed?}` legend entries; a space keeps the cell. Read, edit the rows, and paint them back.

## Flat art and reusable objects

Use `paint_grid` for ground and any area of varied tiles (up to 16384 cells per layer per call), `paint_rect` for one tile over any rectangle, `paint_cells` with `points:[[x,y],...]` to scatter one tile, `paint_line` for ordinary straight lines, and `fill` for connected replacement. `replace_tiles` swaps one tile for another across a region, layer, map or every map in the edit while keeping flips; `clear_region` erases a rectangle. `apply_operations` batches known existing-ID placements (including `paint_grid`) after preflight; it does not batch source preparation, creation or lifecycle calls.

Use `create_stamp` for a useful reusable object, not every incidental tile arrangement. A stamp can capture an atlas rectangle or an explicit map region and tile/collision layers. Name it by recognizable content, and use category/tags for discoverability. `place_stamp` copies ordinary cells; existing placements do not remain linked prefab instances. Map the returned source-layer IDs explicitly to your shared semantic target layers. In batches, mappings must refer to existing layers and cannot create layers. `emptyCells:"skip"` preserves holes; choose `"erase"` only when clearing the mapped footprint is intended.

## Connected edges and paths

For suitable edge/center artwork, call `prepare_smart_source` with an existing stamp or `{tilesetId,region}`. Inspect the returned `usages`, band `b` and layer mapping. Source IDs belong to that transaction and map. `force:true` bypasses detection; it does not establish that an object has meaningful connected edges.

`smart_brush` area mode takes `region`; road mode takes distinct `cells` at macro-cell top-lefts aligned to band `b`. `draw_path` takes map-cell `points`, snaps by the source band and uses width in macro cells. Its `kind:"river"` records intent; you still choose water art and place bridges separately. Connection repairs can extend beyond the requested cells, which matters at protected or collaboratively owned boundaries. Preview the actual result before expanding a pattern across the map.

## Manual collision and gameplay

Artwork does not generate collision. Use a collision layer to mark intended obstacles and openings: `0` means no decision, `1` blocked, `2` explicitly passable. The topmost nonzero collision decision wins, including on a hidden collision layer. A bridge may need a passable override above blocked water; validate the actual stack and route. Keep gameplay entities on purposeful entity layers, discover types with `list_entity_types`, and use `edit_entity` to move or correct existing IDs instead of accumulating duplicates.
