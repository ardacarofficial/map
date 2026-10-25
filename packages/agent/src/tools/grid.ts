/** C1 grid format: compact legend + rows reads and writes, plus uniform region tools. */
import {
  cellFlags,
  cellPaletteIndex,
  isEntityLayer,
  isGridLayer,
  isTileLayer,
  pickRandomTile,
  planTileReplacement,
  type Entity,
  type LayerPatch,
  type MapStore,
  type TileLayer,
} from "@smap/core";
import {
  AGENT_LIMITS as L,
  AgentError,
  AgentErrorCode as E,
  type ChangeSummary,
  type CompactChange,
  type EntityInfo,
  type GridCell,
  type GridLayerOutput,
  type GridLegend,
  type GridRandomTile,
  type Id,
  type PaintValue,
  type Point,
  type ReadRegionGrid,
  type Rect,
  type Tile,
  type ToolArguments,
  type ToolData,
} from "../contracts";
import type { Transactions } from "../transactions";
import { budget, check, fail } from "../validation";
import { applyLayers, change, compactFlags, layer, layerKind, protect, tileValue, type LayerWrites } from "./mutations";

/** Readable, JSON-escape-free symbols first; "." is reserved for empty cells. */
const ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=?@^~!:;<>/|_()[]{},'`";
const LATIN: string[] = [];
for (let c = 0xc0; c <= 0x24f; c++) if (c !== 0xd7 && c !== 0xf7) LATIN.push(String.fromCodePoint(c));
/** Deterministic legend symbol for the n-th distinct value of a layer. Never whitespace or ".". */
export function gridSymbol(n: number): string {
  if (n < ASCII.length) return ASCII[n]!;
  n -= ASCII.length;
  if (n < LATIN.length) return LATIN[n]!;
  return String.fromCodePoint(0x4e00 + n - LATIN.length);
}
const EMPTY = ".";
const COLLISION_SYMBOLS: Record<number, string> = { 1: "#", 2: "+" };

export const wholeMap = (store: MapStore): Rect => ({ x: 0, y: 0, width: store.document.map.width, height: store.document.map.height });
const mapSize = (store: MapStore) => ({ width: store.document.map.width, height: store.document.map.height });
function inside(store: MapStore, r: Rect): void {
  check(r.x + r.width <= store.document.map.width && r.y + r.height <= store.document.map.height,
    E.OUT_OF_BOUNDS, "Region outside map", { mapSize: mapSize(store), region: { ...r } });
}
const validLayers = (store: MapStore) => store.document.layers.map(l => ({ id: l.id, name: l.name, kind: layerKind(l) }));

/** Resolve a layer by stable id or unique (case-insensitive) name, with valid choices in errors. */
export function resolveLayer(store: MapStore, ref: { layerId?: Id | undefined; layerName?: string | undefined }, path = "layerId"): TileLayer {
  if (ref.layerId !== undefined) {
    const found = store.document.getLayer(ref.layerId);
    check(found, E.UNKNOWN_ID, `${path}: unknown layer ${JSON.stringify(ref.layerId)}`, { validIds: validLayers(store) });
    return found;
  }
  check(ref.layerName !== undefined, E.INVALID_ARGUMENT, `${path}: supply layerId or layerName`, { validIds: validLayers(store) });
  const name = ref.layerName.trim().toLocaleLowerCase("en");
  const named = store.document.layers.filter(l => l.name.trim().toLocaleLowerCase("en") === name);
  // A layer id passed as layerName still means that layer.
  const matches = named.length ? named : store.document.layers.filter(l => l.id === ref.layerName);
  check(matches.length === 1, matches.length ? E.INVALID_ARGUMENT : E.UNKNOWN_ID,
    matches.length ? `${path}: layer name ${JSON.stringify(ref.layerName)} is ambiguous; use layerId` : `${path}: unknown layer name ${JSON.stringify(ref.layerName)}`,
    { validIds: validLayers(store) });
  return matches[0]!;
}

/** Visible tile and collision layers in stack order (read default). */
const visibleCellLayers = (store: MapStore) => store.document.layers.filter(l => !isEntityLayer(l) && l.visible);
/** Default write targets: visible, currently and initially unlocked layers. */
function editableLayers(tx: Transactions, mapId: Id, store: MapStore, accept: (l: TileLayer) => boolean): { targets: TileLayer[]; skipped: Id[] } {
  const targets: TileLayer[] = [], skipped: Id[] = [];
  for (const l of store.document.layers) {
    if (!accept(l)) continue;
    try { protect(tx, mapId, l); targets.push(l); } catch { skipped.push(l.id); }
  }
  return { targets, skipped };
}

function tileKey(tile: Tile): string { return `${tile.tilesetId}\u0000${tile.tileId}\u0000${tile.flags ?? 0}`; }

/** Encode one layer region as C1 rows + legend; null when the region is empty. */
function encodeLayer(store: MapStore, target: TileLayer, region: Rect): GridLayerOutput | null {
  const legend: GridLegend = {}, symbols = new Map<string, string>(), rows: string[] = [];
  const collision = isGridLayer(target);
  let used = 0, occupied = false;
  for (let y = region.y; y < region.y + region.height; y++) {
    let row = "";
    for (let x = region.x; x < region.x + region.width; x++) {
      const cell = target.getCell(x, y);
      if (!cell) {
        row += EMPTY;
        legend[EMPTY] = null;
        continue;
      }
      occupied = true;
      let key: string, value: GridCell;
      if (collision) {
        key = `c${cell}`;
        value = { collision: cell as 1 | 2 };
      } else {
        const ref = store.document.palette.get(cellPaletteIndex(cell));
        check(ref, E.UNKNOWN_ID, "Cell references missing palette");
        const flags = compactFlags(cellFlags(cell));
        value = flags ? { tilesetId: ref.tilesetId, tileId: ref.tileId, flags } : { tilesetId: ref.tilesetId, tileId: ref.tileId };
        key = tileKey(value);
      }
      let symbol = symbols.get(key);
      if (!symbol) {
        const preferred = collision ? COLLISION_SYMBOLS[cell] : undefined;
        do symbol = preferred && !(preferred in legend) ? preferred : gridSymbol(used++);
        while (symbol in legend);
        symbols.set(key, symbol);
        legend[symbol] = value;
      }
      row += symbol;
    }
    rows.push(row);
  }
  return occupied ? { layerId: target.id, name: target.name, kind: collision ? "collision" : "tile", rows, legend } : null;
}

export function readGrid(store: MapStore, a: ToolArguments["read_region"]): ReadRegionGrid | { region: Rect; targets: TileLayer[] } {
  const region = a.region ?? wholeMap(store);
  inside(store, region);
  const area = region.width * region.height;
  budget(area, L.readCellsPerLayer);
  const targets = a.layerIds
    ? a.layerIds.map(id => layer(store, id))
    : [...visibleCellLayers(store), ...(a.includeEntities ? store.document.entityLayers().filter(l => l.visible) : [])];
  check(new Set(targets.map(t => t.id)).size === targets.length, E.INVALID_ARGUMENT, "layerIds: duplicate layer");
  budget(targets.length, L.readLayers);
  budget(area * targets.filter(t => !isEntityLayer(t)).length, L.readCellsTotal);
  if (a.format === "cells") return { region, targets };
  const layers: GridLayerOutput[] = [], empty: Id[] = [];
  for (const target of targets) {
    if (isEntityLayer(target)) continue;
    const encoded = encodeLayer(store, target, region);
    if (encoded) layers.push(encoded);
    else empty.push(target.id);
  }
  const entities = a.includeEntities ? entitiesIn(store, targets, region) : [];
  return {
    format: "grid", region, origin: { x: region.x, y: region.y }, layers,
    ...(empty.length ? { emptyLayerIds: empty } : {}),
    ...(entities.length ? { entities } : {}),
  };
}

export function entitiesIn(store: MapStore, targets: readonly TileLayer[], region: Rect): EntityInfo[] {
  const { tileWidth, tileHeight } = store.document.map, out: EntityInfo[] = [];
  for (const target of targets) {
    if (!isEntityLayer(target)) continue;
    for (const e of target.entities)
      if (entityInside(e, region, tileWidth, tileHeight)) {
        budget(out.length + 1, L.entitiesPerRead);
        out.push({ id: e.id, layerId: target.id, typeId: e.typeId, pixelX: e.x, pixelY: e.y, fields: { ...e.fields } });
      }
  }
  return out;
}
const entityInside = (e: Entity, r: Rect, tw: number, th: number) =>
  e.x >= r.x * tw && e.y >= r.y * th && e.x < (r.x + r.width) * tw && e.y < (r.y + r.height) * th;

type Candidate = { tilesetId: string; tileId: number; weight: number };
type Resolved = { keep: true } | { keep: false; value: PaintValue } | { keep: false; random: Tile[]; candidates: Candidate[]; seed: number };

/** Only symbols used by the rows are validated, so a shared legend can mix tile and collision entries. */
function resolveLegend(store: MapStore, legend: GridLegend, used: ReadonlySet<string>, kind: ReturnType<typeof layerKind>, path: string): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  for (const [symbol, cell] of Object.entries(legend)) {
    if (!used.has(symbol)) continue;
    const where = `${path}.legend[${JSON.stringify(symbol)}]`;
    try {
      if (cell === "keep") out.set(symbol, { keep: true });
      else if (cell !== null && "random" in cell) {
        check(kind === "tile", E.LAYER_KIND, `${where}: random cells require a tile layer`);
        check(cell.random.length > 0, E.INVALID_ARGUMENT, `${where}: random needs at least one tile`);
        const weights = cell.random.map(t => t.weight ?? 1);
        check(weights.every(w => Number.isFinite(w) && w >= 0) && weights.some(w => w > 0), E.INVALID_ARGUMENT, `${where}: weights must be ≥ 0 with a positive total`);
        const random = cell.random.map(t => ({ tilesetId: t.tilesetId, tileId: t.tileId, flags: t.flags ?? 0 }) as Tile);
        for (const t of random) tileValue(store, t, kind);
        // Candidate tileId carries the index so core's weighted hash(seed,x,y) pick stays the single rule.
        const candidates = weights.map((weight, i) => ({ tilesetId: "", tileId: i, weight }));
        out.set(symbol, { keep: false, random, candidates, seed: (cell.seed ?? store.document.seed) >>> 0 });
      } else {
        tileValue(store, cell, kind);
        out.set(symbol, { keep: false, value: cell });
      }
    } catch (error) {
      if (error instanceof AgentError && !error.message.startsWith(where))
        throw new AgentError(error.code, `${where}: ${error.message}`, error.details, error.retryable);
      throw error;
    }
  }
  return out;
}

/** paint_rect/fill value: one value, or {random:[...]} picked per cell by hash(seed,x,y) like a legend entry. */
export function valueAt(store: MapStore, target: TileLayer, value: PaintValue | { random: GridRandomTile[]; seed?: number }, path: string): (x: number, y: number) => PaintValue {
  if (value === null || !("random" in value)) return () => value;
  const entry = resolveLegend(store, { r: value }, new Set(["r"]), layerKind(target), path).get("r");
  if (!entry || entry.keep || !("random" in entry)) return fail(E.INVALID_ARGUMENT, `${path}: invalid random value`);
  return (x, y) => entry.random[pickRandomTile(entry.candidates, entry.seed, x, y).tileId]!;
}

/** Validate and expand one C1 grid into explicit writes (keep cells are omitted). */
export function expandGrid(store: MapStore, target: TileLayer, grid: { origin?: Point | undefined; rows: string[]; legend: GridLegend }, path: string): LayerWrites {
  const kind = layerKind(target);
  check(kind !== "entity", E.LAYER_KIND, `${path}: grid painting requires a tile or collision layer`, { layerId: target.id });
  const origin = grid.origin ?? { x: 0, y: 0 };
  const rows = grid.rows.map(r => [...r]);
  check(rows.length > 0 && rows[0]!.length > 0, E.INVALID_ARGUMENT, `${path}.rows: must contain at least one non-empty row`);
  const width = rows[0]!.length;
  const ragged = rows.flatMap((r, i) => r.length === width ? [] : [`rows[${i}] has ${r.length}`]);
  check(!ragged.length, E.INVALID_ARGUMENT, `${path}.rows: every row must have ${width} characters (like rows[0]); ${ragged.slice(0, 8).join(", ")}${ragged.length > 8 ? ", …" : ""}`,
    { nextAction: `Make every row exactly ${width} characters (pad with " " to keep cells), then call again.` });
  budget(width * rows.length, L.gridCells);
  inside(store, { x: origin.x, y: origin.y, width, height: rows.length });
  for (const symbol of Object.keys(grid.legend))
    check([...symbol].length === 1, E.INVALID_ARGUMENT, `${path}.legend: key ${JSON.stringify(symbol)} must be exactly one character`);
  const legend = resolveLegend(store, grid.legend, new Set(rows.flat()), kind, path);
  const writes: LayerWrites["writes"] = [];
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < width; c++) {
      const symbol = rows[r]![c]!;
      const entry = legend.get(symbol) ?? (symbol === " " ? { keep: true as const } : undefined);
      if (!entry) fail(E.INVALID_ARGUMENT, `${path}.rows[${r}][${c}]: character ${JSON.stringify(symbol)} is not in the legend`,
        { validSymbols: Object.keys(grid.legend), nextAction: `Add ${JSON.stringify(symbol)} to legend, or use " " to keep the cell.` });
      if (entry.keep) continue;
      const x = origin.x + c, y = origin.y + r;
      const value = "value" in entry ? entry.value
        : entry.random[pickRandomTile(entry.candidates, entry.seed, x, y).tileId]!;
      writes.push({ x, y, value });
    }
  return { layerId: target.id, writes };
}

export function compact(summary: ChangeSummary, extraWarnings: string[] = []): CompactChange {
  const warnings = [...extraWarnings];
  if (summary.plannedCells > 0 && summary.changedCells === 0) warnings.push("No cells changed: every write already matched the map.");
  const boxes = summary.affected.flatMap(a => a.bounds ? [a.bounds] : []);
  const maps = new Set(summary.affected.map(a => a.mapId));
  let bounds: Rect | undefined;
  if (boxes.length && maps.size === 1) {
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    bounds = { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
  }
  const created = {
    ...(summary.createdLayerIds.length ? { layerIds: summary.createdLayerIds } : {}),
    ...(summary.createdEntityIds.length ? { entityIds: summary.createdEntityIds } : {}),
  };
  return {
    changed: summary.changedCells,
    ...(bounds ? { bounds } : {}),
    ...(Object.keys(created).length ? { created } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

/** paint_grid: one or more C1 grids applied as a single store action and one mutation call. */
export function paintGrid(tx: Transactions, a: ToolArguments["paint_grid"]): { change: ChangeSummary } {
  const store = tx.store(a.mapId);
  const single = a.rows !== undefined;
  check(single !== (a.layers !== undefined), E.INVALID_ARGUMENT, "Supply either rows (with layerId or layerName) or layers[], not both");
  const grids = single
    ? [{ layerId: a.layerId, layerName: a.layerName, origin: a.origin, rows: a.rows!, legend: a.legend ?? {}, path: "" }]
    : a.layers!.map((l, i) => ({ ...l, origin: l.origin ?? a.origin, legend: { ...a.legend, ...l.legend }, path: `layers[${i}]` }));
  budget(grids.length, L.readLayers);
  // The same layer may appear several times (e.g. one entry per object); later entries win per cell.
  const merged = new Map<Id, Map<string, LayerWrites["writes"][number]>>();
  for (const g of grids) {
    const target = resolveLayer(store, g, g.path ? `${g.path}.layerId` : "layerId");
    const item = expandGrid(store, target, g, g.path || "grid");
    const cells = merged.get(item.layerId) ?? new Map<string, LayerWrites["writes"][number]>();
    for (const w of item.writes) cells.set(`${w.x},${w.y}`, w);
    merged.set(item.layerId, cells);
  }
  return applyLayers(tx, a.mapId, [...merged].map(([layerId, cells]) => ({ layerId, writes: [...cells.values()] })), L.gridCells);
}

/** Nonzero cells of a layer inside region, chunk-sparse. */
function occupied(target: TileLayer, region: Rect, match: (cell: number) => boolean): Point[] {
  const out: Point[] = [], x1 = region.x + region.width, y1 = region.y + region.height;
  for (const chunk of target.chunks()) {
    const left = chunk.cx << 5, top = chunk.cy << 5;
    if (left >= x1 || top >= y1 || left + 32 <= region.x || top + 32 <= region.y) continue;
    for (let y = Math.max(region.y, top); y < Math.min(y1, top + 32); y++)
      for (let x = Math.max(region.x, left); x < Math.min(x1, left + 32); x++) {
        const cell = chunk.data[((y & 31) << 5) | (x & 31)]!;
        if (cell && match(cell)) out.push({ x, y });
      }
  }
  return out;
}

/** clear_region: erase tile/collision cells (and listed entity layers' entities) inside a rectangle. */
export function clearRegion(tx: Transactions, a: ToolArguments["clear_region"]): ToolData["clear_region"] & { change: ChangeSummary } {
  const store = tx.store(a.mapId), region = a.region ?? wholeMap(store);
  inside(store, region);
  let targets: TileLayer[], skipped: Id[] = [];
  if (a.layerIds) {
    check(new Set(a.layerIds).size === a.layerIds.length, E.INVALID_ARGUMENT, "layerIds: duplicate layer");
    targets = a.layerIds.map(id => resolveLayer(store, { layerId: id }, "layerIds"));
    for (const t of targets) protect(tx, a.mapId, t);
  } else ({ targets, skipped } = editableLayers(tx, a.mapId, store, l => !isEntityLayer(l)));
  const items: LayerWrites[] = targets.filter(t => !isEntityLayer(t))
    .map(t => ({ layerId: t.id, writes: occupied(t, region, () => true).map(p => ({ ...p, value: null })) }));
  const { tileWidth, tileHeight } = store.document.map;
  const removals = targets.flatMap(t => isEntityLayer(t)
    ? t.entities.filter(e => entityInside(e, region, tileWidth, tileHeight)).map(e => ({ layerId: t.id, entity: e }))
    : []);
  for (const r of removals) tx.authorizeEntity(a.mapId, r.layerId, r.entity, null);
  const result = applyLayers(tx, a.mapId, items, Number.POSITIVE_INFINITY, () => {
    for (const r of removals) store.dispatch({ type: "removeEntity", entityId: r.entity.id });
  }, removals.length * 512);
  const warnings = skipped.length ? [`Skipped protected (locked or hidden) layers: ${skipped.join(", ")}`] : [];
  return { ...compact(result.change, warnings), ...(removals.length ? { removedEntities: removals.length } : {}), change: result.change };
}

/** replace_tiles: swap one tile identity for another (or erase it), keeping each cell's flip bits. */
export function replaceTiles(tx: Transactions, a: ToolArguments["replace_tiles"]): ToolData["replace_tiles"] & { change: ChangeSummary } {
  const p = tx.pending!;
  if (a.scope === "world") check(a.region === undefined && a.layerIds === undefined, E.INVALID_ARGUMENT, "scope world: omit region and layerIds");
  else check(a.mapId !== undefined, E.INVALID_ARGUMENT, `scope ${a.scope}: mapId is required`);
  if (a.scope === "region") check(a.region, E.INVALID_ARGUMENT, "scope region: region is required");
  else check(a.region === undefined, E.INVALID_ARGUMENT, `scope ${a.scope}: region is only valid with scope region`);
  if (a.scope === "layer") check(a.layerIds?.length, E.INVALID_ARGUMENT, "scope layer: layerIds is required");
  const mapIds = a.scope === "world" ? [...p.participants].filter(([, m]) => m.target).map(([id]) => id) : [a.mapId!];
  const skipped: Id[] = [];
  const plans: { mapId: Id; store: MapStore; layers: { layerId: Id; region: Rect }[] }[] = [];
  for (const mapId of mapIds) {
    const store = tx.store(mapId);
    if (a.to) tileValue(store, a.to, "tile");
    const region = a.region ?? wholeMap(store);
    inside(store, region);
    let targets: TileLayer[];
    if (a.layerIds) {
      check(new Set(a.layerIds).size === a.layerIds.length, E.INVALID_ARGUMENT, "layerIds: duplicate layer");
      targets = a.layerIds.map(id => resolveLayer(store, { layerId: id }, "layerIds"));
      for (const t of targets) {
        check(isTileLayer(t), E.LAYER_KIND, "replace_tiles requires tile layers", { layerId: t.id });
        protect(tx, mapId, t);
      }
    } else {
      const found = editableLayers(tx, mapId, store, isTileLayer);
      targets = found.targets;
      skipped.push(...found.skipped);
    }
    plans.push({ mapId, store, layers: targets.map(t => ({ layerId: t.id, region })) });
  }
  const same = a.to && a.to.tilesetId === a.from.tilesetId && a.to.tileId === a.from.tileId;
  const planFor = (plan: (typeof plans)[number]): LayerPatchInput[] => {
    const doc = plan.store.document, source = doc.palette.indexOf(a.from.tilesetId, a.from.tileId);
    if (!source || same) return [];
    if (a.to) {
      const out: LayerPatchInput[] = [];
      for (const l of plan.layers)
        for (const w of planTileReplacement(doc, { from: a.from, to: a.to, layerIds: [l.layerId], region: l.region }))
          out.push({ layerId: w.layerId, cells: w.cells });
      return out;
    }
    return plan.layers.map(l => ({
      layerId: l.layerId,
      cells: occupied(doc.getLayer(l.layerId)!, l.region, cell => cellPaletteIndex(cell) === source).map(q => ({ ...q, cell: 0 })),
    })).filter(l => l.cells.length);
  };
  const planned = plans.map(planFor);
  const total = planned.reduce((n, layers) => n + layers.reduce((m, l) => m + l.cells.length, 0), 0);
  plans.forEach((plan, i) => { for (const l of planned[i]!) tx.authorizeCells(plan.mapId, l.layerId, l.cells); });
  const retained = total * 32 + (a.to ? plans.length * 256 : 0);
  tx.charge(total, retained, Number.POSITIVE_INFINITY);
  const summaries = tx.run(() => plans.map(plan => {
    if (a.to) plan.store.dispatch({ type: "addPaletteEntries", entries: [a.to] });
    // Replan against the exact palette after a possible append (same cells, final index).
    const patches: LayerPatch[] = planFor(plan).map(l => plan.store.dispatch({ type: "paintCells", layerId: l.layerId, cells: l.cells }));
    return change(plan.mapId, plan.store, patches.reduce((n, q) => n + q.cells.length, 0), patches);
  }));
  const summary: ChangeSummary = {
    plannedCells: total,
    changedCells: summaries.reduce((n, s) => n + s.changedCells, 0),
    affected: summaries.flatMap(s => s.affected),
    createdLayerIds: [], createdEntityIds: [],
  };
  tx.record(summary, retained);
  const warnings: string[] = [];
  if (same) warnings.push("from and to are the same tile; nothing to replace.");
  else if (total === 0) warnings.push("No cells use the from tile in the selected scope.");
  if (skipped.length) warnings.push(`Skipped protected (locked or hidden) layers: ${skipped.join(", ")}`);
  if (a.scope === "world") {
    const outside = tx.host.world.maps().filter(m => !mapIds.includes(m.id)).map(m => m.id);
    if (outside.length) warnings.push(`Maps outside this edit were not changed: ${outside.join(", ")}. Include them in begin_edit mapIds to replace there too.`);
  }
  return {
    ...compact(summary, warnings),
    ...(a.scope === "world" ? { maps: summaries.map((s, i) => ({ mapId: plans[i]!.mapId, changed: s.changedCells })) } : {}),
    ...(skipped.length ? { skippedLayerIds: skipped } : {}),
    change: summary,
  };
}
type LayerPatchInput = { layerId: Id; cells: { x: number; y: number; cell: number }[] };
