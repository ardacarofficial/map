# Godot 4.5-stable export fixture

The checked-in `project/smap/*` files come from the production pure exporter.
`input.ts` builds a 16×4 map using normal store operations: eight asymmetric
D4 tiles at alternate columns, a second atlas on a hidden 25% layer, an empty
layer, and hidden manual Collision grids. A topmost explicit pass removes
collision at (0,0); collision at the visually empty (2,3) remains. The road
source has generated-tileset metadata. Both atlases have margin 1, spacing 2,
and native/map tiles of 16 px. Escaped names contain quotes, newline and
backslash; the empty layer also checks preserved punctuation and Unicode.
Pixel quadrants are red/green/blue/yellow; magenta atlas gutters
expose incorrect margins or spacing.

Regenerate from the worktree root (Vite runs in middleware mode, no port):

```sh
node packages/editor/scripts/generateGodotFixture.mjs
```

Pure validation lives in `test/godotExport.test.ts`: an independent LE decoder,
signed boundaries/properties, source/atlas overflow, all D4 corner
permutations, sparse and empty layers, manual overrides, name escaping,
resource-section parser with dependency ids and load_steps, deterministic
output, selection, multi-map sharing, exact game JSON companions, and
unsupported native-size/rectangular-transpose preflight. Header-only PNG
stubs are deliberately confined to pure layout tests; the checked-in engine
PNGs are complete CRC-checked PNG files.

The editor plugin's `{ maps, bytes, options }` input uses the same `TilesetBytes`
callback as current folder exports; `bytes` may defer PNG encoding.
`godotTarget.snapshot(input)` captures maps synchronously, then resolves and
copies PNGs. Pass this snapshot to both `preflight` and `planFiles` to preview
and publish identical content. `planFiles` returns the existing `ExportFileSet`
shape for the common writer. The target defaults to `{ resourceRoot: "smap",
collision: true }`. The host picks the Godot project root; `resourceRoot` is
relative to it, and is also included in every output path and `res://` path.
Each `resourceRoot` is one batch's output: pass every map sharing that root
in the same plan, because its `tileset.tres` describes exactly that batch.
For separate per-map exports, choose separate roots (for example
`smap/overworld` and `smap/dungeon`). The host must keep this scope when
staging/publishing a plan; mixing partial batches into one root would replace
the shared TileSet. Cross-map PNG basename conflicts are explicit preflight
errors; use separate roots or rename the source files.

No target-specific UI or filesystem writes live inside the plugin. Lane E
owns importing this contribution into the common registry/dialog. The new
Playwright `godot-export.spec.ts` exercises this plugin through Vite in a real
browser and writes/rechecks its output in OPFS, without editing that host.

## Executed engine gate (2026-10-19)

Official binary downloaded into `/tmp/godot`, with no global installation:

```sh
mkdir -p /tmp/godot
curl -fL https://github.com/godotengine/godot-builds/releases/download/4.5-stable/Godot_v4.5-stable_linux.x86_64.zip -o /tmp/godot/godot.zip
unzip -o /tmp/godot/godot.zip -d /tmp/godot
```

Zip SHA-256: `c7316e1fd782ad276a4d985a7673b5976eaaa8d90561a2bea5289210dc53e9ba`.
`--version`: `4.5.stable.official.876b29033`.

From the worktree root:

```sh
/tmp/godot/Godot_v4.5-stable_linux.x86_64 --headless --editor --path packages/core/test/fixtures/godot/project --import
/tmp/godot/Godot_v4.5-stable_linux.x86_64 --headless --path packages/core/test/fixtures/godot/project --script verify.gd --quit-after 120
xvfb-run -a /tmp/godot/Godot_v4.5-stable_linux.x86_64 --path packages/core/test/fixtures/godot/project --rendering-method gl_compatibility --audio-driver Dummy --script render.gd --quit-after 120
```

Results: all commands exit **0**. `verify.gd` prints `GODOT_EXPORT_OK` after
asserting source/atlas/alternative values, sparse holes, layer properties,
escaped metadata/resource names, atlas geometry/used entries, collision
polygon points, transparent texture, and actual physics point queries for
both solid and explicitly passable cells. `render.gd` prints
`GODOT_RENDER_OK`: **16,384 pixels** match the pinned `project/golden.png`.
The golden uses an independent explicit table of corner permutations, not
the export encoder or flag conversion. Rendering used Mesa llvmpipe through
Xvfb; the harmless driver V-Sync warning was the only rendering warning.
Godot's headless dummy renderer cannot provide a screenshot, so loading and
physics run headless and the pixel comparison uses the Xvfb OpenGL renderer.
Imported caches, `.import`/`.uid` files, and the actual rendered screenshot
(`project/.godot/rendered.png`) are ignored.

Size policy: native tile size must equal map cell size; mixed native sizes
are rejected before writing, rather than scaling or padding. Rectangular
transpose and maps sharing different cell sizes are also explicit preflight
errors. No unsupported mixed-size render success is claimed.

Pinned schema references:
[TileMapLayer bytes](https://github.com/godotengine/godot/blob/4.5-stable/scene/2d/tile_map_layer.cpp),
[TileSet/TileData serialization](https://github.com/godotengine/godot/blob/4.5-stable/scene/resources/2d/tile_set.cpp),
[TileSetAtlasSource transforms](https://docs.godotengine.org/en/4.5/classes/class_tilesetatlassource.html),
[Node names](https://docs.godotengine.org/en/4.5/classes/class_node.html#class-node-property-name).
