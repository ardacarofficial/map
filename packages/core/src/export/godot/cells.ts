/** Godot 4.3+ TileMapLayer bytes, pinned against the 4.5-stable engine. */
export interface GodotCell {
  readonly x: number;
  readonly y: number;
  readonly sourceId: number;
  readonly atlasX: number;
  readonly atlasY: number;
  /** Alternative 0…4095, plus transpose-before-mirrors bits 4096/8192/16384. */
  readonly alternative: number;
}

/** Signed positions and nonnegative signed-int16 ids. Never truncate/wrap invalid input. */
export function godotCellProblem(cell: GodotCell): boolean {
  return !([cell.x, cell.y].every(n => Number.isInteger(n) && n >= -32768 && n <= 32767)
    && [cell.sourceId, cell.atlasX, cell.atlasY].every(n => Number.isInteger(n) && n >= 0 && n <= 32767)
    && Number.isInteger(cell.alternative) && cell.alternative >= 0 && cell.alternative <= 32767);
}

/** Version 0 LE uint16, then six LE 16-bit words per occupied cell, sorted y/x. */
export function encodeGodotCells(cells: readonly GodotCell[]): Uint8Array {
  if (cells.some(godotCellProblem)) throw new RangeError("Godot TileMapLayer cell exceeds its int16 coordinates/ids or transform bits");
  if (!cells.length) return new Uint8Array();
  const bytes = new Uint8Array(2 + 12 * cells.length);
  const view = new DataView(bytes.buffer);
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    for (const [field, n] of [c.x, c.y, c.sourceId, c.atlasX, c.atlasY, c.alternative].entries()) view.setInt16(2 + 12 * i + field * 2, n, true);
  }
  return bytes;
}
