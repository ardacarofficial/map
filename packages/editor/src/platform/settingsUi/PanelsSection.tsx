import { useRef } from "react";
import { useWorldView } from "../../commands/worldActions";
import { t } from "../../i18n";
import { Button, IconButton } from "../../ui/primitives/Button";
import { Icon } from "../../ui/primitives/Icon";
import { NativeSelect } from "../../ui/primitives/NativeSelect";
import { copyLayout, defaultDockLayout, hidePanel, movePanel, PANEL_IDS, ZONE_IDS, type DockLayout, type PanelId, type ZoneId } from "../../ui/layout/dockModel";
import { PANELS, panelListed, useEntityContext } from "../../ui/layout/panels";

export function PanelsSection({ layout, onChange }: { layout: DockLayout; onChange(layout: DockLayout): void }) {
  const root = useRef<HTMLDivElement>(null);
  const entity = useEntityContext();
  const world = useWorldView(s => s.view === "world");
  const hide = (panel: PanelId) => {
    const rows = [...root.current!.querySelectorAll<HTMLElement>("[data-settings-panel]")];
    const at = rows.findIndex(row => row.dataset.settingsPanel === panel);
    const neighbor = rows[at + 1] ?? rows[at - 1];
    onChange(hidePanel(layout, panel));
    requestAnimationFrame(() => (neighbor?.querySelector<HTMLElement>("select,button") ?? root.current?.querySelector<HTMLElement>("select,button"))?.focus());
  };
  return <div ref={root} className="flex flex-col gap-4">
    {ZONE_IDS.map(zone => <section key={zone} data-settings-zone={zone} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-md font-semibold text-title">{t(`docking.${zone}`)}</h3>
        <NativeSelect aria-label={t("settingsUi.addPanel", { zone: t(`docking.${zone}`) })} value="" onChange={event => onChange(movePanel(layout, event.target.value as PanelId, { zone }))}>
          <option value="" disabled>{t("settingsUi.add")}</option>
          {PANEL_IDS.map(panel => <option key={panel} value={panel}>{t(PANELS[panel].label)}</option>)}
        </NativeSelect>
      </div>
      <NativeSelect aria-label={t("settingsUi.zoneState", { zone: t(`docking.${zone}`) })} value={layout.zones[zone].state} onChange={event => { const next = copyLayout(layout); next.zones[zone].state = event.target.value as "expanded" | "collapsed" | "hidden"; onChange(next); }}>
        {(["expanded", "collapsed", "hidden"] as const).map(state => <option key={state} value={state}>{t(`settingsUi.${state}`)}</option>)}
      </NativeSelect>
      {layout.zones[zone].groups.map((group, groupIndex) => <div key={group.id} data-settings-group={group.id} className="border-t border-line-subtle pt-2">
        <p className="mb-1 text-xs text-muted">{t("settingsUi.group", { number: groupIndex + 1 })}</p>
        {group.tabs.map((panel, index) => <div key={panel} data-settings-panel={panel} className="flex flex-wrap items-center gap-1 py-1">
          <div className="min-w-0 flex-1"><span className="text-sm">{t(PANELS[panel].label)}</span>{!panelListed(panel, entity, world) && <p className="text-xs text-muted">{t(panel === "entities" ? "settingsUi.entityContext" : "settingsUi.layerContext")}</p>}</div>
          <NativeSelect size="sm" aria-label={t("settingsUi.panelZone", { panel: t(PANELS[panel].label) })} value={zone} onChange={event => onChange(movePanel(layout, panel, { zone: event.target.value as ZoneId }))}>{ZONE_IDS.map(id => <option key={id} value={id}>{t(`docking.${id}`)}</option>)}</NativeSelect>
          <IconButton size="sm" aria-label={t("settingsUi.up")} disabled={index === 0} onClick={() => onChange(movePanel(layout, panel, { zone, group: groupIndex, index: index - 1 }))}><Icon name="chevron-up" size={12} /></IconButton>
          <IconButton size="sm" aria-label={t("settingsUi.down")} disabled={index === group.tabs.length - 1} onClick={() => onChange(movePanel(layout, panel, { zone, group: groupIndex, index: index + 2 }))}><Icon name="chevron-down" size={12} /></IconButton>
          <Button size="sm" variant="ghost" disabled={group.tabs.length < 2} onClick={() => onChange(movePanel(layout, panel, { zone, split: "end" }))}>{t("docking.split")}</Button>
          <Button size="sm" variant="ghost" disabled={layout.zones[zone].groups.length < 2} onClick={() => onChange(movePanel(layout, panel, { zone, group: groupIndex === 0 ? 1 : groupIndex - 1 }))}>{t("docking.merge")}</Button>
          <IconButton size="sm" aria-label={t("docking.hide")} onClick={() => hide(panel)}><Icon name="minus" size={12} /></IconButton>
        </div>)}
      </div>)}
    </section>)}
    {!!layout.hiddenPanels.length && <p className="text-sm text-muted">{t("settingsUi.hiddenPanels", { panels: layout.hiddenPanels.map(panel => t(PANELS[panel].label)).join(", ") })}</p>}
    <Button className="self-start" onClick={() => onChange(defaultDockLayout())}>{t("commands.view.resetLayout")}</Button>
  </div>;
}
