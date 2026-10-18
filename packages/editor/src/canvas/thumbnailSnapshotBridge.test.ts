import { describe, expect, it } from "vitest";

import { ThumbnailSnapshotBridge, type ThumbnailState } from "./thumbnailSnapshotBridge";

const pixels = () => ({ width: 1, height: 1, data: new Uint8ClampedArray([20, 30, 40, 128]) });

describe("thumbnail snapshot bridge", () => {
  it("distinguishes projects with the same level IDs and rejects pending/older revisions", () => {
    const bridge = new ThumbnailSnapshotBridge();
    const tag = { project: {}, level: "main", revision: 5 };
    let state: ThumbnailState = { ...tag, version: 2, pending: true };
    bridge.register({ state: () => state, snapshot: pixels });
    expect(bridge.snapshot(tag)).toBeUndefined();
    state = { ...state, pending: false };
    expect(bridge.snapshot({ ...tag, project: {} })).toBeUndefined();
    expect(bridge.snapshot({ ...tag, level: "other" })).toBeUndefined();
    expect(bridge.snapshot({ ...tag, revision: 6 })).toBeUndefined();
    const snapshot = bridge.snapshot(tag)!;
    expect(snapshot.pixels.data).toEqual(pixels().data);
    expect(bridge.matches(snapshot)).toBe(true);
    state = { ...state, version: 3 }; // image reload without a map revision
    expect(bridge.matches(snapshot)).toBe(false);
    state = { ...state, revision: 6 };
    expect(bridge.snapshot(tag)?.revision).toBe(6);
  });

  it("late disposal of an outgoing canvas cannot remove its replacement", () => {
    const bridge = new ThumbnailSnapshotBridge();
    const first = { project: {}, level: "a", revision: 1, version: 1, pending: false };
    const second = { ...first, project: {}, level: "b" };
    const disposeFirst = bridge.register({ state: () => first, snapshot: pixels });
    const disposeSecond = bridge.register({ state: () => second, snapshot: pixels });
    disposeFirst();
    expect(bridge.snapshot(second)).toBeDefined();
    disposeSecond();
    expect(bridge.snapshot(second)).toBeUndefined();
  });

  it("rejects delayed results from an earlier canvas lifetime with identical tags", () => {
    const bridge = new ThumbnailSnapshotBridge();
    const state = { project: {}, level: "main", revision: 1, version: 1, pending: false };
    bridge.register({ state: () => state, snapshot: pixels });
    const snapshot = bridge.snapshot(state)!;
    bridge.register({ state: () => state, snapshot: pixels });
    expect(bridge.matches(snapshot)).toBe(false);
  });

  it("does not copy pixels until explicitly requested, and not while pending", () => {
    const bridge = new ThumbnailSnapshotBridge();
    const state = { project: {}, level: "a", revision: 1, version: 1, pending: true };
    let copies = 0;
    bridge.register({ state: () => state, snapshot: () => { copies++; return pixels(); } });
    bridge.changed();
    bridge.snapshot(state);
    expect(copies).toBe(0);
    state.pending = false;
    bridge.ready(state);
    expect(copies).toBe(0);
    bridge.snapshot(state);
    expect(copies).toBe(1);
  });
});
