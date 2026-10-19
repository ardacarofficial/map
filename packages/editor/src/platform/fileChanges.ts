/**
 * Reacts to "a project file changed on disk" hints from the platform
 * (desktop: file watcher; browser: window focus).
 *
 * - Level / project file → the existing "changed on disk" check (it compares
 *   text, so our own writes never count).
 * - Tileset PNG → reloaded in place (CLAUDE.md v0.5: saving the PNG from
 *   Aseprite is enough). The canvas rebuilds its atlas via `onTilesetImage`.
 */
import { PROJECT_FILE_NAME, type Tileset } from "@smap/core";

import { t } from "../i18n";
import { decodePng } from "../io/projectIo";
import { checkDiskForChanges, getProjectFolder } from "../io/session";
import { hasPngSignature } from "../io/tilesetImport";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { toast } from "../ui/toast/toastStore";
import { getPlatform, type ProjectFileChange } from "./index";

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Reloads run one after another per path (a burst of events reads once more at most). */
const running = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Re-reads `path` (project-relative) and swaps the image of every tileset using it. */
export function reloadTilesetImage(path: string): Promise<void> {
  const current = running.get(path);
  if (current) {
    again.add(path);
    return current;
  }
  const run = (async () => {
    try {
      do {
        again.delete(path);
        await reloadOnce(path);
      } while (again.has(path));
    } finally {
      running.delete(path);
    }
  })();
  running.set(path, run);
  return run;
}

async function reloadOnce(path: string): Promise<void> {
  const project = useEditorStore.getState().project;
  const folder = getProjectFolder();
  if (!project || !folder) return;
  const tilesets = project.store.document.tilesets.filter((ts) => ts.imagePath === path);
  if (tilesets.length === 0) return;

  let bytes: Uint8Array;
  try {
    bytes = await folder.fs.readBytes(path);
  } catch {
    return; // Mid-write or deleted: the next event (or focus) tries again.
  }
  // A half-written file: wait for the event that follows the final write.
  if (!hasPngSignature(bytes)) return;
  const stale = tilesets.filter((ts) => {
    const image = getTilesetImage(ts.id);
    return !image?.bytes || !sameBytes(image.bytes, bytes);
  });
  if (stale.length === 0) return;

  for (const tileset of stale) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await decodePng(bytes);
    } catch (error) {
      getPlatform().log("warn", `tileset reload failed ${path}: ${String(error)}`);
      toast.error(t("settings.tilesetReloadFailed", { name: tileset.name, detail: String(error) }));
      return;
    }
    // The project may have been closed or switched while decoding.
    if (useEditorStore.getState().project !== project || getProjectFolder() !== folder) {
      bitmap.close();
      return;
    }
    setTilesetImage({ tilesetId: tileset.id, bitmap, bytes });
    getPlatform().log("info", `tileset reloaded ${path} (${bitmap.width}x${bitmap.height})`);
    if (sizeChanged(tileset, bitmap)) {
      toast.warning(t("settings.tilesetResized", { name: tileset.name, width: bitmap.width, height: bitmap.height }));
    } else {
      toast.success(t("settings.tilesetReloaded", { name: tileset.name }));
    }
  }
}

/** The new image no longer holds the tileset's grid (tile ids would shift or vanish). */
function sizeChanged(tileset: Tileset, bitmap: ImageBitmap): boolean {
  // Extra pixels on the right/bottom that do not make a full tile are fine.
  const columns = Math.floor((bitmap.width - tileset.margin * 2 + tileset.spacing) / (tileset.tileWidth + tileset.spacing));
  const rows = Math.floor((bitmap.height - tileset.margin * 2 + tileset.spacing) / (tileset.tileHeight + tileset.spacing));
  return columns !== tileset.columns || rows !== tileset.rows;
}

/** What a change hint means for the editor. Pure (tested). */
export function classifyChange(change: ProjectFileChange): "level" | "tileset" | "ignore" {
  const path = change.path;
  if (path.startsWith("tilesets/") && path.toLowerCase().endsWith(".png")) return change.kind === "removed" ? "ignore" : "tileset";
  if (path === PROJECT_FILE_NAME || (path.startsWith("levels/") && path.toLowerCase().endsWith(".json"))) return "level";
  return "ignore";
}

/** Subscribes to the platform's change hints. Call once; returns an uninstall function. */
export function installFileChangeHandling(): () => void {
  let levelCheckQueued = false;
  return getPlatform().onFileChanged((change) => {
    switch (classifyChange(change)) {
      case "tileset":
        void reloadTilesetImage(change.path);
        break;
      case "level":
        // Several level files in one burst → one check.
        if (levelCheckQueued) return;
        levelCheckQueued = true;
        queueMicrotask(() => {
          levelCheckQueued = false;
          void checkDiskForChanges();
        });
        break;
      case "ignore":
        break;
    }
  });
}
