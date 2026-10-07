/**
 * Entity field names that are special on JavaScript objects (`__proto__`,
 * `constructor`, `prototype`): rejected in type definitions, and never
 * lost or prototype-polluting when they come from a file or an op.
 */
import { describe, expect, it } from "vitest";
import {
  createDocument,
  defaultEntityFields,
  entityTypeProblem,
  MapStore,
  normalizeEntity,
  parseLevel,
  parseProject,
  RESERVED_ENTITY_FIELD_NAMES,
  serializeLevel,
  type EntityType,
} from "../src";

const typeWith = (name: string): EntityType => ({
  id: "t",
  name: "T",
  color: "#000000",
  fields: [{ name, type: "string", default: "hello" }],
});

describe("reserved entity field names", () => {
  it("entityTypeProblem rejects __proto__, constructor and prototype", () => {
    expect(RESERVED_ENTITY_FIELD_NAMES).toEqual(["__proto__", "constructor", "prototype"]);
    for (const name of RESERVED_ENTITY_FIELD_NAMES) expect(entityTypeProblem(typeWith(name))).toMatch(/reserved/);
    expect(entityTypeProblem(typeWith("toString"))).toBeNull();
    expect(() => createDocument({ width: 2, height: 2, entityTypes: [typeWith("__proto__")] })).toThrow(/reserved/);
  });

  it("a project file defining such a field is rejected", () => {
    const text = JSON.stringify({
      format: "smap-project",
      documentFormatVersion: 1,
      name: "p",
      levels: [],
      tilesets: [],
      entityTypes: [{ id: "t", name: "T", color: "#000000", fields: [{ name: "__proto__", type: "string", default: "x" }] }],
    });
    expect(() => parseProject(text)).toThrow(/reserved/);
  });

  it("field maps are prototype-less: any key stays a plain own key", () => {
    const defaults = defaultEntityFields(typeWith("toString"));
    expect(Object.getPrototypeOf(defaults)).toBeNull();
    expect(Object.keys(defaults)).toEqual(["toString"]);
    const e = normalizeEntity({ id: "a", typeId: "t", x: 0, y: 0, fields: JSON.parse('{"__proto__":"bye","b":1}') });
    expect(Object.keys(e.fields)).toEqual(["__proto__", "b"]);
    expect(e.fields["__proto__"]).toBe("bye");
    expect(({} as Record<string, unknown>)["bye"]).toBeUndefined();
  });

  it("addEntity with a __proto__ key is rejected for a type without that field, without pollution", () => {
    const store = new MapStore(createDocument({ width: 4, height: 4, entityTypes: [typeWith("name")] }));
    store.dispatch({ type: "addLayer", layer: { id: "e", name: "E", type: "entity" } });
    expect(() =>
      store.dispatch({ type: "addEntity", layerId: "e", entity: { typeId: "t", x: 0, y: 0, fields: JSON.parse('{"__proto__":{"polluted":1}}') } }),
    ).toThrow(/no field "__proto__"/);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("a stale __proto__ field in a level file survives load and save unchanged", () => {
    const text = JSON.stringify({
      format: "smap-level",
      documentFormatVersion: 1,
      map: { width: 2, height: 2, tileWidth: 32, tileHeight: 32 },
      palette: [],
      layers: [
        {
          id: "e",
          name: "E",
          type: "entity",
          visible: true,
          locked: false,
          opacity: 1,
          entities: [{ id: "a", typeId: "x", x: 0, y: 0, fields: [{ name: "__proto__", value: { x: 1, y: 2 } }, { name: "constructor", value: 3 }] }],
        },
      ],
    });
    const doc = parseLevel(text);
    const out = JSON.parse(serializeLevel(doc));
    expect(out.layers[0].entities[0].fields).toEqual([
      { name: "__proto__", value: { x: 1, y: 2 } },
      { name: "constructor", value: 3 },
    ]);
    expect(serializeLevel(parseLevel(serializeLevel(doc)))).toBe(serializeLevel(doc));
  });
});
