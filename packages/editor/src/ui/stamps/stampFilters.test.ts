import type { Stamp } from "@smap/core";
import { describe, expect, it } from "vitest";

import { filterStamps, foldText, matchesStamp, NO_FILTER, parseTags, pruneFilter, stampCategories, stampTags } from "./stampFilters";

function stamp(id: string, name: string, meta: { category?: string; tags?: string[]; favorite?: boolean } = {}): Stamp {
  return { id, name, width: 1, height: 1, palette: [], layers: [], ...meta } as Stamp;
}

const library = [
  stamp("ev", "Köy Evi", { category: "Binalar", tags: ["köy", "ahşap"], favorite: true }),
  stamp("kule", "Gözcü Kulesi", { category: "Binalar", tags: ["taş"] }),
  stamp("agac", "Çam Ağaçları", { category: "Doğa", tags: ["orman"] }),
  stamp("kuyu", "Kuyu"),
];

describe("stamp library filters", () => {
  it("folds Turkish letters and case for matching", () => {
    expect(foldText("ÇATI Işık Göl")).toBe("cati isik gol");
  });

  it("searches name, category and tags; every word must match", () => {
    const ids = (query: string) => filterStamps(library, { ...NO_FILTER, query }).map((s) => s.id);
    expect(ids("")).toEqual(["ev", "kule", "agac", "kuyu"]);
    expect(ids("koy")).toEqual(["ev"]); // "Köy" in name and tag
    expect(ids("binalar")).toEqual(["ev", "kule"]);
    expect(ids("ORMAN")).toEqual(["agac"]);
    expect(ids("bina tas")).toEqual(["kule"]);
    expect(ids("xyz")).toEqual([]);
  });

  it("combines category, tag and favourites", () => {
    expect(matchesStamp(library[0]!, { ...NO_FILTER, category: "Binalar", tag: "köy", favoritesOnly: true })).toBe(true);
    expect(filterStamps(library, { ...NO_FILTER, category: "Binalar" }).map((s) => s.id)).toEqual(["ev", "kule"]);
    expect(filterStamps(library, { ...NO_FILTER, favoritesOnly: true }).map((s) => s.id)).toEqual(["ev"]);
    expect(filterStamps(library, { ...NO_FILTER, tag: "taş" }).map((s) => s.id)).toEqual(["kule"]);
    expect(filterStamps(library, { ...NO_FILTER, category: "Doğa", tag: "taş" })).toEqual([]);
  });

  it("counts categories and tags by name (uncategorized not listed)", () => {
    expect(stampCategories(library)).toEqual([
      { name: "Binalar", count: 2 },
      { name: "Doğa", count: 1 },
    ]);
    expect(stampTags(library).map((t) => t.name)).toEqual(["ahşap", "köy", "orman", "taş"]);
  });

  it("drops chips that no stamp has any more", () => {
    const filter = { query: "ev", category: "Doğa", tag: "köy", favoritesOnly: true };
    expect(pruneFilter(filter, library)).toBe(filter);
    const rest = library.filter((s) => s.id !== "ev" && s.id !== "agac");
    expect(pruneFilter(filter, rest)).toEqual({ query: "ev", category: null, tag: null, favoritesOnly: false });
  });

  it("parses a tags field", () => {
    expect(parseTags(" orman, ev ,, köy, ev ")).toEqual(["orman", "ev", "köy"]);
    expect(parseTags("  ")).toEqual([]);
  });
});
