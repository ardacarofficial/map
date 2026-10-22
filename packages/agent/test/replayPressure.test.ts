import { expect, it, vi } from "vitest";
import type * as CacheModule from "../src/replayCache";
import { harness, success, error } from "./helpers";
import { memoryCall } from "../src/testing/memoryHost";

// Exercise the production policy at a small deterministic pressure threshold.
vi.mock("../src/replayCache", async importOriginal => {
  const actual = await importOriginal<typeof CacheModule>();
  return { ...actual, pruneReplayCache: (cache: Parameters<typeof actual.pruneReplayCache>[0], pending: string | undefined, now: number) =>
    actual.pruneReplayCache(cache, pending, now, { bytes: 2000, perClient: 1024, maxAge: 600000 }) };
});

it("a byte-evicted tag response cannot overwrite a newer manual annotation on retry", async () => {
  const h = harness();
  const call = memoryCall("get_session", {});
  const fingerprint = await h.host.images.tileFingerprint("tiles", 0, call.signal);
  const args = {
    context: { ...h.context(), idempotencyKey: "original-tags" },
    entries: [{ target: { kind: "tile" as const, tilesetId: "tiles", tileId: 0 }, expectedFingerprint: fingerprint, tags: ["old"], note: "a".repeat(200) }],
  };
  success(await h.run("set_tags", args));
  await h.host.tags.set({ ...args, entries: [{ ...args.entries[0]!, tags: ["manual-new"] }] }, call);
  for (let i = 0; i < 4; i++) {
    success(await h.api.executeTool({ ...memoryCall("set_tags", {
      context: { ...h.context(), idempotencyKey: `pressure-${i}` },
      entries: [{ ...args.entries[0]!, target: { kind: "tile", tilesetId: "tiles", tileId: 1 }, expectedFingerprint: await h.host.images.tileFingerprint("tiles", 1, call.signal) }],
    }), clientSessionId: `other-client-${i}` }));
  }
  error(await h.run("set_tags", args), "LIMIT_EXCEEDED");
  const tags = h.host.tags.availability();
  expect(tags.state === "ready" && tags.sidecar.tiles[0]!.tags).toEqual(["manual-new"]);
  error(await h.run("set_tags", { ...args, entries: [{ ...args.entries[0]!, tags: ["conflicting"] }] }), "IDEMPOTENCY_CONFLICT");
  await h.api.dispose();
});

it("a byte-evicted completed begin reply cannot create a new edit on retry", async () => {
  const h = harness();
  const args = { context: h.context(), idempotencyKey: "original-begin", expectedRevision: 0, requestLabel: "original", mapIds: ["map-1"] };
  success(await h.run("begin_edit", args));
  const tagEntry = { target: { kind: "tile", tilesetId: "tiles", tileId: 0 }, expectedFingerprint: await h.host.images.tileFingerprint("tiles", 0, memoryCall("get_session", {}).signal), tags: ["pressure"], note: "a".repeat(200) };
  // Pending replay remains pinned even while unrelated clients put pressure on the cache.
  for (let i = 0; i < 4; i++) success(await h.run("set_tags", { context: { ...h.context(), idempotencyKey: `tags-request-${i}` }, entries: [tagEntry] }));
  success(await h.run("begin_edit", args));
  await h.api.userAction("approve");
  for (let i = 4; i < 8; i++) success(await h.run("set_tags", { context: { ...h.context(), idempotencyKey: `tags-request-${i}` }, entries: [tagEntry] }));
  error(await h.run("begin_edit", args), "LIMIT_EXCEEDED");
  expect(h.api.getState().phase).toBe("ready");
  expect(h.host.transactions.writeGate.blocked).toBe(false);
  await h.api.dispose();
});
