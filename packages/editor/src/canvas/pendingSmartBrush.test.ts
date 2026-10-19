import { afterEach, expect, it, vi } from "vitest";
import { clipFromTileset, createDocument, MapStore, serializeLevel, type Tileset } from "@smap/core";
import type * as BakeModule from "../ui/stamps/smartStampBake";
import { bakeSmartStamp } from "../ui/stamps/smartStampBake";
import { prepareSelectionBrush, waitForSelectionBrush } from "../commands/smartBrushActions";
import { useEditorStore } from "../state/editorStore";
import { clearTilesetImages, setTilesetImage } from "../state/tilesetImages";
import { useToastStore } from "../ui/toast/toastStore";
import { ToolController, type ToolHost } from "./toolController";

vi.mock("../state/tilesetPixels", () => ({ tilesetPixels: () => ({ width: 96, height: 96, data: new Uint8Array(96 * 96 * 4).fill(255) }) }));
vi.mock("../ui/stamps/smartStampBake", async original => ({ ...await original<typeof BakeModule>(), bakeSmartStamp: vi.fn() }));
const source: Tileset = { id: "source", name: "Source", imagePath: "source.png", columns: 3, rows: 3, tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 };
const event = (x: number, y: number, buttons = 1, samples?: PointerEvent[]) => ({ pointerId: 1, button: 0, buttons, clientX: x, clientY: y, shiftKey: false, altKey: false, preventDefault() {}, getCoalescedEvents: () => samples ?? [] }) as unknown as PointerEvent;
function setup(tool: "brush" | "rect" = "brush") {
  let resolve!: (image: Awaited<ReturnType<typeof bakeSmartStamp>>) => void;
  let reject!: (error: Error) => void;
  vi.mocked(bakeSmartStamp).mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const store = new MapStore(createDocument({ width: 20, height: 20, tilesets: [source] }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } }); store.clearHistory();
  const editor = useEditorStore.getState();
  editor.setProject({ store, name: "Test", levelPath: "main.json" }); editor.setActiveLayer(layerId); editor.setTool(tool);
  editor.setBrushSize(1);
  setTilesetImage({ tilesetId: source.id, bytes: Uint8Array.of(1), bitmap: { close() {} } as ImageBitmap });
  const clip = clipFromTileset(source, { x: 0, y: 0, w: 3, h: 3 }, { layerId })!;
  prepareSelectionBrush(source, Array.from({ length: 9 }, (_, i) => i), new Set(), clip); editor.setStamp(clip);
  let point = { x: 4, y: 4 };
  const host = { scene: { store }, camera: { cellAt: (p: unknown) => p }, toLocal: (e: PointerEvent) => ({ x: e.clientX, y: e.clientY }), pointerCell: () => point, capture: vi.fn(), release: vi.fn(), requestRender: vi.fn(), blocked: vi.fn() } as unknown as ToolHost;
  const controller = new ToolController(host);
  const move = (x: number, y: number, samples?: PointerEvent[]) => { point = { x, y }; controller.pointerMove(event(x, y, 1, samples)); };
  const up = (x = point.x, y = point.y) => { point = { x, y }; controller.pointerUp(event(x, y, 0)); };
  const ready = async (fail = false) => {
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (fail) reject(new Error("PNG encoding failed"));
    else resolve({ tilesetId: "bank", bytes: Uint8Array.of(1), bitmap: { close() {} } as ImageBitmap });
    await waitForSelectionBrush(clip).catch(() => {});
    await new Promise(r => setTimeout(r, 0));
  };
  return { store, layerId, controller, host, move, up, ready, before: serializeLevel(store.document) };
}
afterEach(() => { useEditorStore.getState().setProject(null); clearTilesetImages(); vi.mocked(bakeSmartStamp).mockReset(); });

it("captures the pending press and commits a released four-cell road with its atlas as one undo", async () => {
  const { store, layerId, controller, host, move, up, ready, before } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 });
  expect(host.capture).toHaveBeenCalledWith(1);
  move(7, 4); up(); expect(serializeLevel(store.document)).toBe(before); expect(store.inTransaction).toBe(false);
  await ready();
  expect([4, 5, 6, 7].map(x => store.document.getLayer(layerId)!.getCell(x, 4))).not.toContain(0);
  expect(store.undoDepth).toBe(1); const after = serializeLevel(store.document);
  store.undo(); expect([...store.document.getLayer(layerId)!.chunks()]).toHaveLength(0); expect(store.document.tilesets).toEqual([source]);
  store.redo(); expect(serializeLevel(store.document)).toBe(after);
});

it("replays coalesced bends through the same road path and continues after readiness", async () => {
  const { store, layerId, controller, move, up, ready } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 });
  move(7, 7, [event(7, 4), event(7, 7)]); await ready();
  expect(controller.gesture?.kind).toBe("smart");
  move(9, 7); up();
  const layer = store.document.getLayer(layerId)!;
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [7, 4], [7, 5], [7, 6], [7, 7], [8, 7], [9, 7]]) expect(layer.getCell(x!, y!)).not.toBe(0);
  expect(layer.getCell(5, 5)).toBe(0); expect(store.undoDepth).toBe(1);
});

it("uses the release sample even without a final move, including rectangle geometry", async () => {
  const { store, layerId, controller, up, ready } = setup("rect");
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); up(7, 6); controller.setModifiers(true, true); await ready();
  const layer = store.document.getLayer(layerId)!;
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 7; x++) expect(layer.getCell(x, y)).not.toBe(0);
  expect([...layer.chunks()].flatMap(chunk => [...chunk.data]).filter(Boolean)).toHaveLength(12);
  expect(store.undoDepth).toBe(1);
});

it("keeps consecutive pending strokes separate and commits each once", async () => {
  const { store, layerId, controller, move, up, ready } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); move(7, 4); up();
  controller.pointerDown(event(4, 7), { x: 4, y: 7 }); move(7, 7); up(); await ready();
  const layer = store.document.getLayer(layerId)!;
  for (const y of [4, 7]) for (let x = 4; x <= 7; x++) expect(layer.getCell(x, y)).not.toBe(0);
  expect(store.undoDepth).toBe(2); store.undo();
  for (let x = 4; x <= 7; x++) { expect(layer.getCell(x, 4)).not.toBe(0); expect(layer.getCell(x, 7)).toBe(0); }
});

it("committing a released buffer preserves capture for a newer stroke still held", async () => {
  const { store, controller, host, move, up, ready } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); move(7, 4); up();
  controller.pointerDown(event(4, 7), { x: 4, y: 7 }); move(7, 7);
  vi.mocked(host.release).mockClear(); await ready();
  expect(host.release).not.toHaveBeenCalled(); expect(controller.gesture?.kind).toBe("smart");
  expect(store.undoDepth).toBe(1); expect(store.inTransaction).toBe(true);
  up(); expect(store.undoDepth).toBe(2); expect(store.inTransaction).toBe(false);
});

it.each([false, true])("cancel discards the buffer before or after release (released=%s)", async released => {
  const { store, controller, move, up, ready, before } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); move(7, 4); if (released) up(); controller.cancel(); await ready();
  expect(serializeLevel(store.document)).toBe(before); expect(store.undoDepth).toBe(0); expect(controller.gesture).toBeNull();
});

it("preparation failure clears the gesture, leaves history untouched and reports the existing failure", async () => {
  const { store, controller, move, up, ready, before } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); move(7, 4); up(); await ready(true);
  expect(controller.gesture).toBeNull(); expect(serializeLevel(store.document)).toBe(before); expect(store.undoDepth).toBe(0);
  expect(useToastStore.getState().toasts[0]?.message).toContain("PNG encoding failed");
});

it.each(["brush", "tool", "layer", "project"])("does not apply a released buffer after changing the %s", async change => {
  const { store, controller, move, up, ready, before } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); move(7, 4); up();
  const editor = useEditorStore.getState();
  if (change === "brush") editor.setStamp(null);
  if (change === "tool") editor.setTool("fill");
  if (change === "layer") editor.setActiveLayer(null);
  if (change === "project") editor.setProject(null);
  await ready(); expect(controller.gesture).toBeNull();
  expect(serializeLevel(store.document)).toBe(before); expect(store.undoDepth).toBe(0);
});

it("rechecks a layer locked during preparation and reports the existing blocked feedback", async () => {
  const { store, layerId, controller, host, move, up, ready } = setup();
  controller.pointerDown(event(4, 4), { x: 4, y: 4 }); move(7, 4); up();
  store.dispatch({ type: "setLayerProps", layerId, props: { locked: true } });
  await ready(); expect(host.blocked).toHaveBeenCalledWith({ reason: "locked", layerId });
  expect(store.document.tilesets).toEqual([source]); expect([...store.document.getLayer(layerId)!.chunks()]).toHaveLength(0);
});
