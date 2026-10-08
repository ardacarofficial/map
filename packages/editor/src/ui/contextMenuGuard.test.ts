import { describe, expect, it } from "vitest";

import { allowsNativeContextMenu } from "./contextMenuGuard";

/** A fake element whose nearest editable ancestor is `field`. */
const inside = (field: { tagName: string; type?: string } | null) => ({ closest: () => field }) as unknown as EventTarget;

describe("context menu guard", () => {
  it("keeps the native edit menu in text fields only", () => {
    expect(allowsNativeContextMenu(inside({ tagName: "INPUT", type: "text" }))).toBe(true);
    expect(allowsNativeContextMenu(inside({ tagName: "INPUT", type: "number" }))).toBe(true);
    expect(allowsNativeContextMenu(inside({ tagName: "TEXTAREA" }))).toBe(true);
    expect(allowsNativeContextMenu(inside({ tagName: "DIV" }))).toBe(true); // contenteditable
  });

  it("blocks it everywhere else", () => {
    expect(allowsNativeContextMenu(inside(null))).toBe(false);
    expect(allowsNativeContextMenu(inside({ tagName: "INPUT", type: "checkbox" }))).toBe(false);
    expect(allowsNativeContextMenu(inside({ tagName: "INPUT", type: "range" }))).toBe(false);
    expect(allowsNativeContextMenu(null)).toBe(false);
    expect(allowsNativeContextMenu({} as EventTarget)).toBe(false);
  });
});
