import { describe, expect, it } from "vitest";
import { EXPORT_TARGETS, prepareTarget } from "./targetRegistry";
import { defaultExportSettings, loadExportSettings, rememberSuccessfulExport } from "./exportSettings";
import { sampleStore, BYTES } from "./testDoc";
import { unityExportFiles, tmjExportFiles } from "./exportFiles";
import { godotFixture } from "../../../core/test/fixtures/godot/input";

describe("export registry", () => {
  it("has one ordered home for all seven targets", () => {
    expect(EXPORT_TARGETS.map(t => t.id)).toEqual(["unity", "tmj", "png", "json", "zip", "godot", "defold"]);
  });
  it.each(["unity", "tmj"] as const)("keeps %s output byte identical", async target => {
    const { store } = sampleStore();
    const input = { doc: store.document, levelName: "main", bytes: (id: string) => BYTES[id] };
    const plan = await prepareTarget(target, input, defaultExportSettings("registry"));
    const existing = target === "unity" ? unityExportFiles : tmjExportFiles;
    expect(plan.set).toEqual(existing(input.doc, "main", input.bytes));
  });
  it("surfaces engine preflight without producing writable files", async () => {
    const { store } = godotFixture();
    const plan = await prepareTarget("godot", { doc: store.document, levelName: "main", bytes: () => undefined }, defaultExportSettings("missing"));
    expect(plan.problems.map(p => p.key)).toContain("godotExport.missingImage");
    expect(plan.set).toBeNull();
  });
  it("freezes cells and generated PNG bytes before any async work", async () => {
    const { store, ground } = sampleStore();
    const input = { doc: store.document, levelName: "main", bytes: (id: string) => async () => {
      store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: 0 }] });
      return BYTES[id]!;
    } };
    const expected = unityExportFiles(store.document, "main", id => BYTES[id]);
    const plan = await prepareTarget("unity", input, defaultExportSettings("snapshot"));
    expect(plan.set).toEqual(expected);
  });
  it("remembers target/options only after success", async () => {
    const project = "success-memory";
    const draft = { ...defaultExportSettings(project), pngScale: 2 as const, targetOptions: { godot: { resourceRoot: "maps" } } };
    await rememberSuccessfulExport(project, "godot", draft, false);
    expect((await loadExportSettings(project)).target).toBe("unity");
    expect((await loadExportSettings(project)).pngScale).toBe(1);
    await rememberSuccessfulExport(project, "godot", draft, true);
    expect((await loadExportSettings(project)).target).toBe("godot");
    expect((await loadExportSettings(project)).targetOptions.godot).toEqual({ resourceRoot: "maps" });
  });
});

it.each(["unity", "json"] as const)("does not encode textures for a %s export that writes no images", async target => {
  const { store } = sampleStore();
  const input = { doc: store.document, levelName: "main", bytes: () => async (): Promise<Uint8Array> => { throw new Error("not needed"); } };
  const result = await prepareTarget(target, input, { ...defaultExportSettings("no-images"), copyTextures: false });
  expect(result.problems).toEqual([]);
  expect(result.set?.files).toHaveLength(1);
});
