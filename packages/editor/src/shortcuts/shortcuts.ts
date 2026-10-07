/**
 * The single list of keyboard shortcuts. Every key binding in the app comes
 * from here. A settings file can override `keys` per command
 * (`platform/settings.ts` validates it; `setShortcutOverrides` applies it).
 *
 * Key syntax: modifiers joined with "+", then a `KeyboardEvent.code`-style key
 * name, e.g. "B", "Ctrl+G", "Ctrl+Shift+P", "Space". "Ctrl" means Ctrl on
 * Windows/Linux and Cmd on macOS.
 */

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
  | "stamp.saveSelection"
  | "layer.addEntity"
  | "entity.editTypes"
  | "view.toggleGrid"
  | "view.togglePanels"
  | "view.toggleMinimap"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.frameMap"
  | "view.pan"
  | "palette.open"
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.export"
  | "file.close"
  | "file.openBackup"
  | "tileset.add"
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
  { command: "edit.deselect", keys: ["Escape"] },
  /** Flip the selected tile / stamp (Tiled habit). */
  { command: "edit.flipX", keys: ["X"] },
  { command: "edit.flipY", keys: ["Y"] },
  { command: "view.toggleGrid", keys: ["Ctrl+G"] },
  { command: "view.togglePanels", keys: ["Tab"] },
  { command: "view.zoomIn", keys: ["Ctrl+Equal"] },
  { command: "view.zoomOut", keys: ["Ctrl+Minus"] },
  { command: "view.zoomReset", keys: ["Ctrl+Digit0"] },
  { command: "view.frameMap", keys: ["Shift+Digit1"] },
  /** Held while dragging to pan (handled by the canvas). */
  { command: "view.pan", keys: ["Space"] },
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
  { command: "layer.add", keys: ["Ctrl+Shift+N"] },
  { command: "layer.remove", keys: [] },
  { command: "map.resize", keys: [] },
  { command: "view.toggleCollision", keys: ["Ctrl+Shift+C"] },
  { command: "tool.entity", keys: ["O"] },
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

export function keysFor(command: CommandId): string[] {
  const keys = overrides.get(command);
  if (keys) return [...keys];
  return SHORTCUTS.find((s) => s.command === command)?.keys ?? [];
}
