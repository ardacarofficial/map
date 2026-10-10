/**
 * The random brush as the canvas sees it (round 4): one code path for the
 * legacy tile list (`editorStore.randomSet`) and the round 4 options
 * (stamp candidates, scatter, random flip, chunk) — both arrive through
 * `currentRandomSet()`. Candidates that cannot be placed right now (a
 * removed tileset, a stamp missing from the library or using a removed
 * tileset) are left out, the same way for paint and preview.
 */
import { isTileLayer, type MapDocument, type RandomSet, type Stamp, type TileLayer } from "@smap/core";

import { currentRandomSet } from "../commands/randomBrush";
import { useProjectLibrary } from "../io/projectLibrary";
import { usableRandomSet } from "./randomPaint";

/** The library stamp `id`, or undefined. */
export function randomStampOf(id: string): Stamp | undefined {
  return useProjectLibrary.getState().stamps.find((s) => s.id === id);
}

function stampUsable(doc: MapDocument, id: string): boolean {
  const stamp = randomStampOf(id);
  return !!stamp && stamp.palette.every((e) => doc.getTileset(e.tilesetId) !== undefined);
}

/** True when a random brush is chosen (whatever the active layer). */
export function hasRandomBrush(): boolean {
  return currentRandomSet() !== null;
}

let memo: { set: RandomSet; doc: MapDocument; stamps: readonly Stamp[]; tilesets: unknown; usable: RandomSet | null } | null = null;

/**
 * The random set the brush / rectangle / fill paint with on `layer`, or
 * null (no random brush, not a tile layer, or nothing usable).
 */
export function activeRandomSet(doc: MapDocument | undefined, layer: TileLayer | undefined): RandomSet | null {
  if (!doc || !isTileLayer(layer)) return null;
  const set = currentRandomSet();
  if (!set) return null;
  const stamps = useProjectLibrary.getState().stamps;
  const tilesets: unknown = doc.tilesets;
  if (memo && memo.set === set && memo.doc === doc && memo.stamps === stamps && memo.tilesets === tilesets) return memo.usable;
  const usable = usableRandomSet(set, (c) => (c.kind === "tile" ? doc.getTileset(c.tilesetId) !== undefined : stampUsable(doc, c.stampId)));
  memo = { set, doc, stamps, tilesets, usable };
  return usable;
}
