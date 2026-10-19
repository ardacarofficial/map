import { chordsOverlap, matchesChord, parseChord, type KeyEventLike } from "../commands/keymap";
import type { ShortcutDef } from "./shortcuts";

/** Scoped bindings shadow global ones; only bindings in the same scope conflict. */
export function shortcutChordsConflict(scope: ShortcutDef["scope"], key: string, otherScope: ShortcutDef["scope"], otherKey: string, recorded?: KeyEventLike): boolean {
  return scope === otherScope && (chordsOverlap(key, otherKey) || !!recorded && matchesChord(recorded, parseChord(otherKey)));
}
