/**
 * Entity field values ↔ form inputs, and validation of entity type drafts.
 * Pure (no React, no DOM) so the parsing rules are unit-tested. Messages are
 * i18n keys; core's own checks (`entityTypeProblem`, `entityFieldValueProblem`)
 * stay the final word before an op is dispatched.
 */
import {
  entityFieldValueProblem,
  entityTypeProblem,
  isBuiltinEntityTypeId,
  makeStampId,
  type EntityFieldDef,
  type EntityFieldType,
  type EntityFieldValue,
  type EntityType,
} from "@smap/core";

import type { MessageKey } from "../../i18n";

/**
 * Everything an input can hold for any field type; each type reads its part:
 * `text` (string / int / float), `bool`, `choice` (enum / levelRef; `null` =
 * not set), `x` + `y` (point; both empty = not set).
 */
export interface RawValue {
  text: string;
  bool: boolean;
  choice: string | null;
  x: string;
  y: string;
}

export type Parsed = { ok: true; value: EntityFieldValue } | { ok: false; error: MessageKey };

const EMPTY_RAW: RawValue = { text: "", bool: false, choice: null, x: "", y: "" };

/** Form state for a stored value. */
export function rawFromValue(type: EntityFieldType, value: EntityFieldValue): RawValue {
  switch (type) {
    case "string":
      return { ...EMPTY_RAW, text: typeof value === "string" ? value : "" };
    case "int":
    case "float":
      return { ...EMPTY_RAW, text: typeof value === "number" ? String(value) : "" };
    case "bool":
      return { ...EMPTY_RAW, bool: value === true };
    case "enum":
    case "levelRef":
      return { ...EMPTY_RAW, choice: typeof value === "string" ? value : null };
    case "point":
      return typeof value === "object" && value !== null
        ? { ...EMPTY_RAW, x: String(value.x), y: String(value.y) }
        : EMPTY_RAW;
  }
}

const INT_RE = /^[+-]?\d+$/;

/** Integer text ("12", "-3"; surrounding spaces allowed), or `null`. */
export function parseIntText(text: string): number | null {
  const s = text.trim();
  if (!INT_RE.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decimal text; a Turkish decimal comma ("1,5") is accepted. `null` when not a finite number. */
export function parseFloatText(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** The value a form state stands for, or why it is not valid for `field`. */
export function valueFromRaw(field: Pick<EntityFieldDef, "type" | "enumValues">, raw: RawValue): Parsed {
  switch (field.type) {
    case "string":
      return { ok: true, value: raw.text };
    case "int": {
      const n = parseIntText(raw.text);
      return n === null ? { ok: false, error: "entities.errInt" } : { ok: true, value: n };
    }
    case "float": {
      const n = parseFloatText(raw.text);
      return n === null ? { ok: false, error: "entities.errFloat" } : { ok: true, value: n };
    }
    case "bool":
      return { ok: true, value: raw.bool };
    case "enum":
      return raw.choice !== null && (field.enumValues ?? []).includes(raw.choice)
        ? { ok: true, value: raw.choice }
        : { ok: false, error: "entities.errEnumChoice" };
    case "levelRef":
      return { ok: true, value: raw.choice && raw.choice.length > 0 ? raw.choice : null };
    case "point": {
      if (raw.x.trim() === "" && raw.y.trim() === "") return { ok: true, value: null };
      const x = parseIntText(raw.x);
      const y = parseIntText(raw.y);
      return x === null || y === null ? { ok: false, error: "entities.errPoint" } : { ok: true, value: { x, y } };
    }
  }
}

/** "a, b ,c" → ["a", "b", "c"] (empty parts dropped). */
export function parseEnumValues(text: string): string[] {
  return text
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** A valid default for a field of `type` (enum: its first value, or "" when it has none yet). */
export function defaultForType(type: EntityFieldType, enumValues: readonly string[] = []): EntityFieldValue {
  switch (type) {
    case "string":
      return "";
    case "int":
    case "float":
      return 0;
    case "bool":
      return false;
    case "enum":
      return enumValues[0] ?? "";
    case "levelRef":
    case "point":
      return null;
  }
}

// ------------------------------------------------------------------ type drafts

/** One row of the fields table while editing a type. */
export interface FieldDraft {
  /** Stable React key (not saved). */
  key: string;
  name: string;
  type: EntityFieldType;
  default: EntityFieldValue;
  /** Enum values as typed ("a, b, c"). */
  enumText: string;
}

export interface TypeDraft {
  /** `null` until the type is first saved (the id is derived from the name then). */
  id: string | null;
  name: string;
  color: string;
  icon?: string;
  fields: FieldDraft[];
}

let draftKey = 0;
const nextKey = () => `f${++draftKey}`;

export function draftFromType(type: EntityType): TypeDraft {
  return {
    id: type.id,
    name: type.name,
    color: type.color,
    ...(type.icon !== undefined ? { icon: type.icon } : {}),
    fields: type.fields.map((f) => ({
      key: nextKey(),
      name: f.name,
      type: f.type,
      default: f.default,
      enumText: (f.enumValues ?? []).join(", "),
    })),
  };
}

export function newFieldDraft(name: string): FieldDraft {
  return { key: nextKey(), name, type: "string", default: "", enumText: "" };
}

/** The field with a new type: the default is reset to one valid for it. */
export function withFieldType(field: FieldDraft, type: EntityFieldType): FieldDraft {
  if (type === field.type) return field;
  const enumValues = parseEnumValues(field.enumText);
  const enumText = type === "enum" && enumValues.length === 0 ? "a, b" : field.enumText;
  return { ...field, type, enumText, default: defaultForType(type, parseEnumValues(enumText)) };
}

/** The field with new enum values: an enum default that is no longer listed becomes the first value. */
export function withEnumText(field: FieldDraft, enumText: string): FieldDraft {
  const values = parseEnumValues(enumText);
  const keep = typeof field.default === "string" && values.includes(field.default);
  return { ...field, enumText, default: keep ? field.default : (values[0] ?? "") };
}

/** Problems of each field row (i18n key), `null` where the row is fine. */
export function fieldDraftProblems(fields: readonly FieldDraft[]): (MessageKey | null)[] {
  const counts = new Map<string, number>();
  for (const f of fields) counts.set(f.name.trim(), (counts.get(f.name.trim()) ?? 0) + 1);
  return fields.map((f) => {
    const name = f.name.trim();
    if (name.length === 0) return "entities.errFieldName";
    if ((counts.get(name) ?? 0) > 1) return "entities.errFieldDup";
    if (f.type === "enum") {
      const values = parseEnumValues(f.enumText);
      if (values.length === 0) return "entities.errEnumEmpty";
      if (new Set(values).size !== values.length) return "entities.errEnumDup";
    }
    const def = toFieldDef(f);
    if (entityFieldValueProblem(def, def.default) !== null) return "entities.errDefault";
    return null;
  });
}

function toFieldDef(f: FieldDraft): EntityFieldDef {
  return {
    name: f.name.trim(),
    type: f.type,
    default: f.default,
    ...(f.type === "enum" ? { enumValues: parseEnumValues(f.enumText) } : {}),
  };
}

/** Id for a new type: a slug of its name, unique among `taken` and the built-in ids. */
export function newEntityTypeId(name: string, taken: Iterable<string>): string {
  return makeStampId(name.trim() || "type", [...taken, "spawn", "portal"]);
}

/**
 * The entity type a draft describes, or why it cannot be saved (an i18n key
 * for the common mistakes, otherwise core's own message).
 */
export function typeFromDraft(
  draft: TypeDraft,
  takenIds: Iterable<string>,
): { ok: true; type: EntityType } | { ok: false; error: MessageKey | string } {
  if (draft.name.trim().length === 0) return { ok: false, error: "entities.errTypeName" };
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) return { ok: false, error: "entities.errColor" };
  const fieldProblem = fieldDraftProblems(draft.fields).find((p) => p !== null);
  if (fieldProblem) return { ok: false, error: fieldProblem };
  const id = draft.id ?? newEntityTypeId(draft.name, takenIds);
  if (isBuiltinEntityTypeId(id)) return { ok: false, error: "entities.errTypeName" };
  const type: EntityType = {
    id,
    name: draft.name.trim(),
    color: draft.color.toLowerCase(),
    ...(draft.icon !== undefined ? { icon: draft.icon } : {}),
    fields: draft.fields.map(toFieldDef),
  };
  const problem = entityTypeProblem(type);
  return problem ? { ok: false, error: problem } : { ok: true, type };
}

/** True when the draft differs from the saved type (or is new). */
export function draftChanged(draft: TypeDraft, saved: EntityType | undefined): boolean {
  if (!saved) return true;
  const result = typeFromDraft({ ...draft, id: saved.id }, []);
  if (!result.ok) return true;
  return JSON.stringify(result.type) !== JSON.stringify({ ...saved, color: saved.color.toLowerCase() });
}

/** Palette of type colors offered for new types (cycled). */
export const TYPE_COLORS = ["#f59e0b", "#3b82f6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#f97316", "#06b6d4"];
