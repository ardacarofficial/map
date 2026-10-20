import { AGENT_LIMITS, type ActivityLogEntry, type AgentActivityPort } from "@smap/agent";

/** Keep only bounded, plain diagnostic summaries. Never retain arguments, images or tokens. */
export function sanitizeActivitySummary(value: string): string {
  return value.replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43,})\b/g, "[redacted]")
    .split("").map(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch).join("").slice(0, 512);
}
export function createActivityStore(): AgentActivityPort {
  let rows: readonly ActivityLogEntry[] = [];
  const listeners = new Set<() => void>();
  return {
    entries: () => rows,
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    append(entry) {
      rows = [...rows.slice(-(AGENT_LIMITS.activityEntries - 1)), Object.freeze({ ...entry,
        clientInfo: entry.clientInfo ? { name: sanitizeActivitySummary(entry.clientInfo.name), version: sanitizeActivitySummary(entry.clientInfo.version) } : null,
        summary: sanitizeActivitySummary(entry.summary), mapIds: entry.mapIds.slice(0, 8),
      })];
      for (const cb of listeners) { try { cb(); } catch { console.warn("Agent activity observer failed"); } }
    },
  };
}
export const agentActivity = createActivityStore();
