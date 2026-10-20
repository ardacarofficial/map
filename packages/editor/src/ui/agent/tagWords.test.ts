import { describe, expect, it } from "vitest";
import { parseAiTagWords } from "./tagWords";
describe("manual AI tag validation", () => {
  it("allows explicit clearing and preserves free-form Unicode words", () => {
    expect(parseAiTagWords(" ")).toEqual([]);
    expect(parseAiTagWords(" orman, taş duvar ")).toEqual(["orman", "taş duvar"]);
  });
  it("rejects duplicate, empty, overlong and oversized tag lists before the command path", () => {
    for (const value of ["tree,tree", "tree,,wall", "x".repeat(49), Array.from({ length: 17 }, (_, i) => String(i)).join(",")]) expect(parseAiTagWords(value)).toBeNull();
    expect(parseAiTagWords("x".repeat(48))).toEqual(["x".repeat(48)]);
  });
});
