import { test, expect } from "../support/fixtures";
import { openDockMap } from "../support/docking";
import { attachAiSettingsHost, openAiSettings } from "../fixtures/aiSettings";

test.use({ viewport: { width: 1366, height: 768 }, permissions: ["clipboard-read", "clipboard-write"] });

test("AI settings browser fallback is a localized fact in Turkish and English", async ({ page }) => {
  await page.goto("/"); await openAiSettings(page);
  await expect(page.locator("[data-ai-host-required]")).toHaveText("Masaüstü uygulamasında kullanılabilir");
  await expect(page.locator("[data-ai-settings]")).toHaveCount(0);
  await page.locator('[data-settings-category="language"]').click();
  await page.getByRole("combobox").last().selectOption("en");
  await page.locator('[data-settings-category="ai"]').click();
  await expect(page.locator("[data-ai-host-required]")).toHaveText("Available in the desktop application");
  const save = page.getByRole("button", { name: "Save and apply", exact: true });
  await expect(save).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("AI settings copy each O7 client format with one clipboard write per activation", async ({ page }) => {
  await openDockMap(page); await attachAiSettingsHost(page); await openAiSettings(page);
  await expect(page.locator("#ai-port")).toHaveValue("48781");
  await page.evaluate(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    let count = 0;
    Object.defineProperty(navigator.clipboard, "writeText", { value: async (text: string) => { count++; await original(text); } });
    Object.defineProperty(navigator.clipboard, "writeCount", { get: () => count });
  });
  const copy = page.getByRole("button", { name: "Bağlantı ayarlarını kopyala", exact: true });
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('claude mcp add --transport http harita http://127.0.0.1:48781/mcp --header "Authorization: Bearer test-token-only-not-a-real-secret"');
  await page.getByRole("radio", { name: "Codex", exact: true }).click();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('[mcp_servers.harita]\nurl = "http://127.0.0.1:48781/mcp"\nbearer_token_env_var = "HARITA_MCP_TOKEN"\n\n$env:HARITA_MCP_TOKEN="test-token-only-not-a-real-secret"\nsetx HARITA_MCP_TOKEN "test-token-only-not-a-real-secret"');
  expect(await page.evaluate(() => (navigator.clipboard as Clipboard & { writeCount: number }).writeCount)).toBe(2);
  await expect(page.getByLabel("Erişim anahtarı", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Kaydet ve uygula", exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("ai-settings.png") });
});

test("listener fields apply on Save, Cancel preserves the listener, rotation requires confirmation", async ({ page }) => {
  await openDockMap(page); await attachAiSettingsHost(page); await openAiSettings(page);
  await page.getByRole("switch", { name: "AI bağlantısı", exact: true }).click();
  await page.locator("#ai-port").fill("48780");
  await page.keyboard.press("Escape");
  const current = () => page.evaluate(async () => (await import(/* @vite-ignore */ String("/src/platform/index.ts"))).getPlatform().agent.getSettings());
  expect((await current()).settings).toEqual({ enabled: false, port: 48781 });
  await openAiSettings(page); await page.locator("#ai-port").fill("1e3");
  await expect(page.getByRole("button", { name: "Kaydet ve uygula", exact: true })).toBeDisabled();
  await page.locator("#ai-port").fill("48780");
  await page.getByRole("switch", { name: "AI bağlantısı", exact: true }).click();
  await page.getByRole("button", { name: "Anahtarı yenile", exact: true }).click();
  expect((await current()).revision).toBe(1);
  await page.getByRole("group", { name: "Anahtarı yenile", exact: true }).getByRole("button", { name: "Anahtarı yenile", exact: true }).click();
  expect((await current()).revision).toBe(2);
  expect((await current()).settings).toEqual({ enabled: false, port: 48781 });
  await page.getByRole("button", { name: "Kaydet ve uygula", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect((await current()).settings).toEqual({ enabled: true, port: 48780 });
});
