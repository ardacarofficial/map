/** Legacy dock registration; the canonical dockable host is layout/panels.tsx. */
import { registerDockTab } from "../layout/dock/registry";
import { TilesetView } from "../tileset/view/TilesetView";

registerDockTab({ id: "tileset", label: "tilesetDock.title", order: 10, Component: TilesetView });
