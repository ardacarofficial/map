import { useEffect, useState } from "react";

import { t } from "../i18n";
import { addTilesetFiles, createProjectFromTilesets } from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { Icon } from "./primitives/Icon";
import { useUiStore } from "./uiStore";

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

/**
 * Window-wide file drop: PNGs dropped anywhere become tilesets (or a new
 * project on the welcome screen). Shows an overlay over the editor while
 * files are dragged; the welcome screen highlights its own drop zone.
 */
export function FileDropOverlay() {
  const dragging = useUiStore((s) => s.draggingFiles);
  const hasProject = useEditorStore((s) => s.project !== null);
  /** Files being dragged (browsers report the count while dragging; 0 = unknown). */
  const [count, setCount] = useState(0);

  useEffect(() => {
    let depth = 0;
    const set = (v: boolean) => useUiStore.getState().setDraggingFiles(v);
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setCount([...(e.dataTransfer?.items ?? [])].filter((item) => item.kind === "file").length);
      set(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) set(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      set(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      // The new project dialog takes drops itself (its starting tileset); elsewhere they are ignored meanwhile.
      if (files.length === 0 || useUiStore.getState().newProjectOpen) return;
      if (useEditorStore.getState().project) void addTilesetFiles(files);
      else void createProjectFromTilesets(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (!dragging || !hasProject) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-overlay p-6">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-accent-line bg-accent-soft">
        <div className="grid size-12 place-items-center rounded-full bg-raised text-accent shadow-popup">
          <Icon name="upload" size={22} />
        </div>
        <div className="text-lg font-medium text-text">{count > 1 ? t("drop.overlayMany", { count }) : t("drop.overlay")}</div>
        <div className="text-md text-muted">{count > 1 ? t("drop.overlayHintMany") : t("drop.overlayHint")}</div>
      </div>
    </div>
  );
}
