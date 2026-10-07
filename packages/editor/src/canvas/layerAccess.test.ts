import { MapStore, createDocument, type TileClip } from "@smap/core";
import { describe, expect, it } from "vitest";

import { isDerivedLayer, layerInfo, savedStamp } from "./layerAccess";
import { isPaintable } from "./tools";

describe("derived tile layers", () => {
  it("count as locked for the paint tools", () => {
    const store = new MapStore(createDocument({ width: 8, height: 8 }));
    store.dispatch({ type: "addLayer", layer: { id: "tiles", name: "Tiles" } });
    store.dispatch({ type: "addLayer", layer: { id: "plain", name: "Plain" } });
    store.dispatch({ type: "addLayer", layer: { id: "terrain", name: "T", type: "grid", role: "terrain", targetLayerId: "tiles" } });
    const doc = store.document;
    expect(isDerivedLayer(doc, "tiles")).toBe(true);
    expect(isDerivedLayer(doc, "plain")).toBe(false);
    expect(isPaintable(layerInfo(doc.getLayer("tiles")!, doc))).toBe(false);
    expect(isPaintable(layerInfo(doc.getLayer("plain")!, doc))).toBe(true);
    expect(isPaintable(layerInfo(doc.getLayer("terrain")!, doc))).toBe(true);
  });
});

describe("savedStamp", () => {
  it("recognizes library stamps by id + name", () => {
    const clip: TileClip = { width: 1, height: 1, palette: [], layers: [] };
    const stamp = { ...clip, id: "ev", name: "Ev" };
    expect(savedStamp(clip)).toBeNull();
    expect(savedStamp(stamp)?.id).toBe("ev");
    expect(savedStamp(null)).toBeNull();
  });
});
