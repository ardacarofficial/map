/**
 * Palette UI state that outlives a mount: which palette the dock shows
 * ("Tek"), the slot selection made in a palette, the tile drag in flight
 * (tileset / palette → palette), and the tile clipboard (Ctrl+C in the
 * tileset or a palette, Ctrl+V in a palette).
 */
import type { TileClip } from "@smap/core";
import { create } from "zustand";

import type { Cell } from "../tileset/selectionModel";
import type { DragSource, PaletteItem } from "./paletteModel";

/** Slots selected in one palette (reading-order indices); `clip` is the brush they made (null = a single plain tile). */
export interface PaletteSelection {
  readonly paletteId: string;
  readonly ids: readonly number[];
  readonly anchor: Cell;
  readonly focus: Cell;
  readonly clip: TileClip | null;
}

/** A tile drag in flight. */
export interface TileDrag {
  readonly source: DragSource;
  readonly items: readonly PaletteItem[];
  /** Pointer position (client px), for the ghost. */
  readonly x: number;
  readonly y: number;
  /** Shift held: move instead of copy. */
  readonly move: boolean;
  /** Where it would land now: a palette slot, a palette chip (append), or nowhere. */
  readonly target: { readonly paletteId: string; readonly slot: Cell | null } | null;
}

interface PaletteState {
  /** Palette shown in the dock instead of a tileset (null = the active tileset). */
  activePaletteId: string | null;
  selection: PaletteSelection | null;
  drag: TileDrag | null;
  /** Tiles copied with Ctrl+C in the tileset / a palette (layout kept). */
  clipboard: readonly PaletteItem[] | null;
  setActivePalette(id: string | null): void;
  setSelection(selection: PaletteSelection | null): void;
  setDrag(drag: TileDrag | null): void;
  setClipboard(items: readonly PaletteItem[] | null): void;
}

export const usePaletteStore = create<PaletteState>()((set) => ({
  activePaletteId: null,
  selection: null,
  drag: null,
  clipboard: null,
  setActivePalette: (activePaletteId) => set({ activePaletteId }),
  setSelection: (selection) => set({ selection }),
  setDrag: (drag) => set({ drag }),
  setClipboard: (clipboard) => set({ clipboard }),
}));
