/**
 * Glue between the tileset panel selection and the editor brush:
 * committing a selection, what the panel highlights, and map pick sync
 * (right click / right drag on the map highlights and reveals the source
 * tiles in the panel).
 */
import type { MapDocument, TileClip, Tileset } from "@smap/core";

import type { CanvasPickEvent } from "../../canvas/canvasEvents";
import { tileLayerForPick } from "../../commands/terrainActions";
import { useEditorStore, type EditorState, type ToolId } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { useStampLibrary } from "../stamps/stampLibraryStore";
import { useUiStore } from "../uiStore";
import { brushFor, cellOf, clipSourceIds, type Cell } from "./selectionModel";
import { useTilesetView, type PanelSelection } from "./tilesetViewStore";

/** Tools that keep working with a new tileset pick; any other tool switches to the brush. */
const KEEPS_TOOL: readonly ToolId[] = ["brush", "fill", "rect"];

/**
 * Makes `ids` of `tileset` the brush (see `brushFor`): one tile → plain
 * selection, several → a stamp clip. Ends a random brush, moves off a
 * terrain / collision layer onto a tile layer, and switches to the brush
 * unless fill or rectangle is active. Returns false when nothing was left
 * to select (e.g. only transparent tiles).
 */
export function commitTilesetSelection(
  tileset: Tileset,
  ids: readonly number[],
  corners: { anchor: Cell; focus: Cell },
  empty: ReadonlySet<number>,
): boolean {
  const s = useEditorStore.getState();
  const brush = brushFor(tileset, ids, empty, s.activeLayerId ?? "tiles");
  if (!brush) return false;
  useStampLibrary.getState().select(null);
  s.setRandomSet([]);
  const view = useTilesetView.getState();
  if (brush.kind === "tile") {
    s.setStamp(null);
    s.setSelection({ tilesetId: tileset.id, tileId: brush.tileId });
    const cell = ids.length === 1 ? corners.focus : cellOf(tileset, brush.tileId);
    view.setSelection({ tilesetId: tileset.id, ids: [brush.tileId], anchor: ids.length === 1 ? corners.anchor : cell, focus: cell, clip: null });
  } else {
    // The single selection stays the top-left tile, so dropping the stamp (Esc) leaves a sensible brush.
    s.setSelection({ tilesetId: tileset.id, tileId: brush.ids[0]! });
    s.setStamp(brush.clip);
    view.setSelection({ tilesetId: tileset.id, ids: brush.ids, anchor: corners.anchor, focus: corners.focus, clip: brush.clip });
  }
  const doc = s.project?.store.document;
  const target = doc ? tileLayerForPick(doc, s.activeLayerId) : null;
  if (target) s.setActiveLayer(target);
  if (!KEEPS_TOOL.includes(s.tool)) s.setTool("brush");
  return true;
}

/** What the tileset panel highlights for `tilesetId`: the cells the current brush came from (sorted ids). */
export function highlightedIds(
  editor: Pick<EditorState, "stamp" | "selection" | "randomSet">,
  panel: PanelSelection | null,
  tilesetId: string,
): readonly number[] {
  if (editor.stamp) return panel && panel.tilesetId === tilesetId && panel.clip === editor.stamp ? panel.ids : [];
  if (editor.randomSet.length >= 2) return [];
  if (editor.selection?.tilesetId === tilesetId) return [editor.selection.tileId];
  return [];
}

/**
 * The panel selection a map pick maps to: a tile → that tile; a clip whose
 * cells form a block of one tileset → those cells (`clip` kept so the
 * highlight lasts while it is the brush); anything else → null.
 */
export function pickSelection(event: CanvasPickEvent, getTileset: (id: string) => Tileset | undefined): PanelSelection | null {
  if (event.kind === "tile") {
    const tileset = getTileset(event.tilesetId);
    if (!tileset) return null;
    const cell = cellOf(tileset, event.tileId);
    return { tilesetId: tileset.id, ids: [event.tileId], anchor: cell, focus: cell, clip: null };
  }
  if (event.kind === "clip") {
    const source = clipSourceIds(event.clip, getTileset);
    const tileset = source ? getTileset(source.tilesetId) : undefined;
    if (!source || !tileset) return null;
    return {
      tilesetId: tileset.id,
      ids: source.ids,
      anchor: cellOf(tileset, source.ids[0]!),
      focus: cellOf(tileset, source.ids[source.ids.length - 1]!),
      clip: event.clip as TileClip,
    };
  }
  return null;
}

/** Applies a map pick to the panel: switch to its tileset, highlight, scroll into view. */
export function syncPick(event: CanvasPickEvent, doc: MapDocument | undefined): void {
  if (!doc) return;
  const selection = pickSelection(event, (id) => doc.getTileset(id));
  if (!selection) return;
  const ui = useUiStore.getState();
  if (ui.activeTilesetId !== selection.tilesetId) ui.setActiveTileset(selection.tilesetId);
  const view = useTilesetView.getState();
  view.setSelection(selection);
  view.requestReveal(selection.tilesetId, selection.ids);
}

let installed = false;

/** Subscribes to the map canvas' pick events for the life of the app (idempotent). */
export function installTilesetPickSync(): void {
  if (installed) return;
  installed = true;
  let unsubscribe: (() => void) | null = null;
  watchCanvasHandle((handle) => {
    unsubscribe?.();
    unsubscribe = handle
      ? handle.onPick((event) => syncPick(event, useEditorStore.getState().project?.store.document))
      : null;
  });
}
