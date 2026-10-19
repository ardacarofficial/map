import { eventModifiers, parseChord, type KeyEventLike } from "../../commands/keymap";
import { shortcutChordsConflict } from "../../shortcuts/conflicts";
import { SHORTCUTS, type CommandId } from "../../shortcuts/shortcuts";
import { isValidKeyString, mergeShortcuts } from "../settings";

export type Overrides = ReadonlyMap<CommandId, readonly string[]>;
export function conflictsFor(draft: Overrides, command: CommandId, keys: readonly string[], recorded?: KeyEventLike): CommandId[] {
  const scope = SHORTCUTS.find(row => row.command === command)?.scope;
  return mergeShortcuts(SHORTCUTS, draft).filter(row => row.command !== command && row.keys.some(key => keys.some(candidate => shortcutChordsConflict(scope, candidate, row.scope, key, recorded)))).map(row => row.command);
}
export function assignKeys(draft: Overrides, command: CommandId, keys: string[], replace = false, recorded?: KeyEventLike): Map<CommandId, string[]> {
  const next = new Map([...draft].map(([id, keys]) => [id, [...keys]]));
  const conflicts = conflictsFor(draft, command, keys, recorded);
  if (conflicts.length && !replace) return next;
  const scope = SHORTCUTS.find(row => row.command === command)?.scope;
  for (const row of mergeShortcuts(SHORTCUTS, draft)) if (conflicts.includes(row.command)) next.set(row.command, row.keys.filter(key => !keys.some(candidate => shortcutChordsConflict(scope, candidate, row.scope, key, recorded))));
  next.set(command, keys);
  return next;
}
export function resetCommand(draft: Overrides, command: CommandId): Map<CommandId, string[]> {
  const next = assignKeys(draft, command, SHORTCUTS.find(row => row.command === command)?.keys ?? [], true);
  next.delete(command);
  return next;
}
export function compactOverrides(draft: Overrides): Record<string, string[]> {
  return Object.fromEntries(SHORTCUTS.filter(row => row.command !== "view.pan" && draft.has(row.command) && JSON.stringify(row.keys) !== JSON.stringify(draft.get(row.command))).map(row => [row.command, [...draft.get(row.command)!]]));
}
const symbols: Record<string, string> = { " ": "Space", "+": "Plus", "=": "Equal", "-": "Minus", ",": "Comma", ".": "Period", "/": "Slash", "\\": "Backslash", ";": "Semicolon", "'": "Quote", "`": "Backquote", "[": "BracketLeft", "]": "BracketRight" };
export function recordedChord(event: KeyEventLike & { repeat?: boolean; isComposing?: boolean }): string | null {
  if (event.repeat || event.isComposing || /^(Control|Shift|Alt|AltGraph|Meta|Dead|Process|Unidentified)$/.test(event.key ?? "")) return null;
  const mods = eventModifiers(event);
  const typed = event.key ?? "";
  const key = /^[a-z0-9]$/i.test(typed) ? typed.toUpperCase() : symbols[typed] ?? (event.getModifierState?.("AltGraph") && /^[!-~]$/.test(typed) ? typed : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : event.code);
  const chord = [mods.ctrl && "Ctrl", mods.alt && "Alt", mods.shift && "Shift", key].filter(Boolean).join("+");
  return isValidKeyString(chord) ? chord : null;
}
/** Never offer bindings the operating system intercepts or held canvas pan owns. */
export function reservedChord(key: string): boolean {
  const chord = parseChord(key);
  return chord.code === "Space" || (chord.alt && ["F4", "Tab"].includes(chord.code)) || (chord.ctrl && chord.alt && chord.code === "Delete");
}
