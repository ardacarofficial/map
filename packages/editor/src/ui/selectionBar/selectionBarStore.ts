import { create } from "zustand";

import { registerCommands } from "../../commands/registry";
import { useEditorStore } from "../../state/editorStore";

const STORAGE_KEY = "smap.selectionBar";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Private window / blocked storage: the choice lasts for this session only.
  }
}

interface SelectionBarPrefs {
  /** Show the action bar next to a map selection (View menu toggle; remembered per browser). */
  enabled: boolean;
  toggle(): void;
}

export const useSelectionBarPrefs = create<SelectionBarPrefs>()((set, get) => ({
  enabled: readEnabled(),
  toggle: () => {
    const enabled = !get().enabled;
    set({ enabled });
    writeEnabled(enabled);
  },
}));

let registered = false;

/** `view.toggleSelectionBar` (View menu, palette). Idempotent. */
export function registerSelectionBarCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands([
    {
      id: "view.toggleSelectionBar",
      title: "commands.view.toggleSelectionBar",
      category: "view",
      enabled: () => useEditorStore.getState().project !== null,
      run: () => useSelectionBarPrefs.getState().toggle(),
    },
  ]);
}
