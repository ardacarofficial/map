import { describe, expect, it } from "vitest";
import {
  addLevel,
  createDocument,
  FormatError,
  levelIdFromPath,
  MapStore,
  moveLevel,
  parseProject,
  portalLabel,
  portalStatus,
  PORTAL_TYPE_ID,
  removeLevel,
  renameLevel,
  serializeProject,
  setLevelWorldPosition,
  worldLinks,
  type Entity,
  type MapDocument,
  type ProjectData,
} from "../src";

const LEGACY = `{
  "format": "smap-project",
  "documentFormatVersion": 1,
  "name": "Eski",
  "levels": [
    { "name": "main", "path": "levels/main.json" },
    { "name": "Zindan", "path": "levels/dungeon.json" }
  ],
  "tilesets": []
}
`;

describe("project level list", () => {
  it("legacy files get stable path-derived ids and a default world position, written on the next save", () => {
    const project = parseProject(LEGACY);
    expect(project.levels.map((l) => l.id)).toEqual([levelIdFromPath("levels/main.json"), levelIdFromPath("levels/dungeon.json")]);
    expect(project.levels[0]!.id).toMatch(/^lvl-[0-9a-f]{8}$/);
    expect(project.levels[1]!.world).toEqual({ x: 0, y: 0 });
    const saved = serializeProject(project);
    expect(saved).toContain(`"id": "${project.levels[0]!.id}"`);
    // Reading again gives the same ids; the save is a fixed point.
    expect(parseProject(saved)).toEqual(project);
    expect(serializeProject(parseProject(saved))).toBe(saved);
    expect(serializeProject(parseProject(LEGACY))).toBe(saved);
  });

  it("ids survive renames, moves and path-independent edits; world positions snap", () => {
    let p = parseProject(LEGACY);
    const dungeon = p.levels[1]!.id;
    p = renameLevel(p, dungeon, "Mağara");
    p = moveLevel(p, dungeon, 0);
    p = setLevelWorldPosition(p, dungeon, { x: 47, y: -17 }, { snap: 32 });
    expect(p.levels[0]).toEqual({ id: dungeon, name: "Mağara", path: "levels/dungeon.json", world: { x: 32, y: -32 } });
    p = setLevelWorldPosition(p, dungeon, { x: 10.4, y: 3.6 });
    expect(p.levels[0]!.world).toEqual({ x: 10, y: 4 });
    const text = serializeProject(p);
    expect(parseProject(text)).toEqual(p);
    expect(() => renameLevel(p, "nope", "x")).toThrow(/unknown level/);
  });

  it("addLevel generates unique ids, rejects duplicate paths; removeLevel removes by id", () => {
    let p = parseProject(LEGACY);
    p = addLevel(p, { name: "Orman", path: "levels/forest.json", world: { x: 640, y: 0 } });
    expect(p.levels[2]).toMatchObject({ id: levelIdFromPath("levels/forest.json"), name: "Orman", world: { x: 640, y: 0 } });
    // A clashing id gets a suffix.
    p = addLevel(p, { id: "lvl-x", name: "A", path: "levels/a.json" });
    expect(() => addLevel(p, { id: "lvl-x", name: "B", path: "levels/b.json" })).toThrow(/duplicate level id/);
    expect(() => addLevel(p, { name: "C", path: "levels/a.json" })).toThrow(/duplicate level path/);
    expect(() => addLevel(p, { name: "D", path: "../d.json" })).toThrow();
    p = removeLevel(p, "lvl-x");
    expect(p.levels.map((l) => l.name)).toEqual(["main", "Zindan", "Orman"]);
  });

  it("parse rejects duplicate ids", () => {
    const text = LEGACY.replace('{ "name": "main"', '{ "id": "a", "name": "main"').replace('{ "name": "Zindan"', '{ "id": "a", "name": "Zindan"');
    expect(() => parseProject(text)).toThrow(FormatError);
  });
});

function portal(id: string, targetLevel: string | null, point: { x: number; y: number } | null = null): Entity {
  return { id, typeId: PORTAL_TYPE_ID, x: 0, y: 0, fields: { targetLevel, targetPoint: point } };
}

describe("portals and world links", () => {
  const project: ProjectData = {
    name: "P",
    levels: [
      { id: "town", name: "Kasaba", path: "levels/town.json" },
      { id: "dungeon", name: "Zindan", path: "levels/dungeon.json" },
    ],
    tilesets: [],
  };

  it("status and label follow the level id, not the name; removal is never repaired", () => {
    const door = portal("door", "dungeon");
    expect(portalStatus(project, door)).toBe("ok");
    expect(portalLabel(project, door)).toBe("→ Zindan");
    const renamed = renameLevel(project, "dungeon", "Mağara");
    expect(portalStatus(renamed, door)).toBe("ok");
    expect(portalLabel(renamed, door)).toBe("→ Mağara");
    const removed = removeLevel(project, "dungeon");
    expect(portalStatus(removed, door)).toBe("missingLevel");
    expect(portalLabel(removed, door)).toBe("→ ?");
    expect(door.fields["targetLevel"]).toBe("dungeon");
    expect(portalStatus(project, portal("p", null))).toBe("unset");
  });

  it("worldLinks lists valid portal links in level / layer / entity order", () => {
    const level = (portals: [string, string | null][]): MapDocument => {
      const store = new MapStore(createDocument({ width: 4, height: 4 }));
      store.dispatch({ type: "addLayer", layer: { id: "e", name: "E", type: "entity" } });
      for (const [id, target] of portals) {
        store.dispatch({ type: "addEntity", layerId: "e", entity: { id, typeId: PORTAL_TYPE_ID, x: 0, y: 0, fields: { targetLevel: target, targetPoint: { x: 32, y: 64 } } } });
      }
      return store.document;
    };
    const docs = new Map([
      ["town", level([["d1", "dungeon"], ["d2", null], ["d3", "gone"]])],
      ["dungeon", level([["up", "town"]])],
    ]);
    expect(worldLinks(project, docs)).toEqual([
      { fromLevelId: "town", fromEntityId: "d1", toLevelId: "dungeon", toPoint: { x: 32, y: 64 } },
      { fromLevelId: "dungeon", fromEntityId: "up", toLevelId: "town", toPoint: { x: 32, y: 64 } },
    ]);
    expect(worldLinks(removeLevel(project, "dungeon"), docs)).toEqual([]);
  });
});
