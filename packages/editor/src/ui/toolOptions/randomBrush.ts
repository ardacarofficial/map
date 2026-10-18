/** UI-only memory for the options-bar random toggle; never saved in the document. */
import type { TileClip } from "@smap/core";

import {
  candidatesFromClip,
  clearRandomSet,
  currentRandomSet,
  loadRandomSet,
  makeRandomFromStamp,
  savedRandomSets,
  useRandomBrush,
} from "../../commands/randomBrush";
import { useEditorStore, type TileSelection } from "../../state/editorStore";

interface PreviousBrush {
  stamp: TileClip | null;
  selection: TileSelection | null;
}

let previousBrush: PreviousBrush | null = null;
let lastLoadedSetId: string | null = useRandomBrush.getState().activeSetId;
let toggling = false;

/** Only tile-only clips with at least two distinct non-empty tiles can become a random brush. */
export function canRandomizeClip(clip: TileClip | null): boolean {
  return clip !== null && !clip.layers.some((layer) => layer.grid) && candidatesFromClip(clip).length >= 2;
}

// Remember picker loads too, including those made from the inspector.
useRandomBrush.subscribe((options) => {
  if (options.activeSetId !== null) lastLoadedSetId = options.activeSetId;
});

useEditorStore.subscribe((state, prev) => {
  if (state.project?.store !== prev.project?.store) {
    previousBrush = null;
    lastLoadedSetId = null;
  }
  if (toggling || !previousBrush) return;
  const pickedBrush = state.selection !== prev.selection || state.stamp !== prev.stamp;
  if (pickedBrush && (state.stamp !== null || currentRandomSet() === null)) previousBrush = null;
});

/** Compose the existing commands, preserving the brush for the next toggle off. */
export function toggleRandomBrush(): void {
  const s = useEditorStore.getState();
  const active = currentRandomSet();
  toggling = true;
  try {
    if (active && !s.stamp) {
      const restore = previousBrush;
      previousBrush = null;
      const first = active.candidates.find((candidate) => candidate.kind === "tile");
      clearRandomSet();
      s.setStamp(restore?.stamp ?? null);
      s.setSelection(restore ? restore.selection : first ? { tilesetId: first.tilesetId, tileId: first.tileId } : null);
      return;
    }

    const fromClip = canRandomizeClip(s.stamp);
    const sets = savedRandomSets();
    const saved = sets.find((set) => set.id === lastLoadedSetId) ?? sets[0];
    if (!fromClip && !saved) return;
    previousBrush = { stamp: s.stamp, selection: s.selection };
    const loaded = fromClip ? makeRandomFromStamp() : loadRandomSet(saved!.id);
    if (!loaded) previousBrush = null;
  } finally {
    toggling = false;
  }
}
