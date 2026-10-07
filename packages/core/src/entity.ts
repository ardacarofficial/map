/**
 * Entities (v0.6): NPCs, doors, chests… placed on entity layers, and the
 * entity type definitions they follow.
 *
 * - **Position**: `x`, `y` are integer **pixels in map space** (y down,
 *   origin = top-left corner of the map), the top-left corner of the
 *   entity's box. The editor snaps them to cell corners
 *   (`x = cellX * tileWidth`), core only requires integers inside the map:
 *   `0 ≤ x < width * tileWidth`, `0 ≤ y < height * tileHeight`.
 *   `width` / `height` are optional pixel sizes; omitted means one cell
 *   ({@link entitySize}).
 * - **Types** are project-level data (stored next to the tilesets in the
 *   project file and in `MapDocument.entityTypes`). Two types are built in
 *   and never stored, edited or removed: {@link SPAWN_TYPE_ID} (at most one
 *   per level; the game starts the player there) and {@link PORTAL_TYPE_ID}
 *   (v1.1: `targetLevel` = level **id**, `targetPoint` = pixel point in the
 *   target level).
 * - **Fields**: an entity stores a value for each field of its type
 *   (defaults filled in when it is created). A type edited later may leave
 *   stale or missing values; they are kept in the file and
 *   {@link resolveEntityFields} falls back to the default (that is what
 *   the exporters write).
 */
import type { MapInfo } from "./document";

/** Kinds of entity field values. */
export type EntityFieldType = "string" | "int" | "float" | "bool" | "enum" | "levelRef" | "point";

/** All field kinds, in picker order. */
export const ENTITY_FIELD_TYPES: readonly EntityFieldType[] = Object.freeze([
  "string",
  "int",
  "float",
  "bool",
  "enum",
  "levelRef",
  "point",
]);

/** A point in pixels (map space of the level it refers to, y down). */
export interface EntityPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A field value: string (`string`, `enum`, `levelRef` = level id), number
 * (`int`, `float`), boolean (`bool`), point (`point`); `null` = not set
 * (only `levelRef` and `point`).
 */
export type EntityFieldValue = string | number | boolean | EntityPoint | null;

/** One field of an entity type. */
export interface EntityFieldDef {
  /** Unique within the type, non-empty. */
  readonly name: string;
  readonly type: EntityFieldType;
  /** Value of a new entity; must be valid for `type`. */
  readonly default: EntityFieldValue;
  /** `enum` only: the allowed values (non-empty, unique). */
  readonly enumValues?: readonly string[];
}

/** An entity type definition (project level). */
export interface EntityType {
  /** Stable id, non-empty. `"spawn"` and `"portal"` are reserved. */
  readonly id: string;
  readonly name: string;
  /** `#rrggbb`. */
  readonly color: string;
  /** Optional icon name (the editor decides what names mean). */
  readonly icon?: string;
  readonly fields: readonly EntityFieldDef[];
}

/** One placed entity. */
export interface Entity {
  /** Stable id, unique within the level. */
  readonly id: string;
  readonly typeId: string;
  /** Pixels, top-left corner (see module doc). */
  readonly x: number;
  readonly y: number;
  /** Pixels; omitted = one cell. */
  readonly width?: number;
  readonly height?: number;
  /** Field values by name. Keys are kept sorted (deterministic files). */
  readonly fields: Readonly<Record<string, EntityFieldValue>>;
}

/** A resolved field (export): the type's fields in definition order. */
export interface ResolvedEntityField {
  readonly name: string;
  readonly type: EntityFieldType;
  readonly value: EntityFieldValue;
}

/** Reserved id of the built-in spawn point type. */
export const SPAWN_TYPE_ID = "spawn";
/** Reserved id of the built-in portal type (v1.1). */
export const PORTAL_TYPE_ID = "portal";
/** Portal field holding the target level id. */
export const PORTAL_TARGET_LEVEL = "targetLevel";
/** Portal field holding the target point (pixels in the target level). */
export const PORTAL_TARGET_POINT = "targetPoint";

/** Built-in types: always available, never stored in files, not editable or removable. */
export const BUILTIN_ENTITY_TYPES: readonly EntityType[] = Object.freeze([
  Object.freeze({ id: SPAWN_TYPE_ID, name: "Spawn", color: "#22c55e", icon: "flag", fields: Object.freeze([]) }),
  Object.freeze({
    id: PORTAL_TYPE_ID,
    name: "Portal",
    color: "#a855f7",
    icon: "portal",
    fields: Object.freeze([
      Object.freeze({ name: PORTAL_TARGET_LEVEL, type: "levelRef" as const, default: null }),
      Object.freeze({ name: PORTAL_TARGET_POINT, type: "point" as const, default: null }),
    ]),
  }),
]);

const BUILTIN_BY_ID: ReadonlyMap<string, EntityType> = new Map(BUILTIN_ENTITY_TYPES.map((t) => [t.id, t]));

/** Built-in type by id, or `undefined`. */
export function builtinEntityType(id: string): EntityType | undefined {
  return BUILTIN_BY_ID.get(id);
}

/** True for `"spawn"` and `"portal"`. */
export function isBuiltinEntityTypeId(id: unknown): boolean {
  return typeof id === "string" && BUILTIN_BY_ID.has(id);
}

/** True when `value` names a field kind. */
export function isEntityFieldType(value: unknown): value is EntityFieldType {
  return typeof value === "string" && (ENTITY_FIELD_TYPES as readonly string[]).includes(value);
}

/** True when `value` is a point with integer `x` and `y` and no other keys. */
export function isEntityPoint(value: unknown): value is EntityPoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const p = value as Record<string, unknown>;
  return keys.length === 2 && Number.isSafeInteger(p["x"]) && Number.isSafeInteger(p["y"]);
}

/** True when `value` has the shape of some field value (does not check it against a field). */
export function isEntityFieldValue(value: unknown): value is EntityFieldValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    isEntityPoint(value)
  );
}

/** Why `value` is not valid for `field`, or `null`. */
export function entityFieldValueProblem(field: EntityFieldDef, value: unknown): string | null {
  const bad = (what: string) => `field "${field.name}" (${field.type}) must be ${what}, got ${describe(value)}`;
  switch (field.type) {
    case "string":
      return typeof value === "string" ? null : bad("a string");
    case "int":
      return Number.isSafeInteger(value) ? null : bad("an integer");
    case "float":
      return typeof value === "number" && Number.isFinite(value) ? null : bad("a finite number");
    case "bool":
      return typeof value === "boolean" ? null : bad("a boolean");
    case "enum":
      return typeof value === "string" && (field.enumValues ?? []).includes(value)
        ? null
        : bad(`one of ${JSON.stringify(field.enumValues ?? [])}`);
    case "levelRef":
      return value === null || (typeof value === "string" && value.length > 0) ? null : bad("a level id or null");
    case "point":
      return value === null || isEntityPoint(value) ? null : bad("{ x, y } with integer pixels, or null");
    default:
      return `field "${String((field as { name?: unknown }).name)}" has an unknown type`;
  }
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Why `type` is not a valid user-defined entity type, or `null` (reserved ids are not checked here). */
export function entityTypeProblem(type: EntityType): string | null {
  if (typeof type !== "object" || type === null) return "entity type must be an object";
  if (typeof type.id !== "string" || type.id.length === 0) return "id must be a non-empty string";
  if (typeof type.name !== "string") return "name must be a string";
  if (typeof type.color !== "string" || !COLOR_RE.test(type.color)) return `color must be "#rrggbb", got ${describe(type.color)}`;
  if (type.icon !== undefined && typeof type.icon !== "string") return "icon must be a string";
  if (!Array.isArray(type.fields)) return "fields must be an array";
  const names = new Set<string>();
  for (const field of type.fields as readonly EntityFieldDef[]) {
    if (typeof field !== "object" || field === null) return "every field must be an object";
    if (typeof field.name !== "string" || field.name.length === 0) return "field names must be non-empty strings";
    if (names.has(field.name)) return `duplicate field name "${field.name}"`;
    names.add(field.name);
    if (!isEntityFieldType(field.type)) return `field "${field.name}" has unknown type ${describe(field.type)}`;
    if (field.type === "enum") {
      const values = field.enumValues;
      if (!Array.isArray(values) || values.length === 0) return `enum field "${field.name}" needs enumValues`;
      if (!values.every((v) => typeof v === "string")) return `enum field "${field.name}": enumValues must be strings`;
      if (new Set(values).size !== values.length) return `enum field "${field.name}": enumValues must be unique`;
    } else if (field.enumValues !== undefined) {
      return `field "${field.name}": only enum fields have enumValues`;
    }
    const problem = entityFieldValueProblem(field, field.default);
    if (problem) return `default of ${problem}`;
  }
  return null;
}

/** Why a list of user-defined types is invalid (bad type, reserved or duplicate id), or `null`. */
export function entityTypesProblem(types: readonly EntityType[]): string | null {
  const ids = new Set<string>();
  for (const [i, type] of types.entries()) {
    const problem = entityTypeProblem(type);
    if (problem) return `entityTypes[${i}]: ${problem}`;
    if (isBuiltinEntityTypeId(type.id)) return `entityTypes[${i}]: id "${type.id}" is reserved for a built-in type`;
    if (ids.has(type.id)) return `entityTypes[${i}]: duplicate id "${type.id}"`;
    ids.add(type.id);
  }
  return null;
}

/** Frozen copy (points copied, `icon` / `enumValues` dropped when absent). */
export function normalizeEntityType(type: EntityType): EntityType {
  return Object.freeze({
    id: type.id,
    name: type.name,
    color: type.color,
    ...(type.icon !== undefined ? { icon: type.icon } : {}),
    fields: Object.freeze(
      type.fields.map((f) =>
        Object.freeze({
          name: f.name,
          type: f.type,
          default: copyValue(f.default),
          ...(f.type === "enum" && f.enumValues ? { enumValues: Object.freeze([...f.enumValues]) } : {}),
        }),
      ),
    ),
  });
}

/** Frozen copy with field keys sorted and points copied. */
export function normalizeEntity(entity: Entity): Entity {
  const fields: Record<string, EntityFieldValue> = {};
  for (const name of Object.keys(entity.fields).sort()) fields[name] = copyValue(entity.fields[name]!);
  return Object.freeze({
    id: entity.id,
    typeId: entity.typeId,
    x: entity.x,
    y: entity.y,
    ...(entity.width !== undefined ? { width: entity.width } : {}),
    ...(entity.height !== undefined ? { height: entity.height } : {}),
    fields: Object.freeze(fields),
  });
}

/**
 * Why `entity` is not valid in a map of `map`'s size, or `null`.
 * With `type`, field values are checked against it (unknown field names are
 * a problem); without it only their shape is checked (a level may reference
 * a type that was removed later).
 */
export function entityProblem(entity: Entity, map: MapInfo, type?: EntityType): string | null {
  if (typeof entity.id !== "string" || entity.id.length === 0) return "id must be a non-empty string";
  if (typeof entity.typeId !== "string" || entity.typeId.length === 0) return "typeId must be a non-empty string";
  const pw = map.width * map.tileWidth;
  const ph = map.height * map.tileHeight;
  if (!Number.isInteger(entity.x) || !Number.isInteger(entity.y) || entity.x < 0 || entity.y < 0 || entity.x >= pw || entity.y >= ph) {
    return `position (${String(entity.x)}, ${String(entity.y)}) must be integer pixels inside the map (${pw}×${ph})`;
  }
  for (const key of ["width", "height"] as const) {
    const v = entity[key];
    if (v !== undefined && (!Number.isInteger(v) || v < 1)) return `${key} must be a positive integer, got ${String(v)}`;
  }
  if (typeof entity.fields !== "object" || entity.fields === null || Array.isArray(entity.fields)) return "fields must be an object";
  for (const [name, value] of Object.entries(entity.fields)) {
    if (!type) {
      if (!isEntityFieldValue(value)) return `field "${name}" has an invalid value ${describe(value)}`;
      continue;
    }
    const def = type.fields.find((f) => f.name === name);
    if (!def) return `type "${type.id}" has no field "${name}"`;
    const problem = entityFieldValueProblem(def, value);
    if (problem) return problem;
  }
  return null;
}

/**
 * The fields of `type` in definition order with the entity's value, or the
 * default when the entity has none or its value no longer fits the field.
 * Values for names the type does not have are left out.
 */
export function resolveEntityFields(entity: Entity, type: EntityType | undefined): ResolvedEntityField[] {
  if (!type) return [];
  return type.fields.map((def) => {
    const own = Object.prototype.hasOwnProperty.call(entity.fields, def.name) ? entity.fields[def.name] : undefined;
    const value = own !== undefined && entityFieldValueProblem(def, own) === null ? own : def.default;
    return { name: def.name, type: def.type, value };
  });
}

/** Default field values of `type`. */
export function defaultEntityFields(type: EntityType): Record<string, EntityFieldValue> {
  const out: Record<string, EntityFieldValue> = {};
  for (const f of type.fields) out[f.name] = copyValue(f.default);
  return out;
}

/** Pixel size of an entity: its own `width` / `height`, else one map cell. */
export function entitySize(entity: Entity, map: MapInfo): { width: number; height: number } {
  return { width: entity.width ?? map.tileWidth, height: entity.height ?? map.tileHeight };
}

/** Cell under the entity's top-left corner. */
export function entityCell(entity: Entity, map: MapInfo): { x: number; y: number } {
  return { x: Math.floor(entity.x / map.tileWidth), y: Math.floor(entity.y / map.tileHeight) };
}

function copyValue(value: EntityFieldValue): EntityFieldValue {
  return isEntityPoint(value) ? Object.freeze({ x: value.x, y: value.y }) : value;
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
