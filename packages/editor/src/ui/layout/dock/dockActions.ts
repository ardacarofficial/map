import { isPanelId } from "../dockModel";
import { revealPanel } from "../dockStore";

/** Opens a panel at its current dock location. */
export function showDockTab(id: string): void {
  if (isPanelId(id)) revealPanel(id);
}
