import { FLIP_H, MapStore, cellFlags, cellPaletteIndex, createDocument, makeCell, rectangleBand, serializeLevel, tagBlockWithTemplate, terrainPaint, withTerrainSet, type CellPoint, type Tileset } from "@smap/core";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { closeTileReplacement, openTileReplacement, useTileReplacement } from "../commands/replaceTiles";
import { useRandomBrush } from "../commands/randomBrush";
import { useProjectLibrary } from "../io/projectLibrary";
import { useEditorStore } from "../state/editorStore";
import { useRectangleOptions } from "../state/rectangleOptions";
import { ToolController, rectGestureRegion, type ToolHost } from "./toolController";
import { rectPreviewCells } from "./tools";
import { randomTileAt } from "./randomPaint";

const ts: Tileset = { id: "t", name: "T", imagePath: "t.png", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0 };
const r = { x: 2, y: 2, width: 7, height: 6 };
const e = (buttons: number, shiftKey = false, altKey = false) => ({ pointerId: 1, button: 0, buttons, shiftKey, altKey, preventDefault() {} }) as PointerEvent;
function setup(tileset = ts) {
  const store = new MapStore(createDocument({ width: 20, height: 20, tilesets: [tileset], seed: 42 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "A" } });
  useEditorStore.getState().setProject({ store, name: "P", levelPath: "p.json" });
  useEditorStore.getState().setTool("rect");
  useEditorStore.getState().setSelection({ tilesetId: "t", tileId: 1 });
  useRectangleOptions.setState({ mode: "outline", thickness: 1 });
  let point: CellPoint = { x: r.x, y: r.y };
  const contextRequest = vi.fn();
  const host = { contextRequest, scene: { store }, pointerCell: () => point, capture: vi.fn(), release: vi.fn(), requestRender: vi.fn() } as unknown as ToolHost;
  const controller = new ToolController(host);
  store.clearHistory();
  const drag = (shift = false, alt = false) => {
    controller.pointerDown(e(1, shift, alt), { x: r.x, y: r.y });
    point = { x: r.x + r.width - 1, y: r.y + r.height - 1 };
    controller.pointerMove(e(1, shift, alt));
    return controller.gesture;
  };
  const up = (shift = false, alt = false) => controller.pointerUp(e(0, shift, alt));
  return { store, layerId, controller, drag, up, contextRequest, setPoint: (p: CellPoint) => { point = p; } };
}
afterEach(() => { closeTileReplacement(); useProjectLibrary.setState({ stamps: [] }); useRandomBrush.setState({ stamps: [], randomFlip: false, chunk: { w: 1, h: 1 }, scatter: 0 }); useEditorStore.getState().setProject(null); useRectangleOptions.setState({ mode: "filled", thickness: 1 }); });

describe("rectangle outline gestures", () => {
  it("plain tile preview equals the result, keeps the interior, and undo/redo is one step", () => {
    const { store, layerId, drag, up } = setup();
    store.getOrAddPaletteIndex("t", 1);
    const manual = store.getOrAddPaletteIndex("t", 5);
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 4, y: 4, cell: manual }] });
    store.clearHistory();
    const before = serializeLevel(store.document);
    drag();
    const preview = rectPreviewCells(r, r, 1000, () => ({ entry: { tilesetId: "t", tileId: 1 }, flags: 0 }), 1)!;
    up();
    expect(preview).toHaveLength(22);
    const layer = store.document.getLayer(layerId)!;
    for (const p of preview) expect(layer.getCell(p.x, p.y)).toBe(1);
    expect(layer.getCell(4, 4)).toBe(manual);
    expect(store.undoDepth).toBe(1);
    const after = serializeLevel(store.document);
    store.undo(); expect(serializeLevel(store.document)).toBe(before);
    store.redo(); expect(serializeLevel(store.document)).toBe(after);
  });

  it("stamp pattern stays anchored at the press, including transformed tile flags", () => {
    const { store, layerId, drag, up } = setup();
    useEditorStore.getState().setStamp({ width: 2, height: 1, palette: [{ tilesetId: "t", tileId: 2 }, { tilesetId: "t", tileId: 3 }], layers: [{ layerId, name: "A", cells: Uint32Array.of(makeCell(1, FLIP_H), 2) }] });
    drag(); up();
    for (const p of rectangleBand(r, 1)) {
      const cell = store.document.getLayer(layerId)!.getCell(p.x, p.y);
      expect(store.document.palette.get(cellPaletteIndex(cell))!.tileId).toBe((p.x - r.x) % 2 === 0 ? 2 : 3);
      expect(cellFlags(cell)).toBe((p.x - r.x) % 2 === 0 ? FLIP_H : 0);
    }
    expect(store.document.getLayer(layerId)!.getCell(3, 3)).toBe(0);
  });

  it("random tile previews use the same coordinate hash as the committed band", () => {
    const { store, layerId, drag, up } = setup();
    const set = [{ tilesetId: "t", tileId: 2 }, { tilesetId: "t", tileId: 4 }];
    useEditorStore.getState().setRandomSet(set);
    drag(); up();
    for (const p of rectangleBand(r, 1)) {
      const cell = store.document.getLayer(layerId)!.getCell(p.x, p.y);
      expect(store.document.palette.get(cellPaletteIndex(cell))).toEqual(randomTileAt(set, store.document.seed, p.x, p.y));
    }
    expect(store.document.getLayer(layerId)!.getCell(3, 3)).toBe(0);
    expect(store.undoDepth).toBe(1);
  });

  it("random saved stamps are clipped on every layer to the outline, including flips and chunk anchors", () => {
    const { store, layerId, drag, up } = setup();
    useEditorStore.getState().setRandomSet([{ tilesetId: "t", tileId: 2 }]);
    useProjectLibrary.setState({ stamps: [{ id: "wide", name: "Wide", width: 3, height: 3, palette: [{ tilesetId: "t", tileId: 3 }], layers: [{ layerId: "source", name: "A", cells: new Uint32Array(9).fill(makeCell(1, FLIP_H)) }] }] });
    useRandomBrush.setState({ stamps: [{ kind: "stamp", stampId: "wide", weight: 100 }], randomFlip: true, chunk: { w: 2, h: 2 } });
    drag(); up();
    const layer = store.document.getLayer(layerId)!;
    let nonempty = 0;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const cell = layer.getCell(x, y);
      if (cell) {
        nonempty++;
        expect(x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height).toBe(true);
        expect(x === r.x || x === r.x + r.width - 1 || y === r.y || y === r.y + r.height - 1).toBe(true);
      }
    }
    expect(nonempty).toBeGreaterThan(0);
    expect(store.undoDepth).toBe(1);
    const after = serializeLevel(store.document);
    store.undo();
    expect([...layer.chunks()]).toHaveLength(0);
    store.redo();
    expect(serializeLevel(store.document)).toBe(after);
  });

  it("terrain preview writes, including repairs, equal the committed solver result", () => {
    const tagged = tagBlockWithTemplate(withTerrainSet(ts, { id: "b", name: "B", kind: "blob", terrains: [{ id: 1, name: "T", color: "#ffffff" }], tiles: [] }), "b", 1, "blob47", { col: 0, row: 0 });
    const { store, layerId, drag, up, controller, setPoint, contextRequest } = setup(tagged);
    const brush = { tilesetId: "t", setId: "b", terrainId: 1 };
    useEditorStore.getState().setTerrain(brush);
    const expected = terrainPaint(store.document, layerId, [...rectangleBand(r, 1)], brush);
    drag(); up();
    expect(expected.length).toBeGreaterThan(0);
    for (const p of expected) {
      const cell = store.document.getLayer(layerId)!.getCell(p.x, p.y);
      expect(store.document.palette.get(cellPaletteIndex(cell)) ?? null).toEqual(p.tile);
      expect(cellFlags(cell)).toBe(0);
    }
    expect(store.document.getLayer(layerId)!.getCell(5, 4)).toBe(0);
    expect(store.undoDepth).toBe(1);
    setPoint({ x: 2, y: 2 });
    controller.pointerDown({ ...e(2), button: 2 }, { x: 2, y: 2 });
    controller.pointerUp({ ...e(0), button: 2 });
    expect(useEditorStore.getState().terrainActive).toBe(true);
    expect(contextRequest).not.toHaveBeenCalled();
  });

  it("Shift and Alt retain their geometry; options are captured at press; cancel makes no edits", () => {
    const { store, controller, drag, up } = setup();
    const g = drag(true, true);
    expect(g?.kind).toBe("rect");
    if (g?.kind !== "rect") throw new Error("missing rectangle");
    const region = rectGestureRegion(g, store.document.map)!;
    expect(region.width).toBe(region.height);
    expect(g.thickness).toBe(1);
    useRectangleOptions.setState({ thickness: 8 });
    expect(g.thickness).toBe(1);
    controller.cancel(); up();
    expect(store.undoDepth).toBe(0);
  });

  it("clips the intended band to the map without moving its border to the map edge", () => {
    const { store, layerId, controller, setPoint, up } = setup();
    controller.pointerDown(e(1), { x: -3, y: 4 });
    setPoint({ x: 5, y: 10 });
    controller.pointerMove(e(1));
    const gesture = controller.gesture;
    if (gesture?.kind !== "rect") throw new Error("missing rectangle");
    expect(rectGestureRegion(gesture, store.document.map)).toEqual({ x: -3, y: 4, width: 9, height: 7 });
    up();
    const layer = store.document.getLayer(layerId)!;
    expect(layer.getCell(0, 4)).not.toBe(0);
    expect(layer.getCell(0, 6)).toBe(0);
    expect(layer.getCell(5, 6)).not.toBe(0);
    expect(store.undoDepth).toBe(1);
  });

  it("selection context replacement defaults to the tile under that right-click", () => {
    const { store, layerId, controller, contextRequest } = setup();
    const index = store.getOrAddPaletteIndex("t", 3);
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 2, y: 2, cell: index }] });
    useEditorStore.getState().setRegion(r);
    useEditorStore.getState().setTool("select");
    controller.pointerDown({ ...e(2), button: 2 }, { x: 2, y: 2 });
    controller.pointerUp({ ...e(0), button: 2 });
    expect(contextRequest).toHaveBeenCalledWith(expect.objectContaining({ kind: "selection" }));
    openTileReplacement();
    expect(useTileReplacement.getState().draft).toMatchObject({ from: { tilesetId: "t", tileId: 3 }, to: { tilesetId: "t", tileId: 1 }, scope: "selection" });
  });

  it("large thickness fills the rectangle, and selection-fill stays filled regardless of rectangle mode", () => {
    const { store, layerId, controller, drag, up } = setup();
    useRectangleOptions.setState({ thickness: 8 });
    drag(); up();
    expect(store.document.getLayer(layerId)!.getCell(5, 4)).not.toBe(0);
    store.undo();
    controller.fillRegion(r);
    expect(store.document.getLayer(layerId)!.getCell(5, 4)).not.toBe(0);
    expect(store.undoDepth).toBe(1);
  });
});


describe("outline preview geometry", () => {
  it("equals the full band cropped to the viewport, with source flags intact", () => {
    fc.assert(fc.property(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 8 }), (offset, width, thickness) => {
      const region = { x: offset, y: offset, width, height: 17 };
      const visible = { x: 0, y: 0, width: 12, height: 12 };
      const expected = [...rectangleBand(region, thickness)].filter(p => p.x >= 0 && p.y >= 0 && p.x < 12 && p.y < 12);
      const preview = rectPreviewCells(region, visible, 1, (x, y) => ({ entry: { tilesetId: "t", tileId: (x + y) & 1 }, flags: FLIP_H }), thickness)!;
      expect(preview.map(({ x, y }) => ({ x, y }))).toEqual(expected);
      expect(preview.every(p => p.flags === FLIP_H && p.entry.tileId === ((p.x + p.y) & 1))).toBe(true);
    }));
  });
});
