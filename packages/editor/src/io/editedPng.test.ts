import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encodeRgbaPng } from '@smap/core';
import { decodeEditedPng } from './editedPng';
describe('authoritative edited PNG decoding', () => {
  it('retains exact straight RGB at every alpha and validates checksums', () => {
    fc.assert(fc.property(fc.uint8Array({ minLength: 1024, maxLength: 1024 }), data => {
      for (let p = 0; p < data.length; p += 4) if (!data[p + 3]) data.fill(0, p, p + 3);
      const png = encodeRgbaPng(16, 16, data);
      expect(decodeEditedPng(png).data).toEqual(data);
      png[45] = png[45]! ^ 1; expect(() => decodeEditedPng(png)).toThrow();
    }), { numRuns: 30 });
  });
  it('decodes multiple stored blocks without accepting trailing data', () => {
    const data = new Uint8Array(256 * 256 * 4).fill(123), png = encodeRgbaPng(256, 256, data);
    expect(decodeEditedPng(png).data).toEqual(data);
    expect(() => decodeEditedPng(new Uint8Array([...png, 0]))).toThrow();
  });
});
