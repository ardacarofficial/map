import { describe, expect, it } from "vitest";
import { createDocument, exportGameJson, exportTmj, makeCell, MapStore, PORTAL_TYPE_ID, SPAWN_TYPE_ID, parseLevel, serializeLevel } from "../src";
import { TILESET } from "./helpers";

/** 4×3 map, one tile layer and one entity layer with a spawn, a chest and a portal. */
function setup() {
  const store = new MapStore(createDocument({ width: 4, height: 3 }));
  store.dispatch({ type: "addTileset", tileset: TILESET });
  store.dispatch({
    type: "defineEntityType",
    entityType: {
      id: "chest",
      name: "Chest",
      color: "#aa5500",
      fields: [
        { name: "count", type: "int", default: 1 },
        { name: "kind", type: "enum", default: "wood", enumValues: ["wood", "gold"] },
        { name: "weight", type: "float", default: 0.5 },
        { name: "open", type: "bool", default: false },
      ],
    },
  });
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.dispatch({ type: "addLayer", layer: { id: "things", name: "Things", type: "entity" } });
  store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex("grass", 1)) }] });
  store.dispatch({ type: "addEntity", layerId: "things", entity: { id: "start", typeId: SPAWN_TYPE_ID, x: 32, y: 64 } });
  store.dispatch({ type: "addEntity", layerId: "things", entity: { id: "c1", typeId: "chest", x: 96, y: 0, width: 16, height: 16, fields: { count: 3, kind: "gold" } } });
  store.dispatch({
    type: "addEntity",
    layerId: "things",
    entity: { id: "door", typeId: PORTAL_TYPE_ID, x: 0, y: 32, fields: { targetLevel: "lvl-dungeon", targetPoint: { x: 64, y: 96 } } },
  });
  return store;
}

describe("game JSON: entities and spawn", () => {
  it("matches the hand-checked snapshot", () => {
    const text = exportGameJson(setup().document);
    const tail = text.slice(text.indexOf('  "entities"'));
    expect(tail).toBe(SNAPSHOT);
    const game = JSON.parse(text) as { spawn: unknown };
    expect(game.spawn).toEqual({ x: 32, y: 64, cellX: 1, cellY: 2 });
  });

  it("an export without entity layers has empty entities and a null spawn; save/load keeps the export", () => {
    const store = new MapStore(createDocument({ width: 2, height: 2 }));
    const game = JSON.parse(exportGameJson(store.document)) as { entities: unknown[]; spawn: unknown };
    expect(game.entities).toEqual([]);
    expect(game.spawn).toBeNull();
    const doc = setup().document;
    expect(exportGameJson(parseLevel(serializeLevel(doc), doc.tilesets, doc.entityTypes))).toBe(exportGameJson(doc));
  });
});

describe("TMJ: entity layers as object layers", () => {
  it("writes an objectgroup with rectangle objects and typed properties", () => {
    const tmj = JSON.parse(exportTmj(setup().document, "main").text) as {
      layers: { id: number; type: string; name: string; draworder?: string; objects?: Record<string, unknown>[] }[];
      nextlayerid: number;
      nextobjectid: number;
    };
    expect(tmj.layers.map((l) => [l.id, l.type, l.name])).toEqual([[1, "tilelayer", "Ground"], [2, "objectgroup", "Things"]]);
    expect(tmj.nextlayerid).toBe(3);
    expect(tmj.nextobjectid).toBe(4);
    const objects = tmj.layers[1]!.objects!;
    expect(tmj.layers[1]!.draworder).toBe("topdown");
    expect(objects[0]).toEqual({
      height: 32, id: 1, name: "start", properties: [{ name: "typeId", type: "string", value: "spawn" }], rotation: 0, type: "Spawn", visible: true, width: 32, x: 32, y: 64,
    });
    expect(objects[1]).toEqual({
      height: 16,
      id: 2,
      name: "c1",
      properties: [
        { name: "count", type: "int", value: 3 },
        { name: "kind", type: "string", value: "gold" },
        { name: "open", type: "bool", value: false },
        { name: "typeId", type: "string", value: "chest" },
        { name: "weight", type: "float", value: 0.5 },
      ],
      rotation: 0,
      type: "Chest",
      visible: true,
      width: 16,
      x: 96,
      y: 0,
    });
    expect(objects[2]!["properties"]).toEqual([
      { name: "targetLevel", type: "string", value: "lvl-dungeon" },
      { name: "targetPoint", type: "string", value: "64,96" },
      { name: "typeId", type: "string", value: "portal" },
    ]);
  });
});

const SNAPSHOT = [
  "  \"entities\": [",
  "    {",
  "      \"id\": \"things\",",
  "      \"name\": \"Things\",",
  "      \"visible\": true,",
  "      \"items\": [",
  "        {",
  "          \"id\": \"start\",",
  "          \"type\": \"Spawn\",",
  "          \"typeId\": \"spawn\",",
  "          \"x\": 32,",
  "          \"y\": 64,",
  "          \"cellX\": 1,",
  "          \"cellY\": 2,",
  "          \"width\": 32,",
  "          \"height\": 32,",
  "          \"color\": \"#22c55e\",",
  "          \"fields\": []",
  "        },",
  "        {",
  "          \"id\": \"c1\",",
  "          \"type\": \"Chest\",",
  "          \"typeId\": \"chest\",",
  "          \"x\": 96,",
  "          \"y\": 0,",
  "          \"cellX\": 3,",
  "          \"cellY\": 0,",
  "          \"width\": 16,",
  "          \"height\": 16,",
  "          \"color\": \"#aa5500\",",
  "          \"fields\": [",
  "            {",
  "              \"name\": \"count\",",
  "              \"type\": \"int\",",
  "              \"value\": 3",
  "            },",
  "            {",
  "              \"name\": \"kind\",",
  "              \"type\": \"enum\",",
  "              \"value\": \"gold\"",
  "            },",
  "            {",
  "              \"name\": \"weight\",",
  "              \"type\": \"float\",",
  "              \"value\": 0.5",
  "            },",
  "            {",
  "              \"name\": \"open\",",
  "              \"type\": \"bool\",",
  "              \"value\": false",
  "            }",
  "          ]",
  "        },",
  "        {",
  "          \"id\": \"door\",",
  "          \"type\": \"Portal\",",
  "          \"typeId\": \"portal\",",
  "          \"x\": 0,",
  "          \"y\": 32,",
  "          \"cellX\": 0,",
  "          \"cellY\": 1,",
  "          \"width\": 32,",
  "          \"height\": 32,",
  "          \"color\": \"#a855f7\",",
  "          \"fields\": [",
  "            {",
  "              \"name\": \"targetLevel\",",
  "              \"type\": \"levelRef\",",
  "              \"value\": \"lvl-dungeon\"",
  "            },",
  "            {",
  "              \"name\": \"targetPoint\",",
  "              \"type\": \"point\",",
  "              \"value\": {",
  "                \"x\": 64,",
  "                \"y\": 96",
  "              }",
  "            }",
  "          ]",
  "        }",
  "      ]",
  "    }",
  "  ],",
  "  \"spawn\": {",
  "    \"x\": 32,",
  "    \"y\": 64,",
  "    \"cellX\": 1,",
  "    \"cellY\": 2",
  "  }",
  "}",
  "",
].join("\n");
