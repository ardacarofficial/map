import { createDocument, MapStore } from "@smap/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MapThumbnail } from "./mapThumbnail";
import { thumbnailSnapshots } from "./thumbnailSnapshotBridge";

beforeEach(() => {
  vi.stubGlobal("ImageData", class {
    readonly data: Uint8ClampedArray;
    constructor(readonly width: number, readonly height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        clearRect: () => {}, putImageData: () => {}, drawImage: () => {},
        getImageData: (_x: number, _y: number, width: number, height: number) => new ImageData(width, height),
      }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function fixture(images = true) {
  const store = new MapStore(createDocument({ width: 5, height: 3, tileWidth: 4, tileHeight: 4 }));
  store.dispatch({ type: "addTileset", tileset: { id: "t", name: "t", imagePath: "t.png", tileWidth: 4, tileHeight: 4, columns: 1, rows: 1, margin: 0, spacing: 0 } });
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Ground" } });
  const cell = store.getOrAddPaletteIndex("t", 0);
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 0, y: 0, cell }] });
  const lookup = vi.fn(() => images ? document.createElement("canvas") : undefined);
  const thumb = new MapThumbnail(store, lookup, () => {});
  return { store, layerId, cell, lookup, thumb };
}

it("publishes no partial overview and owns each requested pixel snapshot", () => {
  const { thumb } = fixture();
  const tag = { project: {}, level: "main", revision: 0 };
  thumb.publishSnapshot(tag.project, tag.level);
  expect(thumb.snapshot()).toBeUndefined();
  expect(thumbnailSnapshots.snapshot(tag)).toBeUndefined();
  while (thumb.pending) thumb.update(50);
  const first = thumbnailSnapshots.snapshot(tag)!;
  const second = thumbnailSnapshots.snapshot(tag)!;
  expect(first.pixels.width).toBe(20);
  expect(first.pixels.height).toBe(12);
  expect(first.pixels.data).not.toBe(second.pixels.data);
  thumb.destroy();
  expect(thumbnailSnapshots.snapshot(tag)).toBeUndefined();
});

it("invalidates ready snapshots on edits and returns the settled revision", () => {
  const { thumb, store, layerId, cell } = fixture();
  const tag = { project: {}, level: "main", revision: store.revision };
  thumb.publishSnapshot(tag.project, tag.level);
  while (thumb.pending) thumb.update(50);
  const first = thumbnailSnapshots.snapshot(tag)!;
  store.dispatch({ type: "paintCells", layerId, cells: [{ x: 1, y: 0, cell }] });
  expect(thumbnailSnapshots.matches(first)).toBe(false);
  expect(thumbnailSnapshots.snapshot(tag)).toBeUndefined();
  while (thumb.pending) thumb.update(50);
  expect(thumbnailSnapshots.snapshot(tag)?.revision).toBe(store.revision);
  thumb.destroy();
});

it("keeps missing-image overviews unavailable until the image arrives", () => {
  const { thumb, lookup } = fixture(false);
  while (thumb.pending) thumb.update(50);
  expect(thumb.snapshot()).toBeUndefined();
  lookup.mockReturnValue(document.createElement("canvas"));
  thumb.imageChanged("t");
  expect(thumb.snapshot()).toBeUndefined();
  while (thumb.pending) thumb.update(50);
  expect(thumb.snapshot()).toBeDefined();
  thumb.destroy();
});

it("invalidates overview samples when a tileset grid rewrites palette entries", () => {
  const { thumb, store } = fixture();
  while (thumb.pending) thumb.update(50);
  expect(thumb.snapshot()).toBeDefined();
  store.dispatch({ type: "updateTilesetGrid", tilesetId: "t", tileWidth: 2, tileHeight: 2, margin: 0, spacing: 0 });
  expect(thumb.snapshot()).toBeUndefined();
  while (thumb.pending) thumb.update(50);
  expect(thumb.snapshot()).toBeDefined();
  thumb.destroy();
});

it('reads edited tile pages without reading the complete atlas bitmap', () => {
  const store = new MapStore(createDocument({ width: 4, height: 4 }));
  const layerId = store.dispatch({ type: 'addLayer', layer: { name: 'Ground' } });
  const slot = store.dispatch({ type: 'allocateEditedTile', tileWidth: 32, tileHeight: 32, pixels: new Uint8Array(32 * 32 * 4).fill(255) });
  store.dispatch({ type: 'remapCells', layerId, cells: [{ x: 0, y: 0 }], tilesetId: slot.assetId, tileId: slot.tileId });
  const lookup = vi.fn(() => undefined), thumb = new MapThumbnail(store, lookup, () => {});
  while (thumb.pending) thumb.update(50);
  expect(lookup).not.toHaveBeenCalled();
  expect(thumb.snapshot()).toBeDefined();
  thumb.destroy();
});

it('first-touch allocation and pixel replay invalidate only dependent thumbnail chunks', () => {
  const { store, layerId, thumb } = fixture();
  while(thumb.pending)thumb.update(50);
  const layer = store.document.getLayer(layerId)!;
  const chunks = vi.spyOn(layer,'chunks');
  const slot = store.dispatch({type:'allocateEditedTile',tileWidth:4,tileHeight:4,pixels:new Uint8Array(64).fill(255)});
  store.dispatch({type:'remapCells',layerId,cells:[{x:0,y:0}],tilesetId:slot.assetId,tileId:0});
  const rect={assetId:slot.assetId,tileId:0,x:0,y:0,width:1,height:1};
  thumb.imageChanged(slot.assetId,[rect]);
  expect(chunks).not.toHaveBeenCalled();
  while(thumb.pending)thumb.update(50); expect(thumb.snapshot()).toBeDefined();
  for(const move of [null,'undo','redo'] as const){
    if(move)store[move]();else store.dispatch({type:'editTilePixels',...rect,after:Uint8Array.of(12,34,56,255)});
    expect(thumb.pending).toBe(true); while(thumb.pending)thumb.update(50);
    expect(chunks).not.toHaveBeenCalled(); expect(thumb.snapshot()).toBeDefined();
    expect([...thumb.overview.data.slice(0,4)]).toEqual(move === 'undo' ? [255,255,255,255] : [12,34,56,255]);
  }
  chunks.mockRestore(); thumb.destroy();
});
