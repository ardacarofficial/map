import { FLIP_D, FLIP_H, FLIP_V, MapStore, cellFlags, createDocument, makeCell, type TileClip } from "@smap/core";
import { describe, expect, it } from "vitest";

import type { EditorState } from "../state/editorStore";
import { flippedRandomBrush, rotatedBrush, rotatesSelection } from "./rotateCommands";

function state(tile = 16, patch: Partial<EditorState> = {}) {
  const store = new MapStore(createDocument({ width: 8, height: 8, tileWidth: tile, tileHeight: 16 }));
  const layerId = store.dispatch({ type: "addLayer", layer: { name: "Zemin" } });
  return {
    project: { name: "p", store, levelPath: "levels/a.json" },
    activeLayerId: layerId,
    stamp: null,
    selection: { tilesetId: "ts", tileId: 3 },
    randomSet: [],
    ...patch,
  } as Pick<EditorState, "stamp" | "selection" | "randomSet" | "activeLayerId" | "project">;
}

describe("rotate the brush", () => {
  it("a single tile becomes a turned 1×1 stamp", () => {
    const r = rotatedBrush(state(), "cw");
    expect(r?.kind).toBe("stamp");
    const clip = (r as { stamp: TileClip }).stamp;
    expect([clip.width, clip.height]).toEqual([1, 1]);
    expect(clip.palette).toEqual([{ tilesetId: "ts", tileId: 3 }]);
    expect(cellFlags(clip.layers[0]!.cells[0]!)).toBe((FLIP_H | FLIP_D) >>> 0);
  });

  it("a stamp turns with core rotateClip (size swaps, saved fields kept)", () => {
    const stamp = Object.freeze({
      id: "house",
      name: "Ev",
      width: 2,
      height: 1,
      palette: [{ tilesetId: "ts", tileId: 1 }],
      layers: [{ layerId: "l", name: "Zemin", cells: Uint32Array.of(makeCell(1), 0) }],
    });
    const r = rotatedBrush(state(16, { stamp }), "cw") as { kind: "stamp"; stamp: TileClip & { id?: string } };
    expect([r.stamp.width, r.stamp.height]).toEqual([1, 2]);
    expect(r.stamp.id).toBe("house");
  });

  it("a random set turns every candidate; mirrors too", () => {
    const randomSet = [
      { tilesetId: "ts", tileId: 1 },
      { tilesetId: "ts", tileId: 2, flags: FLIP_H },
    ];
    const r = rotatedBrush(state(16, { randomSet }), "ccw") as { kind: "random"; set: { flags?: number }[] };
    expect(r.kind).toBe("random");
    expect(r.set.map((e) => e.flags ?? 0)).toEqual([(FLIP_V | FLIP_D) >>> 0, FLIP_D]);
    const f = flippedRandomBrush(state(16, { randomSet }), "x") as { kind: "random"; set: { flags?: number }[] };
    expect(f.set.map((e) => e.flags)).toEqual([FLIP_H, undefined]);
    expect(flippedRandomBrush(state(), "x")).toBeNull(); // not a random set: X / Y keep their path
  });

  it("non-square tiles do not turn; nothing chosen does nothing", () => {
    expect(rotatedBrush(state(32), "cw")).toEqual({ kind: "nonSquare" });
    expect(rotatedBrush(state(16, { selection: null }), "cw")).toBeNull();
  });
});

describe("Z with a marquee selection", () => {
  const region = { x: 1, y: 1, width: 3, height: 2 };
  it("turns the selection only with the select tool, a region and a cell layer", () => {
    const base = state();
    expect(rotatesSelection({ ...base, tool: "select", region })).toBe(true);
    expect(rotatesSelection({ ...base, tool: "brush", region })).toBe(false);
    expect(rotatesSelection({ ...base, tool: "select", region: null })).toBe(false);
    const store = base.project!.store;
    const entityId = store.dispatch({ type: "addLayer", layer: { name: "E", type: "entity" } });
    expect(rotatesSelection({ ...base, tool: "select", region, activeLayerId: entityId })).toBe(false);
  });
});
