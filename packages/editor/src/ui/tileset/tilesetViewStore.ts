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

interface TilesetViewState {
  /** Tileset id → zoom (null or missing = fit to the panel width). */
  zoom: Readonly<Record<string, number | null>>;
  selection: PanelSelection | null;
  reveal: RevealRequest | null;
  setZoom(tilesetId: string, zoom: number | null): void;
  setSelection(selection: PanelSelection | null): void;
  requestReveal(tilesetId: string, ids: readonly number[]): void;
}

const ZOOM_KEY = "smap.tilesetZoom";

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

export const useTilesetView = create<TilesetViewState>()((set, get) => ({
  zoom: readZoom(),
  selection: null,
  reveal: null,
  setZoom: (tilesetId, zoom) => {
    const next = { ...get().zoom, [tilesetId]: zoom };
    set({ zoom: next });
    writeZoom(next);
  },
  setSelection: (selection) => set({ selection }),
  requestReveal: (tilesetId, ids) => set({ reveal: { tilesetId, ids: [...ids], nonce: ++nonce } }),
}));
