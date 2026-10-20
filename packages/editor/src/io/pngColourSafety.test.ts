import { expect, it } from 'vitest';
import { encode } from 'fast-png';
import { rasterContentHash } from '@smap/core';
import { MemoryFileSystem } from './memoryFs';
import { preparePngPatch } from './pngWriteback';
import { decodeSourcePng, decodeWorkingSourcePng } from './sourcePng';
import { pngChunk, pngChunks, withPngChunks } from './sourcePng.testHelper';
const source = { id: 's', name: 'Source', imagePath: 'tilesets/s.png', tileWidth: 1, tileHeight: 1, columns: 2, rows: 1, margin: 0, spacing: 0 };
async function patch(bytes: Uint8Array, color = [255, 255, 255, 255]) {
  const fs = new MemoryFileSystem(); await fs.writeBytes(source.imagePath, bytes);
  const before = decodeWorkingSourcePng(bytes).data.slice(0, 4);
  return preparePngPatch(fs, source, [{ tileId: 0, baseHash: rasterContentHash(1, 1, new Uint8Array(before)), pixels: { width: 1, height: 1, data: Uint8Array.from(color) } }]);
}
it('retains gamma and chromaticities byte-for-byte while keeping untouched raw samples', async () => {
  const gamma = pngChunk('gAMA', Uint8Array.of(0, 1, 134, 160));
  const chrm = new Uint8Array(32), v = new DataView(chrm.buffer);
  [31270,32900,64000,33000,30000,60000,15000,6000].forEach((n, i) => v.setUint32(i * 4, n));
  const bytes = withPngChunks(encode({ width: 2, height: 1, channels: 4, data: Uint8Array.of(128,128,128,255,128,128,128,255) }), gamma, pngChunk('cHRM', chrm));
  const plan = await patch(bytes);
  expect(pngChunks(plan.replacement).get('gAMA')).toEqual(gamma);
  expect(pngChunks(plan.replacement).get('cHRM')).toEqual(pngChunks(bytes).get('cHRM'));
  expect(decodeSourcePng(plan.replacement).data.slice(4)).toEqual(decodeSourcePng(bytes).data.slice(4));
  await expect(patch(bytes, [1,1,1,255])).rejects.toThrow('represent');
});
it.each([1, 2, 4, 8] as const)('preserves indexed depth %i, palette and transparency for representable edits', async depth => {
  const bytes = encode({ width: 2, height: 1, channels: 1, depth, palette: [[128,128,128,0],[255,255,255,255]], data: depth === 8 ? Uint8Array.of(0,1) : Uint8Array.of(1 << (8 - depth * 2)) });
  const plan = await patch(bytes);
  expect(plan.replacement[24]).toBe(depth); expect(plan.replacement[25]).toBe(3);
  for (const key of ['PLTE', 'tRNS']) expect(pngChunks(plan.replacement).get(key)).toEqual(pngChunks(bytes).get(key));
  expect(decodeSourcePng(plan.replacement).data.slice(4)).toEqual(decodeSourcePng(bytes).data.slice(4));
  await expect(patch(bytes, [12, 34, 56, 255])).rejects.toThrow('represent');
});
it('refuses unsupported ICC working-space conversion before any write', async () => {
  const bytes = withPngChunks(encode({ width: 2, height: 1, channels: 4, data: new Uint8Array(8).fill(255) }), pngChunk('iCCP', Uint8Array.of(112,0,0,120,156,99,0,0,0,1,0,1)));
  await expect(patch(bytes)).rejects.toThrow('profile');
});
it.each([1,2,4,8] as const)('preserves grayscale depth %i and rejects unrepresentable RGB', async depth => {
  const bytes = encode({width:2,height:1,channels:1,depth,data:depth===8?Uint8Array.of(0,255):Uint8Array.of(((1<<depth)-1)<<(8-depth*2))});
  const plan = await patch(bytes); expect(plan.replacement[24]).toBe(depth); expect(plan.replacement[25]).toBe(0);
  expect(decodeSourcePng(plan.replacement).data).toEqual(new Uint8Array(8).fill(255));
  await expect(patch(bytes,[255,0,0,255])).rejects.toThrow('represent');
});
it('retains sRGB and RGB tRNS without expanding the color type, and refuses an alpha collision', async () => {
  const bytes=withPngChunks(encode({width:2,height:1,channels:3,data:Uint8Array.of(0,0,0,128,128,128)}),pngChunk('sRGB',Uint8Array.of(0)),pngChunk('tRNS',Uint8Array.of(0,0,0,0,0,0)));
  const plan=await patch(bytes); expect(plan.replacement[25]).toBe(2);
  for(const key of ['sRGB','tRNS'])expect(pngChunks(plan.replacement).get(key)).toEqual(pngChunks(bytes).get(key));
  expect(decodeSourcePng(plan.replacement).data.slice(4)).toEqual(Uint8Array.of(128,128,128,255));
  await expect(patch(bytes,[0,0,0,255])).rejects.toThrow('represent');
});
