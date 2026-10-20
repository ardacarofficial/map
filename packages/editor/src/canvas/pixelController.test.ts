import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, MapStore } from '@smap/core';
import { PixelController } from './pixelController';
import type { ToolHost } from './toolController';
import { LevelWorkspace } from '../io/levelWorkspace';
import { useEditorStore } from '../state/editorStore';
import { usePixelUi } from '../state/pixelUi';
import { usePixelColors } from '../state/pixelColors';
import { MemoryFileSystem } from '../io/memoryFs';
import { planPixelGesture, preparePixelCommit, type PixelGestureOptions } from './pixelEditing';
import { serializeLevel, cellPaletteIndex, WorldEditError } from '@smap/core';
import { getLevelWorkspace, getProjectFolder } from '../io/session';
import { toast } from '../ui/toast/toastStore';

vi.mock('../io/session', () => ({ getLevelWorkspace: vi.fn(), getProjectFolder: vi.fn(() => null), publishLevelState: vi.fn() }));
vi.mock('../ui/toast/toastStore', () => ({ toast: { error: vi.fn() } }));
vi.mock('../io/pixelAssetIo', () => ({ installPixelAssets: () => () => {}, readPixelSource: () => undefined }));
function setup() {
  const store = new MapStore(createDocument({ width: 4, height: 4, tileWidth: 16, tileHeight: 16 }));
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } }); store.clearHistory();
  const ws = new LevelWorkspace({ name: 'W', levels: [{ id: 'a', name: 'A', path: 'a.json', world: { x: 0, y: 0 } }], active: { id: 'a', store, knownText: null } });
  vi.mocked(getLevelWorkspace).mockReturnValue(ws);
  useEditorStore.getState().setProject({ name: 'W', levelPath: 'a.json', store }); useEditorStore.getState().setTool('brush');
  usePixelUi.setState({ mode: 'pixel', size: 1, scope: 'cell', pending: false, mirrorH: false, mirrorV: false }); usePixelColors.getState().reset();
  const preview = vi.fn(), blocked = vi.fn();
  const host = { scene: { store, setPixelPreview: preview }, toLocal: (p: { clientX: number; clientY: number }) => ({ x: p.clientX, y: p.clientY }), camera: { camera: { x: 0, y: 0, zoom: 1 }, resolution: 1 }, capture: vi.fn(), release: vi.fn(), requestRender: vi.fn(), blocked } as unknown as ToolHost;
  const controller = new PixelController(host);
  return { store, layerId, ws, controller, preview, blocked };
}
const pointer = (x: number, y: number, button = 0) => ({ clientX: x, clientY: y, pointerId: 1, button, buttons: 1, preventDefault() {}, altKey: false, shiftKey: false }) as PointerEvent;
beforeEach(() => vi.clearAllMocks());
describe('pixel pointer lifecycle', () => {
  it('buffers coalesced geometry, previews without mutations, then commits one stroke', () => {
    const { store, controller, ws, preview } = setup();
    controller.down(pointer(1, 1)); controller.move(pointer(4, 1)); controller.flush();
    expect(preview).toHaveBeenCalled(); expect(store.document.tilesets).toHaveLength(0); expect(store.inTransaction).toBe(false);
    controller.up(pointer(4, 1)); expect(ws.history.undoDepth).toBe(1); expect(controller.busy).toBe(false);
    const tile = store.rasterAssets.getTile('edited-16x16-1', 0)!;
    expect([...tile.data.slice((16 + 2) * 4, (16 + 2) * 4 + 4)]).toEqual([0, 0, 0, 255]);
    controller.destroy();
  });
  it('mode change and cancellation discard the preview and never leak a transaction', () => {
    const { store, controller, ws } = setup(); controller.down(pointer(1, 1)); controller.flush();
    usePixelUi.getState().setMode('tile'); expect(controller.busy).toBe(false); expect(ws.history.undoDepth).toBe(0); expect(store.inTransaction).toBe(false); expect(store.document.tilesets).toHaveLength(0); controller.destroy();
  });
  it('refuses locked/hidden layers with existing feedback and paints background on right press', () => {
    const { store, layerId, controller, blocked } = setup();
    store.dispatch({ type: 'setLayerProps', layerId, props: { locked: true } }); controller.down(pointer(1, 1)); expect(blocked).toHaveBeenLastCalledWith({ layerId, reason: 'locked' });
    store.dispatch({ type: 'setLayerProps', layerId, props: { locked: false, visible: false } }); controller.down(pointer(1, 1)); expect(blocked).toHaveBeenLastCalledWith({ layerId, reason: 'hidden' });
    store.dispatch({ type: 'setLayerProps', layerId, props: { visible: true } }); useEditorStore.getState().setTool('eraser'); controller.down(pointer(1, 1, 2)); controller.up(pointer(1, 1, 2));
    expect([...store.rasterAssets.getTile('edited-16x16-1', 0)!.data.slice(17 * 4, 18 * 4)]).toEqual([255, 255, 255, 255]); controller.destroy();
  });
});

it('lists every map whose preload failed and leaves no edit pending', async () => {
  const { ws, controller } = setup();
  ws.add({ name: 'Unreadable B', width: 4, height: 4, tileSize: 16, layerName: 'Ground' });
  vi.spyOn(ws, 'load').mockRejectedValue(new Error('unreadable'));
  await controller.warm();
  expect(toast.error).toHaveBeenLastCalledWith(expect.stringContaining('Unreadable B'));
  expect(toast.error).toHaveBeenLastCalledWith(expect.stringContaining('A:'));
  expect(usePixelUi.getState().pending).toBe(false); expect(ws.history.undoDepth).toBe(0);
  controller.destroy();
});

it('drags the mirror origin without paint; cancel restores the original origin', () => {
  const { controller, store, ws } = setup(); usePixelUi.setState({ mirrorH: true, mirrorV: true });
  controller.down(pointer(31, 31)); controller.move(pointer(12, 18)); controller.up(pointer(12, 18));
  expect(usePixelUi.getState().mirrorOrigins.get(store)).toEqual({ x: 12, y: 18 });
  expect(ws.history.undoDepth).toBe(0);
  controller.down(pointer(12, 18)); controller.move(pointer(20, 20)); controller.cancel();
  expect(usePixelUi.getState().mirrorOrigins.get(store)).toEqual({ x: 12, y: 18 });
  controller.destroy();
});
it('loads and pins a disk-only world participant before the real commit path, with atomic undo/redo', async () => {
 const {store,layerId,ws,controller}=setup(), fs=new MemoryFileSystem();
 const ts={id:'source',name:'Source',imagePath:'tilesets/source.png',tileWidth:16,tileHeight:16,columns:1,rows:1,margin:0,spacing:0};
 store.dispatch({type:'addTileset',tileset:ts});
 store.dispatch({type:'paintCells',layerId,cells:[{x:0,y:0,cell:store.getOrAddPaletteIndex(ts.id,0)}]});
 const source=()=>({width:16,height:16,data:new Uint8Array(16*16*4).fill(255),revision:0});
 const options:PixelGestureOptions={tool:'brush',color:{r:255,g:0,b:0,a:255},size:1,shape:'square',scope:'world',fillMode:'contiguous',filled:false,mirrorH:false,mirrorV:false};
 const b=ws.add({name:'B',width:4,height:4,tileSize:16,layerName:'Ground'}), other=ws.entry(b.id)!.store, bLayer=other.document.layers[0]!.id;
 other.dispatch({type:'paintCells',layerId:bLayer,cells:[{x:2,y:0,cell:other.getOrAddPaletteIndex('source',0)}]});
 store.clearHistory();other.clearHistory();ws.history.reset();
 await ws.save(fs,{tilesetBytes:()=>new Uint8Array([1])});
 await ws.activate(b.id,fs);await ws.activate('a',fs);expect(ws.entry(b.id)).toBeUndefined();
 const plans=planPixelGesture(ws.active.store,layerId,[{x:1,y:1}],options,source);
 expect(()=>preparePixelCommit(ws,layerId,plans,'world',source)).toThrow(WorldEditError);
 vi.mocked(getProjectFolder).mockReturnValue({fs,ref:'world',label:'world'});
 await controller.warm();
 expect(usePixelUi.getState().pending).toBe(false);
 expect(ws.entry(b.id)).toBeDefined();
 for(const map of ws.levels)expect(ws.entry(map.id)!.store.inTransaction).toBe(false);
 const before=ws.levels.map(m=>serializeLevel(ws.entry(m.id)!.store.document));
 preparePixelCommit(ws,layerId,plans,'world',source)();
 expect(ws.history.undoDepth).toBe(1);expect(ws.history.peekUndo()!.participants).toHaveLength(2);
 const cell=ws.entry(b.id)!.store.document.getLayer(bLayer)!.getCell(2,0), ref=ws.entry(b.id)!.store.document.palette.get(cellPaletteIndex(cell))!;
 expect(ref.tilesetId).toBe('edited-16x16-1');
 const after=ws.levels.map(m=>serializeLevel(ws.entry(m.id)!.store.document));
 ws.history.undo();expect(ws.levels.map(m=>serializeLevel(ws.entry(m.id)!.store.document))).toEqual(before);
 ws.history.redo();expect(ws.levels.map(m=>serializeLevel(ws.entry(m.id)!.store.document))).toEqual(after);
 await ws.activate(b.id,fs);expect(ws.entry('a')).toBeDefined();
 controller.destroy();
});

it('previews a unique edited slot on a dense 512×512 map without scanning map chunks', async () => {
  const { store, layerId, controller, preview } = setup();
  store.dispatch({ type: 'resizeMap', width: 512, height: 512 });
  store.dispatch({ type: 'addTileset', tileset: { id: 'source', name: 'Source', imagePath: 'tilesets/source.png', tileWidth: 16, tileHeight: 16, columns: 1, rows: 1, margin: 0, spacing: 0 } });
  const pi = store.getOrAddPaletteIndex('source', 0), cells = [];
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) cells.push({ x, y, cell: pi });
  store.dispatch({ type: 'paintCells', layerId, cells });
  const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 16, tileHeight: 16, pixels: new Uint8Array(16 * 16 * 4).fill(255) });
  store.dispatch({ type: 'remapCells', layerId, cells: [{ x: 1, y: 1 }], tilesetId: slot.assetId, tileId: slot.tileId });
  await controller.warm();
  const chunks = vi.spyOn(store.document.getLayer(layerId)!, 'chunks');
  controller.down(pointer(17, 17)); controller.flush();
  controller.move(pointer(18, 17)); controller.flush();
  expect(chunks).not.toHaveBeenCalled();
  expect(preview.mock.lastCall?.[1][0].previewAsset).toEqual({ assetId: slot.assetId, tileId: slot.tileId });
  controller.up(pointer(18, 17));
  expect(chunks).not.toHaveBeenCalled();
  controller.destroy();
}, 15_000);
