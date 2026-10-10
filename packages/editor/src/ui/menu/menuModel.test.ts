import { describe, expect, it } from "vitest";

import { registerAppCommands } from "../../commands/appCommands";
import { registerExportCommands } from "../../commands/exportCommands";
import { getCommand, isEnabled } from "../../commands/registry";
import { installWorldActions } from "../../commands/worldActions";
import { registerSettingsCommands } from "../../platform/settingsCommands";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { tr } from "../../i18n/tr";
import { registerBrushCommands } from "../toolOptions/brushCommands";
import { registerHistoryCommands } from "../history/historyCommands";
import { MENUS, menuCommands, resolveMenu, type CommandLookup } from "./menuModel";

/** Everything the app registers at startup (bootstrap.tsx, App, ToolOptionsBar, HistoryPanel). */
function registerAll(): void {
  registerAppCommands();
  registerExportCommands();
  registerSettingsCommands();
  registerBrushCommands();
  registerHistoryCommands();
  installWorldActions();
}

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
      const [section, key] = menu.label.split(".") as [keyof typeof tr, string];
      expect((tr[section] as Record<string, string>)[key]).toBeTruthy();
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
      const items = resolveMenu(menu, live).filter((e) => e.kind === "item");
      expect(items.length).toBe(menu.entries.filter((e) => e !== "-").length);
    }
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
