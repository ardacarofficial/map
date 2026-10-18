import { useEditorStore } from "../state/editorStore";
import { registerCommands } from "./registry";

export function registerSelectionPickCommands(): void {
  registerCommands([
    { id: "selection.toggleMode", title: "connectedSelection.toggle", category: "edit", enabled: () => !!useEditorStore.getState().project, run: () => {
      const s = useEditorStore.getState(); s.setSelectionMode(s.selectionMode === "rectangle" ? "connected" : "rectangle");
    } },
    { id: "pick.toggleScope", title: "layerPick.toggle", category: "edit", enabled: () => !!useEditorStore.getState().project, run: () => {
      const s = useEditorStore.getState(); s.setPickScope(s.pickScope === "all" ? "active" : "all");
    } },
  ]);
}
