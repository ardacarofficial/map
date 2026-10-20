import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityLogEntry, AgentState } from "@smap/agent";
import { agentUiAction, installAgentUiAdapter, useAgentUi } from "./agentUiAdapter";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; });
describe("runtime UI adapter", () => {
  it("subscribes to real API and activity state, forwards actions, and releases both subscriptions", async () => {
    let state: AgentState = { phase: "ready", transaction: null, instanceId: "instance", worldSessionId: "world", revision: 1, committedRevision: 1 };
    let notifyState = () => {};
    let notifyActivity = () => {};
    const unsubscribe = vi.fn();
    const userAction = vi.fn().mockResolvedValue(undefined);
    let entries: ActivityLogEntry[] = [];
    dispose = installAgentUiAdapter({ api: { getState: () => state, subscribe: listener => { notifyState = () => listener(state); return unsubscribe; }, userAction }, activity: { entries: () => entries, subscribe: listener => { notifyActivity = listener; return unsubscribe; } }, canApprove: () => true });
    expect(useAgentUi.getState().state.phase).toBe("ready");
    state = { ...state, phase: "running" }; notifyState();
    expect(useAgentUi.getState().state.phase).toBe("running");
    entries = Array.from({ length: 510 }, (_, id) => ({ id: String(id) }) as ActivityLogEntry); notifyActivity();
    expect(useAgentUi.getState().entries).toHaveLength(500);
    expect(useAgentUi.getState().entries[0]?.id).toBe("10");
    await agentUiAction("stop"); await agentUiAction("approve"); await agentUiAction("discard");
    expect(userAction.mock.calls).toEqual([["stop"], ["approve"], ["discard"]]);
    dispose(); dispose = undefined;
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(useAgentUi.getState().state.phase).toBe("disabled");
    expect(useAgentUi.getState().source).toBeNull();
  });
  it("defaults to blocking approval until the runtime explicitly reports it safe", () => {
    dispose = installAgentUiAdapter({ api: { getState: () => ({ phase: "running", transaction: null, instanceId: "", worldSessionId: "", revision: 1, committedRevision: 1 }), subscribe: () => () => {}, userAction: vi.fn() }, activity: { entries: () => [], subscribe: () => () => {} } });
    expect(useAgentUi.getState().applying).toBe(true);
  });
});
