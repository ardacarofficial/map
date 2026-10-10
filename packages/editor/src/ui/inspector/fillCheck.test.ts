import { createDocument, MapStore } from "@smap/core";
import { describe, expect, it } from "vitest";

import { fillBlocker } from "./fillCheck";

const tileset = { id: "ts", name: "TS", imagePath: "tilesets/ts.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0 };

function setup() {
  const store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [tileset] }));
  store.dispatch({ type: "addLayer", layer: { id: "a", name: "A" } });
  const brush = { activeLayerId: "a", gridValue: 1, stamp: null, selection: { tilesetId: "ts", tileId: 0 }, randomSet: [] };
  return { store, brush };
}

describe("fillBlocker", () => {
  it("allows a visible, unlocked tile layer with a tile brush", () => {
    const { store, brush } = setup();
    expect(fillBlocker(store.document, brush)).toBeNull();
  });

  // Bug: "Doldur" looked enabled on a hidden layer, but the canvas never paints hidden layers,
  // so the click silently did nothing.
  it("blocks a hidden layer (the canvas does not paint it)", () => {
    const { store, brush } = setup();
    store.dispatch({ type: "setLayerProps", layerId: "a", props: { visible: false } });
    expect(fillBlocker(store.document, brush)).toBe("selectionBar.fillHidden");
  });
});
