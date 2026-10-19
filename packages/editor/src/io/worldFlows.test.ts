import { DEFAULT_PROJECT_SETTINGS, normalizeProjectSettings } from "@smap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLevel, renameLevel } from "../commands/levelActions";
import { activeSource, previewFiles, sourceLevelName } from "../export/exportActions";
import { defaultExportSettings } from "../export/exportSettings";
import { browserPlatform, setPlatform } from "../platform";
import { useEditorStore } from "../state/editorStore";
import { MemoryFileSystem } from "./memoryFs";
import { loadProject } from "./projectIo";
import { useProjectLibrary } from "./projectLibrary";
import { autosaveNow, closeProject, getLevelWorkspace, newProject, renameProject } from "./session";

const addRecent = vi.fn(async () => {});
beforeEach(() => setPlatform({ ...browserPlatform, watchProject: () => {}, recents: { ...browserPlatform.recents, add: addRecent, list: async () => [] } }));
afterEach(() => { closeProject(); setPlatform(browserPlatform); vi.clearAllMocks(); });
const fresh = (extra = {}) => newProject({ name: "Ada", width: 8, height: 6, tileSize: 16, ...extra });

describe("one world with its maps", () => {
  it("names the first map independently and persists both names with stable ids and paths", async () => {
    const fs = new MemoryFileSystem();
    await newProject({ name: "Ada", firstMapName: "  Liman  ", width: 8, height: 6, tileSize: 16, folder: { fs, ref: "ada", label: "Ada" } });
    const ws = getLevelWorkspace()!;
    expect(ws.activeLevel.name).toBe("Liman");
    const { id, path } = ws.activeLevel;
    renameProject("Takımadalar");
    renameLevel(id, "Eski liman");
    await autosaveNow();
    const loaded = await loadProject(fs, async () => { throw new Error("no tilesets expected"); });
    expect(loaded.name).toBe("Takımadalar");
    expect(loaded.levels[0]).toMatchObject({ id, path, name: "Eski liman" });
    // Renames must reach recent cards even during the thumbnail refresh throttle.
    expect(addRecent).toHaveBeenLastCalledWith(expect.anything(), "Takımadalar");
  });

  it("adds a map with shared tilesets/stamps and world defaults, then starts an isolated world", async () => {
    const settings = normalizeProjectSettings({ tileWidth: 16, tileHeight: 24, newLevel: { width: 10, height: 5 }, layerTemplate: [{ name: "Su", kind: "tile" }, { name: "Engel", kind: "collision" }] });
    await fresh({ settings });
    const first = useEditorStore.getState().project!;
    first.store.dispatch({ type: "addTileset", tileset: { id: "sea", name: "Sea", imagePath: "tilesets/sea.png", tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0, columns: 1, rows: 1 } });
    const stamp = { id: "boat", name: "Boat", width: 1, height: 1, palette: [{ tilesetId: "sea", tileId: 0 }], layers: [{ layerId: "source", name: "Su", cells: Uint32Array.of(1) }] };
    useProjectLibrary.getState().addStamp(stamp);
    expect(await createLevel({ name: "Koy", width: 10, height: 5, tileSize: 16 })).toBe(true);
    const second = useEditorStore.getState().project!;
    expect(second.name).toBe("Ada");
    expect(getLevelWorkspace()!.levels).toHaveLength(2);
    expect(second.store.document.tilesets).toEqual(first.store.document.tilesets);
    expect(useProjectLibrary.getState().stamps).toEqual([stamp]);
    expect(second.store.document.map).toMatchObject({ width: 10, height: 5, tileWidth: 16, tileHeight: 24 });
    expect(second.store.document.layers.map(l => l.name)).toEqual(["Su", "Engel"]);
    expect(second.store.canUndo).toBe(false);
    await fresh({ name: "Başka dünya" });
    expect(getLevelWorkspace()!.levels).toHaveLength(1);
    expect(useProjectLibrary.getState().stamps).toEqual([]);
    expect(useProjectLibrary.getState().settings).toEqual(DEFAULT_PROJECT_SETTINGS);
    expect(useEditorStore.getState().project!.store.document.tilesets).toEqual([]);
  });

  it("uses a renamed map's display name for export while preserving its source path", async () => {
    await fresh();
    const ws = getLevelWorkspace()!;
    renameLevel(ws.activeId, "Liman");
    const source = activeSource(useEditorStore.getState().project!);
    expect(sourceLevelName(source)).toBe("Liman");
    expect(previewFiles("unity", source, defaultExportSettings("Ada")).mapFile).toBe("Liman.smapmap");
    expect(source.levelPath).toBe("levels/main.json");
    const queued = { ...source, levelName: "Liman" };
    await fresh({ name: "Başka dünya" });
    expect(sourceLevelName(queued)).toBe("Liman");
  });
});
