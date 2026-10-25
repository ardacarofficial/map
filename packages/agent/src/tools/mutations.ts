import {
  FLIP_D,
  FLIP_H,
  FLIP_V,
  applySmartStampPlan,
  cellPaletteIndex,
  clipFromTileset,
  createStamp as captureStamp,
  defaultEntityFields,
  entityProblem,
  flipClip,
  floodFillRuns,
  isEntityLayer,
  isGridLayer,
  isTileLayer,
  isValidTileId,
  makeCell,
  makeStampId,
  normalizeStampMeta,
  orthogonalBridge,
  pasteClip,
  patchCellCount,
  planSmartStampArea,
  planSmartStampRoad,
  openEdgeRect,
  roadMembership,
  rotateClip,
  stampLayerMapping,
  stampMetaProblem,
  type LayerPatch,
  type MapStore,
  type SmartStampPlan,
  type Stamp,
  type TileClip,
  type TileLayer,
} from "@smap/core";
import {
  AGENT_LIMITS as L,
  AgentError,
  AgentErrorCode as E,
  type AgentCallContext,
  type ChangeSummary,
  type LayerInfo,
  type LayerKind,
  type PaintValue,
  type Point,
  type PreparedSmartSource,
  type ToolArguments,
  type ToolName,
} from "../contracts";
import { utf8ByteLength } from "../tags";
import { clearRegion, paintGrid, replaceTiles, wholeMap } from "./grid";
import { canonicalJson } from "../toolSchemas";
import { linePoints, rectanglePoints } from "../geometry";
import { layerProtectionKey, type Transactions, waitFor } from "../transactions";
import {
  budget,
  check,
  dimensions,
  fail,
  point,
  rect,
  uniquePoints,
} from "../validation";

/** Errors from a smart call whose inline source was prepared (and kept) but whose paint was undone. */
export const keptPreparations = new WeakMap<object, string>();
export const rawFlags = (flags: number) =>
  ((flags & 1 ? FLIP_H : 0) |
    (flags & 2 ? FLIP_V : 0) |
    (flags & 4 ? FLIP_D : 0)) >>>
  0;
export const compactFlags = (flags: number) =>
  ((flags & FLIP_H ? 1 : 0) |
    (flags & FLIP_V ? 2 : 0) |
    (flags & FLIP_D ? 4 : 0)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const layerKind = (layer: TileLayer): LayerKind =>
  isEntityLayer(layer) ? "entity" : isGridLayer(layer) ? "collision" : "tile";
export function layerInfo(store: MapStore, layer: TileLayer): LayerInfo {
  return {
    id: layer.id,
    name: layer.name,
    kind: layerKind(layer),
    index: store.document.indexOfLayer(layer.id),
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
  };
}
export function mapInfo(tx: Transactions, mapId: string, store: MapStore) {
  const summary = tx.host.world.maps().find((m) => m.id === mapId)!;
  return {
    id: mapId,
    name: summary.name,
    ...store.document.map,
    seed: store.document.seed,
    world: summary.world,
    mapRevision: store.revision,
  };
}
export function layer(store: MapStore, id: string): TileLayer {
  const found = store.document.getLayer(id);
  check(found, E.UNKNOWN_ID, "Unknown layer", { layerId: id, validIds: store.document.layers.map(l => l.id).slice(0, 128) });
  return found;
}
export function protect(
  tx: Transactions,
  mapId: string,
  target: TileLayer,
): void {
  const baseline = tx.pending!.protection.get(layerProtectionKey(mapId, target.id));
  check(
    !target.locked && !baseline?.locked,
    E.LAYER_LOCKED,
    "Layer was locked at begin or is currently locked",
    { mapId, layerId: target.id },
  );
  check(
    target.visible && !baseline?.hidden,
    E.LAYER_HIDDEN,
    "Layer was hidden at begin or is currently hidden",
    { mapId, layerId: target.id },
  );
}
export function tileValue(
  store: MapStore,
  value: PaintValue,
  kind: LayerKind,
): void {
  check(
    kind !== "entity",
    E.LAYER_KIND,
    "Cell tools require tile or collision layers",
  );
  if (value === null) return;
  if ("collision" in value)
    check(
      kind === "collision",
      E.LAYER_KIND,
      "Collision value requires collision layer",
    );
  else {
    check(kind === "tile", E.LAYER_KIND, "Tile value requires tile layer");
    const tileset = store.document.getTileset(value.tilesetId);
    check(
      tileset && isValidTileId(tileset, value.tileId),
      E.UNKNOWN_ID,
      "Unknown tileset or tile",
    );
  }
}
/** Bulk allocation owns one before/after pointer-array pair plus new entries.
 * Existing entries are shared immutable objects, so charge only their pointers. */
function paletteRetained(
  store: MapStore,
  refs: Iterable<{ tilesetId: string; tileId: number }>,
): number {
  const added = new Map<string, { tilesetId: string; tileId: number }>();
  for (const ref of refs)
    if (!store.document.palette.indexOf(ref.tilesetId, ref.tileId))
      added.set(JSON.stringify([ref.tilesetId, ref.tileId]), ref);
  const n = added.size,
    p = store.document.palette.size;
  return n === 0 ? 0 : (
    16 * p +
    8 * n +
    64 +
    [...added.values()].reduce(
      (total, ref) => total + 128 + ref.tilesetId.length * 2,
      0,
    )
  );
}
function cellValue(store: MapStore, value: PaintValue): number {
  if (!value) return 0;
  if ("collision" in value) return value.collision;
  return makeCell(
    store.document.palette.indexOf(value.tilesetId, value.tileId),
    rawFlags(value.flags ?? 0),
  );
}
export function change(
  mapId?: string,
  store?: MapStore,
  planned = 0,
  patches: readonly LayerPatch[] = [],
  layers: string[] = [],
  entities: string[] = [],
): ChangeSummary {
  return {
    plannedCells: planned,
    changedCells: patches.reduce((n, p) => n + patchCellCount(p), 0),
    affected:
      mapId && store
        ? patches.length
          ? patches
              .filter((p) => p.cells.length)
              .map((p) => {
                const xs = p.cells.map((c) => c.x),
                  ys = p.cells.map((c) => c.y),
                  x = Math.min(...xs),
                  y = Math.min(...ys);
                return {
                  mapId,
                  mapRevision: store.revision,
                  layerId: p.layerId,
                  bounds: {
                    x,
                    y,
                    width: Math.max(...xs) - x + 1,
                    height: Math.max(...ys) - y + 1,
                  },
                };
              })
          : [{ mapId, mapRevision: store.revision }]
        : [],
    createdLayerIds: layers,
    createdEntityIds: entities,
  };
}
export interface LayerWrites { layerId: string; writes: { x: number; y: number; value: PaintValue }[] }
/** Validate, charge and apply cell writes on one or more layers of one map as one store action. */
export function applyLayers(
  tx: Transactions,
  mapId: string,
  items: readonly LayerWrites[],
  perLayer: number = L.cellsPerCall,
  extra?: () => void,
  extraRetained = 0,
) {
  const store = tx.store(mapId);
  check(new Set(items.map((i) => i.layerId)).size === items.length, E.INVALID_ARGUMENT, "Each layer may appear once per call");
  const targets = items.map((item) => {
    const target = layer(store, item.layerId);
    protect(tx, mapId, target);
    uniquePoints(item.writes);
    budget(item.writes.length, perLayer);
    // Uniform tools share one value object; validate each distinct value once.
    const seen = new Set<PaintValue>(), kind = layerKind(target);
    for (const w of item.writes) {
      point(store, w);
      if (!seen.has(w.value)) { seen.add(w.value); tileValue(store, w.value, kind); }
    }
    return target;
  });
  for (const item of items) tx.authorizeCells(mapId, item.layerId, item.writes);
  const refs = items.flatMap((i) => i.writes.flatMap((w) => w.value && "tilesetId" in w.value ? [w.value] : []));
  const planned = items.reduce((n, i) => n + i.writes.length, 0);
  const retained = planned * 32 + paletteRetained(store, refs) + extraRetained;
  tx.charge(planned, retained, perLayer * Math.max(1, items.length));
  const patches = tx.run(() => {
    store.dispatch({ type: "addPaletteEntries", entries: refs });
    extra?.();
    return items.flatMap((item, i) => {
      const target = targets[i]!;
      if (!item.writes.length) return [];
      return [isGridLayer(target)
        ? store.dispatch({ type: "paintGrid", layerId: item.layerId, cells: item.writes.map((w) => ({ x: w.x, y: w.y, value: cellValue(store, w.value) })) })
        : store.dispatch({ type: "paintCells", layerId: item.layerId, cells: item.writes.map((w) => ({ x: w.x, y: w.y, cell: cellValue(store, w.value) })) })];
    });
  });
  const result = change(mapId, store, planned, patches);
  tx.record(result, retained);
  return { change: result };
}
function applyPaint(
  tx: Transactions,
  mapId: string,
  layerId: string,
  writes: { x: number; y: number; value: PaintValue }[],
  perCall: number = L.cellsPerCall,
) {
  return applyLayers(tx, mapId, [{ layerId, writes }], perCall);
}
/** Internal results keep their change summary; api.ts turns them into the C3 envelope. */
export async function mutate<N extends ToolName>(
  tx: Transactions,
  name: N,
  args: ToolArguments[N],
  call: AgentCallContext,
): Promise<unknown> {
  return mutateRaw(tx, name, args, call);
}
export async function mutateRaw<N extends ToolName>(
  tx: Transactions,
  name: N,
  args: ToolArguments[N],
  call: AgentCallContext,
): Promise<unknown> {
  // Discriminated dispatch retains the exact frozen public DTOs at the boundary.
  switch (name) {
    case "paint_cells": {
      const a = args as ToolArguments["paint_cells"];
      check(
        (a.cells !== undefined) !== (a.points !== undefined) && (a.points === undefined) === (a.value === undefined),
        E.INVALID_ARGUMENT,
        "Supply either cells[] or points[] with one value",
      );
      if (a.points) {
        const value = a.value!;
        return applyPaint(tx, a.mapId, a.layerId, a.points.map(([x, y]) => ({ x, y, value })), L.gridCells);
      }
      return applyPaint(tx, a.mapId, a.layerId, a.cells!);
    }
    case "paint_grid":
      return paintGrid(tx, args as ToolArguments["paint_grid"]);
    case "replace_tiles":
      return replaceTiles(tx, args as ToolArguments["replace_tiles"]);
    case "clear_region":
      return clearRegion(tx, args as ToolArguments["clear_region"]);
    case "paint_rect": {
      const a = args as ToolArguments["paint_rect"];
      rect(tx.store(a.mapId), a.region);
      return applyPaint(
        tx,
        a.mapId,
        a.layerId,
        rectanglePoints(a.region, a.outline).map((p) => ({
          ...p,
          value: a.value,
        })),
        L.mapArea,
      );
    }
    case "paint_line": {
      const a = args as ToolArguments["paint_line"];
      point(tx.store(a.mapId), a.from);
      point(tx.store(a.mapId), a.to);
      return applyPaint(
        tx,
        a.mapId,
        a.layerId,
        linePoints(a.from, a.to, a.width).map((p) => ({
          ...p,
          value: a.value,
        })),
      );
    }
    case "fill": {
      const f = args as ToolArguments["fill"],
        store = tx.store(f.mapId),
        a = { ...f, region: f.region ?? wholeMap(store) },
        target = layer(store, a.layerId);
      protect(tx, a.mapId, target);
      rect(store, a.region);
      budget(a.region.width * a.region.height, L.mapArea);
      point(store, a.start);
      check(
        a.start.x >= a.region.x &&
          a.start.y >= a.region.y &&
          a.start.x < a.region.x + a.region.width &&
          a.start.y < a.region.y + a.region.height,
        E.OUT_OF_BOUNDS,
        "Fill seed outside search region",
      );
      tileValue(store, a.value, layerKind(target));
      const replacement =
        a.value === null
          ? 0
          : "collision" in a.value
            ? a.value.collision
            : makeCell(
                store.document.palette.indexOf(
                  a.value.tilesetId,
                  a.value.tileId,
                ),
                rawFlags(a.value.flags ?? 0),
              );
      // A missing palette reference cannot equal any occupied target, including empty cell 0.
      const existing =
        a.value && !("collision" in a.value)
          ? store.document.palette.indexOf(
              a.value.tilesetId,
              a.value.tileId,
            ) !== 0
          : true;
      const runs = floodFillRuns(
        { getCell: (x, y) => target.getCell(x + a.region.x, y + a.region.y) },
        a.start.x - a.region.x,
        a.start.y - a.region.y,
        existing ? replacement : 0xffffffff,
        a.region,
      );
      const points: Point[] = [];
      for (const run of runs)
        for (let x = run.left; x <= run.right; x++) {
          points.push({ x: x + a.region.x, y: run.y + a.region.y });
          budget(points.length, a.maxCells ?? L.fillCells);
        }
      const result = applyPaint(
        tx,
        a.mapId,
        a.layerId,
        points.map((p) => ({ ...p, value: a.value })),
        L.mapArea,
      );
      return { ...result, filledCells: points.length };
    }
    case "edit_layer": {
      const a = args as ToolArguments["edit_layer"],
        store = tx.store(a.mapId);
      if (a.action === "create") {
        budget(store.document.layers.length + 1, L.layersPerMap);
        check(
          a.index === undefined || a.index <= store.document.layers.length,
          E.OUT_OF_BOUNDS,
          "Layer index outside stack",
        );
      } else {
        layer(store, a.layerId);
        if (a.action === "reorder")
          check(
            a.index < store.document.layers.length,
            E.OUT_OF_BOUNDS,
            "Layer index outside stack",
          );
      }
      tx.charge(0);
      const id = tx.run(() => {
        if (a.action === "create")
          return store.dispatch({
            type: "addLayer",
            layer: {
              name: a.name,
              ...(a.kind === "collision"
                ? ({ type: "grid", role: "collision" } as const)
                : { type: a.kind }),
            },
            ...(a.index === undefined ? {} : { index: a.index }),
          });
        if (a.action === "update")
          store.dispatch({
            type: "setLayerProps",
            layerId: a.layerId,
            props: a.props,
          });
        else
          store.dispatch({
            type: "moveLayer",
            layerId: a.layerId,
            index: a.index,
          });
        return a.layerId;
      });
      // The draft's own unlock/show counts: later calls in this draft may paint the layer.
      if (a.action === "update" && (a.props.locked === false || a.props.visible === true)) {
        const key = layerProtectionKey(a.mapId, a.layerId), initial = tx.pending!.protection.get(key);
        if (initial) tx.pending!.protection.set(key, {
          locked: a.props.locked === false ? false : initial.locked,
          hidden: a.props.visible === true ? false : initial.hidden,
        });
      }
      const result = change(
        a.mapId,
        store,
        0,
        [],
        a.action === "create" ? [id] : [],
      );
      tx.record(result);
      return { change: result, layer: layerInfo(store, layer(store, id)) };
    }
    case "place_entity": {
      const a = args as ToolArguments["place_entity"],
        store = tx.store(a.mapId),
        target = layer(store, a.layerId);
      protect(tx, a.mapId, target);
      check(isEntityLayer(target), E.LAYER_KIND, "Entity layer required");
      point(store, a.at);
      const type = store.document.getEntityType(a.typeId);
      check(type, E.UNKNOWN_ID, "Unknown entity type");
      const entity = {
        id: tx.host.ids.next("entity"),
        typeId: a.typeId,
        x: a.at.x * store.document.map.tileWidth,
        y: a.at.y * store.document.map.tileHeight,
        fields: { ...defaultEntityFields(type), ...a.fields },
      };
      const problem = entityProblem(entity, store.document.map, type);
      check(!problem, E.ENTITY_SCHEMA, problem ?? "Invalid entity");
      check(
        a.typeId !== "spawn" || !store.document.spawn(),
        E.ENTITY_SCHEMA,
        "Map already has a spawn point",
      );
      for (const field of type.fields) {
        const value = entity.fields[field.name];
        if (field.type === "levelRef" && value !== null)
          check(
            tx.host.world.maps().some((m) => m.id === value),
            E.ENTITY_SCHEMA,
            "Unknown target map",
          );
      }
      if (
        a.typeId === "portal" &&
        entity.fields["targetLevel"] !== null &&
        entity.fields["targetPoint"] !== null
      ) {
        const targetId = entity.fields["targetLevel"];
        check(
          typeof targetId === "string",
          E.ENTITY_SCHEMA,
          "Portal target requires a map",
        );
        const targetStore = await waitFor(
          tx.host.loadMap(targetId),
          call.signal,
        );
        tx.owned(a.context, call);
        const p = entity.fields["targetPoint"];
        check(
          typeof p === "object" &&
            p !== null &&
            p.x >= 0 &&
            p.y >= 0 &&
            p.x <
              targetStore.document.map.width *
                targetStore.document.map.tileWidth &&
            p.y <
              targetStore.document.map.height *
                targetStore.document.map.tileHeight,
          E.ENTITY_SCHEMA,
          "Portal target point outside target map",
        );
      }
      tx.authorizeEntity(a.mapId,a.layerId,null,entity);
      const retained = 512 + utf8ByteLength(JSON.stringify(entity)) * 2;
      tx.charge(0, retained);
      tx.run(() =>
        store.dispatch({ type: "addEntity", layerId: a.layerId, entity }),
      );
      const result = change(a.mapId, store, 0, [], [], [entity.id]);
      tx.record(result, retained);
      return {
        change: result,
        entity: {
          id: entity.id,
          typeId: entity.typeId,
          layerId: a.layerId,
          pixelX: entity.x,
          pixelY: entity.y,
          fields: entity.fields,
        },
      };
    }
    case "resize_map": {
      const a = args as ToolArguments["resize_map"],
        store = tx.store(a.mapId);
      dimensions(a.width, a.height);
      let cells = 0,
        entities = 0,
        retained = 0;
      for (const l of store.document.layers) {
        let cropped = false;
        if (isEntityLayer(l))
          for (const e of l.entities) {
            if (
              e.x >= a.width * store.document.map.tileWidth ||
              e.y >= a.height * store.document.map.tileHeight
            ) {
              entities++;
              cropped = true;
            }
            retained += 512;
          }
        else
          for (const chunk of l.chunks()) {
            retained += chunk.data.byteLength * 2;
            for (let i = 0; i < chunk.data.length; i++)
              if (
                chunk.data[i] &&
                (chunk.cx * 32 + (i % 32) >= a.width ||
                  chunk.cy * 32 + Math.floor(i / 32) >= a.height)
              ) {
                cells++;
                cropped = true;
              }
          }
        if (cropped) protect(tx, a.mapId, l);
      }
      check(
        a.allowCrop || cells + entities === 0,
        E.CROP_REQUIRES_EXPLICIT_ALLOW,
        `Resize removes ${cells} cells and ${entities} entities`,
      );
      tx.charge(0, retained);
      tx.run(() =>
        store.dispatch({ type: "resizeMap", width: a.width, height: a.height }),
      );
      const result = change(a.mapId, store);
      tx.record(result, retained);
      return {
        change: result,
        map: mapInfo(tx, a.mapId, store),
        cropped: { cells, entities },
      };
    }
    case "create_map": {
      const a = args as ToolArguments["create_map"];
      dimensions(a.width, a.height);
      budget(tx.pending!.summary.affectedMapIds.length + 1, L.targetMaps);
      tx.charge(0);
      const prepared = await waitFor(
        tx.host.world.prepareAgentMap(a, call.signal),
        call.signal,
      );
      tx.owned(a.context, call);
      check(
        !prepared.store.inTransaction &&
          !tx.pending!.participants.has(prepared.map.id),
        E.INTERNAL_ERROR,
        "Prepared map must be new and transaction-free",
      );
      const lease = tx.host.transactions.acquireLease(
        prepared.map.id,
        prepared.store,
        tx.pending!,
      );
      const participant = {
        store: prepared.store,
        lease,
        target: true,
        pin: () => {},
      };
      tx.pending!.participants.set(prepared.map.id, participant);
      tx.pending!.created.push(prepared.map.id);
      tx.pending!.summary.affectedMapIds.push(prepared.map.id);
      tx.run(() => {
        tx.host.world.stageAgentMap(prepared);
        participant.pin = tx.host.world.pinMap(prepared.map.id);
        prepared.store.beginTransaction(tx.pending!.summary.label);
        // A new map starts from approved metadata, then joins staged atlas changes reversibly.
        for (const tileset of tx.host.world.tilesets())
          if (!prepared.store.document.getTileset(tileset.id))
            prepared.store.dispatch({ type: "addTileset", tileset, undoable: true });
        const templates = tx.host.world.settings().layerTemplate;
        for (const template of templates.length
          ? templates
          : [{ name: "Ground", kind: "tile" as const }])
          prepared.store.dispatch({
            type: "addLayer",
            layer: {
              name: template.name,
              ...(template.kind === "collision"
                ? ({ type: "grid", role: "collision" } as const)
                : { type: template.kind }),
            },
          });
      });
      const result = change(
        prepared.map.id,
        prepared.store,
        0,
        [],
        prepared.store.document.layers.map((l) => l.id),
      );
      tx.record(result);
      return {
        change: result,
        map: prepared.map,
        layers: prepared.store.document.layers.map((l) =>
          layerInfo(prepared.store, l),
        ),
      };
    }
    case "place_stamp": {
      const a = args as ToolArguments["place_stamp"];
      if (!a.positions) {
        check(a.at, E.INVALID_ARGUMENT, "place_stamp: supply at or positions", { nextAction: "Add at:{x,y} (top-left cell) or positions:[[x,y],...]." });
        return place(tx, a);
      }
      check(!a.at, E.INVALID_ARGUMENT, "place_stamp: use either at or positions, not both");
      uniquePoints(a.positions.map(([x, y]) => ({ x, y })));
      // Every copy is one outer action: a single revision and one undo step with the rest of the call.
      return tx.run(() => {
        const results = a.positions!.map(([x, y], i) => {
          try { return place(tx, { ...a, at: { x, y } }); }
          catch (error) {
            if (error instanceof AgentError) throw new AgentError(error.code, `positions[${i}]: ${error.message}`, { ...error.details, operationIndex: i }, error.retryable);
            throw error;
          }
        });
        return { ...results[results.length - 1]!, change: {
          plannedCells: results.reduce((sum, r) => sum + r.change.plannedCells, 0),
          changedCells: results.reduce((sum, r) => sum + r.change.changedCells, 0),
          affected: results.flatMap(r => r.change.affected),
          createdLayerIds: results.flatMap(r => r.change.createdLayerIds),
          createdEntityIds: [],
        } };
      });
    }
    case "create_stamp":
      return createStamp(tx, args as ToolArguments["create_stamp"]);
    case "prepare_smart_source":
      return prepare(tx, args as ToolArguments["prepare_smart_source"], call);
    case "smart_brush":
    case "draw_path": {
      const a = args as ToolArguments["smart_brush"] | ToolArguments["draw_path"];
      if (a.source === undefined) {
        check(a.sourceId !== undefined, E.INVALID_ARGUMENT, "sourceId or source is required");
        return smart(tx, name, a);
      }
      check(a.sourceId === undefined, E.INVALID_ARGUMENT, "Use either sourceId or source, not both");
      // Inline source: reuse this edit's preparation of the same art, otherwise prepare it now.
      // Reject an unusable target/geometry first, so a failing call does not stage a new atlas.
      const store = tx.store(a.mapId), target = layer(store, a.layerId);
      protect(tx, a.mapId, target);
      check(isTileLayer(target), E.LAYER_KIND, "Smart brush requires tile layer");
      if (name === "draw_path") for (const p of (a as ToolArguments["draw_path"]).points) point(store, p);
      else if ("region" in a && a.region) rect(store, a.region);
      if (!reusablePrepared(tx, a.mapId, a.source, false)) tx.assertGlobal(call);
      const prepared = await prepare(tx, { context: a.context, mapId: a.mapId, source: a.source }, call);
      // The preparation (generated atlas, recipe) stays in the draft for reuse; if painting fails,
      // undo only the paint so the call reports applied:false instead of "may have been applied".
      const afterPrepare = tx.checkpoint();
      const { source: _inline, ...rest } = a;
      try {
        return smart(tx, name, { ...rest, sourceId: prepared.sourceId } as ToolArguments["smart_brush"] | ToolArguments["draw_path"]);
      } catch (error) {
        if (afterPrepare && error !== null && typeof error === "object" && tx.rollbackCall(afterPrepare)) keptPreparations.set(error, prepared.sourceId);
        throw error;
      }
    }
    default:
      fail(E.INVALID_ARGUMENT, "Unknown mutation");
  }
}

/** Capture library metadata inside the same approval/undo journal as map edits.
 * Paths and caller-provided ids are deliberately absent from this operation. */
function createStamp(tx: Transactions, a: ToolArguments["create_stamp"]) {
  const name = a.name.trim();
  check(name.length > 0, E.INVALID_ARGUMENT, "Stamp name must not be blank");
  const problem = stampMetaProblem(a);
  check(!problem, E.INVALID_ARGUMENT, problem ?? "Invalid stamp metadata");
  const snapshot = tx.host.metadata.snapshot(),
    before = [...tx.host.world.stamps()],
    taken = [
      ...before.map(s => s.id),
      ...snapshot.brokenStampFiles.map(path =>
        path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, ""),
      ),
    ],
    meta = { id: makeStampId(name, taken), name, ...normalizeStampMeta(a) },
    source = a.source,
    area = source.region.width * source.region.height;
  let stamp: Stamp, retained: number;
  if ("mapId" in source) {
    const store = tx.store(source.mapId);
    rect(store, source.region);
    check(source.layerIds.length > 0 && new Set(source.layerIds).size === source.layerIds.length,
      E.INVALID_ARGUMENT, "Select unique stamp source layers");
    for (const id of source.layerIds)
      check(!isEntityLayer(layer(store, id)), E.LAYER_KIND, "Stamp sources require tile or collision layers");
    // Preserve the map's stack order even when the caller lists ids in another order.
    const selected = store.document.layers.filter(l => source.layerIds.includes(l.id));
    budget(area * selected.length);
    const maxIdLength = store.document.tilesets.reduce((max, t) => Math.max(max, t.id.length), 0);
    retained = 2048 + before.length * 16 + area * selected.length * 8 +
      Math.min(area * selected.filter(isTileLayer).length, store.document.palette.size) * (128 + maxIdLength * 2);
    tx.charge(0, retained);
    stamp = captureStamp(store.document, selected.map(l => l.id), source.region, meta);
    for (const ref of stamp.palette) tileValue(store, ref, "tile");
  } else {
    const tileset = tx.host.world.tilesets().find(t => t.id === source.tilesetId);
    check(tileset, E.UNKNOWN_ID, "Unknown tileset");
    check(source.region.x + source.region.width <= tileset.columns &&
      source.region.y + source.region.height <= tileset.rows,
      E.OUT_OF_BOUNDS, "Stamp source outside tileset");
    budget(area);
    // Edited atlases reserve sheet capacity beyond their allocated tile prefix.
    for (let y = source.region.y; y < source.region.y + source.region.height; y++)
      for (let x = source.region.x; x < source.region.x + source.region.width; x++)
        check(isValidTileId(tileset, y * tileset.columns + x), E.UNKNOWN_ID,
          "Stamp source references an unavailable tile");
    retained = 2048 + before.length * 16 + area * (136 + tileset.id.length * 2);
    tx.charge(0, retained);
    const clip = clipFromTileset(tileset, {
      x: source.region.x, y: source.region.y,
      w: source.region.width, h: source.region.height,
    });
    check(clip, E.INVALID_ARGUMENT, "Stamp source is empty");
    stamp = Object.freeze({ ...meta, ...clip });
  }
  check(stamp.layers.some(l => l.cells.some(Boolean)), E.INVALID_ARGUMENT, "Stamp source is empty");
  tx.run(() => tx.host.metadata.stage({ kind: "stamps", before, after: [...before, stamp] }));
  const result = change();
  tx.record(result, retained);
  return { change: result, stampId: stamp.id, name: stamp.name, width: stamp.width,
    height: stamp.height, sourceLayerIds: stamp.layers.map(l => l.layerId) };
}

function transform(stamp: Stamp, a: ToolArguments["place_stamp"]): TileClip {
  let clip: TileClip = stamp;
  for (let i = 0; i < (a.rotation ?? 0); i++) clip = rotateClip(clip, "cw");
  if (a.flipX) clip = flipClip(clip, "x");
  if (a.flipY) clip = flipClip(clip, "y");
  return clip;
}
function place(tx: Transactions, a: ToolArguments["place_stamp"]) {
  const store = tx.store(a.mapId),
    stamp = tx.host.world.stamps().find((s) => s.id === a.stampId);
  check(stamp, E.UNKNOWN_ID, "Unknown stamp");
  const clip = transform(stamp, a);
  rect(store, { ...a.at, width: clip.width, height: clip.height });
  const mapping = new Map<string, string>(),
    needed = clip.layers.filter(
      (l) => a.emptyCells === "erase" || l.cells.some(Boolean),
    );
  const planned = needed.reduce(
    (sum, l) =>
      sum +
      (a.emptyCells === "erase"
        ? l.cells.length
        : l.cells.filter(Boolean).length),
    0,
  );
  budget(planned);
  const create: (typeof clip.layers)[number][] = [];
  if (a.layerMapping) {
    check(
      new Set(a.layerMapping.map((m) => m.sourceLayerId)).size ===
        a.layerMapping.length &&
        new Set(a.layerMapping.map((m) => m.targetLayerId)).size ===
          a.layerMapping.length,
      E.STAMP_MAPPING_REQUIRED,
      "Duplicate layer mapping",
    );
    for (const m of a.layerMapping) {
      check(
        clip.layers.some((l) => l.layerId === m.sourceLayerId),
        E.UNKNOWN_ID,
        "Unknown stamp layer",
      );
      mapping.set(m.sourceLayerId, m.targetLayerId);
    }
    check(
      needed.every((l) => mapping.has(l.layerId)),
      E.STAMP_MAPPING_REQUIRED,
      "Map every nonempty stamp layer",
    );
  } else {
    const inferred = stampLayerMapping(store.document, clip);
    // Reserve every inferred destination before testing unmatched layers. A
    // later named match must not look available to an earlier missing layer.
    for (const l of needed) {
      const target = inferred.find((m) => m.clipLayerId === l.layerId)!.targetLayerId;
      if (target) mapping.set(l.layerId, target);
    }
    for (const l of needed) {
      if (!mapping.has(l.layerId)) {
        const candidates = store.document.layers.filter(
          (t) =>
            !isEntityLayer(t) &&
            isGridLayer(t) === !!l.grid &&
            (!l.grid ||
              !isGridLayer(t) ||
              t.role === (l.role ?? "collision")) &&
            ![...mapping.values()].includes(t.id),
        );
        check(
          candidates.length === 0,
          E.STAMP_MAPPING_REQUIRED,
          "Ambiguous stamp destination; supply a mapping",
        );
        check(
          a.allowCreateLayers,
          E.STAMP_MAPPING_REQUIRED,
          "Missing destination layer; allow layer creation",
        );
        create.push(l);
      }
    }
  }
  check(!tx.pending!.collaboration||!create.length,E.EXCLUSIVE_OPERATION_REQUIRED,"Collaborative stamps require existing claimed destination layers");
  budget(store.document.layers.length + create.length, L.layersPerMap);
  for (const [source, targetId] of mapping) {
    const sourceLayer = clip.layers.find((l) => l.layerId === source)!,
      target = layer(store, targetId);
    protect(tx, a.mapId, target);
    check(
      !isEntityLayer(target) &&
        isGridLayer(target) === !!sourceLayer.grid &&
        (!isGridLayer(target) ||
          target.role === (sourceLayer.role ?? "collision")),
      E.LAYER_KIND,
      "Stamp target kind mismatch",
    );
    if (sourceLayer.grid)
      check(
        sourceLayer.cells.every((v) => v <= 2),
        E.LAYER_KIND,
        "Invalid collision stamp",
      );
  }
  const refs = new Map<string, { tilesetId: string; tileId: number }>();
  for (const l of needed)
    if (!l.grid)
      for (const cell of l.cells)
        if (cell) {
          const ref = clip.palette[cellPaletteIndex(cell) - 1];
          check(ref, E.UNKNOWN_ID, "Invalid stamp palette");
          tileValue(store, ref, "tile");
          refs.set(`${ref.tilesetId}:${ref.tileId}`, ref);
        }
  for(const sourceLayer of needed){const targetId=mapping.get(sourceLayer.layerId);if(targetId){const points=[];for(let i=0;i<sourceLayer.cells.length;i++)if(a.emptyCells==="erase"||sourceLayer.cells[i])points.push({x:a.at.x+i%clip.width,y:a.at.y+Math.floor(i/clip.width)});tx.authorizeCells(a.mapId,targetId,points);}}
  const retained =
    planned * 32 + paletteRetained(store, refs.values()) + create.length * 512;
  tx.charge(planned, retained);
  const created: string[] = [];
  const patches = tx.run(() => {
    for (const l of create) {
      const previous = needed[needed.indexOf(l) - 1],
        previousId = previous && mapping.get(previous.layerId);
      const id = store.dispatch({
        type: "addLayer",
        index: previousId ? store.document.indexOfLayer(previousId) + 1 : 0,
        layer: {
          name: l.name,
          ...(l.grid
            ? ({ type: "grid", role: l.role ?? "collision" } as const)
            : { type: "tile" }),
        },
      });
      created.push(id);
      mapping.set(l.layerId, id);
    }
    store.dispatch({ type: "addPaletteEntries", entries: [...refs.values()] });
    return pasteClip(store, clip, mapping, a.at.x, a.at.y, {
      emptyCells: a.emptyCells ?? "skip",
    });
  });
  const result = change(a.mapId, store, planned, patches, created);
  tx.record(result, retained);
  return {
    change: result,
    stampId: stamp.id,
    layerMapping: [...mapping].map(([sourceLayerId, targetLayerId]) => ({
      sourceLayerId,
      targetLayerId,
    })),
    transformedSize: { width: clip.width, height: clip.height },
  };
}
/** Preparation identity inside one edit: same map, same source art and same force choice. */
const preparedKeys = new WeakMap<PreparedSmartSource, string>();
const preparedKey = (mapId: string, source: ToolArguments["prepare_smart_source"]["source"], force: boolean) =>
  canonicalJson(["stampId" in source ? { stampId: source.stampId } : { tilesetId: source.tilesetId, region: source.region }, mapId, force]);
function reusablePrepared(tx: Transactions, mapId: string, source: ToolArguments["prepare_smart_source"]["source"], force: boolean): PreparedSmartSource | undefined {
  const key = preparedKey(mapId, source, force);
  return tx.pending?.sources.find(s => preparedKeys.get(s) === key && s.mapId === mapId && s.transactionId === tx.pending!.summary.id && tx.host.smartSources.get(s.sourceId) === s);
}
function preparedData(result: ReturnType<typeof change>, source: PreparedSmartSource, mapId: string) {
  return {
    change: result,
    sourceId: source.sourceId,
    mapId,
    band: source.band,
    usages: source.usages,
    detectorVersion: source.detectorVersion,
    fingerprint: source.fingerprint,
    forced: source.forced,
    generatedTilesetIds: source.generatedTilesetIds,
    layerMapping: source.layerMapping,
  };
}
async function prepare(
  tx: Transactions,
  a: ToolArguments["prepare_smart_source"],
  call: AgentCallContext,
) {
  const store = tx.store(a.mapId);
  // Repeating a preparation in the same edit returns the existing handle: no second bake or atlas.
  const reuse = reusablePrepared(tx, a.mapId, a.source, !!a.force);
  if (reuse) {
    let current = true;
    try { tx.host.smartSources.assertCurrent(reuse); } catch { current = false; }
    if (current) {
      tx.owned(a.context, call);
      const result = change(a.mapId, store);
      tx.record(result, 0);
      return preparedData(result, reuse, a.mapId);
    }
  }
  if ("tilesetId" in a.source) {
    const ts = store.document.getTileset(a.source.tilesetId);
    check(ts, E.UNKNOWN_ID, "Unknown tileset");
    check(
      ts.tileWidth === store.document.map.tileWidth &&
        ts.tileHeight === store.document.map.tileHeight,
      E.GRID_MISMATCH,
      "Source and map native grids differ",
    );
    check(
      a.source.region.x + a.source.region.width <= ts.columns &&
        a.source.region.y + a.source.region.height <= ts.rows,
      E.OUT_OF_BOUNDS,
      "Source outside sheet",
    );
    check(
      a.source.region.width <= L.sourceWidth &&
        a.source.region.height <= L.sourceHeight,
      E.LIMIT_EXCEEDED,
      "Source rectangle exceeds 32 by 32",
    );
  } else {
    const stampId = a.source.stampId;
    const stamp = tx.host.world.stamps().find((s) => s.id === stampId);
    check(stamp, E.UNKNOWN_ID, "Unknown stamp");
    for (const ref of stamp.palette) {
      const ts = store.document.getTileset(ref.tilesetId);
      check(
        ts &&
          ts.tileWidth === store.document.map.tileWidth &&
          ts.tileHeight === store.document.map.tileHeight,
        E.GRID_MISMATCH,
        "Stamp and map native grids differ",
      );
    }
  }
  const preparation = tx.host.smartSources.prepare(a, call, bytes => {
    call.signal.throwIfAborted();
    tx.owned(a.context, call);
    tx.charge(0, bytes);
  }).then(source => {
    try { call.signal.throwIfAborted(); return source; }
    catch (error) { tx.host.smartSources.discard(source); throw error; }
  });
  const source = await waitFor(preparation, call.signal);
  try {
    tx.owned(a.context, call);
    await tx.enlistCached(call);
    tx.owned(a.context, call);
    tx.host.smartSources.assertCurrent(source);
    check(
      source.transactionId === tx.pending!.summary.id && source.mapId === a.mapId,
      E.SOURCE_CHANGED,
      "Foreign prepared source",
    );
    tx.charge(0, source.retainedBytes);
    // Host publication stages metadata/assets. Map additions themselves remain store operations.
    tx.run(() => {
      for (const ts of source.tilesets)
        if (!store.document.getTileset(ts.id))
          store.dispatch({ type: "addTileset", tileset: ts, undoable: true });
      tx.host.smartSources.publish(source);
    });
  } catch (error) {
    tx.host.smartSources.discard(source);
    throw error;
  }
  tx.pending!.sources.push(source);
  preparedKeys.set(source, preparedKey(a.mapId, a.source, !!a.force));
  const result = change(a.mapId, store);
  tx.record(result, source.retainedBytes);
  return preparedData(result, source, a.mapId);
}
function smart(
  tx: Transactions,
  name: "smart_brush" | "draw_path",
  a: ToolArguments["smart_brush"] | ToolArguments["draw_path"],
) {
  // Keep branch validation before source checks and planning as a second guard
  // for internal callers. Invalid payloads must preserve earlier pending work.
  if (name === "smart_brush") {
    const brush = a as ToolArguments["smart_brush"];
    check(
      brush.mode === "area"
        ? "region" in brush && !!brush.region && !("cells" in brush) && (!("erase" in brush) || brush.erase === false)
        : brush.mode === "road" && "cells" in brush && Array.isArray(brush.cells) && !("region" in brush),
      E.INVALID_ARGUMENT,
      "Area requires region only; road requires cells and optional erase",
    );
  }
  const store = tx.store(a.mapId),
    source = tx.host.smartSources.get(a.sourceId!),
    // Agents draw rivers/roads/lakes that continue past the map border unless they opt out.
    openEdges = a.openEdges !== false;
  check(source, E.UNKNOWN_ID, "Unknown source handle");
  check(
    source.transactionId === tx.pending!.summary.id && source.mapId === a.mapId,
    E.SOURCE_CHANGED,
    "Source belongs to another map or transaction",
  );
  tx.host.smartSources.assertCurrent(source);
  const target = layer(store, a.layerId);
  protect(tx, a.mapId, target);
  check(isTileLayer(target), E.LAYER_KIND, "Smart brush requires tile layer");
  check(
    !(rawFlags(a.orientation ?? 0) & FLIP_D) ||
      store.document.map.tileWidth === store.document.map.tileHeight,
    E.GRID_MISMATCH,
    "Smart quarter turns require square map cells",
  );
  const area = "mode" in a && a.mode === "area";
  check(
    source.usages.includes(area ? "area" : "road"),
    E.SOURCE_NOT_SMART,
    "Source does not support requested usage",
  );
  let points: Point[] = [],
    snapped: Point[] = [],
    width = 1;
  if (name === "draw_path") {
    const path = a as ToolArguments["draw_path"],
      band = source.band;
    width = path.width ?? 1;
    for (const p of path.points) point(store, p);
    const macro = path.points.map((p) => ({
      x: Math.floor(p.x / band),
      y: Math.floor(p.y / band),
    }));
    snapped = macro.map((p) => ({ x: p.x * band, y: p.y * band }));
    const members = new Map<string, Point>(),
      low = -Math.floor((width - 1) / 2);
    for (let i = 1; i < macro.length; i++)
      for (const p of orthogonalBridge(macro[i - 1]!, macro[i]!))
        for (let y = low; y < low + width; y++)
          for (let x = low; x < low + width; x++) {
            for (let by = 0; by < band; by++)
              for (let bx = 0; bx < band; bx++) {
                const q = {
                  x: (p.x + x) * band + bx,
                  y: (p.y + y) * band + by,
                };
                // Points are validated above; a wide path may extend past the border and is clipped there.
                if (!store.document.inBounds(q.x, q.y)) continue;
                members.set(`${q.x},${q.y}`, q);
                budget(members.size);
              }
          }
    points = [...members.values()];
  } else if (!area) {
    points = (a as Extract<ToolArguments["smart_brush"], { mode: "road" }>)
      .cells;
    uniquePoints(points);
    const expanded: Point[] = [];
    for (const p of points) {
      check(
        p.x % source.band === 0 && p.y % source.band === 0,
        E.INVALID_ARGUMENT,
        "Road cells must align to the source band grid",
      );
      for (let y = 0; y < source.band; y++)
        for (let x = 0; x < source.band; x++) {
          const cell = { x: p.x + x, y: p.y + y };
          point(store, cell);
          expanded.push(cell);
          budget(expanded.length);
        }
    }
    points = expanded;
  }
  if (area) {
    const region = (
      a as Extract<ToolArguments["smart_brush"], { mode: "area" }>
    ).region;
    rect(store, region);
    budget(region.width * region.height);
  }
  const mapping = strictSmartMapping(tx, source, a.mapId, a.layerId, area);
  const options = {
    revision: store.revision,
    orientation: rawFlags(a.orientation ?? 0),
    mapping,
  };
  const areaRegion = area ? (a as Extract<ToolArguments["smart_brush"], { mode: "area" }>).region : undefined;
  const planRect = areaRegion && openEdges ? openEdgeRect(store.document, source.stamp, areaRegion) : areaRegion;
  const planNow = (): SmartStampPlan =>
    area
      ? planSmartStampArea(
          store.document,
          source.stamp,
          planRect!,
          { ...options, revision: store.revision },
        )
      : planSmartStampRoad(
          store.document,
          source.stamp,
          a.layerId,
          roadMembership(points),
          {
            ...options,
            revision: store.revision,
            erase: "erase" in a && !!a.erase,
            openEdges,
          },
        );
  let plan: SmartStampPlan;
  try {
    plan = planNow();
  } catch (error) {
    fail(
      E.SOURCE_NOT_SMART,
      error instanceof Error ? error.message : "Incompatible smart source",
    );
  }
  const planned = plan.layers.reduce((n, l) => n + l.writes.length, 0);
  const retained =
    planned * 32 +
    paletteRetained(
      store,
      plan.layers.flatMap((l) =>
        l.writes.flatMap((w) => ("tile" in w && w.tile ? [w.tile] : [])),
      ),
    );
  tx.charge(planned, retained);
  for (const l of plan.layers) {
    if (l.layerId) protect(tx, a.mapId, layer(store, l.layerId));
    for (const w of l.writes) point(store, w);
    check(l.layerId||!tx.pending!.collaboration,E.EXCLUSIVE_OPERATION_REQUIRED,"Collaborative smart brushes require existing claimed layers");
    if(l.layerId)tx.authorizeCells(a.mapId,l.layerId,l.writes);
  }
  const result = tx.run(() => {
    store.dispatch({
      type: "addPaletteEntries",
      entries: plan.layers.flatMap((l) => l.writes.flatMap((w) => "tile" in w && w.tile ? [w.tile] : [])),
    });
    // Reversible pre-registration advances the store revision. Replan against that exact revision.
    plan = planNow();
    return applySmartStampPlan(store, plan);
  });
  const summary = change(a.mapId, store, planned, result.patches, [
    ...result.createdLayerIds,
  ]);
  tx.record(summary, retained);
  const input = new Set(points.map((p) => `${p.x},${p.y}`));
  const repairs = area
    ? 0
    : plan.layers.reduce(
        (n, l) =>
          n + l.writes.filter((w) => !input.has(`${w.x},${w.y}`)).length,
        0,
      );
  if (name === "draw_path")
    return {
      change: summary,
      sourceId: source.sourceId,
      kind: (a as ToolArguments["draw_path"]).kind,
      band: source.band,
      snappedPoints: snapped,
      widthInTiles: width * source.band,
      neighborRepairs: repairs,
    };
  return {
    change: summary,
    sourceId: source.sourceId,
    band: source.band,
    neighborRepairs: repairs,
    layerMapping: [...result.layerMapping].map(
      ([sourceLayerId, targetLayerId]) => ({ sourceLayerId, targetLayerId }),
    ),
  };
}
function strictSmartMapping(
  tx: Transactions,
  source: PreparedSmartSource,
  mapId: string,
  layerId: string,
  area: boolean,
) {
  const store = tx.store(mapId);
  return source.stamp.layers.map((l) => {
    const targetId =
      source.stamp.layers.length === 1
        ? layerId
        : source.layerMapping.find((m) => m.sourceLayerId === l.layerId)
            ?.targetLayerId;
    check(
      targetId,
      E.STAMP_MAPPING_REQUIRED,
      "Smart source requires complete destination mapping",
    );
    const target = layer(store, targetId);
    protect(tx, mapId, target);
    if (area)
      check(
        !isEntityLayer(target) &&
          isGridLayer(target) === !!l.grid &&
          (!isGridLayer(target) || target.role === (l.role ?? "collision")),
        E.LAYER_KIND,
        "Smart source layer kind mismatch",
      );
    return { clipLayerId: l.layerId, name: l.name, targetLayerId: targetId };
  });
}
