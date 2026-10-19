import { tileUsageBatches, type MapDocument, type PaletteEntry, type TileUsage } from '@smap/core';

export interface WorldTileUsage extends TileUsage { readonly mapId: string; readonly mapName: string }
export interface UsageMap { readonly id: string; readonly name: string }
export interface UsageScanSource {
  maps: readonly UsageMap[];
  cached(id: string): MapDocument | undefined;
  scanFile(map: UsageMap, targets: readonly PaletteEntry[], signal: AbortSignal): Promise<TileUsage[]>;
}

/** Cached (possibly dirty) documents take precedence. No activation, cache writes or undo. */
export async function scanWorldUsages(source: UsageScanSource, targets: readonly PaletteEntry[], signal: AbortSignal, pause = () => new Promise<void>(resolve => setTimeout(resolve, 0))): Promise<WorldTileUsage[]> {
  const results: WorldTileUsage[] = [];
  let start = performance.now();
  for (const map of source.maps) {
    if (signal.aborted) return [];
    const doc = source.cached(map.id);
    const fileResults = doc ? null : await source.scanFile(map, targets, signal);
    function* fileBatches() { for (let i = 0; i < fileResults!.length; i += 1024) yield fileResults!.slice(i, i + 1024); }
    const batches = doc ? tileUsageBatches(doc, targets) : fileBatches();
    for (const batch of batches) {
      if (signal.aborted) return [];
      for (const usage of batch) results.push({ ...usage, mapId: map.id, mapName: map.name });
      // Leave a generous margin under the 16 ms frame budget.
      if (performance.now() - start >= 4) { await pause(); start = performance.now(); }
    }
    await pause();
    start = performance.now();
  }
  return signal.aborted ? [] : results;
}
