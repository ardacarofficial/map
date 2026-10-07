import { describe, expect, it } from "vitest";

import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches in-order subsequences, case-insensitively", () => {
    expect(fuzzyMatch("kyd", "Dosya: Kaydet")).not.toBeNull();
    expect(fuzzyMatch("dyk", "Dosya: Kaydet")?.indices).toBeDefined();
    expect(fuzzyMatch("xyz", "Dosya: Kaydet")).toBeNull();
  });

  it("folds Turkish letters", () => {
    expect(fuzzyMatch("izgara", "Görünüm: Izgarayı aç/kapa")).not.toBeNull();
    expect(fuzzyMatch("gorunum", "Görünüm: Yakınlaştır")).not.toBeNull();
    expect(fuzzyMatch("yakinlastir", "Görünüm: Yakınlaştır")).not.toBeNull();
  });

  it("returns matched indices for highlighting", () => {
    expect(fuzzyMatch("kay", "Kaydet")?.indices).toEqual([0, 1, 2]);
  });
});

describe("fuzzyFilter", () => {
  const items = ["Dosya: Kaydet", "Dosya: Farklı kaydet…", "Araç: Kalem", "Görünüm: Uzaklaştır"];

  it("keeps order for an empty query", () => {
    expect(fuzzyFilter(items, "", (s) => s).map((r) => r.item)).toEqual(items);
  });

  it("ranks word-start and consecutive matches first", () => {
    const ranked = fuzzyFilter(items, "kaydet", (s) => s).map((r) => r.item);
    expect(ranked).toEqual(["Dosya: Kaydet", "Dosya: Farklı kaydet…"]);
    expect(fuzzyFilter(items, "kal", (s) => s)[0]?.item).toBe("Araç: Kalem");
  });
});
