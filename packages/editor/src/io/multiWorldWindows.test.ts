import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserPlatform, setPlatform, type Platform } from "../platform";
import { editGate, getAgentWorldSessionId } from "../agent/editGate";
import { useEditorStore } from "../state/editorStore";
import { useUiStore } from "../ui/uiStore";
import { openNewProjectDialog } from "../ui/dialogs/NewProjectDialog";
import { MemoryFileSystem } from "./memoryFs";
import { useProjectLibrary } from "./projectLibrary";
import { loadProject } from "./projectIo";
import { autosaveNow, closeProject, getLevelWorkspace, getProjectFolder, newProject, openProjectFromPicker, openProjectPath, openRecentProject, registerUnsavedGuard, renameProject } from "./session";

const launch = vi.fn<NonNullable<Platform["openWorldWindow"]>>(async () => true);
beforeEach(() => {
  launch.mockReset().mockResolvedValue(true);
  setPlatform({ ...browserPlatform, kind: "desktop", watchProject() {}, openWorldWindow: launch,
    recents: { ...browserPlatform.recents, add: async () => {}, list: async () => [] } });
});
afterEach(() => { closeProject(); setPlatform(browserPlatform); useUiStore.getState().setNewProjectOpen(false); });

describe("independent world windows", () => {
  it("new/open/recent preserve unsaved work, history, library, active state and a pending AI admission", async () => {
    await newProject({ name: "Original", width: 4, height: 4, tileSize: 16 });
    const editor = useEditorStore.getState();
    const project = editor.project!;
    project.store.dispatch({ type: "addLayer", layer: { kind: "tile", name: "Unsaved layer" } });
    editor.setDirty(true);
    editor.setTool("select");
    editor.setRegion({ x: 1, y: 1, width: 2, height: 2 });
    const workspace = getLevelWorkspace();
    const library = useProjectLibrary.getState();
    const undo = project.store.canUndo;
    const worldId = getAgentWorldSessionId()!;
    const admission = editGate.acquireEdit(worldId);
    const settle = vi.fn(async () => false);
    const unregister = registerUnsavedGuard({ dirty: () => true, settle });
    try {
      openNewProjectDialog();
      await openProjectFromPicker();
      await openProjectPath("/other/project.smap");
      await openRecentProject({ key: "/recent/project.smap", name: "Recent", location: "/recent", openedAt: 1, exists: true });
      expect(launch.mock.calls.map(([request]) => request)).toEqual([
        { kind: "new" }, { kind: "picker" }, { kind: "path", path: "/other/project.smap" }, { kind: "recent", path: "/recent/project.smap" },
      ]);
      expect(settle).not.toHaveBeenCalled();
      expect(useEditorStore.getState()).toMatchObject({ project, dirty: true, tool: "select", region: { x: 1, y: 1, width: 2, height: 2 } });
      expect(project.store.canUndo).toBe(undo);
      expect(getLevelWorkspace()).toBe(workspace);
      expect(useProjectLibrary.getState()).toBe(library);
      expect(getAgentWorldSessionId()).toBe(worldId);
      expect(editGate.blocked).toBe(true);
      admission.assertCurrent();
    } finally { unregister(); admission.release("cancelled"); }
  });

  it("cancelled or failed window launches leave the original world's save destination intact", async () => {
    const fs = new MemoryFileSystem();
    const folder = { fs, ref: "original", label: "Original" };
    await newProject({ name: "Original", width: 4, height: 4, tileSize: 16, folder });
    const project = useEditorStore.getState().project!;
    renameProject("Still original");
    launch.mockResolvedValueOnce(false);
    await openProjectFromPicker();
    launch.mockRejectedValueOnce(new Error("window unavailable"));
    expect(await openProjectPath("/other/project.smap")).toBe(false);
    expect(getProjectFolder()).toBe(folder);
    expect(useEditorStore.getState().project).toBe(project);
    await autosaveNow();
    expect((await loadProject(fs, async () => { throw new Error("no images"); })).name).toBe("Still original");
  });
});
