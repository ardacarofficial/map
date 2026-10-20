import { describe, expect, it, vi } from "vitest";
import type { AgentConnection, AgentSettingsSnapshot } from "@smap/agent";
import { commitAiSettings } from "./aiSettingsDraft";

const snapshot: AgentSettingsSnapshot = { revision: 3, settings: { enabled: false, port: 48765 } };
describe("AI settings draft", () => {
  it("does not restart the listener when settings are unchanged", async () => {
    const setSettings = vi.fn();
    await commitAiSettings({ setSettings } as unknown as AgentConnection, snapshot, snapshot.settings);
    expect(setSettings).not.toHaveBeenCalled();
  });
  it("uses compare-and-set and returns a rollback receipt for later settings-file failure", async () => {
    const next = { enabled: true, port: 48781 };
    const setSettings = vi.fn().mockResolvedValue({ ok: true, snapshot: { revision: 4, settings: next } });
    const receipt = await commitAiSettings({ setSettings } as unknown as AgentConnection, snapshot, next);
    expect(setSettings).toHaveBeenCalledWith(next, 3);
    await receipt?.rollback();
    expect(setSettings).toHaveBeenLastCalledWith(snapshot.settings, 4);
  });
  it("preserves a conflicting host snapshot so stale Save cannot overwrite a token or endpoint change", async () => {
    const newer = { revision: 6, settings: { enabled: true, port: 48780 } };
    const connection = { setSettings: vi.fn().mockResolvedValue({ ok: false, code: "CONFLICT", snapshot: newer }) } as unknown as AgentConnection;
    await expect(commitAiSettings(connection, snapshot, { enabled: true, port: 48781 })).rejects.toMatchObject({ code: "CONFLICT", snapshot: newer });
  });
});
