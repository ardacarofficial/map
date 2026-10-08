import { inferTileGrid } from "@smap/core";
import { describe, expect, it } from "vitest";

import { addableRows, isConfidentGuess, makeRow, parseSize, readAutoAdd, rowVerdict, setRowSize, setRowSpec, writeAutoAdd } from "./bulkModel";

const row = (fileName: string, width: number, height: number) =>
  makeRow({ key: "0", fileName, name: fileName.replace(".png", ""), width, height, suggestions: inferTileGrid({ width, height, fileName }).suggestions, fallback: 32 });

const map32 = { tileWidth: 32, tileHeight: 32 };

describe("bulk import rows", () => {
  it("parses sizes", () => {
    expect(parseSize("16")).toEqual({ tileWidth: 16, tileHeight: 16 });
    expect(parseSize("16x8")).toEqual({ tileWidth: 16, tileHeight: 8 });
    expect(parseSize(" 16 × 8 ")).toEqual({ tileWidth: 16, tileHeight: 8 });
    expect(parseSize("0")).toBeNull();
    expect(parseSize("abc")).toBeNull();
  });

  it("prefills from the guess and gives ✓ with the reason for a safe one", () => {
    const r = row("grass-32.png", 256, 128);
    expect(r.sizeText).toBe("32");
    const v = rowVerdict(r, map32);
    expect(v.kind).toBe("ok");
    expect(v.kind !== "invalid" && [v.columns, v.rows]).toEqual([8, 4]);
    expect(v.reason).toBe("dosya adından");
  });

  it("warns about a tile size other than the map's and about leftover pixels", () => {
    expect(rowVerdict(row("dungeon-16.png", 96, 64), map32)).toMatchObject({ kind: "warn", reason: "Harita tile'ı 32 px" });
    const edited = setRowSize(row("grass-32.png", 256, 128), "48");
    expect(edited.spec).toEqual({ tileWidth: 48, tileHeight: 48, margin: 0, spacing: 0 });
    expect(rowVerdict(edited, map32)).toMatchObject({ kind: "warn", columns: 5, rows: 2, reason: "16/32 px artıyor" });
  });

  it("an invalid size or no tile is not addable", () => {
    const bad = setRowSize(row("grass-32.png", 256, 128), "x");
    expect(rowVerdict(bad, map32).kind).toBe("invalid");
    const huge = setRowSize(row("grass-32.png", 256, 128), "512");
    expect(rowVerdict(huge, map32).kind).toBe("invalid");
    expect(addableRows([bad, huge, row("a-32.png", 64, 64)], map32)).toHaveLength(1);
  });

  it("the detailed card's result replaces the row's grid and name", () => {
    const r = setRowSpec(row("grass-32.png", 256, 128), "Çimen", { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });
    expect(r.name).toBe("Çimen");
    expect(r.sizeText).toBe("16");
  });
});

describe("confident guess (add without asking)", () => {
  it("needs the file name or gutters, no leftover and the map's tile size", () => {
    expect(isConfidentGuess(inferTileGrid({ width: 256, height: 128, fileName: "grass-32.png" }).suggestions, map32)).toBe(true);
    expect(isConfidentGuess(inferTileGrid({ width: 96, height: 64, fileName: "dungeon-16.png" }).suggestions, map32)).toBe(false);
    expect(isConfidentGuess(inferTileGrid({ width: 256, height: 128, fileName: "grass.png" }).suggestions, map32)).toBe(false);
    expect(isConfidentGuess(inferTileGrid({ width: 250, height: 128, fileName: "grass-32.png" }).suggestions, map32)).toBe(false);
    expect(isConfidentGuess([], map32)).toBe(false);
  });

  it("the preference is remembered", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readAutoAdd(storage)).toBe(false);
    writeAutoAdd(true, storage);
    expect(readAutoAdd(storage)).toBe(true);
  });
});
