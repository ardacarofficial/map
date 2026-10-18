/** `view.history`: shows the right column's Geçmiş tab. Idempotent registration. */
import { registerCommands } from "../../commands/registry";
import { useEditorStore } from "../../state/editorStore";
import { revealPanel, useDockStore } from "../layout/dockStore";
import { locatePanel } from "../layout/dockModel";

export function showHistory(): void {
  revealPanel("history");
}

let registered = false;

export function registerHistoryCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands([
    {
      id: "view.history",
      title: "commands.view.history",
      category: "view",
      enabled: () => useEditorStore.getState().project !== null,
      checked: () => {
        const layout = useDockStore.getState().layout, at = locatePanel(layout, "history");
        return !!at && layout.zones[at.zone].state === "expanded" && layout.zones[at.zone].groups[at.group]!.active === "history";
      },
      run: showHistory,
    },
  ]);
}
