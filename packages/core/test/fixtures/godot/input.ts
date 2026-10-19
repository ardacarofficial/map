import { COLLISION_PASSABLE, COLLISION_SOLID, createDocument, FLIP_D, FLIP_H, FLIP_V, makeCell, MapStore, type Tileset } from "../../../src";

/** Real PNGs are supplied by generate.mjs for engine runs; this header suffices for pure layout validation. */
export function fixturePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  bytes[24] = 8; bytes[25] = 6;
  return bytes;
}
export function godotFixture() {
  const road: Tileset = { id: "a-road", name: 'Atlas "road"\n\\', imagePath: "generated/road.png", tileWidth: 16, tileHeight: 16, columns: 2, rows: 2, margin: 1, spacing: 2,
    generated: { kind: "nineSlice", stampId: "road", layerId: "ground", sourceWidth: 3, sourceHeight: 3, layoutVersion: 1, sources: [] } };
  const item: Tileset = { id: "b-items", name: "Items", imagePath: "tilesets/items.png", tileWidth: 16, tileHeight: 16, columns: 2, rows: 2, margin: 1, spacing: 2 };
  const store = new MapStore(createDocument({ width: 16, height: 4, tileWidth: 16, tileHeight: 16, tilesets: [road, item] }));
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: 'Ground "road"\n\\' } });
  store.dispatch({ type: "addLayer", layer: { id: "deco", name: "Deco", visible: false, opacity: 0.25 } });
  store.dispatch({ type: "addLayer", layer: { id: "empty", name: "Empty (2) + 🌲" } });
  store.dispatch({ type: "paintCells", layerId: "ground", cells: Array.from({ length: 8 }, (_, i) => ({ x: i * 2, y: 0, cell: makeCell(store.getOrAddPaletteIndex("a-road", 3), (i & 1 ? FLIP_H : 0) | (i & 2 ? FLIP_V : 0) | (i & 4 ? FLIP_D : 0)) })) });
  store.dispatch({ type: "paintCells", layerId: "deco", cells: [{ x: 3, y: 2, cell: makeCell(store.getOrAddPaletteIndex("b-items", 2)) }] });
  for (const id of ["collision-low", "collision-top"]) store.dispatch({ type: "addLayer", layer: { id, name: id, type: "grid", role: "collision", visible: false } });
  store.dispatch({ type: "paintGrid", layerId: "collision-low", cells: [{ x: 0, y: 0, value: COLLISION_SOLID }, { x: 2, y: 3, value: COLLISION_SOLID }] });
  store.dispatch({ type: "paintGrid", layerId: "collision-top", cells: [{ x: 0, y: 0, value: COLLISION_PASSABLE }] });
  const bytes = (_id: string) => fixturePng(36, 36);
  return { store, bytes };
}
