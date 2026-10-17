import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import { registerBuiltinToolOptions } from "./builtins";
import { stepBrushSize } from "./brushSize";
import { registerToolOptions, subscribeToolOptions, toolOptionsFor, toolOptionsVersion, type ToolOptionsContext } from "./registry";

const A: ComponentType = () => null;
const B: ComponentType = () => null;
const C: ComponentType = () => null;
const ctx = (tool: ToolOptionsContext["tool"], layer?: unknown): ToolOptionsContext => ({
  tool,
  brush: "none",
  doc: undefined,
  layer: layer as ToolOptionsContext["layer"],
});

describe("tool options registry", () => {
  it("returns only the entries of the current tool, in order", () => {
    const off = [
      registerToolOptions("fill", B, { id: "t.b", order: 20 }),
      registerToolOptions(["fill", "rect"], A, { id: "t.a", order: 10 }),
      registerToolOptions("brush", C, { id: "t.c" }),
    ];
    expect(toolOptionsFor(ctx("fill")).map((e) => e.id)).toEqual(["t.a", "t.b"]);
    expect(toolOptionsFor(ctx("rect")).map((e) => e.id)).toEqual(["t.a"]);
    expect(toolOptionsFor(ctx("select"))).toEqual([]);
    off.forEach((f) => f());
    expect(toolOptionsFor(ctx("fill"))).toEqual([]);
  });

  it("honours `when` (context) and 'all'", () => {
    const off = [
      registerToolOptions("all", A, { id: "t.all", order: 99 }),
      registerToolOptions("brush", B, { id: "t.grid", order: 1, when: (c) => c.layer !== undefined }),
    ];
    expect(toolOptionsFor(ctx("eyedropper")).map((e) => e.id)).toEqual(["t.all"]);
    expect(toolOptionsFor(ctx("brush")).map((e) => e.id)).toEqual(["t.all"]);
    expect(toolOptionsFor(ctx("brush", { id: "l" })).map((e) => e.id)).toEqual(["t.grid", "t.all"]);
    off.forEach((f) => f());
  });

  it("re-registering an id replaces it; a stale unregister does not remove the replacement", () => {
    const first = registerToolOptions("fill", A, { id: "t.same" });
    registerToolOptions("fill", B, { id: "t.same" });
    first();
    expect(toolOptionsFor(ctx("fill")).map((e) => e.Component)).toEqual([B]);
    registerToolOptions("fill", B, { id: "t.same" })();
    expect(toolOptionsFor(ctx("fill"))).toEqual([]);
  });

  it("notifies subscribers and bumps the version", () => {
    let calls = 0;
    const unsubscribe = subscribeToolOptions(() => calls++);
    const before = toolOptionsVersion();
    const off = registerToolOptions("fill", A);
    off();
    unsubscribe();
    registerToolOptions("fill", A)();
    expect(calls).toBe(2);
    expect(toolOptionsVersion()).toBe(before + 4);
  });
});

describe("builtin transform options", () => {
  it("shows transforms for tile, stamp, random brushes and floating clips, but not an empty brush", () => {
    registerBuiltinToolOptions();
    for (const tool of ["brush", "fill", "rect", "eraser", "select", "hand", "eyedropper", "entity"] as const) {
      for (const brush of ["tile", "stamp", "random", "none"] as const) {
        const entries = toolOptionsFor({ ...ctx(tool), brush });
        expect(entries.some((entry) => entry.id === "builtin.transforms")).toBe(brush !== "none");
      }
    }
  });
});

describe("brush size steps", () => {
  it("steps along the list and stays in 1–16", () => {
    expect(stepBrushSize(1, 1)).toBe(2);
    expect(stepBrushSize(6, 1)).toBe(8);
    expect(stepBrushSize(7, 1)).toBe(8);
    expect(stepBrushSize(16, 1)).toBe(16);
    expect(stepBrushSize(8, -1)).toBe(6);
    expect(stepBrushSize(7, -1)).toBe(6);
    expect(stepBrushSize(1, -1)).toBe(1);
  });
});
