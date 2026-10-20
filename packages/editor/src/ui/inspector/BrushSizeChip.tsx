import { activeSmartStamp, useSmartStampSession } from "../stamps/smartStampSession";
import { Menu } from "../primitives/Overlays";

import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Tooltip } from "../primitives/Tooltip";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass } from "../primitives/menuStyles";
import { BRUSH_PRESETS, MAX_BRUSH, MIN_BRUSH, stepBrushSize } from "../toolOptions/brushSize";
import { Segmented, StepButton } from "../toolOptions/parts";

/** Size controls show only past this size; at 1 the chip stays collapsed ("Boyut 1 ▾"). */
export function showsSizeControls(size: number): boolean {
  return size > 1;
}

/**
 * Brush size, collapsed by default: a small "Boyut 1 ▾" chip (menu of
 * common sizes). Only when the size is above 1 do the − / + steps appear
 * (and, with `withShape`, the square / circle choice). Used by the FIRÇA
 * card and the tool options bar.
 */
export function BrushSizeChip({ withShape = true, showLabel = true }: { withShape?: boolean; showLabel?: boolean }) {
  const size = useEditorStore((s) => s.brushSize);
  const setSize = useEditorStore((s) => s.setBrushSize);
  // A clip on the brush is placed as it is: the size only applies to the eraser then.
  const usage = useSmartStampSession(s => s.usage);
  const unused = useEditorStore((s) => s.tool === "brush" && s.stamp !== null) && !(activeSmartStamp() && usage === "road");
  const expanded = showsSizeControls(size);
  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 transition-opacity ${unused ? "opacity-45" : ""}`}
      data-tool-option="brush-size"
      data-size-expanded={expanded || undefined}
    >
      <div className="flex h-control-sm items-center rounded-sm border border-line bg-field hover:border-line-strong">
        {expanded && (
          <StepButton icon="minus" label={t("toolOptions.brushSmaller")} command="brush.smaller" disabled={size <= MIN_BRUSH} onClick={() => setSize(stepBrushSize(size, -1))} />
        )}
        <Menu.Root>
          <Tooltip label={unused ? t("toolOptions.sizeUnusedStamp") : t("toolOptions.sizeKeys")}>
          <Menu.Trigger
            aria-label={t("toolOptions.size")}
            data-size-chip
            className={`flex h-full items-center gap-1 px-2 text-sm text-text outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-accent hover:bg-hover data-popup-open:bg-hover ${
              expanded ? "border-x border-line" : "rounded-sm"
            }`}
          >
            {showLabel && <span className="text-muted">{t("toolOptions.size")}</span>}
            <span className="tabular">{size}</span>
            <Icon name="chevronDown" size={12} className="text-faint" />
          </Menu.Trigger>
          </Tooltip>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="start" className={menuPositionerClass}>
              <Menu.Popup className={`${menuPopupClass} min-w-48`}>
                {BRUSH_PRESETS.map((preset) => (
                  <Menu.Item key={preset} className={`${menuItemClass} tabular`} onClick={() => setSize(preset)}>
                    <span className="grid size-4 place-items-center"><Icon name="tick" size={12} className={preset === size ? "" : "invisible"} /></span>
                    {t("toolOptions.sizeValue", { size: preset })}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {expanded && (
          <StepButton icon="plus" label={t("toolOptions.brushLarger")} command="brush.larger" disabled={size >= MAX_BRUSH} onClick={() => setSize(stepBrushSize(size, 1))} />
        )}
      </div>
      {expanded && withShape && <BrushShapeChoice />}
    </div>
  );
}

/** Square / circle (meaningful only above size 1). */
export function BrushShapeChoice() {
  const shape = useEditorStore((s) => s.brushShape);
  const setShape = useEditorStore((s) => s.setBrushShape);
  return (
    <Segmented
      label={t("toolOptions.shape")}
      value={shape}
      onChange={setShape}
      options={[
        { value: "square", label: t("toolOptions.square"), glyph: <Icon name="square" size={12} /> },
        { value: "circle", label: t("toolOptions.circle"), glyph: <span className="size-3 rounded-full border border-current" /> },
      ]}
    />
  );
}
