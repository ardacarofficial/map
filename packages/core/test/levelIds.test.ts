/**
 * Level ids are never reused: removing a level retires its id, so a new
 * level at the same path does not silently relink the old level's portals
 * (CLAUDE.md v1.1: "Otomatik onarım yok").
 */
import { describe, expect, it } from "vitest";
import {
  addLevel,
  levelIdFromPath,
  normalizeProject,
  parseProject,
  PORTAL_TYPE_ID,
  portalStatus,
  removeLevel,
  serializeProject,
  type Entity,
} from "../src";

const portalTo = (target: string): Entity => ({ id: "p", typeId: PORTAL_TYPE_ID, x: 0, y: 0, fields: { targetLevel: target, targetPoint: null } });

describe("retired level ids", () => {
  it("a removed level's portals stay missingLevel after a level with the same path is added", () => {
    let project = addLevel({ name: "p", levels: [], tilesets: [] }, { name: "Main", path: "levels/main.json" });
    project = addLevel(project, { name: "Zindan", path: "levels/dungeon.json" });
    const dungeon = project.levels[1]!.id;
    expect(dungeon).toBe(levelIdFromPath("levels/dungeon.json"));
    const portal = portalTo(dungeon);
    expect(portalStatus(project, portal)).toBe("ok");

    project = removeLevel(project, dungeon);
    expect(project.retiredLevelIds).toEqual([dungeon]);
    expect(portalStatus(project, portal)).toBe("missingLevel");

    project = addLevel(project, { name: "Yeni Zindan", path: "levels/dungeon.json" });
    expect(project.levels[1]!.id).toBe(`${dungeon}-2`);
    expect(portalStatus(project, portal)).toBe("missingLevel");
  });

  it("retired ids survive save and load; old files without them still load", () => {
    let project = addLevel({ name: "p", levels: [], tilesets: [] }, { name: "A", path: "levels/a.json" });
    const id = project.levels[0]!.id;
    project = removeLevel(project, id);
    const text = serializeProject(project);
    expect(JSON.parse(text).retiredLevelIds).toEqual([id]);
    const loaded = parseProject(text);
    expect(loaded.retiredLevelIds).toEqual([id]);
    expect(addLevel(loaded, { name: "A", path: "levels/a.json" }).levels[0]!.id).toBe(`${id}-2`);
    expect(serializeProject(loaded)).toBe(text);

    const legacy = serializeProject({ name: "p", levels: [{ name: "B", path: "levels/b.json" }], tilesets: [] });
    expect(JSON.parse(legacy).retiredLevelIds).toBeUndefined();
    expect(parseProject(legacy).levels[0]!.id).toBe(levelIdFromPath("levels/b.json"));
  });

  it("an explicit id is a deliberate restore and leaves the retired list", () => {
    let project = addLevel({ name: "p", levels: [], tilesets: [] }, { name: "A", path: "levels/a.json" });
    const id = project.levels[0]!.id;
    project = removeLevel(project, id);
    project = addLevel(project, { id, name: "A", path: "levels/a.json" });
    expect(project.levels[0]!.id).toBe(id);
    expect(project.retiredLevelIds).toEqual([]);
    expect(normalizeProject(project)).toEqual(project);
  });
});
