import { describe, expect, it, vi } from "vitest";

import type { ProjectFileSystem } from "../io/fs";
import { MemoryFileSystem } from "../io/memoryFs";
import { AutoExporter, type AutoExportResult, type SavedProject } from "./autoExport";
import { unityExportFiles } from "./exportFiles";
import { BYTES, sampleStore } from "./testDoc";

const bytes = (id: string) => BYTES[id];

function setup(options: { enabled?: boolean; folder?: MemoryFileSystem | null } = {}) {
  const { store, ground } = sampleStore();
  const folder = options.folder === undefined ? new MemoryFileSystem("Maps") : options.folder;
  const settings = { enabled: options.enabled ?? true };
  const exported: AutoExportResult[] = [];
  const errors: unknown[] = [];
  const target = vi.fn(async (): Promise<ProjectFileSystem | null> => (settings.enabled ? folder : null));
  const exporter = new AutoExporter({
    target,
    files: (p) => unityExportFiles(p.document, p.levelName, bytes),
    onExported: (r) => exported.push(r),
    onError: (e) => errors.push(e),
    now: () => new Date(2026, 9, 7, 12, 4),
  });
  const saved = (manual = false): SavedProject => ({ name: "Dünya", document: store.document, levelName: "main", manual });
  return { store, ground, folder, settings, exported, errors, target, exporter, saved };
}

describe("AutoExporter (export to Unity on save)", () => {
  it("writes <level>.smapmap and the PNGs into the Unity folder after a save", async () => {
    const { exporter, folder, exported, saved } = setup();
    await exporter.onSaved(saved(true));
    expect(await folder!.list("")).toEqual(["grass-2.png", "grass.png", "main.smapmap"]);
    const map = JSON.parse(await folder!.readText("main.smapmap")) as { smapExport: number };
    expect(map.smapExport).toBe(1);
    expect(exported).toHaveLength(1);
    expect(exported[0]!.project.manual).toBe(true);
    expect(exported[0]!.at.getHours()).toBe(12);
  });

  it("does nothing while the switch is off or no folder is set", async () => {
    const off = setup({ enabled: false });
    await off.exporter.onSaved(off.saved());
    expect(off.folder!.files.size).toBe(0);
    expect(off.exported).toHaveLength(0);

    const noFolder = setup({ folder: null });
    await noFolder.exporter.onSaved(noFolder.saved());
    expect(noFolder.exported).toHaveLength(0);
    expect(noFolder.errors).toHaveLength(0);
  });

  it("re-exports on every save (autosave too), rewriting only what changed", async () => {
    const { exporter, folder, exported, saved, store, ground } = setup();
    await exporter.onSaved(saved());
    const before = await folder!.readText("main.smapmap");
    store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 0, y: 0, cell: 0 }] });
    await exporter.onSaved(saved());
    expect(await folder!.readText("main.smapmap")).not.toBe(before);
    expect(exported[1]!.write.written).toEqual(["main.smapmap"]);
  });

  it("never overlaps exports: saves during an export queue one more export of the newest state", async () => {
    const { exporter, target, exported, saved } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const folder = new MemoryFileSystem("slow");
    target.mockImplementationOnce(async () => {
      await gate;
      return folder;
    });
    const first = exporter.onSaved(saved());
    void exporter.onSaved(saved(true));
    void exporter.onSaved(saved());
    release();
    await first;
    await exporter.idle();
    expect(target).toHaveBeenCalledTimes(2);
    expect(exported).toHaveLength(2);
    // The queued run keeps the manual flag of the coalesced Ctrl+S.
    expect(exported[1]!.project.manual).toBe(true);
  });

  it("exports every level of one save (v1.0), each once, even while an export runs", async () => {
    const { exporter, target, exported, saved } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const folder = new MemoryFileSystem("slow");
    target.mockImplementationOnce(async () => {
      await gate;
      return folder;
    });
    const first = exporter.onSaved(saved());
    void exporter.onSaved({ ...saved(), levelName: "zindan" });
    void exporter.onSaved({ ...saved(), levelName: "orman" });
    void exporter.onSaved({ ...saved(true), levelName: "zindan" });
    release();
    await first;
    await exporter.idle();
    expect(exported.map((r) => r.project.levelName)).toEqual(["main", "zindan", "orman"]);
    expect(exported[1]!.project.manual).toBe(true);
    expect(exported[2]!.write.written).toEqual(["orman.smapmap"]);
  });

  it("reports write errors and keeps working afterwards", async () => {
    const { exporter, target, errors, exported, saved } = setup();
    const broken = new MemoryFileSystem("broken");
    broken.writeBytes = async () => {
      throw new Error("disk full");
    };
    target.mockResolvedValueOnce(broken);
    await exporter.onSaved(saved());
    expect(errors).toHaveLength(1);
    await exporter.onSaved(saved());
    expect(exported).toHaveLength(1);
  });
});
