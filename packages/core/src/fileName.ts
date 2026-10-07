/**
 * File names that work on every desktop file system, Windows included
 * (the target platform, CLAUDE.md → Teknoloji: Tauri on Windows).
 *
 * Windows rejects or silently redirects:
 * - the characters `< > : " / \ | ? *` and control characters (U+0000–U+001F);
 * - names ending in a dot or a space (they are stripped, so `"a."` and `"a"` collide);
 * - the device names `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`
 *   (also with superscript digits ¹²³) and `CONIN$` / `CONOUT$`, in any case
 *   and **with any extension** (`con.tmj` opens the console, not a file).
 */

// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
// eslint-disable-next-line no-control-regex
const INVALID_CHAR = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * True when `name` (one path segment, extension included) is a Windows
 * device name: the part before the first dot, trailing spaces ignored, is
 * `CON`, `PRN`, `AUX`, `NUL`, `COM0–9`, `LPT0–9`, `CONIN$` or `CONOUT$` (any case).
 */
export function isReservedFileName(name: string): boolean {
  const dot = name.indexOf(".");
  const stem = (dot >= 0 ? name.slice(0, dot) : name).replace(/ +$/, "");
  return RESERVED_STEM.test(stem);
}

/**
 * Why `name` cannot be a file or folder name on Windows, or `null`:
 * empty, a forbidden or control character, a trailing dot or space, or a
 * reserved device name (see {@link isReservedFileName}).
 */
export function fileNameProblem(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) return "must be a non-empty string";
  if (INVALID_CHAR.test(name)) return `must not contain < > : " / \\ | ? * or control characters, got ${JSON.stringify(name)}`;
  if (/[. ]$/.test(name)) return `must not end with a dot or a space, got ${JSON.stringify(name)}`;
  if (isReservedFileName(name)) return `${JSON.stringify(name)} is a reserved device name on Windows`;
  return null;
}

/**
 * Why `path` (project-relative, `/`-separated) has a segment that is not a
 * portable file name ({@link fileNameProblem}), or `null`. Does not check
 * relativity; combine with `relativePathProblem`.
 */
export function portablePathProblem(path: string): string | null {
  for (const segment of path.split("/")) {
    const problem = fileNameProblem(segment);
    if (problem) return `segment ${problem}`;
  }
  return null;
}

/**
 * A portable file name made from free text: forbidden and control
 * characters become `_`, trailing dots and spaces are dropped, surrounding
 * whitespace is trimmed, a reserved device name gets a `_` appended to its
 * stem (`"CON"` → `"CON_"`, `"nul.txt"` → `"nul_.txt"`), and an empty result
 * becomes `fallback`. Always satisfies {@link fileNameProblem} when `fallback` does.
 */
export function safeFileName(text: string, fallback: string): string {
  let name = text.replace(INVALID_CHARS, "_").trim().replace(/[. ]+$/, "");
  if (name.length === 0) return fallback;
  if (isReservedFileName(name)) {
    const dot = name.indexOf(".");
    const stem = (dot >= 0 ? name.slice(0, dot) : name).replace(/ +$/, "");
    name = `${stem}_${dot >= 0 ? name.slice(dot) : ""}`;
  }
  return name;
}
