import { cellPaletteIndex, type MapDocument, type TileClip } from "@smap/core";

import { t } from "../../i18n";
import { clipKey } from "../../state/recentItems";

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

/**
 * The stamp's anchor tile: the first non-empty tile cell in row-major order
 * (top-left first), searching the tile layers bottom to top. Null when the
 * stamp holds no tiles (grid layers only).
 */
export function stampAnchorTile(clip: TileClip): { tilesetId: string; tileId: number } | null {
  for (const layer of clip.layers) {
    if (layer.grid) continue;
    for (const cell of layer.cells) {
      const index = cellPaletteIndex(cell);
      const entry = index > 0 ? clip.palette[index - 1] : undefined;
      if (entry) return entry;
    }
  }
  return null;
}

/**
 * Strip label for a recent stamp. Saved stamps use their name; ad-hoc ones
 * name their anchor tile ("overworld-32 · 3×3 @ 12"), so two same-sized
 * selections never read the same.
 */
export function recentStampLabel(doc: MapDocument | undefined, clip: TileClip & { name?: unknown }): string {
  const size = { width: clip.width, height: clip.height };
  if (typeof clip.name === "string") return t("recent.savedStamp", { name: clip.name, ...size });
  const anchor = stampAnchorTile(clip);
  const tileset = anchor ? doc?.getTileset(anchor.tilesetId) : undefined;
  // A short content hash: two unsaved stamps of the same size and anchor tile still read differently.
  const hash = shortClipHash(clip);
  if (!anchor || !tileset) return t("recent.stamp", { ...size, hash });
  return t("recent.stampFrom", { tileset: tileset.name, id: anchor.tileId, ...size, hash });
}

/** Four base-36 characters from the clip's content key ({@link clipKey}). */
export function shortClipHash(clip: TileClip): string {
  const h = clipKey(clip).split("|").pop() ?? "";
  return h.padStart(4, "0").slice(-4);
}
