import { describe, expect, it } from "vitest";

import { changeWeight, inRandomSet, randomChances, toggleInSet } from "./randomBrush";

const a = { tilesetId: "ts", tileId: 1 };
const b = { tilesetId: "ts", tileId: 2 };
const c = { tilesetId: "other", tileId: 1 };

describe("random brush set", () => {
  it("starts from the selected tile", () => {
    const r = toggleInSet([], a, b);
    expect(r.randomSet).toEqual([a, b]);
    expect(r.selection).toEqual(a);
  });

  it("a single tile without a selection is a plain selection", () => {
    const r = toggleInSet([], null, b);
    expect(r.randomSet).toEqual([]);
    expect(r.selection).toEqual(b);
  });

  it("toggling the selected tile itself does not make a set", () => {
    expect(toggleInSet([], a, a)).toEqual({ randomSet: [], selection: a });
  });

  it("adds and removes; tiles of different tilesets are distinct", () => {
    let r = toggleInSet([a, b], a, c);
    expect(r.randomSet).toEqual([a, b, c]);
    expect(inRandomSet(r.randomSet, c)).toBe(true);
    r = toggleInSet(r.randomSet, r.selection, a);
    expect(r.randomSet).toEqual([b, c]);
    expect(r.selection).toEqual(b);
  });

  it("collapses to a plain selection below two tiles", () => {
    const r = toggleInSet([a, b], a, b);
    expect(r.randomSet).toEqual([]);
    expect(r.selection).toEqual(a);
  });

  it("weights clamp to 1..9 and weight 1 is stored as none", () => {
    let set = changeWeight([a, b], b, 3);
    expect(set[1]).toEqual({ ...b, weight: 4 });
    set = changeWeight(set, b, 20);
    expect(set[1]!.weight).toBe(9);
    set = changeWeight(set, b, -100);
    expect(set[1]).toEqual(b);
    expect(randomChances([{ ...a, weight: 3 }, b])).toEqual([75, 25]);
  });
});

describe("random brush from a selection (round 4)", () => {
  it("each distinct non-empty tile of the stamp is a candidate; grid layers ignored", async () => {
    const { makeCell } = await import("@smap/core");
    const { candidatesFromClip } = await import("./randomBrush");
    const clip = {
      width: 3,
      height: 2,
      palette: [a, b, c],
      layers: [
        { layerId: "tiles", name: "t", cells: new Uint32Array([makeCell(1), 0, makeCell(2), makeCell(1), makeCell(3), 0]) },
        { layerId: "col", name: "c", grid: true, cells: new Uint32Array([1, 1, 1, 1, 1, 1]) },
      ],
    };
    expect(candidatesFromClip(clip)).toEqual([a, b, c]);
  });

  it("makeRandomFromStamp turns the brush stamp into a random set; one tile is refused", async () => {
    const { makeCell } = await import("@smap/core");
    const { makeRandomFromStamp, useRandomBrush } = await import("./randomBrush");
    const { useEditorStore } = await import("../state/editorStore");
    const s = useEditorStore.getState();
    s.setStamp({ width: 2, height: 1, palette: [a, b], layers: [{ layerId: "tiles", name: "t", cells: new Uint32Array([makeCell(1), makeCell(2)]) }] });
    expect(makeRandomFromStamp()).toBe(true);
    expect(useEditorStore.getState().randomSet).toEqual([a, b]);
    expect(useEditorStore.getState().stamp).toBeNull();
    expect(useEditorStore.getState().selection).toEqual(a);
    expect(useRandomBrush.getState().activeSetId).toBeNull();
    useEditorStore.getState().setStamp({ width: 2, height: 1, palette: [a], layers: [{ layerId: "tiles", name: "t", cells: new Uint32Array([makeCell(1), makeCell(1)]) }] });
    expect(makeRandomFromStamp()).toBe(false);
  });

  it("Alt + drag adds a rectangle without removing; an empty set starts from the rectangle alone", async () => {
    const { addToSet } = await import("./randomBrush");
    expect(addToSet([], a, [b, c]).randomSet).toEqual([b, c]);
    expect(addToSet([a, b], a, [b, c]).randomSet).toEqual([a, b, c]);
    expect(addToSet([], null, [b])).toEqual({ randomSet: [], selection: b });
  });

  it("brush ↔ saved set round trip keeps tiles, stamps, scatter and flip", async () => {
    const { randomSetOf, brushFromSet } = await import("./randomBrush");
    const options = { stamps: [{ kind: "stamp" as const, stampId: "house", weight: 2 }], scatter: 0.5, randomFlip: true, chunk: { w: 2, h: 2 }, activeSetId: "s1" };
    const set = randomSetOf([a, { ...b, weight: 3 }], options, "Çimen")!;
    expect(set.id).toBe("s1");
    expect(set.candidates).toHaveLength(3);
    const back = brushFromSet(set);
    expect(back.tiles).toEqual([a, { ...b, weight: 3 }]);
    expect(back.options).toEqual(options);
    // One candidate is not a random brush, unless it scatters.
    expect(randomSetOf([a], { ...options, stamps: [], scatter: 0 })).toBeNull();
    expect(randomSetOf([a], { ...options, stamps: [], scatter: 0.3 })).not.toBeNull();
  });

  it("picking a tile elsewhere (randomSet cleared) also clears stamp candidates", async () => {
    const { addStampToRandomSet, useRandomBrush, toggleRandomTile } = await import("./randomBrush");
    const { useEditorStore } = await import("../state/editorStore");
    useEditorStore.getState().setSelection(a);
    toggleRandomTile(b);
    addStampToRandomSet("tree");
    expect(useRandomBrush.getState().stamps).toHaveLength(1);
    useEditorStore.getState().setRandomSet([]);
    expect(useRandomBrush.getState().stamps).toHaveLength(0);
  });
});

describe("addStampToRandomSet: default chunk", () => {
  it("is the largest stamp candidate (a 1 × 1 chunk would overwrite placed stamps)", async () => {
    const { useProjectLibrary } = await import("../io/projectLibrary");
    const { addStampToRandomSet, useRandomBrush } = await import("./randomBrush");
    const mk = (id: string, width: number, height: number) => ({ id, name: id, width, height, layers: [] }) as never;
    useProjectLibrary.setState({ stamps: [mk("a", 3, 2), mk("b", 2, 4)] } as never);
    useRandomBrush.setState({ stamps: [], chunk: { w: 1, h: 1 }, scatter: 0, randomFlip: false, activeSetId: null });
    addStampToRandomSet("a");
    expect(useRandomBrush.getState().chunk).toEqual({ w: 3, h: 2 });
    addStampToRandomSet("b");
    expect(useRandomBrush.getState().chunk).toEqual({ w: 3, h: 4 });
    // A chunk the user chose is kept.
    useRandomBrush.setState({ stamps: [], chunk: { w: 8, h: 8 } });
    addStampToRandomSet("a");
    expect(useRandomBrush.getState().chunk).toEqual({ w: 8, h: 8 });
  });
});
