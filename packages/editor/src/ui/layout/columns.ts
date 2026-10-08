/**
 * Widths of the two resizable side columns (library left, inspector/layers
 * right). Pure functions so clamping and persistence are testable without a
 * DOM; `useColumnWidth` wires them to React and localStorage.
 */

export type ColumnId = "library" | "right";

export interface ColumnSpec {
  /** localStorage key of the width the user dragged to. */
  key: string;
  min: number;
  max: number;
  /** Width before the user ever resized. */
  initial: number;
}

export const COLUMNS: Record<ColumnId, ColumnSpec> = {
  library: { key: "smap.layout.libraryWidth", min: 240, max: 520, initial: 288 },
  right: { key: "smap.layout.rightWidth", min: 260, max: 440, initial: 288 },
};

/** The canvas never gets narrower than this (CLAUDE.md: zoom/pan stay comfortable at 1366×768). */
export const MIN_CANVAS = 400;
/** Width of the tool rail (keep in sync with `--spacing-rail`). */
export const RAIL_WIDTH = 44;

/** localStorage key of the library's collapsed flag. */
export const LIBRARY_COLLAPSED_KEY = "smap.layout.libraryCollapsed";

/** `value` rounded and kept inside the column's min/max (NaN → initial). */
export function clampWidth(spec: ColumnSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.initial;
  return Math.min(spec.max, Math.max(spec.min, Math.round(value)));
}

/** Minimal storage interface (localStorage, or a fake in tests). */
export interface WidthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored width, clamped; the initial width when nothing (valid) is stored or storage throws. */
export function readWidth(spec: ColumnSpec, storage: WidthStorage | null): number {
  try {
    const raw = storage?.getItem(spec.key);
    if (raw == null || raw.trim() === "") return spec.initial;
    const value = Number(raw);
    return Number.isFinite(value) ? clampWidth(spec, value) : spec.initial;
  } catch {
    return spec.initial;
  }
}

/** Stores the clamped width (ignores storage errors: private mode just forgets). */
export function writeWidth(spec: ColumnSpec, storage: WidthStorage | null, value: number): void {
  try {
    storage?.setItem(spec.key, String(clampWidth(spec, value)));
  } catch {
    // Private mode / blocked storage: the width is simply not remembered.
  }
}

export function readFlag(key: string, storage: WidthStorage | null): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(key: string, storage: WidthStorage | null, value: boolean): void {
  try {
    storage?.setItem(key, value ? "1" : "0");
  } catch {
    // See writeWidth.
  }
}

/**
 * Widths that actually fit the window: when rail + columns + MIN_CANVAS do
 * not fit, the columns give way (the wider one first, never below their
 * min). The canvas may still end up narrower than MIN_CANVAS on a tiny
 * window, but no column is squeezed below its usable size.
 */
export function fitColumns(
  viewport: number,
  wanted: { library: number; right: number },
  visible: { library: boolean; right: boolean } = { library: true, right: true },
): { library: number; right: number } {
  let library = visible.library ? clampWidth(COLUMNS.library, wanted.library) : 0;
  let right = visible.right ? clampWidth(COLUMNS.right, wanted.right) : 0;
  let excess = RAIL_WIDTH + library + right + MIN_CANVAS - viewport;
  if (excess <= 0) return { library, right };
  // Take from the column with the most room above its minimum first.
  const roomL = visible.library ? library - COLUMNS.library.min : 0;
  const roomR = visible.right ? right - COLUMNS.right.min : 0;
  const takeFirst = roomL >= roomR ? "library" : "right";
  for (const id of takeFirst === "library" ? (["library", "right"] as const) : (["right", "library"] as const)) {
    if (excess <= 0) break;
    const room = id === "library" ? roomL : roomR;
    const take = Math.min(room, excess);
    if (id === "library") library -= take;
    else right -= take;
    excess -= take;
  }
  return { library, right };
}
