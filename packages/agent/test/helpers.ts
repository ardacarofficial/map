import { expect } from "vitest";
import { createAgentApi } from "../src/api";
import {
  createMemoryHost,
  memoryCall,
  type MemoryHostOptions,
} from "../src/testing/memoryHost";
import type { AgentToolResult, AnyToolSuccess, ToolName } from "../src/contracts";
/** Reads/lifecycle keep {data}; map writes answer the compact C3 envelope. Tests read either shape. */
export type AnySuccess = AnyToolSuccess;
export function harness(options: MemoryHostOptions = {}) {
  const host = createMemoryHost(options),
    api = createAgentApi(host);
  let key = 0;
  const context = () => ({ worldSessionId: host.session().worldSessionId! });
  const writeContext = () => ({
    ...context(),
    transactionId: api.getState().transaction!.id,
    idempotencyKey: `request-${++key}`,
    expectedRevision: api.getState().revision,
  });
  async function run(name: ToolName, args: unknown) {
    return api.executeTool(memoryCall(name, args));
  }
  async function begin(mapIds = ["map-1"]) {
    return success(
      await run("begin_edit", {
        context: context(),
        idempotencyKey: `begin-request-${++key}`,
        expectedRevision: api.getState().revision,
        requestLabel: "AI request",
        mapIds,
      }),
    );
  }
  async function edit(name: ToolName, args: Record<string, unknown> = {}) {
    return run(name, { context: writeContext(), ...args });
  }
  async function read(name: ToolName, args: Record<string, unknown> = {}) {
    return run(name, { context: context(), ...args });
  }
  return { host, api, context, writeContext, run, begin, edit, read };
}
export function success(result: AgentToolResult) {
  expect(
    result.structuredContent.ok,
    JSON.stringify(result.structuredContent),
  ).toBe(true);
  if (!result.structuredContent.ok)
    throw new Error(result.structuredContent.message);
  return result.structuredContent as AnySuccess;
}
export function error(result: AgentToolResult, code: string) {
  expect(result.structuredContent).toMatchObject({ ok: false, code });
}
export const tile = { tilesetId: "tiles", tileId: 0 };
export const stamp = {
  id: "house",
  name: "House",
  width: 2,
  height: 1,
  palette: [
    { tilesetId: "tiles", tileId: 4 },
    { tilesetId: "tiles", tileId: 5 },
  ],
  layers: [{ layerId: "base", name: "Ground", cells: Uint32Array.of(1, 2) }],
};
