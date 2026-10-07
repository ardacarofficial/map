/**
 * Small deterministic JSON writer for the exporters.
 *
 * Same rules as the save format (fixed key order = insertion order, `\n`
 * line endings, 2-space indent, trailing newline), plus compact number
 * arrays: an array of primitives is written on one line, and a {@link Rows}
 * value is written `stride` numbers per line (one map row, one cell tuple…),
 * so exported files stay small and diff-friendly. Output is plain JSON.
 */

/** A flat number array written `stride` values per line. */
export class Rows {
  constructor(
    readonly values: readonly number[],
    readonly stride: number,
  ) {}
}

/** JSON text of `value` (objects, arrays, strings, finite numbers, booleans, {@link Rows}). */
export function writeJson(value: unknown): string {
  return write(value, "") + "\n";
}

function write(value: unknown, indent: string): string {
  if (value instanceof Rows) return writeRows(value, indent);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`cannot export non-finite number ${value}`);
    return JSON.stringify(value);
  }
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => v === null || typeof v !== "object")) return `[${value.map((v) => write(v, inner)).join(", ")}]`;
    return `[\n${value.map((v) => inner + write(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${write(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  throw new TypeError(`cannot export ${typeof value}`);
}

function writeRows(rows: Rows, indent: string): string {
  const { values, stride } = rows;
  if (values.length === 0) return "[]";
  const inner = indent + "  ";
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += stride) {
    lines.push(inner + values.slice(i, i + stride).map((v) => write(v, inner)).join(", "));
  }
  return `[\n${lines.join(",\n")}\n${indent}]`;
}
