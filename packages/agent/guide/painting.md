# Choose a painting method that fits the art

All document changes belong to an edit; see [workflow](harita://guide/workflow). Use explicit map and layer IDs. Tile and collision coordinates are zero-based map cells, x right and y down; rectangles are half-open `{x,y,width,height}`. Writes use `{tilesetId,tileId,flags?}`, `null` to erase, or `{collision:0|1|2}` on collision layers.

`read_region` returns the grid format by default: per layer `rows` (one character per cell) and a `legend` mapping each character to a tile, `{collision:n}` or `null` for `"."`. Its symbols are local to that response. `paint_grid` accepts the same shape (`origin`, `rows`, `legend`, or `layers:[...]`), plus `"keep"` and `{random:[...],seed?}` legend entries; a space keeps the cell. Read, edit the rows, and paint them back.

## Flat art and reusable objects

Use `paint_grid` for ground and any area of varied tiles (up to 16384 cells per layer per call), `paint_rect` for one tile over any rectangle, `paint_cells` with `points:[[x,y],...]` to scatter one tile, `paint_line` for ordinary straight lines, and `fill` for connected replacement. `replace_tiles` swaps one tile for another across a region, layer, map or every map in the edit while keeping flips; `clear_region` erases a rectangle. `apply_operations` batches known existing-ID placements (including `paint_grid`) after preflight; it does not batch source preparation, creation or lifecycle calls.

Use `create_stamp` for a useful reusable object, not every incidental tile arrangement. A stamp can capture an atlas rectangle or an explicit map region and tile/collision layers. Name it by recognizable content, and use category/tags for discoverability. `place_stamp` copies ordinary cells; existing placements do not remain linked prefab instances. Map the returned source-layer IDs explicitly to your shared semantic target layers. In batches, mappings must refer to existing layers and cannot create layers. `emptyCells:"skip"` preserves holes; choose `"erase"` only when clearing the mapped footprint is intended.

## Connected edges and paths

`get_session.smart` and `list_tilesets` list detected edge/centre art as `{tilesetId,rect,kind,band}`; `list_stamps` marks smart stamps with `smart:{kind,band}`. Pass `source:{tilesetId,region:rect}` (or `{stampId}`) straight to `draw_path` or `smart_brush`: it is prepared once per edit and reused. `prepare_smart_source` is only needed when you want the `sourceId`, band or layer mapping first. `force:true` bypasses detection; it does not establish that an object has meaningful connected edges.

| Shape | Tool |
|---|---|
| River, road, path, wall line, any bends | `draw_path` with a `kind:"road"` source, one point per bend, `width` in band cells (3 suits a river) |
| Lake, pond, plaza, field with a border | `smart_brush` `mode:"area"`; overlap several rectangles of the same source for irregular shapes |
| Free-form mask on the band grid | `smart_brush` `mode:"road"` with the exact cells |

Overlapping or touching shapes of the same source merge into one outline with matching inner corners; later strokes repair earlier ones. Shapes that reach the map border stay open and continue off-map (`openEdges`, default true); pass `openEdges:false` for a closed border at the map edge. `draw_path` joins consecutive points with straight orthogonal runs, so a diagonal pair becomes a staircase: give explicit corner points instead. Width beyond the border is clipped. `kind:"river"` records intent; place bridges separately with stamps. Connection repairs can extend beyond the requested cells, which matters at protected or collaboratively owned boundaries. Preview the actual result before expanding a pattern across the map.

## Manual collision and gameplay

Artwork does not generate collision. Use a collision layer to mark intended obstacles and openings: `0` means no decision, `1` blocked, `2` explicitly passable. The topmost nonzero collision decision wins, including on a hidden collision layer. A bridge may need a passable override above blocked water; validate the actual stack and route. Keep gameplay entities on purposeful entity layers, discover types with `list_entity_types`, and use `edit_entity` to move or correct existing IDs instead of accumulating duplicates.
