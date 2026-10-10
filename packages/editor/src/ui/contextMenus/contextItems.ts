/**
 * Items of the app's right-click menus. Pure: a menu is described as a list
 * of items, resolved against the command registry when it opens (so the
 * label, shortcut, enabled state and action of a command item are the same
 * as in the menu bar and the palette).
 */
import type { CommandId } from "../../shortcuts/shortcuts";
import type { IconName } from "../primitives/Icon";

export interface ContextItemDef {
  readonly type: "item";
  /** Stable key (React key, `data-context-item` for tests). */
  readonly id: string;
  /** Visible label; a command item without one uses the command's title. */
  readonly label?: string;
  readonly icon?: IconName;
  /**
   * Command whose shortcut is shown. Without `run` the item runs the
   * command, and is disabled when the command is.
   */
  readonly command?: CommandId;
  /** Action of the item (overrides running `command`). */
  readonly run?: () => void;
  /** Forces the enabled state (otherwise: the command's, or enabled). */
  readonly disabled?: boolean;
  /** Destructive action (red). */
  readonly danger?: boolean;
  /** Shows a check mark (on) or an empty check slot (off). */
  readonly checked?: boolean;
  /** Opens a submenu with these entries instead of running something. */
  readonly submenu?: readonly ContextEntry[];
}

export type ContextEntry = ContextItemDef | { readonly type: "separator" };

export const SEPARATOR: ContextEntry = { type: "separator" };

/** What a resolved item shows and does. */
export interface ResolvedContextItem {
  readonly type: "item";
  readonly id: string;
  readonly label: string;
  readonly icon: IconName | undefined;
  readonly shortcut: string | null;
  readonly enabled: boolean;
  readonly danger: boolean;
  readonly checked: boolean | undefined;
  readonly run: () => void;
  /** Resolved submenu entries (the item opens them). */
  readonly submenu?: ResolvedContextEntry[];
}

export type ResolvedContextEntry = ResolvedContextItem | { readonly type: "separator" };

/** The registry as the resolver sees it (a fake in tests). */
export interface ContextLookup {
  /** Localized title and enabled state of a registered command; undefined when not registered. */
  command(id: CommandId): { title: string; enabled: boolean } | undefined;
  /** First shortcut of a command, or null. */
  shortcut(id: CommandId): string | null;
  /** Runs a command. */
  run(id: CommandId): void;
}

/**
 * Items ready to render: command items get their title / shortcut /
 * enabled state; items whose command is not registered and that have no
 * own action are dropped; separators never lead, trail or double up.
 */
export function resolveContextItems(entries: readonly ContextEntry[], lookup: ContextLookup): ResolvedContextEntry[] {
  const out: ResolvedContextEntry[] = [];
  let pendingSeparator = false;
  for (const entry of entries) {
    if (entry.type === "separator") {
      pendingSeparator = out.length > 0;
      continue;
    }
    const command = entry.command ? lookup.command(entry.command) : undefined;
    const submenu = entry.submenu ? resolveContextItems(entry.submenu, lookup) : undefined;
    if (submenu) {
      if (submenu.length === 0) continue;
      if (pendingSeparator) out.push({ type: "separator" });
      pendingSeparator = false;
      out.push({
        type: "item",
        id: entry.id,
        label: entry.label ?? entry.id,
        icon: entry.icon,
        shortcut: null,
        enabled: entry.disabled !== true,
        danger: false,
        checked: entry.checked,
        run: () => undefined,
        submenu,
      });
      continue;
    }
    if (!entry.run && !command) continue;
    const label = entry.label ?? command?.title ?? entry.id;
    const enabled = entry.disabled !== undefined ? !entry.disabled : entry.run ? true : (command?.enabled ?? false);
    const id = entry.command;
    const run = entry.run ?? (() => lookup.run(id!));
    if (pendingSeparator) out.push({ type: "separator" });
    pendingSeparator = false;
    out.push({
      type: "item",
      id: entry.id,
      label,
      icon: entry.icon,
      shortcut: entry.command ? lookup.shortcut(entry.command) : null,
      enabled,
      danger: entry.danger ?? false,
      checked: entry.checked,
      run,
    });
  }
  return out;
}
