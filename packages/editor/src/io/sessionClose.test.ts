import { beforeEach, describe, expect, it } from "vitest";

import { browserPlatform, setPlatform, type Platform } from "../platform";
import { useEditorStore } from "../state/editorStore";
import { useConfirmStore, type UnsavedChoice } from "../ui/dialogs/confirmStore";
import { createProjectDocument, renameProject, requestWindowClose } from "./session";

let picked = 0;
const platform: Platform = {
  ...browserPlatform,
  async pickProjectFolder() {
    picked++;
    return null; // the user cancels the folder dialog
  },
};

/** Answers the open "save changes?" dialog once it appears. */
async function answer(choice: UnsavedChoice): Promise<void> {
  for (let i = 0; i < 20 && !useConfirmStore.getState().request; i++) await Promise.resolve();
  const request = useConfirmStore.getState().request;
  if (!request) throw new Error("no unsaved dialog");
  request.resolve(choice);
}

beforeEach(() => {
  setPlatform(platform);
  picked = 0;
  useConfirmStore.setState({ request: null });
  useEditorStore.getState().setProject(createProjectDocument({ name: "Dünyam", width: 8, height: 8, tileSize: 16 }));
});

describe("closing the window", () => {
  it("closes at once without unsaved work", async () => {
    expect(await requestWindowClose()).toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it("asks with unsaved work: Vazgeç keeps the window, Kaydetme closes", async () => {
    useEditorStore.getState().setDirty(true);
    const cancelled = requestWindowClose();
    await answer("cancel");
    expect(await cancelled).toBe(false);

    const discarded = requestWindowClose();
    await answer("discard");
    expect(await discarded).toBe(true);
  });

  it("Kaydet on a never-saved project asks for a folder and stays open when that is cancelled", async () => {
    useEditorStore.getState().setDirty(true);
    const saving = requestWindowClose();
    await answer("save");
    expect(await saving).toBe(false);
    expect(picked).toBe(1);
  });

  it("ignores a second close request while the question is open", async () => {
    useEditorStore.getState().setDirty(true);
    const first = requestWindowClose();
    expect(await requestWindowClose()).toBe(false);
    await answer("discard");
    expect(await first).toBe(true);
  });
});

describe("renameProject", () => {
  it("renames in place, marks the project dirty and ignores blank or unchanged names", () => {
    const project = useEditorStore.getState().project!;
    expect(renameProject("  Yeni   dünya ")).toBe(true);
    expect(useEditorStore.getState().project).toBe(project); // same object: the canvas keeps its camera
    expect(project.name).toBe("Yeni dünya");
    expect(useEditorStore.getState().dirty).toBe(true);
    expect(renameProject("Yeni dünya")).toBe(false);
    expect(renameProject("   ")).toBe(false);
  });
});
