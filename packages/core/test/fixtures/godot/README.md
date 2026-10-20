# Godot 4.5-stable export fixture

The checked-in `project/smap/<map>/*` files come from the production pure exporter.
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
output, selection, per-map resource isolation, exact game JSON companions, native
padding/sample/origin checks, and rectangular-cell transpose preflight. Header-only PNG
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
Every map automatically gets its own resource folder, with
its scene, JSON companion, TileSet and PNG copies. Single-map and batch plans
use identical layouts. Sequential exports to one destination preserve earlier
maps, even when their source 0 points to different art or their PNG basenames
match. Source/collision ids are local to each map. Different map cell sizes
are supported in the same batch. The production host passes the stable map
id and uses the folder
`<name>--id-<hex-codepoints-of-id>`, so even repeated or colliding display
names stay separate on case-insensitive filesystems. Direct callers should
supply `GodotMapInput.id` too; without it, the export name is the identity.
Re-exporting the same map/name updates that export. Conflicting namespaces
inside a batch are rejected. Renaming leaves the old export intact. No cleanup
of old, unnamespaced exports is performed automatically.

The JSON companion retains the original source grid metadata byte-for-byte
and addresses adjacent unchanged PNG copies. Export-only padded textures
live in a separate `godot/` subfolder referenced by the TileSet. Undersized
axes are
padded transparently at the bottom-left without resampling. Oversized art
retains its native visible extent. Origin-compensated TileData alternatives
0…7 preserve the anchor for all D4 transforms. Odd size differences add one
transparent row/column to keep integer origins. Unpadded PNG bytes and
margins/spacing remain exact; padded copies preserve sample precision, alpha,
and colour profiles. User PNGs remain unchanged.

No target-specific UI or filesystem writes live inside the plugin. The
production common registry (`editor/src/export/targetRegistry.ts`) and export
dialog capture, preflight and publish the complete plan through the host
writer. Playwright `godot-export.spec.ts` exercises snapshot/writer delivery;
`export-targets.spec.ts` also exercises the production dialog for sequential
map exports and mixed native extents, including source PNG immutability.

## Executed engine gate (rechecked 2026-10-20)

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
/tmp/godot/Godot_v4.5-stable_linux.x86_64 --headless --editor --path packages/core/test/fixtures/godot/project --import --quit
/tmp/godot/Godot_v4.5-stable_linux.x86_64 --headless --path packages/core/test/fixtures/godot/project --script verify.gd --quit-after 120
xvfb-run -a /tmp/godot/Godot_v4.5-stable_linux.x86_64 --path packages/core/test/fixtures/godot/project --rendering-method gl_compatibility --audio-driver Dummy --script render.gd --quit-after 120
```

Results: all commands exit **0** with the official 4.5-stable binary.
`verify.gd` prints `GODOT_SEQUENTIAL_OK`, `GODOT_NATIVE_OK`, and
`GODOT_EXPORT_OK`. It loads A and B after sequential publication to the same
project (both have display name `Same`, with stable ids `A`/`B`) and checks
their red/blue source textures (both named `art.png`) and
different collision source ids. The generator publishes A and then B as two
independent production-exporter plans. The baseline fixture retains all
source/atlas/D4, metadata, sparse-layer, polygon and actual physics queries.

`nativeFixture()` mixes 16×16, 32×32, 48×64, 16×48, and 17×35 art in 32px
cells, each in all eight orientations, with source margins/spacing and a
nonzero atlas coordinate. `native-golden.png` uses independent explicit
inverse-D4 formulas applied to the original native rectangle at its cell's
bottom-left. `render.gd` compares **507,904 pixels** across both goldens,
including transparent space; all match. This catches padding moving under
mirrors, transposed rectangular extent/origin mistakes, and odd-pixel blur.
The separate pure tests cover low-alpha, palette transparency and 16-bit
sample preservation.

Rendering uses Mesa llvmpipe through Xvfb; headless Godot's dummy renderer
cannot capture pixels. Headless loading/physics and Xvfb pixel comparisons
are separate gates. The driver V-Sync warning and test-only direct golden
PNG-load warnings are harmless. Imported caches, `.import`/`.uid` files and
actual screenshots under `project/.godot/` are ignored. Rectangular map-cell
transpose remains a documented restriction; Defold's size policy is unchanged.

Pinned schema references:
[TileMapLayer bytes](https://github.com/godotengine/godot/blob/4.5-stable/scene/2d/tile_map_layer.cpp),
[TileSet/TileData serialization](https://github.com/godotengine/godot/blob/4.5-stable/scene/resources/2d/tile_set.cpp),
[TileSetAtlasSource transforms](https://docs.godotengine.org/en/4.5/classes/class_tilesetatlassource.html),
[Node names](https://docs.godotengine.org/en/4.5/classes/class_node.html#class-node-property-name).
