/**
 * The single list of keyboard shortcuts. Every key binding in the app comes
 * from here (v0.5 will let a settings file override `keys`).
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
  | "view.toggleGrid"
  | "view.togglePanels"
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
  | "tileset.defineTerrain";

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
  { command: "layer.addCollision", keys: [] },
  { command: "tileset.markSolid", keys: [] },
  { command: "tileset.defineTerrain", keys: [] },
];

export function keysFor(command: CommandId): string[] {
  return SHORTCUTS.find((s) => s.command === command)?.keys ?? [];
}
