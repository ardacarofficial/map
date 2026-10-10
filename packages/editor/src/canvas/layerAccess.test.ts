import { MapStore, createDocument, type TileClip } from "@smap/core";
import { describe, expect, it } from "vitest";

import { layerInfo, savedStamp } from "./layerAccess";
import { isPaintable } from "./tools";

describe("layerInfo", () => {
  it("entity and locked layers take no paint", () => {
    const store = new MapStore(createDocument({ width: 8, height: 8 }));
    store.dispatch({ type: "addLayer", layer: { id: "plain", name: "Plain" } });
    store.dispatch({ type: "addLayer", layer: { id: "locked", name: "Locked" } });
    store.dispatch({ type: "setLayerProps", layerId: "locked", props: { locked: true } });
    const doc = store.document;
    expect(isPaintable(layerInfo(doc.getLayer("plain")!, doc))).toBe(true);
    expect(isPaintable(layerInfo(doc.getLayer("locked")!, doc))).toBe(false);
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
