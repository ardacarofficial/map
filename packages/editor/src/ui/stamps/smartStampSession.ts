/** Canonical recipes never rotate; each brush has session orientation and independent tool overrides. */
import { composeOrientation, orientPoint, cellFlags, cellPaletteIndex, makeCell, FLIP_D, type Stamp, type TileClip } from "@smap/core";
import { create } from "zustand";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import { autoBrush, brushCandidate, brushDisabled, preparedBrush } from "../../commands/smartBrushActions";
import { isStampLevelId } from "../stampEditor/stampDoc";

type Usage = "area" | "road";
export const useSmartStampSession = create<{
  stampId: string | null;
  usage: Usage;
  orientation: number;
  version: number;
  overrides: Partial<Record<ToolId, Usage>>;
  setUsage(usage: Usage): void;
  transform(flags: number): void;
}>()(set => ({
  stampId: null, usage: "road", orientation: 0, version: 0, overrides: {},
  setUsage: usage => set(s => ({ usage, overrides: { ...s.overrides, [useEditorStore.getState().tool]: usage } })),
  transform: flags => set(s => ({ orientation: composeOrientation(s.orientation, flags) })),
}));
export function smartStamp(clip: TileClip | null = useEditorStore.getState().stamp): Stamp | null {
  if (brushDisabled(clip)) return null;
  const stamp = preparedBrush(clip) ?? clip as Stamp | null;
  return stamp?.nineSlice ? stamp : null;
}
export function activeSmartStamp(): Stamp | null {
  const state = useEditorStore.getState();
  return isStampLevelId(state.project?.levelId) ? null : smartStamp(state.stamp);
}
/** Preparation changes readiness, never brush identity (the inline name form owns that identity). */
export function refreshSmartStampSession(changedStore = false): void {
  const editor = useEditorStore.getState(), session = useSmartStampSession.getState();
  const id = (editor.stamp as Stamp | null)?.id ?? autoBrush(editor.stamp)?.key ?? null;
  const fresh = id !== session.stampId || changedStore, overrides = fresh ? {} : session.overrides;
  const source = preparedBrush(editor.stamp) ?? editor.stamp as Stamp | null;
  const road = !!source?.nineSlice?.road || !!autoBrush(editor.stamp);
  const usage = overrides[editor.tool] ?? (editor.tool === "rect" || !road ? "area" : "road");
  useSmartStampSession.setState({ stampId: id, usage, overrides, version: session.version + 1, ...(fresh ? { orientation: 0 } : {}) });
}
useEditorStore.subscribe((state, prev) => {
  if (state.project?.store !== prev.project?.store || state.stamp !== prev.stamp || state.tool !== prev.tool) {
    refreshSmartStampSession(state.project?.store !== prev.project?.store);
  }
});

const flatCache = new WeakMap<TileClip, Map<number, TileClip>>();
/** Plain block and pattern-fill paths apply the same orientation once, without rewriting the recipe. */
export function orientedBrushClip(clip: TileClip): TileClip {
  const orientation = useSmartStampSession.getState().orientation;
  if (!brushCandidate(clip) || !orientation) return clip;
  let cache = flatCache.get(clip);
  const hit = cache?.get(orientation); if (hit) return hit;
  const width = orientation & FLIP_D ? clip.height : clip.width, height = orientation & FLIP_D ? clip.width : clip.height;
  const layers = clip.layers.map(layer => {
    const cells = new Uint32Array(layer.cells.length);
    for (let y = 0; y < clip.height; y++) for (let x = 0; x < clip.width; x++) {
      const point = orientPoint({ x, y }, clip.width, clip.height, orientation), cell = layer.cells[y * clip.width + x]!;
      cells[point.y * width + point.x] = !cell || layer.grid ? cell : makeCell(cellPaletteIndex(cell), composeOrientation(cellFlags(cell), orientation));
    }
    return { ...layer, cells };
  });
  const result = { ...clip, width, height, layers };
  if (!cache) { cache = new Map(); flatCache.set(clip, cache); }
  cache.set(orientation, result);
  return result;
}
