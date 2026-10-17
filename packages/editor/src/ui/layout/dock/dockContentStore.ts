import { create } from "zustand";

const KEY = "smap.layout.dockCollapsed";
function readCollapsed(): boolean {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

export const useDockContent = create<{
  collapsed: boolean;
  setCollapsed(value: boolean): void;
}>()((set) => ({
  collapsed: readCollapsed(),
  setCollapsed: (collapsed) => {
    set({ collapsed });
    try { localStorage.setItem(KEY, String(collapsed)); } catch { /* Session preference only. */ }
  },
}));
