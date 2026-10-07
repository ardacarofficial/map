import { expect, it } from "vitest";
import { createStamp, placeStamp, deriveTerrainTiles, cellPaletteIndex } from "../src";
import { makeTerrainStore, BLOB_ID } from "./helpers";

function mismatches(store: any) {
  const doc = store.document;
  const exp = deriveTerrainTiles(doc, "terrain");
  const tiles = doc.getLayer("tiles");
  const out: string[] = [];
  for (let y = 0; y < doc.map.height; y++) for (let x = 0; x < doc.map.width; x++) {
    const e = exp[y * doc.map.width + x];
    const c = tiles.getCell(x, y);
    const g = c === 0 ? null : doc.palette.get(cellPaletteIndex(c));
    if ((e?.tileId ?? null) !== (g?.tileId ?? null) || (c >>> 29) !== 0) out.push(`${x},${y}`);
  }
  return out;
}

it("stamp with terrain grid placed over identical terrain leaves non-derived tiles", () => {
  const src = makeTerrainStore(12, 12);
  const cells = [];
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) cells.push({ x, y, value: BLOB_ID });
  src.dispatch({ type: "paintTerrain", layerId: "terrain", cells });
  const stamp = createStamp(src.document, ["tiles", "terrain"], { x: 2, y: 2, width: 3, height: 3 }, { id: "s", name: "S" });

  const dst = makeTerrainStore(12, 12);
  const all = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) all.push({ x, y, value: BLOB_ID });
  dst.dispatch({ type: "paintTerrain", layerId: "terrain", cells: all });
  expect(mismatches(dst)).toEqual([]);
  placeStamp(dst, stamp, 5, 5);
  console.log("mismatch after placeStamp:", mismatches(dst));
  expect(mismatches(dst)).toEqual([]);
});
