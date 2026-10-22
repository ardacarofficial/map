import { expect, it } from "vitest";
import { pruneReplayCache, type ReplayRecord } from "../src/replayCache";
const limits = { bytes: 100, perClient: 2, maxAge: 10 };
function entry(client: string, retainedBytes: number, transactionId?: string): ReplayRecord {
  return { client, retainedBytes, result: "original result", at: 0, ...(transactionId ? { transactionId } : {}) };
}
it("bounds completed replies across clients by retained bytes, releasing oldest payloads first", () => {
  const cache = new Map([["a", entry("alice", 60)], ["b", entry("bob", 60)], ["c", entry("carol", 30)]]);
  pruneReplayCache(cache, undefined, 1, limits);
  expect([...cache.keys()]).toEqual(["a", "b", "c"]);
  expect(cache.get("a")!.result).toBeUndefined();
  expect(cache.get("b")!.result).toBe("original result");
});
it("retains every active-write replay even over the terminal budget, then bounds it after finalization", () => {
  const cache = new Map([["begin", entry("alice", 80, "active")], ["write", entry("alice", 80, "active")], ["tags", entry("bob", 20)]]);
  pruneReplayCache(cache, "active", 20, limits);
  expect([...cache.keys()]).toEqual(["begin", "write"]);
  pruneReplayCache(cache, undefined, 20, limits);
  expect(cache.size).toBe(0);
});
it("expires nontransaction tag responses even when no edit is pending", () => {
  const cache = new Map([["tags", entry("alice", 10)]]);
  pruneReplayCache(cache, undefined, 11, limits);
  expect(cache.size).toBe(0);
});
it("preserves the existing per-client replay window and keeps other clients' replies", () => {
  const cache = new Map(Array.from({ length: 6 }, (_, i) => [String(i), entry(i < 3 ? "alice" : `client-${i}`, 1)]));
  pruneReplayCache(cache, undefined, 1, limits);
  expect([...cache.keys()]).toEqual(["1", "2", "3", "4", "5"]);
});

it("counts pinned identities toward the client window without evicting them", () => {
  const cache = new Map([["begin", entry("alice", 80, "active")], ["old", entry("alice", 10)], ["new", entry("alice", 10)]]);
  pruneReplayCache(cache, "active", 1, limits);
  expect([...cache.keys()]).toEqual(["begin", "new"]);
});
