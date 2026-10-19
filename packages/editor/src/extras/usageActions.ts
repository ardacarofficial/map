import { type PaletteEntry } from '@smap/core';
import { create } from 'zustand';
import { useRandomBrush } from '../commands/randomBrush';
import { getLevelWorkspace, getProjectFolder, onProjectSaved, openLevel } from '../io/session';
import { useProjectLibrary } from '../io/projectLibrary';
import { getPlatform } from '../platform';
import { useEditorStore } from '../state/editorStore';
import { getCanvasHandle } from '../ui/canvas/canvasHandle';
import { revealPanel } from '../ui/layout/dockStore';
import { useUiStore } from '../ui/uiStore';
import { registerCommands } from '../commands/registry';
import { scanWorldUsages, type WorldTileUsage } from './usageScan';
import { scanUsageFile } from './usageWorker';

interface UsageState {
  targets: readonly PaletteEntry[];
  results: readonly WorldTileUsage[];
  counts: Readonly<Record<string, number>>;
  status: 'idle' | 'loading' | 'ready' | 'error';
  stale: boolean;
  current: number;
}
const initial: UsageState = { targets: [], results: [], counts: {}, status: 'idle', stale: false, current: -1 };
export const useTileUsages = create<UsageState>()(() => initial);
let pending: AbortController | null = null;
let jumpVersion = 0;

/** The actual brush, including multi-tile, random, generated and edited identities. */
export function brushUsageTargets(): PaletteEntry[] {
  const s = useEditorStore.getState();
  const stamps = useRandomBrush.getState().stamps;
  if (s.randomSet.length || stamps.length) {
    const library = useProjectLibrary.getState().stamps;
    return [...s.randomSet, ...stamps.flatMap(candidate => library.find(stamp => stamp.id === candidate.stampId)?.palette ?? [])];
  }
  if (s.stamp) return [...s.stamp.palette];
  return s.selection ? [s.selection] : [];
}

export async function findTileUsages(targets: readonly PaletteEntry[] = brushUsageTargets()): Promise<void> {
  const ws = getLevelWorkspace();
  if (!ws || !targets.length) return;
  pending?.abort();
  const job = new AbortController();
  pending = job;
  ++jumpVersion;
  useTileUsages.setState({ ...initial, targets, status: 'loading' });
  if (useUiStore.getState().panelsHidden) useUiStore.getState().togglePanels();
  revealPanel('inspector');
  const fs = getProjectFolder()?.fs;
  try {
    const results = await scanWorldUsages({
      maps: ws.levels,
      cached: id => ws.entry(id)?.store.document,
      scanFile: async (map, refs, signal) => {
        if (!fs) throw Error('no folder');
        const text = await fs.readText(ws.level(map.id)!.path);
        // Opening/editing the map during the read invalidates this snapshot.
        return scanUsageFile(text, refs, signal);
      },
    }, targets, job.signal);
    if (job.signal.aborted || getLevelWorkspace() !== ws) return;
    const counts: Record<string, number> = {};
    let start = performance.now();
    for (const result of results) {
      counts[result.mapId] = (counts[result.mapId] ?? 0) + 1;
      if (performance.now() - start >= 4) { await new Promise(resolve => setTimeout(resolve, 0)); start = performance.now(); }
    }
    if (!job.signal.aborted && getLevelWorkspace() === ws) useTileUsages.setState({ results, counts, status: 'ready' });
  } catch {
    if (!job.signal.aborted && getLevelWorkspace() === ws) useTileUsages.setState({ status: 'error', stale: true });
  }
}

export function refreshTileUsages(): void { void findTileUsages(useTileUsages.getState().targets); }
export function closeTileUsages(): void { pending?.abort(); ++jumpVersion; useTileUsages.setState(initial); }

export async function jumpToUsage(index: number): Promise<void> {
  const s = useTileUsages.getState(), result = s.results[index], ws = getLevelWorkspace();
  if (!result || s.stale || s.status !== 'ready' || !ws) return;
  const version = ++jumpVersion;
  useTileUsages.setState({ current: index });
  if (!await openLevel(result.mapId) || version !== jumpVersion || getLevelWorkspace() !== ws) return;
  // The canvas subscribes synchronously to the level's store change.
  const current = useTileUsages.getState();
  if (current.stale || current.results !== s.results) return;
  const canvas = getCanvasHandle();
  canvas?.setView('level');
  canvas?.centerOn(result.x, result.y);
  canvas?.flashCell(result.x, result.y);
}
export function cycleTileUsage(direction: 1 | -1): void {
  const { current, results } = useTileUsages.getState();
  if (results.length) void jumpToUsage((current < 0 ? (direction > 0 ? 0 : results.length - 1) : current + direction + results.length) % results.length);
}

export function installUsageActions(): () => void {
  const changed = () => { const s = useTileUsages.getState(); if (s.status !== 'idle' && !s.stale) useTileUsages.setState({ stale: true }); };
  let ws = getLevelWorkspace();
  let offHistory = ws?.history.subscribe(changed);
  let offStore: (() => void) | undefined;
  const bind = () => {
    offStore?.();
    offStore = useEditorStore.getState().project?.store.subscribe(event => { if (event.cells.length || event.structure.length || event.pixelRects.length) changed(); });
    const next = getLevelWorkspace();
    if (ws !== next) { offHistory?.(); ws = next; offHistory = ws?.history.subscribe(changed); closeTileUsages(); }
  };
  bind();
  const offEditor = useEditorStore.subscribe((s, prev) => {
    if (s.project?.store !== prev.project?.store) {
      // Replacing a store of the same map also invalidates its results.
      if (s.project?.levelId === prev.project?.levelId) changed();
      bind();
    }
  });
  const offLibrary = useProjectLibrary.subscribe((s, prev) => { if (s.levels !== prev.levels) { bind(); changed(); } });
  const offSaved = onProjectSaved(changed);
  const offDisk = getPlatform().onFileChanged(change => { if (change.path.startsWith('levels/') || change.path === 'project.smap') changed(); });
  registerCommands([
    { id: 'usage.find', title: 'tileUsage.find', category: 'tileset', enabled: () => !!getLevelWorkspace() && brushUsageTargets().length > 0, run: () => { void findTileUsages(); } },
    { id: 'usage.refresh', title: 'tileUsage.refresh', category: 'tileset', enabled: () => useTileUsages.getState().targets.length > 0, run: refreshTileUsages },
    { id: 'usage.next', title: 'tileUsage.next', category: 'view', enabled: () => !useTileUsages.getState().stale && useTileUsages.getState().results.length > 0, run: () => cycleTileUsage(1) },
    { id: 'usage.previous', title: 'tileUsage.previous', category: 'view', enabled: () => !useTileUsages.getState().stale && useTileUsages.getState().results.length > 0, run: () => cycleTileUsage(-1) },
  ]);
  return () => { closeTileUsages(); offEditor(); offLibrary(); offSaved(); offDisk(); offHistory?.(); offStore?.(); };
}
