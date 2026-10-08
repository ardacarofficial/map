import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { keysFor } from "../../shortcuts/shortcuts";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { MENUS, resolveMenu, type CommandLookup, type MenuDef } from "./menuModel";

/** Live registry + shortcut list (read each time a menu opens). */
const registryLookup: CommandLookup = {
  command(id) {
    const command = getCommand(id);
    return command ? { title: command.title, enabled: isEnabled(command) } : undefined;
  },
  keys: keysFor,
};

/**
 * Dosya · Düzen · Görünüm · Katman · Harita · Yardım. Built from `MENUS`
 * (ids only) + the command registry: each item runs the same command as its
 * shortcut and palette entry, shows that shortcut, and is disabled when the
 * command is. Hovering across triggers moves between open menus.
 */
export function MenuBar() {
  return (
    <Menubar modal={false} className="flex h-full items-center gap-0.5" aria-label={t("menu.bar")}>
      {MENUS.map((menu) => (
        <MenuBarMenu key={menu.id} menu={menu} />
      ))}
    </Menubar>
  );
}

function MenuBarMenu({ menu }: { menu: MenuDef }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        data-menu={menu.id}
        className="flex h-7 items-center rounded-md px-2 text-md text-muted outline-none transition-colors duration-100 hover:bg-hover hover:text-text focus-visible:bg-hover data-popup-open:bg-active data-popup-open:text-text"
      >
        {t(menu.label)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} min-w-[240px]`}>
            <MenuItems menu={menu} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Rendered only while the menu is open, so titles / enabled / keys are current. */
function MenuItems({ menu }: { menu: MenuDef }) {
  const entries = resolveMenu(menu, registryLookup);
  return entries.map((entry, i) =>
    entry.kind === "separator" ? (
      <Menu.Separator key={`sep-${i}`} className={menuSeparatorClass} />
    ) : (
      <Menu.Item
        key={entry.command}
        data-command={entry.command}
        disabled={!entry.enabled}
        className={`${menuItemClass} justify-between py-1 text-sm`}
        onClick={() => runCommand(entry.command)}
      >
        <span className="truncate">{t(entry.title)}</span>
        {entry.shortcut && <Kbd keys={entry.shortcut} className="ml-6 shrink-0" />}
      </Menu.Item>
    ),
  );
}
