/** Gesture geometry only; connectivity and tile selection stay in core's planners. */
import { brushPreviewTilesets } from "../commands/smartBrushActions";
import { stampLayerMapping, normalizeRect, orthogonalBridge, planSmartStampArea, planSmartStampRoad, rectangleBandContains, roadMembership, type CellPoint, type CellRect, type MapStore, type Stamp, type StampLayerTarget, type SmartStampPlan, type RoadMembership } from "@smap/core";
import { brushFootprint, constrainRect, footprintCells } from "./footprint";

export interface SmartGesture {
  readonly kind: "smart"; readonly pointerId: number; readonly store: MapStore; readonly stamp: Stamp;
  readonly layerId: string; readonly mapping: readonly StampLayerTarget[]; readonly orientation: number;
  readonly usage: "area" | "road"; readonly rectangle: boolean; readonly erase: boolean;
  readonly thickness: number; readonly offsets: readonly CellPoint[];
  readonly start: CellPoint; end: CellPoint; square: boolean; fromCenter: boolean;
  readonly members: Set<string>; last: CellPoint; version: number;
}
export function smartRect(g: Pick<SmartGesture, "start" | "end" | "square" | "fromCenter">): CellRect {
  const { a, b } = constrainRect(g.start, g.end, g);
  return normalizeRect(a.x, a.y, b.x, b.y)!;
}
export function addRoadSamples(g: Pick<SmartGesture, "members" | "offsets" | "last" | "end" | "version"> & { readonly stamp?: Stamp }, points: readonly CellPoint[]): void {
  const b=g.stamp?.nineSlice?.border ?? 1;
  const macro=(p:CellPoint)=>({x:Math.floor(p.x/b),y:Math.floor(p.y/b)});
  for (const p of points) {
    for (const q of footprintCells(orthogonalBridge(macro(g.last), macro(p)), g.offsets)) g.members.add(`${q.x*b},${q.y*b}`);
    g.last = p; g.end = p;
  }
  g.version++;
}
export function smartMembership(g: SmartGesture): RoadMembership {
  if (g.rectangle) {
    const r = smartRect(g);
    return { bounds: r, contains: (x, y) => rectangleBandContains(r, g.thickness, x, y) };
  }
  return roadMembership([...g.members].map(key => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    return { x, y };
  }));
}
export function smartGesturePlan(g: SmartGesture, window?: CellRect): SmartStampPlan {
  const options = { revision: g.store.revision, orientation: g.orientation, mapping: g.mapping, ...(window ? { window, previewTilesets: brushPreviewTilesets(g.stamp) } : {}) };
  return g.usage === "area" ? planSmartStampArea(g.store.document, g.stamp, smartRect(g), { ...options, thickness: g.thickness }) : planSmartStampRoad(g.store.document, g.stamp, g.layerId, smartMembership(g), { ...options, erase: g.erase });
}
export function smartHoverGesture(store: MapStore, stamp: Stamp, layerId: string, cell: CellPoint, usage: "area" | "road", orientation: number, size: number, shape: "square" | "circle", erase = false, anchor: CellPoint | null = null): SmartGesture {
  const g: SmartGesture = { kind: "smart", pointerId: -1, store, stamp, layerId, mapping: stamp.layers.length === 1 ? [{ clipLayerId: stamp.layers[0]!.layerId, targetLayerId: layerId, name: stamp.layers[0]!.name }] : stampLayerMapping(store.document, stamp), orientation, usage, rectangle: usage === "area", erase, thickness: 0, offsets: brushFootprint(size, shape), start: cell, end: cell, square: false, fromCenter: false, members: new Set(), last: anchor ?? cell, version: 0 };
  addRoadSamples(g, [cell]); return g;
}
