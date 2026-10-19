import { isTileLayer } from '../layer';
import { parseLevel, serializeLevel } from '../serialize';
import { MapStore } from '../store';
import type { AddPaletteEntryOp, AddTilesetOp } from '../ops';
import { RasterAssets } from './assets';
import type { PixelOp } from './ops';
import type { WorldHistory } from './worldHistory';

/** Operations supported by a world pixel transaction. Shared raster writes occur in one participant only. */
export type WorldEditOperation = Exclude<PixelOp, { type: 'loadRasterAsset' }> | AddTilesetOp | AddPaletteEntryOp;
export interface WorldEditInput {
  readonly mapId: string;
  readonly store: MapStore;
  readonly operations: readonly WorldEditOperation[];
}
export interface WorldEditParticipant extends WorldEditInput { readonly revision: number }
export interface WorldEditPlan {
  readonly originMapId: string;
  readonly label?: string;
  readonly participants: readonly WorldEditParticipant[];
  readonly rasterVersions: readonly { readonly mapId: string; readonly assetId: string; readonly revision: number }[];
}
// Prepared operations stay private: caller-owned plan fields/buffers cannot change the commit.
const preparedPlans = new WeakMap<WorldEditPlan, WorldEditPlan>();

export interface WorldEditBlocker { readonly mapId: string; readonly layerId?: string; readonly reason: 'busy' | 'locked' | 'hidden' | 'missingLayer' | 'load' | 'invalid' | 'stale'; readonly detail?: string }
export class WorldEditError extends Error {
  constructor(readonly blockers: readonly WorldEditBlocker[]) { super(blockers.map(b => `${b.mapId}${b.layerId ? ` / ${b.layerId}` : ''}: ${b.reason}${b.detail ? ` (${b.detail})` : ''}`).join('\n')); this.name = 'WorldEditError'; }
}
function own(op: WorldEditOperation): WorldEditOperation {
  if (op.type === 'editTilePixels') return { ...op, after: op.after.slice(), ...(op.before ? { before: op.before.slice() } : {}) };
  if (op.type === 'patchPixels') return { ...op, patches: op.patches.map(p => ({ ...p, before: p.before.slice(), after: p.after.slice() })) };
  if (op.type === 'allocateEditedTile') return { ...op, pixels: op.pixels.slice(), ...(op.source ? { source: { ...op.source } } : {}) };
  if (op.type === 'addPaletteEntry') return { ...op, undoable: true };
  if (op.type === 'addTileset' && op.undoable === false) throw new Error('world edits require undoable metadata');
  if (op.type === 'remapCells') return { ...op, cells: op.cells.map(c => ({ ...c })) };
  // Tilesets have nested generated/edited provenance; JSON data only.
  return JSON.parse(JSON.stringify(op)) as WorldEditOperation;
}
function blockersOf(participants: readonly WorldEditInput[]): WorldEditBlocker[] {
  const blockers: WorldEditBlocker[] = [];
  for (const p of participants) {
    if (p.store.inTransaction) blockers.push({ mapId: p.mapId, reason: 'busy' });
    for (const op of p.operations) {
      if (op.type !== 'remapCells') continue;
      const layer = p.store.document.getLayer(op.layerId);
      if (!isTileLayer(layer)) blockers.push({ mapId: p.mapId, layerId: op.layerId, reason: 'missingLayer' });
      else {
        if (layer.locked) blockers.push({ mapId: p.mapId, layerId: op.layerId, reason: 'locked' });
        if (!layer.visible) blockers.push({ mapId: p.mapId, layerId: op.layerId, reason: 'hidden' });
        if (op.cells.some(c => !Number.isInteger(c.x) || !Number.isInteger(c.y) || !p.store.document.inBounds(c.x, c.y))) blockers.push({ mapId: p.mapId, layerId: op.layerId, reason: 'invalid', detail: 'cell out of bounds' });
      }
    }
  }
  return blockers;
}

/** Pure preparation: validate a detached simulation before opening any live transaction. No disk reads. */
export function prepareWorldEdit(originMapId: string, inputs: readonly WorldEditInput[], label?: string): WorldEditPlan {
  if (!inputs.length || !inputs.some(p => p.mapId === originMapId) || new Set(inputs.map(p => p.mapId)).size !== inputs.length || new Set(inputs.map(p => p.store)).size !== inputs.length) throw new WorldEditError([{ mapId: originMapId, reason: 'invalid', detail: 'unique participants and origin required' }]);
  const blockers = blockersOf(inputs);
  if (blockers.length) throw new WorldEditError(blockers);
  const participants = inputs.map(p => ({ ...p, revision: p.store.revision, operations: p.operations.map(own) }));
  const shared = participants[0]!.store.rasterAssets;
  const writesRaster = participants.some(p => p.operations.some(op => ['allocateEditedTile', 'patchPixels', 'editTilePixels'].includes(op.type)));
  if (writesRaster && participants.some(p => p.store.rasterAssets !== shared)) throw new WorldEditError([{ mapId: originMapId, reason: 'invalid', detail: 'participants must share RasterAssets' }]);
  const rasterVersions = participants.flatMap(p => p.store.rasterAssets.assetIds().map(assetId => ({ mapId: p.mapId, assetId, revision: p.store.rasterAssets.info(assetId)!.revision })));
  // Each shared view has one detached backing store for the simulation.
  const copies = new Map<typeof shared, RasterAssets>();
  const simulated = participants.map(p => {
    let rasters = copies.get(p.store.rasterAssets);
    if (!rasters) {
      rasters = new RasterAssets(); copies.set(p.store.rasterAssets, rasters);
      for (const assetId of p.store.rasterAssets.assetIds()) {
        const info = p.store.rasterAssets.info(assetId)!, image = p.store.rasterAssets.getAsset(assetId)!;
        // Owned simulation data, including slots not referenced by these participant documents.
        rasters._load({ ...info, data: image.data }, info.tileCount);
      }
    }
    const doc = p.store.document;
    const store = new MapStore(parseLevel(serializeLevel(doc), doc.tilesets, doc.entityTypes, { randomSets: doc.randomSets, collections: doc.collections }), { rasterAssets: rasters });
    return store;
  });
  let rasterOwner: string | undefined;
  const latest = new Map<string, MapStore['document']['tilesets'][number]>();
  for (const [i, p] of participants.entries()) {
    const scratch = simulated[i]!;
    // A first-touch allocation can introduce an edited atlas referenced by later maps.
    const additions = p.operations.flatMap(op => op.type === 'remapCells' && !scratch.document.getTileset(op.tilesetId) && latest.has(op.tilesetId) ? [{ type: 'addTileset' as const, tileset: latest.get(op.tilesetId)! }] : []);
    const uniqueAdditions = [...new Map(additions.map(op => [op.tileset.id, op])).values()];
    p.operations.unshift(...uniqueAdditions);
    scratch.beginTransaction(label);
    try {
      const operations: WorldEditOperation[] = [];
      const changedAssets = new Set<string>();
      for (const op of p.operations) {
        if (op.type === "remapCells" && op.cells.length && !scratch.document.palette.indexOf(op.tilesetId, op.tileId)) {
          const addition = { type: "addPaletteEntry", tilesetId: op.tilesetId, tileId: op.tileId, undoable: true } as const;
          scratch.dispatch(addition); operations.push(addition);
        }
        if (op.type === 'patchPixels' || op.type === 'editTilePixels' || op.type === 'allocateEditedTile') {
          if (rasterOwner && rasterOwner !== p.mapId) throw new Error('shared raster writes require exactly one history owner');
          rasterOwner = p.mapId;
        }
        if (op.type === 'allocateEditedTile') changedAssets.add(scratch.dispatch(op).assetId);
        else {
          scratch.dispatch(op);
          if (op.type === 'editTilePixels') changedAssets.add(op.assetId);
          if (op.type === 'patchPixels') for (const patch of op.patches) changedAssets.add(patch.assetId);
        }
        operations.push(op);
      }
      p.operations = operations;
      scratch.commit();
      for (const assetId of changedAssets) latest.set(assetId, scratch.document.getTileset(assetId)!);
    } catch (error) { throw new WorldEditError([{ mapId: p.mapId, reason: 'invalid', detail: error instanceof Error ? error.message : String(error) }]); }
  }
  // Raster ops also update their owner's content hash. Synchronize that metadata undoably everywhere.
  for (const [i, p] of participants.entries()) for (const ts of latest.values()) {
    const have = simulated[i]!.document.getTileset(ts.id);
    if (have?.edited && JSON.stringify(have) !== JSON.stringify(ts)) {
      const op = { type: 'setEditedTileset', tileset: ts } as const;
      try { simulated[i]!.dispatch(op); }
      catch (error) { throw new WorldEditError([{ mapId: p.mapId, reason: 'invalid', detail: error instanceof Error ? error.message : String(error) }]); }
      p.operations.push(op);
    }
  }
  const plan: WorldEditPlan = { originMapId, ...(label === undefined ? {} : { label }), participants, rasterVersions };
  preparedPlans.set(plan, { ...plan, participants: participants.map(p => ({ ...p, operations: p.operations.map(own) })), rasterVersions: rasterVersions.map(v => ({ ...v })) });
  return plan;
}

/** All version/layer checks happen before mutation; failed dispatch rolls open transactions back in reverse. */
export function applyWorldEdit(history: WorldHistory, prepared: WorldEditPlan): void {
  const plan = preparedPlans.get(prepared);
  if (!plan) throw new WorldEditError([{ mapId: prepared.originMapId, reason: 'invalid', detail: 'prepare the plan before committing' }]);
  const blockers = blockersOf(plan.participants);
  for (const p of plan.participants) {
    const expectedAssets = plan.rasterVersions.filter(v => v.mapId === p.mapId).map(v => v.assetId);
    if (p.store.revision !== p.revision || history.store(p.mapId) !== p.store || JSON.stringify(p.store.rasterAssets.assetIds()) !== JSON.stringify(expectedAssets)) blockers.push({ mapId: p.mapId, reason: 'stale' });
  }
  for (const v of plan.rasterVersions) if (history.store(v.mapId)?.rasterAssets.info(v.assetId)?.revision !== v.revision) blockers.push({ mapId: v.mapId, reason: 'stale' });
  if (blockers.length) throw new WorldEditError(blockers);
  history.compound(plan.originMapId, () => {
    const opened: MapStore[] = [];
    try {
      for (const p of plan.participants) { opened.push(p.store); p.store.beginTransaction(plan.label); }
      for (const p of plan.participants) for (const op of p.operations) p.store.dispatch(op);
    } catch (error) {
      for (const store of [...opened].reverse()) if (store.inTransaction) store.rollback();
      throw error;
    }
    for (const store of opened) store.commit();
  }, { prepared: true });
}
