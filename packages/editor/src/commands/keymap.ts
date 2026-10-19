/**
 * Parsing, matching and formatting of the key strings in `shortcuts.ts`.
 * Pure functions (no DOM access beyond the event shape) so they are testable.
 *
 * Matching is layout-aware: a binding whose key is a character ("B", "[",
 * "Minus" = "-", "Plus" = "+") matches the character the key types
 * (`event.key`), so Ctrl+"+" zooms in on a Turkish-Q keyboard as on a US one.
 * The physical key (`event.code`) is the fallback: for named keys (F2, Tab,
 * arrows), digits (Shift+1 types "!"), and keys that type a non-ASCII
 * character (ğ ü ş ı ö ç, Cyrillic...), so Ctrl+Z still works on those layouts.
 */

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** `KeyboardEvent.code`-style name, e.g. "KeyB", "Digit0", "Equal", "Tab"; also "Plus" (the "+" character). */
  code: string;
}

/** Minimal event shape used for matching (a `KeyboardEvent` fits). */
export interface KeyEventLike {
  code: string;
  /** The typed character / key name. Missing → matched by `code` only. */
  key?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  getModifierState?(key: string): boolean;
}

/** "B" → "KeyB", "0" → "Digit0", "+" → "Plus", other names are already codes. */
function toCode(key: string): string {
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CHAR_CODES[key] ?? key;
}

/** Parses "Ctrl+Shift+P" into a chord. Modifier order does not matter. "Ctrl+Plus" is Ctrl and "+". */
export function parseChord(keys: string): KeyChord {
  const parts = keys.split("+");
  // "Ctrl++" → the key is "+".
  let key = parts.pop() ?? "";
  if (key === "" && parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
    key = "Plus";
  }
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    ctrl: mods.has("ctrl") || mods.has("cmd") || mods.has("meta"),
    shift: mods.has("shift"),
    alt: mods.has("alt"),
    code: toCode(key),
  };
}

const CODE_CHARS: Readonly<Record<string, string>> = {
  Equal: "=",
  Minus: "-",
  Plus: "+",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
};

const CHAR_CODES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(CODE_CHARS).map(([code, character]) => [character, code]));

/** Numpad keys type the same thing with NumLock on or off. */
const NUMPAD_CHARS: Readonly<Record<string, string>> = {
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadMultiply: "*",
  NumpadDivide: "/",
};

/** The character a chord's key stands for ("KeyB" → "b", "BracketLeft" → "["), or null for named keys (F2, Tab...). */
export function chordChar(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return CODE_CHARS[code] ?? (/^[!-~]$/.test(code) ? code : null);
}

/** The (lower-case) character an event typed, or null for named keys ("Enter", "F2", "Dead"). */
export function eventChar(event: KeyEventLike): string | null {
  const numpad = NUMPAD_CHARS[event.code];
  if (numpad) return numpad;
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(6);
  const key = event.key;
  if (key === undefined || [...key].length !== 1 || key === " ") return null;
  return key.toLowerCase();
}

function isAsciiPrintable(ch: string): boolean {
  return /^[\x21-\x7e]$/.test(ch);
}

/**
 * Modifiers as the user meant them. AltGr (Windows reports it as Ctrl+Alt)
 * only selects a character ("[" on Turkish-Q is AltGr+8): it is not Ctrl.
 */
export function eventModifiers(event: KeyEventLike): { ctrl: boolean; shift: boolean; alt: boolean } {
  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  return {
    ctrl: altGraph ? event.metaKey : event.ctrlKey || event.metaKey,
    alt: altGraph ? false : event.altKey,
    shift: event.shiftKey,
  };
}

/** The typed character is the chord's character, with the chord's modifiers. */
export function matchesByKey(event: KeyEventLike, chord: KeyChord): boolean {
  const ch = chordChar(chord.code);
  if (ch === null || eventChar(event) !== ch) return false;
  const mods = eventModifiers(event);
  if (mods.ctrl !== chord.ctrl || mods.alt !== chord.alt) return false;
  // Letters and digits: Shift is part of the chord. Symbols: the character
  // already says what was pressed ("+" is Shift+= on US, Shift+4 on TR).
  if (/^[a-z0-9]$/.test(ch)) return mods.shift === chord.shift;
  return chord.shift ? mods.shift : true;
}

function normalizedCode(code: string): string {
  if (/^Numpad[0-9]$/.test(code)) return `Digit${code.slice(6)}`;
  if (code === "NumpadAdd") return "Plus";
  if (code === "NumpadSubtract") return "Minus";
  return code;
}

/** The physical key is the chord's key, with exactly the chord's modifiers. */
export function matchesByCode(event: KeyEventLike, chord: KeyChord): boolean {
  const mods = eventModifiers(event);
  if (mods.ctrl !== chord.ctrl || mods.shift !== chord.shift || mods.alt !== chord.alt) return false;
  return event.code === chord.code || normalizedCode(event.code) === normalizedCode(chord.code);
}

/** May `chord` match `event` by its physical key (see the file comment)? */
function codeFallbackAllowed(event: KeyEventLike, chord: KeyChord): boolean {
  const ch = chordChar(chord.code);
  if (ch === null || /^[0-9]$/.test(ch)) return true;
  const typed = eventChar(event);
  if (typed === null || !isAsciiPrintable(typed)) return true;
  // "Shift+Minus" types "_" on US: the chord names the physical key.
  return chord.shift && !/^[a-z]$/.test(ch);
}

/** True when `event` is `chord` ("Ctrl" accepts Ctrl or Cmd/Meta). */
export function matchesChord(event: KeyEventLike, chord: KeyChord): boolean {
  return matchesByKey(event, chord) || (codeFallbackAllowed(event, chord) && matchesByCode(event, chord));
}

/**
 * The binding for `event`: a character match anywhere in the list wins over
 * a physical-key match (Turkish "-" sits on the US "=" key: it must zoom out).
 */
export function findBinding<T extends { chord: KeyChord }>(event: KeyEventLike, bindings: readonly T[]): T | undefined {
  return (
    bindings.find((b) => matchesByKey(event, b.chord)) ??
    bindings.find((b) => codeFallbackAllowed(event, b.chord) && matchesByCode(event, b.chord))
  );
}

// ------------------------------------------------------------------ keyboard layout

/** `code` → unshifted character of the user's layout (`navigator.keyboard.getLayoutMap()`), when the browser tells. */
let layout: ReadonlyMap<string, string> | null = null;
let layoutChars: ReadonlySet<string> | null = null;

/** Sets the current layout map (tests, `installKeyboardLayout`). `null` = unknown. */
export function setKeyboardLayout(map: ReadonlyMap<string, string> | null): void {
  layout = map;
  layoutChars = map ? new Set([...map.values()].map((c) => c.toLowerCase())) : null;
}

interface KeyboardApi {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>;
  addEventListener?(type: "layoutchange", cb: () => void): void;
}

/** Reads the keyboard layout where the browser offers it (Chromium / WebView2); labels follow it. */
export async function installKeyboardLayout(): Promise<void> {
  const keyboard = (typeof navigator !== "undefined" ? (navigator as { keyboard?: KeyboardApi }).keyboard : undefined) ?? undefined;
  if (!keyboard?.getLayoutMap) return;
  const load = async () => {
    try {
      setKeyboardLayout(new Map(await keyboard.getLayoutMap()));
    } catch {
      setKeyboardLayout(null);
    }
  };
  keyboard.addEventListener?.("layoutchange", () => void load());
  await load();
}

/** The layout's own (non-ASCII) character on the chord's key, e.g. "ğ" on Turkish for "BracketLeft". */
function layoutFallbackChar(code: string): string | null {
  const ch = layout?.get(code);
  return ch && [...ch].length === 1 && !isAsciiPrintable(ch) ? ch : null;
}

/** Can the user press this key string on the current layout without AltGr? (Unknown layout → yes.) */
export function isReachable(keys: string): boolean {
  if (!layoutChars) return true;
  const code = parseChord(keys).code;
  const ch = chordChar(code);
  // Named keys, digits and "+" (numpad) are on every keyboard.
  if (ch === null || /^[0-9]$/.test(ch) || ch === "+") return true;
  return layoutChars.has(ch) || layoutFallbackChar(code) !== null;
}

/** Key strings ordered for display: the ones reachable on this layout first (stable). */
export function preferReachable(keys: readonly string[]): string[] {
  return [...keys.filter(isReachable), ...keys.filter((k) => !isReachable(k))];
}

// ------------------------------------------------------------------ labels

const KEY_LABELS: Record<string, string> = {
  Equal: "=",
  Plus: "+",
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
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num −",
};

function keyLabel(code: string): string {
  if (code.startsWith("Intl")) return layoutFallbackChar(code) ?? code;
  const ch = chordChar(code);
  // "[" needs AltGr on Turkish-Q; the same physical key (ğ) works, so show that.
  if (ch !== null && layoutChars && !layoutChars.has(ch) && !/^[0-9]$/.test(ch)) {
    const own = layoutFallbackChar(code);
    if (own) return own.toLocaleUpperCase();
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
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

/** Stable conflict identity, including aliases matched by the same physical key. */
export function chordIdentity(keys: string): string {
  const chord = parseChord(keys);
  return JSON.stringify({ ...chord, code: normalizedCode(chord.code) });
}

/** Symbol characters can match with either Shift state; physical/letter bindings cannot. */
export function chordsOverlap(a: string, b: string): boolean {
  const left = parseChord(a), right = parseChord(b);
  if (left.ctrl !== right.ctrl || left.alt !== right.alt || normalizedCode(left.code) !== normalizedCode(right.code)) return false;
  const flexibleShift = (chord: KeyChord) => !chord.shift && chordChar(chord.code) !== null && !/^[a-z0-9]$/.test(chordChar(chord.code)!);
  return left.shift === right.shift || flexibleShift(left) || flexibleShift(right);
}
