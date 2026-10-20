import { Menu } from "../primitives/Overlays";

import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { addToNewPalette, addToPalette } from "./paletteActions";
import type { PaletteItem } from "./paletteModel";

/** "Palete ekle ▸" submenu (tile context menu): every palette, then "Yeni palet…". Works in menus and context menus. */
export function AddToPaletteMenu({ items }: { items: readonly PaletteItem[] }) {
  const palettes = useEditorStore.getState().project?.store.document.collections ?? [];
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={`${menuItemClass} data-popup-open:bg-hover`} disabled={items.length === 0} data-tile-menu-item="palette">
        <Icon name="grid" size={16} className="text-muted" />
        <span className="flex-1">{items.length > 1 ? t("palettes.addMany", { count: items.length }) : t("palettes.addOne")}</span>
        <Icon name="chevronRight" size={12} className="text-faint" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner side="right" align="start" className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-h-[min(360px,var(--available-height))] overflow-y-auto`}>
            {palettes.map((p) => (
              <Menu.Item key={p.id} className={menuItemClass} data-palette-option={p.id} onClick={() => addToPalette(p.id, items)}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="font-mono text-2xs text-faint tabular">{p.cells.length}</span>
              </Menu.Item>
            ))}
            {palettes.length > 0 && <div role="separator" className={menuSeparatorClass} />}
            <Menu.Item className={menuItemClass} data-palette-option="\u0000new" onClick={() => void addToNewPalette(items)}>
              <Icon name="plus" size={16} className="text-muted" />
              {t("palettes.newOption")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
