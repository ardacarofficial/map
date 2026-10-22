import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { utf8, utf8ByteLength } from "../src/tags";

describe("UTF-8 accounting", () => {
  it("matches the platform encoder for arbitrary UTF-16, including unpaired surrogates", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 512 }), units => {
      const text = String.fromCharCode(...units);
      const expected = new TextEncoder().encode(text);
      expect(utf8ByteLength(text)).toBe(expected.length);
      expect(utf8(text)).toEqual(expected);
    }), { numRuns: 1000 });
  });

  it.each(["", "ascii", "çığ水", "😀𐀀", "\ud800", "\udc00", "\ud800\ud800\udc00", "\udc00\ud800"])(
    "counts and encodes Unicode boundary cases %j", text => {
      const expected = new TextEncoder().encode(text);
      expect(utf8ByteLength(text)).toBe(expected.length);
      expect(utf8(text)).toEqual(expected);
    },
  );

  it("counts a response-sized mixed string without changing byte-budget semantics", () => {
    const text = "abcç水😀\ud800".repeat(512 * 1024);
    expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
  });
});
