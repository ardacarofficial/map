import { createDocument, MapStore } from "@smap/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LevelWorkspace } from "../io/levelWorkspace";
import { useProjectLibrary } from "../io/projectLibrary";
import { defaultLevels } from "../io/projectIo";
import { useEditorStore } from "../state/editorStore";

const session = vi.hoisted(() => ({ ws: null as LevelWorkspace | null, published: [] as unknown[] }));

vi.mock("../io/session", () => ({
  describeError: (e: unknown) => String(e),
  getLevelWorkspace: () => session.ws,
  getProjectFolder: () => null,
  onProjectSaved: () => () => undefined,
  openLevel: () => Promise.resolve(true),
  publishLevelState: (options: { listChanged?: boolean } = {}) => {
    session.published.push(options);
    if (options.listChanged && session.ws) useProjectLibrary.getState().setLevels(session.ws.levels);
  },
}));

const { moveLevelOnWorld } = await import("./worldActions");

beforeEach(() => {
  const store = new MapStore(createDocument({ width: 8, height: 8 }));
  const levels = defaultLevels("levels/main.json");
  session.ws = new LevelWorkspace({ name: "P", levels, active: { id: levels[0]!.id, store, knownText: "{}" } });
  session.published = [];
  useProjectLibrary.getState().load({ stamps: [], levels: [...levels] });
  useEditorStore.getState().setProject({ name: "P", store, levelPath: "levels/main.json", levelId: levels[0]!.id });
  useEditorStore.getState().setDirty(false);
});

describe("moveLevelOnWorld (canvas onLevelMoved)", () => {
  it("applies the snapped position, publishes the list and marks the project dirty", () => {
    const id = session.ws!.activeId;
    expect(moveLevelOnWorld({ levelId: id, x: 64, y: 96 })).toBe(true);
    expect(session.ws!.level(id)!.world).toEqual({ x: 64, y: 96 });
    expect(session.published).toEqual([{ listChanged: true }]);
    expect(useProjectLibrary.getState().levels[0]!.world).toEqual({ x: 64, y: 96 });
    expect(useEditorStore.getState().dirty).toBe(true);
  });

  it("does nothing when the level is already there or unknown", () => {
    const id = session.ws!.activeId;
    const { x, y } = session.ws!.level(id)!.world;
    expect(moveLevelOnWorld({ levelId: id, x, y })).toBe(false);
    expect(moveLevelOnWorld({ levelId: "gone", x: 1, y: 1 })).toBe(false);
    expect(session.published).toEqual([]);
    expect(useEditorStore.getState().dirty).toBe(false);
  });
});
