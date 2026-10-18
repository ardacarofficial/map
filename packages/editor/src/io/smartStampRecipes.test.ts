import { describe, expect, it } from "vitest";
import { makeCell, type Stamp, type Tileset } from "@smap/core";
import { affectedTilesetStamps } from "./smartStampRecipes";
import { summarizeUsage } from "../ui/tileset/libraryModel";
import { usageText } from "../ui/tileset/RemoveTilesetDialog";

const stamp: Stamp = { id: "road", name: "Road", width: 3, height: 3, palette: [{ tilesetId: "source", tileId: 0 }], layers: [{ layerId: "s", name: "Ground", cells: new Uint32Array(9).fill(makeCell(1)) }] };
const bank: Tileset = { id: "bank", name: "Road (yol)", imagePath: "tilesets/bank.png", tileWidth: 5, tileHeight: 5, columns: 8, rows: 8, margin: 0, spacing: 0, generated: { kind: "nineSlice", stampId: "road", layerId: "s", sourceWidth: 3, sourceHeight: 3, layoutVersion: 1, sources: [{ tilesetId: "source", imageHash: "old" }, { tilesetId: "inner", imageHash: "old" }] } };
const smart = { ...stamp, nineSlice: { border: 1 as const, tileLayers: [{ layerId: "s", tilesetId: bank.id }], road: { tilesetId: bank.id, setId: "road", terrainId: 1 } } };

describe("tileset removal stamp dependencies", () => {
  it("counts an unpainted generated bank once across baked/road refs and archived recipes", () => {
    const affected = affectedTilesetStamps(bank.id, [smart], [{ tilesetId: bank.id, stamp }], [bank]);
    expect(affected).toEqual([stamp.id]);
    const usage = summarizeUsage([], affected.length);
    expect(usage).toMatchObject({ cells: 0, levels: 0, stamps: 1, used: true });
    expect(usageText(usage)).toBe("1 stamp etkileniyor.");
  });
  it("counts source cells, inner-corner art and retained recipe dependencies after deleting the library stamp", () => {
    const recipes = [{ tilesetId: bank.id, stamp }];
    expect(affectedTilesetStamps("source", [smart], recipes, [bank])).toEqual([stamp.id]);
    expect(affectedTilesetStamps("inner", [], recipes, [bank])).toEqual([stamp.id]);
    expect(affectedTilesetStamps("source", [], recipes, [bank])).toEqual([stamp.id]);
    expect(affectedTilesetStamps("source", [], recipes, [])).toEqual([]);
  });
  it("counts distinct affected stamps through dependent banks and ignores unused palette/grid entries", () => {
    const other: Stamp = { ...stamp, id: "other", palette: [{ tilesetId: bank.id, tileId: 0 }] };
    const unused: Stamp = { ...stamp, id: "unused", layers: [{ ...stamp.layers[0]!, cells: new Uint32Array(9) }] };
    expect(affectedTilesetStamps("source", [smart, other, unused], [], [bank])).toEqual(["other", "road"]);
    expect(affectedTilesetStamps("irrelevant", [smart, other], [], [bank])).toEqual([]);
    expect(usageText(summarizeUsage([{ cells: 3, layers: ["l"], terrainCells: 0, terrains: 0 }], 2))).toContain("2 stamp etkileniyor.");
  });
});
