import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, MapStore, serializeLevel, buildRoadProfile, nineSliceLayout, roadTileInfo, applySmartStampRoad, clipFromTileset, roadMembership, cellPaletteIndex, cellFlags, type Stamp, type Tileset, FLIP_H, FLIP_V, FLIP_D } from "@smap/core";
import type * as BakeModule from "../ui/stamps/smartStampBake";
import { prepareSelectionBrush, waitForSelectionBrush, preparedBrush, setBrushSmartEnabled } from "./smartBrushActions";
import { setTilesetImage, clearTilesetImages } from "../state/tilesetImages";
import { bakeSmartStamp } from "../ui/stamps/smartStampBake";
import { saveClipAsStamp } from "../ui/tileset/SelectionSection";
import { useProjectLibrary } from "../io/projectLibrary";
import { useSmartStampSession } from "../ui/stamps/smartStampSession";
import { useEditorStore } from "../state/editorStore";
import { borderPlan, closeMapBorder, commitMapBorder, openMapBorder, updateMapBorder, useMapBorder } from "./mapBorder";

function fixture(width = 12, height = 9) {
  const store = new MapStore(createDocument({ width, height, tilesets: [{ id: "tiles", name: "Tiles", imagePath: "tiles.png", tileWidth: 32, tileHeight: 32, columns: 3, rows: 3, margin: 0, spacing: 0 }] }));
  store.dispatch({ type: "addLayer", layer: { id: "l", name: "Layer" } });
  // Palette indices are append-only in MapStore; compare an already registered brush.
  store.getOrAddPaletteIndex("tiles", 2);
  store.clearHistory();
  useEditorStore.getState().setProject({ store, name: "Test", levelPath: "main.json" });
  useEditorStore.getState().setSelection({ tilesetId: "tiles", tileId: 2 });
  return store;
}
vi.mock("../state/tilesetPixels", () => ({ tilesetPixels: () => ({ width: 96, height: 96, data: new Uint8Array(96 * 96 * 4).fill(255) }) }));
vi.mock("../ui/stamps/smartStampBake", async importOriginal => ({ ...await importOriginal<typeof BakeModule>(), bakeSmartStamp: vi.fn(async (_s: Stamp, _l: string, t: Tileset) => ({ tilesetId: t.id, bytes: Uint8Array.of(1), bitmap: { close: vi.fn() } as unknown as ImageBitmap })) }));
function freshBrush(width = 12, height = 9) {
  const store = fixture(width, height), tileset = store.document.tilesets[0]!;
  useProjectLibrary.getState().load({ stamps: [], levels: [] });
  setTilesetImage({ tilesetId: tileset.id, bytes: Uint8Array.of(1), bitmap: { close: vi.fn() } as unknown as ImageBitmap });
  const clip = clipFromTileset(tileset, { x: 0, y: 0, w: 3, h: 3 })!;
  prepareSelectionBrush(tileset, Array.from({ length: 9 }, (_, i) => i), new Set(), clip);
  useEditorStore.getState().setStamp(clip);
  return { store, clip };
}
beforeEach(() => { closeMapBorder(); clearTilesetImages(); });
describe("map border command", () => {
  it("preview/cancel never change the document or palette", () => {
    const store = fixture(), before = serializeLevel(store.document);
    openMapBorder();
    expect(borderPlan(useMapBorder.getState().draft!).cells.length).toBeGreaterThan(0);
    closeMapBorder();
    expect(serializeLevel(store.document)).toBe(before);
    expect(store.undoDepth).toBe(0);
  });
  it("applies through one transaction, with byte-identical undo/redo and deterministic replanning", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }), (width, height, thickness) => {
      const store = fixture(width, height), before = serializeLevel(store.document);
      openMapBorder(); updateMapBorder({ thickness, inset: 0, gaps: [{ side: "top", start: 1, length: 2 }] });
      const draft = useMapBorder.getState().draft!;
      expect(borderPlan(draft)).toEqual(borderPlan(draft));
      if (!borderPlan(draft).cells.length) { closeMapBorder(); return; }
      expect(commitMapBorder()).toBe(true);
      const after = serializeLevel(store.document);
      expect(store.undoDepth).toBe(1);
      store.undo(); expect(serializeLevel(store.document)).toBe(before);
      store.redo(); expect(serializeLevel(store.document)).toBe(after);
    }), { numRuns: 50 });
  });
  it("blocks hidden/locked layers with a reason, even when changed after opening", () => {
    const store = fixture(); openMapBorder();
    for (const props of [{ locked: true }, { locked: false, visible: false }]) {
      store.dispatch({ type: "setLayerProps", layerId: "l", props });
      expect(borderPlan(useMapBorder.getState().draft!).reason).toBeTruthy();
      expect(commitMapBorder()).toBe(false);
    }
  });
  it("repeats a multi-tile pattern from the inset origin on the active layer only", () => {
    const store = fixture();
    useEditorStore.getState().setStamp({ width: 2, height: 1, palette: [{ tilesetId: "tiles", tileId: 0 }, { tilesetId: "tiles", tileId: 1 }], layers: [{ layerId: "source", name: "Source", cells: Uint32Array.of(1, 2) }] });
    openMapBorder(); updateMapBorder({ inset: 1 });
    const plan = borderPlan(useMapBorder.getState().draft!);
    expect(plan.cells.filter(p => p.y === 1).map(p => p.entry.tileId)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    commitMapBorder(); expect(store.document.layers).toHaveLength(1);
  });
  it("disables a grid-only smart stamp on a tile layer without mutating or throwing", () => {
    const store = fixture(), before = serializeLevel(store.document);
    const stamp: Stamp = { id: "grid", name: "Grid", width: 3, height: 3, palette: [], layers: [{ layerId: "g", name: "Collision", grid: true, role: "collision", cells: new Uint32Array(9).fill(1) }], nineSlice: { border: 1, tileLayers: [] } };
    useEditorStore.getState().setStamp(stamp); openMapBorder();
    expect(borderPlan(useMapBorder.getState().draft!).reason).toBe("toast.blockedNoBrush");
    expect(commitMapBorder()).toBe(false);
    expect(serializeLevel(store.document)).toBe(before);
  });
  it("uses existing smart topology for outside/inside corners and door ends under every D4 orientation", () => {
    const source = { width: 3, height: 3, palette: Array.from({ length: 9 }, (_, tileId) => ({ tilesetId: "tiles", tileId })), layers: [{ layerId: "source", name: "Source", cells: Uint32Array.from({ length: 9 }, (_, i) => i + 1) }] };
    const profile = buildRoadProfile(source, "source");
    for (const road of [true, false]) for (const orientation of [0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_V) >>> 0, (FLIP_H | FLIP_D) >>> 0, (FLIP_V | FLIP_D) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0]) {
      const store = fixture();
      store.dispatch({ type: "addTileset", tileset: { id: "baked", name: "Baked", imagePath: "baked.png", tileWidth: 32, tileHeight: 32, columns: nineSliceLayout(source).slots, rows: 1, margin: 0, spacing: 0 } });
      const stamp: Stamp = { ...source, id: "smart", name: "Smart", nineSlice: { border: 1, tileLayers: [{ layerId: "source", tilesetId: "baked" }], ...(road ? { road: { tilesetId: "baked", profile } } : {}) } };
      useEditorStore.getState().setStamp(stamp);
      useSmartStampSession.setState({ orientation });
      openMapBorder(); updateMapBorder({ thickness: 2, gaps: [{ side: "top", start: 4, length: 2 }] });
      const plan = borderPlan(useMapBorder.getState().draft!);
      // Cardinal topology oracle: top-left has east+south; door ends have only their surviving sides.
      const maskAt = (x: number, y: number) => {
        const p = plan.cells.find(p => p.x === x && p.y === y)!;
        const info = roadTileInfo(profile, "baked", p.entry, p.flags);
        return info.kind === "blob" ? info.mask : -1;
      };
      expect(maskAt(0, 0) & 85).toBe(20);
      expect(maskAt(3, 0) & 85).toBe(80);
      expect(maskAt(6, 0) & 85).toBe(20);
      expect(maskAt(1, 1) & 85).toBe(85);
      expect(plan.cells.some(p => (p.x === 4 || p.x === 5) && p.y < 2)).toBe(false);
      closeMapBorder();
    }
  });

  it.each(["direct", "saved"])("previews a fresh %s brush without edits and publishes atlas plus cells in one undo", async kind => {
    const { store, clip } = freshBrush();
    await waitForSelectionBrush(clip);
    if (kind === "saved") useEditorStore.getState().setStamp((await saveClipAsStamp(store.document, clip, "Road"))!);
    const before = serializeLevel(store.document);
    openMapBorder();
    const draft = useMapBorder.getState().draft!, plan = borderPlan(draft);
    expect(plan.reason).toBeNull();
    expect(plan.cells).toHaveLength(38);
    expect(serializeLevel(store.document)).toBe(before);
    closeMapBorder();
    expect(serializeLevel(store.document)).toBe(before);
    openMapBorder();
    expect(commitMapBorder()).toBe(true);
    expect(store.document.tilesets).toHaveLength(2);
    expect(store.undoDepth).toBe(1);
    for (const p of plan.cells) {
      const cell = store.document.getLayer("l")!.getCell(p.x, p.y);
      expect(store.document.palette.get(cellPaletteIndex(cell))).toEqual(p.entry);
      expect(cellFlags(cell)).toBe(p.flags);
    }
    const after = serializeLevel(store.document);
    store.undo();
    expect(store.document.tilesets).toHaveLength(1);
    expect(store.document.getLayer("l")!.getCell(0, 0)).toBe(0);
    store.redo(); expect(serializeLevel(store.document)).toBe(after);
  });
  it("keeps staged preview and published application identical across border geometry and D4", async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 20 }),
      fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 6 }),
      fc.constantFrom(0, FLIP_H, FLIP_V, FLIP_D, (FLIP_H | FLIP_V) >>> 0, (FLIP_H | FLIP_D) >>> 0, (FLIP_V | FLIP_D) >>> 0, (FLIP_H | FLIP_V | FLIP_D) >>> 0),
      async (width, height, thickness, inset, orientation) => {
        const { store, clip } = freshBrush(width, height); await waitForSelectionBrush(clip);
        useSmartStampSession.setState({ orientation });
        openMapBorder(); updateMapBorder({ thickness, inset, gaps: [{ side: "top", start: 1, length: 2 }] });
        const draft = useMapBorder.getState().draft!, plan = borderPlan(draft);
        expect(plan.reason).toBeNull(); expect(borderPlan(draft)).toBe(plan);
        if (!plan.cells.length) { closeMapBorder(); return; }
        expect(commitMapBorder()).toBe(true);
        for (const p of plan.cells) {
          const cell = store.document.getLayer("l")!.getCell(p.x, p.y);
          expect(store.document.palette.get(cellPaletteIndex(cell))).toEqual(p.entry);
          expect(cellFlags(cell)).toBe(p.flags);
        }
        expect(store.undoDepth).toBe(1);
        const after = serializeLevel(store.document);
        store.undo(); expect(store.document.tilesets).toHaveLength(1);
        store.redo(); expect(serializeLevel(store.document)).toBe(after);
      },
    ), { numRuns: 30 });
  });
  it("blocks while preparing and invalidates the same draft on readiness", async () => {
    let release!: (v: Awaited<ReturnType<typeof bakeSmartStamp>>) => void;
    vi.mocked(bakeSmartStamp).mockImplementationOnce(() => new Promise(r => { release = r; }));
    const { store, clip } = freshBrush();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const before = serializeLevel(store.document);
    openMapBorder(); const draft = useMapBorder.getState().draft!;
    expect(borderPlan(draft).reason).toBe("smartStamp.preparing");
    expect(borderPlan(draft).cells).toEqual([]);
    expect(commitMapBorder()).toBe(false);
    release({ tilesetId: "ready", bytes: Uint8Array.of(1), bitmap: { close: vi.fn() } as unknown as ImageBitmap });
    await waitForSelectionBrush(clip);
    expect(borderPlan(draft).reason).toBeNull();
    expect(borderPlan(draft).cells).toHaveLength(38);
    expect(serializeLevel(store.document)).toBe(before);
  });
  it("returns a disabled reason when a smart atlas is unavailable instead of throwing during render", async () => {
    const { store, clip } = freshBrush(); await waitForSelectionBrush(clip);
    // An authored/imported stamp can outlive its generated atlas and has no staged asset.
    const unavailable: Stamp = { ...preparedBrush(clip)!, id: "unavailable" };
    useEditorStore.getState().setStamp(unavailable);
    const before = serializeLevel(store.document); openMapBorder();
    expect(borderPlan(useMapBorder.getState().draft!).reason).toBe("smartStamp.changed");
    expect(commitMapBorder()).toBe(false);
    expect(serializeLevel(store.document)).toBe(before);
  });
  it("reports failed preparation without falling back to a plain border", async () => {
    vi.mocked(bakeSmartStamp).mockRejectedValueOnce(new Error("PNG encoding failed"));
    const { store, clip } = freshBrush();
    await expect(waitForSelectionBrush(clip)).rejects.toThrow();
    const before = serializeLevel(store.document); openMapBorder();
    const plan = borderPlan(useMapBorder.getState().draft!);
    expect(plan.reason).toBe("smartStamp.changed");
    expect(plan.cells).toEqual([]);
    expect(commitMapBorder()).toBe(false);
    expect(serializeLevel(store.document)).toBe(before);
  });
  it("rolls back first publication if applying the border fails", async () => {
    const { store, clip } = freshBrush(); await waitForSelectionBrush(clip);
    openMapBorder();
    const dispatch = store.dispatch.bind(store);
    const spy = vi.spyOn(store, "dispatch").mockImplementation(op => {
      if (op.type === "paintCells") throw new Error("paint failed");
      return dispatch(op);
    });
    expect(commitMapBorder()).toBe(false);
    expect(store.inTransaction).toBe(false);
    expect(store.undoDepth).toBe(0);
    expect(store.document.tilesets).toHaveLength(1);
    expect(store.document.getLayer("l")!.getCell(0, 0)).toBe(0);
    expect(useProjectLibrary.getState().generatedRecipes).toHaveLength(0);
    spy.mockRestore();
  });
  it("keeps repairs to the adjoining row-1 road in the ghost and the border's one undo", async () => {
    const { store, clip } = freshBrush(); await waitForSelectionBrush(clip);
    const stamp = preparedBrush(clip)!;
    const { publishBrushAssets } = await import("./smartBrushActions");
    store.beginTransaction(); publishBrushAssets(clip, store);
    applySmartStampRoad(store, stamp, "l", roadMembership([5, 6, 7, 8].map(x => ({ x, y: 1 })))); store.commit();
    // Palette growth is append-only; register the bank before testing exact serialized undo.
    const atlas = stamp.nineSlice!.road!.tilesetId;
    const bank = store.document.getTileset(atlas)!;
    for (let i = 0; i < bank.columns * bank.rows; i++) store.getOrAddPaletteIndex(atlas, i);
    store.clearHistory(); const before = serializeLevel(store.document);
    openMapBorder(); const plan = borderPlan(useMapBorder.getState().draft!);
    expect(plan.cells.filter(p => p.y === 1 && p.x >= 5 && p.x <= 8)).toHaveLength(4);
    commitMapBorder(); const after = serializeLevel(store.document);
    expect(store.undoDepth).toBe(1);
    // Reapplying the same membership must not request any missed neighbour repair.
    const { planSmartStampRoad } = await import("@smap/core");
    const band = plan.band, members = new Set(band.cells.map(p => `${p.x},${p.y}`));
    const repairs = planSmartStampRoad(store.document, stamp, "l", { bounds: band.rect, cells: band.cells, contains: (x, y) => members.has(`${x},${y}`) }, { revision: store.revision });
    expect(repairs.layers.flatMap(l => l.writes).filter(w => w.y === 1 && w.x >= 5 && w.x <= 8)).toEqual([]);
    store.undo(); expect(serializeLevel(store.document)).toBe(before);
    store.redo(); expect(serializeLevel(store.document)).toBe(after);
  });
  it.each([
    [FLIP_H, 2], [FLIP_V, 6], [(FLIP_H | FLIP_D) >>> 0, 6], [(FLIP_V | FLIP_D) >>> 0, 2],
  ])("uses the Akıllı-off oriented source and flags %i", async (orientation, firstTile) => {
    const { store, clip } = freshBrush(); await waitForSelectionBrush(clip);
    setBrushSmartEnabled(false); useSmartStampSession.setState({ orientation });
    openMapBorder(); const plan = borderPlan(useMapBorder.getState().draft!);
    expect(plan.cells[0]).toMatchObject({ x: 0, y: 0, entry: { tilesetId: "tiles", tileId: firstTile }, flags: orientation });
    expect(commitMapBorder()).toBe(true);
    const cell = store.document.getLayer("l")!.getCell(0, 0);
    expect(store.document.palette.get(cellPaletteIndex(cell))?.tileId).toBe(firstTile);
    expect(cellFlags(cell)).toBe(orientation);
    expect(store.document.tilesets).toHaveLength(1);
  });

});
