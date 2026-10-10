import { describe, expect, it } from "vitest";

import type { ToolId } from "../state/editorStore";
import {
  INITIAL_TOOL_MEMORY,
  missingBrush,
  nextToolMemory,
  rightPressAction,
  rightReleaseAction,
  suppressedCommandKey,
  toolAfterPick,
  toolForLayer,
  usesBrushSize,
} from "./tools";

describe("right press (round 4)", () => {
  it("the eraser erases a rectangle instead of picking, on tile and grid layers", () => {
    for (const layer of ["tile", "grid"] as const) {
      const press = rightPressAction({ layer, tool: "eraser", inRegion: false, entityHit: false });
      expect(press).toBe("eraseRect");
      expect(rightReleaseAction(press, false)).toBe("eraseRect"); // a click erases one cell
      expect(rightReleaseAction(press, true)).toBe("eraseRect");
    }
  });

  it("the hand tool does nothing on a right press", () => {
    expect(rightPressAction({ layer: "tile", tool: "hand", inRegion: false, entityHit: false })).toBe("none");
    expect(rightPressAction({ layer: "entity", tool: "hand", inRegion: false, entityHit: true })).toBe("none");
  });

  it("other tools still pick", () => {
    for (const tool of ["brush", "fill", "rect", "eyedropper"] as const) {
      expect(rightPressAction({ layer: "tile", tool, inRegion: false, entityHit: false })).toBe("pick");
    }
  });
});

describe("tool memory", () => {
  const run = (tools: ToolId[]) => {
    let memory = INITIAL_TOOL_MEMORY;
    for (let i = 1; i < tools.length; i++) memory = nextToolMemory(memory, tools[i - 1]!, tools[i]!);
    return memory;
  };

  it("remembers the last tile tool, so an entity layer round trip keeps it", () => {
    const memory = run(["brush", "fill", "entity"]);
    expect(memory.lastTileTool).toBe("fill");
    expect(toolForLayer("fill", true, memory.lastTileTool)).toBe("entity");
    expect(toolForLayer("entity", false, memory.lastTileTool)).toBe("fill");
    expect(toolForLayer("entity", false)).toBe("brush");
    expect(toolForLayer("entity", false, "select")).toBe("brush");
  });

  it("remembers the tool before the eyedropper", () => {
    expect(run(["brush", "rect", "eyedropper"]).beforeEyedropper).toBe("rect");
    expect(run(["fill", "eyedropper", "brush"]).beforeEyedropper).toBe("fill");
    expect(nextToolMemory(INITIAL_TOOL_MEMORY, "brush", "brush")).toBe(INITIAL_TOOL_MEMORY);
  });

  it("after a pick: the eyedropper returns to its paint tool, Alt keeps the tool, select goes to the brush", () => {
    expect(toolAfterPick("eyedropper", "rect", false)).toBe("rect");
    expect(toolAfterPick("eyedropper", "fill", false)).toBe("fill");
    expect(toolAfterPick("eyedropper", "eraser", false)).toBe("brush");
    expect(toolAfterPick("eyedropper", null, false)).toBe("brush");
    // Alt held at the press: the previous tool comes back when Alt is released, not here.
    expect(toolAfterPick("eyedropper", "rect", true)).toBeNull();
    // Alt released before the mouse: the eraser is back and must stay.
    expect(toolAfterPick("eraser", "eraser", true)).toBeNull();
    expect(toolAfterPick("eraser", null, false)).toBeNull();
    expect(toolAfterPick("select", null, false)).toBe("brush");
    expect(toolAfterPick("fill", null, false)).toBeNull();
  });
});

describe("blocked and suppressed input", () => {
  const none = { grid: false, stamp: false, tile: false, random: false };

  it("brush / fill / rectangle with nothing chosen say so; grid layers and the eraser need nothing", () => {
    for (const tool of ["brush", "fill", "rect"] as const) {
      expect(missingBrush(tool, none)).toBe(true);
      expect(missingBrush(tool, { ...none, tile: true })).toBe(false);
      expect(missingBrush(tool, { ...none, stamp: true })).toBe(false);
      expect(missingBrush(tool, { ...none, random: true })).toBe(false);
      expect(missingBrush(tool, { ...none, grid: true })).toBe(false);
    }
    expect(missingBrush("eraser", none)).toBe(false);
    expect(missingBrush("select", none)).toBe(false);
  });

  it("tool and brush keys do nothing mid-gesture", () => {
    for (const id of ["tool.fill", "tool.eraser", "brush.larger", "edit.flipX", "edit.rotateCW"]) {
      expect(suppressedCommandKey(id, "brush", true)).toBe(true);
    }
    expect(suppressedCommandKey("tool.fill", "brush", false)).toBe(false);
    expect(suppressedCommandKey("edit.undo", "brush", true)).toBe(false);
  });

  it("brush size keys only work with brush and eraser", () => {
    expect(usesBrushSize("brush")).toBe(true);
    expect(usesBrushSize("eraser")).toBe(true);
    for (const tool of ["fill", "rect", "select", "eyedropper", "hand", "entity"] as const) {
      expect(suppressedCommandKey("brush.smaller", tool, false)).toBe(true);
      expect(suppressedCommandKey("brush.larger", tool, false)).toBe(true);
    }
    expect(suppressedCommandKey("brush.larger", "eraser", false)).toBe(false);
  });
});
