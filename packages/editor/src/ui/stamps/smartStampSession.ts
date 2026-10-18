/** Session orientation never changes the canonical saved recipe. */
import { composeOrientation, type Stamp, type TileClip } from "@smap/core";
import { create } from "zustand";
import { useEditorStore } from "../../state/editorStore";
import { isStampLevelId } from "../stampEditor/stampDoc";

export const useSmartStampSession = create<{
  stampId: string | null; usage: "area" | "road"; orientation: number;
  setUsage(usage: "area" | "road"): void; transform(flags: number): void;
}>()(set => ({ stampId: null, usage: "area", orientation: 0,
  setUsage: usage => set({ usage }),
  transform: flags => set(s => ({ orientation: composeOrientation(s.orientation, flags) })),
}));
export function smartStamp(clip: TileClip | null = useEditorStore.getState().stamp): Stamp | null {
  const s = clip as Stamp | null;
  return s?.nineSlice ? s : null;
}
export function activeSmartStamp(): Stamp | null {
  const state = useEditorStore.getState();
  return isStampLevelId(state.project?.levelId) ? null : smartStamp(state.stamp);
}
useEditorStore.subscribe((s, prev) => {
  const id = smartStamp(s.stamp)?.id ?? null;
  if (id !== useSmartStampSession.getState().stampId || s.project?.store !== prev.project?.store) {
    useSmartStampSession.setState({ stampId: id, usage: "area", orientation: 0 });
  }
});
