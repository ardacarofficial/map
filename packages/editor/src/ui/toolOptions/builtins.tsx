/**
 * Built-in tool options (registered once by `registerBuiltinToolOptions`):
 * the shared collapsed "Boyut 1 ▾" chip for brush / eraser and the terrain
 * picker on terrain layers. The collision kind is on the Denetçi's
 * collision card; tool hints are in the tool tooltips.
 */
import { Menu } from "@base-ui/react/menu";
import { isEntityLayer, isGridLayer, type Terrain } from "@smap/core";

import { activateTerrain, allTerrains } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { TileSwatch } from "../primitives/TileSwatch";
import { terrainSwatchTile } from "../terrain/TerrainList";
import { BrushSizeChip } from "../inspector/BrushSizeChip";
import { registerToolOptions, type ToolOptionsContext } from "./registry";
import { OptionLabel, triggerClass } from "./parts";

const isTerrainLayer = (c: ToolOptionsContext) => isGridLayer(c.layer) && c.layer.role === "terrain";
/** The terrain picker shows only on a terrain layer (plain tile layers paint tiles; terrains are picked in the Araziler list). */
const showsTerrainPicker = isTerrainLayer;

// ---- Terrain layer: which terrain the brush paints

function TerrainPicker() {
  const store = useEditorStore((s) => s.project?.store);
  const value = useEditorStore((s) => s.gridValue);
  const onTerrainLayer = useEditorStore((s) => {
    const layer = s.activeLayerId ? s.project?.store.document.getLayer(s.activeLayerId) : undefined;
    return isGridLayer(layer) && layer.role === "terrain";
  });
  useStructureVersion(store);
  const doc = store?.document;
  if (!doc) return null;
  const terrains = allTerrains(doc);
  if (terrains.length === 0) {
    return (
      <div className="flex min-w-0 items-center gap-1.5" data-tool-option="terrain">
        <OptionLabel>{t("toolOptions.terrain")}</OptionLabel>
        <span className="truncate text-sm text-faint">{t("terrain.noneHint")}</span>
      </div>
    );
  }
  // On a tile layer nothing is "current": the trigger invites a pick.
  const current = onTerrainLayer ? terrains.find((tr) => tr.id === value) : undefined;
  const swatch = (terrain: Terrain, size: number) => {
    const tileset = doc.getTileset(terrain.tilesetId);
    return tileset ? <TileSwatch tileset={tileset} tileId={terrainSwatchTile(tileset, terrain)} size={size} className="rounded-xs" /> : null;
  };
  // Grouped by tileset when there are several.
  const groups = doc.tilesets
    .map((ts) => ({ tileset: ts, terrains: terrains.filter((tr) => tr.tilesetId === ts.id) }))
    .filter((g) => g.terrains.length > 0);
  return (
    <div className="flex items-center gap-1.5" data-tool-option="terrain">
      <OptionLabel>{t("toolOptions.terrain")}</OptionLabel>
      <Menu.Root>
        <Menu.Trigger aria-label={t("terrain.brush")} className={`${triggerClass} max-w-[220px]`}>
          {current ? swatch(current, 16) : <span className="size-4 rounded-xs bg-line" />}
          <span className="min-w-0 truncate">{current?.name ?? t("toolOptions.pickTerrain")}</span>
          <Icon name="chevronDown" size={12} className="shrink-0 text-faint" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
            <Menu.Popup className={`${menuPopupClass} max-h-[360px] overflow-y-auto`}>
              {groups.map((group, gi) => (
                <Menu.Group key={group.tileset.id}>
                  {gi > 0 && <Menu.Separator className={menuSeparatorClass} />}
                  {groups.length > 1 && (
                    <Menu.GroupLabel className="px-2 pt-1 pb-0.5 text-2xs font-semibold tracking-wide text-faint">{group.tileset.name}</Menu.GroupLabel>
                  )}
                  {group.terrains.map((terrain) => (
                    <Menu.Item key={terrain.id} className={`${menuItemClass} py-1 text-sm`} onClick={() => activateTerrain(terrain.id)}>
                      {swatch(terrain, 18)}
                      <span className="min-w-0 flex-1 truncate">{terrain.name}</span>
                      {terrain.id === current?.id && <Icon name="check" size={13} className="text-accent" />}
                    </Menu.Item>
                  ))}
                </Menu.Group>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

let registered = false;

/** Registers the built-in entries (idempotent). */
export function registerBuiltinToolOptions(): void {
  if (registered) return;
  registered = true;
  registerToolOptions(["brush", "eraser"], BrushSizeChip, { id: "builtin.brushSize", order: 10, when: (c) => !isEntityLayer(c.layer) });
  registerToolOptions(["brush", "rect", "fill"], TerrainPicker, { id: "builtin.terrain", order: 30, when: showsTerrainPicker });
}
