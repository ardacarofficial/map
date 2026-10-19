import { afterEach, expect, it, vi } from "vitest";
import { captureRecordedKey, setKeyRecording } from "./keyRecording";
afterEach(() => setKeyRecording(null));
it("consumes recording events before any app dispatch and releases capture afterwards", () => {
  const recorder = vi.fn();
  const event = { key: "Delete", preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent;
  expect(captureRecordedKey(event)).toBe(false);
  setKeyRecording(recorder);
  expect(captureRecordedKey(event)).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  expect(recorder).toHaveBeenCalledWith(event);
  setKeyRecording(null);
  expect(captureRecordedKey(event)).toBe(false);
});
