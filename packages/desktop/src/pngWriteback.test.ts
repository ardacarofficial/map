import { beforeEach, expect, it, vi } from 'vitest';
const invoke=vi.hoisted(()=>vi.fn(async()=>{}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@smap/editor',async()=>await import('../../editor/src/io/fs'));
import { DesktopFsError, TauriFileSystem } from './tauriFileSystem';
beforeEach(()=>invoke.mockReset());
it('sends guarded PNG replacement as exact raw bytes and scoped encoded paths',async()=>{
  const fs=new TauriFileSystem('C:/Dünya');
  await fs.replacePngGuarded({path:'tilesets/çim.png',backupPath:'backups/png/original.png',expected:Uint8Array.of(0,1,255),replacement:Uint8Array.of(7,9)});
  expect(invoke).toHaveBeenCalledExactlyOnceWith('replace_png_guarded',Uint8Array.of(0,1,255,7,9),{headers:{'x-smap-path':encodeURIComponent('C:/Dünya/tilesets/çim.png'),'x-smap-backup':encodeURIComponent('C:/Dünya/backups/png/original.png'),'x-smap-expected-length':'3'}});
});
it('preserves native CAS conflict classification for the new confirmation flow',async()=>{
  invoke.mockRejectedValueOnce({kind:'Changed',path:'tilesets/a.png',message:'PNG changed'});
  const request={path:'tilesets/a.png',backupPath:'backups/png/a.png',expected:Uint8Array.of(1),replacement:Uint8Array.of(2)};
  const error=await new TauriFileSystem('/world').replacePngGuarded(request).catch(e=>e);
  expect(error).toBeInstanceOf(DesktopFsError);expect(error.kind).toBe('Changed');
});
