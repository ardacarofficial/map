// TEMPORARY (verification): writes sample exports to the scratchpad. Deleted after use.
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { COLLISION_SOLID, createDocument, exportTmj, exportUnityMap, FLIP_H, FLIP_V, makeCell, MapStore } from "../src";

const OUT = "/tmp/claude-0/-home-user-map/71aa0adb-d0ed-56a0-9a7b-c70c93d2a345/scratchpad/uv/sample";

it("writes samples", () => {
  const store = new MapStore(createDocument({ width: 5, height: 4 }));
  store.dispatch({ type: "addTileset", tileset: { id: "grass", name: "Grass", imagePath: "tilesets/grass.png", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0, solidTiles: [9, 10] } });
  store.dispatch({ type: "addTileset", tileset: { id: "items", name: "Items", imagePath: "tilesets/sub/items.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 2, margin: 1, spacing: 2, solidTiles: [5] } });
  const g = (t: number) => store.getOrAddPaletteIndex("grass", t);
  const i = (t: number) => store.getOrAddPaletteIndex("items", t);
  store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
  store.dispatch({ type: "addLayer", layer: { id: "deco", name: "Deco" } });
  store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
  store.dispatch({ type: "paintCells", layerId: "ground", cells: [
    { x: 0, y: 0, cell: makeCell(g(1)) },
    { x: 4, y: 0, cell: makeCell(g(9), FLIP_H) },
    { x: 1, y: 3, cell: makeCell(g(63), FLIP_H | FLIP_V) },
    { x: 2, y: 1, cell: makeCell(g(10)) },
    { x: 3, y: 1, cell: makeCell(g(10), FLIP_V) },
  ] });
  store.dispatch({ type: "paintCells", layerId: "deco", cells: [{ x: 2, y: 2, cell: makeCell(i(5), FLIP_V) }, { x: 0, y: 3, cell: makeCell(i(7)) }] });
  store.dispatch({ type: "setLayerProps", layerId: "deco", props: { opacity: 0.5 } });
  store.dispatch({ type: "paintTerrain", layerId: "col", cells: [{ x: 0, y: 3, value: COLLISION_SOLID }] });
  const u = exportUnityMap(store.document, "sample");
  writeFileSync(`${OUT}/${u.fileName}`, u.text);
  const t = exportTmj(store.document, "sample");
  writeFileSync(`${OUT}/${t.fileName}`, t.text);
  // second doc: hidden + empty + unicode layer, unused tileset, imagePath option
  const s2 = new MapStore(createDocument({ width: 3, height: 2 }));
  s2.dispatch({ type: "addTileset", tileset: { id: "unused", name: "Unused", imagePath: "u.png", tileWidth: 32, tileHeight: 32, columns: 2, rows: 2, margin: 0, spacing: 0 } });
  s2.dispatch({ type: "addTileset", tileset: { id: "grass", name: "Çimen \"q\"", imagePath: "tilesets/grass.png", tileWidth: 32, tileHeight: 32, columns: 8, rows: 8, margin: 0, spacing: 0, solidTiles: [0] } });
  s2.dispatch({ type: "addLayer", layer: { id: "a", name: "Zemin ğüş" } });
  s2.dispatch({ type: "addLayer", layer: { id: "b", name: "Boş" } });
  s2.dispatch({ type: "addLayer", layer: { id: "c", name: "Gizli" } });
  const gg = (t: number) => s2.getOrAddPaletteIndex("grass", t);
  s2.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(gg(0)) }, { x: 2, y: 1, cell: makeCell(gg(63), FLIP_H) }] });
  s2.dispatch({ type: "paintCells", layerId: "c", cells: [{ x: 1, y: 1, cell: makeCell(gg(7), FLIP_V) }] });
  s2.dispatch({ type: "setLayerProps", layerId: "c", props: { visible: false, opacity: 0.25 } });
  const t2 = exportTmj(s2.document, "sample2", { imagePath: (img) => `img/${img.fileName}` });
  writeFileSync(`${OUT}/${t2.fileName}`, t2.text);
  writeFileSync(`${OUT}/meta.json`, JSON.stringify({ unityImages: u.images.map((x) => x.fileName), warnings: t.warnings }, null, 2));
});
