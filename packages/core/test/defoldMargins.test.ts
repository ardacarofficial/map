import { decode, encode } from "fast-png";
import { expect, it } from "vitest";
import { createDocument, makeCell, MapStore, type Tileset } from "../src";
import { DefoldExportError, exportDefold } from "../src/export/defold";
import { defoldPng } from "../src/export/defold/png";

for (const spacing of [0, 2, 5]) it(`preserves every pixel and native frame count with outer margin 1, spacing ${spacing}`, () => {
  const atlas: Tileset = { id: "a", name: "Atlas", imagePath: "a.png", tileWidth: 2, tileHeight: 2, columns: 4, rows: 2, margin: 1, spacing };
  const width = 2 + 8 + spacing * 3, height = 2 + 4 + spacing;
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 17 + Math.floor(i / 4) * 11) & 255);
  const source = encode({ width, height, data, channels: 4, depth: 8 });
  const before = source.slice();
  const store = new MapStore(createDocument({ width: 4, height: 2, tileWidth: 2, tileHeight: 2, tilesets: [atlas] }));
  store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
  store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex("a", 0)) }] });
  const files = exportDefold(store.document, "fixture", () => source);
  const imageFile = files.find((file) => file.path.endsWith(".png"))!;
  if (!("bytes" in imageFile)) throw new Error("PNG bytes missing");
  const output = decode(imageFile.bytes);
  const tileSource = files.find((file) => file.path.endsWith(".tilesource"))!;
  if (!("text" in tileSource)) throw new Error("Tile source missing");
  const field = (name: string) => Number(new RegExp(`${name}: (\\d+)`).exec(tileSource.text)![1]);
  const margin = field("tile_margin"), nativeSpacing = field("tile_spacing");
  // Exact pinned TileSetUtil.calculateTileCount formula, not Tiled's formula.
  expect(Math.floor((output.width + nativeSpacing) / (2 + 2 * margin + nativeSpacing))).toBe(4);
  expect(Math.floor((output.height + nativeSpacing) / (2 + 2 * margin + nativeSpacing))).toBe(2);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const from = ((1 + row * (2 + spacing) + y) * width + 1 + col * (2 + spacing) + x) * 4;
      const to = ((margin + row * (2 + 2 * margin + nativeSpacing) + y) * output.width + margin + col * (2 + 2 * margin + nativeSpacing) + x) * 4;
      expect(output.data.slice(to, to + 4)).toEqual(data.slice(from, from + 4));
    }
  }
  expect(source).toEqual(before);
});

it("reports a malformed margin-bearing texture without returning a partial file plan", () => {
  const atlas: Tileset = { id: "a", name: "Atlas", imagePath: "a.png", tileWidth: 2, tileHeight: 2, columns: 1, rows: 1, margin: 1, spacing: 0 };
  const store = new MapStore(createDocument({ width: 1, height: 1, tileWidth: 2, tileHeight: 2, tilesets: [atlas] }));
  store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
  store.dispatch({ type: "paintCells", layerId: "a", cells: [{ x: 0, y: 0, cell: makeCell(store.getOrAddPaletteIndex("a", 0)) }] });
  expect(() => exportDefold(store.document, "fixture", () => new Uint8Array([137]))).toThrow(DefoldExportError);
});

const grid: Tileset = { id: "a", name: "Atlas", imagePath: "a.png", tileWidth: 2, tileHeight: 2, columns: 4, rows: 2, margin: 1, spacing: 0 };
for (const depth of [1, 2, 4] as const) for (const indexed of [false, true]) {
  it(`crops ${depth}-bit ${indexed ? "indexed transparency" : "greyscale"} without changing packed samples`, () => {
    const stride = Math.ceil(10 * depth / 8), mask = (1 << depth) - 1;
    const data = new Uint8Array(stride * 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) {
      const at = y * stride + ((x * depth) >> 3), sample = (x * 3 + y) & mask;
      data[at] = data[at]! | sample << (8 - depth - ((x * depth) & 7));
    }
    const palette = Array.from({ length: 1 << depth }, (_, i) => [i * (255 / mask), 17, 99, i & 1 ? 255 : 0]);
    let source = encode({ width: 10, height: 6, data, channels: 1, depth, ...(indexed ? { palette: palette.map((color) => color.slice(0, 3)) } : {}) });
    // Build tRNS independently: nonopaque entries must retain their original
    // palette indices, including opaque entries between transparent entries.
    if (indexed) {
      const trns = chunk("tRNS", palette.map((color) => color[3]!));
      const offset = 33 + 12 + palette.length * 3; // after IHDR and PLTE
      const joined = new Uint8Array(source.length + trns.length);
      joined.set(source.subarray(0, offset)); joined.set(trns, offset); joined.set(source.subarray(offset), offset + trns.length);
      source = joined;
    }
    const result = decode(defoldPng(source, grid), { checkCrc: true });
    expect(result.depth).toBe(depth);
    expect(result.palette).toEqual(indexed ? palette : undefined);
    const outputStride = Math.ceil(8 * depth / 8);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
      const sample = result.data[y * outputStride + ((x * depth) >> 3)]! >> (8 - depth - ((x * depth) & 7)) & mask;
      expect(sample).toBe(((x + 1) * 3 + y + 1) & mask);
    }
  });
}

it("preserves 16-bit samples and Adam7-interlaced RGBA without resampling", () => {
  for (const depth of [8, 16] as const) {
    const data = depth === 16 ? Uint16Array.from({ length: 10 * 6 * 4 }, (_, i) => i * 251) : Uint8Array.from({ length: 10 * 6 * 4 }, (_, i) => i * 17);
    const source = encode({ width: 10, height: 6, channels: 4, depth, data }, { interlace: "Adam7" });
    const result = decode(defoldPng(source, grid), { checkCrc: true });
    expect(result.depth).toBe(depth);
    for (let y = 0; y < 4; y++) expect(result.data.slice(y * 8 * 4, (y + 1) * 8 * 4)).toEqual(data.slice(((y + 1) * 10 + 1) * 4, ((y + 1) * 10 + 9) * 4));
  }
});

/** Test-only chunk writer: independent CRC implementation for metadata oracles. */
function chunk(type: string, data: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) bytes[i + 4] = type.charCodeAt(i);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

it("retains RGB tRNS transparency and gAMA colour interpretation chunks", () => {
  const base = encode({ width: 10, height: 6, channels: 3, depth: 8, data: new Uint8Array(10 * 6 * 3).fill(17) });
  const gamma = chunk("gAMA", [0, 0, 177, 143]), trns = chunk("tRNS", [0, 17, 0, 17, 0, 17]);
  const source = new Uint8Array(base.length + gamma.length + trns.length);
  source.set(base.subarray(0, 33)); source.set(gamma, 33); source.set(trns, 33 + gamma.length); source.set(base.subarray(33), 33 + gamma.length + trns.length);
  const result = defoldPng(source, grid), image = decode(result, { checkCrc: true });
  expect(image.transparency).toEqual(new Uint16Array([17, 17, 17]));
  expect(result.slice(33, 33 + gamma.length)).toEqual(gamma);
});

it("copies zero-margin PNGs byte-for-byte", () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const output = defoldPng(bytes, { ...grid, margin: 0 });
  expect(output).toEqual(bytes);
  expect(output).not.toBe(bytes);
});
