import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FLIP_V,
  FormatError,
  encodeBase64,
  makeCell,
  normalizeProject,
  parseLevel,
  parseProject,
  serializeLevel,
  serializeProject,
  type ProjectData,
} from "../src";
import { TILESET, makeStore } from "./helpers";

const PROJECT: ProjectData = {
  name: "Benim Dünyam",
  levels: [{ name: "main", path: "levels/main.json" }],
  tilesets: [TILESET, { ...TILESET, id: "walls", name: "Walls", imagePath: "tilesets/walls.png", margin: 1, spacing: 2 }],
};

function paintedStore() {
  const { store, ground, top } = makeStore(100, 70);
  store.dispatch({
    type: "paintCells",
    layerId: ground,
    cells: [{ x: 0, y: 0, cell: makeCell(1) }, { x: 99, y: 69, cell: makeCell(2, FLIP_V) }, { x: 40, y: 3, cell: makeCell(6) }],
  });
  store.dispatch({ type: "paintCells", layerId: top, cells: [{ x: 33, y: 33, cell: makeCell(3) }] });
  return store;
}

describe("project serialization", () => {
  it("has a fixed layout", () => {
    const text = serializeProject({ name: "P", levels: [], tilesets: [] });
    expect(text).toBe('{\n  "format": "smap-project",\n  "documentFormatVersion": 6,\n  "name": "P",\n  "levels": [],\n  "tilesets": []\n}\n');
  });

  it("roundtrips byte-identically", () => {
    const text = serializeProject(PROJECT);
    expect(parseProject(text)).toEqual(normalizeProject(PROJECT));
    expect(serializeProject(parseProject(text))).toBe(text);
    expect(text.includes("\r")).toBe(false);
  });

  it("key order does not depend on input object key order", () => {
    const shuffled = { tilesets: PROJECT.tilesets.map((t) => Object.fromEntries(Object.entries(t).reverse()) as unknown as typeof t), levels: PROJECT.levels, name: PROJECT.name };
    expect(serializeProject(shuffled)).toBe(serializeProject(PROJECT));
  });
});

describe("level serialization", () => {
  it("roundtrips byte-identically and preserves content", () => {
    const store = paintedStore();
    const text = serializeLevel(store.document);
    const doc = parseLevel(text, PROJECT.tilesets);
    expect(serializeLevel(doc)).toBe(text);
    expect(doc.getLayer("ground")?.getCell(99, 69)).toBe(makeCell(2, FLIP_V));
    expect(doc.getLayer("top")?.getCell(33, 33)).toBe(makeCell(3));
    expect(doc.palette.size).toBe(6);
    expect(doc.tilesets.map((t) => t.id)).toEqual(["grass", "walls"]);
  });

  it("writes chunks sorted by cy then cx, independent of paint order", () => {
    const a = makeStore(100, 100);
    const b = makeStore(100, 100);
    const points = [{ x: 90, y: 0 }, { x: 0, y: 90 }, { x: 40, y: 40 }, { x: 0, y: 0 }];
    for (const p of points) a.store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ ...p, cell: makeCell(1) }] });
    for (const p of [...points].reverse()) b.store.dispatch({ type: "paintCells", layerId: "ground", cells: [{ ...p, cell: makeCell(1) }] });
    const text = serializeLevel(a.store.document);
    expect(serializeLevel(b.store.document)).toBe(text);
    const chunks = (JSON.parse(text) as { layers: { chunks: { cx: number; cy: number }[] }[] }).layers[0]!.chunks;
    expect(chunks.map((c) => [c.cx, c.cy])).toEqual([[0, 0], [2, 0], [1, 1], [0, 2]]);
  });

  it("serialize → parse → serialize is byte-identical for random maps", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ x: fc.nat({ max: 79 }), y: fc.nat({ max: 49 }), i: fc.integer({ min: 0, max: 6 }), f: fc.constantFrom(0, FLIP_V) }),
          { maxLength: 100 },
        ),
        (writes) => {
          const { store } = makeStore(80, 50);
          store.dispatch({ type: "paintCells", layerId: "top", cells: writes.map((w) => ({ x: w.x, y: w.y, cell: makeCell(w.i, w.f) })) });
          const text = serializeLevel(store.document);
          expect(serializeLevel(parseLevel(text))).toBe(text);
        },
      ),
    );
  });
});

describe("parse validation", () => {
  const valid = () => JSON.parse(serializeLevel(paintedStore().document)) as Record<string, unknown> & {
    map: Record<string, unknown>;
    palette: Record<string, unknown>[];
    layers: (Record<string, unknown> & { chunks: Record<string, unknown>[] })[];
  };
  const expectError = (mutate: (level: ReturnType<typeof valid>) => void, pattern: RegExp) => {
    const level = valid();
    mutate(level);
    expect(() => parseLevel(JSON.stringify(level))).toThrow(FormatError);
    expect(() => parseLevel(JSON.stringify(level))).toThrow(pattern);
  };
  const chunkWith = (cells: [number, number][]) => {
    const bytes = new Uint8Array(4096);
    const view = new DataView(bytes.buffer);
    for (const [i, v] of cells) view.setUint32(i * 4, v, true);
    return encodeBase64(bytes);
  };

  it("rejects non-JSON and wrong file kinds", () => {
    expect(() => parseLevel("{")).toThrow(/not valid JSON/);
    expect(() => parseLevel("[]")).toThrow(/expected an object/);
    expect(() => parseLevel(serializeProject(PROJECT))).toThrow(/not a level file/);
    expect(() => parseProject(serializeLevel(paintedStore().document))).toThrow(/not a project file/);
  });

  it("rejects unknown future versions and bad versions", () => {
    expectError((l) => (l.documentFormatVersion = 7), /newer than supported/);
    expectError((l) => (l.documentFormatVersion = 0), /positive integer/);
    expectError((l) => delete l.documentFormatVersion, /documentFormatVersion/);
  });

  it("rejects bad map, palette and layer fields", () => {
    expectError((l) => (l.map.width = 0), /map: width/);
    expectError((l) => (l.map.tileWidth = "32"), /map\.tileWidth: expected a number/);
    expectError((l) => (l.palette[1]!.index = 7), /palette\[1\]\.index: expected 2/);
    expectError((l) => (l.palette[1]!.tileId = 0), /duplicate palette entry/);
    expectError((l) => (l.layers[0]!.type = "object"), /unsupported layer type/);
    expectError((l) => (l.layers[1]!.id = "ground"), /duplicate layer id/);
    expectError((l) => (l.layers[0]!.opacity = 1.5), /opacity/);
    expectError((l) => delete l.layers[0]!.visible, /layers\[0\]\.visible: expected a boolean, got nothing/);
  });

  it("rejects bad chunks", () => {
    expectError((l) => (l.layers[0]!.chunks[0]!.data = "!!!!"), /invalid base64/);
    expectError((l) => (l.layers[0]!.chunks[0]!.data = "AAAAAAAAAAA="), /expected 1024 cells/);
    expectError((l) => (l.layers[0]!.chunks[0]!.cx = 99), /outside the map/);
    expectError((l) => (l.layers[0]!.chunks[0]!.cx = -1), /outside the map/);
    expectError((l) => l.layers[0]!.chunks.push({ ...l.layers[0]!.chunks[0]! }), /duplicate chunk/);
    expectError((l) => (l.layers[0]!.chunks[0]!.data = chunkWith([[5, 99]])), /palette index 99/);
    expectError((l) => (l.layers[0]!.chunks[0]!.data = chunkWith([[5, 0x80000000]])), /invalid cell value/);
    // map is 100×70: chunk (3, 2) covers x 96..127, y 64..95; (31,31) local → (127, 95) outside.
    expectError((l) => (l.layers[0]!.chunks[0]!.cx = 3, l.layers[0]!.chunks[0]!.cy = 2, l.layers[0]!.chunks[0]!.data = chunkWith([[1023, 1]])), /outside the map at \(127, 95\)/);
  });

  it("drops all-empty chunks instead of storing them", () => {
    const level = valid();
    level.layers[1]!.chunks = [{ cx: 0, cy: 0, data: chunkWith([]) }];
    const doc = parseLevel(JSON.stringify(level));
    expect(doc.getLayer("top")?.chunkCount).toBe(0);
  });

  it("rejects bad project fields", () => {
    const bad = (mutate: (p: Record<string, unknown> & { levels: Record<string, unknown>[]; tilesets: Record<string, unknown>[] }) => void, pattern: RegExp) => {
      const p = JSON.parse(serializeProject(PROJECT));
      mutate(p);
      expect(() => parseProject(JSON.stringify(p))).toThrow(pattern);
    };
    bad((p) => (p.documentFormatVersion = 99), /newer than supported/);
    bad((p) => (p.levels[0]!.path = "C:/x.json"), /must be relative/);
    bad((p) => (p.levels[0]!.path = "levels\\main.json"), /separators/);
    bad((p) => p.levels.push({ ...p.levels[0]! }), /duplicate path/);
    bad((p) => (p.tilesets[1]!.id = "grass"), /duplicate id/);
    bad((p) => (p.tilesets[0]!.columns = 0), /columns must be a positive integer/);
    bad((p) => delete p.name, /name: expected a string/);
  });
});
