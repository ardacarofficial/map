/** `view.history`: shows the right column's Geçmiş tab. Idempotent registration. */
import { registerCommands } from "../../commands/registry";
import { useEditorStore } from "../../state/editorStore";
import { useLayoutStore } from "../layout/layoutStore";

export function showHistory(): void {
  const layout = useLayoutStore.getState();
  if (layout.inspectorCollapsed) layout.setInspectorCollapsed(false);
  layout.setRightTab("history");
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
      checked: () => useLayoutStore.getState().rightTab === "history" && !useLayoutStore.getState().inspectorCollapsed,
      run: showHistory,
    },
  ]);
}
