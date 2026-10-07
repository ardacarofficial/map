/**
 * Parsing, matching and formatting of the key strings in `shortcuts.ts`.
 * Pure functions (no DOM access beyond the event shape) so they are testable.
 */

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** `KeyboardEvent.code`, e.g. "KeyB", "Digit0", "Equal", "Tab". */
  code: string;
}

/** Minimal event shape used for matching (a `KeyboardEvent` fits). */
export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** "B" → "KeyB", "0" → "Digit0", other names are already codes. */
function toCode(key: string): string {
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

/** Parses "Ctrl+Shift+P" into a chord. Modifier order does not matter. */
export function parseChord(keys: string): KeyChord {
  const parts = keys.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    ctrl: mods.has("ctrl") || mods.has("cmd") || mods.has("meta"),
    shift: mods.has("shift"),
    alt: mods.has("alt"),
    code: toCode(key),
  };
}

/** True when `event` is exactly `chord` ("Ctrl" accepts Ctrl or Cmd/Meta). */
export function matchesChord(event: KeyEventLike, chord: KeyChord): boolean {
  return (
    event.code === chord.code &&
    (event.ctrlKey || event.metaKey) === chord.ctrl &&
    event.shiftKey === chord.shift &&
    event.altKey === chord.alt
  );
}

const KEY_LABELS: Record<string, string> = {
  Equal: "+",
  Minus: "−",
  Space: "Space",
  Tab: "Tab",
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "⌫",
  Delete: "Del",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Comma: ",",
  Period: ".",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
};

function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return KEY_LABELS[code] ?? code;
}

/**
 * Display parts of a key string, e.g. "Ctrl+Shift+P" → ["Ctrl", "Shift", "P"]
 * (on macOS → ["⌘", "⇧", "P"]).
 */
export function chordLabels(keys: string, mac = false): string[] {
  const chord = parseChord(keys);
  const labels: string[] = [];
  if (chord.ctrl) labels.push(mac ? "⌘" : "Ctrl");
  if (chord.alt) labels.push(mac ? "⌥" : "Alt");
  if (chord.shift) labels.push(mac ? "⇧" : "Shift");
  labels.push(keyLabel(chord.code));
  return labels;
}

/** "Ctrl+K" → "Ctrl K" (space separated, as shown in tooltips and the palette). */
export function formatChord(keys: string, mac = false): string {
  return chordLabels(keys, mac).join(" ");
}

/** True when running on macOS (Cmd is shown instead of Ctrl). */
export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}
