import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { runCommand } from "../../../commands/registry";
import { t } from "../../../i18n";
import { IconButton } from "../../primitives/Button";
import { Icon } from "../../primitives/Icon";
import { Tooltip } from "../../primitives/Tooltip";
import { RecentTilesStrip } from "../RecentTilesStrip";
import { DOCK, useLayoutStore } from "../layoutStore";
import { dockTabs, registerDockTab, useDockVersion } from "./registry";

registerDockTab({ id: "recent", label: "recent.title", order: 20, Component: RecentTilesStrip });

/** Selects a dock tab and makes sure the dock is shown (e.g. a tileset card in the library). */
export function showDockTab(id: string): void {
  const s = useLayoutStore.getState();
  s.setDockTab(id);
  if (s.recentHidden) s.setRecentHidden(false);
}

/**
 * The bottom dock under the canvas: a tab strip (registered tabs, see
 * `dock/registry.ts`) over the selected tab's content. Its top edge
 * resizes it (height remembered; double-click: back to 150 px). The canvas
 * always keeps at least 160 px.
 */
export function BottomDock() {
  useDockVersion();
  const height = useLayoutStore((s) => s.dockHeight);
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
      style={{ height, maxHeight: "calc(100% - 160px)" }}
      className="relative flex shrink-0 flex-col border-t border-line bg-panel"
    >
      <DockResizeHandle />
      <div className="flex h-dockbar shrink-0 items-center gap-1 border-b border-line-subtle pr-1 pl-2">
        <div role="tablist" aria-label={t("layout.dock")} className="flex h-full min-w-0 items-stretch gap-1 overflow-x-auto">
          {tabs.map((x) => {
            const on = x.id === tab.id;
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-dock-tab-button={x.id}
                onClick={() => setTab(x.id)}
                className={`relative flex shrink-0 items-center px-2.5 text-sm transition-colors ${on ? "text-text" : "text-faint hover:text-muted"}`}
              >
                {t(x.label)}
                {on && <span aria-hidden className="absolute right-1.5 bottom-0 left-1.5 h-0.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {Actions && <Actions />}
          <Tooltip label={t("layout.hideDock")} command="view.toggleRecent">
            <IconButton aria-label={t("layout.hideDock")} className="size-7" data-dock-hide="" onClick={() => runCommand("view.toggleRecent")}>
              <Icon name="chevronDown" size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Content />
      </div>
    </section>
  );
}

/** Top edge of the dock: drag to resize, double-click for the default height, arrow keys nudge. */
function DockResizeHandle() {
  const height = useLayoutStore((s) => s.dockHeight);
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
    if (d.moved) setHeight(useLayoutStore.getState().dockHeight, true);
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
      onDoubleClick={() => setHeight(DOCK.initial, true)}
      onKeyDown={onKeyDown}
      className="group absolute -top-[3px] right-0 left-0 z-20 h-1.5 cursor-row-resize touch-none outline-none"
    >
      <div className="my-auto mt-[2px] h-px w-full bg-transparent transition-colors duration-100 group-hover:bg-accent-line group-focus-visible:bg-accent group-active:bg-accent" />
    </div>
  );
}
