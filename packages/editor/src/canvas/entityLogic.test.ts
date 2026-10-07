import { PORTAL_TYPE_ID, SPAWN_TYPE_ID, type Entity, type EntityType, type MapInfo, type ProjectData } from "@smap/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LABEL_MAX_ON_SCREEN,
  LABEL_MIN_CELL_CSS_PX,
  dragPosition,
  entityLabel,
  entityLook,
  hitSlop,
  hitTestEntities,
  labelsVisible,
  parseHexColor,
  snapToCell,
  type EntityColors,
} from "./entityLogic";

const map: MapInfo = { width: 10, height: 8, tileWidth: 16, tileHeight: 16 };
const ent = (id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity => ({ id, typeId: "chest", x, y, fields: {}, ...extra });
const colors: EntityColors = { spawn: 0x00ff00, portal: 0xaa00ff, danger: 0xff0000, unknown: 0x777777 };
const project: ProjectData = { name: "p", tilesets: [], levels: [{ id: "lvl-dungeon", name: "Zindan", path: "levels/dungeon.json" }] };
const chest: EntityType = { id: "chest", name: "Sandık", color: "#c08040", fields: [] };

describe("hitTestEntities", () => {
  const list = [ent("a", 16, 16), ent("b", 16, 16, { width: 32, height: 32 }), ent("c", 64, 64)];

  it("returns the top-most (last) entity containing the point", () => {
    expect(hitTestEntities(list, map, { x: 20, y: 20 })?.id).toBe("b");
    expect(hitTestEntities(list, map, { x: 40, y: 40 })?.id).toBe("b");
    expect(hitTestEntities(list, map, { x: 70, y: 70 })?.id).toBe("c");
  });

  it("boxes are half-open and default to one cell", () => {
    expect(hitTestEntities([ent("a", 16, 16)], map, { x: 31.9, y: 16 })?.id).toBe("a");
    expect(hitTestEntities([ent("a", 16, 16)], map, { x: 32, y: 16 })).toBeNull();
    expect(hitTestEntities([ent("a", 16, 16)], map, { x: 15.9, y: 20 })).toBeNull();
  });

  it("slop grows boxes on every side", () => {
    expect(hitTestEntities([ent("a", 16, 16)], map, { x: 14, y: 20 }, 3)?.id).toBe("a");
    expect(hitTestEntities([ent("a", 16, 16)], map, { x: 34, y: 20 }, 3)?.id).toBe("a");
    expect(hitTestEntities([ent("a", 16, 16)], map, { x: 36, y: 20 }, 3)).toBeNull();
  });

  it("hit slop is ~3 CSS px at any zoom", () => {
    expect(hitSlop(1)).toBe(3);
    expect(hitSlop(0.5)).toBe(6);
    expect(hitSlop(0)).toBe(0);
  });
});

describe("snapToCell / dragPosition", () => {
  it("snaps to cell corners inside the map", () => {
    expect(snapToCell({ x: 3, y: 2 }, map)).toEqual({ x: 48, y: 32 });
    expect(snapToCell({ x: -4, y: 99 }, map)).toEqual({ x: 0, y: 112 });
  });

  it("does not move (or snap) while the pointer stays in the grab cell", () => {
    expect(dragPosition({ x: 21, y: 5 }, { x: 1, y: 0 }, { x: 1, y: 0 }, map)).toEqual({ x: 21, y: 5 });
  });

  it("moves by whole cells, snapped and clamped", () => {
    expect(dragPosition({ x: 16, y: 16 }, { x: 1, y: 1 }, { x: 3, y: 2 }, map)).toEqual({ x: 48, y: 32 });
    expect(dragPosition({ x: 21, y: 5 }, { x: 1, y: 0 }, { x: 2, y: 0 }, map)).toEqual({ x: 32, y: 0 });
    expect(dragPosition({ x: 16, y: 16 }, { x: 1, y: 1 }, { x: 50, y: -50 }, map)).toEqual({ x: 144, y: 0 });
  });

  it("always lands on a cell corner inside the map (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 159 }), fc.integer({ min: 0, max: 127 }), fc.integer({ min: -30, max: 30 }), fc.integer({ min: -30, max: 30 }), (x, y, dx, dy) => {
        const grab = { x: 4, y: 4 };
        const p = dragPosition({ x, y }, grab, { x: grab.x + dx, y: grab.y + dy }, map);
        if (dx === 0 && dy === 0) return p.x === x && p.y === y;
        return p.x % 16 === 0 && p.y % 16 === 0 && p.x >= 0 && p.y >= 0 && p.x < 160 && p.y < 128;
      }),
    );
  });
});

describe("labels", () => {
  it("are hidden when cells are small or the screen is crowded", () => {
    expect(labelsVisible(LABEL_MIN_CELL_CSS_PX, 1)).toBe(true);
    expect(labelsVisible(LABEL_MIN_CELL_CSS_PX - 0.01, 1)).toBe(false);
    expect(labelsVisible(32, LABEL_MAX_ON_SCREEN)).toBe(true);
    expect(labelsVisible(32, LABEL_MAX_ON_SCREEN + 1)).toBe(false);
  });

  it("portals show their target level, others the type name", () => {
    const portal = ent("p", 0, 0, { typeId: PORTAL_TYPE_ID, fields: { targetLevel: "lvl-dungeon", targetPoint: null } });
    expect(entityLabel(portal, undefined, project)).toBe("→ Zindan");
    expect(entityLabel(ent("c", 0, 0), chest, project)).toBe("Sandık");
    expect(entityLabel(ent("c", 0, 0, { typeId: "gone" }), undefined, project)).toBe("gone");
  });
});

describe("entityLook", () => {
  it("built-in types use the fixed colours", () => {
    expect(entityLook(ent("s", 0, 0, { typeId: SPAWN_TYPE_ID }), undefined, project, colors)).toMatchObject({ color: colors.spawn, shape: "spawn", broken: false });
    const ok = ent("p", 0, 0, { typeId: PORTAL_TYPE_ID, fields: { targetLevel: "lvl-dungeon" } });
    expect(entityLook(ok, undefined, project, colors)).toMatchObject({ color: colors.portal, shape: "portal", broken: false, status: "ok" });
  });

  it("a portal whose target level is gone is red and broken", () => {
    const gone = ent("p", 0, 0, { typeId: PORTAL_TYPE_ID, fields: { targetLevel: "lvl-removed" } });
    expect(entityLook(gone, undefined, project, colors)).toMatchObject({ color: colors.danger, broken: true, status: "missingLevel", label: "→ ?" });
    const unset = ent("p", 0, 0, { typeId: PORTAL_TYPE_ID, fields: {} });
    expect(entityLook(unset, undefined, project, colors)).toMatchObject({ color: colors.portal, broken: false, status: "unset" });
  });

  it("custom types use their colour; unknown types are broken", () => {
    expect(entityLook(ent("c", 0, 0), chest, project, colors)).toMatchObject({ color: 0xc08040, shape: "box", broken: false });
    expect(entityLook(ent("c", 0, 0, { typeId: "gone" }), undefined, project, colors)).toMatchObject({ color: colors.danger, broken: true });
  });

  it("parseHexColor falls back on bad input", () => {
    expect(parseHexColor("#00FF7f", 1)).toBe(0x00ff7f);
    expect(parseHexColor("red", 5)).toBe(5);
    expect(parseHexColor(undefined, 5)).toBe(5);
  });
});

describe("entityLabel name resolver", () => {
  it("uses the given display name for types", () => {
    expect(entityLabel(ent("s", 0, 0, { typeId: SPAWN_TYPE_ID }), { id: "spawn", name: "Spawn", color: "#000000", fields: [] }, project, () => "Başlangıç")).toBe("Başlangıç");
  });
});
