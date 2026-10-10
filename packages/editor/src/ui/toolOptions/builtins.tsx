/**
 * Built-in tool options (registered once by `registerBuiltinToolOptions`):
 * the shared collapsed "Boyut 1 ▾" chip for brush / eraser and, on tile
 * layers of a project with terrains, the terrain brush ("Arazi: ● Çimen ▾"
 * + Autotile). The collision kind is on the Denetçi's collision card; tool
 * hints are in the tool tooltips.
 */
import { isEntityLayer, isTileLayer } from "@smap/core";

import { setAutotile } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { BrushSizeChip } from "../inspector/BrushSizeChip";
import { TerrainPickerMenu } from "../terrain/TerrainMenus";
import { resolveTerrain, terrainSetEntries } from "../terrain/terrainModel";
import { registerToolOptions, type ToolOptionsContext } from "./registry";
import { OptionLabel, triggerClass } from "./parts";

/** The terrain picker shows on tile layers once the project has a terrain. */
const showsTerrainPicker = (c: ToolOptionsContext) => isTileLayer(c.layer) && terrainSetEntries(c.doc).length > 0;

// ---- Tile layer: the terrain brush (Arazi ▾ + Autotile)

function TerrainPicker() {
  const store = useEditorStore((s) => s.project?.store);
  const terrain = useEditorStore((s) => s.terrain);
  const active = useEditorStore((s) => s.terrainActive);
  useStructureVersion(store);
  const doc = store?.document;
  if (!doc) return null;
  const valid = resolveTerrain(doc, terrain) !== null;
  return (
    <div className="flex items-center gap-2" data-tool-option="terrain">
      <OptionLabel>{t("toolOptions.terrain")}</OptionLabel>
      <TerrainPickerMenu
        doc={doc}
        value={valid ? terrain : null}
        triggerClass={`${triggerClass} max-w-[200px] ${active && valid ? "" : "opacity-70"}`}
        label={t("terrain.brush")}
        placeholder={t("toolOptions.pickTerrain")}
        dataAttr="data-terrain-current"
      />
      <label className={`flex h-7 items-center gap-1.5 text-sm ${valid ? "cursor-pointer text-muted" : "cursor-default text-faint"}`} title={t("terrain.autotileHint")}>
        <input
          type="checkbox"
          role="switch"
          aria-label={t("terrain.autotile")}
          data-tool-autotile=""
          checked={active && valid}
          disabled={!valid}
          onChange={(e) => setAutotile(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        {t("terrain.autotile")}
      </label>
    </div>
  );
}

let registered = false;

/** Registers the built-in entries (idempotent). */
export function registerBuiltinToolOptions(): void {
  if (registered) return;
  registered = true;
  registerToolOptions(["brush", "eraser"], BrushSizeChip, { id: "builtin.brushSize", order: 10, when: (c) => !isEntityLayer(c.layer) });
  registerToolOptions(["brush", "eraser", "rect", "fill"], TerrainPicker, { id: "builtin.terrain", order: 30, when: showsTerrainPicker });
}
