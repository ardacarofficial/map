# Frozen pre-removal fixtures

Generated in this worktree with unmodified e94d93d core code before deleting
any feature code. `manifest.json` contains the baseline commit and SHA-256
hashes of CPU-composited RGBA from its export draw list. Expected hashes are
never recomputed by migration tests.

- v1: baked corner/blob artwork plus legacy grid metadata; a deliberately
  stale manual tile proves that the disk cells win over the former solver.
- v2: tileset tags on a 16 px sheet, with existing baked cells.
- v3: 32 px source artwork at a sheet offset, all layout-1 generated slots,
  nine-slice library and embedded recipes, and former solid flags.
- All include visible opacity, hidden/locked layers, manual collision
  overrides, diagonal/mirrored cells and an invisible legacy grid with a
  dangling target and negative chunk coordinates. Original PNG bytes stay
  frozen alongside the JSON. v14 fixtures remain untouched.
- The two `.smapmap` files came from the old TypeScript game exporter with
  manual grids only; identical copies live in the Unity package tests.

The runtime parser still enforces finite map bounds. Raw migration tests
also verify that negative tile chunks are copied untouched; they do not
invent cells to replace removed invisible grids.
