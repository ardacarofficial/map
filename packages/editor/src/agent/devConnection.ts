import type { AgentConnection } from "@smap/agent";
/** Lane 4 replaces this serve-only hook. Imported lazily only for DEV + ?agent=. */
export async function connectDevAgent(_pairingId: string): Promise<AgentConnection | null> { return null; }
