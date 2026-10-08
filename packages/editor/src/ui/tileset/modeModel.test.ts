import { describe, expect, it } from "vitest";

import { contextMenuEnabled, isStroke, tilePointerAction } from "./modeModel";

const ctx = (button: number, extra: Partial<{ alt: boolean; pending: boolean; terrainId: number | null }> = {}) => ({
  button,
  alt: false,
  pending: false,
  terrainId: null,
  ...extra,
});

describe("tileset mouse model: left adds / selects, right removes", () => {
  it("Seç: left selects, Alt+left toggles random, right does nothing (menu)", () => {
    expect(tilePointerAction("pick", ctx(0))).toEqual({ kind: "select" });
    expect(tilePointerAction("pick", ctx(0, { alt: true }))).toEqual({ kind: "randomToggle" });
    expect(tilePointerAction("pick", ctx(2))).toEqual({ kind: "none" });
    expect(contextMenuEnabled("pick")).toBe(true);
  });

  it("Katı: left marks, right unmarks; both drag", () => {
    expect(tilePointerAction("solid", ctx(0))).toEqual({ kind: "solid", solid: true });
    expect(tilePointerAction("solid", ctx(2))).toEqual({ kind: "solid", solid: false });
    expect(isStroke(tilePointerAction("solid", ctx(2)))).toBe(true);
    expect(contextMenuEnabled("solid")).toBe(false);
  });

  it("Rastgele: left adds, right removes", () => {
    expect(tilePointerAction("random", ctx(0))).toEqual({ kind: "random", add: true });
    expect(tilePointerAction("random", ctx(2))).toEqual({ kind: "random", add: false });
  });

  it("Arazi: left places; right cancels a placed block, else deletes the terrain under the cursor", () => {
    expect(tilePointerAction("terrain", ctx(0, { terrainId: 3 }))).toEqual({ kind: "placeBlock" });
    expect(tilePointerAction("terrain", ctx(2, { pending: true, terrainId: 3 }))).toEqual({ kind: "cancelBlock" });
    expect(tilePointerAction("terrain", ctx(2, { terrainId: 3 }))).toEqual({ kind: "removeTerrain", terrainId: 3 });
    expect(tilePointerAction("terrain", ctx(2))).toEqual({ kind: "none" });
  });

  it("other buttons do nothing", () => {
    expect(tilePointerAction("solid", ctx(1))).toEqual({ kind: "none" });
  });
});
