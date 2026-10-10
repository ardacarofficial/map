/**
 * Tileset panel state that outlives the panel's mount (the library column
 * shows one tab at a time): per-tileset zoom, the multi-tile selection the
 * panel made (or that a map pick maps back to), and "scroll to these cells"
 * requests from map picks.
 *
 * The brush itself lives in the editor store (`selection` / `stamp`); this
 * store only remembers which tileset cells that brush came from.
 */
import type { TileClip } from "@smap/core";
import { create } from "zustand";

import type { Cell } from "./selectionModel";

/** Cells selected in one tileset; `clip` is the stamp they produced (null = a single tile). */
export interface PanelSelection {
  readonly tilesetId: string;
  /** Sorted tile ids. */
  readonly ids: readonly number[];
  /** Fixed corner for Shift + click / Shift + arrows. */
  readonly anchor: Cell;
  /** Moving corner (arrow keys). */
  readonly focus: Cell;
  /** The editor store `stamp` these cells made; the highlight shows only while it is still the brush. */
  readonly clip: TileClip | null;
}

export interface RevealRequest {
  readonly tilesetId: string;
  readonly ids: readonly number[];
  /** Changes on every request, so the same cells can be revealed twice. */
  readonly nonce: number;
}

/** "Tek": one tileset at a time; "Tümü": every tileset stacked in one scroll. */
export type LibraryView = "single" | "all";

interface TilesetViewState {
  /** Tileset id → zoom override (null or missing = the global zoom). */
  zoom: Readonly<Record<string, number | null>>;
  /** Zoom of every tileset without an override (null = fit to the panel width). */
  globalZoom: number | null;
  view: LibraryView;
  /** Collapsed group names ("" = the ungrouped bucket). */
  collapsed: readonly string[];
  /** Library search text (filters by name). */
  query: string;
  setGlobalZoom(zoom: number | null): void;
  setView(view: LibraryView): void;
  toggleCollapsed(group: string): void;
  setQuery(query: string): void;
  /** "Scroll the stack to this tileset" (goto, search Enter, jump chips). */
  jump: RevealRequest | null;
  requestJump(tilesetId: string): void;
  /** Changes when the library search field should take focus (`tileset.goto`). */
  searchFocus: number;
  requestSearchFocus(): void;
  selection: PanelSelection | null;
  reveal: RevealRequest | null;
  setZoom(tilesetId: string, zoom: number | null): void;
  setSelection(selection: PanelSelection | null): void;
  /** Element in the dock's tab strip where the tileset view puts its zoom controls (null = not mounted). */
  dockSlot: HTMLElement | null;
  setDockSlot(el: HTMLElement | null): void;
  requestReveal(tilesetId: string, ids: readonly number[]): void;
}

const ZOOM_KEY = "smap.tilesetZoom";
const PREFS_KEY = "smap.tilesetLibrary";

interface LibraryPrefs {
  globalZoom: number | null;
  view: LibraryView;
  collapsed: string[];
}

function readPrefs(): LibraryPrefs {
  const prefs: LibraryPrefs = { globalZoom: null, view: "single", collapsed: [] };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const v = (raw ? JSON.parse(raw) : null) as Partial<Record<keyof LibraryPrefs, unknown>> | null;
    if (!v || typeof v !== "object") return prefs;
    if (typeof v.globalZoom === "number" && Number.isFinite(v.globalZoom) && v.globalZoom > 0) prefs.globalZoom = v.globalZoom;
    if (v.view === "all" || v.view === "single") prefs.view = v.view;
    if (Array.isArray(v.collapsed)) prefs.collapsed = v.collapsed.filter((g): g is string => typeof g === "string");
  } catch {
    // Storage blocked or garbage: defaults.
  }
  return prefs;
}

function writePrefs(state: LibraryPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ globalZoom: state.globalZoom, view: state.view, collapsed: state.collapsed }));
  } catch {
    // Remembered for this session only.
  }
}

function readZoom(): Record<string, number | null> {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeZoom(zoom: Readonly<Record<string, number | null>>): void {
  try {
    const kept = Object.fromEntries(Object.entries(zoom).filter(([, v]) => v !== null));
    localStorage.setItem(ZOOM_KEY, JSON.stringify(kept));
  } catch {
    // Storage blocked: zoom is remembered for this session only.
  }
}

let nonce = 0;

const prefs = readPrefs();

export const useTilesetView = create<TilesetViewState>()((set, get) => ({
  zoom: readZoom(),
  globalZoom: prefs.globalZoom,
  view: prefs.view,
  collapsed: prefs.collapsed,
  query: "",
  selection: null,
  reveal: null,
  setGlobalZoom: (globalZoom) => {
    set({ globalZoom });
    writePrefs({ ...get(), collapsed: [...get().collapsed] });
  },
  setView: (view) => {
    set({ view });
    writePrefs({ ...get(), collapsed: [...get().collapsed] });
  },
  toggleCollapsed: (group) => {
    const have = get().collapsed;
    set({ collapsed: have.includes(group) ? have.filter((g) => g !== group) : [...have, group] });
    writePrefs({ ...get(), collapsed: [...get().collapsed] });
  },
  setQuery: (query) => set({ query }),
  jump: null,
  requestJump: (tilesetId) => set({ jump: { tilesetId, ids: [], nonce: ++nonce } }),
  searchFocus: 0,
  requestSearchFocus: () => set((s) => ({ searchFocus: s.searchFocus + 1 })),
  setZoom: (tilesetId, zoom) => {
    const next = { ...get().zoom, [tilesetId]: zoom };
    set({ zoom: next });
    writeZoom(next);
  },
  setSelection: (selection) => set({ selection }),
  dockSlot: null,
  setDockSlot: (dockSlot) => set({ dockSlot }),
  requestReveal: (tilesetId, ids) => set({ reveal: { tilesetId, ids: [...ids], nonce: ++nonce } }),
}));
