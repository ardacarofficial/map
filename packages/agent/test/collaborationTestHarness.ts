import { expect } from "vitest";
import { createAgentApi } from "../src/api";
import { createMemoryHost, memoryCall, type MemoryHostOptions } from "../src/testing/memoryHost";
import type { AgentToolResult } from "../src/contracts";
import { success } from "./helpers";

export interface TestClaim {
  mapId: string;
  layerIds: string[];
  region: { x: number; y: number; width: number; height: number };
}
export const westClaim = (layerIds = ["ground"]): TestClaim => ({ mapId: "map-1", layerIds, region: { x: 0, y: 0, width: 4, height: 8 } });
export const eastClaim = (layerIds = ["ground"]): TestClaim => ({ mapId: "map-1", layerIds, region: { x: 4, y: 0, width: 4, height: 8 } });

/** Exercise the public tools across independently authenticated clients. Local
 * counters deliberately do not refresh when another member changes the world. */
export function collaborationHarness(options: MemoryHostOptions = {}) {
  const host = createMemoryHost({ width: 8, height: 8, ...options });
  const api = createAgentApi(host);
  const revisions = new Map<string, number>();
  let key = 0;
  const context = () => ({ worldSessionId: host.session().worldSessionId! });
  const invoke = (client: string, name: string, args: unknown) => api.executeTool(memoryCall(name, args, {
    clientSessionId: client, clientInfo: { name: client, version: "1" },
  }));
  const accept = (client: string, result: AgentToolResult) => {
    const value = success(result);
    const memberRevision = (value as unknown as { memberRevision?: number }).memberRevision;
    expect(Number.isInteger(memberRevision), `${client} response must contain its own revision`).toBe(true);
    revisions.set(client, memberRevision!);
    return value;
  };
  async function begin(client = "A", claims: TestClaim[] | null = [westClaim()]) {
    return accept(client, await invoke(client, "begin_edit", {
      context: context(), expectedRevision: api.getState().revision,
      idempotencyKey: `collab-begin-${++key}`, requestLabel: "Collaborative world", mapIds: ["map-1"],
      collaboration: { mode: "regions", ...(claims ? { claims } : {}) },
    }));
  }
  async function join(client = "B", claims = [eastClaim()]) {
    return accept(client, await invoke(client, "join_edit", {
      context: context(), transactionId: api.getState().transaction!.id,
      idempotencyKey: `collab-join-${++key}`, expectedRevision: api.getState().revision, claims,
    }));
  }
  const writeContext = (client: string, idempotencyKey = `collab-write-${++key}`) => ({
    ...context(), transactionId: api.getState().transaction!.id,
    idempotencyKey, expectedMemberRevision: revisions.get(client)!,
  });
  const edit = (client: string, name: string, args: Record<string, unknown> = {}) => invoke(client, name, {
    context: writeContext(client), ...args,
  });
  const ok = async (client: string, name: string, args: Record<string, unknown> = {}) => accept(client, await edit(client, name, args));
  const paint = (client: string, x: number, y: number, tileId = 0, layerId = "ground") => ok(client, "paint_cells", {
    mapId: "map-1", layerId, cells: [{ x, y, value: { tilesetId: "tiles", tileId } }],
  });
  return { host, api, revisions, context, invoke, accept, begin, join, writeContext, edit, ok, paint,
    store: host.stores.get("map-1")!,
    cell: (x: number, y: number, layerId = "ground") => host.stores.get("map-1")!.document.getLayer(layerId)!.getCell(x, y),
  };
}
