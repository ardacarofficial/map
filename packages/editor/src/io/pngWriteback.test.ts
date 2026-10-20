import { describe, expect, it, vi } from 'vitest';
import { encode } from 'fast-png';
import { rasterContentHash, type Tileset } from '@smap/core';
import { MemoryFileSystem } from './memoryFs';
import { applyPngPatch, preparePngPatch, restorePngBackup, pngBackupPath, listPngBackups } from './pngWriteback';
import { decodeSourcePng } from './sourcePng';

const source: Tileset = { id: 's', name: 'Source', imagePath: 'tilesets/a.png', tileWidth: 2, tileHeight: 2, columns: 2, rows: 1, margin: 1, spacing: 1 };
async function fixture() {
  const fs = new MemoryFileSystem();
  const data = new Uint8Array(7 * 4 * 4).fill(127);
  for (let i = 3; i < data.length; i += 4) data[i] = i % 3 ? 255 : 0;
  const original = encode({ width: 7, height: 4, channels: 4, depth: 8, data });
  await fs.writeBytes(source.imagePath, original);
  const before = new Uint8Array(16);
  for (let y = 0; y < 2; y++) before.set(data.subarray(((y+1)*7+1)*4, ((y+1)*7+3)*4), y*8);
  const after = new Uint8Array(16).fill(255); after[0] = 12;
  const patch = { tileId: 0, baseHash: rasterContentHash(2, 2, before), pixels: { width: 2, height: 2, data: after } };
  return { fs, original, data, patch, after };
}
describe('guarded PNG write-back adapter', () => {
  it('backs up exact encoded bytes, changes only the selected rectangle including hidden RGB, and restores exactly', async () => {
    const { fs, original, data, patch, after } = await fixture();
    const plan = await preparePngPatch(fs, source, [patch]);
    await applyPngPatch(fs, plan);
    expect(await fs.readBytes(plan.backupPath)).toEqual(original);
    const expected = data.slice();
    for (let y = 0; y < 2; y++) expected.set(after.subarray(y*8,y*8+8), ((y+1)*7+1)*4);
    expect(decodeSourcePng(await fs.readBytes(source.imagePath)).data).toEqual(expected);
    expect(await listPngBackups(fs, source.imagePath)).toEqual([plan.backupPath]);
    const current = await fs.readBytes(source.imagePath);
    const restoreBackup = pngBackupPath(source.imagePath);
    await restorePngBackup(fs, source.imagePath, plan.backupPath, current, restoreBackup);
    expect(await fs.readBytes(source.imagePath)).toEqual(original);
    expect(await fs.readBytes(restoreBackup)).toEqual(current);
  });
  it('rejects an external change at preparation and a race after confirmation', async () => {
    const { fs, patch } = await fixture();
    await expect(preparePngPatch(fs, source, [{ ...patch, baseHash: 'old' }])).rejects.toThrow('changed');
    const plan = await preparePngPatch(fs, source, [patch]);
    const external = Uint8Array.of(9); await fs.writeBytes(source.imagePath, external);
    await expect(applyPngPatch(fs, plan)).rejects.toThrow('changed');
    expect(await fs.readBytes(source.imagePath)).toEqual(external);
    expect(await fs.list('backups/png')).toEqual([]);
  });
  it('rejects conflicting variants, source grid changes and wrong-sized composites', async () => {
    const { fs, patch } = await fixture();
    await expect(preparePngPatch(fs, source, [patch, patch])).rejects.toThrow('choice');
    await expect(preparePngPatch(fs, { ...source, columns: 3 }, [patch])).rejects.toThrow('grid');
    await expect(preparePngPatch(fs, source, [{ ...patch, pixels: { ...patch.pixels, width: 3 } }])).rejects.toThrow('size');
  });
  it('writes nothing on encoding failure', async () => {
    const { fs, original, patch } = await fixture();
    await expect(preparePngPatch(fs, source, [patch], () => { throw Error('encode'); })).rejects.toThrow('encode');
    expect(await fs.readBytes(source.imagePath)).toEqual(original); expect(await fs.list('backups/png')).toEqual([]);
  });
  it.each(['permission', 'corrupt'])('never replaces the source when the backup fails: %s', async mode => {
    const { fs, original, patch } = await fixture(); const plan = await preparePngPatch(fs, source, [patch]);
    const write = fs.writeBytes.bind(fs);
    vi.spyOn(fs, 'writeBytes').mockImplementation(async (path, bytes) => {
      if (path.startsWith('backups/png/')) { if (mode === 'permission') throw Error('permission'); return write(path, Uint8Array.of(1)); }
      return write(path, bytes);
    });
    await expect(applyPngPatch(fs, plan)).rejects.toThrow();
    expect(await fs.readBytes(source.imagePath)).toEqual(original);
  });
  it('rechecks after backup verification and keeps both backup and external bytes on a disk race', async () => {
    const { fs, original, patch } = await fixture(); const plan = await preparePngPatch(fs, source, [patch]);
    const read = fs.readBytes.bind(fs); const external = Uint8Array.of(42);
    vi.spyOn(fs, 'readBytes').mockImplementation(async path => { const bytes = await read(path); if (path === plan.backupPath) fs.files.set(source.imagePath, external); return bytes; });
    await expect(applyPngPatch(fs, plan)).rejects.toThrow('changed');
    expect(await read(source.imagePath)).toEqual(external); expect(await read(plan.backupPath)).toEqual(original);
  });
});

it('preserves invisible RGB in untouched pixels inside the selected tile too',async()=>{
  const {fs,original,data,patch}=await fixture();const pixels=new Uint8Array(16);
  for(let y=0;y<2;y++)pixels.set(data.subarray(((y+1)*7+1)*4,((y+1)*7+3)*4),y*8);
  for(let p=0;p<pixels.length;p+=4)if(!pixels[p+3])pixels.fill(0,p,p+3);
  pixels.set([12,34,56,255]);const plan=await preparePngPatch(fs,source,[{...patch,pixels:{width:2,height:2,data:pixels}}]);await applyPngPatch(fs,plan);
  const expected=decodeSourcePng(original).data.slice();expected.set([12,34,56,255],(1*7+1)*4);
  expect(decodeSourcePng(await fs.readBytes(source.imagePath)).data).toEqual(expected);
});
