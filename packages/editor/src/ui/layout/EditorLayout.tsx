import { CanvasHost } from "../canvas/CanvasHost";
import { LayersPanel } from "../panels/LayersPanel";
import { PropertiesPanel } from "../panels/PropertiesPanel";
import { LibraryPanel } from "../panels/LibraryPanel";
import { useUiStore } from "../uiStore";
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
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      <Toolbar />
      <div className="flex min-h-0">
        <div className={hidden ? "hidden" : "contents"}>
          <ToolRail />
        </div>
        <main className="relative min-w-0 flex-1">
          <CanvasHost />
        </main>
        <aside
          className={`w-sidebar shrink-0 flex-col border-l border-line bg-panel ${hidden ? "hidden" : "flex"}`}
        >
          <LayersPanel />
          <LibraryPanel />
          <PropertiesPanel />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
