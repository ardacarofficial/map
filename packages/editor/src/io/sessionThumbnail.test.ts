import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { thumbnailSnapshots } from "../canvas/thumbnailSnapshotBridge";
import { browserPlatform, setPlatform, type ProjectLocation } from "../platform";
import { useEditorStore } from "../state/editorStore";
import { useUiStore } from "../ui/uiStore";
import { MemoryFileSystem } from "./memoryFs";
import { autosaveNow, closeProject, newProject, saveCurrentProject } from "./session";

const png = "data:image/png;base64,AAAA";
const add = vi.fn(async (_target: ProjectLocation, _name: string, _thumbnail?: string) => {});
const list = vi.fn(async () => []);
let target: ProjectLocation;
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  add.mockClear();
  list.mockClear();
  target = { fs: new MemoryFileSystem(), ref: "project-a", label: "A" };
  setPlatform({ ...browserPlatform, watchProject: () => {}, pickProjectFolder: async () => target, recents: { ...browserPlatform.recents, supported: true, add, list } });
  useUiStore.setState({ busy: false });
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {}, drawImage: () => {} }), toDataURL: () => png }),
  });
});
afterEach(() => {
  closeProject();
  dispose?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setPlatform(browserPlatform);
});

function publish(pending = false) {
  const project = useEditorStore.getState().project!;
  const state = { project, level: project.levelId ?? project.levelPath, revision: project.store.revision, version: 1, pending };
  const snapshot = vi.fn(() => ({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 128]) }));
  dispose = thumbnailSnapshots.register({ state: () => state, snapshot });
  return { state, snapshot };
}

async function fresh() {
  await newProject({ name: "A", width: 8, height: 8, tileSize: 16 });
}

describe("session recent thumbnails", () => {
  it("resolves save before snapshot/PNG, then refreshes recents with the ready picture", async () => {
    await fresh();
    const provider = publish();
    expect(await saveCurrentProject(false)).toBe(true);
    expect(provider.snapshot).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledExactlyOnceWith(target, "A");
    await vi.runAllTimersAsync();
    expect(provider.snapshot).toHaveBeenCalledOnce();
    expect(add).toHaveBeenLastCalledWith(target, "A", png);
    expect(list).toHaveBeenCalled();
  });

  it("initial folder save uses the normalized active project identity", async () => {
    await newProject({ name: "A", width: 8, height: 8, tileSize: 16, folder: target });
    publish();
    await vi.runAllTimersAsync();
    expect(add).toHaveBeenLastCalledWith(target, "A", png);
  });

  it("retains the previous picture when overview is pending and on close", async () => {
    await fresh();
    const provider = publish(true);
    await saveCurrentProject(false);
    await vi.runAllTimersAsync();
    expect(add).toHaveBeenCalledExactlyOnceWith(target, "A");
    closeProject();
    provider.state.pending = false;
    thumbnailSnapshots.changed();
    await vi.runAllTimersAsync();
    expect(provider.snapshot).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledOnce();
  });

  it("resumes a pending open/save capture after autosave even within the refresh throttle", async () => {
    await fresh();
    const provider = publish(true);
    await saveCurrentProject(false);
    const project = useEditorStore.getState().project!;
    project.store.dispatch({ type: "setLayerProps", layerId: project.store.document.layers[0]!.id, props: { name: "Changed" } });
    useEditorStore.getState().setDirty(true);
    provider.state.revision = project.store.revision;
    await autosaveNow();
    provider.state.pending = false;
    thumbnailSnapshots.changed();
    await vi.runAllTimersAsync();
    expect(provider.snapshot).toHaveBeenCalledOnce();
    expect(add).toHaveBeenLastCalledWith(target, "A", png);
  });

  it("a failed save cancels a previous pending capture and never updates the picture", async () => {
    await fresh();
    const provider = publish(true);
    await saveCurrentProject(false);
    add.mockClear();
    vi.spyOn(target.fs, "writeText").mockRejectedValue(new Error("disk full"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await saveCurrentProject(false)).toBe(false);
    provider.state.pending = false;
    thumbnailSnapshots.changed();
    await vi.runAllTimersAsync();
    expect(provider.snapshot).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
