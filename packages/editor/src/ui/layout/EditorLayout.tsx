import { useEffect, useState } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { CanvasHost } from "../canvas/CanvasHost";
import { PointPickOverlay } from "../levels/PointPickOverlay";
import { UndoHud } from "../feedback/UndoHud";
import { BlockedActionFeedback } from "../feedback/BlockedActionFeedback";
import { CanvasContextMenu } from "../contextMenus/CanvasContextMenu";
import { LibraryPanel } from "../panels/LibraryPanel";
import { SelectionBar } from "../selectionBar/SelectionBar";
import { ToolOptionsBar } from "../toolOptions/ToolOptionsBar";
import { useUiStore } from "../uiStore";
import { AppBar } from "./AppBar";
import { fitColumns } from "./columns";
import { useLayoutStore, wantedLibraryWidth } from "./layoutStore";
import { RecentTilesStrip } from "./RecentTilesStrip";
import { ResizeHandle } from "./ResizeHandle";
import { EdgeReopen, RightColumn } from "./RightColumn";
import { StatusBar } from "./StatusBar";
import { ToolRail } from "./ToolRail";

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * The editor frame (CLAUDE.md → Arayüz, research digest):
 *
 *   menu bar ─ tool options bar ─ [rail | library | canvas + recent tiles | inspector + layers] ─ status bar
 *
 * Side columns are resizable (widths remembered) and never squeezed below
 * their minimum; the canvas takes the rest. Ctrl+B / Ctrl+Alt+B hide the
 * library / right column (a thin edge strip brings them back). `Tab` on the
 * canvas hides the rail, side columns and recent strip (menu and tool
 * options stay); panels stay mounted so scroll / zoom state survives.
 */
export function EditorLayout() {
  const hidden = useUiStore((s) => s.panelsHidden);
  // v1.2 world map: only the level list (plus a short hint); the map panels stay mounted but hidden.
  const world = useWorldView((s) => s.view === "world");
  const viewport = useViewportWidth();
  const wantedLibrary = useLayoutStore((s) => wantedLibraryWidth(s, viewport));
  const wantedRight = useLayoutStore((s) => s.rightWidth);
  const collapsed = useLayoutStore((s) => s.libraryCollapsed);
  const inspectorCollapsed = useLayoutStore((s) => s.inspectorCollapsed);
  const recentHidden = useLayoutStore((s) => s.recentHidden);
  const showLibrary = !hidden && !collapsed && !world;
  const showRight = !hidden && !inspectorCollapsed;
  const widths = fitColumns(viewport, { library: wantedLibrary, right: wantedRight }, { library: showLibrary, right: showRight });

  return (
    <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <AppBar />
      <ToolOptionsBar />
      <div className="flex min-h-0">
        <div className={hidden ? "hidden" : "contents"}>
          <ToolRail />
        </div>
        <aside
          aria-label={t("layout.library")}
          style={{ width: widths.library }}
          className={`relative shrink-0 flex-col border-r border-line bg-panel ${showLibrary ? "flex" : "hidden"}`}
        >
          <LibraryPanel />
          <ResizeHandle column="library" edge="right" width={widths.library} />
        </aside>
        {!hidden && collapsed && !world && (
          <EdgeReopen side="left" label={t("layout.showLibrary")} onClick={() => useLayoutStore.getState().setLibraryCollapsed(false)} />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <main aria-label={t("layout.canvas")} className="relative min-h-0 min-w-0 flex-1">
            <CanvasHost />
            <SelectionBar />
            <UndoHud />
            <PointPickOverlay />
            <CanvasContextMenu />
            <BlockedActionFeedback />
          </main>
          <div className={hidden || world || recentHidden ? "hidden" : "contents"}>
            <RecentTilesStrip />
          </div>
        </div>
        {!hidden && inspectorCollapsed && (
          <EdgeReopen side="right" label={t("layout.showInspector")} onClick={() => useLayoutStore.getState().setInspectorCollapsed(false)} />
        )}
        <RightColumn width={widths.right} visible={showRight} />
      </div>
      <StatusBar />
    </div>
  );
}
