import { useLayoutStore } from "../layoutStore";
import { useDockContent } from "./dockContentStore";

/** Select a dock tab and reveal its content, including when its strip is collapsed. */
export function showDockTab(id: string): void {
  const layout = useLayoutStore.getState();
  layout.setDockTab(id);
  useDockContent.getState().setCollapsed(false);
  if (layout.recentHidden) layout.setRecentHidden(false);
}
