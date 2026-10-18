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

Review regressions also frozen against the unmodified e94d93d core:

- `v1-pre-role-{1,3}-{stamp,clip}.json`: valid pre-role terrain grids with
  values 1 and 3, an explicit terrain grid, an explicit manual collision grid,
  and tile cells carrying H/V/D flags. They use `v3-source.png`; `preRole` in
  the manifest records their identical baseline placement pixels. Only the
  explicit collision grid survives migration.
- `v3-mirrored-unrelated-project.json`: the v3 project with a complete,
  horizontally mirrored `unrelated` set prepended to the generated tileset.
  Library, sidecar and embedded stamps still reference set `road`, family 1.
  A baseline stroke at (18,12)…(20,12) writes tile ids `[12,31,29]`;
  `mirroredFamilyStroke` records the resulting baseline RGBA hash. The
  oracle omits the obsolete negative terrain grid before baseline parsing
  and disables legacy rederivation so disk tile cells remain authoritative.
