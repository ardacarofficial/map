import { describe, expect, it } from "vitest";

import {
  draftChanged,
  draftFromType,
  fieldDraftProblems,
  newFieldDraft,
  parseEnumValues,
  parseFloatText,
  parseIntText,
  rawFromValue,
  typeFromDraft,
  valueFromRaw,
  withEnumText,
  withFieldType,
  type TypeDraft,
} from "./fieldValues";

describe("field value parsing", () => {
  it("parses integers strictly", () => {
    expect(parseIntText(" 42 ")).toBe(42);
    expect(parseIntText("-7")).toBe(-7);
    expect(parseIntText("4.2")).toBeNull();
    expect(parseIntText("")).toBeNull();
    expect(parseIntText("1e3")).toBeNull();
    expect(parseIntText("99999999999999999999")).toBeNull();
  });

  it("parses decimals, with a decimal comma", () => {
    expect(parseFloatText("1,5")).toBe(1.5);
    expect(parseFloatText(".25")).toBe(0.25);
    expect(parseFloatText("-3")).toBe(-3);
    expect(parseFloatText("abc")).toBeNull();
    expect(parseFloatText("")).toBeNull();
  });

  it("round-trips every field type through the form state", () => {
    const cases = [
      [{ type: "string" as const }, "merhaba"],
      [{ type: "int" as const }, 12],
      [{ type: "float" as const }, 0.5],
      [{ type: "bool" as const }, true],
      [{ type: "enum" as const, enumValues: ["a", "b"] }, "b"],
      [{ type: "levelRef" as const }, "lvl-1"],
      [{ type: "levelRef" as const }, null],
      [{ type: "point" as const }, { x: 3, y: -4 }],
      [{ type: "point" as const }, null],
    ] as const;
    for (const [field, value] of cases) {
      expect(valueFromRaw(field, rawFromValue(field.type, value))).toEqual({ ok: true, value });
    }
  });

  it("reports invalid input with an i18n key", () => {
    const raw = rawFromValue("int", 0);
    expect(valueFromRaw({ type: "int" }, { ...raw, text: "x" })).toEqual({ ok: false, error: "entities.errInt" });
    expect(valueFromRaw({ type: "point" }, { ...raw, x: "1", y: "" })).toEqual({ ok: false, error: "entities.errPoint" });
    expect(valueFromRaw({ type: "enum", enumValues: ["a"] }, { ...raw, choice: "z" })).toEqual({ ok: false, error: "entities.errEnumChoice" });
  });

  it("splits enum values", () => {
    expect(parseEnumValues(" a, b ,,c ")).toEqual(["a", "b", "c"]);
  });
});

describe("entity type drafts", () => {
  const base = (): TypeDraft => ({ id: null, name: "Sandık", color: "#F59E0B", fields: [] });

  it("validates field rows", () => {
    const a = { ...newFieldDraft("loot"), type: "string" as const };
    const dup = { ...newFieldDraft("loot") };
    const empty = newFieldDraft(" ");
    const badEnum = withEnumText(withFieldType(newFieldDraft("kind"), "enum"), "x, x");
    expect(fieldDraftProblems([a, dup, empty, badEnum])).toEqual([
      "entities.errFieldDup",
      "entities.errFieldDup",
      "entities.errFieldName",
      "entities.errEnumDup",
    ]);
  });

  it("changing a field's type resets its default to a valid one", () => {
    const f = withFieldType(newFieldDraft("n"), "int");
    expect(f.default).toBe(0);
    const e = withFieldType(f, "enum");
    expect(parseEnumValues(e.enumText).length).toBeGreaterThan(0);
    expect(fieldDraftProblems([e])).toEqual([null]);
    expect(withEnumText({ ...e, default: "a" }, "b, c").default).toBe("b");
  });

  it("builds a valid type with a derived id", () => {
    const draft = base();
    draft.fields = [withEnumText(withFieldType(newFieldDraft("renk"), "enum"), "kırmızı, mavi"), withFieldType(newFieldDraft("adet"), "int")];
    const result = typeFromDraft(draft, ["sandik"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.type.id).toBe("sandik-2");
    expect(result.type.color).toBe("#f59e0b");
    expect(result.type.fields[0]).toEqual({ name: "renk", type: "enum", default: "kırmızı", enumValues: ["kırmızı", "mavi"] });
    expect(draftChanged(draftFromType(result.type), result.type)).toBe(false);
    expect(draftChanged({ ...draftFromType(result.type), name: "Kasa" }, result.type)).toBe(true);
  });

  it("refuses an empty name and a bad color", () => {
    expect(typeFromDraft({ ...base(), name: "  " }, [])).toEqual({ ok: false, error: "entities.errTypeName" });
    expect(typeFromDraft({ ...base(), color: "red" }, [])).toEqual({ ok: false, error: "entities.errColor" });
  });
});
