import { test, expect } from "../support/fixtures";
import { randomUUID } from "node:crypto";
import { openAiSettings } from "../support/aiSettings";

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
  await page.goto(`/?agent=settings-${randomUUID()}`); await openAiSettings(page);
  await expect(page.locator("#ai-port")).toHaveValue(String(process.env.E2E_MCP_PORT ?? 48766));
  await page.evaluate(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    let count = 0;
    Object.defineProperty(navigator.clipboard, "writeText", { value: async (text: string) => { count++; await original(text); } });
    Object.defineProperty(navigator.clipboard, "writeCount", { get: () => count });
  });
  const copy = page.getByRole("button", { name: "Bağlantı ayarlarını kopyala", exact: true });
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`claude mcp add --transport http harita http://127.0.0.1:${process.env.E2E_MCP_PORT ?? 48766}/mcp --header "Authorization: Bearer ${process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol"}"`);
  await page.getByRole("radio", { name: "Codex", exact: true }).click();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[mcp_servers.harita]\nurl = "http://127.0.0.1:${process.env.E2E_MCP_PORT ?? 48766}/mcp"\nbearer_token_env_var = "HARITA_MCP_TOKEN"\n\n$env:HARITA_MCP_TOKEN="${process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol"}"\nsetx HARITA_MCP_TOKEN "${process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol"}"`);
  expect(await page.evaluate(() => (navigator.clipboard as Clipboard & { writeCount: number }).writeCount)).toBe(2);
  await expect(page.getByLabel("Erişim anahtarı", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Kaydet ve uygula", exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath("ai-settings.png") });
});

test("dev listener draft cancels cleanly; invalid ports cannot save and token rotation needs confirmation", async ({ page }) => {
  await page.goto(`/?agent=settings-${randomUUID()}`); await openAiSettings(page);
  const port = String(process.env.E2E_MCP_PORT ?? 48766);
  await expect(page.locator("#ai-port")).toHaveValue(port);
  await page.locator("#ai-port").fill("1e3");
  await expect(page.getByRole("button", { name: "Kaydet ve uygula", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await openAiSettings(page);
  await expect(page.locator("#ai-port")).toHaveValue(port);
  await page.getByRole("button", { name: "Anahtarı yenile", exact: true }).click();
  const confirmation = page.getByRole("group", { name: "Anahtarı yenile", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Vazgeç", exact: true }).click();
  await expect(confirmation).toBeHidden();
  await page.getByRole("button", { name: "Kaydet ve uygula", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
