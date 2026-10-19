import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, MapStore } from '@smap/core';
import { PixelController } from './pixelController';
import type { ToolHost } from './toolController';
import { LevelWorkspace } from '../io/levelWorkspace';
import { useEditorStore } from '../state/editorStore';
import { usePixelUi } from '../state/pixelUi';
import { usePixelColors } from '../state/pixelColors';
import { getLevelWorkspace } from '../io/session';
import { toast } from '../ui/toast/toastStore';

vi.mock('../io/session', () => ({ getLevelWorkspace: vi.fn(), getProjectFolder: () => null, publishLevelState: vi.fn() }));
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
