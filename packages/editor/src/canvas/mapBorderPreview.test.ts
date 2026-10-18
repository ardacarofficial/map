import { expect, it, vi } from "vitest";
import { createDocument, MapStore } from "@smap/core";
import { borderPlan, useMapBorder } from "../commands/mapBorder";
import { drawMapBorderPreview } from "./mapBorderPreview";
import type { OverlayHost } from "./overlayRenderer";

vi.mock("../commands/mapBorder", () => ({ borderPlan: vi.fn(), useMapBorder: { getState: vi.fn() } }));

it("prepares staged textures before displaying the visible border and neighbour repairs", () => {
  const store = new MapStore(createDocument({ width: 12, height: 10 }));
  const draft = { store, thickness: 1, inset: 0 };
  const tileset = { id: "staged", name: "Road", imagePath: "road.png", columns: 64, rows: 1, tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 };
  const entry = { tilesetId: tileset.id, tileId: 18 };
  vi.mocked(useMapBorder.getState).mockReturnValue({ draft });
  vi.mocked(borderPlan).mockReturnValue({ id: 7, layerId: "l", reason: null, band: { cells: [], rect: { x: 0, y: 0, width: 12, height: 10 }, thickness: 1, inset: 0, clamped: false }, previewTilesets: [tileset], cells: [
    { x: 5, y: 0, entry, flags: 0 }, { x: 5, y: 1, entry, flags: 0 }, { x: 11, y: 9, entry, flags: 0 },
  ] });
  const scene = { store, atlasVersion: 0, preparePreviewTileset: vi.fn(() => { scene.atlasVersion++; }), setSmartPreview: vi.fn(() => { expect(scene.preparePreviewTileset).toHaveBeenCalledWith(tileset); }) };
  const host = { scene, visible: { x: 0, y: 0, width: 8, height: 4 } } as unknown as OverlayHost;
  expect(drawMapBorderPreview(host)).toBe(true);
  expect(scene.setSmartPreview).toHaveBeenCalledWith({ revision: store.revision, windowed: true, layers: [{ sourceLayerId: "map-border", layerId: "l", name: "", grid: false, writes: [
    { x: 5, y: 0, tile: entry, flags: 0 }, { x: 5, y: 1, tile: entry, flags: 0 },
  ] }] }, "border:7:1:0,0,8,4");
  expect(store.document.tilesets).toHaveLength(0);
});
