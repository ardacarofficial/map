import type { AgentApi, AgentHost } from "./contracts";
/** Lane 1 supplies the pure dispatcher and transaction coordinator. */
export function createAgentApi(_host: AgentHost): AgentApi {
  throw new Error("not implemented");
}
