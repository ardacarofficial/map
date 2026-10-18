/**
 * Stamp editor documents (round 5). "Düzenle" opens a stamp as a temporary
 * map: an in-memory `MapStore` with one layer per stamp layer (same names
 * and grid roles), the stamp placed with a margin around it so it can grow.
 * "Kaydet" crops that map back to its content and replaces the stamp's
 * cells. The document never joins the project's level list, so it is not
 * saved, autosaved, exported or shown on the world map.
 *
 * Stamps stay flat copies (CLAUDE.md → Yapılmayacaklar): maps that already
 * hold a placed copy do not change when the stamp is saved.
 *
 * Pure (no React, no stores) so it runs in tests.
 */
import { copyRegion, createDocument, createStamp, isEntityLayer, MapStore, placeStamp, type CellRect, type MapDocument, type Stamp } from "@smap/core";

import { withProjectData } from "../../io/levelWorkspace";

/** Prefix of the `levelId` the editor store gets while a stamp is open (never a real level id: real ones have no ":"). */
export const STAMP_LEVEL_PREFIX = "stamp:";

export function stampLevelId(stampId: string): string {
  return `${STAMP_LEVEL_PREFIX}${stampId}`;
}

export function isStampLevelId(levelId: string | null | undefined): boolean {
  return typeof levelId === "string" && levelId.startsWith(STAMP_LEVEL_PREFIX);
}

/** Free cells around the stamp on each side, and the smallest editing map. */
export const STAMP_EDIT_MARGIN = 4;
export const STAMP_EDIT_MIN = { width: 16, height: 12 } as const;

/** Size of the editing map and where the stamp's top-left corner goes (centered). */
export function stampEditLayout(stamp: Pick<Stamp, "width" | "height">): { width: number; height: number; x: number; y: number } {
  const width = Math.max(stamp.width + 2 * STAMP_EDIT_MARGIN, STAMP_EDIT_MIN.width);
  const height = Math.max(stamp.height + 2 * STAMP_EDIT_MARGIN, STAMP_EDIT_MIN.height);
  return { width, height, x: Math.floor((width - stamp.width) / 2), y: Math.floor((height - stamp.height) / 2) };
}

/** Tileset ids a stamp uses that `doc` does not have (such a stamp cannot be opened or placed). */
export function missingStampTilesets(stamp: Stamp, doc: MapDocument): string[] {
  return [...new Set(stamp.palette.map((e) => e.tilesetId))].filter((id) => !doc.getTileset(id)).sort();
}

export function stampEditStore(stamp: Stamp, source: MapDocument): MapStore {
  const missing = missingStampTilesets(stamp, source);
  if (missing.length > 0) throw new Error(`stamp ${stamp.id} uses missing tilesets: ${missing.join(", ")}`);
  const layout = stampEditLayout(stamp);
  const base = createDocument({ width: layout.width, height: layout.height, tileWidth: source.map.tileWidth, tileHeight: source.map.tileHeight });
  const store = withProjectData(new MapStore(base), source);
  // No layers yet: placeStamp creates one per stamp layer (name, grid role), in order.
  placeStamp(store, stamp, layout.x, layout.y);
  // Opening is not an undo step.
  store.clearHistory();
  return store;
}

/** Ids of the layers a stamp can hold: every tile and grid layer, bottom to top. */
function cellLayerIds(doc: MapDocument): string[] {
  return doc.layers.filter((l) => !isEntityLayer(l)).map((l) => l.id);
}

/** Smallest rectangle holding every non-empty cell of the tile and grid layers, or null when all are empty. */
export function contentBounds(doc: MapDocument): CellRect | null {
  const ids = cellLayerIds(doc);
  if (ids.length === 0) return null;
  const { width, height } = doc.map;
  const clip = copyRegion(doc, ids, { x: 0, y: 0, width, height });
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (const layer of clip.layers) {
    for (let i = 0; i < layer.cells.length; i++) {
      if (layer.cells[i] === 0) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The stamp the editing map now holds: cropped to its content, with the
 * layers that have something in it (names and grid roles kept), under
 * `meta`'s id and name. Null when the map is empty (nothing to save).
 */
export function stampFromDocument(doc: MapDocument, meta: { readonly id: string; readonly name: string }): Stamp | null {
  const bounds = contentBounds(doc);
  if (!bounds) return null;
  const clip = copyRegion(doc, cellLayerIds(doc), bounds);
  const used = clip.layers.filter((l) => l.cells.some((c) => c !== 0)).map((l) => l.layerId);
  return createStamp(doc, used, bounds, { id: meta.id, name: meta.name });
}
