import { describe, expect, it } from "vitest";
import type { ActivityLogEntry } from "@smap/agent";
import { activityOutcome, selectAiControls } from "./selectors";

describe("AI control availability", () => {
  it("seals the writer through Stop while keeping safe approval and discard available", () => {
    expect(selectAiControls("running", false)).toEqual({ visible: true, stop: true, approve: true, discard: true });
    expect(selectAiControls("running", true)).toEqual({ visible: true, stop: true, approve: false, discard: true });
  });
  it("keeps review until a user decision and disables controls during rollback", () => {
    for (const phase of ["stopped", "awaitingApproval"] as const) expect(selectAiControls(phase, false)).toEqual({ visible: true, stop: false, approve: true, discard: true });
    expect(selectAiControls("cancelling", false)).toEqual({ visible: true, stop: false, approve: false, discard: false });
    for (const phase of ["disabled", "ready"] as const) expect(selectAiControls(phase, false).visible).toBe(false);
    expect(selectAiControls("preparing", false).approve).toBe(false);
  });
  it("marks earlier tentative calls rolled back after discard, without rewriting errors", () => {
    const entry = (status: ActivityLogEntry["status"], tool: ActivityLogEntry["tool"] = null) => ({ transactionId: "edit", status, tool }) as ActivityLogEntry;
    const painted = entry("succeeded", "paint_cells");
    expect(activityOutcome(painted, [painted])).toBe("applied");
    const finished = entry("succeeded", "finish_edit");
    expect(activityOutcome(finished, [painted, finished])).toBe("tentative");
    expect(activityOutcome(painted, [painted, entry("cancelled")])).toBe("rolledBack");
    expect(activityOutcome(painted, [painted, entry("approved")])).toBe("approved");
    expect(activityOutcome(entry("failed"), [entry("cancelled")])).toBe("rejected");
    expect(activityOutcome(entry("succeeded", "get_map_info"), [entry("cancelled")])).toBe("succeeded");
  });
});

it("keeps interleaved client transactions together and orders groups by latest activity", async () => {
  const { groupActivity } = await import("./selectors");
  const rows = [
    { id: "a1", transactionId: "a" }, { id: "b1", transactionId: "b" },
    { id: "a2", transactionId: "a" }, { id: "read", transactionId: null },
  ] as ActivityLogEntry[];
  expect(groupActivity(rows).map(group => group.entries.map(row => row.id))).toEqual([["read"], ["a2", "a1"], ["b1"]]);
});
