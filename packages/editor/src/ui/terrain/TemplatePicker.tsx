import { Menu } from "@base-ui/react/menu";
import { isTerrainTemplate, terrainTemplateInfo, type TerrainTemplate, type TerrainTemplateInfo } from "@smap/core";
import { useState } from "react";

import { t } from "../../i18n";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { TemplateDiagram } from "./TemplateDiagram";
import { templatePickerGroups } from "./templateGlyph";

/** "Blob 47 · Godot 3×3 minimal (12×4)" → "Blob 47 · Godot 3×3 minimal". */
export function templateShortName(info: TerrainTemplateInfo): string {
  return info.name.replace(/\s*\([^)]*\)\s*$/, "");
}

function TemplateItem({ info }: { info: TerrainTemplateInfo }) {
  return (
    <Menu.RadioItem value={info.id} closeOnClick className={`${menuItemClass} group items-start py-2`}>
      <span className="grid size-4 shrink-0 place-items-center pt-0.5 text-accent">
        <Menu.RadioItemIndicator>
          <Icon name="check" size={14} />
        </Menu.RadioItemIndicator>
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-baseline gap-2">
          <span className="truncate">{templateShortName(info)}</span>
          <span className="shrink-0 font-mono text-2xs text-faint tabular">
            {info.columns}×{info.rows} · {t("terrain.slots", { count: info.slots })}
          </span>
        </span>
        <TemplateDiagram template={info.id} unit={3} gap={3} />
      </span>
    </Menu.RadioItem>
  );
}

/** Template choice for "Arazi tanımla": everyday templates first, legacy under "Diğer". */
export function TemplatePicker({ value, onChange }: { value: TerrainTemplate; onChange(template: TerrainTemplate): void }) {
  const { main, other } = templatePickerGroups();
  const current = terrainTemplateInfo(value);
  const [showOther, setShowOther] = useState(current.legacy);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("terrain.template")}
        title={`${t("terrain.template")}: ${templateShortName(current)}`}
        className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-raised py-0.5 pr-1.5 pl-2 text-sm text-text transition-colors hover:border-line-strong data-popup-open:border-accent"
      >
        {/* Long names ("Blob 47 · Godot 3×3 minimal") wrap to a second line instead of being cut. */}
        <span className="line-clamp-2 min-w-0 flex-1 text-left leading-tight break-words">{templateShortName(current)}</span>
        <span className="shrink-0 font-mono text-2xs text-faint tabular">
          {current.columns}×{current.rows}
        </span>
        <Icon name="chevronDown" size={14} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-[min(560px,var(--available-height))] overflow-y-auto`}>
            <Menu.RadioGroup
              value={value}
              onValueChange={(next: unknown) => {
                if (isTerrainTemplate(next)) onChange(next);
              }}
            >
              {main.map((info) => (
                <TemplateItem key={info.id} info={info} />
              ))}
              {other.length > 0 && (
                <>
                  <div className={menuSeparatorClass} />
                  <Menu.Item
                    closeOnClick={false}
                    onClick={() => setShowOther((v) => !v)}
                    className={`${menuItemClass} text-sm text-muted`}
                  >
                    <Icon
                      name="chevronRight"
                      size={14}
                      className={`shrink-0 transition-transform duration-100 ${showOther ? "rotate-90" : ""}`}
                    />
                    {t("terrain.other")}
                    <span className="ml-auto text-2xs text-faint">{t("terrain.legacyHint")}</span>
                  </Menu.Item>
                  {showOther && other.map((info) => <TemplateItem key={info.id} info={info} />)}
                </>
              )}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
