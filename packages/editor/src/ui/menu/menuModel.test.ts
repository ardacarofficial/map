import { describe, expect, it } from "vitest";

import { registerMapBorderCommand } from "../../commands/mapBorder";
import { registerTileReplacementCommand } from "../../commands/replaceTiles";
import { registerAppCommands } from "../../commands/appCommands";
import { registerExportCommands } from "../../commands/exportCommands";
import { getCommand, isEnabled } from "../../commands/registry";
import { installWorldActions } from "../../commands/worldActions";
import { registerSettingsCommands } from "../../platform/settingsCommands";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { t } from "../../i18n";
import { registerBrushCommands } from "../toolOptions/brushCommands";
import { registerHistoryCommands } from "../history/historyCommands";
import { registerRulerCommands } from "../layout/rulers";
import { registerProjectSettingsCommands } from "../projectSettings/ProjectSettingsDialog";
import { MENUS, menuCommands, resolveMenu, type CommandLookup, type ResolvedEntry, type MenuEntry } from "./menuModel";

/** Everything the app registers at startup (bootstrap.tsx, App, ToolOptionsBar, ToolBar, HistoryPanel). */
function registerAll(): void {
  registerAppCommands();
  registerTileReplacementCommand();
  registerMapBorderCommand();
  registerExportCommands();
  registerSettingsCommands();
  registerBrushCommands();
  registerHistoryCommands();
  registerRulerCommands();
  registerProjectSettingsCommands();
  installWorldActions();
}

const entryIds = (entries: readonly MenuEntry[]): CommandId[] => entries.flatMap(entry => typeof entry !== "string" ? entryIds(entry.entries) : entry === "-" ? [] : [entry]);
const flattenItems = (entries: ResolvedEntry[]): ResolvedEntry[] => entries.flatMap(entry => entry.kind === "submenu" ? flattenItems(entry.entries) : [entry]);

const live: CommandLookup = {
  command(id) {
    const c = getCommand(id);
    return c ? { title: c.title, enabled: isEnabled(c) } : undefined;
  },
  keys: keysFor,
};

describe("menu bar model", () => {
  it("has the six menus in order, with translated labels", () => {
    expect(MENUS.map((m) => m.id)).toEqual(["file", "edit", "view", "layer", "map", "help"]);
    for (const menu of MENUS) {
      expect(t(menu.label)).not.toBe(menu.label);
    }
  });

  it("lists each command at most once per menu, and each command in one menu only", () => {
    const all = menuCommands();
    expect(new Set(all).size).toBe(all.length);
    for (const menu of MENUS) {
      const ids = menu.entries.filter((e) => e !== "-");
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every menu item maps to a command the app registers", () => {
    registerAll();
    for (const id of menuCommands()) expect(getCommand(id), id).toBeDefined();
    // Resolving against the real registry drops nothing.
    for (const menu of MENUS) {
      const items = flattenItems(resolveMenu(menu, live)).filter((e) => e.kind === "item");
      expect(items.map(item => item.kind === "item" ? item.command : "-")).toEqual(entryIds(menu.entries));
    }
  });

  it("groups View controls into shallow, non-empty submenus and keeps language in settings", () => {
    const lookup: CommandLookup = { command: () => ({ title: "commands.view.toggleGrid", enabled: true }), keys: () => [] };
    const entries = resolveMenu(MENUS.find(menu => menu.id === "view")!, lookup);
    const groups = entries.filter(entry => entry.kind === "submenu");
    expect(groups.map(group => group.id)).toEqual(["zoom", "overlays", "panels", "docks", "layout"]);
    expect(entries.filter(entry => entry.kind !== "separator")).toHaveLength(6);
    for (const group of groups) expect(group.entries.some(entry => entry.kind === "item")).toBe(true);
    expect(menuCommands()).not.toContain("settings.language");
    // Missing optional registrations remove empty groups and their separators.
    expect(resolveMenu(MENUS.find(menu => menu.id === "view")!, { ...lookup, command: id => id === "view.world" ? lookup.command(id) : undefined }))
      .toEqual([expect.objectContaining({ kind: "item", command: "view.world" })]);
  });

  it("shows each command's first shortcut (settings overrides included) and its enabled state", () => {
    const keys: Partial<Record<CommandId, string[]>> = { "edit.undo": ["Ctrl+Z"], "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"] };
    const lookup: CommandLookup = {
      command: (id) => ({ title: "commands.edit.undo", enabled: id !== "edit.redo" }),
      keys: (id) => keys[id] ?? [],
    };
    const edit = resolveMenu(MENUS.find((m) => m.id === "edit")!, lookup);
    const undo = edit.find((e) => e.kind === "item" && e.command === "edit.undo");
    const redo = edit.find((e) => e.kind === "item" && e.command === "edit.redo");
    const cut = edit.find((e) => e.kind === "item" && e.command === "edit.cut");
    expect(undo).toMatchObject({ shortcut: "Ctrl+Z", enabled: true });
    expect(redo).toMatchObject({ shortcut: "Ctrl+Y", enabled: false });
    expect(cut).toMatchObject({ shortcut: null });
    // Real list: the menu shows exactly what SHORTCUTS says.
    const real = resolveMenu(MENUS.find((m) => m.id === "file")!, { ...live, command: () => ({ title: "commands.file.save", enabled: true }) });
    const save = real.find((e) => e.kind === "item" && e.command === "file.save");
    expect(save).toMatchObject({ shortcut: keysFor("file.save")[0] });
  });

  it("leaves out unregistered commands without leading, trailing or double separators", () => {
    const only = new Set<CommandId>(["edit.cut", "stamp.saveSelection"]);
    const lookup: CommandLookup = {
      command: (id) => (only.has(id) ? { title: "commands.edit.cut", enabled: true } : undefined),
      keys: () => [],
    };
    const entries = resolveMenu(MENUS.find((m) => m.id === "edit")!, lookup);
    expect(entries.map((e) => (e.kind === "item" ? e.command : "-"))).toEqual(["edit.cut", "-", "stamp.saveSelection"]);
  });
});
