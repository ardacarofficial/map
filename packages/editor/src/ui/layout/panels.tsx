import { ColorPanel } from '../pixel/ColorPanel';
import { usePixelUi } from '../../state/pixelUi';
import { useSyncExternalStore } from "react";
import { isEntityLayer } from "@smap/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import { useWorldView } from "../../commands/worldActions";
import type { MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useUiStore } from "../uiStore";
import { EntityPalette } from "../entities/EntityPalette";
import { HistoryPanel } from "../history/HistoryPanel";
import "../history/historyVerbs";
import { InspectorBody } from "../inspector/Inspector";
import { WorldHint } from "../levels/WorldHint";
import { ProjectTree } from "../levels/ProjectTree";
import { LayersPanel } from "../panels/LayersPanel";
import { StampsPanel } from "../stamps/StampsPanel";
import { TilesetView } from "../tileset/view/TilesetView";
import { PANEL_IDS, type PanelId } from "./dockModel";
import { revealPanel, useDockStore } from "./dockStore";
import { RecentTilesStrip } from "./RecentTilesStrip";

interface PanelDefinition { label: MessageKey; Component: ComponentType; focus: string; visible?(context: { entity: boolean; world: boolean }): boolean }
export const PANELS: Record<PanelId, PanelDefinition> = {
  color: { label: "colorPanel.title", Component: ColorPanel, focus: "[data-color-control=square]" },
  tileset: { label: "tilesetDock.title", Component: TilesetView, focus: "[data-tileset-viewport], [data-tileset-empty]" },
  stamps: { label: "panels.stamps", Component: StampsPanel, focus: "input, button" },
  project: { label: "project.title", Component: () => <ProjectTree fill />, focus: "[role=treeitem], button" },
  recent: { label: "recent.title", Component: RecentTilesStrip, focus: "button" },
  inspector: { label: "inspector.title", Component: DockInspector, focus: "input, button" },
  history: { label: "history.title", Component: HistoryPanel, focus: "button" },
  layers: { label: "layers.title", Component: LayersPanel, focus: "[data-layers-list]", visible: ({ world }) => !world },
  entities: { label: "panels.entities", Component: EntityPalette, focus: "button", visible: ({ entity }) => entity },
};
function DockInspector() {
  const world = useWorldView(s => s.view === "world");
  return <>
    <div className={`${world ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}><InspectorBody /></div>
    {world && <WorldHint />}
  </>;
}
export function panelListed(id: PanelId, entity: boolean, world = false): boolean { return PANELS[id].visible?.({ entity, world }) ?? true; }
export function useEntityContext(): boolean {
  const store = useEditorStore(s => s.project?.store);
  const active = useEditorStore(s => s.activeLayerId);
  const subscribe = useCallback((notify: () => void) => store?.subscribe(notify) ?? (() => {}), [store]);
  return useSyncExternalStore(subscribe, () => isEntityLayer(active ? store?.document.getLayer(active) : undefined));
}
/** Portal containers never change identity. Only their DOM parent changes on a committed move. */
export function PanelHosts() {
  const layout = useDockStore(s => s.layout);
  const hidden = useUiStore(s => s.panelsHidden);
  const scrolls = useRef(new Map<HTMLElement, { left: number; top: number }>());
  const visibility = useRef(new Map<PanelId, boolean>());
  const entity = useEntityContext();
  const beforeEntity = useRef(false);
  const pixel = usePixelUi(s => s.mode === "pixel");
  const beforePixel = useRef(false);
  useEffect(() => { if (pixel && !beforePixel.current) revealPanel("color"); beforePixel.current = pixel; }, [pixel]);
  const world = useWorldView(s => s.view === "world");
  const beforeWorld = useRef(false);
  const parking = useRef<HTMLDivElement>(null);
  const [hosts] = useState(() => new Map(PANEL_IDS.map(id => {
    const node = document.createElement("div");
    node.dataset.panel = id;
    node.className = "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden";
    if (id === "layers") node.dataset.section = "layers";
    if (id === "inspector" || id === "history") { node.dataset.section = "properties"; node.dataset.rightTabBody = id; }
    if (["stamps", "project", "entities"].includes(id)) node.dataset.libraryTab = id;
    return [id, node] as const;
  })));
  useEffect(() => {
    if (world && !beforeWorld.current) revealPanel("project");
    beforeWorld.current = world;
  }, [world]);
  useEffect(() => {
    if (entity && !beforeEntity.current) revealPanel("entities");
    beforeEntity.current = entity;
  }, [entity]);
  // Browsers may zero scroll offsets while a host is disconnected or display:none.
  // Record scroll events while visible, then restore those same nodes after reparenting.
  useEffect(() => {
    const onScroll = (event: Event) => {
      const node = event.target;
      if (node instanceof HTMLElement && node.getClientRects().length) scrolls.current.set(node, { left: node.scrollLeft, top: node.scrollTop });
    };
    for (const host of hosts.values()) host.addEventListener("scroll", onScroll, true);
    return () => { for (const host of hosts.values()) host.removeEventListener("scroll", onScroll, true); };
  }, [hosts]);
  useLayoutEffect(() => {
    for (const [id, host] of hosts) {
      const target = document.querySelector(`[data-panel-slot="${id}"]`) ?? parking.current;
      const moved = !!target && host.parentElement !== target;
      if (moved) target.appendChild(host);
      const visible = host.getClientRects().length > 0;
      if (visible && (moved || !visibility.current.get(id))) {
        for (const [node, position] of scrolls.current) if (host.contains(node)) {
          node.scrollLeft = position.left; node.scrollTop = position.top;
        }
      }
      visibility.current.set(id, visible);
    }
  }, [hosts, layout, entity, hidden, world]);
  useEffect(() => () => { for (const host of hosts.values()) host.remove(); }, [hosts]);
  return <>
    <div ref={parking} hidden data-panel-parking />
    {PANEL_IDS.map(id => { const Content = PANELS[id].Component; return createPortal(<Content />, hosts.get(id)!, id); })}
  </>;
}
