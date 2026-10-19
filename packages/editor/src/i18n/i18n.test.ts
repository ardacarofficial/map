import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { escapeLegacyMessage, mergeFeature, pluralize } from "../../scripts/i18n-migrate.ts";
import expected from "./__fixtures__/migration.expected.json";
import terminology from "./__fixtures__/world-terminology.expected.json";
import mergedMain from "./__fixtures__/merged-main.legacy.json";
import { createCatalog } from "./catalog";
import { localeResources } from "./resources";
import { messageArguments } from "./messages.generated";

describe("mechanical catalog migration", () => {
  const catalog = createCatalog(localeResources, message => { throw new Error(message); });
  for (const id of ["tr", "en"] as const) {
    it(`preserves legacy output with reviewed world/map terminology for every ${id} key with sample arguments`, () => {
      const imported = Object.fromEntries(Object.entries(mergedMain[id]).map(([key, text]) => [key, text.replace(/\{\w+\}/g, "2")]));
      for (const [key, rendered] of Object.entries({ ...expected[id], ...imported })) {
        const params = Object.fromEntries(Object.keys(messageArguments[key as keyof typeof messageArguments]).map(arg => [arg, 2]));
        expect(catalog.format(id, key, params), `${id}:${key}`).toBe(key in terminology[id] ? new IntlMessageFormat(terminology[id][key as keyof typeof terminology[typeof id]], id).format(params) : rendered);
      }
    });
  }
  it("escapes literal braces, apostrophes, tags and ICU syntax without changing interpolation", () => {
    for (const legacy of ["It's '{name}' { literal } <b>tag</b> #", "{{name}} O'Brien '{' '}'", "'' apostrophes and {count} cells"]) {
      const migrated = escapeLegacyMessage(legacy);
      const params = { name: "{value}'<b>", count: 2 };
      expect(new IntlMessageFormat(migrated, "en", undefined, { ignoreTag: true }).format(params))
        .toBe(legacy.replace(/\{(\w+)\}/g, (_, arg: keyof typeof params) => String(params[arg])));
    }
  });
  it("reruns additive lane migration without replacing reviewed ICU messages", () => {
    const existing = { facts: "Reviewed {count, plural, one {# layer} other {# layers}}" };
    const legacy = { facts: "Old {count} layers", newLaneKey: "Source: {name}" };
    const merged = mergeFeature(existing, legacy, "en");
    expect(merged).toEqual({ ...existing, newLaneKey: "Source: {name}" });
    expect(mergeFeature(merged, legacy, "en")).toEqual(merged);
  });
  it("updates changed legacy copy against an explicit base and keeps unrelated ICU refinements", () => {
    const base = { kept: "{count} maps", updated: "Old {name}" };
    const existing = { kept: "Reviewed {count, plural, one {# map} other {# maps}}", updated: "Old {name}", unrelated: "Keep me" };
    const incoming = { ...base, updated: "It's now {name}", added: "{count} maps" };
    const merged = mergeFeature(existing, incoming, "en", base);
    expect(merged).toEqual({ ...existing, updated: "It''s now {name}", added: "{count, plural, one {# map} other {# maps}}" });
    expect(mergeFeature(merged, incoming, "en", base)).toEqual(merged);
  });
  it("mechanically converts English count nouns and Turkish bare counted nouns", () => {
    expect(new IntlMessageFormat(pluralize("{count} cells", "en"), "en").format({ count: 1 })).toBe("1 cell");
    expect(new IntlMessageFormat(pluralize("{count} hücre", "tr"), "tr").format({ count: 1 })).toBe("1 hücre");
    for (const count of [0, 1, 2]) {
      const expected = `${count} more map${count === 1 ? "" : "s"} updated`;
      expect(new IntlMessageFormat(pluralize("{count} more maps updated", "en"), "en").format({ count })).toBe(expected);
      expect(catalog.format("en", "tilesetImport.resultLevels", { count })).toBe(expected);
    }
  });
});
