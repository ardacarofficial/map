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

/** Command groups use the same accessible submenus as camera bookmarks. */
export interface MenuGroup {
  readonly id: string;
  readonly label: MessageKey;
  readonly entries: readonly MenuEntry[];
}
export type MenuEntry = CommandId | "-" | MenuGroup;

export interface MenuDef {
  id: "file" | "edit" | "view" | "layer" | "map" | "help";
  label: MessageKey;
  entries: readonly MenuEntry[];
  /** A submenu that is not a command (e.g. "Son açılanlar ▸"), shown right after `after`. */
  submenu?: { readonly id: "recentProjects"; readonly after: CommandId };
}

export const MENUS: readonly MenuDef[] = [
  {
    id: "file",
    label: "menu.file",
    entries: ["file.new", "file.open", "-", "file.save", "file.saveAs", "file.openBackup", "-", "project.rename", "project.settings", "tileset.add", "file.export", "-", "file.close"],
    submenu: { id: "recentProjects", after: "file.open" },
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
      "edit.invertSelection",
      "-",
      "edit.flipX",
      "edit.flipY",
      "brush.smaller",
      "brush.larger",
      "-",
      "stamp.saveSelection",
      "edit.replaceTiles",
    ],
  },
  {
    id: "view",
    label: "menu.view",
    entries: [
      { id: "zoom", label: "menu.zoom", entries: ["view.zoomIn", "view.zoomOut", "view.zoomReset", "view.frameMap"] },
      { id: "overlays", label: "menu.overlays", entries: ["view.toggleGrid", "view.toggleCollision", "view.toggleRulers", "view.toggleMinimap"] },
      "-",
      { id: "panels", label: "menu.panels", entries: [
        "view.toggleLibrary", "view.toggleLevels", "view.toggleInspector", "view.history", "view.toggleLayers", "view.toggleRecent",
        "-", "panel.tileset.show", "panel.stamps.show", "panel.project.show", "panel.entities.show",
        "panel.inspector.show", "panel.history.show", "panel.layers.show", "panel.recent.show", "panel.color.show", "panel.aiActivity.show",
      ] },
      { id: "docks", label: "menu.docks", entries: [
        "view.toggleBottom", "dock.left.show", "dock.right.show", "dock.bottom.show",
        "-", "dock.left.hide", "dock.right.hide", "dock.bottom.hide",
      ] },
      { id: "layout", label: "menu.layout", entries: ["view.togglePanels", "view.resetLayout"] },
      "-", "view.world",
    ],
  },
  {
    id: "layer",
    label: "menu.layer",
    entries: [
      "layer.add",
      "layer.addCollision",
      "layer.addEntity",
      "-",
      "layer.rename",
      "layer.duplicate",
      "layer.mergeDown",
      "-",
      "layer.moveUp",
      "layer.moveDown",
      "-",
      "layer.remove",
      "-",
      "entity.editTypes",
    ],
  },
  {
    id: "map",
    label: "menu.map",
    entries: ["map.settings", "map.border", "-", "level.new", "level.duplicate", "level.next", "level.previous", "level.remove"],
  },
  {
    id: "help",
    label: "menu.help",
    entries: ["palette.open", "settings.editShortcuts"],
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
  /** On / off of a toggle command (shown as a check mark); undefined for plain commands. */
  checked?: boolean;
}

export type ResolvedEntry = ResolvedItem | { kind: "separator" } | { kind: "submenu"; id: string; label: MessageKey; entries: ResolvedEntry[] };

export interface CommandLookup {
  /** Title and enabled state of a registered command; undefined when it is not registered. */
  command(id: CommandId): { title: MessageKey; enabled: boolean; checked?: boolean } | undefined;
  keys(id: CommandId): readonly string[];
}

/**
 * The entries of one menu, ready to render. Commands that are not
 * registered are left out (a menu never shows an item that cannot run), and
 * separators never lead, trail or double up.
 */
export function resolveMenu(menu: Pick<MenuDef, "entries">, lookup: CommandLookup): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  let pendingSeparator = false;
  for (const entry of menu.entries) {
    if (entry === "-") {
      pendingSeparator = out.length > 0;
      continue;
    }
    if (typeof entry !== "string") {
      const entries = resolveMenu(entry, lookup);
      if (!entries.length) continue;
      if (pendingSeparator) out.push({ kind: "separator" });
      pendingSeparator = false;
      out.push({ kind: "submenu", id: entry.id, label: entry.label, entries });
      continue;
    }
    const command = lookup.command(entry);
    if (!command) continue;
    if (pendingSeparator) out.push({ kind: "separator" });
    pendingSeparator = false;
    const item: ResolvedItem = { kind: "item", command: entry, title: command.title, enabled: command.enabled, shortcut: lookup.keys(entry)[0] ?? null };
    if (command.checked !== undefined) item.checked = command.checked;
    out.push(item);
  }
  return out;
}

/** Every command id the menus reference (for tests and docs). */
export function menuCommands(): CommandId[] {
  const commands = (entries: readonly MenuEntry[]): CommandId[] => entries.flatMap(entry =>
    typeof entry !== "string" ? commands(entry.entries) : entry === "-" ? [] : [entry]);
  return MENUS.flatMap(menu => commands(menu.entries));
}
