import { describe, expect, it } from "vitest";
import { parseChord } from "../../commands/keymap";
import { getCommand } from "../../commands/registry";
import { keysFor, SHORTCUTS } from "../../shortcuts/shortcuts";
import { registerAppCommands } from "../../commands/appCommands";
import { PANEL_IDS, ZONE_IDS } from "./dockModel";

describe("dock commands and shortcuts", () => {
  it("keeps all three zone keys distinct from every existing command", () => {
    expect(keysFor("view.toggleLibrary")).toEqual(["Ctrl+B"]);
    expect(keysFor("view.toggleInspector")).toEqual(["Ctrl+Alt+B"]);
    expect(keysFor("view.toggleBottom")).toEqual(["Ctrl+Shift+B"]);
    const owners = new Map<string, string>();
    for (const def of SHORTCUTS) for (const key of def.keys) {
      const chord = JSON.stringify(parseChord(key));
      expect(owners.get(chord) ?? def.command, key).toBe(def.command);
      owners.set(chord, def.command);
    }
  });
  it("registers every move, reorder, split, merge, show and hide action in production registration", () => {
    registerAppCommands();
    expect(getCommand("view.toggleBottom")).toBeDefined();
    for (const zone of ZONE_IDS) for (const action of ["show", "hide"] as const) expect(getCommand(`dock.${zone}.${action}`)).toBeDefined();
    for (const panel of PANEL_IDS) for (const action of [...ZONE_IDS, "show", "hide", "forward", "backward", "split", "merge"] as const) expect(getCommand(`panel.${panel}.${action}`)).toBeDefined();
  });
});
