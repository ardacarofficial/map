/**
 * The single list of keyboard shortcuts. Every key binding in the app comes
 * from here. A settings file can override `keys` per command
 * (`platform/settings.ts` validates it; `setShortcutOverrides` applies it).
 *
 * Key syntax: modifiers joined with "+", then a `KeyboardEvent.code`-style key
 * name, e.g. "B", "Ctrl+G", "Ctrl+Shift+P", "Space", "Plus". "Ctrl" means Ctrl on
 * Windows/Linux and Cmd on macOS. Character keys match the typed character
 * first (layout-aware, see `commands/keymap.ts`).
 */
import { preferReachable } from "../commands/keymap";

export type CommandId =
  | "tool.brush"
  | "tool.eraser"
  | "tool.fill"
  | "tool.rect"
  | "tool.select"
  | "tool.eyedropper"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.delete"
  | "edit.selectAll"
  | "edit.deselect"
  | "edit.flipX"
  | "edit.flipY"
  | "layer.add"
  | "layer.addCollision"
  | "layer.remove"
  | "map.resize"
  | "view.toggleCollision"
  | "tool.entity"
  | "brush.smaller"
  | "brush.larger"
  | "tool.hand"
  | "view.toggleLibrary"
  | "view.toggleInspector"
  | "view.resetLayout"
  | "view.toggleLevels"
  | "view.toggleProperties"
  | "view.toggleLayers"
  | "view.toggleRecent"
  | "view.toggleRulers"
  | "layer.duplicate"
  | "layer.mergeDown"
  | "layer.rename"
  | "layer.moveUp"
  | "layer.moveDown"
  | "edit.invertSelection"
  | "level.next"
  | "level.previous"
  | "tileset.goto"
  | "tileset.remove"
  | "project.rename"
  | "edit.rotateCW"
  | "edit.rotateCCW"
  | "map.settings"
  | "project.settings"
  | "view.history"
  | "stamp.saveSelection"
  | "layer.addEntity"
  | "entity.editTypes"
  | "view.toggleGrid"
  | "view.focusNextRegion"
  | "view.focusPrevRegion"
  | "view.togglePanels"
  | "view.toggleMinimap"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.frameMap"
  | "view.pan"
  | "view.world"
  | "palette.open"
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.export"
  | "file.close"
  | "file.openBackup"
  | "tileset.add"
  | "tileset.settings"
  | "tileset.replaceImage"
  | "tileset.markSolid"
  | "tileset.defineTerrain"
  | "level.new"
  | "level.duplicate"
  | "level.remove"
  | "settings.language"
  | "settings.editShortcuts";

export interface ShortcutDef {
  command: CommandId;
  keys: string[];
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { command: "tool.brush", keys: ["B"] },
  { command: "tool.eraser", keys: ["E"] },
  { command: "tool.fill", keys: ["F"] },
  { command: "tool.rect", keys: ["R"] },
  { command: "tool.select", keys: ["S"] },
  { command: "tool.eyedropper", keys: ["I"] },
  { command: "edit.undo", keys: ["Ctrl+Z"] },
  { command: "edit.redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"] },
  { command: "edit.cut", keys: ["Ctrl+X"] },
  { command: "edit.copy", keys: ["Ctrl+C"] },
  { command: "edit.paste", keys: ["Ctrl+V"] },
  { command: "edit.delete", keys: ["Delete", "Backspace"] },
  { command: "edit.selectAll", keys: ["Ctrl+A"] },
  { command: "edit.deselect", keys: ["Escape", "Ctrl+D"] },
  /** Flip the selected tile / stamp (Tiled habit). */
  { command: "edit.flipX", keys: ["X"] },
  { command: "edit.flipY", keys: ["Y"] },
  { command: "view.toggleGrid", keys: ["Ctrl+G"] },
  { command: "view.togglePanels", keys: ["Tab"] },
  { command: "view.focusNextRegion", keys: ["F6"] },
  { command: "view.focusPrevRegion", keys: ["Shift+F6"] },
  /** By character: Ctrl+"+" (Shift+= on US, Shift+4 or numpad on Turkish-Q); Ctrl+= also works. */
  { command: "view.zoomIn", keys: ["Ctrl+Plus", "Ctrl+Equal"] },
  { command: "view.zoomOut", keys: ["Ctrl+Minus"] },
  { command: "view.zoomReset", keys: ["Ctrl+Digit0"] },
  { command: "view.frameMap", keys: ["Shift+Digit1"] },
  /** Held while dragging to pan (handled by the canvas). */
  { command: "view.pan", keys: ["Space"] },
  /** v1.2: level view ↔ world map (Esc also returns). */
  { command: "view.world", keys: ["W"] },
  { command: "palette.open", keys: ["Ctrl+K", "Ctrl+Shift+P"] },
  { command: "file.new", keys: ["Ctrl+N"] },
  { command: "file.open", keys: ["Ctrl+O"] },
  { command: "file.save", keys: ["Ctrl+S"] },
  { command: "file.saveAs", keys: ["Ctrl+Shift+S"] },
  { command: "file.export", keys: ["Ctrl+E"] },
  /** Commands without a default key (reachable from the command palette). */
  { command: "file.close", keys: [] },
  { command: "file.openBackup", keys: [] },
  { command: "tileset.add", keys: [] },
  { command: "tileset.settings", keys: [] },
  { command: "tileset.replaceImage", keys: [] },
  { command: "layer.add", keys: ["Ctrl+Shift+N"] },
  { command: "layer.remove", keys: [] },
  { command: "map.resize", keys: [] },
  { command: "view.toggleCollision", keys: ["Ctrl+Shift+C"] },
  { command: "tool.entity", keys: ["O"] },
  /** "," / "." too: "[" "]" need AltGr on Turkish-Q. */
  { command: "brush.smaller", keys: ["BracketLeft", "Comma"] },
  { command: "brush.larger", keys: ["BracketRight", "Period"] },
  { command: "tool.hand", keys: ["H"] },
  { command: "view.toggleLibrary", keys: ["Ctrl+B"] },
  { command: "view.toggleInspector", keys: ["Ctrl+Alt+B"] },
  { command: "view.resetLayout", keys: [] },
  { command: "view.toggleLevels", keys: [] },
  { command: "view.toggleProperties", keys: [] },
  { command: "view.toggleLayers", keys: [] },
  { command: "view.toggleRecent", keys: [] },
  { command: "view.toggleRulers", keys: [] },
  { command: "layer.duplicate", keys: ["Ctrl+J"] },
  { command: "layer.mergeDown", keys: [] },
  { command: "layer.rename", keys: ["F2"] },
  { command: "layer.moveUp", keys: ["Ctrl+BracketRight"] },
  { command: "layer.moveDown", keys: ["Ctrl+BracketLeft"] },
  { command: "edit.invertSelection", keys: ["Ctrl+Shift+I"] },
  { command: "level.next", keys: ["Ctrl+Tab"] },
  { command: "level.previous", keys: ["Ctrl+Shift+Tab"] },
  { command: "tileset.goto", keys: [] },
  { command: "tileset.remove", keys: [] },
  { command: "project.rename", keys: [] },
  /** Rotate the brush tile / stamp / selection 90° (opt-in; X/Y flip stays the default). */
  { command: "edit.rotateCW", keys: ["Z"] },
  { command: "edit.rotateCCW", keys: ["Shift+Z"] },
  { command: "map.settings", keys: [] },
  { command: "project.settings", keys: [] },
  { command: "view.history", keys: [] },
  { command: "stamp.saveSelection", keys: [] },
  { command: "layer.addEntity", keys: [] },
  { command: "entity.editTypes", keys: [] },
  { command: "layer.addCollision", keys: [] },
  { command: "tileset.markSolid", keys: [] },
  { command: "tileset.defineTerrain", keys: [] },
  { command: "settings.language", keys: [] },
  { command: "settings.editShortcuts", keys: [] },
];

/** Per-command keys from the settings file (replace the defaults of that command). */
let overrides: ReadonlyMap<CommandId, readonly string[]> = new Map();
let overridesRevision = 0;

/** Replaces the user's key overrides (already validated). */
export function setShortcutOverrides(next: ReadonlyMap<CommandId, readonly string[]>): void {
  overrides = next;
  overridesRevision++;
}

/** Bumped by every `setShortcutOverrides` (lets parsed-binding caches refresh). */
export function shortcutsRevision(): number {
  return overridesRevision;
}

/** `SHORTCUTS` with the user's overrides applied. */
export function effectiveShortcuts(): ShortcutDef[] {
  return SHORTCUTS.map((s) => {
    const keys = overrides.get(s.command);
    return keys ? { command: s.command, keys: [...keys] } : s;
  });
}

/** A command's keys, the ones reachable on the user's keyboard layout first (display uses `[0]`). */
export function keysFor(command: CommandId): string[] {
  const keys = overrides.get(command) ?? SHORTCUTS.find((s) => s.command === command)?.keys ?? [];
  return preferReachable(keys);
}
