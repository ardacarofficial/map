import type { ReactNode } from "react";

import { formatNumber, t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useWorldView } from "../../commands/worldActions";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";

function Cell({ children, data, className = "" }: { children: ReactNode; data?: string; className?: string }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 px-3 ${className}`} {...(data ? { [`data-status-${data}`]: "" } : {})}>
      {children}
    </div>
  );
}

function Zoom() {
  const zoom = useEditorStore((s) => s.zoom);
  return (
    <Cell data="zoom" className="ml-auto font-mono text-muted tabular">
      <span className="inline-block min-w-[5ch] text-right">{formatNumber(Math.round(zoom * 100))}%</span>
    </Cell>
  );
}

/**
 * Bottom line: hovered cell X / Y, active layer, map size, tile size (left)
 * and zoom (right). Facts only: hints live in tooltips, the save state in
 * the app bar.
 */
export function StatusBar() {
  const project = useEditorStore((s) => s.project);
  const hover = useEditorStore((s) => s.hoverCell);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const world = useWorldView((s) => s.view === "world");
  const levelCount = useProjectLibrary((s) => s.levels.length);
  useStructureVersion(project?.store);
  const map = project?.store.document.map;
  const frame = "flex h-statusbar shrink-0 items-center border-t border-line bg-bg px-1 text-sm text-muted [&>*+*]:border-l [&>*+*]:border-line-subtle";

  if (world) {
    return (
      <footer aria-label={t("layout.statusBar")} className={frame}>
        <Cell data="world">
          <span className="text-accent">{t("world.status")}</span>
          <span className="text-faint">·</span>
          <span className="tabular">{t("world.levelCount", { count: levelCount })}</span>
        </Cell>
        <Cell className="text-faint">{t("world.hintBack")}</Cell>
        <Zoom />
      </footer>
    );
  }

  const layer = activeLayerId ? project?.store.document.getLayer(activeLayerId) : undefined;
  return (
    <footer aria-label={t("layout.statusBar")} className={frame}>
      <Cell data="cell" className="gap-4 font-mono tabular">
        <span>
          <span className="text-faint">X: </span>
          <span className="inline-block min-w-[3ch]">{hover ? hover.x : t("status.noCell")}</span>
        </span>
        <span>
          <span className="text-faint">Y: </span>
          <span className="inline-block min-w-[3ch]">{hover ? hover.y : t("status.noCell")}</span>
        </span>
      </Cell>
      {layer && (
        <Cell data="layer">
          <span className="max-w-[200px] truncate" title={`${t("status.layer")}: ${layer.name}`} aria-label={`${t("status.layer")}: ${layer.name}`}>
            {layer.name}
          </span>
        </Cell>
      )}
      {map && (
        <>
          <Cell data="map" className="tabular">
            {t("status.mapSize", { width: map.width, height: map.height })}
          </Cell>
          <Cell data="tile" className="tabular">
            {map.tileWidth === map.tileHeight ? t("common.px", { value: map.tileWidth }) : t("status.tileSize", { width: map.tileWidth, height: map.tileHeight })}
          </Cell>
        </>
      )}
      <Zoom />
    </footer>
  );
}
