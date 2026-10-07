/**
 * Copy / cut / paste / delete of the marquee region on the active layer.
 *
 * Copy keeps the clip in memory and also puts its text form (`serializeClip`)
 * on the system clipboard, so it pastes into another window of the app.
 * Paste does not write anything: it turns the clip into the brush `stamp`
 * and the user places it with the mouse (the canvas draws the preview).
 */
import {
  EMPTY_CELL,
  FLIP_H,
  FLIP_V,
  copyRegion,
  cutRegion,
  flipClip,
  isGridLayer,
  isValidTileId,
  makeCell,
  parseClip,
  serializeClip,
  type MapDocument,
  type TileClip,
} from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";
import { activeLayer, canCopy, canErase, contextOf, mapRegion } from "./enablement";

let memoryClip: TileClip | null = null;

export function getMemoryClip(): TileClip | null {
  return memoryClip;
}

function writeSystemClipboard(text: string): void {
  // Best effort: may be unavailable (insecure context, permissions).
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

export function copySelection(): boolean {
  const c = contextOf(useEditorStore.getState());
  const layer = activeLayer(c);
  const rect = mapRegion(c);
  if (!canCopy(c) || !layer || !rect || !c.store) return false;
  memoryClip = copyRegion(c.store.document, [layer.id], rect);
  writeSystemClipboard(serializeClip(memoryClip));
  toast.info(t("toast.copied", { width: rect.width, height: rect.height }));
  return true;
}

export function cutSelection(): boolean {
  const c = contextOf(useEditorStore.getState());
  const layer = activeLayer(c);
  const rect = mapRegion(c);
  if (!canErase(c) || !layer || !rect || !c.store) return false;
  memoryClip = cutRegion(c.store, [layer.id], rect);
  writeSystemClipboard(serializeClip(memoryClip));
  toast.info(t("toast.cut", { width: rect.width, height: rect.height }));
  return true;
}

/** Clears the region on the active layer (one undo step). */
export function deleteSelection(): boolean {
  const c = contextOf(useEditorStore.getState());
  const layer = activeLayer(c);
  const rect = mapRegion(c);
  if (!canErase(c) || !layer || !rect || !c.store) return false;
  const cells: { x: number; y: number }[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) cells.push({ x, y });
  }
  if (isGridLayer(layer)) {
    c.store.dispatch({ type: "paintTerrain", layerId: layer.id, cells: cells.map((p) => ({ ...p, value: 0 })) });
  } else {
    c.store.dispatch({ type: "paintCells", layerId: layer.id, cells: cells.map((p) => ({ ...p, cell: EMPTY_CELL })) });
  }
  return true;
}

/** Why a clip cannot be pasted into `doc`, or null when it can. */
export function clipProblem(doc: MapDocument, clip: TileClip): string | null {
  for (const entry of clip.palette) {
    const tileset = doc.getTileset(entry.tilesetId);
    if (!tileset) return entry.tilesetId;
    if (!isValidTileId(tileset, entry.tileId)) return `${entry.tilesetId} #${entry.tileId}`;
  }
  return null;
}

/** Parses clipboard text as a clip; null when it is not one. */
export function clipFromText(text: string | null | undefined): TileClip | null {
  if (!text || !text.includes("smap-clip")) return null;
  try {
    return parseClip(text);
  } catch {
    return null;
  }
}

/** Starts placing `clip` with the brush. */
function startPlacing(clip: TileClip): boolean {
  const state = useEditorStore.getState();
  const doc = state.project?.store.document;
  if (!doc) return false;
  const problem = clipProblem(doc, clip);
  if (problem) {
    toast.error(t("toast.pasteFailed", { detail: problem }));
    return false;
  }
  state.setRegion(null);
  state.setStamp(clip);
  state.setTool("brush");
  return true;
}

/**
 * Paste with the system clipboard's text (from a native `paste` event):
 * a clip there wins (it may come from another window), else the in-memory clip.
 */
export function pasteText(text: string | null | undefined): boolean {
  const clip = clipFromText(text) ?? memoryClip;
  if (!clip) {
    toast.info(t("toast.clipboardEmpty"));
    return false;
  }
  return startPlacing(clip);
}

/** Paste from the command palette / toolbar: reads the system clipboard if allowed. */
export async function pasteFromSystem(): Promise<boolean> {
  const text = await Promise.resolve(navigator.clipboard?.readText()).catch(() => null);
  return pasteText(text ?? null);
}

/** X / Y: flips the stamp, or turns the selected tile into a flipped 1×1 stamp. */
export function flipStampOrTile(axis: "x" | "y"): boolean {
  const state = useEditorStore.getState();
  if (state.stamp) {
    state.setStamp(flipClip(state.stamp, axis));
    return true;
  }
  const layer = activeLayer(contextOf(state));
  if (!state.selection || !layer) return false;
  const clip: TileClip = {
    width: 1,
    height: 1,
    palette: [{ tilesetId: state.selection.tilesetId, tileId: state.selection.tileId }],
    layers: [{ layerId: layer.id, name: layer.name, cells: Uint32Array.of(makeCell(1, axis === "x" ? FLIP_H : FLIP_V)) }],
  };
  state.setStamp(clip);
  return true;
}
