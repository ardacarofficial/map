import { expect, it, vi } from "vitest";
import { CameraController } from "./cameraController";
import { PointerInput, type InputHost } from "./pointerInput";
import type { ToolController } from "./toolController";

it("synchronizes pending canvas geometry before mapping input and caches it until invalidated", () => {
  const map = { width: 64, height: 48, tileWidth: 32, tileHeight: 32 };
  const camera = new CameraController(() => map, () => {});
  camera.resize(100, 100, 1);
  camera.setZoom(1, camera.viewCenter());
  camera.panBy(-camera.camera.x, -camera.camera.y);
  let rect = { left: 300, top: 100, width: 200, height: 100 } as DOMRect;
  const canvas = { getBoundingClientRect: () => rect } as unknown as HTMLCanvasElement;
  const syncRect = vi.fn(() => { camera.resize(rect.width, rect.height, 1); return rect; });
  const host: InputHost & { syncRect(): DOMRect } = {
    camera, syncRect, world: () => null, tools: {} as ToolController,
    map: () => map, paintable: () => true, entityCursor: () => null,
    regionCursor: () => null, doubleClick: () => {}, requestRender: () => {},
  };
  const input = new PointerInput(canvas, host);
  expect(camera.cellAt(input.toLocal({ clientX: 400, clientY: 150 }))).toEqual({ x: 1, y: 1 });
  input.toLocal({ clientX: 401, clientY: 150 });
  expect(syncRect).toHaveBeenCalledTimes(1);
  rect = { ...rect, left: 250 };
  input.invalidateRect();
  expect(camera.cellAt(input.toLocal({ clientX: 350, clientY: 150 }))).toEqual({ x: 1, y: 1 });
  expect(syncRect).toHaveBeenCalledTimes(2);
});
