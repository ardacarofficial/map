import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveScheduler } from "./autosave";

describe("AutosaveScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once after 2 s of quiet", async () => {
    const save = vi.fn(async () => undefined);
    const s = new AutosaveScheduler({ save });
    s.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    s.notifyChange(); // restarts the idle timer
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves at most 30 s after the first change while changes keep coming", async () => {
    const save = vi.fn(async () => undefined);
    const s = new AutosaveScheduler({ save });
    for (let t = 0; t < 29_500; t += 500) {
      s.notifyChange();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(save).not.toHaveBeenCalled();
    s.notifyChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves again when something changed during a save", async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const s = new AutosaveScheduler({ save, idleMs: 100 });
    s.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    s.notifyChange(); // while saving
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("reports errors and keeps working; cancel drops a pending save", async () => {
    const onError = vi.fn();
    const save = vi.fn(async () => {
      throw new Error("disk full");
    });
    const s = new AutosaveScheduler({ save, onError });
    s.notifyChange();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onError).toHaveBeenCalledTimes(1);
    s.notifyChange();
    s.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(false);
  });

  it("flush saves immediately", async () => {
    const save = vi.fn(async () => undefined);
    const s = new AutosaveScheduler({ save });
    s.notifyChange();
    await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
