import { DockZone } from "../DockZone";
import { COLLAPSED_PX } from "../dockModel";
import { useDockStore } from "../dockStore";
export { showDockTab } from "./dockActions";
/** Compatibility host; Recent is the default bottom panel. */
export function BottomDock() {
  const zone = useDockStore(s => s.layout.zones.bottom);
  return <DockZone zone="bottom" size={zone.state === "collapsed" ? COLLAPSED_PX : zone.expandedPx} temporaryHidden={false} />;
}
