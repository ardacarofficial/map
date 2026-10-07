import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createDocument, MapStore, makeCell, serializeLevel, parseLevel, exportTmj, exportGameJson,
  deriveTerrainTiles, normalizeEntity, entityTypeProblem, defaultEntityFields,
} from "../src";
import { exportBaseName } from "../src/export/common";
import { makeTerrainStore, TILESET, TERRAIN_TILESET } from "./helpers";

describe("review", () => {
  it("entity field named __proto__ is accepted but lost", () => {
    const type = { id: "t", name: "T", color: "#000000", fields: [{ name: "__proto__", type: "string" as const, default: "hello" }] };
    expect(entityTypeProblem(type)).toBeNull();
    const defaults = defaultEntityFields(type);
    console.log("defaults own keys", Object.keys(defaults));
    const store = new MapStore(createDocument({ width: 4, height: 4, entityTypes: [type] }));
    store.dispatch({ type: "addLayer", layer: { id: "e", name: "E", type: "entity" } });
    store.dispatch({ type: "addEntity", layerId: "e", entity: { id: "a", typeId: "t", x: 0, y: 0, fields: JSON.parse('{"__proto__":"bye"}') } });
    const e = store.document.findEntity("a")!.entity;
    console.log("entity fields own keys", Object.keys(e.fields));
    expect(Object.keys(e.fields)).toContain("__proto__");
  });

  it("level file with __proto__ point field", () => {
    const text = JSON.stringify({ format: "smap-level", documentFormatVersion: 1, map: { width: 2, height: 2, tileWidth: 32, tileHeight: 32 }, palette: [],
      layers: [{ id: "e", name: "E", type: "entity", visible: true, locked: false, opacity: 1, entities: [
        { id: "a", typeId: "x", x: 0, y: 0, fields: [{ name: "__proto__", value: { x: 1, y: 2 } }] } ] }] });
    const doc = parseLevel(text);
    const out = serializeLevel(doc);
    expect(JSON.parse(out).layers[0].entities[0].fields).toEqual([{ name: "__proto__", value: { x: 1, y: 2 } }]);
  });

  it("tmj gid of out-of-range palette tile collides with next tileset", () => {
    const small = { ...TILESET, id: "a", imagePath: "a.png", columns: 2, rows: 2 };
    const other = { ...TILESET, id: "b", imagePath: "b.png", columns: 2, rows: 2 };
    const text = JSON.stringify({ format: "smap-level", documentFormatVersion: 1, map: { width: 1, height: 1, tileWidth: 32, tileHeight: 32 },
      palette: [{ index: 1, tilesetId: "a", tileId: 5 }, { index: 2, tilesetId: "b", tileId: 0 }],
      layers: [{ id: "l", name: "L", type: "tile", visible: true, locked: false, opacity: 1, chunks: [] }] });
    const doc = parseLevel(text, [small, other]);
    const store = new MapStore(doc);
    store.dispatch({ type: "paintCells", layerId: "l", cells: [{ x: 0, y: 0, cell: makeCell(1) }] });
    store.dispatch({ type: "addLayer", layer: { id: "l2", name: "L2" } });
    store.dispatch({ type: "paintCells", layerId: "l2", cells: [{ x: 0, y: 0, cell: makeCell(2) }] });
    const tmj = JSON.parse(exportTmj(doc, "m").text);
    console.log("gids", tmj.layers.map((l: any) => l.data), tmj.tilesets.map((t: any) => t.firstgid), exportTmj(doc, "m").warnings);
    expect(tmj.layers[0].data[0]).not.toBe(tmj.tilesets[1].firstgid + 1);
  });

  it("export base name of reserved windows name", () => {
    console.log(exportBaseName("CON"), exportBaseName("nul"), exportBaseName("com1"));
    expect(exportBaseName("CON").toUpperCase()).not.toBe("CON");
  });
});
