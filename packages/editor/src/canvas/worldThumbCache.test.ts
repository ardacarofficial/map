import { describe, expect, it } from "vitest";

import { ThumbCache } from "./worldThumbCache";

function cache() {
  const disposed: string[] = [];
  return { c: new ThumbCache<string>((v) => disposed.push(v)), disposed };
}

describe("ThumbCache", () => {
  it("asks for every level once, skipping the active one", () => {
    const { c } = cache();
    expect(c.needsLoad(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    c.begin("a");
    expect(c.needsLoad(["a", "b", "c"], "b")).toEqual(["c"]);
  });

  it("stores a completed load and does not reload it", () => {
    const { c } = cache();
    const t = c.begin("a");
    expect(c.complete("a", t, "A1")).toBe(true);
    expect(c.get("a")).toBe("A1");
    expect(c.status("a")).toBe("ready");
    expect(c.isStale("a")).toBe(false);
    expect(c.needsLoad(["a"])).toEqual([]);
  });

  it("keeps the old picture while a stale level reloads (stale-while-revalidate)", () => {
    const { c, disposed } = cache();
    c.complete("a", c.begin("a"), "A1");
    c.invalidate(["a"]);
    expect(c.isStale("a")).toBe(true);
    expect(c.needsLoad(["a"])).toEqual(["a"]);
    const t = c.begin("a");
    expect(c.get("a")).toBe("A1");
    expect(c.complete("a", t, "A2")).toBe(true);
    expect(c.get("a")).toBe("A2");
    expect(disposed).toEqual(["A1"]);
  });

  it("ignores and disposes superseded completions (out of order)", () => {
    const { c, disposed } = cache();
    const t1 = c.begin("a");
    c.invalidate(["a"]);
    // A newer load can only start after the first one ended; simulate set() superseding it.
    c.set("a", "SNAP");
    expect(c.complete("a", t1, "OLD")).toBe(false);
    expect(c.get("a")).toBe("SNAP");
    expect(disposed).toEqual(["OLD"]);
  });

  it("reloads a level invalidated while its load was running", () => {
    const { c } = cache();
    const t = c.begin("a");
    c.invalidate(["a"]);
    expect(c.complete("a", t, "A1")).toBe(true);
    expect(c.get("a")).toBe("A1");
    expect(c.isStale("a")).toBe(true);
    expect(c.needsLoad(["a"])).toEqual(["a"]);
  });

  it("does not retry a failed load until the level is invalidated", () => {
    const { c } = cache();
    const t = c.begin("a");
    expect(c.fail("a", t)).toBe(true);
    expect(c.status("a")).toBe("failed");
    expect(c.needsLoad(["a"])).toEqual([]);
    c.invalidate("all");
    expect(c.needsLoad(["a"])).toEqual(["a"]);
  });

  it("a snapshot is fresh; invalidating it asks for a reload", () => {
    const { c } = cache();
    c.set("a", "SNAP");
    expect(c.needsLoad(["a"])).toEqual([]);
    c.invalidate(["a"]);
    expect(c.needsLoad(["a"])).toEqual(["a"]);
  });

  it("drops removed levels and disposes their pictures", () => {
    const { c, disposed } = cache();
    c.complete("a", c.begin("a"), "A");
    c.complete("b", c.begin("b"), "B");
    c.retain(new Set(["b"]));
    expect(c.get("a")).toBeNull();
    expect(disposed).toEqual(["A"]);
    expect(c.values()).toEqual(["B"]);
    // A load of a dropped level that finishes later is disposed.
    const t = c.begin("x");
    c.retain(new Set(["b"]));
    expect(c.complete("x", t, "X")).toBe(false);
    expect(disposed).toEqual(["A", "X"]);
  });

  it("reports loading while a load is in flight", () => {
    const { c } = cache();
    expect(c.loading).toBe(false);
    const t = c.begin("a");
    expect(c.loading).toBe(true);
    c.complete("a", t, "A");
    expect(c.loading).toBe(false);
  });
});
