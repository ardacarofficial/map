/**
 * What can be done to a whole tileset: "Ayarlar… · Görseli değiştir… ·
 * Gruba taşı ▸ · Kaldır". The same items serve the "⋯" menu, the right
 * click on the switcher and on a tileset header in "Tümü" (Base UI menu
 * items work in both menu kinds).
 */
import { Menu } from "@base-ui/react/menu";
import type { Tileset } from "@smap/core";

import {
  moveTilesetToNewGroup,
  openTilesetSettings,
  removeTileset,
  replaceTilesetImage,
  setTilesetGroup,
  tilesetGroups,
} from "../../commands/tilesetActions";
import { t } from "../../i18n";
import { Icon } from "../primitives/Icon";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";

export function TilesetMenuItems({ tileset }: { tileset: Tileset }) {
  const groups = tilesetGroups();
  const current = tileset.group ?? null;
  return (
    <>
      <Menu.Item className={menuItemClass} disabled={!!tileset.edited} data-tileset-menu-item="settings" onClick={() => void openTilesetSettings(tileset.id)}>
        <Icon name="grid" size={16} className="text-muted" />
        {t("tilesetPanel.settings")}
      </Menu.Item>
      <Menu.Item className={menuItemClass} disabled={!!tileset.edited} data-tileset-menu-item="image" onClick={() => void replaceTilesetImage(tileset.id)}>
        <Icon name="image" size={16} className="text-muted" />
        {t("tilesetPanel.replaceImage")}
      </Menu.Item>
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger className={`${menuItemClass} data-popup-open:bg-hover`} data-tileset-menu-item="group">
          <Icon name="folder" size={16} className="text-muted" />
          <span className="flex-1">{t("tilesetLib.moveToGroup")}</span>
          <Icon name="chevronRight" size={12} className="text-faint" />
        </Menu.SubmenuTrigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={-4} className={menuPositionerClass}>
            <Menu.Popup className={`${menuPopupClass} max-h-[min(360px,var(--available-height))] overflow-y-auto`}>
              <Menu.Item className={menuItemClass} data-group-option="" onClick={() => setTilesetGroup(tileset.id, null)}>
                <span className="flex-1">{t("tilesetLib.ungrouped")}</span>
                {current === null && <Icon name="tick" size={12} className="text-accent" />}
              </Menu.Item>
              {groups.map((g) => (
                <Menu.Item key={g} className={menuItemClass} data-group-option={g} onClick={() => setTilesetGroup(tileset.id, g)}>
                  <span className="min-w-0 flex-1 truncate">{g}</span>
                  {current === g && <Icon name="tick" size={12} className="text-accent" />}
                </Menu.Item>
              ))}
              <div role="separator" className={menuSeparatorClass} />
              <Menu.Item className={menuItemClass} data-group-option="\u0000new" onClick={() => void moveTilesetToNewGroup(tileset.id)}>
                <Icon name="plus" size={16} className="text-muted" />
                {t("tilesetLib.newGroupOption")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.SubmenuRoot>
      <div role="separator" className={menuSeparatorClass} />
      <Menu.Item className={`${menuItemClass} text-danger!`} data-tileset-menu-item="remove" onClick={() => void removeTileset(tileset.id)}>
        <Icon name="trash" size={16} />
        {t("tilesetLib.remove")}
      </Menu.Item>
    </>
  );
}
