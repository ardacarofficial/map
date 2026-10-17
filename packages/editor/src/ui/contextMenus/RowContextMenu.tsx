import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { useMemo, type ReactElement, type ReactNode } from "react";

import { getCommand, isEnabled, runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { keysFor } from "../../shortcuts/shortcuts";
import { Icon } from "../primitives/Icon";
import { KbdText } from "../primitives/Kbd";
import { menuDangerItemClass, menuShortcutClass, menuItemClass, menuPopupClass, menuPositionerClass, menuSeparatorClass } from "../primitives/menuStyles";
import { resolveContextItems, type ContextEntry, type ContextLookup, type ResolvedContextEntry } from "./contextItems";

/** The live command registry for context menus. */
export const registryContextLookup: ContextLookup = {
  command(id) {
    const command = getCommand(id);
    return command ? { title: t(command.title), enabled: isEnabled(command) } : undefined;
  },
  shortcut: (id) => keysFor(id)[0] ?? null,
  run: (id) => void runCommand(id),
};

/** One item row; `Item` is `ContextMenu.Item` or `Menu.Item` (same props). */
function Items({ entries, Item }: { entries: ResolvedContextEntry[]; Item: typeof Menu.Item }) {
  const anyCheck = entries.some((e) => e.type === "item" && e.checked !== undefined);
  return entries.map((entry, i) =>
    entry.type === "separator" ? (
      <div key={`sep-${i}`} role="separator" className={menuSeparatorClass} />
    ) : entry.submenu ? (
      <Menu.SubmenuRoot key={entry.id}>
        <Menu.SubmenuTrigger data-context-item={entry.id} disabled={!entry.enabled} className={menuItemClass}>
          {anyCheck ? (
            <span aria-hidden className="size-4 shrink-0" />
          ) : (
            entry.icon && <Icon name={entry.icon} size={16} className="shrink-0 text-muted" />
          )}
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          <Icon name="chevronRight" size={12} className="ml-4 shrink-0 text-faint" />
        </Menu.SubmenuTrigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={-2} className={menuPositionerClass}>
            <Menu.Popup className={`${menuPopupClass} max-h-80 overflow-y-auto`} data-context-submenu={entry.id}>
              <Items entries={entry.submenu} Item={Item} />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.SubmenuRoot>
    ) : (
      <Item
        key={entry.id}
        data-context-item={entry.id}
        disabled={!entry.enabled}
        onClick={entry.run}
        className={`${menuItemClass} ${entry.danger ? `${menuDangerItemClass} data-highlighted:bg-danger-soft!` : ""}`}
      >
        {anyCheck ? (
          <span aria-hidden className="grid size-4 shrink-0 place-items-center text-muted">
            {entry.checked && <Icon name="tick" size={12} />}
          </span>
        ) : (
          entry.icon && <Icon name={entry.icon} size={16} className="shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.shortcut && <KbdText keys={entry.shortcut} className={menuShortcutClass} />}
      </Item>
    ),
  );
}

/** Resolved only while the popup is open, so enabled states and labels are current. */
function OpenItems({ items, Item }: { items: () => readonly ContextEntry[]; Item: typeof Menu.Item }) {
  const entries = resolveContextItems(items(), registryContextLookup);
  return <Items entries={entries} Item={Item} />;
}

/**
 * Right-click menu of a list row / card (Base UI ContextMenu). `render` is
 * the row element (it becomes the trigger and keeps its own handlers);
 * `items` is read when the menu opens. `onOpen` runs first (e.g. make the
 * row's layer active so registry commands act on it).
 */
export function RowContextMenu({
  items,
  onOpen,
  render,
  disabled = false,
  children,
}: {
  items: () => readonly ContextEntry[];
  onOpen?: () => void;
  render: ReactElement;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <ContextMenu.Root
      disabled={disabled}
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <ContextMenu.Trigger render={render}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className={menuPositionerClass}>
          <ContextMenu.Popup className={menuPopupClass} data-context-menu="">
            <OpenItems items={items} Item={ContextMenu.Item} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Where a {@link PointMenu} opens (viewport CSS px). */
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A menu opened at a point by code (canvas right-click, empty list area):
 * no trigger element, `at` = null closes it. Items are read when it opens.
 */
export function PointMenu({ at, items, onClose }: { at: MenuPoint | null; items: () => readonly ContextEntry[]; onClose(): void }) {
  const anchor = useMemo(
    () =>
      at && {
        getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }),
      },
    [at],
  );
  return (
    <Menu.Root
      open={at !== null}
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} className={menuPositionerClass}>
          <Menu.Popup className={menuPopupClass} data-context-menu="">
            {at && <OpenItems items={items} Item={Menu.Item} />}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
