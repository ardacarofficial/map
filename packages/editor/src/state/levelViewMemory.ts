/**
 * Per-level camera memory for the session: switching to another level and
 * back shows each level where it was left (zoom + centre). A level the user
 * has not moved yet is not remembered, so it opens with the centred opening
 * view. Cleared when another project opens or the project closes.
 */

/** A level view: the map px at the view centre and the zoom (CSS px per map px). */
export interface LevelView {
  readonly cx: number;
  readonly cy: number;
  readonly zoom: number;
}

const views = new Map<string, LevelView>();

export function rememberLevelView(levelId: string, view: LevelView | null): void {
  if (view && Number.isFinite(view.cx) && Number.isFinite(view.cy) && view.zoom > 0) views.set(levelId, view);
  else views.delete(levelId);
}

export function recallLevelView(levelId: string): LevelView | null {
  return views.get(levelId) ?? null;
}

export function clearLevelViews(): void {
  views.clear();
}
