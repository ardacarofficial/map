/**
 * UI state of the "Stamp'ler" library tab (round 5): filters, the selected
 * card (shown in the Denetçi), card size and grid / list view. UI only:
 * nothing here is saved with the project. Card size and view are a
 * per-viewer convenience kept in localStorage (missing storage is fine).
 */
import { create } from "zustand";

import { NO_FILTER, type StampFilter } from "./stampFilters";

export type StampView = "grid" | "list";

/** Card width bounds (CSS px) of the size slider. */
export const CARD_MIN = 88;
export const CARD_MAX = 220;
const CARD_DEFAULT = 124;

const SIZE_KEY = "smap.stamps.cardSize";
const VIEW_KEY = "smap.stamps.view";

function readNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v >= CARD_MIN && v <= CARD_MAX ? v : fallback;
  } catch {
    return fallback;
  }
}

function readView(): StampView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window): the choice lasts this session only.
  }
}

/** Which inspector field to focus next ("Kategori…" / "Etiketler…" in the card menu). */
export type StampFocusField = "category" | "tags" | "nineSlice" | null;

export interface StampLibraryState {
  filter: StampFilter;
  /** Card selected in the library (its inspector section is shown), or null. */
  selectedId: string | null;
  cardSize: number;
  view: StampView;
  focusField: StampFocusField;
  /** Bumped with each focus request, so asking twice focuses twice. */
  focusTick: number;
  setFilter(patch: Partial<StampFilter>): void;
  select(id: string | null): void;
  setCardSize(px: number): void;
  setView(view: StampView): void;
  requestFocus(id: string, field: Exclude<StampFocusField, null>): void;
}

export const useStampLibrary = create<StampLibraryState>()((set) => ({
  filter: NO_FILTER,
  selectedId: null,
  cardSize: typeof localStorage === "undefined" ? CARD_DEFAULT : readNumber(SIZE_KEY, CARD_DEFAULT),
  view: typeof localStorage === "undefined" ? "grid" : readView(),
  focusField: null,
  focusTick: 0,
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  select: (selectedId) => set((s) => (s.selectedId === selectedId ? s : { selectedId })),
  setCardSize: (px) => {
    const cardSize = Math.round(Math.min(CARD_MAX, Math.max(CARD_MIN, px)));
    write(SIZE_KEY, String(cardSize));
    set({ cardSize });
  },
  setView: (view) => {
    write(VIEW_KEY, view);
    set({ view });
  },
  requestFocus: (id, field) => set((s) => ({ selectedId: id, focusField: field, focusTick: s.focusTick + 1 })),
}));
