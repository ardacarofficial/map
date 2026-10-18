import { Fragment, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { COLLAPSED_PX, copyLayout, ZONE_SIZES, type DockLayout, type ZoneId } from "./dockModel";
import { useDockStore } from "./dockStore";
import { useDockDrag } from "./DockTabDrag";
import { panelListed, useEntityContext } from "./panels";
import { PanelGroup, ZoneControls } from "./PanelGroup";

/** Shared outer edge: 6px hit area, 1px line, transactional pointer resize. */
export function ZoneSplitter({ zone }: { zone: ZoneId }) {
  const state = useDockStore(s => s.layout.zones[zone]);
  const drag = useRef<{ layout: DockLayout; start: number; px: number; moved: boolean; pointer: number } | null>(null);
  const horizontal = zone === "bottom";
  const sign = zone === "left" ? 1 : -1;
  const end = (cancel: boolean, element: HTMLDivElement) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const s = useDockStore.getState();
    if (cancel) s.update(d.layout, false);
    else if (d.moved) s.commit();
    if (element.hasPointerCapture(d.pointer)) element.releasePointerCapture(d.pointer);
    s.endGesture();
  };
  const pointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const layout = useDockStore.getState().layout;
    const laid = e.currentTarget.parentElement?.getBoundingClientRect();
    drag.current = { layout, start: horizontal ? e.clientY : e.clientX, px: state.state === "expanded" && laid ? (horizontal ? laid.height : laid.width) : state.expandedPx, moved: false, pointer: e.pointerId };
    useDockStore.getState().beginGesture();
    e.currentTarget.focus();
  };
  const pointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (horizontal ? e.clientY : e.clientX) - d.start;
    if (!d.moved && Math.abs(delta) < 4) return;
    d.moved = true;
    const s = useDockStore.getState();
    const layout = copyLayout(s.layout);
    layout.zones[zone].state = "expanded";
    s.update(layout, false);
    s.setSize(zone, d.px + sign * delta);
  };
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && drag.current) { e.preventDefault(); e.stopPropagation(); end(true, e.currentTarget); return; }
    if (e.key === "Enter") { e.preventDefault(); useDockStore.getState().toggleZone(zone); return; }
    if (e.key === "Home") { e.preventDefault(); useDockStore.getState().setSize(zone, ZONE_SIZES[zone].initial, true); return; }
    const delta = horizontal ? (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0) : (e.key === "ArrowRight" ? sign : e.key === "ArrowLeft" ? -sign : 0);
    if (!delta) return;
    e.preventDefault();
    const s = useDockStore.getState();
    const layout = copyLayout(s.layout);
    layout.zones[zone].state = "expanded";
    s.update(layout, false);
    s.setSize(zone, state.expandedPx + delta * (e.shiftKey ? 48 : 16), true);
  };
  return <div role="separator" tabIndex={0} aria-label={t("docking.resize")} aria-orientation={horizontal ? "horizontal" : "vertical"}
    aria-valuemin={ZONE_SIZES[zone].min} aria-valuemax={ZONE_SIZES[zone].max} aria-valuenow={state.state === "collapsed" ? COLLAPSED_PX : state.expandedPx}
    data-zone-splitter={zone} data-dock-resize={zone === "bottom" ? "" : undefined} data-resize-handle={zone === "left" ? "library" : zone === "bottom" ? "dock" : "right"}
    className={`dock-zone-splitter dock-zone-splitter-${zone}`}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={e => end(false, e.currentTarget)} onPointerCancel={e => end(true, e.currentTarget)} onLostPointerCapture={e => end(true, e.currentTarget)}
    onDoubleClick={() => useDockStore.getState().toggleZone(zone)} onKeyDown={keyDown}><div /></div>;
}
function GroupSplitter({ zone, index, nextIndex }: { zone: ZoneId; index: number; nextIndex: number }) {
  const groups = useDockStore(s => s.layout.zones[zone].groups);
  const defaultRatio = zone === "right" && groups[index]?.id === "properties" && groups[nextIndex]?.id === "layers" ? .6 : .5;
  const reset = () => { const layout = copyLayout(useDockStore.getState().layout); change(layout, defaultRatio); useDockStore.getState().update(layout); };
  const drag = useRef<{ layout: DockLayout; start: number; totalPx: number; a: number; b: number; pointer: number } | null>(null);
  const horizontal = zone === "bottom";
  const change = (layout: DockLayout, fraction: number) => {
    const a = layout.zones[zone].groups[index]!, b = layout.zones[zone].groups[nextIndex]!;
    const total = a.weight + b.weight;
    a.weight = total * Math.max(.1, Math.min(.9, fraction));
    b.weight = total - a.weight;
  };
  const end = (cancel: boolean, el: HTMLDivElement) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const s = useDockStore.getState();
    if (cancel) s.update(d.layout, false); else s.commit();
    if (el.hasPointerCapture(d.pointer)) el.releasePointerCapture(d.pointer);
    s.endGesture();
  };
  return <div role="separator" tabIndex={0} aria-label={t("docking.resizeGroup")} aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(100 * (groups[index]?.weight ?? .5) / ((groups[index]?.weight ?? .5) + (groups[nextIndex]?.weight ?? .5)))} aria-orientation={horizontal ? "vertical" : "horizontal"} data-group-splitter={zone} data-section-splitter onDoubleClick={reset} className={`dock-group-splitter ${horizontal ? "dock-group-splitter-horizontal" : ""}`}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus();
      const layout = useDockStore.getState().layout;
      const a = e.currentTarget.previousElementSibling!.getBoundingClientRect(), b = e.currentTarget.nextElementSibling!.getBoundingClientRect();
      drag.current = { layout, start: horizontal ? e.clientX : e.clientY, totalPx: horizontal ? a.width + b.width : a.height + b.height, a: layout.zones[zone].groups[index]!.weight, b: layout.zones[zone].groups[nextIndex]!.weight, pointer: e.pointerId };
      useDockStore.getState().beginGesture();
    }}
    onPointerMove={e => {
      const d = drag.current;
      if (!d) return;
      const layout = copyLayout(d.layout);
      change(layout, d.a / (d.a + d.b) + ((horizontal ? e.clientX : e.clientY) - d.start) / d.totalPx);
      useDockStore.getState().update(layout, false);
    }}
    onPointerUp={e => end(false, e.currentTarget)} onPointerCancel={e => end(true, e.currentTarget)} onLostPointerCapture={e => end(true, e.currentTarget)}
    onKeyDown={e => {
      if (e.key === "Escape" && drag.current) { e.preventDefault(); e.stopPropagation(); end(true, e.currentTarget); return; }
      const delta = horizontal ? (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) : (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0);
      if (!delta && e.key !== "Home") return;
      e.preventDefault();
      const layout = copyLayout(useDockStore.getState().layout);
      const a = layout.zones[zone].groups[index]!, b = layout.zones[zone].groups[nextIndex]!;
      const bounds = e.currentTarget.parentElement!.getBoundingClientRect();
      change(layout, e.key === "Home" ? defaultRatio : a.weight / (a.weight + b.weight) + delta * (e.shiftKey ? 48 : 16) / (horizontal ? bounds.width : bounds.height));
      useDockStore.getState().update(layout);
    }}><div /></div>;
}
export function DockZone({ zone, size, temporaryHidden }: { zone: ZoneId; size: number; temporaryHidden: boolean }) {
  const z = useDockStore(s => s.layout.zones[zone]);
  const dragging = useDockDrag(s => s.panel !== null);
  const entity = useEntityContext();
  const world = useWorldView(s => s.view === "world");
  const collapsed = z.state === "collapsed";
  const hidden = temporaryHidden || z.state === "hidden" || !z.groups.some(g => g.tabs.some(p => panelListed(p, entity, world)));
  const listed = z.groups.map((group, index) => ({ group, index })).filter(({ group }) => group.tabs.some(p => panelListed(p, entity, world)));
  return <>
    <aside data-dock-zone={zone} data-zone-state={z.state} data-dock={zone === "bottom" ? "" : undefined} data-dock-tab={zone === "bottom" ? z.groups[0]?.active : undefined} data-left-panel={zone === "left" ? (z.groups[0]?.active === "project" ? "project" : "library") : undefined} data-right-column={zone === "right" ? "" : undefined}
      aria-label={t(`docking.${zone}`)} className={`dock-zone dock-zone-${zone} ${collapsed ? "dock-zone-collapsed" : ""} ${hidden ? "hidden" : "flex"}`}
      style={zone === "bottom" ? { height: size } : { width: size }}>
      <ZoneSplitter zone={zone} />
      {collapsed && zone !== "bottom" && <div className="flex h-tabrow shrink-0 items-center bg-tab-row"><ZoneControls zone={zone} collapsed /></div>}
      <div className={`flex min-h-0 min-w-0 flex-1 ${zone === "bottom" ? "flex-row" : "flex-col"} ${collapsed ? "overflow-auto" : ""}`}>
        {listed.map(({ group: g, index }, i) => <Fragment key={g.id}>
          {i > 0 && !collapsed && <GroupSplitter zone={zone} index={listed[i - 1]!.index} nextIndex={index} />}
          <PanelGroup zone={zone} group={g} index={index} controls={i === 0} rail={collapsed} />
        </Fragment>)}
      </div>
    </aside>
    {hidden && dragging && <div data-dock-drop-zone={zone} className={`dock-empty-target dock-empty-target-${zone}`}>{t(`docking.${zone}`)}</div>}
  </>;
}
