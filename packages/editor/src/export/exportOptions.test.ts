import type { FileData } from "../io/fileData";
import { exportLayerSummaries, type ExportWarning } from "@smap/core";
import { describe, expect, it } from "vitest";

import { MemoryFileSystem } from "../io/memoryFs";
import { tmjExportFiles, unityExportFiles, writeExportFiles } from "./exportFiles";
import {
  canExport,
  exportChecks,
  levelKey,
  outputSubfolder,
  selectedLayerIds,
  toggleExcluded,
  unityGameOptions,
  type CheckInput,
} from "./exportOptions";
import { defaultExportSettings } from "./exportSettings";
import { BYTES, sampleStore } from "./testDoc";

const bytes = (id: string) => BYTES[id];
const decode = (data: FileData) => { if (typeof data === "function") throw new Error("expected materialized bytes"); return typeof data === "string" ? data : new TextDecoder().decode(data); };

describe("layer selection", () => {
  it("exports every layer not excluded; a new layer is in by default", () => {
    const { store, ground, deco, hidden } = sampleStore();
    const summaries = exportLayerSummaries(store.document);
    expect(summaries.map((s) => s.tiles)).toEqual([2, 3, 1]);
    expect(selectedLayerIds(summaries, [])).toEqual([ground, deco, hidden]);
    expect(selectedLayerIds(summaries, [deco])).toEqual([ground, hidden]);
    expect(selectedLayerIds(summaries, [deco], false)).toEqual([]);
  });

  it("toggles exclusions into a sorted list", () => {
    expect(toggleExcluded([], "b", false)).toEqual(["b"]);
    expect(toggleExcluded(["b"], "a", false)).toEqual(["a", "b"]);
    expect(toggleExcluded(["a", "b"], "a", true)).toEqual(["b"]);
    expect(toggleExcluded([], "a", true)).toEqual([]);
  });

  it("keys levels by id, else by path", () => {
    expect(levelKey({ levelId: "l1", levelPath: "levels/a.json" })).toBe("l1");
    expect(levelKey({ levelPath: "levels/a.json" })).toBe("levels/a.json");
  });
});

describe("output subfolder", () => {
  it("is empty or one portable folder name", () => {
    expect(outputSubfolder("")).toBe("");
    expect(outputSubfolder("   ")).toBe("");
    expect(outputSubfolder(" Village_Main ")).toBe("Village_Main");
    expect(outputSubfolder("a/b:c")).toBe("a_b_c");
    expect(outputSubfolder("CON")).toBe("CON_");
  });
});

describe("Unity export with options", () => {
  it("honours layers, collision, subfolder and copyTextures", async () => {
    const { store, deco } = sampleStore();
    const settings = { ...defaultExportSettings("p"), unityCollision: false };
    const set = unityExportFiles(store.document, "main", bytes, {
      ...unityGameOptions(settings, [deco]),
      subfolder: "Village",
    });
    // Only deco's tileset (grass2); alone in the export it keeps its basename "grass.png".
    expect(set.files.map((f) => f.path)).toEqual(["Village/grass.png", "Village/main.smapmap"]);
    const map = JSON.parse(decode(set.files[1]!.data)) as { layers: { id: string }[]; collision: { solid: number[] } };
    expect(map.layers.map((l) => l.id)).toEqual([deco]);
    expect(map.collision.solid).toEqual([12]);
    const folder = new MemoryFileSystem("Maps");
    await writeExportFiles(folder, set.files);
    expect(await folder.readText("Village/main.smapmap")).toBe(decode(set.files[1]!.data));

    const noTextures = unityExportFiles(store.document, "main", () => undefined, { copyTextures: false });
    expect(noTextures.files.map((f) => f.path)).toEqual(["main.smapmap"]);
    expect(noTextures.missingImages).toEqual([]);
  });

  it("TMJ honours the layer selection", () => {
    const { store, ground } = sampleStore();
    const set = tmjExportFiles(store.document, "main", bytes, { layers: [ground] });
    const tmj = JSON.parse(decode(set.files.at(-1)!.data)) as { layers: { name: string }[] };
    expect(tmj.layers.map((l) => l.name)).toEqual(["Ground"]);
  });
});

describe("export checks", () => {
  const base: CheckInput = {
    target: "unity",
    selectedLayers: 2,
    collision: true,
    hasFolder: true,
    copyTextures: true,
    missingImages: [],
    warnings: [],
  };
  const states = (input: Partial<CheckInput>) => exportChecks({ ...base, ...input }).map((c) => `${c.id}:${c.state}`);

  it("Unity: textures, layers, destination — all ok", () => {
    expect(states({})).toEqual(["textures:ok", "layers:ok", "target:ok"]);
    expect(canExport(exportChecks(base))).toBe(true);
  });

  it("missing images and a missing folder warn but do not block", () => {
    const checks = exportChecks({ ...base, missingImages: ["tilesets/a.png"], hasFolder: false });
    expect(checks.map((c) => c.state)).toEqual(["warn", "ok", "warn"]);
    expect(checks[0]!.detail?.params).toEqual({ paths: "tilesets/a.png" });
    expect(canExport(checks)).toBe(true);
  });

  it("nothing to export blocks; collision alone is enough for Unity", () => {
    expect(states({ selectedLayers: 0, collision: false })).toContain("layers:error");
    expect(canExport(exportChecks({ ...base, selectedLayers: 0, collision: false }))).toBe(false);
    expect(states({ selectedLayers: 0, collision: true })).toContain("layers:ok");
    expect(states({ target: "png", selectedLayers: 0 })).toContain("layers:error");
  });

  it("out-of-range tile ids and missing tilesets show up as warnings", () => {
    const warnings: ExportWarning[] = [
      { code: "missingTilesets", tilesets: ["gone"], message: "" },
      { code: "tileIdsOutOfRange", tileset: "grass", tileIds: [99], message: "" },
    ];
    expect(states({ warnings })).toEqual(["textures:warn", "layers:warn", "target:ok"]);
  });

  it("shows only the rows that apply to the target", () => {
    expect(states({ target: "json" })).toEqual(["layers:ok"]);
    expect(states({ target: "png" })).toEqual(["textures:ok", "layers:ok"]);
    expect(states({ target: "tmj" })).toEqual(["textures:ok", "layers:ok", "target:ok"]);
    expect(states({ target: "zip" })).toEqual(["textures:ok"]);
    expect(states({ copyTextures: false })).toEqual(["layers:ok", "target:ok"]);
  });
});

it.each(["godot", "defold"] as const)("allows %s collision-only exports when tile layers are excluded", target => {
  expect(canExport(exportChecks({ target, selectedLayers: 0, collision: true, hasFolder: true, copyTextures: true, missingImages: [], warnings: [] }))).toBe(true);
  expect(canExport(exportChecks({ target, selectedLayers: 0, collision: false, hasFolder: true, copyTextures: true, missingImages: [], warnings: [] }))).toBe(false);
});
