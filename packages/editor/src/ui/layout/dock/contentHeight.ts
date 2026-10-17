import type { Tileset } from "@smap/core";

import { naturalScale } from "../../tileset/zoomModel";

/** A document-wide default, independent of the active source, palette, view and zoom. */
export function wantedTilesetBodyHeight(tilesets: readonly Pick<Tileset, "rows" | "tileHeight">[]): number {
  const gridHeight = tilesets.length === 0 ? 8 * 32 : tilesets.reduce(
    (max, ts) => Math.max(max, Math.min(8, Math.max(0, ts.rows)) * ts.tileHeight * naturalScale(ts.tileHeight)), 0,
  );
  return 32 + 16 + Math.ceil(gridHeight);
}

export function contentDockHeight(wantedBody: number, viewportHeight: number): number {
  return Math.max(96, Math.min(28 + wantedBody, Math.round(viewportHeight * 0.4)));
}
