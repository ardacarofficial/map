import { useEffect, useState } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { CanvasHost } from "../canvas/CanvasHost";
import { PointPickOverlay } from "../levels/PointPickOverlay";
import { DocumentTabs } from "../levels/DocumentTabs";
import { UndoHud } from "../feedback/UndoHud";
import { BlockedActionFeedback } from "../feedback/BlockedActionFeedback";
import { CanvasContextMenu } from "../contextMenus/CanvasContextMenu";
import { LibraryPanel } from "../panels/LibraryPanel";
import { useUiStore } from "../uiStore";
import { AppBar } from "./AppBar";
import { fitColumns } from "./columns";
import { BottomDock } from "./dock/BottomDock";
import { useLayoutStore, wantedLibraryWidth } from "./layoutStore";
import { PanelRail } from "./PanelRail";
import { ResizeHandle } from "./ResizeHandle";
import { EdgeReopen, RightColumn } from "./RightColumn";
import { useRulersSync } from "./rulers";
import { StatusBar } from "./StatusBar";
import { ToolBar } from "./ToolBar";

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
 * The editor frame (round 4 concept):
 *
 *   app bar
 *   rail | document tabs ─────────────────────────────────────────────
 *        | tool bar ───────────────────────────────┐ right column:
 *        | library | canvas                        │ Denetçi | Geçmiş
 *        |         | bottom dock (Tileset | Son…)  │ Katmanlar
 *   status bar
 *
 * Side columns are resizable (widths remembered) and never squeezed below
 * their minimum; the canvas takes the rest. Ctrl+B / Ctrl+Alt+B hide the
 * left / right column (a thin edge strip brings them back). `Tab` on the
 * canvas hides the rail, side columns and dock (app bar, tabs and tool bar
 * stay); panels stay mounted so scroll / zoom state survives.
 */
export function EditorLayout() {
  const hidden = useUiStore((s) => s.panelsHidden);
  const world = useWorldView((s) => s.view === "world");
  const viewport = useViewportWidth();
  const wantedLibrary = useLayoutStore((s) => wantedLibraryWidth(s, viewport));
  const wantedRight = useLayoutStore((s) => s.rightWidth);
  const collapsed = useLayoutStore((s) => s.libraryCollapsed);
  const inspectorCollapsed = useLayoutStore((s) => s.inspectorCollapsed);
  const dockHidden = useLayoutStore((s) => s.recentHidden);
  useRulersSync();
  const showLibrary = !hidden && !collapsed;
  const showRight = !hidden && !inspectorCollapsed;
  const widths = fitColumns(viewport, { library: wantedLibrary, right: wantedRight }, { library: showLibrary, right: showRight });

  return (
    <div className="flex h-full flex-col">
      <AppBar />
      <div className="flex min-h-0 flex-1">
        <div className={hidden ? "hidden" : "contents"}>
          <PanelRail />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <DocumentTabs />
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <ToolBar />
              <div className="flex min-h-0 flex-1">
                <aside
                  aria-label={t("layout.library")}
                  style={{ width: widths.library }}
                  className={`relative shrink-0 flex-col border-r border-line bg-panel ${showLibrary ? "flex" : "hidden"}`}
                >
                  <LibraryPanel />
                  <ResizeHandle column="library" edge="right" width={widths.library} />
                </aside>
                {!hidden && collapsed && (
                  <EdgeReopen side="left" label={t("layout.showLibrary")} onClick={() => useLayoutStore.getState().setLibraryCollapsed(false)} />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <main aria-label={t("layout.canvas")} className="relative min-h-0 min-w-0 flex-1 bg-canvas">
                    <CanvasHost />
                    <UndoHud />
                    <PointPickOverlay />
                    <CanvasContextMenu />
                    <BlockedActionFeedback />
                  </main>
                  <div className={hidden || world || dockHidden ? "hidden" : "contents"}>
                    <BottomDock />
                  </div>
                </div>
              </div>
            </div>
            {!hidden && inspectorCollapsed && (
              <EdgeReopen side="right" label={t("layout.showInspector")} onClick={() => useLayoutStore.getState().setInspectorCollapsed(false)} />
            )}
            <RightColumn width={widths.right} visible={showRight} />
          </div>
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
