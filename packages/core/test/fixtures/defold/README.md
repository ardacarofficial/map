# Defold export contract

Pinned official release: **Defold 1.9.8**, commit
`67542769598a1b794877c96f740f3f527f63f491` (annotated tag object
`152a3b4cf5b1f2bed843745d0b485ea851129dff`). `bob.jar --version`
reports the same release and commit. These four `.proto` files are snapshots from that commit (only trailing
whitespace is removed):

- [tile_ddf.proto](https://github.com/defold/defold/blob/67542769598a1b794877c96f740f3f527f63f491/engine/gamesys/proto/gamesys/tile_ddf.proto)
- [physics_ddf.proto](https://github.com/defold/defold/blob/67542769598a1b794877c96f740f3f527f63f491/engine/gamesys/proto/gamesys/physics_ddf.proto)
- [gameobject_ddf.proto](https://github.com/defold/defold/blob/67542769598a1b794877c96f740f3f527f63f491/engine/gameobject/proto/gameobject/gameobject_ddf.proto)
- [ddf_math.proto](https://github.com/defold/defold/blob/67542769598a1b794877c96f740f3f527f63f491/engine/ddf/src/ddf/ddf_math.proto)

The upstream license is preserved in LICENSE.txt alongside these fixtures.

`protobufText.ts` reads their field definitions, required/repeated cardinality,
scalar types, nested messages and enums. It strictly parses every emitted
protobuf-text resource. It intentionally supports the text subset emitted by
this exporter; it is not a general-purpose protobuf parser. Unknown fields,
incorrect enum/scalar types and missing required fields fail.

Orientation oracle: `CreateVertexData` in
[comp_tilegrid.cpp](https://github.com/defold/defold/blob/67542769598a1b794877c96f740f3f527f63f491/engine/gamesys/src/gamesys/components/comp_tilegrid.cpp).
The renderer's destination vertices are BL, TL, TR, TR, BR, BL. Taking indices
0,1,2,4 from each `tex_coord_order` row gives the destination-to-source corner
permutations used by `defoldExport.test.ts`. The eight native masks H,V,R are:

```
0: 0 1 2 3    H: 3 2 1 0    V: 1 0 3 2    HV: 2 3 0 1
R: 3 0 1 2   HR: 0 3 2 1   VR: 2 1 0 3   HVR: 1 2 3 0
```

Conjugating editor transpose/H/V by the Y-axis reflection yields native
editor-flag → mask mapping `[0,1,2,3,6,4,7,5]`. No diagonal bit is copied.
`script_tilemap.cpp` subtracts one from Lua x, y and tile; file coordinates
and tile IDs are already zero-based. Empty visual cells have no `cell` entry.
In particular, file tile 0 is visible (Lua tile 1), not empty (Lua tile 0).

Box oracle: editor `BoxShape.shape-data` in
[collision_object.clj](https://github.com/defold/defold/blob/67542769598a1b794877c96f740f3f527f63f491/editor/src/clj/editor/collision_object.clj)
divides dimensions by two. Engine `NewBoxShape2D` passes these half extents
to Box2D `SetAsBox`. The 1-cell test therefore expects `[8,8,0.5]` for a
16×16×1 box. Shape index/count point at three floats; quaternions are identity.

Collision resources use a conservative budget of 16 boxes each, one component
per GO. This is an exporter budget, not a claim that Defold has a 16-shape
hard limit (the pinned resource uses uint32 counts). Visual GOs also have
at most 16 components. Batches never truncate. Large exports may require
increasing `physics.max_collision_objects`, `collection.max_instances`,
`tilemap.max_count` and `tilemap.max_tile_count` in the user's project.

The lane's browser tests exercise the plugin + real image registry + real folder
writer; target selection/persistence in ExportDialog belongs to the registry
lane, which imports `defoldTarget`.

## Official engine verification

Verified on 2026-10-19 using already-installed OpenJDK 21. Official Bob 1.9.8
built both the real-browser export artifact and a second, asymmetric engine
fixture with two tilesources, three tilemap components (including a hidden
layer), all eight orientations, spacing/margin and collision on an empty visual
cell. The compiled `.texturesetc` files are parsed with Bob's official generated
protobuf classes and must contain eight frames each. This catches Defold's
per-tile-margin semantics: copying the editor's outer margin directly produced
only three native frames in the original fixture. The exporter now losslessly
crops the outer border from the export copy and writes native/companion margin 0.
Tile pixels, packed/indexed samples, 16-bit depth, Adam7 input, tRNS and colour
interpretation chunks have independent unit tests. Source PNGs are unchanged.
Both archive builds exited 0. The matching official headless engine
loaded the second fixture, ran the Lua assertions and exited 0 with:

```
DEFOLD_EXPORT_VERIFIED: numbering, Y, D4, multisource, 1-cell collision
```

The one-cell box was checked by the actual engine's physics.get_shape:
exported [8,8,0.5] half extents read back as dimensions 16×16. Native flag
checks use tilemap.get_tile_info; corner orientation is independently checked
against the renderer table above. This is a headless resource/runtime check,
not a graphical screenshot comparison. The graphical binary bundled in Bob
could not start because the host lacked libGLU.so.1; no system library or Java
installation was performed.

Reproduction from the worktree root (Vite already serving on assigned lane
port 5881; Playwright uses /opt/pw-browsers):

```sh
mkdir -p /tmp/defold
curl -fL https://github.com/defold/defold/releases/download/1.9.8/bob.jar -o /tmp/defold/bob.jar
curl -fL https://d.defold.com/archive/67542769598a1b794877c96f740f3f527f63f491/engine/x86_64-linux/dmengine_headless -o /tmp/defold/dmengine_headless
chmod +x /tmp/defold/dmengine_headless
node e2e/support/defoldEngine.mjs http://localhost:5881 /tmp/defold/bob.jar /tmp/defold/dmengine_headless
```

The opt-in helper checks Bob's commit, generates a pure export from an
asymmetric raster fixture, adds an acceptance probe script, invokes Bob and
runs the engine. Files/logs stay in /tmp/defold/verification*. The browser
folder-write test also retains a Bob-buildable project in its test output.
