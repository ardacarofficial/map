import { FLIP_H, FLIP_V, flipRegion } from "@smap/core";
import { brushCandidate, attachPreparedBrush } from "./smartBrushActions";
import { useSmartStampSession } from "../ui/stamps/smartStampSession";
/**
 * Turning and mirroring the brush (round 4): Z / Shift+Z turn it 90°, X / Y
 * mirror it. What turns is what the canvas would paint:
 * - a stamp / pasted clip (saved stamps stay saved stamps) → core `rotateClip`;
 * - a random brush → every candidate's flip bits (the preview shows them);
 * - a single tile → a 1×1 clip of it with the turned flip bits (like X / Y).
 * With the select tool and a marquee selection, Z / Shift+Z turn the
 * selected cells in place instead (`rotateSelection` on the canvas).
 * Non-square tiles cannot turn (they would not fit their cell): the canvas
 * says so next to the pointer.
 *
 * `edit.flipX` / `edit.flipY` are re-registered here so a random brush
 * mirrors its candidates (before, X / Y turned it into a flipped single tile
 * and the preview kept showing the random set).
 */
import { isEntityLayer, makeCell, rotateClip, type TileClip } from "@smap/core";

import { canRotateTiles, flipFlags, rotateFlags, type RotateDir } from "../canvas/rotation";
import { isRandomBrush, randomTileFlags } from "../canvas/randomPaint";
import { t } from "../i18n";
import { useEditorStore, type EditorState } from "../state/editorStore";
import { getCanvasHandle } from "../ui/canvas/canvasHandle";
import { captureSelectionScope } from "./selectionScope";
import { flipStampOrTile } from "./clipboard";
import { activeLayer, canFlip, contextOf } from "./enablement";
import { registerCommands } from "./registry";
import { isWorldView } from "./worldActions";

type RandomEntry = EditorState["randomSet"][number] & { flags?: number };

/** What a brush transform does to the editor state, or why it cannot. */
export type BrushTransform =
  | { readonly kind: "stamp"; readonly stamp: TileClip }
  | { readonly kind: "random"; readonly set: RandomEntry[] }
  | { readonly kind: "nonSquare" }
  | null;

type BrushState = Pick<EditorState, "stamp" | "selection" | "randomSet" | "activeLayerId" | "project">;

/** A 1×1 clip of the selected tile with `flags` on the active layer, or null. */
function singleTileClip(state: BrushState, flags: number): TileClip | null {
  const layer = activeLayer({ store: state.project?.store ?? null, activeLayerId: state.activeLayerId, region: null, stamp: null, selection: null });
  const sel = state.selection;
  if (!sel || !layer) return null;
  return Object.freeze({
    width: 1,
    height: 1,
    palette: Object.freeze([Object.freeze({ tilesetId: sel.tilesetId, tileId: sel.tileId })]),
    layers: Object.freeze([Object.freeze({ layerId: layer.id, name: layer.name, cells: Uint32Array.of(makeCell(1, flags)) })]),
  });
}

/** The brush turned 90° (`dir`), in the order the canvas paints: stamp, random set, single tile. */
export function rotatedBrush(state: BrushState, dir: RotateDir): BrushTransform {
  const map = state.project?.store.document.map;
  if (!map) return null;
  const has = state.stamp !== null || isRandomBrush(state.randomSet) || state.selection !== null;
  if (!has) return null;
  if (!canRotateTiles(map.tileWidth, map.tileHeight)) return { kind: "nonSquare" };
  if (state.stamp) return { kind: "stamp", stamp: rotateClip(state.stamp, dir) };
  if (isRandomBrush(state.randomSet)) {
    return { kind: "random", set: state.randomSet.map((e) => withFlags(e, rotateFlags(randomTileFlags(e), dir))) };
  }
  const clip = singleTileClip(state, rotateFlags(0, dir));
  return clip ? { kind: "stamp", stamp: clip } : null;
}

/** A random brush mirrored (`axis`), or null when the brush is not a random set (X / Y keep their old path). */
export function flippedRandomBrush(state: BrushState, axis: "x" | "y"): BrushTransform {
  if (state.stamp || !isRandomBrush(state.randomSet)) return null;
  return { kind: "random", set: state.randomSet.map((e) => withFlags(e, flipFlags(randomTileFlags(e), axis))) };
}

function withFlags(e: RandomEntry, flags: number): RandomEntry {
  const { flags: _old, ...rest } = e;
  return flags === 0 ? rest : { ...rest, flags };
}

/** Applies a transform to the store; false when there was nothing to do. */
function apply(transform: BrushTransform): boolean {
  if (!transform) return false;
  const state = useEditorStore.getState();
  switch (transform.kind) {
    case "nonSquare":
      getCanvasHandle()?.showHint(t("canvas.rotateNonSquare"));
      return false;
    case "stamp":
      if(state.stamp)attachPreparedBrush(transform.stamp,state.stamp);
      state.setStamp(transform.stamp);
      return true;
    case "random":
      state.setRandomSet(transform.set);
      return true;
  }
}

/** True when Z / Shift+Z turn the marquee selection's content instead of the brush (select tool, a selection, a cell layer). */
export function rotatesSelection(state: Pick<EditorState, "tool" | "region" | "activeLayerId" | "project"> & Partial<Pick<EditorState, "selectionScope">>): boolean {
  if (state.tool !== "select" || !state.region || !state.project) return false;
  const layer = state.activeLayerId ? state.project.store.document.getLayer(state.activeLayerId) : undefined;
  return state.selectionScope === "visible" || (layer !== undefined && !isEntityLayer(layer));
}

/**
 * Z / Shift+Z: with the select tool and a selection, turns the selected
 * cells 90° in place (one undo step, the selection takes the turned size);
 * otherwise turns the brush 90°.
 */
export function rotateBrush(dir: RotateDir): boolean {
  const state = useEditorStore.getState();
  if (rotatesSelection(state)) {
    const handle = getCanvasHandle();
    return handle?.rotateSelection(dir) ?? false;
  }
  if (brushCandidate()) {
    if (!canRotateTiles(state.project!.store.document.map.tileWidth, state.project!.store.document.map.tileHeight)) return apply({ kind: "nonSquare" });
    useSmartStampSession.getState().transform(rotateFlags(0, dir)); return true;
  }
  return apply(rotatedBrush(state, dir));
}

/** X / Y: mirrors the brush (random sets mirror their candidates; the rest as before). */
export function flipBrush(axis: "x" | "y"): boolean {
  const state = useEditorStore.getState();
  if (rotatesSelection(state)) {
    const store = state.project!.store;
    if (store.inTransaction) return false;
    const ids = captureSelectionScope(store.document);
    if (!ids.length) return true;
    const revision = store.revision;
    state.setRegion(flipRegion(store, ids, state.region!, axis));
    if (store.revision !== revision) state.setDirty(true);
    return true;
  }
  if (brushCandidate()) { useSmartStampSession.getState().transform(axis === "x" ? FLIP_H : FLIP_V); return true; }
  const random = flippedRandomBrush(useEditorStore.getState(), axis);
  return random ? apply(random) : flipStampOrTile(axis);
}

let registered = false;

/** `edit.rotateCW` / `edit.rotateCCW` (Z / Shift+Z) and the random-aware `edit.flipX` / `edit.flipY`. Call after `registerAppCommands`. */
export function registerRotateCommands(): void {
  if (registered) return;
  registered = true;
  const enabled = () => {
    const s = useEditorStore.getState();
    return s.project !== null && !isWorldView() && (canFlip(contextOf(s)) || isRandomBrush(s.randomSet) || rotatesSelection(s));
  };
  const flipEnabled = () => {
    const s = useEditorStore.getState();
    return s.project !== null && !isWorldView() && (canFlip(contextOf(s)) || isRandomBrush(s.randomSet) || rotatesSelection(s));
  };
  registerCommands([
    { id: "edit.rotateCW", title: "inspector.rotateCW", category: "edit", enabled, run: () => void rotateBrush("cw") },
    { id: "edit.rotateCCW", title: "inspector.rotateCCW", category: "edit", enabled, run: () => void rotateBrush("ccw") },
    { id: "edit.flipX", title: "commands.edit.flipX", category: "edit", enabled: flipEnabled, run: () => void flipBrush("x") },
    { id: "edit.flipY", title: "commands.edit.flipY", category: "edit", enabled: flipEnabled, run: () => void flipBrush("y") },
  ]);
}
