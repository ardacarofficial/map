import { describe, expect, it } from "vitest";

import type { ToolId } from "../state/editorStore";
import { SPRING_HOLD_MS, SPRING_IDLE, springStep, type SpringEvent, type SpringState } from "./springKey";

/** Runs events, applying tool changes like the canvas does; returns the tool after each step. */
function run(tool: ToolId, events: SpringEvent[]): { state: SpringState; tools: ToolId[] } {
  let state: SpringState = SPRING_IDLE;
  const tools: ToolId[] = [];
  for (const e of events) {
    const r = springStep(state, e, tool);
    state = r.state;
    if (r.setTool) tool = r.setTool;
    tools.push(tool);
  }
  return { state, tools };
}

describe("spring-loaded Alt eyedropper", () => {
  it("a quick tap does nothing", () => {
    const r = run("brush", [{ type: "down", time: 0 }, { type: "tick", time: SPRING_HOLD_MS - 1 }, { type: "up" }]);
    expect(r.tools).toEqual(["brush", "brush", "brush"]);
    expect(r.state).toEqual(SPRING_IDLE);
  });

  it("holding switches to the eyedropper and releasing returns", () => {
    const r = run("fill", [{ type: "down", time: 100 }, { type: "tick", time: 100 + SPRING_HOLD_MS }, { type: "up" }]);
    expect(r.tools).toEqual(["fill", "eyedropper", "fill"]);
  });

  it("a click while held picks right away, before the hold time", () => {
    const r = run("eraser", [{ type: "down", time: 0 }, { type: "click" }, { type: "click" }, { type: "up" }]);
    expect(r.tools).toEqual(["eraser", "eyedropper", "eyedropper", "eraser"]);
  });

  it("key repeat does not restart the hold", () => {
    const r = run("brush", [{ type: "down", time: 0 }, { type: "down", time: 150 }, { type: "tick", time: SPRING_HOLD_MS }]);
    expect(r.tools.at(-1)).toBe("eyedropper");
  });

  it("another key with Alt (a shortcut) cancels a pending hold", () => {
    const r = run("brush", [{ type: "down", time: 0 }, { type: "otherKey" }, { type: "tick", time: 1000 }, { type: "up" }]);
    expect(r.tools).toEqual(["brush", "brush", "brush", "brush"]);
  });

  it("focus loss resets and restores the previous tool", () => {
    const held = run("rect", [{ type: "down", time: 0 }, { type: "tick", time: 500 }, { type: "reset" }]);
    expect(held.tools).toEqual(["rect", "eyedropper", "rect"]);
    expect(held.state).toEqual(SPRING_IDLE);
    const pending = run("rect", [{ type: "down", time: 0 }, { type: "reset" }, { type: "tick", time: 500 }]);
    expect(pending.tools).toEqual(["rect", "rect", "rect"]);
  });

  it("is ignored during a drag (Alt shapes the rectangle) and when already on the eyedropper", () => {
    expect(run("rect", [{ type: "down", time: 0, busy: true }, { type: "tick", time: 500 }]).tools).toEqual(["rect", "rect"]);
    expect(run("eyedropper", [{ type: "down", time: 0 }, { type: "tick", time: 500 }, { type: "up" }]).tools).toEqual([
      "eyedropper",
      "eyedropper",
      "eyedropper",
    ]);
  });

  it("does not undo a tool the user chose while holding Alt", () => {
    let state: SpringState = SPRING_IDLE;
    state = springStep(state, { type: "down", time: 0 }, "brush").state;
    state = springStep(state, { type: "tick", time: 300 }, "brush").state;
    expect(state.phase).toBe("active");
    // user pressed F meanwhile: the store tool is now "fill"
    expect(springStep(state, { type: "up" }, "fill").setTool).toBeNull();
  });
});
