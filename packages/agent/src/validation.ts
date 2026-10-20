import { Ajv2020 } from "ajv/dist/2020.js";
import {
  AGENT_LIMITS,
  AgentError,
  AgentErrorCode as E,
  type Rect,
  type Point,
  type ToolArguments,
  type ToolName,
  type JsonObject,
} from "./contracts";
import { TOOL_DEFINITIONS } from "./toolSchemas";
import type { MapStore } from "@smap/core";

const ajv = new Ajv2020({ strict: false, allErrors: false });
const validators = new Map(
  TOOL_DEFINITIONS.map((t) => [t.name, ajv.compile(t.inputSchema)]),
);
export function fail(
  code: E,
  message: string,
  details: JsonObject = {},
): never {
  throw new AgentError(code, message, details);
}
export function check(
  condition: unknown,
  code: E,
  message: string,
  details: JsonObject = {},
): asserts condition {
  if (!condition) fail(code, message, details);
}
function jsonStringBytes(value: string): number {
  // JSON escaping plus UTF-8, without allocating a second unbounded string.
  let n = 2;
  for (const char of value) {
    const c = char.codePointAt(0)!;
    n +=
      c === 34 ||
      c === 92 ||
      c === 8 ||
      c === 9 ||
      c === 10 ||
      c === 12 ||
      c === 13
        ? 2
        : c < 32 || (c >= 0xd800 && c <= 0xdfff)
          ? 6
          : c < 128
            ? 1
            : c < 2048
              ? 2
              : c < 65536
                ? 3
                : 4;
  }
  return n;
}
/** Bounded structural walk precedes AJV; rejects cycles and non-JSON JS values too. */
export function assertJson(value: unknown): void {
  let bytes = 0;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth: number): void {
    check(
      depth <= AGENT_LIMITS.jsonDepth,
      E.LIMIT_EXCEEDED,
      "JSON nesting limit exceeded",
    );
    if (v === null || typeof v === "boolean") {
      bytes += v === null ? 4 : v ? 4 : 5;
    } else if (typeof v === "number") {
      check(Number.isFinite(v), E.INVALID_ARGUMENT, "Non-finite JSON number");
      bytes += JSON.stringify(v).length;
    } else if (typeof v === "string") {
      bytes += jsonStringBytes(v);
    } else if (typeof v === "object") {
      check(!ancestors.has(v), E.INVALID_ARGUMENT, "Cyclic arguments");
      check(
        Array.isArray(v) ||
          Object.getPrototypeOf(v) === Object.prototype ||
          Object.getPrototypeOf(v) === null,
        E.INVALID_ARGUMENT,
        "Arguments must be JSON",
      );
      ancestors.add(v);
      bytes += 2;
      for (const [key, child] of Object.entries(v)) {
        bytes += Array.isArray(v) ? 1 : jsonStringBytes(key) + 2;
        visit(child, depth + 1);
      }
      ancestors.delete(v);
    } else fail(E.INVALID_ARGUMENT, "Arguments must be JSON");
    check(
      bytes <= AGENT_LIMITS.requestBytes,
      E.LIMIT_EXCEEDED,
      "Request size limit exceeded",
    );
  }
  visit(value, 0);
}
export function validate<N extends ToolName>(
  name: string,
  args: unknown,
): asserts args is ToolArguments[N] {
  check(validators.has(name as ToolName), E.INVALID_ARGUMENT, "Unknown tool");
  assertJson(args);
  const validator = validators.get(name as ToolName)!;
  check(validator(args), E.INVALID_ARGUMENT, ajv.errorsText(validator.errors));
}
export function point(store: MapStore, p: Point): void {
  check(store.document.inBounds(p.x, p.y), E.OUT_OF_BOUNDS, "Cell outside map");
}
export function rect(store: MapStore, r: Rect): void {
  point(store, r);
  check(
    r.x + r.width <= store.document.map.width &&
      r.y + r.height <= store.document.map.height,
    E.OUT_OF_BOUNDS,
    "Region outside map",
  );
}
export function budget(
  n: number,
  max: number = AGENT_LIMITS.cellsPerCall,
): void {
  check(n <= max, E.LIMIT_EXCEEDED, "Operation budget exceeded", {
    requested: n,
    limit: max,
  });
}
export function uniquePoints(points: readonly Point[]): void {
  check(
    new Set(points.map((p) => `${p.x},${p.y}`)).size === points.length,
    E.INVALID_ARGUMENT,
    "Duplicate coordinates",
  );
}
export function dimensions(width: number, height: number): void {
  budget(width * height, AGENT_LIMITS.mapArea);
}
