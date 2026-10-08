/**
 * How the layers panel groups a terrain layer with the tile layer it
 * writes into, so the pair reads as ONE entry ("Çimen (arazi)") with the
 * derived tiles nested under it instead of two unrelated rows. Pure; no React.
 *
 * A pair is grouped when the derived tile layer sits directly below its
 * terrain layer (where "Arazi tanımla" puts it, and where moving the group
 * keeps it). A pair that was pulled apart shows as two plain rows (with the
 * link note), because nesting would lie about the draw order.
 */
import { isGridLayer, type MapDocument, type TileLayer } from "@smap/core";

/** One draggable entry of the list: a layer, or a terrain layer + its derived tiles. */
export interface LayerUnit {
  readonly head: TileLayer;
  /** The derived tile layer directly below `head` (terrain groups only). */
  readonly child: TileLayer | null;
}

/** Units, top layer first. */
export function layerUnits(doc: MapDocument): LayerUnit[] {
  const layers = doc.layers; // bottom first
  const units: LayerUnit[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    const below = layers[i - 1];
    if (isGridLayer(layer) && layer.role === "terrain" && layer.targetLayerId !== null && below?.id === layer.targetLayerId) {
      units.push({ head: layer, child: below });
      i--; // the child is part of this unit
    } else {
      units.push({ head: layer, child: null });
    }
  }
  return units;
}

export type LayerRow =
  /** An ordinary layer (tile, collision, entity, or an ungrouped terrain layer). */
  | { readonly kind: "layer"; readonly layer: TileLayer; readonly unit: number }
  /** A terrain layer heading its group. */
  | { readonly kind: "group"; readonly layer: TileLayer; readonly child: TileLayer; readonly unit: number; readonly expanded: boolean }
  /** The derived tile layer, nested under its group (only when expanded). */
  | { readonly kind: "derived"; readonly layer: TileLayer; readonly parent: TileLayer; readonly unit: number };

/** Rows to render, top first. Groups are collapsed unless their head id is in `expanded`. */
export function layerRows(units: readonly LayerUnit[], expanded: ReadonlySet<string>): LayerRow[] {
  const rows: LayerRow[] = [];
  units.forEach((u, unit) => {
    if (!u.child) {
      rows.push({ kind: "layer", layer: u.head, unit });
      return;
    }
    const open = expanded.has(u.head.id);
    rows.push({ kind: "group", layer: u.head, child: u.child, unit, expanded: open });
    if (open) rows.push({ kind: "derived", layer: u.child, parent: u.head, unit });
  });
  return rows;
}

/** Index of the unit containing `layerId`, or -1. */
export function unitIndexOf(units: readonly LayerUnit[], layerId: string | null): number {
  if (!layerId) return -1;
  return units.findIndex((u) => u.head.id === layerId || u.child?.id === layerId);
}

/**
 * Layer ids, bottom first (core order), after moving unit `from` to
 * position `to` (both top-first unit indices). A group moves as a whole.
 */
export function moveUnitOrder(units: readonly LayerUnit[], from: number, to: number): string[] {
  const list = [...units];
  const clampedTo = Math.max(0, Math.min(list.length - 1, to));
  if (from >= 0 && from < list.length && clampedTo !== from) {
    const [moved] = list.splice(from, 1);
    list.splice(clampedTo, 0, moved!);
  }
  const topFirst = list.flatMap((u) => (u.child ? [u.head.id, u.child.id] : [u.head.id]));
  return topFirst.reverse();
}
