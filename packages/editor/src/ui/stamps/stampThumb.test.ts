import { createDocument, createStamp, FLIP_D, FLIP_H, makeCell, MapStore, type Tileset } from "@smap/core";
import { describe, expect, it } from "vitest";

import { compositeOps } from "../../export/pngComposite";
import { stampDrawList, stampLayerCounts, thumbScale } from "./stampThumbnailPixels";

const ts: Tileset = {
  id: "grass",
  name: "Grass",
  imagePath: "tilesets/grass.png",
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  rows: 4,
  margin: 0,
  spacing: 0,
};

function house() {
  const store = new MapStore(createDocument({ width: 10, height: 10, tileWidth: 16, tileHeight: 16 }));
  store.dispatch({ type: "addTileset", tileset: ts });
  const ground = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  const roof = store.dispatch({ type: "addLayer", layer: { name: "Çatı" } });
  const coll = store.dispatch({ type: "addLayer", layer: { name: "Collision", type: "grid", role: "collision" } });
  const a = store.getOrAddPaletteIndex("grass", 5);
  const b = store.getOrAddPaletteIndex("grass", 6);
  store.dispatch({ type: "paintCells", layerId: ground, cells: [{ x: 2, y: 2, cell: makeCell(a) }, { x: 3, y: 3, cell: makeCell(a) }] });
  store.dispatch({ type: "paintCells", layerId: roof, cells: [{ x: 3, y: 2, cell: makeCell(b, FLIP_H) }] });
  store.dispatch({ type: "paintGrid", layerId: coll, cells: [{ x: 2, y: 2, value: 1 }] });
  const doc = store.document;
  return createStamp(doc, doc.layers.map((l) => l.id), { x: 2, y: 2, width: 2, height: 2 }, { id: "ev", name: "Ev" });
}

describe("stamp thumbnails", () => {
  it("lists tile layers bottom to top in stamp pixel space; grid layers are skipped", () => {
    const stamp = house();
    expect(stampLayerCounts(stamp)).toEqual({ tile: 2, grid: 1 });
    const list = stampDrawList(stamp, 16, 16, (id) => (id === "grass" ? ts : undefined));
    expect(list.width).toBe(32);
    expect(list.height).toBe(32);
    expect(list.layers.map((l) => l.items.length)).toEqual([2, 1]);
    const roof = list.layers[1]!.items[0]!;
    expect(roof.dest).toEqual({ x: 16, y: 0, width: 16, height: 16 });
    expect(roof.src).toEqual({ x: 32, y: 16, width: 16, height: 16 });
    expect(roof.flipH).toBe(true);
    // Same compositing as PNG export: a flipped tile maps its left edge to the cell's right edge.
    const ops = compositeOps(list, 2);
    const last = ops.at(-1);
    expect(last?.kind === "draw" && last.transform).toEqual([-2, 0, 0, 2, 64, 0]);
  });

  it("draws rotated tiles (FLIP_D) transposed, like the PNG export", () => {
    const tall: Tileset = { ...ts, tileWidth: 16, tileHeight: 32, rows: 2 };
    const clip = { width: 1, height: 1, palette: [{ tilesetId: "grass", tileId: 1 }], layers: [{ layerId: "l", name: "L", cells: Uint32Array.of(makeCell(1, FLIP_D)) }] };
    const list = stampDrawList(clip, 16, 16, () => tall);
    const item = list.layers[0]!.items[0]!;
    expect(item.flipD).toBe(true);
    // A 16 × 32 tile becomes 32 × 16, anchored bottom-left of its cell.
    expect(item.dest).toEqual({ x: 0, y: 0, width: 32, height: 16 });
    const ops = compositeOps(list, 1);
    const last = ops.at(-1);
    expect(last?.kind === "draw" && last.transform).toEqual([0, 1, 1, 0, 0, 0]);
  });

  it("skips tiles of unknown tilesets", () => {
    const list = stampDrawList(house(), 16, 16, () => undefined);
    expect(list.layers.every((l) => l.items.length === 0)).toBe(true);
  });

  it("fits thumbnails crisply", () => {
    expect(thumbScale(32, 32, 120, 80)).toBe(2);
    expect(thumbScale(16, 16, 120, 80)).toBe(4);
    expect(thumbScale(320, 160, 120, 80)).toBeCloseTo(0.375);
  });
});

it("joins native source tiles with no PNG gutters while keeping map-region composition in map space",async()=>{
 const {clipFromTileset}=await import("@smap/core");const {sourcePreviewGrid,rememberSourcePreview,copySourcePreview}=await import("./stampThumbnailPixels");
 const source={...ts,margin:1,spacing:2},clip=clipFromTileset(source,{x:0,y:0,w:3,h:3})!;
 expect(sourcePreviewGrid(clip,()=>source)).toBeUndefined();rememberSourcePreview(clip,source);
 const grid=sourcePreviewGrid(clip,()=>source)!;expect(grid).toEqual({tileWidth:16,tileHeight:16});
 const list=stampDrawList(clip,grid.tileWidth,grid.tileHeight,()=>source);expect(list.width).toBe(48);expect(list.layers[0]!.items.map(i=>i.dest.x)).toEqual([0,16,32,0,16,32,0,16,32]);expect(list.layers[0]!.items[1]!.src.x).toBe(19);
 const saved={...clip,id:"bush",name:"Bush"};copySourcePreview(saved,clip);expect(sourcePreviewGrid(saved,()=>source)).toEqual(grid);
 const reopened={...saved};expect(sourcePreviewGrid(reopened,()=>source)).toEqual(grid);
 expect(stampDrawList(clip,32,32,()=>source).width).toBe(96);
});

it("derives a reopened mirrored or rotated rectangular source at its native oriented resolution",async()=>{
 const {clipFromTileset,flipClip,rotateClip}=await import("@smap/core");const {sourcePreviewGrid,rememberSourcePreview,copySourcePreview}=await import("./stampThumbnailPixels");
 const source={...ts,tileWidth:32,tileHeight:16,margin:1,spacing:2},original=clipFromTileset(source,{x:0,y:0,w:3,h:2})!;rememberSourcePreview(original,source);
 for(const clip of [flipClip(original,"x"),flipClip(original,"y"),rotateClip(original,"cw"),rotateClip(original,"ccw")]){
  copySourcePreview(clip,original);const saved={...clip,id:"object",name:"Object"},grid=sourcePreviewGrid(saved,()=>source)!;
  expect(grid).toEqual(clip.width===3?{tileWidth:32,tileHeight:16}:{tileWidth:16,tileHeight:32});
  expect(sourcePreviewGrid(clip,()=>source)).toEqual(grid);
  const list=stampDrawList(saved,grid.tileWidth,grid.tileHeight,()=>source);
  expect(list.layers[0]!.items.every(i=>i.dest.width===grid.tileWidth&&i.dest.height===grid.tileHeight)).toBe(true);
  expect(list.width*list.height).toBe(96*32);
 }
});
