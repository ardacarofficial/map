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
// Failure path only: all errors, so a oneOf can be explained by its best-matching branch.
const detailed = new Ajv2020({ strict: false, allErrors: true });
type Schema = { readonly [key: string]: unknown };
interface SchemaIssue { instancePath: string; schemaPath: string; keyword: string; params: Record<string, unknown>; message?: string }
const compiled = new WeakMap<object, ReturnType<typeof detailed.compile>>();
function detailedValidator(schema: Schema, defs: unknown) {
  let validator = compiled.get(schema);
  if (!validator) {
    validator = detailed.compile(defs && !("$defs" in schema) ? { ...schema, $defs: defs } : schema);
    compiled.set(schema, validator);
  }
  return validator;
}
function pointer(root: unknown, path: string): unknown {
  let value = root;
  for (const raw of path.replace(/^#/, "").split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
const DISCRIMINATORS = new Set(["tool", "action", "mode", "kind"]);
function deref(root: unknown, schema: unknown): Schema | undefined {
  let value = schema;
  for (let i = 0; i < 16 && value !== null && typeof value === "object" && typeof (value as Schema).$ref === "string"; i++)
    value = pointer(root, (value as Schema).$ref as string);
  return value !== null && typeof value === "object" ? value as Schema : undefined;
}
/** AJV reports schemaPath relative to a $ref target, so locate a wrapper by walking the instance path. */
function schemaAt(root: unknown, schema: Schema, path: string): Schema | undefined {
  let current = deref(root, schema);
  for (const raw of path.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    const properties = current?.properties as Record<string, unknown> | undefined;
    if (properties && Object.hasOwn(properties, key)) current = deref(root, properties[key]);
    else if (current?.items && /^\d+$/.test(key)) current = deref(root, current.items);
    else return undefined;
  }
  return current;
}
function describe(issue: SchemaIssue): string {
  const p = issue.params;
  if (issue.keyword === "additionalProperties") return `unknown property '${String(p.additionalProperty)}'`;
  if (issue.keyword === "required") return `missing required property '${String(p.missingProperty)}'`;
  if (issue.keyword === "const") return `must be ${JSON.stringify(p.allowedValue)}`;
  if (issue.keyword === "enum") return `must be one of ${JSON.stringify(p.allowedValues)}`;
  if (issue.keyword === "not") return "uses a combination of properties that is not allowed";
  return issue.message ?? issue.keyword;
}
function explain(schema: Schema, defs: unknown, data: unknown, base: string, depth: number): string[] {
  const validator = detailedValidator(schema, defs);
  if (validator(data)) return [];
  const issues = (validator.errors ?? []) as SchemaIssue[];
  const wrappers = issues.filter(e => e.keyword === "oneOf" || e.keyword === "anyOf")
    .sort((a, b) => a.instancePath.length - b.instancePath.length);
  const wrapper = wrappers[0];
  const root = defs && !("$defs" in schema) ? { ...schema, $defs: defs } : schema;
  const located = wrapper ? schemaAt(root, schema, wrapper.instancePath)?.[wrapper.keyword] : undefined;
  const branches = Array.isArray(located) ? located : wrapper ? pointer(root, wrapper.schemaPath) : undefined;
  const plain = issues.filter(e => !["oneOf", "anyOf", "if", "allOf"].includes(e.keyword));
  if (!wrapper || !Array.isArray(branches) || depth > 6) {
    const out = plain.length ? plain : issues;
    return out.map(e => `${base}${e.instancePath || ""}`.replace(/^$/, "/") + `: ${describe(e)}`);
  }
  if (wrapper.keyword === "oneOf" && Array.isArray(wrapper.params.passingSchemas))
    return [`${base}${wrapper.instancePath}`.replace(/^$/, "/") + ": matches more than one alternative; remove the ambiguous properties"];
  const value = pointer(data, "#" + wrapper.instancePath);
  let best: { score: number; schema: Schema } | undefined;
  for (const branch of branches as Schema[]) {
    const v = detailedValidator(branch, (root as Schema).$defs);
    if (v(value)) continue;
    const errors = (v.errors ?? []) as SchemaIssue[];
    const score = errors.reduce((sum, e) => {
      const parts = e.instancePath.split("/").slice(1);
      if ((e.keyword === "const" || e.keyword === "enum") && parts.length === 1 && DISCRIMINATORS.has(parts[0]!)) return sum + 1e6;
      if (e.keyword === "type" && parts.length === 0) return sum + 1e5;
      return sum + 1;
    }, 0);
    if (!best || score < best.score) best = { score, schema: branch };
  }
  const outside = plain.filter(e => !e.instancePath.startsWith(wrapper.instancePath))
    .map(e => `${base}${e.instancePath || ""}`.replace(/^$/, "/") + `: ${describe(e)}`);
  const inside = best ? explain(best.schema, (root as Schema).$defs, value, base + wrapper.instancePath, depth + 1) : [];
  return [...outside, ...inside];
}
/** "path: problem" lines for an invalid call, following only the best-matching oneOf branch (C4). */
export function explainSchemaErrors(name: string, args: unknown): string {
  const tool = TOOL_DEFINITIONS.find(t => t.name === name);
  if (!tool) return "Unknown tool";
  try {
    const lines = [...new Set(explain(tool.inputSchema as Schema, undefined, args, "", 0))];
    if (!lines.length) return "Invalid arguments";
    return lines.slice(0, 4).join("; ") + (lines.length > 4 ? `; (+${lines.length - 4} more)` : "");
  } catch {
    return "Invalid arguments";
  }
}
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
  if (!validator(args)) fail(E.INVALID_ARGUMENT, explainSchemaErrors(name, args),
    { nextAction: "Fix the listed argument paths and call again; see the tool's input schema." });
}
const mapSize = (store: MapStore) => ({ width: store.document.map.width, height: store.document.map.height });
export function point(store: MapStore, p: Point): void {
  check(store.document.inBounds(p.x, p.y), E.OUT_OF_BOUNDS, "Cell outside map", {
    x: p.x, y: p.y, mapSize: mapSize(store),
    nextAction: `Use 0 <= x < ${store.document.map.width} and 0 <= y < ${store.document.map.height}.`,
  });
}
export function rect(store: MapStore, r: Rect): void {
  point(store, r);
  check(
    r.x + r.width <= store.document.map.width &&
      r.y + r.height <= store.document.map.height,
    E.OUT_OF_BOUNDS,
    "Region outside map",
    { region: { ...r }, mapSize: mapSize(store), nextAction: "Clip the region to the map size or resize_map first." },
  );
}
export function budget(
  n: number,
  max: number = AGENT_LIMITS.cellsPerCall,
): void {
  check(n <= max, E.LIMIT_EXCEEDED, "Operation budget exceeded", {
    requested: n,
    limit: max,
    validRange: { min: 0, max },
    nextAction: `Split the work into calls of at most ${max} (requested ${n}).`,
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
