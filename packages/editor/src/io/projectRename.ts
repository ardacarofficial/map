/**
 * Project rename: the `project.rename` command (palette, File menu) and the
 * AppBar's inline editor share this state. The AppBar shows its rename
 * input while `editing` is true (double-click on the name also starts it)
 * and calls `renameProject(name)` from `io/session.ts` on Enter.
 */
import { create } from "zustand";

import { registerCommands, type Command } from "../commands/registry";
import { useEditorStore } from "../state/editorStore";

interface ProjectRenameState {
  /** The AppBar's project name is an input right now. */
  editing: boolean;
}

export const useProjectRename = create<ProjectRenameState>()(() => ({ editing: false }));

/** Turns the project name in the AppBar into an input (no-op without a project). */
export function startProjectRename(): void {
  if (!useEditorStore.getState().project) return;
  useProjectRename.setState({ editing: true });
}

/** Leaves the inline editor (after Enter, Escape or blur). */
export function endProjectRename(): void {
  useProjectRename.setState({ editing: false });
}

const COMMANDS: Command[] = [
  {
    id: "project.rename",
    title: "commands.project.rename",
    category: "file",
    enabled: () => useEditorStore.getState().project !== null,
    run: startProjectRename,
  },
];

let registered = false;

export function registerProjectCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands(COMMANDS);
  // Project closed: no name to edit.
  useEditorStore.subscribe((state) => {
    if (state.project === null && useProjectRename.getState().editing) endProjectRename();
  });
}
