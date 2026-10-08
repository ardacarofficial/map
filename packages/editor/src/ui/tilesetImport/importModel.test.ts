import { describe, expect, it } from "vitest";

import {
  alphaScanStats,
  applySpec,
  draftFromSpec,
  inferDraft,
  leftoverFix,
  leftoverMessage,
  parseDraft,
  pastedImage,
  readLastSpec,
  rememberSpec,
  setDraftField,
  setDraftLinked,
  sizeMismatchNote,
  suggestionChips,
  summarize,
  summaryLine,
} from "./importModel";

/** Alpha of a `w × h` image where tiles of `tile` px listed in `empty` are fully transparent. */
function alphaWithEmptyTiles(w: number, h: number, tile: number, empty: number[]): Uint8Array {
  const a = new Uint8Array(w * h).fill(255);
  const columns = Math.floor(w / tile);
  for (const id of empty) {
    const x0 = (id % columns) * tile;
    const y0 = Math.floor(id / columns) * tile;
    for (let y = y0; y < y0 + tile; y++) a.fill(0, y * w + x0, y * w + x0 + tile);
  }
  return a;
}

describe("inferDraft", () => {
  it("prefills from the file name", () => {
    const { draft, suggestions } = inferDraft({ name: "dungeon-16", fileName: "dungeon-16.png", image: { width: 96, height: 64, alpha: null }, hintSize: 32 });
    expect(draft).toMatchObject({ name: "dungeon-16", tileWidth: "16", tileHeight: "16", margin: "0", spacing: "0", linked: true });
    expect(suggestions[0]!.reasons).toContain("fileName");
    const chips = suggestionChips(suggestions);
    expect(chips[0]).toMatchObject({ size: "16×16", reason: "dosya adından" });
  });

  it("finds spacing from transparent gutters", () => {
    // 4 × 2 tiles of 16 px with 2 px transparent gaps: 70 × 34.
    const w = 4 * 16 + 3 * 2;
    const h = 2 * 16 + 2;
    const alpha = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x % 18 < 16 && y % 18 < 16) alpha[y * w + x] = 255;
    const { draft } = inferDraft({ name: "t", fileName: "t.png", image: { width: w, height: h, alpha } });
    expect([draft.tileWidth, draft.spacing, draft.margin]).toEqual(["16", "2", "0"]);
  });
});

describe("fields", () => {
  const base = draftFromSpec("Zindan", { tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });

  it("linked width and height change together", () => {
    expect(base.linked).toBe(true);
    const d = setDraftField(base, "tileWidth", "24");
    expect([d.tileWidth, d.tileHeight]).toEqual(["24", "24"]);
    const unlinked = setDraftField(setDraftLinked(d, false), "tileHeight", "32");
    expect([unlinked.tileWidth, unlinked.tileHeight]).toEqual(["24", "32"]);
    // Linking again makes it square.
    expect(setDraftLinked(unlinked, true).tileHeight).toBe("24");
  });

  it("a non-square spec starts unlinked; applying a spec keeps the name", () => {
    expect(draftFromSpec("x", { tileWidth: 16, tileHeight: 32, margin: 0, spacing: 0 }).linked).toBe(false);
    expect(applySpec({ ...base, name: "Yeni" }, { tileWidth: 8, tileHeight: 8, margin: 1, spacing: 2 })).toMatchObject({ name: "Yeni", tileWidth: "8", margin: "1", spacing: "2" });
  });

  it("parses and flags invalid fields", () => {
    expect(parseDraft(base).spec).toEqual({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 });
    const bad = parseDraft({ ...base, tileWidth: "0", margin: "-1", name: " " });
    expect(bad.spec).toBeNull();
    expect([...bad.invalid].sort()).toEqual(["margin", "tileWidth"]);
    expect(bad.nameOk).toBe(false);
  });
});

describe("summary and leftover", () => {
  it("counts tiles and empty tiles", () => {
    const alpha = alphaWithEmptyTiles(128, 96, 16, [3, 10, 47]);
    const s = summarize({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, { width: 128, height: 96, alpha })!;
    expect(s).toMatchObject({ columns: 8, rows: 6, count: 48, empty: 3, leftoverX: 0, leftoverY: 0, fix: null });
    expect(summaryLine(s)).toBe("8 × 6 = 48 tile · 3 boş");
    expect(leftoverMessage(s)).toBeNull();
  });

  it("reports leftover pixels with a margin / spacing that uses them", () => {
    // 6 tiles of 16 px + 5 gaps of 1 px + 2 px margin = 103 wide; 4 tiles + 3 gaps + 2 margins = 69.
    const s = summarize({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, { width: 103, height: 69, alpha: null })!;
    expect([s.leftoverX, s.leftoverY]).toEqual([7, 5]);
    expect(s.fix).toEqual({ tileWidth: 16, tileHeight: 16, margin: 1, spacing: 1 });
    expect(leftoverMessage(s)).toBe("Sağda 7 px, altta 5 px artıyor — margin/spacing önerisi: 1 / 1");
  });

  it("says the pixels are unused when no gap fits", () => {
    const s = summarize({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, { width: 103, height: 64, alpha: null })!;
    expect(s.fix).toBeNull();
    expect(leftoverMessage(s)).toBe("Sağda 7 px artıyor — artan pikseller kullanılmaz");
    expect(leftoverFix({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, 103, 64)).toBeNull();
  });

  // Bug: typing "16" into a selected field passes through "1": a 1 px grid over a 2048² sheet
  // scanned and listed millions of "empty" tiles (and drew one SVG square each) — seconds of freeze.
  it("skips the empty-tile scan for absurdly fine grids (typing through 1 px stays instant)", () => {
    const n = 2048;
    const alpha = new Uint8Array(n * n);
    const start = performance.now();
    const s = summarize({ tileWidth: 1, tileHeight: 1, margin: 0, spacing: 0 }, { width: n, height: n, alpha })!;
    expect(s.count).toBe(n * n);
    expect(s.emptyIds.size).toBe(0);
    expect(s.empty).toBe(0);
    expect(performance.now() - start).toBeLessThan(1000);
    // Normal grids still count empty tiles.
    expect(summarize({ tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 }, { width: n, height: n, alpha })!.empty).toBe(64 * 64);
  });

  it("returns null when not even one tile fits", () => {
    expect(summarize({ tileWidth: 64, tileHeight: 64, margin: 0, spacing: 0 }, { width: 32, height: 32, alpha: null })).toBeNull();
  });

  it("notes a tile size that differs from the map", () => {
    expect(sizeMismatchNote({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, { tileWidth: 32, tileHeight: 32 })).toContain("32×32");
    expect(sizeMismatchNote({ tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 }, { tileWidth: 32, tileHeight: 32 })).toBeNull();
    expect(sizeMismatchNote({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, null)).toBeNull();
  });
});

describe("remembered settings", () => {
  it("round-trips through storage and ignores junk", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(readLastSpec(storage)).toBeNull();
    rememberSpec({ tileWidth: 16, tileHeight: 16, margin: 1, spacing: 2 }, storage);
    expect(readLastSpec(storage)).toEqual({ tileWidth: 16, tileHeight: 16, margin: 1, spacing: 2 });
    map.set("smap.tilesetImport.last", "{bad");
    expect(readLastSpec(storage)).toBeNull();
    const throwing = { setItem: () => { throw new Error("blocked"); } };
    expect(() => rememberSpec({ tileWidth: 8, tileHeight: 8, margin: 0, spacing: 0 }, throwing)).not.toThrow();
  });
});

describe("pastedImage", () => {
  const png = { type: "image/png", name: "image.png" };
  const clip = (text: string, files: { type: string; name: string }[]) => ({ getData: () => text, files });

  it("picks a PNG from the clipboard", () => {
    expect(pastedImage(clip("", [png]))).toBe(png);
    expect(pastedImage(clip("https://example.com/a.png", [{ type: "text/html", name: "" }, png]))).toBe(png);
  });

  it("copied map cells win over an image", () => {
    expect(pastedImage(clip('{"smap-clip":1}', [png]))).toBeNull();
  });

  it("ignores other files and empty clipboards", () => {
    expect(pastedImage(clip("", [{ type: "image/jpeg", name: "a.jpg" }]))).toBeNull();
    expect(pastedImage(clip("hello", []))).toBeNull();
    expect(pastedImage(null)).toBeNull();
  });
});

describe("alpha scan cache", () => {
  it("scans an image once for any number of field edits", () => {
    const alpha = alphaWithEmptyTiles(256, 256, 16, [0, 3, 17]);
    const image = { width: 256, height: 256, alpha };
    const start = alphaScanStats.built;
    const specs = [16, 8, 32, 4, 16, 2, 64, 16].map((size) => ({ tileWidth: size, tileHeight: size, margin: 0, spacing: 0 }));
    const empties = specs.map((spec) => summarize(spec, image)!.empty);
    expect(alphaScanStats.built - start).toBe(1);
    expect(empties[0]).toBe(3);
    expect(empties[4]).toBe(3);
    // A copy of the info object with the same pixels reuses the scan too.
    summarize(specs[0]!, { ...image });
    expect(alphaScanStats.built - start).toBe(1);
    // Another image is scanned once.
    const other = { width: 256, height: 256, alpha: alphaWithEmptyTiles(256, 256, 16, []) };
    summarize(specs[0]!, other);
    summarize(specs[1]!, other);
    expect(alphaScanStats.built - start).toBe(2);
  });

  it("no alpha channel: no scan, no empty tiles", () => {
    const start = alphaScanStats.built;
    expect(summarize({ tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0 }, { width: 64, height: 64, alpha: null })!.empty).toBe(0);
    expect(alphaScanStats.built).toBe(start);
  });
});
