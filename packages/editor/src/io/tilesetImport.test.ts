import { describe, expect, it } from "vitest";

import { hasPngSignature, inferTileSize, looksLikePng, planTileset, slugify, uniqueId } from "./tilesetImport";

describe("slugify", () => {
  it("makes safe ids from file names", () => {
    expect(slugify("overworld-32.png")).toBe("overworld-32");
    expect(slugify("Çimen Kenarı (Yeni).PNG")).toBe("cimen-kenari-yeni");
    expect(slugify("Şöğüt İğne.png")).toBe("sogut-igne");
    expect(slugify("???.png")).toBe("tileset");
  });
});

describe("uniqueId", () => {
  it("appends a number when taken", () => {
    expect(uniqueId("a", new Set())).toBe("a");
    expect(uniqueId("a", new Set(["a"]))).toBe("a-2");
    expect(uniqueId("a", new Set(["a", "a-2"]))).toBe("a-3");
  });
});

describe("inferTileSize", () => {
  it("defaults to 32", () => {
    expect(inferTileSize(256, 256)).toBe(32);
    expect(inferTileSize(100, 70)).toBe(32);
  });
  it("falls back to 16 when only 16 divides", () => {
    expect(inferTileSize(48, 80)).toBe(16);
  });
  it("uses a size hint in the file name when it divides the image", () => {
    expect(inferTileSize(96, 64, "dungeon-16.png")).toBe(16);
    expect(inferTileSize(256, 192, "blob47-32.png")).toBe(32);
    expect(inferTileSize(256, 256, "tiles_64px.png")).toBe(64);
    expect(inferTileSize(256, 256, "level-7.png")).toBe(32);
    expect(inferTileSize(100, 100, "x-16.png")).toBe(32);
  });
});

describe("PNG detection", () => {
  it("checks MIME type / extension and signature", () => {
    expect(looksLikePng({ name: "a.png", type: "image/png" })).toBe(true);
    expect(looksLikePng({ name: "a.PNG", type: "" })).toBe(true);
    expect(looksLikePng({ name: "a.jpg", type: "image/jpeg" })).toBe(false);
    expect(hasPngSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(hasPngSignature(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
  });
});

describe("planTileset", () => {
  it("builds metadata from the image size", () => {
    const plan = planTileset("overworld-32.png", 256, 256, 32, new Set());
    expect(plan).toEqual({
      tileset: {
        id: "overworld-32",
        name: "overworld-32",
        imagePath: "tilesets/overworld-32.png",
        tileWidth: 32,
        tileHeight: 32,
        columns: 8,
        rows: 8,
        margin: 0,
        spacing: 0,
      },
      uneven: false,
    });
  });
  it("flags uneven images and makes ids unique", () => {
    const plan = planTileset("a.png", 100, 64, 32, new Set(["a"]));
    expect(plan?.tileset.id).toBe("a-2");
    expect(plan?.tileset.imagePath).toBe("tilesets/a-2.png");
    expect(plan?.tileset.columns).toBe(3);
    expect(plan?.uneven).toBe(true);
  });
  it("returns null when no tile fits", () => {
    expect(planTileset("tiny.png", 16, 16, 32, new Set())).toBeNull();
  });
});
