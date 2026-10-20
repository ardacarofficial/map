import type { Page } from "@playwright/test";
import { expect } from "../support/fixtures";

/** Host fixture only: never writes maps or drives the agent side of a transaction. */
export async function attachAiSettingsHost(page: Page) {
  await page.evaluate(async () => {
    const { getPlatform, setPlatform } = await import(/* @vite-ignore */ String("/src/platform/index.ts"));
    let snapshot = { revision: 1, settings: { enabled: false, port: 48781 } };
    let token = "test-token-only-not-a-real-secret";
    let status = { state: "disabled", port: 48781, clients: [] };
    const listeners = new Set<(status: unknown) => void>();
    const agent = {
      onRequest: () => () => {}, onControl: () => () => {}, reply: async () => {}, publishStatus: async () => {}, ready: async () => {},
      getSettings: async () => snapshot,
      setSettings: async (settings: typeof snapshot.settings, revision: number) => {
        if (snapshot.revision !== revision) return { ok: false, code: "CONFLICT", snapshot, status };
        snapshot = { revision: snapshot.revision + 1, settings };
        status = { ...status, state: settings.enabled ? "listening" : "disabled", port: settings.port };
        listeners.forEach(listener => listener(status));
        return { ok: true, snapshot, status };
      },
      revealToken: async () => token,
      copyToken: async () => { await navigator.clipboard.writeText(token); },
      regenerateToken: async (revision: number) => {
        if (revision !== snapshot.revision) throw Error("CONFLICT");
        token = "rotated-test-token"; snapshot = { ...snapshot, revision: snapshot.revision + 1 }; return snapshot;
      },
      get status() { return status; },
      subscribeStatus: (listener: (status: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
    setPlatform({ ...getPlatform(), agent });
  });
}
export async function openAiSettings(page: Page) {
  await page.keyboard.press("Control+k");
  await page.locator('[id="command-settings.editShortcuts"]').click();
  await expect(page.locator('[data-settings-category="ai"]')).toBeVisible();
  await page.locator('[data-settings-category="ai"]').click();
}
