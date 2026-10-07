import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeBase64, decodeUint32LE, encodeBase64, encodeUint32LE } from "../src";

describe("base64", () => {
  it("matches RFC 4648 test vectors", () => {
    const vectors: [string, string][] = [
      ["", ""], ["f", "Zg=="], ["fo", "Zm8="], ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="], ["fooba", "Zm9vYmE="], ["foobar", "Zm9vYmFy"],
    ];
    for (const [plain, encoded] of vectors) {
      const bytes = Uint8Array.from(plain, (c) => c.charCodeAt(0));
      expect(encodeBase64(bytes)).toBe(encoded);
      expect(decodeBase64(encoded)).toEqual(bytes);
    }
  });

  it("roundtrips arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
      }),
    );
  });

  it("rejects malformed input", () => {
    for (const bad of ["Zg=", "Zg", "Z===", "Zh==", "Zm9=", "Zm 9v", "Zm9v\n", "=Zm9", "Zm=v", "Zm9-"]) {
      expect(() => decodeBase64(bad), bad).toThrow(SyntaxError);
    }
  });

  it("encodes uint32 little-endian", () => {
    expect(encodeUint32LE(Uint32Array.of(0x04030201))).toBe(encodeBase64(Uint8Array.of(1, 2, 3, 4)));
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 0xffffffff }), { maxLength: 50 }), (values) => {
        const arr = Uint32Array.from(values);
        expect(decodeUint32LE(encodeUint32LE(arr))).toEqual(arr);
      }),
    );
  });
});
