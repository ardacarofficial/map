import { attachPreparedBrush } from "./smartBrushActions";
/**
 * Copy / cut / paste / delete of the marquee region on the captured selection layers.
 *
 * Copy keeps the clip in memory and also puts its text form (`serializeClip`)
 * on the system clipboard, so it pastes into another window of the app.
 * Paste does not write anything: it turns the clip into the brush `stamp`
 * and the user places it with the mouse (the canvas draws the preview).
 */
import {
  FLIP_H,
  FLIP_V,
  copyRegion,
  cutRegion,
  flipClip,
  isValidTileId,
  makeCell,
  parseClip,
  serializeClip,
  type MapDocument,
  type Stamp,
  type TileClip,
} from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";
import { captureSelectionScope, canUseSelectionScope, reportSelectionSkipped } from "./selectionScope";
import { activeLayer, contextOf, mapRegion } from "./enablement";

let memoryClip: TileClip | null = null;

export function getMemoryClip(): TileClip | null {
  return memoryClip;
}

/** Forgets the in-memory clip when it uses a tileset that no longer exists (a tileset was removed). */
export function dropMemoryClipUnless(exists: (tilesetId: string) => boolean): void {
  if (memoryClip && memoryClip.palette.some((e) => !exists(e.tilesetId))) memoryClip = null;
}

function writeSystemClipboard(text: string): void {
  // Best effort: may be unavailable (insecure context, permissions).
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

export function copySelection(): boolean {
  const c = contextOf(useEditorStore.getState());
  const rect = mapRegion(c);
  if (!canUseSelectionScope() || !rect || !c.store) return false;
  let skipped: readonly string[] = [];
  const layerIds = captureSelectionScope(c.store.document, names => { skipped = names; });
  memoryClip = copyRegion(c.store.document, layerIds, rect);
  writeSystemClipboard(serializeClip(memoryClip));
  toast.info(t("toast.copied", { width: rect.width, height: rect.height }));
  reportSelectionSkipped(skipped);
  return true;
}

export function cutSelection(): boolean {
  const c = contextOf(useEditorStore.getState());
  const rect = mapRegion(c);
  if (!canUseSelectionScope() || !rect || !c.store) return false;
  let skipped: readonly string[] = [];
  const layerIds = captureSelectionScope(c.store.document, names => { skipped = names; });
  memoryClip = cutRegion(c.store, layerIds, rect);
  writeSystemClipboard(serializeClip(memoryClip));
  toast.info(t("toast.cut", { width: rect.width, height: rect.height }));
  reportSelectionSkipped(skipped);
  return true;
}

/** Clears the region on the captured selection layers (one undo step). */
export function deleteSelection(): boolean {
  const c = contextOf(useEditorStore.getState());
  const rect = mapRegion(c);
  if (!canUseSelectionScope() || !rect || !c.store) return false;
  const layerIds = captureSelectionScope(c.store.document);
  cutRegion(c.store, layerIds, rect);
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
    // A clip copied before its tileset was removed (memory or system clipboard).
    const gone = clip.palette.some((e) => !doc.getTileset(e.tilesetId));
    toast.error(gone ? t("tilesetLib.pasteRemovedTileset") : t("toast.pasteFailed", { detail: problem }));
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
    const flipped = flipClip(state.stamp, axis);
    // A saved stamp stays one (id + name kept), so the canvas still places it with `placeStamp`.
    const saved = state.stamp as Partial<Stamp>;
    const next =
      typeof saved.id === "string" && typeof saved.name === "string"
        ? Object.freeze({ ...flipped, id: saved.id, name: saved.name })
        : flipped;
    attachPreparedBrush(next,state.stamp);state.setStamp(next);
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
