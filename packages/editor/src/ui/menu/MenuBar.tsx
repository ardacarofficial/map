import { Menu } from "@base-ui/react/menu";
import { Menubar } from "@base-ui/react/menubar";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { openRecentProject } from "../../io/session";
import { forgetRecentProject, useRecentProjects } from "../../platform/recentProjects";
import { keysFor } from "../../shortcuts/shortcuts";
import { Icon } from "../primitives/Icon";
import { Kbd } from "../primitives/Kbd";
import { menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { MENUS, resolveMenu, type CommandLookup, type MenuDef } from "./menuModel";

/** Live registry + shortcut list (read each time a menu opens). */
const registryLookup: CommandLookup = {
  command(id) {
    const command = getCommand(id);
    if (!command) return undefined;
    const checked = command.checked?.();
    return checked === undefined ? { title: command.title, enabled: isEnabled(command) } : { title: command.title, enabled: isEnabled(command), checked };
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

/** Check mark slot of menus that have toggle items (keeps labels aligned). */
function CheckSlot({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="grid size-4 shrink-0 place-items-center text-accent">
      {on && <Icon name="check" size={13} />}
    </span>
  );
}

/** Rendered only while the menu is open, so titles / enabled / keys / checks are current. */
function MenuItems({ menu }: { menu: MenuDef }) {
  const entries = resolveMenu(menu, registryLookup);
  const checks = entries.some((e) => e.kind === "item" && e.checked !== undefined);
  return entries.map((entry, i) => {
    if (entry.kind === "separator") return <Menu.Separator key={`sep-${i}`} className={menuSeparatorClass} />;
    const label = (
      <>
        {checks && <CheckSlot on={entry.checked === true} />}
        <span className="min-w-0 flex-1 truncate">{t(entry.title)}</span>
        {entry.shortcut && <Kbd keys={entry.shortcut} className="ml-6 shrink-0" />}
      </>
    );
    const item =
      entry.checked !== undefined ? (
        <Menu.CheckboxItem
          key={entry.command}
          data-command={entry.command}
          disabled={!entry.enabled}
          checked={entry.checked}
          closeOnClick
          onCheckedChange={() => runCommand(entry.command)}
          className={`${menuItemClass} py-1 text-sm`}
        >
          {label}
        </Menu.CheckboxItem>
      ) : (
        <Menu.Item
          key={entry.command}
          data-command={entry.command}
          disabled={!entry.enabled}
          className={`${menuItemClass} py-1 text-sm`}
          onClick={() => runCommand(entry.command)}
        >
          {label}
        </Menu.Item>
      );
    if (menu.submenu?.after === entry.command) return [item, <RecentProjectsSubmenu key="submenu-recent" />];
    return item;
  });
}

/** Dosya → Son açılanlar ▸ (hidden where the host keeps no recent list). */
function RecentProjectsSubmenu() {
  const { supported, entries } = useRecentProjects();
  if (!supported) return null;
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger data-submenu="recentProjects" className={`${menuItemClass} py-1 text-sm data-popup-open:bg-hover`}>
        <span className="min-w-0 flex-1 truncate">{t("appBar.recentProjects")}</span>
        <Icon name="chevronRight" size={13} className="ml-6 shrink-0 text-faint" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner side="right" align="start" sideOffset={4} className={menuPositionerClass}>
          <Menu.Popup className={`${menuPopupClass} max-w-[360px] min-w-[220px]`}>
            {entries.length === 0 ? (
              <Menu.Item disabled className={`${menuItemClass} py-1 text-sm`}>
                {t("appBar.recentEmpty")}
              </Menu.Item>
            ) : (
              entries.map((entry) => (
                <Menu.Item
                  key={entry.key}
                  data-recent-project={entry.key}
                  title={entry.location}
                  className={`${menuItemClass} flex-col items-start gap-0 py-1 text-sm ${entry.exists ? "" : "opacity-60"}`}
                  onClick={() => void openRecentProject(entry)}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="max-w-full truncate">{entry.name}</span>
                      <span className="max-w-full truncate text-2xs text-faint">{entry.location}</span>
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={t("contextMenu.recentRemove")}
                      title={t("contextMenu.recentRemove")}
                      data-recent-forget=""
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void forgetRecentProject(entry);
                      }}
                      className="grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:bg-active hover:text-text"
                    >
                      <Icon name="x" size={12} />
                    </span>
                  </span>
                </Menu.Item>
              ))
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
