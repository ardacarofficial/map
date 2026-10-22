# Discover and understand the user's art

Use `get_editor_context` to inspect the current atlas selection, stamp, marquee and viewport. Selection coordinates refer to the selected tileset's grid; map coordinates refer to map cells. A truncated selection is a partial observation, not a complete mask. Refresh context after relevant navigation or selection changes.

Start discovery with `list_tilesets` using `includeDetails:false` for IDs, native cell sizes and sheet dimensions. Use `get_tile_catalog` with `image:"sheet"` for a continuous atlas overview; select a bounded `sheetRegion` for large sheets. Coordinate gutters sit outside the artwork, and returned image metadata maps displayed content back to source pixels and grid cells. Use explicit `tileIds` with `image:"tiles"` for close detail, or `image:"none"` for metadata. Read returned IDs and source rectangles; a contact-sheet position is not a tile ID.

Compare atlas tile width **and** height with the target map. Respect sheet margin and spacing. Smart preparation requires matching native cell sizes; it does not rescale pixels. A human may choose a different map size or import/regrid assets through the editor. Explain a mismatch concretely instead of repeatedly trying an incompatible source.

## Read meaning from art

Look for complete objects, repeatable surfaces, compatible edge/corner sets, shadows and expected orientations. A visually adjacent region in an atlas is not necessarily one smart source. A bush or a house can be a flat object even when its crop is 3×3.

Search `list_stamps` and `get_tags` before reconstructing an existing object. Stamp search covers names, categories and labels. AI tags are optional semantic hints, not terrain rules or collision flags; stale labels need confirmation against actual pixels. Continue pagination using returned cursors, including an empty page that still has a next cursor.

## Use explicit references when useful

A user can share a selected tileset crop as a reference; ingest its `selectedReferenceToken` from editor context with `visual_ingest_reference`. A client can instead supply explicit PNG bytes as `pngBase64`. Chat attachments do not appear in the editor automatically. Then `visual_match_reference` checks candidate atlas regions at supported integer scales and D4 orientations. `ambiguous` and `no_match` are legitimate results, not instructions to guess a confident match. This is exact RGBA matching, not general screenshot recognition.

Record a compact palette of chosen tile IDs, native sizes and intended roles. Reuse that palette consistently across the scene, then inspect the placed result. Tool schemas contain current pagination, image and request budgets; fetch detail only where it helps a design decision.
