import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./memoryFs";
import { runSaveFailureMatrix, saveFixture, faultWrites, savedVisibleSnapshot } from "./saveRecovery.testHelper";
import { loadProject, saveProjectLevels } from "./projectIo";

describe.each([false, true])("recoverable multi-map saves (atlas growth: %s)", grow => {
  it("reopens one complete visible snapshot after failure before or after every write", async () => {
    const result = await runSaveFailureMatrix(async () => new MemoryFileSystem(), grow);
    expect(result.boundaries).toContain("project.smap");
    expect(result.boundaries).toContain("levels/a.json"); expect(result.boundaries).toContain("levels/b.json");
    expect(result.boundaries).toContain("tilesets/bank.recipe.json");
    expect(result.boundaries.some(p => p.endsWith(".png"))).toBe(true);
    expect(result.cases).toBe(result.boundaries.length * 2);
  });
});

it("recovery itself survives interruption at each replacement boundary", async () => {
  async function interrupted() {
    const fs = new MemoryFileSystem(), fixture = saveFixture(true);
    await saveProjectLevels(fs, fixture.input()); fixture.edit();
    const write = fs.writeText.bind(fs);
    fs.writeText = async (path, text) => { if (path === "levels/b.json") throw new Error("injected"); await write(path, text); };
    await expect(saveProjectLevels(fs, fixture.input())).rejects.toThrow("injected");
    fs.writeText = write;
    return fs;
  }
  const probe = await interrupted(), recorder = faultWrites(probe);
  await loadProject(recorder.fs, async () => ({ close() {} }) as ImageBitmap);
  const old = JSON.stringify(await savedVisibleSnapshot(probe));
  for (const after of [false, true]) for (let failAt = 0; failAt < recorder.paths.length; failAt++) {
    const fs = await interrupted();
    await expect(loadProject(faultWrites(fs, failAt, after).fs, async () => ({ close() {} }) as ImageBitmap)).rejects.toThrow("injected");
    expect(JSON.stringify(await savedVisibleSnapshot(fs))).toBe(old);
  }
});
