import { useState } from "react";

import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { PointMenu, type MenuPoint } from "../contextMenus/RowContextMenu";
import { SEPARATOR, type ContextEntry } from "../contextMenus/contextItems";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { Tabs } from "../primitives/Tabs";
import { copyLayout, locatePanel, ZONE_IDS, type Group, type PanelId, type ZoneId } from "./dockModel";
import { revealPanel, useDockStore } from "./dockStore";
import { startPanelDrag } from "./DockTabDrag";
import { PANELS, panelListed, useEntityContext } from "./panels";

export function panelMenu(panel: PanelId): ContextEntry[] {
  const s = useDockStore.getState();
  const at = locatePanel(s.layout, panel);
  const g = at ? s.layout.zones[at.zone].groups[at.group] : undefined;
  const entries: ContextEntry[] = [
    { type: "item", id: "move", label: t("docking.move"), submenu: ZONE_IDS.map(zone => ({ type: "item", id: `move-${zone}`, label: t(`docking.${zone}`), disabled: at?.zone === zone, run: () => s.move(panel, { zone }) })) },
    { type: "item", id: "forward", label: t("docking.forward"), disabled: !at || at.index === 0, run: () => { if (at) s.move(panel, { ...at, index: at.index - 1 }); } },
    { type: "item", id: "backward", label: t("docking.backward"), disabled: !at || !g || at.index === g.tabs.length - 1, run: () => { if (at) s.move(panel, { ...at, index: at.index + 2 }); } },
    SEPARATOR,
    { type: "item", id: "split", label: t("docking.split"), disabled: !at || !g || g.tabs.length < 2, run: () => { if (at) s.move(panel, { zone: at.zone, split: "end" }); } },
    { type: "item", id: "merge", label: t("docking.merge"), disabled: !at || s.layout.zones[at.zone].groups.length < 2, run: () => { if (at) s.move(panel, { zone: at.zone, group: at.group === 0 ? 1 : at.group - 1 }); } },
    SEPARATOR,
    { type: "item", id: "hide", label: t("docking.hide"), run: () => s.hidePanel(panel) },
  ];
  const wrap = (entry: ContextEntry): ContextEntry => entry.type !== "item" ? entry : {
    ...entry,
    ...(entry.submenu ? { submenu: entry.submenu.map(wrap) } : {}),
    ...(entry.run ? { run: () => {
      entry.run?.();
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(`[data-panel-tab="${panel}"]`) ?? document.querySelector<HTMLElement>(`[data-dock-zone="${at?.zone ?? "left"}"] [data-panel-tab][aria-selected=true]`);
        target?.focus({ preventScroll: true });
      });
    } } : {}),
  };
  return entries.map(wrap);
}
export function ZoneControls({ zone, collapsed }: { zone: ZoneId; collapsed: boolean }) {
  return <>
    <IconButton size="sm" data-zone-collapse={zone} data-dock-hide={zone === "bottom" ? "" : undefined} data-inspector-toggle={zone === "right" ? "" : undefined}
      aria-label={t(collapsed ? "docking.expand" : "docking.collapse")} title={t(collapsed ? "docking.expand" : "docking.collapse")}
      onClick={() => useDockStore.getState().toggleZone(zone)}>
      <Icon name={zone === "bottom" ? (collapsed ? "chevron-up" : "chevron-down") : "chevronRight"} size={12} className={zone !== "bottom" && (zone === "left") !== collapsed ? "rotate-180" : ""} />
    </IconButton>
    {!collapsed && <IconButton size="sm" data-zone-hide={zone} aria-label={t("docking.hideZone")} title={t("docking.hideZone")} onClick={() => useDockStore.getState().setZoneState(zone, "hidden")}><Icon name="close" size={12} /></IconButton>}
  </>;
}
export function PanelGroup({ zone, group, index, rail = false, controls = index === 0 }: { zone: ZoneId; group: Group; index: number; rail?: boolean; controls?: boolean }) {
  const entity = useEntityContext();
  const world = useWorldView(s => s.view === "world");
  const listed = group.tabs.filter(id => panelListed(id, entity, world));
  const active = listed.includes(group.active) ? group.active : listed[0];
  const [menu, setMenu] = useState<{ panel: PanelId; at: MenuPoint; trigger: HTMLButtonElement } | null>(null);
  const toggleGroup = () => {
    const s = useDockStore.getState();
    const layout = copyLayout(s.layout);
    layout.zones[zone].groups[index]!.collapsed = !group.collapsed;
    s.update(layout);
  };
  if (!active) return null;
  return <section data-active-panel={active} data-dock-group={index} data-group-id={group.id} className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${rail ? "shrink-0" : "flex-1"}`} style={rail ? undefined : { flexGrow: group.collapsed ? 0 : group.weight, flexBasis: group.collapsed ? "var(--spacing-tabrow)" : 0 }}>
    <Tabs scrollable orientation={rail && zone !== "bottom" ? "vertical" : "horizontal"} label={t(`docking.${zone}`)} value={active} data-dock-strip={index} className={rail && zone !== "bottom" ? "dock-rail-tabs" : "dock-group-tabs"}
      onValueChange={id => { revealPanel(id); }}
      items={listed.map(id => ({ value: id, label: t(PANELS[id].label), attrs: {
        "data-panel-tab": id,
        "aria-controls": `panel-${id}`,
        ...(id === "tileset" || id === "recent" ? { "data-dock-tab-button": id } : {}),
        ...(id === "inspector" || id === "history" ? { "data-right-tab": id } : {}),
        ...(["stamps", "project", "entities"].includes(id) ? { "data-library-tab-button": id } : {}),
        ...(id === "stamps" || id === "project" ? { "data-rail": id === "stamps" ? "library" : "project" } : {}),
        onPointerDown: (event) => startPanelDrag(event, id),
        onDoubleClick: toggleGroup,
        onContextMenu: event => { event.preventDefault(); setMenu({ panel: id, at: { x: event.clientX, y: event.clientY }, trigger: event.currentTarget }); },
        onKeyDown: event => {
          if (event.key === "ContextMenu" || ((event.shiftKey || event.ctrlKey) && event.key === "F10")) {
            event.preventDefault(); event.stopPropagation();
            const r = event.currentTarget.getBoundingClientRect();
            setMenu({ panel: id, at: { x: r.x, y: r.bottom }, trigger: event.currentTarget });
          }
        },
      } }))}
      trailing={(!rail || zone === "bottom") && controls ? <ZoneControls zone={zone} collapsed={rail} /> : undefined}
    />
    <div className={`${rail || group.collapsed ? "hidden" : "flex"} min-h-0 min-w-0 flex-1 flex-col`}>
      {group.tabs.map(id => <div key={id} id={`panel-${id}`} data-panel-slot={id} role="tabpanel" aria-label={t(PANELS[id].label)} className={`${id === active ? "flex" : "hidden"} h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden`} />)}
    </div>
    {menu && <PointMenu at={menu.at} items={() => menu ? panelMenu(menu.panel) : []} onClose={() => { menu?.trigger.focus({ preventScroll: true }); setMenu(null); }} />}
  </section>;
}
