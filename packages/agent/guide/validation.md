# Review what was actually built

Inspect a `render_preview` overview before submitting a substantial edit, then inspect close crops of important joins, entrances, bridges, silhouettes and repeated details. Review the actual art, layering and open space against the requested result. `grid:true` and `coordinates:true` help locate errors; use a plain view when judging composition. Hidden visual layers remain hidden; a collision overlay appears only when collision layer IDs are explicitly requested. Entity markers are diagnostics rather than final game artwork.

Use `read_region` to verify exact cells, orientations, entities and collision where an image is ambiguous. Correct issues while your contribution remains editable. Repeated previews should resolve a concrete uncertainty, not replace a plan with aimless repainting.

## Separate the checks

`validate_map` checks structural integrity. Each page is bounded: follow every `nextCursor` with the same arguments and unchanged world until the final `valid:true`. `valid:null` means validation is incomplete. A structurally valid map can still have disconnected paths or poor composition.

`validate_goals` checks explicit caller-defined goals:

- `reachability` uses four orthogonal neighbors inside your explicit region. Supply collision layer IDs, `blockedValues` and `emptyIsBlocked` deliberately. It does not infer traversability from grass, water or a drawn bridge. Harita collision decisions use `1` for blocked and `2` for passable; normally check `blockedValues:[1]` against the intended collision stack.
- `entity_count` checks anchors in a region, selected entity layers, an optional existing type and inclusive min/max. It can check a single spawn or the expected number of exits.
- `region_unchanged` captures a digest before editing when no `expectedDigest` is supplied; that baseline has `passed:null`. Retain it and check again with `expectedDigest` after your work. Digests include chosen layer identities, resolved cells/orientations, entities and relevant presentation; they are not snapshots of source PNG pixels.

Choose checks that express the user's request and the important preservation boundaries. Coordinate global checks with other contributors: changing peers' regions can invalidate a broad baseline even when your own region is correct. Tool budgets may require smaller regions or several calls.

When ready, summarize the visible changes, structure and any remaining limitation, then submit for human review. Do not claim gameplay quality from integrity alone or from an uninspected preview. The user's acceptance remains the final decision; [workflow](harita://guide/workflow) explains approval, undo and saving.
