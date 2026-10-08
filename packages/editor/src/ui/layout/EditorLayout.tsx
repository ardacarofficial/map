import { useEffect, useState } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { CanvasHost } from "../canvas/CanvasHost";
import { LevelsPanel } from "../levels/LevelsPanel";
import { PointPickOverlay } from "../levels/PointPickOverlay";
import { WorldHint } from "../levels/WorldHint";
import { LayersPanel } from "../panels/LayersPanel";
import { LibraryPanel } from "../panels/LibraryPanel";
import { PropertiesPanel } from "../panels/PropertiesPanel";
import { ToolOptionsBar } from "../toolOptions/ToolOptionsBar";
import { useUiStore } from "../uiStore";
import { AppBar } from "./AppBar";
import { fitColumns } from "./columns";
import { useLayoutStore } from "./layoutStore";
import { RecentTilesStrip } from "./RecentTilesStrip";
import { ResizeHandle } from "./ResizeHandle";
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
 * their minimum; the canvas takes the rest. `Tab` on the canvas hides the
 * rail, side columns and recent strip (menu and tool options stay); panels
 * stay mounted so scroll / zoom state survives.
 */
export function EditorLayout() {
  const hidden = useUiStore((s) => s.panelsHidden);
  // v1.2 world map: only the level list (plus a short hint); the map panels stay mounted but hidden.
  const world = useWorldView((s) => s.view === "world");
  const viewport = useViewportWidth();
  const wantedLibrary = useLayoutStore((s) => s.libraryWidth);
  const wantedRight = useLayoutStore((s) => s.rightWidth);
  const collapsed = useLayoutStore((s) => s.libraryCollapsed);
  const showLibrary = !hidden && !collapsed && !world;
  const showRight = !hidden;
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
          <ResizeHandle column="library" edge="right" />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="relative min-h-0 min-w-0 flex-1">
            <CanvasHost />
            <PointPickOverlay />
          </main>
          <div className={hidden || world ? "hidden" : "contents"}>
            <RecentTilesStrip />
          </div>
        </div>
        <aside
          style={{ width: widths.right }}
          className={`relative shrink-0 flex-col border-l border-line bg-panel ${showRight ? "flex" : "hidden"}`}
        >
          <ResizeHandle column="right" edge="left" />
          <LevelsPanel />
          {world && <WorldHint />}
          <div className={world ? "hidden" : "contents"}>
            <PropertiesPanel />
            <LayersPanel />
          </div>
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
