import type { ActivityLogEntry, AgentPhase } from "@smap/agent";

export function selectAiControls(phase: AgentPhase, applying: boolean) {
  const review = phase === "running" || phase === "stopped" || phase === "awaitingApproval";
  return {
    visible: phase !== "disabled" && phase !== "ready",
    stop: phase === "preparing" || phase === "running",
    approve: review && !applying,
    discard: review || phase === "preparing",
  };
}
export type ActivityOutcome = "running" | "applied" | "tentative" | "rejected" | "approved" | "rolledBack" | "stopped" | "succeeded";
const READ_TOOLS = new Set(["get_session", "get_map_info", "read_region", "list_tilesets", "get_tile_catalog", "list_stamps", "list_entity_types", "render_preview", "validate_map", "get_tags", "set_tags"]);
export function activityOutcome(entry: ActivityLogEntry, entries: readonly ActivityLogEntry[]): ActivityOutcome {
  if (entry.status === "failed") return "rejected";
  if (entry.status === "started") return "running";
  if (entry.status === "cancelled") return "rolledBack";
  if (entry.status === "approved" || entry.status === "stopped") return entry.status;
  if (!entry.transactionId || (entry.tool && READ_TOOLS.has(entry.tool))) return "succeeded";
  const outcome = [...entries].reverse().find(row => row.transactionId === entry.transactionId && (row.status === "approved" || row.status === "cancelled"));
  return outcome?.status === "cancelled" ? "rolledBack" : outcome?.status === "approved" ? "approved" : entry.tool === "finish_edit" ? "tentative" : "applied";
}

/** Input is the session log in insertion order; newest transactions come first. */
export function groupActivity(entries: readonly ActivityLogEntry[]): { id: string; entries: ActivityLogEntry[] }[] {
  const groups = new Map<string, ActivityLogEntry[]>();
  for (const entry of [...entries].reverse()) {
    const id = entry.transactionId ? `transaction:${entry.transactionId}` : `entry:${entry.id}`;
    const group = groups.get(id);
    if (group) group.push(entry); else groups.set(id, [entry]);
  }
  return [...groups].map(([id, entries]) => ({ id, entries }));
}
