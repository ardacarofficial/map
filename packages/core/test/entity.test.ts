import { describe, expect, it } from "vitest";
import {
  createDocument,
  entityFieldValueProblem,
  entityTypeProblem,
  FormatError,
  isEntityLayer,
  MapStore,
  parseLevel,
  parseProject,
  PORTAL_TYPE_ID,
  resolveEntityFields,
  serializeLevel,
  serializeProject,
  SPAWN_TYPE_ID,
  type EntityType,
  type StoreChangeEvent,
} from "../src";
import { TILESET } from "./helpers";

const CHEST: EntityType = {
  id: "chest",
  name: "Chest",
  color: "#aa5500",
  icon: "box",
  fields: [
    { name: "count", type: "int", default: 1 },
    { name: "kind", type: "enum", default: "wood", enumValues: ["wood", "gold"] },
    { name: "locked", type: "bool", default: false },
  ],
};

function entityStore() {
  const store = new MapStore(createDocument({ width: 10, height: 8, tilesets: [TILESET] }));
  store.dispatch({ type: "defineEntityType", entityType: CHEST });
  store.dispatch({ type: "addLayer", layer: { id: "tiles", name: "Tiles" } });
  store.dispatch({ type: "addLayer", layer: { id: "ents", name: "Entities", type: "entity" } });
  store.clearHistory();
  return store;
}

describe("field validation", () => {
  it("checks values against field types", () => {
    const ok: [Parameters<typeof entityFieldValueProblem>[0], unknown][] = [
      [{ name: "a", type: "string", default: "" }, "x"],
      [{ name: "a", type: "int", default: 0 }, -4],
      [{ name: "a", type: "float", default: 0 }, 0.5],
      [{ name: "a", type: "bool", default: false }, true],
      [{ name: "a", type: "enum", default: "x", enumValues: ["x", "y"] }, "y"],
      [{ name: "a", type: "levelRef", default: null }, "lvl-1"],
      [{ name: "a", type: "levelRef", default: null }, null],
      [{ name: "a", type: "point", default: null }, { x: 3, y: 4 }],
    ];
    for (const [field, value] of ok) expect(entityFieldValueProblem(field, value)).toBeNull();
    const bad: [Parameters<typeof entityFieldValueProblem>[0], unknown][] = [
      [{ name: "a", type: "string", default: "" }, 1],
      [{ name: "a", type: "int", default: 0 }, 1.5],
      [{ name: "a", type: "float", default: 0 }, Number.NaN],
      [{ name: "a", type: "bool", default: false }, "true"],
      [{ name: "a", type: "enum", default: "x", enumValues: ["x"] }, "z"],
      [{ name: "a", type: "levelRef", default: null }, ""],
      [{ name: "a", type: "point", default: null }, { x: 1.5, y: 0 }],
      [{ name: "a", type: "point", default: null }, { x: 1, y: 0, z: 2 }],
    ];
    for (const [field, value] of bad) expect(entityFieldValueProblem(field, value)).toMatch(/field "a"/);
  });

  it("checks type definitions", () => {
    expect(entityTypeProblem(CHEST)).toBeNull();
    expect(entityTypeProblem({ ...CHEST, color: "red" })).toMatch(/color/);
    expect(entityTypeProblem({ ...CHEST, fields: [...CHEST.fields, { name: "count", type: "int", default: 0 }] })).toMatch(/duplicate field/);
    expect(entityTypeProblem({ ...CHEST, fields: [{ name: "e", type: "enum", default: "a" }] })).toMatch(/enumValues/);
    expect(entityTypeProblem({ ...CHEST, fields: [{ name: "e", type: "int", default: "a" }] })).toMatch(/default/);
    expect(entityTypeProblem({ ...CHEST, fields: [{ name: "e", type: "int", default: 1, enumValues: ["a"] }] })).toMatch(/only enum/);
  });

  it("the store rejects invalid entities and types", () => {
    const store = entityStore();
    const add = (entity: object) => () => store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: "chest", x: 0, y: 0, ...entity } });
    expect(add({ fields: { count: "many" } })).toThrow(/count/);
    expect(add({ fields: { nope: 1 } })).toThrow(/no field "nope"/);
    expect(add({ x: 320 })).toThrow(/inside the map/);
    expect(add({ x: 1.5 })).toThrow(/integer pixels/);
    expect(add({ typeId: "ghost" })).toThrow(/unknown entity type/);
    expect(() => store.dispatch({ type: "addEntity", layerId: "tiles", entity: { typeId: "chest", x: 0, y: 0 } })).toThrow(/not an entity layer/);
    expect(() => store.dispatch({ type: "paintCells", layerId: "ents", cells: [] })).toThrow(/entity layer/);
    expect(() => store.dispatch({ type: "defineEntityType", entityType: { ...CHEST, id: SPAWN_TYPE_ID } })).toThrow(/built-in/);
    expect(() => store.dispatch({ type: "removeEntityType", typeId: PORTAL_TYPE_ID })).toThrow(/built-in/);
    expect(store.canUndo).toBe(false);
  });
});

describe("entity ops", () => {
  it("add / move / update / remove are undoable; defaults are filled in; ids are generated", () => {
    const store = entityStore();
    const events: StoreChangeEvent[] = [];
    store.subscribe((e) => events.push(e));
    const start = serializeLevel(store.document);
    const id = store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: "chest", x: 32, y: 64, fields: { count: 5 } } });
    expect(id).toBe("e1");
    const layer = store.document.getLayer("ents")!;
    expect(isEntityLayer(layer) && layer.entities[0]).toEqual({ id: "e1", typeId: "chest", x: 32, y: 64, fields: { count: 5, kind: "wood", locked: false } });
    expect(events.at(-1)!.structure).toEqual(["entities"]);
    store.dispatch({ type: "moveEntity", entityId: "e1", x: 96, y: 0 });
    store.dispatch({ type: "updateEntity", entityId: "e1", fields: { kind: "gold" }, width: 64 });
    expect(() => store.dispatch({ type: "updateEntity", entityId: "e1", fields: { kind: "silver" } })).toThrow(/kind/);
    store.dispatch({ type: "removeEntity", entityId: "e1" });
    expect(store.undoDepth).toBe(4);
    store.undo();
    expect(store.document.findEntity("e1")!.entity).toEqual({ id: "e1", typeId: "chest", x: 96, y: 0, width: 64, fields: { count: 5, kind: "gold", locked: false } });
    store.undo();
    store.undo();
    expect(store.document.findEntity("e1")!.entity.x).toBe(32);
    store.undo();
    expect(serializeLevel(store.document)).toBe(start);
    while (store.redo());
    expect(store.document.findEntity("e1")).toBeUndefined();
  });

  it("a drag (moves in one transaction) is one undo step with one change", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "a", typeId: "chest", x: 0, y: 0 } });
    store.beginTransaction();
    for (let x = 1; x <= 5; x++) store.dispatch({ type: "moveEntity", entityId: "a", x: x * 32, y: 0 });
    store.commit();
    expect(store.undoDepth).toBe(2);
    store.undo();
    expect(store.document.findEntity("a")!.entity.x).toBe(0);
    // Moving there and back again is no step at all.
    store.beginTransaction();
    store.dispatch({ type: "moveEntity", entityId: "a", x: 32, y: 0 });
    store.dispatch({ type: "moveEntity", entityId: "a", x: 0, y: 0 });
    store.commit();
    expect(store.canRedo).toBe(true);
  });

  it("locked entity layers ignore edits", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "a", typeId: "chest", x: 0, y: 0 } });
    store.dispatch({ type: "setLayerProps", layerId: "ents", props: { locked: true } });
    const depth = store.undoDepth;
    expect(store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: "chest", x: 0, y: 0 } })).toBeNull();
    store.dispatch({ type: "moveEntity", entityId: "a", x: 32, y: 32 });
    store.dispatch({ type: "removeEntity", entityId: "a" });
    expect(store.undoDepth).toBe(depth);
    expect(store.document.findEntity("a")!.entity.x).toBe(0);
  });

  it("at most one spawn point per level", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "s", typeId: SPAWN_TYPE_ID, x: 64, y: 32 } });
    expect(store.document.spawn()?.id).toBe("s");
    expect(() => store.dispatch({ type: "addEntity", layerId: "ents", entity: { typeId: SPAWN_TYPE_ID, x: 0, y: 0 } })).toThrow(/spawn/);
  });

  it("entity types are undoable; removing a type keeps its entities; exports fall back to defaults", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "a", typeId: "chest", x: 0, y: 0, fields: { kind: "gold" } } });
    store.dispatch({ type: "defineEntityType", entityType: { ...CHEST, fields: [{ name: "kind", type: "enum", default: "iron", enumValues: ["iron"] }] } });
    const entity = store.document.findEntity("a")!.entity;
    expect(resolveEntityFields(entity, store.document.getEntityType("chest"))).toEqual([{ name: "kind", type: "enum", value: "iron" }]);
    store.dispatch({ type: "removeEntityType", typeId: "chest" });
    expect(store.document.entityTypes).toEqual([]);
    expect(store.document.findEntity("a")).toBeDefined();
    store.undo();
    store.undo();
    expect(store.document.getEntityType("chest")).toEqual(CHEST);
    // Redefining with the same content is a no-op.
    const depth = store.undoDepth;
    store.dispatch({ type: "defineEntityType", entityType: CHEST });
    expect(store.undoDepth).toBe(depth);
  });

  it("resizing shifts entities with the content and drops those outside (undo restores)", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "a", typeId: "chest", x: 32, y: 32 } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "b", typeId: "chest", x: 288, y: 0 } });
    const before = serializeLevel(store.document);
    store.dispatch({ type: "resizeMap", width: 9, height: 8, offsetX: 1, offsetY: 0 });
    expect(store.document.findEntity("a")!.entity).toMatchObject({ x: 64, y: 32 });
    expect(store.document.findEntity("b")).toBeUndefined();
    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
  });
});

describe("entity persistence", () => {
  it("level and project files roundtrip entities and entity types byte-identically", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "s", typeId: SPAWN_TYPE_ID, x: 0, y: 0 } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "p", typeId: PORTAL_TYPE_ID, x: 32, y: 0, width: 64, fields: { targetPoint: { x: 5, y: 6 } } } });
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "c", typeId: "chest", x: 0, y: 32, fields: { count: 2 } } });
    const level = serializeLevel(store.document);
    expect(level).toContain('"type": "entity"');
    expect(level).toContain('"entities": [');
    const doc = parseLevel(level, [TILESET], store.document.entityTypes);
    expect(serializeLevel(doc)).toBe(level);
    expect(doc.getEntityType("chest")).toEqual(CHEST);
    expect(doc.spawn()?.id).toBe("s");

    const project = serializeProject({ name: "P", levels: [], tilesets: [TILESET], entityTypes: store.document.entityTypes });
    const parsed = parseProject(project);
    expect(parsed.entityTypes).toEqual([CHEST]);
    expect(serializeProject(parsed)).toBe(project);
  });

  it("rejects broken entity data", () => {
    const store = entityStore();
    store.dispatch({ type: "addEntity", layerId: "ents", entity: { id: "a", typeId: "chest", x: 0, y: 0 } });
    const level = JSON.parse(serializeLevel(store.document)) as { layers: { entities?: { id: string; x: number; fields: unknown[] }[] }[] };
    const mutate = (f: (l: typeof level) => void) => {
      const copy = JSON.parse(JSON.stringify(level)) as typeof level;
      f(copy);
      return () => parseLevel(JSON.stringify(copy));
    };
    expect(mutate((l) => (l.layers[1]!.entities![0]!.x = 9999))).toThrow(FormatError);
    expect(mutate((l) => l.layers[1]!.entities!.push({ ...l.layers[1]!.entities![0]! }))).toThrow(/duplicate entity id/);
    expect(mutate((l) => (l.layers[1]!.entities![0]!.fields = [{ name: "x", value: [1] }]))).toThrow(/invalid field value/);
    const project = JSON.parse(serializeProject({ name: "P", levels: [], tilesets: [], entityTypes: [CHEST] })) as { entityTypes: { id: string }[] };
    project.entityTypes[0]!.id = "portal";
    expect(() => parseProject(JSON.stringify(project))).toThrow(/reserved/);
  });
});
