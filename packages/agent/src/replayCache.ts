import { AGENT_LIMITS } from "./contracts";

export interface ReplayRecord {
  client: string;
  at: number;
  transactionId?: string;
  result?: unknown;
  /** Conservative UTF-16 storage for the serialized result, excluding compact replay identity. */
  retainedBytes: number;
}
const DEFAULT_LIMITS = {
  bytes: AGENT_LIMITS.retainedBytes,
  perClient: 1024,
  maxAge: AGENT_LIMITS.reviewIdleMs,
};

/** Pending writes must remain replayable: only completed/nontransaction records are evictable. */
export function pruneReplayCache<T extends ReplayRecord>(
  cache: Map<string, T>, pendingId: string | undefined, now: number,
  limits = DEFAULT_LIMITS,
): void {
  const pinned = (entry: T) => entry.transactionId !== undefined && entry.transactionId === pendingId;
  let bytes = 0;
  const clients = new Map<string, number>();
  for (const [key, entry] of cache) {
    if (!pinned(entry) && now - entry.at > limits.maxAge) { cache.delete(key); continue; }
    clients.set(entry.client, (clients.get(entry.client) ?? 0) + 1);
    if (!pinned(entry)) bytes += entry.retainedBytes;
  }
  for (const [key, entry] of cache) {
    if (pinned(entry)) continue;
    const clientCount = clients.get(entry.client)!;
    if (clientCount > limits.perClient) {
      cache.delete(key);
      bytes -= entry.retainedBytes;
      clients.set(entry.client, clientCount - 1);
    } else if (bytes > limits.bytes && entry.retainedBytes > 0) {
      // Keep the request hash: releasing a response must never repeat a prior write.
      delete entry.result;
      bytes -= entry.retainedBytes;
      entry.retainedBytes = 0;
    }
  }
}
