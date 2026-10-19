import { cellPaletteIndex, isTileLayer } from "@smap/core";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";

import { setCanvasView, useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { ZoomControl } from "../toolOptions/ZoomControl";

function Cell({ children, data, className = "" }: { children: ReactNode; data?: string; className?: string }) {
  return <div className={`flex min-w-0 items-center gap-1.5 px-3 ${className}`} {...(data ? { [`data-status-${data}`]: "" } : {})}>{children}</div>;
}

/** Read one tile through the document API; painting elsewhere causes no React render. */
function useHoveredTileId(): number | "empty" | null {
  const store = useEditorStore((s) => s.project?.store);
  const hover = useEditorStore((s) => s.hoverCell);
  const layerId = useEditorStore((s) => s.activeLayerId);
  const subscribe = useCallback((notify: () => void) => store?.subscribe(notify) ?? (() => undefined), [store]);
  return useSyncExternalStore(subscribe, () => {
    const doc = store?.document;
    const layer = layerId ? doc?.getLayer(layerId) : undefined;
    if (!doc || !hover || !isTileLayer(layer) || hover.x < 0 || hover.y < 0 || hover.x >= doc.map.width || hover.y >= doc.map.height) return null;
    const index = cellPaletteIndex(layer.getCell(hover.x, hover.y));
    return index === 0 ? "empty" : doc.palette.get(index)?.tileId ?? null;
  });
}

/** Compact view selector, with arrow-key navigation matching its radio semantics. */
function CanvasViewChoice() {
  const world = useWorldView((s) => s.view === "world");
  return (
    <div role="radiogroup" aria-label={t("status.canvasView")} className="flex h-5 shrink-0 items-stretch rounded-sm">
      {(["level", "world"] as const).map((view) => {
        const on = world === (view === "world");
        return <button key={view} type="button" role="radio" data-rail={view === "world" ? "world" : undefined} aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => setCanvasView(view)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "level" : event.key === "End" ? "world" : view === "level" ? "world" : "level";
          const group = event.currentTarget.parentElement;
          setCanvasView(next);
          group?.querySelectorAll<HTMLButtonElement>("button")[next === "world" ? 1 : 0]?.focus();
        }} className={`rounded-sm border px-2 text-xs ${on ? "border-line-strong bg-active text-title" : "border-transparent text-muted hover:bg-hover hover:text-text"}`}>{view === "level" ? t("status.map") : t("world.world")}</button>;
      })}
    </div>
  );
}

/** Facts at left, canvas view and the editor's single zoom field at right. */
export function StatusBar() {
  const project = useEditorStore((s) => s.project);
  const name = useEditorStore((s) => s.project?.name ?? "");
  const hover = useEditorStore((s) => s.hoverCell);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const world = useWorldView((s) => s.view === "world");
  const levelCount = useProjectLibrary((s) => s.levels.length);
  const tileId = useHoveredTileId();
  useStructureVersion(project?.store);
  const map = project?.store.document.map;
  const layer = activeLayerId ? project?.store.document.getLayer(activeLayerId) : undefined;
  return (
    <footer aria-label={t("layout.statusBar")} data-status-bar className="flex h-statusbar shrink-0 items-center border-t border-line bg-bg text-xs text-muted [&>*+*]:border-l [&>*+*]:border-line-subtle">
      {world ? <Cell data="world"><span>{t("world.overviewName", { name })}</span><span className="text-faint">·</span><span className="tabular">{t("world.levelCount", { count: levelCount })}</span></Cell> : <>
        <Cell data="cell" className="gap-3 font-mono tabular"><span className="flex gap-1"><span className="text-faint">{t("status.x")}</span><span className="text-text">{hover?.x ?? t("status.noCell")}</span></span><span className="flex gap-1"><span className="text-faint">{t("status.y")}</span><span className="text-text">{hover?.y ?? t("status.noCell")}</span></span></Cell>
        {tileId !== null && <Cell data="tile-id" className={`font-mono tabular ${tileId === "empty" ? "text-faint" : ""}`}>{tileId === "empty" ? t("status.noCell") : t("status.tileId", { id: tileId })}</Cell>}
        {layer && <Cell data="layer"><span className="max-w-50 truncate">{t("status.layerName", { name: layer.name })}</span></Cell>}
        {map && <><Cell data="map" className="tabular">{t("status.mapSize", { width: map.width, height: map.height })}</Cell><Cell data="tile" className="tabular">{map.tileWidth === map.tileHeight ? t("common.px", { value: map.tileWidth }) : t("status.tileSize", { width: map.tileWidth, height: map.tileHeight })}</Cell></>}
      </>}
      <Cell className="ml-auto shrink-0"><CanvasViewChoice /></Cell>
      <Cell data="zoom" className="shrink-0"><ZoomControl /></Cell>
    </footer>
  );
}
