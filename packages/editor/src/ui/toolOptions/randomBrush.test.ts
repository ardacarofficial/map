import { createDocument, makeCell, MapStore, type RandomSet, type TileClip } from "@smap/core";
import { beforeEach, describe, expect, it } from "vitest";

import { addTilesToRandom, clearRandomSet, currentRandomSet, loadRandomSet, makeRandomFromStamp, useRandomBrush } from "../../commands/randomBrush";
import { useEditorStore } from "../../state/editorStore";
import { canRandomizeClip, toggleRandomBrush } from "./randomBrush";

const a = { tilesetId: "tiles", tileId: 1 };
const b = { tilesetId: "tiles", tileId: 2 };
const c = { tilesetId: "tiles", tileId: 3 };
const clip: TileClip = {
  width: 3, height: 1, palette: [a, b],
  layers: [{ layerId: "ground", name: "Ground", cells: new Uint32Array([makeCell(1), 0, makeCell(2)]) }],
};
const sets: RandomSet[] = [
  { id: "first", name: "First", candidates: [{ kind: "tile", ...a }, { kind: "tile", ...b }] },
  { id: "last", name: "Last", candidates: [{ kind: "tile", ...b }, { kind: "tile", ...c }] },
];

let store: MapStore;

beforeEach(() => {
  store = new MapStore(createDocument({ width: 8, height: 8, tilesets: [{
    id: "tiles", name: "Tiles", imagePath: "tiles.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, margin: 0, spacing: 0,
  }] }));
  useEditorStore.getState().setProject({ name: "Test", store, levelPath: "levels/main.json" });
  clearRandomSet();
});

function saveSets() {
  for (const set of sets) store.dispatch({ type: "setRandomSet", set });
  store.clearHistory();
}

describe("random toggle eligibility", () => {
  it("requires two distinct non-empty tiles and rejects any grid layer", () => {
    expect(canRandomizeClip(null)).toBe(false);
    expect(canRandomizeClip(clip)).toBe(true);
    expect(canRandomizeClip({ ...clip, layers: [{ ...clip.layers[0]!, cells: new Uint32Array([0, 0, 0]) }] })).toBe(false);
    expect(canRandomizeClip({ ...clip, layers: [{ ...clip.layers[0]!, cells: new Uint32Array([makeCell(1), 0, makeCell(1)]) }] })).toBe(false);
    expect(canRandomizeClip({ ...clip, layers: [...clip.layers, { layerId: "collision", name: "Collision", grid: true, cells: new Uint32Array(3) }] })).toBe(false);
  });
});

describe("options-bar random toggle", () => {
  it("randomizes a clip, skips empty tiles and restores its exact clip and selection", () => {
    const s = useEditorStore.getState();
    s.setStamp(clip);
    s.setSelection(c);
    s.setTool("rect");
    toggleRandomBrush();
    expect(useEditorStore.getState().randomSet).toEqual([a, b]);
    expect(useEditorStore.getState().stamp).toBeNull();
    expect(useEditorStore.getState().tool).toBe("rect");
    toggleRandomBrush();
    expect(currentRandomSet()).toBeNull();
    expect(useEditorStore.getState().stamp).toBe(clip);
    expect(useEditorStore.getState().selection).toBe(c);
    expect(store.canUndo).toBe(false);
    expect(useEditorStore.getState().dirty).toBe(false);
  });

  it("keeps a remembered null selection", () => {
    useEditorStore.getState().setStamp(clip);
    toggleRandomBrush();
    toggleRandomBrush();
    expect(useEditorStore.getState().stamp).toBe(clip);
    expect(useEditorStore.getState().selection).toBeNull();
  });

  it("leaves a single tile or a mixed collision clip alone without saved sets", () => {
    const s = useEditorStore.getState();
    s.setSelection(c);
    toggleRandomBrush();
    expect(useEditorStore.getState().selection).toBe(c);
    expect(currentRandomSet()).toBeNull();
    const mixed = { ...clip, layers: [...clip.layers, { layerId: "collision", name: "Collision", grid: true, cells: new Uint32Array(3) }] };
    s.setStamp(mixed);
    toggleRandomBrush();
    expect(useEditorStore.getState().stamp).toBe(mixed);
    expect(currentRandomSet()).toBeNull();
  });

  it("uses the first saved set for a single tile and restores that tile", () => {
    saveSets();
    useEditorStore.getState().setSelection(c);
    toggleRandomBrush();
    expect(useRandomBrush.getState().activeSetId).toBe("first");
    toggleRandomBrush();
    expect(useEditorStore.getState().selection).toBe(c);
    expect(useEditorStore.getState().stamp).toBeNull();
  });

  it("remembers picker loads across clear, and falls back if that saved set was deleted", () => {
    saveSets();
    loadRandomSet("last");
    clearRandomSet();
    toggleRandomBrush();
    expect(useRandomBrush.getState().activeSetId).toBe("last");
    toggleRandomBrush();
    store.dispatch({ type: "removeRandomSet", id: "last" });
    toggleRandomBrush();
    expect(useRandomBrush.getState().activeSetId).toBe("first");
  });

  it("prefers the current eligible clip over saved sets, even for a saved stamp", () => {
    saveSets();
    loadRandomSet("last");
    clearRandomSet();
    useEditorStore.getState().setStamp({ ...clip, id: "saved-stamp" } as TileClip);
    toggleRandomBrush();
    expect(useEditorStore.getState().randomSet).toEqual([a, b]);
    expect(useRandomBrush.getState().activeSetId).toBeNull();
  });

  it("restores a mixed collision clip after temporarily loading a saved set", () => {
    saveSets();
    const mixed = { ...clip, layers: [...clip.layers, { layerId: "collision", name: "Collision", grid: true, cells: new Uint32Array(3) }] };
    useEditorStore.getState().setStamp(mixed);
    toggleRandomBrush();
    expect(useRandomBrush.getState().activeSetId).toBe("first");
    toggleRandomBrush();
    expect(useEditorStore.getState().stamp).toBe(mixed);
  });

  it("selects the first tile when random was started elsewhere", () => {
    addTilesToRandom([b, a]);
    toggleRandomBrush();
    expect(currentRandomSet()).toBeNull();
    expect(useEditorStore.getState().selection).toEqual(b);
    expect(useEditorStore.getState().stamp).toBeNull();
  });

  it("drops remembered brushes when used or when another brush is picked while off", () => {
    useEditorStore.getState().setStamp(clip);
    toggleRandomBrush();
    toggleRandomBrush();
    makeRandomFromStamp();
    toggleRandomBrush();
    expect(useEditorStore.getState().stamp).toBeNull();

    useEditorStore.getState().setStamp(clip);
    toggleRandomBrush();
    clearRandomSet();
    useEditorStore.getState().setSelection(c);
    addTilesToRandom([b, a]);
    toggleRandomBrush();
    expect(useEditorStore.getState().stamp).toBeNull();
    expect(useEditorStore.getState().selection).toEqual(b);
  });

  it("does not carry remembered brushes or the last loaded ID into another document", () => {
    saveSets();
    useEditorStore.getState().setStamp(clip);
    toggleRandomBrush();
    loadRandomSet("last");
    const next = new MapStore(createDocument({ width: 8, height: 8, tilesets: store.document.tilesets, randomSets: sets }));
    useEditorStore.getState().setProject({ name: "Other", store: next, levelPath: "levels/other.json" });
    toggleRandomBrush();
    expect(useRandomBrush.getState().activeSetId).toBe("first");
    toggleRandomBrush();
    expect(useEditorStore.getState().stamp).toBeNull();
    expect(useEditorStore.getState().selection).toBeNull();
  });
});
