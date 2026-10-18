import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyRegion, createDocument, MapStore, moveRegion, pasteClip, serializeLevel, type TileClip } from "@smap/core";
import { useEditorStore } from "../state/editorStore";
import { useToastStore } from "../ui/toast/toastStore";
import { t } from "../i18n";
import { copySelection, cutSelection, deleteSelection, getMemoryClip } from "./clipboard";
import { canUseSelectionScope, captureSelectionScope, resolveSelectionScope, survivingSelectionIds } from "./selectionScope";
import { rotateBrush } from "./rotateCommands";
import { prepareSelectionPaste, survivingPasteMapping } from "./selectionPaste";

let store: MapStore;
let ground: string;
let roof: string;
let collision: string;
const rect = { x: 1, y: 1, width: 2, height: 2 };
beforeEach(() => {
  vi.stubGlobal("navigator", {});
  store = new MapStore(createDocument({ width: 12, height: 10 }));
  store.dispatch({ type: "addTileset", tileset: { id: "t", name: "T", imagePath: "t.png", columns: 4, rows: 4, tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 } });
  ground = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  roof = store.dispatch({ type: "addLayer", layer: { name: "Roof" } });
  collision = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  const cell = store.getOrAddPaletteIndex("t", 1);
  for (const layerId of [ground, roof]) store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 1, cell }, { x: 2, y: 1, cell }] });
  store.dispatch({ type: "paintGrid", layerId: collision, cells: [{ x: 1, y: 1, value: 2 }] });
  store.clearHistory();
  const s = useEditorStore.getState();
  s.setProject({ name: "test", store, levelPath: "main.json" });
  s.setActiveLayer(ground);
  s.setSelectionScope("active");
  s.setRegion(rect);
});

const snapshot = () => resolveSelectionScope(store.document, ground, "visible");
const bytes = () => serializeLevel(store.document);

describe("selection layer snapshots", () => {
  it("defaults to active; visible includes collision and never entities", () => {
    store.dispatch({ type: "addLayer", layer: { name: "Entities", type: "entity" } });
    expect(useEditorStore.getState().selectionScope).toBe("active");
    expect(resolveSelectionScope(store.document, ground, "active").layerIds).toEqual([ground]);
    expect(snapshot().layerIds).toEqual([ground, roof, collision]);
  });

  it("skips locked and hidden layers, reporting visible locks only", () => {
    store.dispatch({ type: "setLayerProps", layerId: roof, props: { locked: true } });
    store.dispatch({ type: "setLayerProps", layerId: collision, props: { visible: false, locked: true } });
    expect(snapshot()).toEqual({ layerIds: [ground], skipped: ["Roof"] });
  });

  it.each([{ visible: false }, { locked: true }])("disables every active-layer selection action for %j", props => {
    // Keep a prior clipboard so a rejected copy/cut cannot replace it with an empty clip.
    expect(copySelection()).toBe(true);
    const clip = getMemoryClip();
    store.dispatch({ type: "setLayerProps", layerId: ground, props });
    store.clearHistory();
    const before = bytes();
    expect(captureSelectionScope(store.document)).toEqual([]);
    expect(resolveSelectionScope(store.document, ground, "active").layerIds).toEqual([]);
    expect(canUseSelectionScope()).toBe(false);
    for (const action of [copySelection, cutSelection, deleteSelection]) {
      expect(action()).toBe(false);
      expect(bytes()).toBe(before);
      expect(store.undoDepth).toBe(0);
      expect(getMemoryClip()).toBe(clip);
    }
  });

  it("clipboard actions and move/rotate capture identical visible unlocked layers", () => {
    useEditorStore.getState().setSelectionScope("visible");
    store.dispatch({ type: "setLayerProps", layerId: ground, props: { visible: false } });
    store.dispatch({ type: "setLayerProps", layerId: roof, props: { locked: true } });
    store.clearHistory();
    const ids = captureSelectionScope(store.document);
    expect(ids).toEqual([collision]);
    expect(canUseSelectionScope()).toBe(true);
    expect(copySelection()).toBe(true);
    expect(getMemoryClip()!.layers.map(l => l.layerId)).toEqual(ids);
    expect(useToastStore.getState().toasts[0]?.message).toBe(t("selectionScope.skipped", { layers: "Roof" }));
    const before = bytes();
    for (const action of [cutSelection, deleteSelection]) {
      expect(action()).toBe(true);
      expect(useToastStore.getState().toasts[0]?.message).toBe(t("selectionScope.skipped", { layers: "Roof" }));
      expect(store.document.getLayer(ground)!.getCell(1, 1)).not.toBe(0);
      expect(store.document.getLayer(roof)!.getCell(1, 1)).not.toBe(0);
      expect(store.document.getLayer(collision)!.getCell(1, 1)).toBe(0);
      expect(store.undoDepth).toBe(1);
      store.undo(); expect(bytes()).toBe(before);
    }
  });

  it("never adds targets after capture, including after a layer is removed", () => {
    const ids = snapshot().layerIds;
    store.dispatch({ type: "removeLayer", layerId: roof });
    store.dispatch({ type: "addLayer", layer: { name: "Roof" } });
    store.dispatch({ type: "setLayerProps", layerId: collision, props: { locked: true } });
    expect(survivingSelectionIds(store.document, ids)).toEqual([ground]);
    expect(Object.isFrozen(ids)).toBe(true);
  });

  it("moves overlapping content and collision as one undo step, with exact redo", () => {
    const before = bytes();
    moveRegion(store, snapshot().layerIds, rect, 1, 0);
    const after = bytes();
    expect(store.document.getLayer(collision)!.getCell(2, 1)).toBe(2);
    expect(store.document.getLayer(roof)!.getCell(3, 1)).not.toBe(0);
    expect(store.undoDepth).toBe(1);
    store.undo(); expect(bytes()).toBe(before);
    store.redo(); expect(bytes()).toBe(after);
  });

  it.each([cutSelection, deleteSelection])("clears every scoped layer in one undo step", action => {
    useEditorStore.getState().setSelectionScope("visible");
    const before = bytes();
    expect(action()).toBe(true);
    for (const id of [ground, roof, collision]) expect(store.document.getLayer(id)!.getCell(1, 1)).toBe(0);
    expect(store.undoDepth).toBe(1);
    store.undo(); expect(bytes()).toBe(before);
  });

  it("never turns the invisible brush when a marquee turn cannot reach the canvas", () => {
    const s = useEditorStore.getState();
    s.setTool("select");
    s.setSelection({ tilesetId: "t", tileId: 2 });
    expect(rotateBrush("cw")).toBe(false);
    expect(useEditorStore.getState().stamp).toBeNull();
  });

  it("copy uses the same scope and excludes locked layers", () => {
    useEditorStore.getState().setSelectionScope("visible");
    store.dispatch({ type: "setLayerProps", layerId: roof, props: { locked: true } });
    copySelection();
    expect(getMemoryClip()!.layers.map(l => l.layerId)).toEqual([ground, collision]);
  });

  it("maps cross-document clips by name and kind, creates missing layers in the same undo", () => {
    const clip: TileClip = copyRegion(store.document, snapshot().layerIds, rect);
    // Simulate foreign IDs, reversed names, and an unmatched collision layer.
    const foreign = { ...clip, layers: clip.layers.map(l => ({ ...l, layerId: `foreign-${l.layerId}`, name: l.grid ? "New collision" : l.name })) };
    store.dispatch({ type: "removeLayer", layerId: collision });
    store.clearHistory();
    const before = bytes();
    store.beginTransaction();
    const mapping = prepareSelectionPaste(store, foreign);
    expect(mapping[foreign.layers[0]!.layerId]).toBe(ground);
    expect(mapping[foreign.layers[1]!.layerId]).toBe(roof);
    pasteClip(store, foreign, mapping, 6, 5);
    store.commit();
    expect(store.undoDepth).toBe(1);
    expect(store.document.layers.find(l => l.name === "New collision")!.getCell(6, 5)).toBe(2);
    store.undo(); expect(bytes()).toBe(before);
  });

  it("paste skips hidden and locked matches without replacing them", () => {
    const clip = copyRegion(store.document, snapshot().layerIds, rect);
    store.dispatch({ type: "setLayerProps", layerId: roof, props: { locked: true } });
    store.dispatch({ type: "setLayerProps", layerId: collision, props: { visible: false } });
    store.beginTransaction();
    expect(prepareSelectionPaste(store, clip)).toEqual({ [ground]: ground });
    expect(survivingPasteMapping(store.document, { [ground]: ground, [roof]: roof, [collision]: collision })).toEqual({ [ground]: ground });
    store.rollback();
  });
});
