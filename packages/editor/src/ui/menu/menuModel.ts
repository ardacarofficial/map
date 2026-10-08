/**
 * The menu bar's structure (CLAUDE.md → Arayüz: "kullanıcı menü aramaz", the
 * research digest: a classic menu bar generated from the command registry).
 *
 * Menus only list command ids; titles, enabled state and shortcuts come from
 * the registry and `SHORTCUTS` when a menu opens, so a menu item and its
 * palette entry / key binding are always the same action.
 */
import type { MessageKey } from "../../i18n";
import type { CommandId } from "../../shortcuts/shortcuts";

/** A command, or a divider between groups. */
export type MenuEntry = CommandId | "-";

export interface MenuDef {
  id: "file" | "edit" | "view" | "layer" | "map" | "help";
  label: MessageKey;
  entries: readonly MenuEntry[];
}

export const MENUS: readonly MenuDef[] = [
  {
    id: "file",
    label: "menu.file",
    entries: ["file.new", "file.open", "-", "file.save", "file.saveAs", "file.openBackup", "-", "tileset.add", "file.export", "-", "file.close"],
  },
  {
    id: "edit",
    label: "menu.edit",
    entries: [
      "edit.undo",
      "edit.redo",
      "-",
      "edit.cut",
      "edit.copy",
      "edit.paste",
      "edit.delete",
      "-",
      "edit.selectAll",
      "edit.deselect",
      "-",
      "edit.flipX",
      "edit.flipY",
      "brush.smaller",
      "brush.larger",
      "-",
      "stamp.saveSelection",
    ],
  },
  {
    id: "view",
    label: "menu.view",
    entries: [
      "view.zoomIn",
      "view.zoomOut",
      "view.zoomReset",
      "view.frameMap",
      "-",
      "view.toggleGrid",
      "view.toggleCollision",
      "view.toggleMinimap",
      "view.togglePanels",
      "-",
      "view.world",
    ],
  },
  {
    id: "layer",
    label: "menu.layer",
    entries: ["layer.add", "layer.addCollision", "layer.addEntity", "-", "layer.remove", "-", "entity.editTypes"],
  },
  {
    id: "map",
    label: "menu.map",
    entries: ["map.resize", "-", "tileset.markSolid", "tileset.defineTerrain", "-", "level.new", "level.duplicate", "level.remove"],
  },
  {
    id: "help",
    label: "menu.help",
    entries: ["palette.open", "settings.editShortcuts", "settings.language"],
  },
];

/** What a menu item shows, resolved from the registry when the menu opens. */
export interface ResolvedItem {
  kind: "item";
  command: CommandId;
  title: MessageKey;
  enabled: boolean;
  /** First key of the command (settings overrides applied), or null. */
  shortcut: string | null;
}

export type ResolvedEntry = ResolvedItem | { kind: "separator" };

export interface CommandLookup {
  /** Title and enabled state of a registered command; undefined when it is not registered. */
  command(id: CommandId): { title: MessageKey; enabled: boolean } | undefined;
  keys(id: CommandId): readonly string[];
}

/**
 * The entries of one menu, ready to render. Commands that are not
 * registered are left out (a menu never shows an item that cannot run), and
 * separators never lead, trail or double up.
 */
export function resolveMenu(menu: MenuDef, lookup: CommandLookup): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  let pendingSeparator = false;
  for (const entry of menu.entries) {
    if (entry === "-") {
      pendingSeparator = out.length > 0;
      continue;
    }
    const command = lookup.command(entry);
    if (!command) continue;
    if (pendingSeparator) out.push({ kind: "separator" });
    pendingSeparator = false;
    out.push({ kind: "item", command: entry, title: command.title, enabled: command.enabled, shortcut: lookup.keys(entry)[0] ?? null });
  }
  return out;
}

/** Every command id the menus reference (for tests and docs). */
export function menuCommands(): CommandId[] {
  return MENUS.flatMap((m) => m.entries.filter((e): e is CommandId => e !== "-"));
}
