import { createDocument, makeCell, MapStore, serializeLevel } from "@smap/core";
import { describe, expect, it } from "vitest";

import { applyMapOps, hasChanges, mapSettingsChanges, parseHexColor, type MapSettingsCurrent } from "./mapSettingsModel";

const current: MapSettingsCurrent = { name: "Köy", width: 10, height: 8, background: null, world: { x: 0, y: 0 } };
const form = { ...current, anchor: 0 as const };

describe("map settings", () => {
  it("parses colours", () => {
    expect(parseHexColor("#AbC")).toBe("#aabbcc");
    expect(parseHexColor(" 11171C ")).toBe("#11171c");
    expect(parseHexColor("")).toBeNull();
    expect(parseHexColor("#12")).toBeUndefined();
  });

  it("finds nothing to do when unchanged", () => {
    expect(hasChanges(mapSettingsChanges(current, form))).toBe(false);
    expect(mapSettingsChanges(current, { ...form, name: "  " }).rename).toBeNull();
  });

  it("splits level ops from list edits", () => {
    const c = mapSettingsChanges(current, { ...form, name: "Zindan", width: 12, anchor: 8, background: "#203040", world: { x: 64, y: 0 } });
    expect(c.ops).toEqual([
      { type: "resizeMap", width: 12, height: 8, offsetX: 2, offsetY: 0 },
      { type: "setMapProps", background: "#203040" },
    ]);
    expect(c.rename).toBe("Zindan");
    expect(c.world).toEqual({ x: 64, y: 0 });
  });

  it("applies size + background as one undo step", () => {
    const store = new MapStore(createDocument({ width: 10, height: 8 }));
    const layerId = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
    store.dispatch({ type: "addTileset", tileset: { id: "ts", name: "TS", imagePath: "tilesets/ts.png", tileWidth: 32, tileHeight: 32, columns: 2, rows: 2, margin: 0, spacing: 0 } });
    store.dispatch({ type: "paintCells", layerId, cells: [{ x: 9, y: 7, cell: makeCell(store.getOrAddPaletteIndex("ts", 1)) }] });
    store.clearHistory();
    const before = serializeLevel(store.document);

    const { ops } = mapSettingsChanges(current, { ...form, width: 6, height: 5, background: "#102030" });
    expect(applyMapOps(store, ops, "Harita ayarları")).toBe(true);
    expect(store.document.map.width).toBe(6);
    expect(store.document.background).toBe("#102030");
    expect(store.undoDepth).toBe(1);
    expect(store.historyEntries()[0]?.label).toBe("Harita ayarları");

    store.undo();
    expect(serializeLevel(store.document)).toBe(before);
    store.redo();
    expect(store.document.map.height).toBe(5);
    expect(store.document.background).toBe("#102030");
  });

  it("rolls back when an op fails", () => {
    const store = new MapStore(createDocument({ width: 10, height: 8 }));
    expect(() => applyMapOps(store, [{ type: "setMapProps", background: "#123456" }, { type: "setMapProps", background: "nope" }])).toThrow();
    expect(store.document.background).toBeNull();
    expect(store.inTransaction).toBe(false);
  });
});
