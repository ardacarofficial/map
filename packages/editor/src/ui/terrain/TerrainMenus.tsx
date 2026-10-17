/**
 * Dropdowns of the terrain UI: the terrain picker ("Arazi: ● Çimen ▾",
 * every terrain of the project grouped by set) and a small generic select
 * for the ARAZİ card. Base UI menus, tokens only.
 */
import { Menu } from "@base-ui/react/menu";
import type { MapDocument } from "@smap/core";
import type { ReactNode } from "react";

import { chooseTerrain } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { Icon } from "../primitives/Icon";
import { menuGroupLabelClass, menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { TerrainDot, TerrainSwatch } from "./TerrainList";
import { resolveTerrain, sameTerrain, terrainSetEntries, type TerrainRef } from "./terrainModel";

export const selectTriggerClass =
  "flex h-control-sm min-w-0 flex-1 items-center gap-2 rounded-sm border border-line bg-field px-2 text-sm text-text outline-none transition-colors hover:border-line-strong data-popup-open:border-line-strong focus-visible:border-accent";

/** Every terrain of the project; picking one chooses it for the brush. */
export function TerrainPickerMenu({
  doc,
  value,
  triggerClass,
  label,
  placeholder,
  dataAttr,
}: {
  doc: MapDocument;
  value: TerrainRef | null;
  triggerClass: string;
  label: string;
  placeholder: string;
  dataAttr?: string;
}) {
  const entries = terrainSetEntries(doc);
  const current = resolveTerrain(doc, value);
  const several = new Set(entries.map((e) => e.tileset.id)).size > 1;
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={triggerClass} {...(dataAttr ? { [dataAttr]: current?.terrain.name ?? "" } : {})}>
        {current ? <TerrainDot color={current.terrain.color} /> : <span className="size-2 shrink-0 rounded-full bg-line" />}
        <span className="min-w-0 flex-1 truncate text-left">{current?.terrain.name ?? placeholder}</span>
        <Icon name="chevronDown" size={12} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-90 min-w-50 overflow-y-auto`} data-terrain-menu="">
            {entries.map(({ tileset, set }, gi) => (
              <Menu.Group key={`${tileset.id}/${set.id}`}>
                {gi > 0 && <Menu.Separator className={menuSeparatorClass} />}
                <Menu.GroupLabel className={menuGroupLabelClass}>
                  {set.name}
                  {several ? ` · ${tileset.name}` : ""}
                </Menu.GroupLabel>
                {set.terrains.map((terrain) => {
                  const ref = { tilesetId: tileset.id, setId: set.id, terrainId: terrain.id };
                  return (
                    <Menu.Item key={terrain.id} className={menuItemClass} data-terrain-option={terrain.name} onClick={() => chooseTerrain(ref)}>
                      <TerrainSwatch tileset={tileset} set={set} terrainId={terrain.id} size={16} />
                      <span className="min-w-0 flex-1 truncate">{terrain.name}</span>
                      <TerrainDot color={terrain.color} />
                      {sameTerrain(ref, value) && <Icon name="tick" size={12} className="text-accent" />}
                    </Menu.Item>
                  );
                })}
              </Menu.Group>
            ))}
            {entries.length === 0 && <div className="px-2 py-1.5 text-sm text-faint">{t("terrain.none")}</div>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A labelled option of {@link MenuSelect}. */
export interface SelectOption<V> {
  readonly value: V;
  readonly label: string;
  readonly leading?: ReactNode;
  readonly detail?: string;
}

/** Small select (Base UI menu) for card rows. */
export function MenuSelect<V extends string | number>({
  value,
  options,
  onChange,
  label,
  dataAttr,
}: {
  value: V;
  options: readonly SelectOption<V>[];
  onChange(value: V): void;
  label: string;
  dataAttr?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={selectTriggerClass} {...(dataAttr ? { [dataAttr]: String(current?.value ?? "") } : {})}>
        {current?.leading}
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? ""}</span>
        <Icon name="chevronDown" size={12} className="shrink-0 text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-80 min-w-50 overflow-y-auto`}>
            {options.map((o) => (
              <Menu.Item key={String(o.value)} className={menuItemClass} data-select-option={String(o.value)} onClick={() => onChange(o.value)}>
                {o.leading}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.detail && <span className="shrink-0 font-mono text-2xs text-faint tabular">{o.detail}</span>}
                {o.value === value && <Icon name="tick" size={12} className="text-accent" />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
