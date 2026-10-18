import { afterEach, describe, expect, it, vi } from "vitest";

import { toast, useToastStore } from "./toastStore";

const latest = () => useToastStore.getState().toasts.at(-1)!;

afterEach(() => {
  for (const item of useToastStore.getState().toasts) useToastStore.getState().dismiss(item.id);
});

describe("toast duration policy", () => {
  it.each(["info", "success", "warning"] as const)("dismisses %s notifications after four seconds by default", (kind) => {
    useToastStore.getState().push(kind, "message");
    expect(latest().duration).toBe(4000);
  });

  it("gives action notifications eight seconds, including the shorthand", () => {
    const action = { label: "Undo", run: vi.fn() };
    useToastStore.getState().push("warning", "blocked", undefined, action);
    expect(latest().duration).toBe(8000);
    toast.withAction("changed", action);
    expect(latest().duration).toBe(8000);
  });

  it("keeps errors sticky, including errors with an action", () => {
    toast.error("failed");
    expect(latest().duration).toBe(Infinity);
    useToastStore.getState().push("error", "retry", undefined, { label: "Retry", run: vi.fn() });
    expect(latest().duration).toBe(Infinity);
  });

  it("preserves caller durations, including zero and Infinity", () => {
    for (const duration of [0, Infinity, 1200]) {
      useToastStore.getState().push("info", "action", duration, { label: "Undo", run: vi.fn() });
      expect(latest().duration).toBe(duration);
      useToastStore.getState().push("error", "error", duration);
      expect(latest().duration).toBe(duration);
    }
  });

  it("replaces the visible notification with the newest", () => {
    for (let i = 0; i < 6; i++) toast.info(`message ${i}`);
    expect(useToastStore.getState().toasts.map((item) => item.message)).toEqual(["message 5"]);
  });
  it("stops watching a replaced action and never stacks sticky errors", () => {
    const unwatch = vi.fn();
    useToastStore.getState().push("info", "action", undefined, { label: "Undo", run: vi.fn(), spent: () => false, watch: () => unwatch });
    toast.error("failed");
    expect(unwatch).toHaveBeenCalledOnce();
    toast.info("newest");
    expect(useToastStore.getState().toasts.map(item => item.message)).toEqual(["newest"]);
  });

});
