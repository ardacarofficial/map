import { create } from "zustand";
import { wantedTilesetBodyHeight } from "./contentHeight";
import { useDockStore } from "../dockStore";

/** Compatibility view of the bottom zone; no independent collapse authority. */
export const useDockContent = create<{
  wanted: number;
  collapsed: boolean;
  setWanted(px: number): void;
  setCollapsed(value: boolean): void;
}>()((set) => ({
  wanted: wantedTilesetBodyHeight([]),
  collapsed: useDockStore.getState().layout.zones.bottom.state === "collapsed",
  setWanted: wanted => set({ wanted }),
  setCollapsed: value => useDockStore.getState().setZoneState("bottom", value ? "collapsed" : "expanded"),
}));
useDockStore.subscribe(s => useDockContent.setState({ collapsed: s.layout.zones.bottom.state === "collapsed" }));
