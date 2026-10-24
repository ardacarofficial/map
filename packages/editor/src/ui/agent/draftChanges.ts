/**
 * What the pending AI draft changed besides cells, for the review bar: layers
 * (added, removed, renamed, shown/hidden, locked, reordered, opacity),
 * entities (added, removed, moved, edited), stamps of the library and maps
 * (created, renamed, moved on the world map). Cells come from the transaction
 * counters. A shape snapshot is taken when a draft first appears, before its
 * first mutation; nothing here touches the maps.
 */
import type { TransactionSummary } from "@smap/agent";
import { isEntityLayer, type MapDocument, type ProjectLevel, type Stamp } from "@smap/core";
import { getLevelWorkspace } from "../../io/session";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useAgentUiState } from "../../agent/agentUiState";

export interface DraftChanges {
  readonly cells: number;
  readonly layers: number;
  readonly entities: number;
  readonly stamps: number;
  readonly maps: number;
  readonly total: number;
}

interface Shape { readonly layers: ReadonlyMap<string, string>; readonly entities: ReadonlyMap<string, string> }
interface Baseline {
  readonly id: string;
  /** Captured after the first mutation (e.g. the editor reopened mid-draft): only cells and new maps are known. */
  readonly late: boolean;
  readonly maps: Map<string, Shape>;
  readonly levels: ReadonlyMap<string, string>;
  readonly stamps: ReadonlyMap<string, Stamp>;
}

let baseline: Baseline | null = null;

export function documentShape(doc: MapDocument): Shape {
  const layers = new Map<string, string>(), entities = new Map<string, string>();
  doc.layers.forEach((layer, index) => {
    layers.set(layer.id, JSON.stringify([index, layer.name, layer.visible, layer.locked, layer.opacity]));
    if (isEntityLayer(layer)) for (const entity of layer.entities) entities.set(entity.id, JSON.stringify([layer.id, entity]));
  });
  return { layers, entities };
}

const levelSignature = (level: ProjectLevel) => JSON.stringify([level.name, level.world.x, level.world.y]);

/** Keys added, removed or with a different value. */
export function shapeDiff<V>(before: ReadonlyMap<string, V>, after: ReadonlyMap<string, V>): number {
  let n = 0;
  for (const [key, value] of before) if (!after.has(key) || after.get(key) !== value) n++;
  for (const key of after.keys()) if (!before.has(key)) n++;
  return n;
}

function capture(transaction: TransactionSummary): Baseline | null {
  const ws = getLevelWorkspace();
  if (!ws) return null;
  const maps = new Map<string, Shape>();
  for (const id of ws.cachedIds()) maps.set(id, documentShape(ws.entry(id)!.store.document));
  return {
    id: transaction.id, late: transaction.counters.mutationCalls > 0, maps,
    levels: new Map(ws.levels.map(level => [level.id, levelSignature(level)])),
    stamps: new Map(useProjectLibrary.getState().stamps.map(stamp => [stamp.id, stamp])),
  };
}

/** Before the first mutation, maps loaded by begin_edit join the snapshot untouched. */
function extend(current: Baseline): void {
  const ws = getLevelWorkspace();
  if (!ws) return;
  for (const id of ws.cachedIds()) if (!current.maps.has(id) && current.levels.has(id)) current.maps.set(id, documentShape(ws.entry(id)!.store.document));
}

function observe(transaction: TransactionSummary | null): void {
  if (!transaction) { baseline = null; return; }
  if (baseline?.id !== transaction.id) baseline = capture(transaction);
  else if (transaction.counters.mutationCalls === 0 && transaction.state !== "approved" && transaction.state !== "cancelled") extend(baseline);
}

/** Starts snapshotting drafts as they appear; the review bar installs it once. */
export function trackDraftChanges(): () => void {
  observe(useAgentUiState.getState().transaction);
  return useAgentUiState.subscribe((state, previous) => { if (state.transaction !== previous.transaction) observe(state.transaction); });
}

/** Test seam. */
export function resetDraftChanges(): void { baseline = null; }

export function draftChanges(transaction: TransactionSummary): DraftChanges {
  const cells = transaction.counters.changedCells;
  const ws = getLevelWorkspace();
  let layers = 0, entities = 0, stamps = 0, maps = 0;
  if (ws && baseline?.id === transaction.id) {
    for (const level of ws.levels) {
      const before = baseline.levels.get(level.id);
      if (before === undefined) {
        maps++;
        // Entities placed on a new map are changes; its starting layers are not.
        const entry = ws.entry(level.id);
        if (entry) entities += documentShape(entry.store.document).entities.size;
      } else if (!baseline.late && before !== levelSignature(level)) maps++;
    }
    if (!baseline.late) {
      for (const [id, before] of baseline.maps) {
        const entry = ws.entry(id);
        if (!entry) continue;
        const after = documentShape(entry.store.document);
        layers += shapeDiff(before.layers, after.layers);
        entities += shapeDiff(before.entities, after.entities);
      }
      stamps = shapeDiff(baseline.stamps, new Map(useProjectLibrary.getState().stamps.map(stamp => [stamp.id, stamp])));
    }
  }
  return { cells, layers, entities, stamps, maps, total: cells + layers + entities + stamps + maps };
}

/** Maps the draft touched (targets and new maps), in world order, with whether each is new. */
export function draftMaps(transaction: TransactionSummary): { id: string; name: string; created: boolean }[] {
  const ws = getLevelWorkspace();
  if (!ws) return [];
  const ids = new Set(transaction.affectedMapIds);
  return ws.levels.filter(level => ids.has(level.id)).map(level => ({
    id: level.id, name: level.name,
    created: baseline?.id === transaction.id && !baseline.levels.has(level.id),
  }));
}
