import { create } from "zustand";

import { wantedTilesetBodyHeight } from "./contentHeight";

const KEY = "smap.layout.dockCollapsed";
function readCollapsed(): boolean {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

export const useDockContent = create<{
  wanted: number;
  collapsed: boolean;
  setWanted(px: number): void;
  setCollapsed(value: boolean): void;
}>()((set) => ({
  wanted: wantedTilesetBodyHeight([]),
  collapsed: readCollapsed(),
  setWanted: (wanted) => set({ wanted }),
  setCollapsed: (collapsed) => {
    set({ collapsed });
    try { localStorage.setItem(KEY, String(collapsed)); } catch { /* Session preference only. */ }
  },
}));
