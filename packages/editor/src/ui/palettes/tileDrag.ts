/**
 * Dragging tiles into a palette (pointer based, so it shares the pointer
 * capture of the grid it starts in). A drag starts by pressing on the
 * selected tiles of a tileset / palette and moving; while the pointer is
 * over a palette grid (`data-palette-grid`) or a palette chip / list entry
 * (`data-palette-drop`) the tiles would land there; releasing elsewhere is
 * an ordinary selection gesture.
 */
import type { Cell } from "../tileset/selectionModel";
import { dropTiles } from "./paletteActions";
import type { DragSource, PaletteItem } from "./paletteModel";
import { usePaletteStore, type TileDrag } from "./paletteStore";

/** Pointer travel (px) before a press on the selection becomes a drag. */
export const DRAG_THRESHOLD = 4;

/** The palette drop target under (`x`, `y`), or null. A grid gives the slot under the pointer (top-left of the dragged block). */
export function paletteTargetAt(x: number, y: number): TileDrag["target"] {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof Element)) return null;
  const grid = el.closest<HTMLElement>("[data-palette-grid]");
  if (grid) {
    const id = grid.getAttribute("data-palette-grid")!;
    const cellW = Number(grid.getAttribute("data-cell-w"));
    const cellH = Number(grid.getAttribute("data-cell-h"));
    const columns = Number(grid.getAttribute("data-columns"));
    if (!(cellW > 0 && cellH > 0 && columns > 0)) return { paletteId: id, slot: null };
    const r = grid.getBoundingClientRect();
    const col = Math.floor((x - r.left) / cellW);
    const row = Math.floor((y - r.top) / cellH);
    if (col < 0 || row < 0 || col >= columns) return null;
    return { paletteId: id, slot: { col, row } };
  }
  const chip = el.closest<HTMLElement>("[data-palette-drop]");
  if (chip) return { paletteId: chip.getAttribute("data-palette-drop")!, slot: null };
  return null;
}

/** A press that may become a drag of `items` (from `source`) once the pointer travels. */
export class PendingTileDrag {
  readonly #startX: number;
  readonly #startY: number;
  #active = false;

  constructor(
    readonly source: DragSource,
    readonly items: readonly PaletteItem[],
    /** Offset of the pressed cell inside the dragged block (so the block lands under the pointer as it was grabbed). */
    readonly grab: Cell,
    x: number,
    y: number,
  ) {
    this.#startX = x;
    this.#startY = y;
  }

  get active(): boolean {
    return this.#active;
  }

  /** Pointer moved. Returns true while it is a drag over a palette (the caller then shows no selection preview). */
  move(x: number, y: number, shift: boolean): boolean {
    if (!this.#active && Math.hypot(x - this.#startX, y - this.#startY) < DRAG_THRESHOLD) return false;
    this.#active = true;
    let target = paletteTargetAt(x, y);
    if (target?.slot) target = { ...target, slot: { col: Math.max(0, target.slot.col - this.grab.col), row: Math.max(0, target.slot.row - this.grab.row) } };
    // Over the palette it started in, with the same slot under the pointer: not a drop yet.
    usePaletteStore.getState().setDrag({ source: this.source, items: this.items, x, y, move: shift, target });
    return target !== null;
  }

  /** Released: drops when over a palette. Returns true when it dropped (the caller then keeps its selection as it was). */
  finish(shift: boolean): boolean {
    const drag = usePaletteStore.getState().drag;
    usePaletteStore.getState().setDrag(null);
    if (!this.#active || !drag?.target) return false;
    dropTiles(drag.target.paletteId, this.items, drag.target.slot, this.source, shift);
    return true;
  }

  cancel(): void {
    if (usePaletteStore.getState().drag) usePaletteStore.getState().setDrag(null);
  }
}
