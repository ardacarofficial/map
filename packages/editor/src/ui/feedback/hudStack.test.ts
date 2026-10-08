import { describe, expect, it } from "vitest";

import { hudBottom } from "./hudStack";

describe("undo pill stacking above toasts", () => {
  const container = 800;
  it("stays at its base without toasts or pill", () => {
    expect(hudBottom(null, { left: 0, right: 360, top: 700, bottom: 788 }, container, 16)).toBe(16);
    expect(hudBottom({ left: 300, right: 500 }, null, container, 16)).toBe(16);
  });

  it("stays at its base when the toasts are in other columns", () => {
    expect(hudBottom({ left: 600, right: 800 }, { left: 16, right: 376, top: 700, bottom: 788 }, container, 16)).toBe(16);
  });

  it("moves above overlapping toasts with a gap, so the two never overlap", () => {
    const pill = { left: 200, right: 450 };
    const toasts = { left: 16, right: 376, top: 640, bottom: 788 };
    const bottom = hudBottom(pill, toasts, container, 16);
    expect(bottom).toBe(800 - 640 + 8);
    // Pill's lower edge (from the top) is above the toasts' top edge.
    expect(container - bottom).toBeLessThan(toasts.top);
  });

  it("treats near-touching columns as shared (gap applies sideways too)", () => {
    expect(hudBottom({ left: 380, right: 600 }, { left: 16, right: 376, top: 700, bottom: 788 }, container, 16)).toBe(108);
  });
});
