import { activeSmartStamp, useSmartStampSession } from "../stamps/smartStampSession";
import { SmartStampOptions } from "./SmartStampOptions";
/**
 * Built-in tool options (registered once by `registerBuiltinToolOptions`):
 * the shared collapsed "Boyut 1 ▾" chip for brush / eraser, the "Rastgele"
 * toggle for brush / fill / rectangle and, on tile
 * layers of a project with terrains, the terrain brush ("Arazi: ● Çimen ▾"
 * + Autotile). The collision kind is on the Denetçi's collision card; tool
 * hints are in the tool tooltips.
 */
import { isEntityLayer, isTileLayer } from "@smap/core";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import type { CommandId } from "../../shortcuts/shortcuts";
import { Toggle } from "../primitives/Toggle";
import { useIsRandomBrush } from "../../commands/randomBrush";
import { useUiStore } from "../uiStore";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { Tooltip } from "../primitives/Tooltip";
import { setAutotile } from "../../commands/terrainActions";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { BrushSizeChip } from "../inspector/BrushSizeChip";
import { TerrainPickerMenu } from "../terrain/TerrainMenus";
import { resolveTerrain, terrainSetEntries } from "../terrain/terrainModel";
import { registerToolOptions, type ToolOptionsContext } from "./registry";
import { OptionLabel } from "./parts";
import { SelectionScopeOptions } from "./SelectionScopeOptions";
import { RectangleOptions } from "./RectangleOptions";
import { RandomToggle } from "./RandomToggle";

/** The terrain picker shows on tile layers once the project has a terrain. */
const showsTerrainPicker = (c: ToolOptionsContext) => {
  const active = useUiStore.getState().activeTilesetId ?? c.doc?.tilesets[0]?.id;
  return !activeSmartStamp() && isTileLayer(c.layer) && c.brush !== "random" && terrainSetEntries(c.doc).some(entry => entry.tileset.id === active);
};

// ---- Tile layer: the terrain brush (Arazi ▾ + Autotile)

function TerrainPicker() {
  const store = useEditorStore((s) => s.project?.store);
  const tilesetId = useUiStore((s) => s.activeTilesetId) ?? store?.document.tilesets[0]?.id;
  const random = useIsRandomBrush();
  const terrain = useEditorStore((s) => s.terrain);
  const active = useEditorStore((s) => s.terrainActive);
  useStructureVersion(store);
  const doc = store?.document;
  if (!doc || random) return null;
  const valid = terrain?.tilesetId === tilesetId && resolveTerrain(doc, terrain) !== null;
  return (
    <div className="flex h-control-sm shrink-0 items-center gap-1.5 rounded-sm border border-line bg-field px-1.5 focus-within:border-accent" data-tool-option="terrain">
      <OptionLabel>{t("toolOptions.terrain")}</OptionLabel>
      <TerrainPickerMenu
        doc={doc}
        tilesetId={tilesetId}
        value={valid ? terrain : null}
        triggerClass="flex h-full max-w-32 items-center gap-1.5 rounded-sm px-1 text-sm text-text outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-accent"
        inactiveLabel={active && valid ? undefined : t("toolOptions.terrainOff")}
        label={t("terrain.brush")}
        placeholder={t("toolOptions.pickTerrain")}
        dataAttr="data-terrain-current"
      />
      <Tooltip label={t("terrain.autotileHint")}><span className="flex items-center">
        <Toggle label={t("terrain.autotile")} data-tool-autotile="" data-terrain-autotile="" checked={active && valid} disabled={!valid} onChange={setAutotile} />
      </span></Tooltip>
    </div>
  );
}

/** Options bar: size only (the FIRÇA card shows the shape once the size is above 1). */
function OptionsBrushSize() {
  const usage = useSmartStampSession(s => s.usage);
  return <BrushSizeChip withShape={!!activeSmartStamp() && usage === "road"} />;
}

const TRANSFORMS: readonly { command: CommandId; icon: IconName; title: MessageKey }[] = [
  { command: "edit.flipX", icon: "flip-horizontal-2", title: "commands.edit.flipX" },
  { command: "edit.flipY", icon: "flip-vertical-2", title: "commands.edit.flipY" },
  { command: "edit.rotateCCW", icon: "rotate-ccw", title: "inspector.rotateCCW" },
  { command: "edit.rotateCW", icon: "rotate-cw", title: "inspector.rotateCW" },
];

/** Existing brush/stamp transform commands, sharing their enabled state. */
function BrushTransforms() {
  const store = useEditorStore((s) => s.project?.store);
  useStructureVersion(store);
  // Command predicates also depend on brush content and selection.
  useEditorStore((s) => s.selection);
  useEditorStore((s) => s.stamp);
  useEditorStore((s) => s.region);
  useEditorStore((s) => s.randomSet);
  useEditorStore((s) => s.activeLayerId);
  return <div className="flex items-center gap-1" data-tool-option="transforms">{TRANSFORMS.map(({ command, icon, title }) => {
    const cmd = getCommand(command);
    return <Tooltip key={command} label={t(cmd?.title ?? title)} command={command}><IconButton size="md" aria-label={t(cmd?.title ?? title)} disabled={!cmd || !isEnabled(cmd)} data-command={command} onClick={() => runCommand(command)}><Icon name={icon} size={16} /></IconButton></Tooltip>;
  })}</div>;
}

let registered = false;

/** Registers the built-in entries (idempotent). */
export function registerBuiltinToolOptions(): void {
  if (registered) return;
  registered = true;
  registerToolOptions(["brush", "eraser", "rect", "fill"], SmartStampOptions, { id: "smartStamp.usage", order: 15, when: () => !!activeSmartStamp() });
  registerToolOptions("select", SelectionScopeOptions, { id: "selection.scope", order: 10 });
  registerToolOptions(["rect"], RectangleOptions, { id: "builtin.rectangle", order: 5, when: (c) => !isEntityLayer(c.layer) && (!activeSmartStamp() || useSmartStampSession.getState().usage === "road") });
  registerToolOptions(["brush", "eraser"], OptionsBrushSize, { id: "builtin.brushSize", order: 10, when: (c) => !isEntityLayer(c.layer) });
  registerToolOptions(["brush", "fill", "rect"], RandomToggle, { id: "builtin.random", order: 20, when: (c) => isTileLayer(c.layer) && !activeSmartStamp() });
  registerToolOptions(["brush", "fill", "rect"], BrushTransforms, { id: "builtin.transforms", order: 40, when: (c) => c.brush !== "none" });
  registerToolOptions(["brush", "eraser", "rect", "fill"], TerrainPicker, { id: "builtin.terrain", order: 30, when: showsTerrainPicker });
}
