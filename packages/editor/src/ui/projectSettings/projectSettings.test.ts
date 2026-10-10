import { DEFAULT_PROJECT_SETTINGS, isEntityLayer, isGridLayer, isTileLayer, normalizeProjectSettings, PROJECT_FILE_NAME } from "@smap/core";
import { describe, expect, it } from "vitest";

import { LevelWorkspace } from "../../io/levelWorkspace";
import { MemoryFileSystem } from "../../io/memoryFs";
import { defaultLevels, loadProject } from "../../io/projectIo";
import { createProjectDocument } from "../../io/session";
import { isStorableThumbnail, mergeThumbnail, RECENT_THUMB_MAX_CHARS } from "../../platform/recentThumbnail";
import {
  cleanLayers,
  fitPreview,
  mapPresetOf,
  parseHexColor,
  PROJECT_TEMPLATES,
  projectTemplate,
  standardLayers,
  templateIdOf,
} from "./projectTemplates";


const fakeDecode = async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap;

describe("layer templates", () => {
  it("the standard template builds Zemin…Collision bottom to top with the right layer kinds", () => {
    const project = createProjectDocument({ name: "P", width: 8, height: 6, tileSize: 32, layers: standardLayers() });
    const layers = project.store.document.layers;
    expect(layers.map((l) => l.name)).toEqual(["Zemin", "Yollar", "Binalar", "Detaylar", "Collision"]);
    expect(layers.slice(0, 4).every(isTileLayer)).toBe(true);
    const collision = layers[4]!;
    expect(isGridLayer(collision) && collision.role).toBe("collision");
    // Building the document is not an undo step.
    expect(project.store.canUndo).toBe(false);
  });

  it("entity layers, cleaning and the default single layer", () => {
    const project = createProjectDocument({
      name: "P",
      width: 4,
      height: 4,
      tileSize: 16,
      layers: [
        { name: " Zemin ", kind: "tile" },
        { name: "", kind: "tile" },
        { name: "zemin", kind: "tile" },
        { name: "NPC", kind: "entity" },
      ],
    });
    const layers = project.store.document.layers;
    expect(layers.map((l) => l.name)).toEqual(["Zemin", "zemin 2", "NPC"]);
    expect(isEntityLayer(layers[2]!)).toBe(true);
    expect(cleanLayers([{ name: "  ", kind: "tile" }])).toEqual([{ name: "Zemin", kind: "tile" }]);
    expect(createProjectDocument({ name: "P", width: 4, height: 4, tileSize: 16 }).store.document.layers).toHaveLength(1);
  });

  it("recognises named templates and the welcome templates match the spec", () => {
    expect(templateIdOf(standardLayers())).toBe("standard");
    expect(templateIdOf([{ name: "Zemin", kind: "tile" }])).toBe("single");
    expect(templateIdOf([{ name: "Su", kind: "tile" }])).toBe("custom");
    expect(projectTemplate("topdown")).toMatchObject({ tileWidth: 32, width: 64, height: 48 });
    expect(projectTemplate("topdown").layers()).toHaveLength(5);
    expect(projectTemplate("dungeon")).toMatchObject({ tileWidth: 16, width: 40, height: 30 });
    expect(projectTemplate("empty").layers()).toHaveLength(1);
    expect(PROJECT_TEMPLATES.map((p) => p.id)).toEqual(["topdown", "dungeon", "empty"]);
  });

  it("presets, colours and the preview box", () => {
    expect(mapPresetOf(32, 24)).toBe("small");
    expect(mapPresetOf(128, 96)).toBe("large");
    expect(mapPresetOf(33, 24)).toBe("custom");
    expect(parseHexColor("#AABBCC")).toBe("#aabbcc");
    expect(parseHexColor("abc")).toBeNull();
    expect(fitPreview(2048, 1536, 232, 150)).toEqual({ width: 200, height: 150 });
  });
});

describe("project settings persistence", () => {
  it("round-trips through save and open (and default settings write no key)", async () => {
    const settings = normalizeProjectSettings({
      tileWidth: 16,
      tileHeight: 16,
      newLevel: { width: 40, height: 30 },
      layerTemplate: [
        { name: "Zemin", kind: "tile" },
        { name: "Collision", kind: "collision" },
      ],
      background: "#203040",
      unity: { folderHint: "Assets/Maps", exportOnSave: true },
    });
    const project = createProjectDocument({ name: "Zindan", width: 40, height: 30, tileSize: 16 });
    const ws = new LevelWorkspace({ name: "Zindan", levels: defaultLevels(project.levelPath), active: { id: project.levelId!, store: project.store, knownText: null } });
    const fs = new MemoryFileSystem();
    await ws.save(fs, { tilesetBytes: () => undefined, settings });
    expect(await fs.readText(PROJECT_FILE_NAME)).toContain('"settings"');
    const loaded = await loadProject(fs, fakeDecode);
    expect(loaded.settings).toEqual(settings);

    const plain = new MemoryFileSystem();
    await ws.save(plain, { tilesetBytes: () => undefined, settings: DEFAULT_PROJECT_SETTINGS });
    expect(await plain.readText(PROJECT_FILE_NAME)).not.toContain('"settings"');
    expect((await loadProject(plain, fakeDecode)).settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  it("new levels follow the project's layer template", () => {
    const project = createProjectDocument({ name: "P", width: 8, height: 8, tileSize: 16 });
    const ws = new LevelWorkspace({ name: "P", levels: defaultLevels(project.levelPath), active: { id: project.levelId!, store: project.store, knownText: null } });
    ws.add({
      name: "İkinci",
      width: 10,
      height: 5,
      tileSize: 16,
      layerName: "Zemin",
      layers: [{ name: "A" }, { type: "grid", role: "collision", name: "C" }],
    });
    const added = ws.levels.find((l) => l.name === "İkinci")!;
    expect(ws.entry(added.id)!.store.document.layers.map((l) => l.name)).toEqual(["A", "C"]);
  });
});

describe("recent thumbnails", () => {
  const png = "data:image/png;base64,AAAA";
  it("keeps the old picture unless a storable new one comes", () => {
    expect(mergeThumbnail(undefined, png)).toBe(png);
    expect(mergeThumbnail(png, undefined)).toBe(png);
    expect(mergeThumbnail(png, "data:image/png;base64,BBBB")).toBe("data:image/png;base64,BBBB");
    expect(mergeThumbnail(png, "javascript:alert(1)")).toBe(png);
    expect(mergeThumbnail(undefined, `data:image/png;base64,${"A".repeat(RECENT_THUMB_MAX_CHARS)}`)).toBeUndefined();
    expect(isStorableThumbnail("data:image/jpeg;base64,AA")).toBe(false);
  });
});
