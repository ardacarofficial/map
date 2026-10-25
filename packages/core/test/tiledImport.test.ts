// eslint-disable-next-line no-restricted-imports -- fixtures on disk (the importer itself stays file-system free)
import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FLIP_D, FLIP_H, FLIP_V, MapStore, encodeBase64, TiledImportError, createDocument, exportTmj, makeCell, parseTiledMap, parseTiledTileset, parseXml,
  resolveTiledPath, tiledCellLayers, type TiledMapDef, type Tileset,
} from "../src";

const root = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/[^/]*$/, "") + "/../../../e2e/fixtures/tiled/";
const read = (path: string) => readFileSync(root + path, "utf8");

function resolved(map: TiledMapDef) {
  return map.tilesets.map(t => t.def ?? parseTiledTileset(read(t.source.slice(t.source.indexOf("tilesets/"))), t.source));
}

describe("Tiled import parser", () => {
  for (const file of ["village.tmx", "village.tmj"]) it(`${file}: layers, tilesets, flips and unsupported items`, () => {
    const map = parseTiledMap(read(file), `/x/pack/${file}`);
    expect(map).toMatchObject({ name: "village", width: 8, height: 6, tileWidth: 16, tileHeight: 16 });
    expect(map.layers.map(l => [l.name, l.visible, l.opacity])).toEqual([["Ground", true, 1], ["Decor", true, 0.5], ["Upper/Roof", false, 1]]);
    expect(map.tilesets[0]).toEqual({ firstGid: 1, source: `/x/pack/tilesets/dungeon.${file.endsWith("tmx") ? "tsx" : "tsj"}` });
    expect(map.tilesets[1]!.def).toMatchObject({ name: "Props & Things", columns: 4, tileCount: 8, image: { path: "/x/pack/props-16.png", width: 64, height: 32 } });
    expect(map.tilesets[1]!.def!.unsupported).toEqual([{ kind: "animation", name: "Props & Things", count: 1 }]);
    expect(map.unsupported).toEqual([{ kind: "groupLayer", name: "Upper" }, { kind: "objectLayer", name: "Spawns" }]);
    const defs = resolved(map);
    expect(defs[0]).toMatchObject({ name: "Dungeon", tileWidth: 16, columns: 6, tileCount: 24, image: { path: "/x/pack/tilesets/dungeon-16.png" } });
    const { layers, unsupported } = tiledCellLayers(map, defs.map(d => d.tileCount));
    expect(layers[0]!.cells).toHaveLength(48);
    expect(layers[0]!.cells[0]).toEqual({ x: 0, y: 0, tileset: 0, tileId: 0, flags: 0 });
    const decor = Object.fromEntries(layers[1]!.cells.map(c => [`${c.x},${c.y}`, [c.tileset, c.tileId, c.flags >>> 0]]));
    expect(decor).toEqual({
      "1,1": [1, 0, 0], "2,1": [1, 1, FLIP_H >>> 0], "3,1": [1, 2, FLIP_V], "4,1": [1, 3, FLIP_D],
      "5,1": [1, 4, (FLIP_H | FLIP_V | FLIP_D) >>> 0], "6,2": [0, 2, FLIP_H >>> 0],
    });
    expect(layers[2]!.cells.map(c => [c.x, c.y, c.tileset, c.tileId, c.flags >>> 0])).toEqual([[0, 0, 1, 5, 0], [7, 5, 1, 7, FLIP_V]]);
    expect(unsupported).toEqual([{ kind: "unknownTile", count: 1 }]);
  });

  it("unusable tilesets are skipped and counted per tileset", () => {
    const map = parseTiledMap(read("village.tmx"), "village.tmx");
    const { layers, skipped } = tiledCellLayers(map, [24, null]);
    expect(skipped).toEqual([0, 8]);
    expect(layers[1]!.cells).toHaveLength(1);
  });

  it("TMJ export → import keeps every flip combination and tile id", () => {
    const tileset: Tileset = { id: "a", name: "A", imagePath: "tilesets/a.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0 };
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 15 }), fc.integer({ min: 0, max: 7 })), { minLength: 12, maxLength: 12 }), (cells) => {
      const store = new MapStore(createDocument({ width: 4, height: 3, tileWidth: 16, tileHeight: 16 }));
      store.dispatch({ type: "addTileset", tileset });
      store.dispatch({ type: "addLayer", layer: { id: "g", name: "G" } });
      const flagOf = (m: number) => ((m & 4 ? FLIP_H : 0) | (m & 2 ? FLIP_V : 0) | (m & 1 ? FLIP_D : 0)) >>> 0;
      store.dispatch({ type: "paintCells", layerId: "g", cells: cells.map(([t, m], i) => ({ x: i % 4, y: Math.floor(i / 4), cell: makeCell(store.getOrAddPaletteIndex("a", t), flagOf(m)) })) });
      const back = parseTiledMap(exportTmj(store.document, "m").text, "/out/m.tmj");
      const out = tiledCellLayers(back, [16]).layers[0]!.cells;
      expect(out.map(c => [c.tileId, c.flags])).toEqual(cells.map(([t, m]) => [t, flagOf(m)]));
    }), { numRuns: 30 });
  });

  it("infinite maps are cropped to their content", () => {
    const tmj = { type: "map", orientation: "orthogonal", infinite: true, width: 0, height: 0, tilewidth: 8, tileheight: 8, tilesets: [{ firstgid: 1, name: "t", tilewidth: 8, tileheight: 8, columns: 2, tilecount: 4, image: "t.png", imagewidth: 16, imageheight: 16 }],
      layers: [{ type: "tilelayer", name: "L", chunks: [{ x: -16, y: -16, width: 16, height: 16, data: Array.from({ length: 256 }, (_, i) => (i === 255 ? 2 : 0)) }, { x: 0, y: 0, width: 16, height: 16, data: Array.from({ length: 256 }, (_, i) => (i === 17 ? 3 : 0)) }] }] };
    const map = parseTiledMap(JSON.stringify(tmj), "m.tmj");
    expect([map.width, map.height]).toEqual([3, 3]);
    expect(tiledCellLayers(map, [4]).layers[0]!.cells.map(c => [c.x, c.y, c.tileId])).toEqual([[0, 0, 1], [2, 2, 2]]);
  });

  it("TMX infinite chunks and <tile> data", () => {
    const tmx = `<map orientation="orthogonal" width="2" height="1" tilewidth="8" tileheight="8"><tileset firstgid="1" name="t" tilewidth="8" tileheight="8" columns="2" tilecount="4"><image source="t.png"/></tileset>
      <layer name="L" width="2" height="1"><data><tile gid="2"/><tile/></data></layer></map>`;
    expect(Array.from(parseTiledMap(tmx, "a.tmx").layers[0]!.gids)).toEqual([2, 0]);
    const z = encodeBase64(zlibSync(new Uint8Array(new Uint32Array([0, 5]).buffer)));
    const inf = `<map orientation="orthogonal" width="2" height="1" tilewidth="8" tileheight="8" infinite="1"><layer name="L" width="2" height="1"><data encoding="base64" compression="zlib"><chunk x="4" y="2" width="2" height="1">${z}</chunk></data></layer></map>`;
    const map = parseTiledMap(inf, "b.tmx");
    expect([map.width, map.height, Array.from(map.layers[0]!.gids)]).toEqual([1, 1, [5]]);
  });

  it("refuses what cannot be read", () => {
    const code = (text: string) => { try { parseTiledMap(text, "m.tmx"); return null; } catch (e) { return e instanceof TiledImportError ? e.code : String(e); } };
    expect(code(`<map orientation="isometric" width="1" height="1" tilewidth="8" tileheight="4"/>`)).toBe("orientation");
    expect(code(`<map width="1" height="1" tilewidth="8" tileheight="8"><layer name="L"><data encoding="base64" compression="zstd">AAAA</data></layer></map>`)).toBe("compression");
    expect(code(`<map width="1" height="1" tilewidth="8" tileheight="8"><objectgroup name="O"/></map>`)).toBe("noTileLayers");
    expect(code(`<map width="2" height="1" tilewidth="8" tileheight="8"><layer name="L"><data encoding="csv">1</data></layer></map>`)).toBe("format");
    expect(code(`{"type":"tileset"}`)).toBe("format");
    expect(code(`hello`)).toBe("format");
    expect(code(`<map width="5000" height="5000" tilewidth="8" tileheight="8"><layer name="L"><data encoding="csv">1</data></layer></map>`)).toBe("size");
  });

  it("paths and XML basics", () => {
    expect(resolveTiledPath("C:\\Packs\\maps\\a.tmx", "..\\tiles\\t.tsx")).toBe("C:/Packs/tiles/t.tsx");
    expect(resolveTiledPath("/a/b/c.tmj", "../../../x.png")).toBe("/x.png");
    expect(resolveTiledPath("/a/b/c.tmj", "/abs/y.png")).toBe("/abs/y.png");
    expect(resolveTiledPath("c.tmj", "./t/../u.png")).toBe("u.png");
    const x = parseXml(`<?xml version="1.0"?><!-- c --><a k='1 &lt; 2'><b/>t&#65;<![CDATA[<x>]]></a>`);
    expect([x.name, x.attrs.k, x.children[0]!.name, x.text]).toEqual(["a", "1 < 2", "b", "tA<x>"]);
    expect(() => parseXml("<a><b></a>")).toThrow();
  });
});
