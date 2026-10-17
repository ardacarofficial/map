/** The tileset view lives in the bottom dock only. */
import { registerDockTab } from "../layout/dock/registry";
import { TilesetView } from "../tileset/view/TilesetView";

registerDockTab({ id: "tileset", label: "tilesetDock.title", order: 10, Component: TilesetView });
