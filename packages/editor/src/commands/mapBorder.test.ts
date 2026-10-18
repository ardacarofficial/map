import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, MapStore, serializeLevel, buildRoadProfile, nineSliceLayout, roadTileInfo, type Stamp, FLIP_H, FLIP_V, FLIP_D } from "@smap/core";
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
beforeEach(() => closeMapBorder());
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

});
