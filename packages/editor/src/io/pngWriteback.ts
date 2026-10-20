import { rasterContentHash, tileRect, type RgbaImage, type Tileset } from '@smap/core';
import { pixelSourceGrid } from '../state/pixelProvenance';
import { FileNotFoundError, type ProjectFileSystem, type GuardedPngRequest } from './fs';
import { decodeSourcePng, encodeSourcePng } from './sourcePng';

export class PngChangedError extends Error { constructor() { super('PNG changed'); } }
export function equalPngBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v,i)=>v===b[i]); }
export function assertPngPaths(path: string, backupPath: string): void {
  if (!/^tilesets\/(?:[^/]+\/)*[^/]+\.png$/i.test(path) || !/^backups\/png\/[^/]+\.png$/.test(backupPath) || [path,backupPath].some(p=>p.split('/').some(s=>s==='.'||s==='..'||s.includes('\\')||s.includes('\0')))) throw Error('Invalid PNG path');
}
export function pngBackupPrefix(path: string): string { return `${encodeURIComponent(path)}--`; }
export function pngBackupPath(path: string): string { return `backups/png/${pngBackupPrefix(path)}${Date.now()}-${crypto.randomUUID()}.png`; }
export async function listPngBackups(fs: ProjectFileSystem, path: string): Promise<string[]> {
  return (await fs.list('backups/png')).filter(n=>n.startsWith(pngBackupPrefix(path))&&n.endsWith('.png')).sort().reverse().map(n=>`backups/png/${n}`);
}
/** Browser/test adapter. FSA createWritable commits atomically on close. Caller holds the project write gate. */
export async function guardedPngReplace(fs: ProjectFileSystem, request: GuardedPngRequest): Promise<void> {
  assertPngPaths(request.path, request.backupPath);
  if (fs.replacePngGuarded) return fs.replacePngGuarded(request);
  return browserPngReplace(fs, request);
}
export async function browserPngReplace(fs: ProjectFileSystem, request: GuardedPngRequest, commit = () => fs.writeBytes(request.path, request.replacement)): Promise<void> {
  const { path, backupPath, expected } = request;
  assertPngPaths(path, backupPath);
  const check = async () => { if (!equalPngBytes(await fs.readBytes(path), expected)) throw new PngChangedError(); };
  await check();
  try { await fs.readBytes(backupPath); throw Error('Backup already exists'); } catch (error) { if (!(error instanceof FileNotFoundError)) throw error; }
  await fs.writeBytes(backupPath, expected);
  if (!equalPngBytes(await fs.readBytes(backupPath), expected)) throw Error('Backup verification failed');
  await check();
  await commit();
}
export interface PngTilePatch { readonly tileId: number; readonly baseHash: string; readonly pixels: RgbaImage }
export interface PngPatchPlan extends GuardedPngRequest { readonly source: Tileset }
export async function preparePngPatch(fs: ProjectFileSystem, source: Tileset, patches: readonly PngTilePatch[], encode = encodeSourcePng): Promise<PngPatchPlan> {
  assertPngPaths(source.imagePath, pngBackupPath(source.imagePath));
  const expected = await fs.readBytes(source.imagePath), image = decodeSourcePng(expected);
  if (Math.floor((image.width-source.margin*2+source.spacing)/(source.tileWidth+source.spacing))!==source.columns || Math.floor((image.height-source.margin*2+source.spacing)/(source.tileHeight+source.spacing))!==source.rows) throw Error('PNG grid changed');
  const data = new Uint8Array(image.data), seen=new Set<number>();
  if (!patches.length) throw Error('No patches');
  for(const patch of patches) {
    if(seen.has(patch.tileId)) throw Error('Explicit variant choice required'); seen.add(patch.tileId);
    if(!Number.isInteger(patch.tileId)||patch.tileId<0||patch.tileId>=source.columns*source.rows) throw Error('Invalid tile');
    const rect=tileRect(source,patch.tileId), pixels=patch.pixels;
    if(pixels.width!==rect.width||pixels.height!==rect.height||pixels.data.length!==rect.width*rect.height*4) throw Error('PNG tile size mismatch');
    const before=new Uint8Array(rect.width*rect.height*4);
    for(let y=0;y<rect.height;y++) { const p=((rect.y+y)*image.width+rect.x)*4; before.set(data.subarray(p,p+rect.width*4),y*rect.width*4); }
    const [hash,grid]=patch.baseHash.split('|');
    if(hash!==rasterContentHash(rect.width,rect.height,before) || (grid && grid!==pixelSourceGrid(source))) throw new PngChangedError();
    for(let y=0;y<rect.height;y++) for(let x=0;x<rect.width;x++) {
      const from=(y*rect.width+x)*4,to=((rect.y+y)*image.width+rect.x+x)*4;
      // Core canonicalizes invisible RGB. An unchanged transparent pixel must
      // retain its original hidden channels, including inside the selected tile.
      if(!pixels.data[from+3]&&!data[to+3])continue;
      for(let c=0;c<4;c++)data[to+c]=pixels.data[from+c]!;
    }
  }
  const replacement=encode({width:image.width,height:image.height,data});
  // Verify the encoder before any filesystem mutation, including exact untouched RGBA.
  const decoded=decodeSourcePng(replacement);
  if(decoded.width!==image.width||decoded.height!==image.height||!equalPngBytes(new Uint8Array(decoded.data),data)) throw Error('PNG encode verification failed');
  return { source, path:source.imagePath,backupPath:pngBackupPath(source.imagePath),expected,replacement };
}
export async function applyPngPatch(fs: ProjectFileSystem, plan: PngPatchPlan): Promise<void> { await guardedPngReplace(fs,plan); }
export async function restorePngBackup(fs: ProjectFileSystem, path:string, backup:string, expected:Uint8Array, backupPath:string, replacement?:Uint8Array): Promise<void> {
  if (!(await listPngBackups(fs,path)).includes(backup)) throw Error('Invalid backup');
  const bytes=await fs.readBytes(backup); decodeSourcePng(bytes);
  if(replacement&&!equalPngBytes(bytes,replacement)) throw new PngChangedError();
  await guardedPngReplace(fs,{path,backupPath,expected,replacement:bytes});
}
