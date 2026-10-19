import { applyWorldEdit, prepareWorldEdit, WorldEditError, type WorldEditBlocker, type WorldEditOperation, type WorldEditPlan } from '@smap/core';

import type { ProjectFileSystem } from './fs';
import type { LevelWorkspace } from './levelWorkspace';

export interface WorldPixelTarget {
  readonly mapId: string;
  readonly layerId: string;
  readonly cells: readonly { readonly x: number; readonly y: number }[];
  readonly tilesetId: string;
  readonly tileId: number;
}
export interface WorldPixelEditRequest {
  readonly originMapId: string;
  readonly targets: readonly WorldPixelTarget[];
  /** Raster patches/allocation run once, in the origin store. */
  readonly pixelOperations: readonly WorldEditOperation[];
  readonly label?: string;
}

/** Preload before a stroke is enabled. Never open a transaction while waiting for disk. */
export async function prepareWorldPixelEdit(ws: LevelWorkspace, fs: ProjectFileSystem | null, request: WorldPixelEditRequest): Promise<WorldEditPlan> {
  const ids = [...new Set([request.originMapId, ...request.targets.map(t => t.mapId)])].sort();
  const blockers: WorldEditBlocker[] = [];
  // Report every unreadable map, with stable project ids; UI resolves names and localizes reason codes.
  for (const mapId of ids) {
    try { await ws.load(mapId, fs); ws.pin(mapId); }
    catch { blockers.push({ mapId, reason: 'load' }); }
  }
  const participants = ids.flatMap(mapId => {
    const entry = ws.entry(mapId);
    if (!entry) return [];
    const operations: WorldEditOperation[] = mapId === request.originMapId ? [...request.pixelOperations] : [];
    for (const target of request.targets.filter(t => t.mapId === mapId)) {
      const layer = entry.store.document.getLayer(target.layerId);
      if (!layer) blockers.push({ mapId, layerId: target.layerId, reason: 'missingLayer' });
      else {
        if (layer.locked) blockers.push({ mapId, layerId: target.layerId, reason: 'locked' });
        if (!layer.visible) blockers.push({ mapId, layerId: target.layerId, reason: 'hidden' });
      }
      const tileset = ws.entry(request.originMapId)?.store.document.getTileset(target.tilesetId);
      if (!entry.store.document.getTileset(target.tilesetId) && tileset) operations.push({ type: 'addTileset', tileset });
      operations.push({ type: 'remapCells', layerId: target.layerId, cells: target.cells, tilesetId: target.tilesetId, tileId: target.tileId });
    }
    return [{ mapId, store: entry.store, operations }];
  });
  if (blockers.length) throw new WorldEditError(blockers);
  // Origin first: it owns raster mutation; every remaining palette remap follows deterministically.
  participants.sort((a, b) => a.mapId === request.originMapId ? -1 : b.mapId === request.originMapId ? 1 : (a.mapId < b.mapId ? -1 : a.mapId > b.mapId ? 1 : 0));
  return prepareWorldEdit(request.originMapId, participants, request.label);
}

export function commitWorldPixelEdit(ws: LevelWorkspace, plan: WorldEditPlan): void {
  for (const p of plan.participants) if (ws.entry(p.mapId)?.store !== p.store) throw new WorldEditError([{ mapId: p.mapId, reason: 'stale' }]);
  applyWorldEdit(ws.history, plan);
}
