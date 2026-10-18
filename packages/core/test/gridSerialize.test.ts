import { describe, expect, it } from "vitest";
import { copyRegion, cutRegion, flipClip, parseClip, parseLevel, pasteClip, serializeClip, serializeLevel } from "../src";
import { makeStore } from "./helpers";

describe("manual grid serialization and clips", () => {
  it("preserves grid values, layer properties and bytes across save/reopen, flip, paste, cut and undo", () => {
    const { store } = makeStore(40,36);
    store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Collision", type: "grid", role: "collision", opacity: 0.5 } });
    store.dispatch({ type: "paintGrid", layerId: "collision", cells: [{x:3,y:3,value:1},{x:35,y:33,value:2}] });
    const before = serializeLevel(store.document);
    expect(serializeLevel(parseLevel(before,store.document.tilesets))).toBe(before);
    const clip = copyRegion(store.document,["collision"],{x:2,y:2,width:3,height:3});
    expect(serializeClip(parseClip(serializeClip(clip)))).toBe(serializeClip(clip));
    pasteClip(store,flipClip(clip,"x"),null,10,10);
    expect(store.document.getLayer("collision")!.getCell(11,11)).toBe(1);
    store.undo(); expect(serializeLevel(store.document)).toBe(before);
    cutRegion(store,["collision"],{x:2,y:2,width:3,height:3});
    expect(store.document.getLayer("collision")!.getCell(3,3)).toBe(0);
    store.undo(); expect(serializeLevel(store.document)).toBe(before);
  });
  it("rejects unknown grid roles and values above 2", () => {
    const { store } = makeStore(3,3);
    store.dispatch({ type: "addLayer", layer: { id: "collision", name: "Collision", type: "grid", role: "collision" } });
    expect(() => store.dispatch({ type: "paintGrid", layerId: "collision", cells: [{x:0,y:0,value:3}] })).toThrow(/value/);
    const root = JSON.parse(serializeLevel(store.document)); root.layers.at(-1).role = "unknown";
    expect(() => parseLevel(JSON.stringify(root))).toThrow(/role/);
  });
});
