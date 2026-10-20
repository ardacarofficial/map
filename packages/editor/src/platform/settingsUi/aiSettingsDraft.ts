import { useEffect, useState } from "react";
import type { AgentConnection, AgentSettings, AgentSettingsSnapshot, SettingsWriteResult } from "@smap/agent";
import { getPlatform } from "../index";
import { validAgentPort } from "../../ui/agent/connectionSnippet";

export class AiSettingsError extends Error {
  constructor(readonly code: string, readonly snapshot?: AgentSettingsSnapshot) { super(code); }
}
export async function commitAiSettings(connection: AgentConnection, snapshot: AgentSettingsSnapshot, settings: AgentSettings) {
  if (!validAgentPort(settings.port)) throw new AiSettingsError("INVALID_ARGUMENT");
  if (snapshot.settings.enabled === settings.enabled && snapshot.settings.port === settings.port) return null;
  const result: SettingsWriteResult = await connection.setSettings(settings, snapshot.revision);
  if (!result.ok) throw new AiSettingsError(result.code, result.snapshot);
  return { snapshot: result.snapshot, async rollback() {
    const restored = await connection.setSettings(snapshot.settings, result.snapshot.revision);
    if (!restored.ok) throw new AiSettingsError(restored.code, restored.snapshot);
  } };
}
export function useAiSettingsDraft() {
  const connection = getPlatform().agent;
  const [snapshot, setSnapshot] = useState<AgentSettingsSnapshot | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState("48765");
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    if (connection) void connection.getSettings().then(value => {
      if (alive) { setSnapshot(value); setEnabled(value.settings.enabled); setPort(String(value.settings.port)); }
    }).catch(() => { if (alive) setLoadFailed(true); });
    return () => { alive = false; };
  }, [connection]);
  const acceptSnapshot = (value: AgentSettingsSnapshot) => {
    setSnapshot(value); setEnabled(value.settings.enabled); setPort(String(value.settings.port));
  };
  return { connection, snapshot, enabled, port, setEnabled, setPort, acceptSnapshot, loadFailed };
}
export type AiSettingsDraft = ReturnType<typeof useAiSettingsDraft>;
