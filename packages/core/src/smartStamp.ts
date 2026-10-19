import { solveMacroRoad } from "./smartStamp/macroRoad";
import { bandWidth } from "./smartStamp/bands";

import { cellFlags, cellPaletteIndex, FLIP_D, makeCell } from "./cell";
import type { MapDocument } from "./document";
import { lineCells, type CellPoint, type CellRect } from "./geometry";
import { COLLISION_PASSABLE, COLLISION_SOLID, isGridLayer, isTileLayer, type GridRole } from "./layer";
import { assertOrientation, nineSliceLayout, sampleNineSlice } from "./nineSlice";
import type { LayerPatch } from "./ops";
import { stampLayerMapping, stampNineSliceProblem, type Stamp, type StampLayerTarget } from "./stamp";
import type { MapStore } from "./store";
import { rectangleBandContains } from "./rectangleBand";
import { roadProfileProblem } from "./smartStamp/roadProfile";
import { solveRoadFromReader, roadTileInfo, type RoadMembership, type RoadTileReader, type RoadTileWrite } from "./smartStamp/roadSolver";
import { isValidTileId, type Tileset } from "./tileset";

/** Tile references rather than palette indices keep preview planning mutation-free. Grid writes use raw values. */
export type SmartStampWrite = RoadTileWrite | (CellPoint & { readonly value: number });
/** Existing destination or a deferred layer descriptor; layers are created only when applying nonempty writes. */
export interface SmartStampLayerPlan {
  readonly sourceLayerId: string;
  readonly layerId: string | null;
  readonly name: string;
  readonly grid: boolean;
  readonly role?: GridRole;
  readonly writes: readonly SmartStampWrite[];
}
/** Revision-bound plan. Window plans are preview-only; applying one is rejected. */
export interface SmartStampPlan {
  readonly revision: number;
  readonly layers: readonly SmartStampLayerPlan[];
  readonly windowed: boolean;
}
/** Supply the revision and mapping captured at gesture start. Windows restrict output to the visible area plus one cell. */
export interface SmartStampPlanOptions {
  readonly revision: number;
  readonly orientation?: number;
  readonly mapping?: readonly StampLayerTarget[];
  readonly window?: CellRect;
  /** Preview-only staged assets; never bypasses apply-time document validation. */
  readonly previewTilesets?: readonly Tileset[];
  /** Alan rectangle band; zero (default) fills the rectangle. */
  readonly thickness?: number;
}
/** Session-only mode and D4 orientation; the canonical saved stamp is never transformed. */
export interface SmartBrushSession {
  readonly stampId: string;
  readonly usage: "area" | "road";
  readonly orientation: number;
}
/** Actual changes and the newly allocated layer ids, all in the enclosing gesture transaction. */
export interface SmartStampApplyResult {
  readonly patches: readonly LayerPatch[];
  readonly createdLayerIds: readonly string[];
  readonly layerMapping: ReadonlyMap<string, string>;
}

const provenance = new WeakMap<SmartStampPlan, MapDocument>();
const contains = (r: CellRect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
const halo = (r: CellRect): CellRect => ({ x: r.x - 1, y: r.y - 1, width: r.width + 2, height: r.height + 2 });

function validate(doc: MapDocument, stamp: Stamp, orientation: number, options: SmartStampPlanOptions): void {
  assertOrientation(orientation);
  if (orientation & FLIP_D && doc.map.tileWidth !== doc.map.tileHeight) throw new Error("quarter-turn orientation requires square map tiles");
  if (!stamp.nineSlice) throw new Error("smart stamp requires nineSlice metadata");
  const problem = stampNineSliceProblem(stamp, stamp.nineSlice);
  if (problem) throw new Error(problem);
  const slots = nineSliceLayout(stamp).slots;
  for (const entry of stamp.nineSlice.tileLayers) {
    const ts = doc.getTileset(entry.tilesetId) ?? (options.window ? options.previewTilesets?.find(t => t.id === entry.tilesetId) : undefined);
    if (!ts || ts.columns * ts.rows < slots || ts.tileWidth !== doc.map.tileWidth || ts.tileHeight !== doc.map.tileHeight) throw new Error(`missing or incompatible baked tileset ${entry.tilesetId}`);
  }
}

function reader(doc: MapDocument, layerId: string | null): RoadTileReader {
  const layer = layerId === null ? undefined : doc.getLayer(layerId);
  return { width: doc.map.width, height: doc.map.height, seed: doc.seed, read: (x, y) => {
    const cell = layer?.getCell(x, y) ?? 0;
    return { tile: cell === 0 ? null : doc.palette.get(cellPaletteIndex(cell)), flags: cellFlags(cell) };
  } };
}

function differs(doc: MapDocument, layerId: string | null, write: SmartStampWrite): boolean {
  const cell = layerId === null ? 0 : doc.getLayer(layerId)!.getCell(write.x, write.y);
  if ("value" in write) return cell !== write.value;
  if (!write.tile) return cell !== 0;
  const old = doc.palette.get(cellPaletteIndex(cell));
  return !old || old.tilesetId !== write.tile.tilesetId || old.tileId !== write.tile.tileId || cellFlags(cell) !== (write.flags ?? 0);
}

function finish(doc: MapDocument, options: SmartStampPlanOptions, layers: readonly SmartStampLayerPlan[]): SmartStampPlan {
  const plan = Object.freeze({ revision: options.revision, windowed: options.window !== undefined, layers: Object.freeze(layers.map(l => Object.freeze({ ...l, writes: Object.freeze(l.writes.map(w => Object.freeze({ ...w, ...("tile" in w && w.tile ? { tile: Object.freeze({ ...w.tile }) } : {}) }))) }))) });
  provenance.set(plan, doc);
  return plan;
}

function roadProfile(doc: MapDocument, stamp: Stamp, options: SmartStampPlanOptions) {
  const road = stamp.nineSlice?.road;
  if (!road) throw new Error("stamp has no road profile");
  const problem = roadProfileProblem(road.profile);
  if (problem) throw new Error(problem);
  const tileset = doc.getTileset(road.tilesetId) ?? (options.window ? options.previewTilesets?.find(t => t.id === road.tilesetId) : undefined);
  if (!tileset || road.profile.tiles.some(t => !isValidTileId(tileset, t.tileId))) throw new Error("road profile references an invalid generated slot");
  return { road, profile: road.profile };
}

export function planSmartStampArea(doc: MapDocument, stamp: Stamp, rect: CellRect, options: SmartStampPlanOptions): SmartStampPlan {
  const orientation = options.orientation ?? 0;
  validate(doc, stamp, orientation, options);
  const thickness = options.thickness ?? 0;
  if (!Number.isInteger(thickness) || thickness < 0) throw new Error("outline thickness must be a nonnegative integer");
  // Validate rectangle even if it is completely clipped or all targets are skipped.
  sampleNineSlice(rect, { x: rect.x, y: rect.y }, stamp, orientation);
  if (options.window) sampleNineSlice(options.window, { x: options.window.x, y: options.window.y }, stamp);
  const mapping = options.mapping ?? stampLayerMapping(doc, stamp);
  if (mapping.length !== stamp.layers.length || mapping.some((e, i) => e.clipLayerId !== stamp.layers[i]!.layerId) || new Set(mapping.filter(e => e.targetLayerId !== null).map(e => e.targetLayerId)).size !== mapping.filter(e => e.targetLayerId !== null).length) throw new Error("invalid stamp layer mapping");
  const layers: SmartStampLayerPlan[] = [];
  for (let i = 0; i < stamp.layers.length; i++) {
    const source = stamp.layers[i]!, targetId = mapping[i]!.targetLayerId, target = targetId === null ? undefined : doc.getLayer(targetId);
    if (targetId !== null && !target) throw new Error(`missing mapped layer ${targetId}`);
    if (target && (source.grid ? !isGridLayer(target) || (source.role !== undefined && target.role !== source.role) : !isTileLayer(target))) throw new Error("incompatible mapped layer");
    const role: GridRole = source.role ?? (isGridLayer(target) ? target.role : "collision");
    const descriptor = { sourceLayerId: source.layerId, layerId: targetId, name: source.name, grid: !!source.grid, ...(source.grid ? { role } : {}) };
    if (target?.locked || target?.visible === false) { layers.push({ ...descriptor, writes: [] }); continue; }
    const asset = stamp.nineSlice!.tileLayers.find(l => l.layerId === source.layerId);
    const at = (x: number, y: number): SmartStampWrite | null => {
      if (!rectangleBandContains(rect, thickness, x, y)) return null;
      const sample = sampleNineSlice(rect, { x, y }, stamp, orientation);
      if (!sample) return null;
      const values = sample.sourceIndices.map(index => source.cells[index]!);
      if (source.grid) {
        let value = values[0]!;
        if (role === "collision") {
          if (values.some(v => v > COLLISION_PASSABLE)) throw new Error("invalid collision grid contributor");
          value = values.includes(COLLISION_SOLID) ? COLLISION_SOLID : values.includes(COLLISION_PASSABLE) ? COLLISION_PASSABLE : 0;
        }
        else if (!values.every(v => v === value)) throw new Error("collapsed grid contributors must be equal");
        return value === 0 ? null : { x, y, value };
      }
      return values.some(v => v !== 0) ? { x, y, tile: { tilesetId: asset!.tilesetId, tileId: sample.slot }, ...(orientation ? { flags: orientation } : {}) } : null;
    };
    const base = reader(doc, targetId);
    const virtual: RoadTileReader = { ...base, read: (x, y) => {
      const w = at(x, y);
      return w && "tile" in w ? { tile: w.tile, ...(w.flags ? { flags: w.flags } : {}) } : base.read(x, y);
    } };
    const writes = new Map<number, SmartStampWrite>(), window = options.window ? halo(options.window) : undefined;
    const x0 = Math.max(0, rect.x, window?.x ?? 0), y0 = Math.max(0, rect.y, window?.y ?? 0);
    const x1 = Math.min(doc.map.width, rect.x + rect.width, window ? window.x + window.width : Infinity), y1 = Math.min(doc.map.height, rect.y + rect.height, window ? window.y + window.height : Infinity);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const w = at(x, y); if (w) writes.set(y * doc.map.width + x, w); }
    if (!source.grid && bandWidth(stamp) === 1 && stamp.nineSlice!.road?.tilesetId === asset!.tilesetId) {
      const { road, profile } = roadProfile(doc, stamp, options);
      const membership: RoadMembership = { bounds: rect, contains: (x, y) => doc.inBounds(x, y) && contains(rect, x, y) && at(x, y) !== null };
      const repairs = solveRoadFromReader(virtual, profile, road.tilesetId, membership, {
        orientation, ...(options.window ? { window: options.window } : {}),
        outside: (x, y) => at(x, y) !== null ? 1 : 0,
      });
      const oldRoad = (x: number, y: number) => {
        if (!doc.inBounds(x, y) || at(x, y) !== null) return false;
        const cell = base.read(x, y), info = roadTileInfo(profile, road.tilesetId, cell.tile, cell.flags ?? 0);
        return info.kind === "blob";
      };
      for (const w of repairs) {
        // Preserve an isolated rectangle's authored cells/holes. Only contacts with existing road
        // outside the painted membership may change the prescribed artwork, on either side.
        let contact = oldRoad(w.x, w.y);
        if (!contact && at(w.x, w.y) !== null) for (let dy = -1; dy <= 1 && !contact; dy++) for (let dx = -1; dx <= 1; dx++) if (oldRoad(w.x + dx, w.y + dy)) { contact = true; break; }
        if (contact) writes.set(w.y * doc.map.width + w.x, w);
      }
    }
    layers.push({ ...descriptor, writes: [...writes.values()].filter(w => differs(doc, targetId, w)).sort((a, b) => a.y - b.y || a.x - b.x) });
  }
  return finish(doc, options, layers);
}

/** Road options: erase overlays empty membership and repairs surviving neighbours with the same solver. */
export interface SmartStampRoadOptions extends SmartStampPlanOptions { readonly erase?: boolean }

/**
 * Plans Yol on one explicitly selected visible/unlocked tile layer. No layer creation or grid writes.
 * Membership is the complete gesture, including offscreen cells. Window output includes a one-cell halo.
 */
export function planSmartStampRoad(doc: MapDocument, stamp: Stamp, layerId: string, membership: RoadMembership, options: SmartStampRoadOptions): SmartStampPlan {
  const orientation = options.orientation ?? 0;
  validate(doc, stamp, orientation, options);
  const { road, profile } = roadProfile(doc, stamp, options), layer = doc.getLayer(layerId);
  if (!isTileLayer(layer)) throw new Error("road requires an existing tile layer");
  const solveOptions = { orientation, erase: !!options.erase, ...(options.window ? { window: options.window } : {}) };
  const writes = layer.locked || !layer.visible ? [] : bandWidth(stamp)>1 ? solveMacroRoad(reader(doc,layerId),road.tilesetId,nineSliceLayout(stamp).bank,bandWidth(stamp),membership,solveOptions) : solveRoadFromReader(reader(doc, layerId), profile, road.tilesetId, membership, solveOptions);
  return finish(doc, options, [{ sourceLayerId: stamp.nineSlice!.tileLayers.find(l => l.tilesetId === road.tilesetId)!.layerId, layerId, name: layer.name, grid: false, writes }]);
}

/**
 * Executes a complete plan through existing store operations. Rejects stale, foreign and window plans.
 * New ids are allocated once, inside the transaction; undo/rollback removes created layers as well as cell changes.
 * Nesting joins the caller's gesture. On an execution failure the entire active gesture rolls back.
 */
export function applySmartStampPlan(store: MapStore, plan: SmartStampPlan): SmartStampApplyResult {
  if (plan.windowed) throw new Error("cannot apply a window preview plan");
  if (provenance.get(plan) !== store.document || plan.revision !== store.revision) throw new Error("stale or foreign smart stamp plan; recompute before applying");
  // Preflight every reference before creating layers or writing cells.
  for (const layer of plan.layers) {
    for (const w of layer.writes) if ("tile" in w && w.tile) {
      const ts = store.document.getTileset(w.tile.tilesetId);
      if (!ts || !isValidTileId(ts, w.tile.tileId)) throw new Error("invalid planned tile reference");
    }
  }
  const createdLayerIds: string[] = [], patches: LayerPatch[] = [], layerMapping = new Map<string, string>();
  store.beginTransaction();
  try {
    let previous: string | null = null;
    for (const layer of plan.layers) {
      let target = layer.layerId;
      if (target === null && layer.writes.length) {
        target = store.dispatch({ type: "addLayer", layer: layer.grid ? { name: layer.name, type: "grid", role: layer.role ?? "collision" } : { name: layer.name }, index: previous === null ? 0 : store.document.indexOfLayer(previous) + 1 });
        createdLayerIds.push(target);
      }
      if (target === null) continue;
      previous = target; layerMapping.set(layer.sourceLayerId, target);
      if (layer.writes.length === 0) continue;
      if (layer.grid) patches.push(store.dispatch({ type: "paintGrid", layerId: target, cells: layer.writes.map(w => { if (!("value" in w)) throw new Error("invalid grid plan"); return w; }) }));
      else patches.push(store.dispatch({ type: "paintCells", layerId: target, cells: layer.writes.map(w => {
        if (!("tile" in w)) throw new Error("invalid tile plan");
        return { x: w.x, y: w.y, cell: w.tile ? makeCell(store.getOrAddPaletteIndex(w.tile.tilesetId, w.tile.tileId), w.flags ?? 0) : 0 };
      }) }));
    }
    store.commit(); return { patches, createdLayerIds, layerMapping };
  } catch (error) { store.rollback(); throw error; }
}

/** Plans against the current revision and applies one Alan gesture (or joins an existing transaction). */
export function applySmartStampArea(store: MapStore, stamp: Stamp, rect: CellRect, options: Omit<SmartStampPlanOptions, "revision" | "window"> = {}): SmartStampApplyResult {
  return applySmartStampPlan(store, planSmartStampArea(store.document, stamp, rect, { ...options, revision: store.revision }));
}

/** Plans against the current revision and applies road membership (or joins an existing transaction). */
export function applySmartStampRoad(store: MapStore, stamp: Stamp, layerId: string, membership: RoadMembership, options: Omit<SmartStampRoadOptions, "revision" | "window"> = {}): SmartStampApplyResult {
  return applySmartStampPlan(store, planSmartStampRoad(store.document, stamp, layerId, membership, { ...options, revision: store.revision }));
}

/**
 * Reversal-invariant four-connected Bresenham path, both endpoints included. Canonically order endpoints
 * lexicographically, insert the x-then-y bridge for each diagonal step, then reverse for reverse traversal.
 */
export function orthogonalBridge(a: CellPoint, b: CellPoint): CellPoint[] {
  if (![a.x, a.y, b.x, b.y].every(Number.isInteger)) throw new TypeError("bridge coordinates must be integers");
  const reverse = a.x > b.x || (a.x === b.x && a.y > b.y), start = reverse ? b : a, end = reverse ? a : b;
  const line = lineCells(start.x, start.y, end.x, end.y), out: CellPoint[] = [];
  for (const p of line) {
    const prev = out[out.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) out.push({ x: p.x, y: prev.y });
    out.push(p);
  }
  return reverse ? out.reverse() : out;
}
