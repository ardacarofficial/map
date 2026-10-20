import { beforeEach, expect, it, vi } from 'vitest';
import { createDocument, MapStore, parseColorPalette, serializeProject, parseProject } from '@smap/core';
import { LevelWorkspace } from './levelWorkspace';
import { useProjectLibrary } from './projectLibrary';
import { useColorPanel } from '../state/colorPanel';
import { getLevelWorkspace } from './session';
import { getPlatform } from '../platform';
import { deliverFile } from '../export/exportActions';
import { editColorPalette, loadColorPalette, saveColorPalette } from './colorPaletteIo';
import { toast } from '../ui/toast/toastStore';
vi.mock('./session', () => ({ getLevelWorkspace: vi.fn() }));
vi.mock('../platform', () => ({ getPlatform: vi.fn() }));
vi.mock('../export/exportActions', () => ({ deliverFile: vi.fn() }));
vi.mock('../ui/toast/toastStore', () => ({ toast: { error: vi.fn() } }));
vi.mock('./pixelAssetIo', () => ({ installPixelAssets: () => () => {} }));
function workspace() { return new LevelWorkspace({ name: 'W', levels: [{ id: 'a', name: 'A', path: 'levels/a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store: new MapStore(createDocument({ width: 2, height: 2 })), knownText: null } }); }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getLevelWorkspace).mockReturnValue(workspace()); useProjectLibrary.getState().load({ colorPalettes: [], stamps: [], levels: [] }); useColorPanel.setState({ palette: 0 }); });
it('publishes project ops on apply/undo/redo and saves/loads the exact platform file', async () => {
  const ws = getLevelWorkspace()!;
  editColorPalette({ type: 'add', palette: { name: 'Sea', colors: ['#12345678', '#abcdefef'] } });
  const expected = useProjectLibrary.getState().colorPalettes;
  ws.history.undo(); expect(useProjectLibrary.getState().colorPalettes).toEqual([]); ws.history.redo(); expect(useProjectLibrary.getState().colorPalettes).toEqual(expected);
  await saveColorPalette(); const [blob, name, filter] = vi.mocked(deliverFile).mock.calls[0]!;
  expect(name).toBe('Sea.smap-colors.json'); expect(filter.extensions).toEqual(['smap-colors.json']);
  const text = await blob.text(); expect(parseColorPalette(text)).toEqual(expected[0]);
  vi.mocked(getPlatform).mockReturnValue({ openFile: async () => ({ name, bytes: new TextEncoder().encode(text) }) } as unknown as ReturnType<typeof getPlatform>);
  await loadColorPalette(); expect(useProjectLibrary.getState().colorPalettes).toEqual([...expected, ...expected]);
  const encoded = serializeProject({ name: 'W', levels: ws.levels, tilesets: [], colorPalettes: useProjectLibrary.getState().colorPalettes });
  expect(parseProject(encoded).colorPalettes).toEqual([...expected, ...expected]);
});
it('cancel, corrupt file and world changes while the dialog is open leave the world untouched', async () => {
  const before = useProjectLibrary.getState().revision;
  vi.mocked(getPlatform).mockReturnValue({ openFile: async () => null } as unknown as ReturnType<typeof getPlatform>);
  await loadColorPalette(); expect(toast.error).not.toHaveBeenCalled();
  vi.mocked(getPlatform).mockReturnValue({ openFile: async () => ({ name: 'bad', bytes: new TextEncoder().encode('{') }) } as unknown as ReturnType<typeof getPlatform>);
  await loadColorPalette(); expect(toast.error).toHaveBeenCalledOnce();
  vi.mocked(getPlatform).mockReturnValue({ openFile: async () => { vi.mocked(getLevelWorkspace).mockReturnValue(workspace()); return { name: 'old', bytes: new TextEncoder().encode('{"version":1,"name":"Old","colors":[]}') }; } } as unknown as ReturnType<typeof getPlatform>);
  await loadColorPalette(); expect(useProjectLibrary.getState().colorPalettes).toEqual([]); expect(useProjectLibrary.getState().revision).toBe(before);
});
