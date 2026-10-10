import { describe, expect, it } from "vitest";

import { neighbourAfterClose, syncTabs } from "./docTabs";

describe("document tabs", () => {
  it("adds the open map once, after the previously active tab", () => {
    expect(syncTabs([], "a", ["a", "b"])).toEqual(["a"]);
    expect(syncTabs(["a"], "a", ["a", "b"])).toEqual(["a"]);
    expect(syncTabs(["a", "c"], "b", ["a", "b", "c"], "a")).toEqual(["a", "b", "c"]);
    expect(syncTabs(["a", "c"], "b", ["a", "b", "c"])).toEqual(["a", "c", "b"]);
  });

  it("drops maps that were deleted (or belong to another project)", () => {
    expect(syncTabs(["a", "x", "b"], "b", ["a", "b"])).toEqual(["a", "b"]);
    expect(syncTabs(["x", "y"], "n", ["n"])).toEqual(["n"]);
  });

  it("closing the active tab shows the right neighbour, else the left one", () => {
    expect(neighbourAfterClose(["a", "b", "c"], "b")).toBe("c");
    expect(neighbourAfterClose(["a", "b", "c"], "c")).toBe("b");
    expect(neighbourAfterClose(["a"], "a")).toBeNull();
  });
});
