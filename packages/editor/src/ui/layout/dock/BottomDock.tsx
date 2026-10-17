import { useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { t } from "../../../i18n";
import { IconButton } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";
import { Tooltip } from "../../primitives/Tooltip";
import { Tabs } from "../../primitives/Tabs";
import { useDockContent } from "./dockContentStore";
import { RecentTilesStrip } from "../RecentTilesStrip";
import { DOCK, effectiveDockHeight, useLayoutStore } from "../layoutStore";
import { dockTabs, registerDockTab, useDockVersion } from "./registry";
// The tileset view registers its own "tileset" tab (order 10) when its module loads.
import "../../panels/TilesetPanel";

registerDockTab({ id: "recent", label: "recent.title", order: 20, Component: RecentTilesStrip });

export { showDockTab } from "./dockActions";

function subscribeResize(cb: () => void): () => void {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

/** The window height (re-renders on resize). */
function useViewportHeight(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 768);
}

/** The dock height as laid out: the dragged height, or the content default for the window height. */
function useDockHeight(): number {
  const stored = useLayoutStore((s) => s.dockHeight);
  const viewport = useViewportHeight();
  return effectiveDockHeight(stored, viewport);
}

/**
 * The bottom dock under the canvas: a tab strip (registered tabs, see
 * `dock/registry.ts`) over the selected tab's content. Its top edge
 * resizes it (height remembered; double-click: back to the default, which
 * fits the tileset content and window height). The canvas always keeps at least 160 px.
 */
export function BottomDock() {
  useDockVersion();
  const height = useDockHeight();
  const collapsed = useDockContent((s) => s.collapsed);
  const setCollapsed = useDockContent((s) => s.setCollapsed);
  const selected = useLayoutStore((s) => s.dockTab);
  const setTab = useLayoutStore((s) => s.setDockTab);
  const tabs = dockTabs();
  const tab = tabs.find((x) => x.id === selected) ?? tabs[0];
  if (!tab) return null;
  const Content = tab.Component;
  const Actions = tab.Actions;
  return (
    <section
      aria-label={t("layout.dock")}
      data-dock=""
      data-dock-tab={tab.id}
      style={{ height: collapsed ? 29 : height, maxHeight: "calc(100% - 160px)" }}
      className="relative flex shrink-0 flex-col border-t border-line bg-panel"
    >
      {!collapsed && <DockResizeHandle />}
      <Tabs
        label={t("layout.dock")}
        value={tab.id}
        onValueChange={(id) => { setTab(id); setCollapsed(false); }}
        items={tabs.map((x) => ({ value: x.id, label: t(x.label), attrs: { "data-dock-tab-button": x.id } }))}
        trailing={<>
          {Actions && <Actions />}
          <Tooltip label={t(collapsed ? "tilesetDock.expand" : "tilesetDock.collapse")}>
            <IconButton size="sm" aria-label={t(collapsed ? "tilesetDock.expand" : "tilesetDock.collapse")} data-dock-hide="" onClick={() => setCollapsed(!collapsed)}>
              <Icon name={collapsed ? "chevron-up" : "chevron-down"} size={16} />
            </IconButton>
          </Tooltip>
        </>}
      />
      <div className={`min-h-0 flex-1 flex-col ${collapsed ? "hidden" : "flex"}`}>
        <Content />
      </div>
    </section>
  );
}

/** Top edge of the dock: drag to resize, double-click for the default height, arrow keys nudge. */
function DockResizeHandle() {
  const height = useDockHeight();
  const setHeight = useLayoutStore((s) => s.setDockHeight);
  const drag = useRef<{ startY: number; start: number; moved: boolean } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Start from the height as laid out (the CSS max may have shrunk it).
    const laid = event.currentTarget.parentElement?.getBoundingClientRect().height ?? height;
    drag.current = { startY: event.clientY, start: Math.round(laid), moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(event.clientY - d.startY) < 2) return;
    d.moved = true;
    setHeight(d.start - (event.clientY - d.startY));
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved) setHeight(useLayoutStore.getState().dockHeight ?? d.start, true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    setHeight(height + (event.key === "ArrowUp" ? step : -step), true);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("layout.resizeDock")}
      aria-valuemin={DOCK.min}
      aria-valuemax={DOCK.max}
      aria-valuenow={height}
      tabIndex={0}
      title={t("layout.resizeSectionHint")}
      data-dock-resize=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => setHeight(null, true)}
      onKeyDown={onKeyDown}
      className="group absolute -top-[3px] right-0 left-0 z-20 h-1.5 cursor-row-resize touch-none outline-none"
    >
      <div className="my-auto mt-[2px] h-px w-full bg-transparent transition-colors duration-100 group-hover:bg-accent-line group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}
