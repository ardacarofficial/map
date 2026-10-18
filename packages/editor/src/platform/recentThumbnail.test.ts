import { describe, expect, it, vi } from "vitest";

import { ThumbnailSnapshotBridge } from "../canvas/thumbnailSnapshotBridge";
import type { Pixels } from "../canvas/thumbnailRaster";
import { captureMapThumbnail, RecentThumbnailScheduler, type RecentThumbnailRequest } from "./recentThumbnail";

const png = "data:image/png;base64,AAAA";

function setup() {
  const bridge = new ThumbnailSnapshotBridge();
  const state = { project: {}, level: "a", revision: 1, version: 1, pending: false };
  let pixels = new Uint8ClampedArray([255, 0, 0, 128]);
  const copy = vi.fn(() => ({ width: 1, height: 1, data: pixels.slice() }));
  const dispose = bridge.register({ state: () => state, snapshot: copy });
  const idle = new Set<() => void>();
  const encode = vi.fn((_pixels: Pixels): string | undefined | Promise<string | undefined> => png);
  const scheduler = new RecentThumbnailScheduler(bridge, (work) => { idle.add(work); return () => { idle.delete(work); }; }, encode);
  const publish = vi.fn(async (_url: string) => {});
  const request: RecentThumbnailRequest = { tag: { ...state }, isCurrent: () => true, publish };
  const flush = async () => {
    for (const callback of [...idle]) { idle.delete(callback); callback(); }
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return { bridge, state, copy, dispose, idle, encode, scheduler, publish, request, flush, changePixels: () => { pixels = new Uint8ClampedArray([0, 255, 0, 64]); } };
}

describe("deferred recent thumbnails", () => {
  it("does no snapshot/encode/publish work on the requesting stack", async () => {
    const s = setup();
    s.scheduler.request(s.request);
    expect(s.copy).not.toHaveBeenCalled();
    expect(s.encode).not.toHaveBeenCalled();
    expect(s.publish).not.toHaveBeenCalled();
    await s.flush();
    expect(s.publish).toHaveBeenCalledExactlyOnceWith(png);
    s.scheduler.destroy();
  });

  it("keeps the previous image while pending, then publishes after completion without polling", async () => {
    const s = setup();
    s.state.pending = true;
    s.scheduler.request(s.request);
    expect(s.idle.size).toBe(0);
    await s.flush();
    expect(s.publish).not.toHaveBeenCalled();
    s.state.pending = false;
    s.bridge.changed();
    await s.flush();
    expect(s.publish).toHaveBeenCalledOnce();
    s.scheduler.destroy();
  });

  it("waits for a publisher that mounts after open", async () => {
    const s = setup();
    s.dispose();
    s.scheduler.request(s.request);
    expect(s.idle.size).toBe(0);
    s.bridge.register({ state: () => s.state, snapshot: s.copy });
    await s.flush();
    expect(s.publish).toHaveBeenCalledOnce();
    s.scheduler.destroy();
  });

  it("coalesces repeated requests and copies the latest ready revision", async () => {
    const s = setup();
    s.scheduler.request(s.request);
    s.state.revision++;
    s.state.version++;
    s.changePixels();
    s.scheduler.request({ ...s.request, tag: { ...s.state } });
    await s.flush();
    expect(s.copy).toHaveBeenCalledOnce();
    expect(s.encode.mock.calls[0]?.[0].data).toEqual(new Uint8ClampedArray([0, 255, 0, 64]));
    expect(s.publish).toHaveBeenCalledOnce();
    s.scheduler.destroy();
  });

  it.each(["project", "level", "close"])("discards delayed completion after %s changes", async (change) => {
    const s = setup();
    let complete!: (url: string) => void;
    s.encode.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    let open = true;
    const { project, level } = s.state;
    s.scheduler.request({ ...s.request, isCurrent: () => open && s.state.project === project && s.state.level === level });
    await s.flush();
    if (change === "project") s.state.project = {};
    else if (change === "level") s.state.level = "b";
    else open = false;
    s.bridge.changed();
    complete(png);
    await s.flush();
    expect(s.publish).not.toHaveBeenCalled();
    s.scheduler.destroy();
  });

  it("does not attach the outgoing project's delayed PNG to a new project", async () => {
    const s = setup();
    let complete!: (url: string) => void;
    s.encode.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    s.scheduler.request(s.request);
    await s.flush();
    const next = { ...s.state, project: {} };
    s.bridge.register({ state: () => next, snapshot: s.copy });
    const nextPublish = vi.fn(async () => {});
    s.scheduler.request({ tag: next, isCurrent: () => true, publish: nextPublish });
    complete(png);
    await s.flush();
    await s.flush();
    expect(s.publish).not.toHaveBeenCalled();
    expect(nextPublish).toHaveBeenCalledOnce();
    s.scheduler.destroy();
  });

  it("retries with the fresh version when pixels change during encoding", async () => {
    const s = setup();
    let complete!: (url: string) => void;
    s.encode.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    s.scheduler.request(s.request);
    await s.flush();
    s.state.version++;
    s.state.revision++;
    s.bridge.changed();
    complete(png);
    await s.flush();
    expect(s.publish).not.toHaveBeenCalled();
    await s.flush();
    expect(s.encode).toHaveBeenCalledTimes(2);
    expect(s.publish).toHaveBeenCalledOnce();
    s.scheduler.destroy();
  });

  it("cancels queued work on close and preserves the old picture when encoding is unavailable", async () => {
    const s = setup();
    s.scheduler.request(s.request);
    s.scheduler.cancel();
    await s.flush();
    expect(s.copy).not.toHaveBeenCalled();
    s.encode.mockReturnValue(undefined);
    s.scheduler.request(s.request);
    await s.flush();
    expect(s.publish).not.toHaveBeenCalled();
    expect(s.idle.size).toBe(0);
    expect(captureMapThumbnail({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).toBeUndefined();
    s.scheduler.destroy();
  });
});
