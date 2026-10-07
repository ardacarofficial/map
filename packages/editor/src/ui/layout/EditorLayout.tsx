import { CanvasHost } from "../canvas/CanvasHost";
import { LayersPanel } from "../panels/LayersPanel";
import { PropertiesPanel } from "../panels/PropertiesPanel";
import { LibraryPanel } from "../panels/LibraryPanel";
import { LevelsPanel } from "../levels/LevelsPanel";
import { PointPickOverlay } from "../levels/PointPickOverlay";
import { useUiStore } from "../uiStore";
import { useWorldView } from "../../commands/worldActions";
import { WorldHint } from "../levels/WorldHint";
import { StatusBar } from "./StatusBar";
import { ToolRail } from "./ToolRail";
import { Toolbar } from "./Toolbar";

/**
 * Toolbar on top, tool rail left, canvas center, panels right, status bar
 * bottom (CLAUDE.md → Arayüz). `Tab` on the canvas hides the side panels;
 * they stay mounted so scroll/zoom state survives.
 */
export function EditorLayout() {
  const hidden = useUiStore((s) => s.panelsHidden);
  // v1.2 world map: only the level list (plus a short hint); the map panels stay mounted but hidden.
  const world = useWorldView((s) => s.view === "world");
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      <Toolbar />
      <div className="flex min-h-0">
        <div className={hidden ? "hidden" : "contents"}>
          <ToolRail />
        </div>
        <main className="relative min-w-0 flex-1">
          <CanvasHost />
          <PointPickOverlay />
        </main>
        <aside
          className={`w-sidebar shrink-0 flex-col border-l border-line bg-panel ${hidden ? "hidden" : "flex"}`}
        >
          <LevelsPanel />
          {world && <WorldHint />}
          <div className={world ? "hidden" : "contents"}>
            <LayersPanel />
            <LibraryPanel />
            <PropertiesPanel />
          </div>
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
