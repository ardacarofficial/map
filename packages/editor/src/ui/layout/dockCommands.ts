import { useWorldView } from "../../commands/worldActions";
import { isEntityLayer } from "@smap/core";
import { allCommands, registerCommands, registerPaletteProvider, runCommand } from "../../commands/registry";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useUiStore } from "../uiStore";
import { PANEL_IDS, ZONE_IDS, locatePanel, type PanelId, type ZoneId } from "./dockModel";
import { revealPanel, useDockStore } from "./dockStore";
import { PANELS, panelListed } from "./panels";
import { panelMenu } from "./PanelGroup";

const ready = () => useEditorStore.getState().project !== null && !useEditorStore.getState().project?.store.inTransaction;
const readyForPanel = (panel: PanelId) => {
  const s = useEditorStore.getState();
  return ready() && panelListed(panel, isEntityLayer(s.activeLayerId ? s.project?.store.document.getLayer(s.activeLayerId) : undefined), useWorldView.getState().view === "world");
};
const showTitles: Record<ZoneId, MessageKey> = { left: "docking.showLeft", right: "docking.showRight", bottom: "docking.showBottom" };
const hideTitles: Record<ZoneId, MessageKey> = { left: "docking.hideLeft", right: "docking.hideRight", bottom: "docking.hideBottom" };
const moveTitles: Record<ZoneId, MessageKey> = { left: "docking.moveLeft", right: "docking.moveRight", bottom: "docking.moveBottom" };
/** Idempotent: registry commands and dynamic palette labels share the same actions. */
export function registerDockCommands(): void {
  registerCommands([
    { id: "view.toggleBottom", title: "docking.toggleBottom", category: "view", enabled: ready, checked: () => useDockStore.getState().layout.zones.bottom.state === "expanded", run: () => { if (useUiStore.getState().panelsHidden) runCommand("view.togglePanels"); useDockStore.getState().toggleZone("bottom"); } },
    ...ZONE_IDS.flatMap(zone => [
      { id: `dock.${zone}.show` as const, title: showTitles[zone], category: "view" as const, enabled: ready, run: () => useDockStore.getState().setZoneState(zone, "expanded") },
      { id: `dock.${zone}.hide` as const, title: hideTitles[zone], category: "view" as const, enabled: ready, run: () => useDockStore.getState().setZoneState(zone, "hidden") },
    ]),
    ...PANEL_IDS.flatMap(panel => [
      ...ZONE_IDS.map(zone => ({ id: `panel.${panel}.${zone}` as const, title: moveTitles[zone], category: "view" as const, inPalette: false, enabled: () => readyForPanel(panel) && locatePanel(useDockStore.getState().layout, panel)?.zone !== zone, run: () => useDockStore.getState().move(panel, { zone }) })),
      { id: `panel.${panel}.show` as const, title: `docking.show_${panel}` as MessageKey, category: "view" as const, enabled: () => readyForPanel(panel), run: () => { revealPanel(panel); } },
      ...(["forward", "backward", "split", "merge", "hide"] as const).map(action => ({
        id: `panel.${panel}.${action}` as const, title: `docking.${action}` as MessageKey, category: "view" as const, inPalette: false,
        enabled: () => readyForPanel(panel) && panelMenu(panel).some(item => item.type === "item" && item.id === action && !item.disabled),
        run: () => { const item = panelMenu(panel).find(item => item.type === "item" && item.id === action); if (item?.type === "item") item.run?.(); },
      })),
    ]),
  ]);
  if (!providerInstalled) {
    providerInstalled = true;
    registerPaletteProvider(() => allCommands().filter(command => command.id.startsWith("panel.") && command.inPalette === false && command.enabled?.()).map(command => {
      const panel = command.id.split(".")[1] as typeof PANEL_IDS[number];
      return { key: command.id, prefix: t(PANELS[panel].label), title: t(command.title), run: () => { runCommand(command.id); } };
    }));
  }
}
let providerInstalled = false;
