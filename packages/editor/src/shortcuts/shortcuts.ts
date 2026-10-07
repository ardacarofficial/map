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
  | "view.toggleGrid"
  | "view.togglePanels"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.pan"
  | "palette.open"
  | "file.new"
  | "file.open"
  | "file.save";

export interface ShortcutDef {
  command: CommandId;
  keys: string[];
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { command: "tool.brush", keys: ["B"] },
  { command: "tool.eraser", keys: ["E"] },
  { command: "view.toggleGrid", keys: ["Ctrl+G"] },
  { command: "view.togglePanels", keys: ["Tab"] },
  { command: "view.zoomIn", keys: ["Ctrl+Equal"] },
  { command: "view.zoomOut", keys: ["Ctrl+Minus"] },
  { command: "view.zoomReset", keys: ["Ctrl+Digit0"] },
  /** Held while dragging to pan (handled by the canvas). */
  { command: "view.pan", keys: ["Space"] },
  { command: "palette.open", keys: ["Ctrl+K", "Ctrl+Shift+P"] },
  { command: "file.new", keys: ["Ctrl+N"] },
  { command: "file.open", keys: ["Ctrl+O"] },
  { command: "file.save", keys: ["Ctrl+S"] },
];

export function keysFor(command: CommandId): string[] {
  return SHORTCUTS.find((s) => s.command === command)?.keys ?? [];
}
