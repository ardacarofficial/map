// eslint-disable-next-line no-restricted-imports -- pinned schema fixture oracle, tests only
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDocument, FLIP_D, FLIP_H, FLIP_V, makeCell, MapStore, type Tileset } from "../src/index";
import { exportDefold } from "../src/export/defold";
import { ProtoSchema, type ProtoMessage } from "./fixtures/defold/protobufText";

let root = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/[^/]*$/, "") + "/fixtures/defold/";
if (/^\/[A-Za-z]:/.test(root)) root = root.slice(1);
const schema = new ProtoSchema(["tile_ddf.proto", "physics_ddf.proto", "gameobject_ddf.proto", "ddf_math.proto"].map((file) => readFileSync(root + file, "utf8")));
const types: Record<string, string> = {
  tilesource: "dmGameSystemDDF.TileSet", tilemap: "dmGameSystemDDF.TileGrid",
  collisionobject: "dmPhysicsDDF.CollisionObjectDesc", go: "dmGameObjectDDF.PrototypeDesc", collection: "dmGameObjectDDF.CollectionDesc",
};
const atlas: Tileset = { id: "a", name: "Atlas", imagePath: "C:\\Art\\tile.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0 };
const firstMessage = (message: ProtoMessage, field: string) => message[field]![0] as ProtoMessage;

describe("Defold pinned official schema", () => {
  it("parses every protobuf-text resource, checks all references and verifies collision half extents", () => {
    const store = new MapStore(createDocument({ width: 8, height: 3, tileWidth: 16, tileHeight: 16, tilesets: [atlas, { ...atlas, id: "b" }] }));
    store.dispatch({ type: "addLayer", layer: { id: 'ground"\\\n', name: "Ground" } });
    const flags = [0, FLIP_H, FLIP_V, FLIP_H | FLIP_V, FLIP_D, FLIP_D | FLIP_H, FLIP_D | FLIP_V, FLIP_D | FLIP_H | FLIP_V];
    for (const [x, flag] of flags.entries()) {
      store.dispatch({ type: "paintCells", layerId: 'ground"\\\n', cells: [{ x, y: 0, cell: makeCell(store.getOrAddPaletteIndex(x & 1 ? "b" : "a", x), flag) }] });
    }
    store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: "col", cells: [{ x: 7, y: 2, value: 1 }] });
    const files = exportDefold(store.document, "Room", () => new Uint8Array([137]), { projectSubfolder: "exports\\world" });
    const paths = new Set(files.map((file) => "/" + file.path));
    const parsed = new Map<string, ProtoMessage>();
    for (const file of files) {
      if (!("text" in file)) continue;
      const ext = file.path.split(".").pop()!;
      if (ext === "json") { JSON.parse(file.text); continue; }
      expect(types[ext]).toBeDefined();
      parsed.set(ext, schema.parse(file.text, types[ext]!));
      // Exported resource references are absolute Defold paths and resolve.
      for (const reference of file.text.matchAll(/(?:image|tile_set|component|prototype):\s*("(?:\\.|[^"\\])*")/g)) {
        expect(paths.has(JSON.parse(reference[1]!) as string)).toBe(true);
      }
    }
    expect([...parsed.keys()].sort()).toEqual(Object.keys(types).sort());
    const collision = firstMessage(parsed.get("collisionobject")!, "embedded_collision_shape");
    expect(collision.data).toEqual([8, 8, 0.5]); // 16×16×1 dimensions, same as editor BoxShape's shape-data
    const shape = firstMessage(collision, "shapes");
    expect(firstMessage(shape, "position")).toEqual({ x: [120], y: [-40], z: [0] });
    expect(firstMessage(shape, "rotation")).toEqual({ x: [0], y: [0], z: [0], w: [1] });
    expect(shape.index).toEqual([0]);
    expect(shape.count).toEqual([3]);
  });

  it("catches schema typos, bool-for-uint flags, missing required fields and invalid indices", () => {
    const valid = 'tile_set: "/a.tilesource" layers { id: "a" z: 0 is_visible: 1 cell { x: 0 y: -1 tile: 0 } }';
    expect(() => schema.parse(valid, types.tilemap!)).not.toThrow();
    for (const invalid of [valid.replace("tile_set", "tileset"), valid.replace("is_visible: 1", "is_visible: true"), valid.replace('id: "a"', ""), valid.replace("tile: 0", "tile: -1")]) {
      expect(() => schema.parse(invalid, types.tilemap!)).toThrow();
    }
    expect(() => schema.parse('type: TYPE_BOX mass: 0 friction: 0.1 restitution: 0 group: "map"', types.collisionobject!)).toThrow();
  });
});
