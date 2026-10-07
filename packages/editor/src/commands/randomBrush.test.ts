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
