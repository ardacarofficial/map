/**
 * "Katı işaretle" drag in the tileset panel: the left button marks every
 * tile the pointer crosses solid, the right button unmarks them (`solid`). The whole drag is one undo step
 * (a store transaction), and every change shows up live.
 */
import { isTileSolid, lineCells, type MapStore } from "@smap/core";

export class SolidStroke {
  readonly store: MapStore;
  readonly tilesetId: string;
  /** State every crossed tile ends up in. */
  readonly solid: boolean;
  readonly #visited = new Set<number>();
  #last: { col: number; row: number };
  #open = true;

  /** Starts a stroke on tile (`col`, `row`) that sets tiles to `solid`; opens a transaction. */
  constructor(store: MapStore, tilesetId: string, col: number, row: number, solid: boolean) {
    const tileset = store.document.getTileset(tilesetId);
    if (!tileset) throw new Error(`unknown tileset ${tilesetId}`);
    this.store = store;
    this.tilesetId = tilesetId;
    this.solid = solid;
    this.#last = { col, row };
    store.beginTransaction();
    this.#apply([{ x: col, y: row }]);
  }

  /** Moves to tile (`col`, `row`), covering every tile on the way. */
  moveTo(col: number, row: number): void {
    if (!this.#open || (col === this.#last.col && row === this.#last.row)) return;
    const cells = lineCells(this.#last.col, this.#last.row, col, row);
    this.#last = { col, row };
    this.#apply(cells);
  }

  /** Ends the stroke: one undo step (nothing when no tile changed). */
  end(): void {
    if (!this.#open) return;
    this.#open = false;
    if (this.store.inTransaction) this.store.commit();
  }

  #apply(cells: readonly { x: number; y: number }[]): void {
    const tileset = this.store.document.getTileset(this.tilesetId);
    if (!tileset) return;
    const ids: number[] = [];
    for (const { x, y } of cells) {
      if (x < 0 || y < 0 || x >= tileset.columns || y >= tileset.rows) continue;
      const id = y * tileset.columns + x;
      if (this.#visited.has(id)) continue;
      this.#visited.add(id);
      if (isTileSolid(tileset, id) !== this.solid) ids.push(id);
    }
    if (ids.length > 0) this.store.dispatch({ type: "setTileSolid", tilesetId: this.tilesetId, tileIds: ids, solid: this.solid });
  }
}
