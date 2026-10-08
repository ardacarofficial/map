import type { TileClip } from "@smap/core";

import { useEditorStore, type TileSelection } from "../../state/editorStore";
import { useUiStore } from "../uiStore";

/**
 * Click on a recent tile: it becomes the brush (single tile, no stamp or
 * random set), the brush tool is picked and the tileset panel shows its
 * tileset. Tiles of a tileset that no longer exists are ignored.
 */
export function pickRecentTile(tile: TileSelection): boolean {
  const editor = useEditorStore.getState();
  const doc = editor.project?.store.document;
  if (!doc?.getTileset(tile.tilesetId)) return false;
  editor.setSelection({ tilesetId: tile.tilesetId, tileId: tile.tileId });
  editor.setStamp(null);
  if (editor.randomSet.length > 0) editor.setRandomSet([]);
  editor.setTool("brush");
  useUiStore.getState().setActiveTileset(tile.tilesetId);
  return true;
}

/**
 * Click on a recent stamp: it becomes the brush again (random set and
 * marquee cleared, brush tool). False when none of its tilesets exist.
 */
export function pickRecentStamp(stamp: TileClip): boolean {
  const editor = useEditorStore.getState();
  const doc = editor.project?.store.document;
  if (!doc || !stamp.palette.some((p) => doc.getTileset(p.tilesetId))) return false;
  if (editor.randomSet.length > 0) editor.setRandomSet([]);
  editor.setStamp(stamp);
  editor.setRegion(null);
  editor.setTool("brush");
  return true;
}
