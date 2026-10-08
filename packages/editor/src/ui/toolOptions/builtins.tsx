/**
 * Built-in tool options (registered once by `registerBuiltinToolOptions`):
 * brush size and shape for brush / eraser, the terrain picker on terrain
 * layers, the collision exception kind on collision layers, and a one-line
 * description for tools without options.
 */
import { Menu } from "@base-ui/react/menu";
import { COLLISION_PASSABLE, COLLISION_SOLID, isEntityLayer, isGridLayer, isTileLayer, type Terrain } from "@smap/core";

import { activateTerrain, allTerrains } from "../../commands/terrainActions";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import { useStructureVersion } from "../hooks";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { TileSwatch } from "../primitives/TileSwatch";
import { terrainSwatchTile } from "../terrain/TerrainList";
import { BRUSH_PRESETS, MAX_BRUSH, MIN_BRUSH, stepBrushSize } from "./brushSize";
import { registerToolOptions, type ToolOptionsContext } from "./registry";
import { OptionLabel, Segmented, StepButton, triggerClass } from "./parts";

const isTerrainLayer = (c: ToolOptionsContext) => isGridLayer(c.layer) && c.layer.role === "terrain";
const isCollisionLayer = (c: ToolOptionsContext) => isGridLayer(c.layer) && c.layer.role === "collision";

// ---- Brush size / shape

function BrushSize() {
  const size = useEditorStore((s) => s.brushSize);
  const setSize = useEditorStore((s) => s.setBrushSize);
  return (
    <div className="flex items-center gap-1.5" data-tool-option="brush-size">
      <OptionLabel>{t("toolOptions.size")}</OptionLabel>
      <div className="flex h-7 items-center rounded-md border border-line bg-raised">
        <StepButton
          icon="minus"
          label={t("toolOptions.brushSmaller")}
          command="brush.smaller"
          disabled={size <= MIN_BRUSH}
          onClick={() => setSize(stepBrushSize(size, -1))}
        />
        <Menu.Root>
          <Menu.Trigger
            aria-label={t("toolOptions.size")}
            className="flex h-full min-w-[58px] items-center justify-center gap-1 border-x border-line px-1.5 font-mono text-sm text-text tabular outline-none hover:bg-hover data-popup-open:bg-hover"
          >
            {t("toolOptions.sizeValue", { size })}
            <Icon name="chevronDown" size={12} className="text-faint" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="center" sideOffset={4} className={menuPositionerClass}>
              <Menu.Popup className={`${menuPopupClass} min-w-[120px]`}>
                {BRUSH_PRESETS.map((preset) => (
                  <Menu.Item key={preset} className={`${menuItemClass} py-1 font-mono text-sm tabular`} onClick={() => setSize(preset)}>
                    <Icon name="check" size={13} className={preset === size ? "text-accent" : "invisible"} />
                    {t("toolOptions.sizeValue", { size: preset })}
                  </Menu.Item>
                ))}
                <Menu.Separator className={menuSeparatorClass} />
                <div className="px-2 pt-0.5 pb-1 text-2xs text-faint">{t("toolOptions.sizeKeys")}</div>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <StepButton
          icon="plus"
          label={t("toolOptions.brushLarger")}
          command="brush.larger"
          disabled={size >= MAX_BRUSH}
          onClick={() => setSize(stepBrushSize(size, 1))}
        />
      </div>
    </div>
  );
}

function BrushShape() {
  const shape = useEditorStore((s) => s.brushShape);
  const size = useEditorStore((s) => s.brushSize);
  const setShape = useEditorStore((s) => s.setBrushShape);
  return (
    <div className="flex items-center gap-1.5" data-tool-option="brush-shape">
      <OptionLabel>{t("toolOptions.shape")}</OptionLabel>
      <Segmented
        label={t("toolOptions.shape")}
        value={shape}
        dim={size === 1}
        onChange={setShape}
        options={[
          { value: "square", label: t("toolOptions.square"), glyph: <span className="size-2.5 rounded-[1px] border-[1.5px] border-current" /> },
          { value: "circle", label: t("toolOptions.circle"), glyph: <span className="size-2.5 rounded-full border-[1.5px] border-current" /> },
        ]}
      />
    </div>
  );
}

// ---- Terrain layer: which terrain the brush paints

function TerrainPicker() {
  const store = useEditorStore((s) => s.project?.store);
  const value = useEditorStore((s) => s.gridValue);
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
  const current = terrains.find((tr) => tr.id === value);
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
                      {terrain.id === value && <Icon name="check" size={13} className="text-accent" />}
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

// ---- Collision layer: force solid / force passable

const COLLISION: { value: number; label: MessageKey; hint: MessageKey; swatch: string }[] = [
  { value: COLLISION_SOLID, label: "collision.forceSolid", hint: "collision.forceSolidHint", swatch: "bg-collision-solid" },
  { value: COLLISION_PASSABLE, label: "collision.forcePass", hint: "collision.forcePassHint", swatch: "bg-collision-pass" },
];

function CollisionKind() {
  const value = useEditorStore((s) => s.gridValue);
  const tool = useEditorStore((s) => s.tool);
  const setValue = useEditorStore((s) => s.setGridValue);
  const setTool = useEditorStore((s) => s.setTool);
  if (tool === "eraser") return <Hint text={t("collision.eraserHint")} />;
  const current = COLLISION.find((c) => c.value === value);
  return (
    <div className="flex min-w-0 items-center gap-2" data-tool-option="collision">
      <OptionLabel>{t("toolOptions.collision")}</OptionLabel>
      <Segmented
        label={t("collision.brush")}
        value={current?.value ?? -1}
        onChange={(v) => {
          setValue(v);
          if (tool === "select" || tool === "eyedropper") setTool("brush");
        }}
        options={COLLISION.map((c) => ({
          value: c.value,
          label: t(c.label),
          text: t(c.label),
          glyph: <span aria-hidden className={`size-2.5 rounded-xs ${c.swatch}`} />,
        }))}
      />
      {current && <span className="hidden truncate text-xs text-faint xl:inline">{t(current.hint)}</span>}
    </div>
  );
}

// ---- Tools without options: one line on what the tool does

function Hint({ text }: { text: string }) {
  return <span className="min-w-0 truncate text-sm text-faint">{text}</span>;
}

const HINTS: Partial<Record<ToolId, MessageKey>> = {
  fill: "toolOptions.fillHint",
  rect: "toolOptions.rectHint",
  select: "toolOptions.selectHint",
  eyedropper: "toolOptions.eyedropperHint",
  entity: "toolOptions.entityHint",
};

function ToolHint() {
  const tool = useEditorStore((s) => s.tool);
  const key = HINTS[tool];
  return key ? <Hint text={t(key)} /> : null;
}

function EntityLayerHint() {
  return <Hint text={t("toolOptions.entityLayerHint")} />;
}

let registered = false;

/** Registers the built-in entries (idempotent). */
export function registerBuiltinToolOptions(): void {
  if (registered) return;
  registered = true;
  const notEntity = (c: ToolOptionsContext) => !isEntityLayer(c.layer);
  registerToolOptions(["brush", "eraser"], BrushSize, { id: "builtin.brushSize", order: 10, when: notEntity });
  registerToolOptions(["brush", "eraser"], BrushShape, { id: "builtin.brushShape", order: 20, when: notEntity });
  registerToolOptions(["brush", "rect", "fill"], TerrainPicker, { id: "builtin.terrain", order: 30, when: isTerrainLayer });
  registerToolOptions(["brush", "rect", "fill", "eraser"], CollisionKind, { id: "builtin.collision", order: 30, when: isCollisionLayer });
  registerToolOptions(["fill", "rect", "select", "eyedropper", "entity"], ToolHint, {
    id: "builtin.hint",
    order: 90,
    // On grid layers the terrain / collision picker says enough.
    when: (c) => (c.tool === "select" || c.tool === "eyedropper" || c.tool === "entity" ? true : isTileLayer(c.layer) || c.layer === undefined),
  });
  registerToolOptions(["brush", "eraser"], EntityLayerHint, { id: "builtin.entityLayer", order: 10, when: (c) => isEntityLayer(c.layer) });
}
