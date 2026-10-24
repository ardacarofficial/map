import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, sampleBytes, confirmTilesetCard, pixelDiffRatio } from "../support/fixtures";
import { connect, type AgentClient } from "../support/agentClient";
import type { AgentToolResult, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

test.use({ viewport: { width: 1366, height: 768 } });
const success = <N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> => {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
};
async function setup(page: Page) {
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
  return connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
}
async function begin(client: AgentClient) {
  const session = success(await client.getSession());
  const worldSessionId = session.worldSessionId!, mapId = session.data.activeMapId!, layerId = session.data.activeLayerId!;
  const tilesets = success(await client.callTool("list_tilesets", { context: { worldSessionId } }));
  const started = success(await client.callTool("begin_edit", { context: { worldSessionId }, idempotencyKey: randomUUID(), expectedRevision: tilesets.revision, requestLabel: "Garden", mapIds: [mapId] }));
  const context = { worldSessionId, transactionId: started.data.transactionId, expectedRevision: started.revision, idempotencyKey: randomUUID() };
  return { context, mapId, layerId, tilesetId: tilesets.data.items[0]!.id };
}
async function cells(client: AgentClient, edit: Awaited<ReturnType<typeof begin>>) {
  return success(await client.callTool("read_region", { context: { worldSessionId: edit.context.worldSessionId }, mapId: edit.mapId, layerIds: [edit.layerId], region: { x: 0, y: 0, width: 8, height: 8 }, format: "cells" })).data.layers;
}
async function paint(client: AgentClient, edit: Awaited<ReturnType<typeof begin>>) {
  const changed = success(await client.callTool("paint_rect", { context: edit.context, mapId: edit.mapId, layerId: edit.layerId, region: { x: 2, y: 2, width: 2, height: 2 }, value: { tilesetId: edit.tilesetId, tileId: 0 } }));
  edit.context = { ...edit.context, expectedRevision: changed.revision, idempotencyKey: randomUUID() };
}
for (const action of ["approve", "discard"] as const) test(`AI ${action} restores the original through one undo or immediate rollback`, async ({ page }) => {
  const client = await setup(page);
  try {
    const edit = await begin(client), original = await cells(client, edit), bar = page.locator("[data-ai-bar]");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("harita-playwright");
    const canvas = page.locator("[data-canvas-host] canvas").first();
    const emptyPicture = await canvas.screenshot();
    await paint(client, edit);
    expect(await cells(client, edit)).not.toEqual(original);
    await expect.poll(async () => (await canvas.screenshot()).equals(emptyPicture)).toBe(false);
    success(await client.callTool("finish_edit", { context: edit.context, summary: "Garden" }));
    await expect(bar).toContainText("AI değişiklikleri onay bekliyor");
    await bar.getByRole("button", { name: action === "approve" ? "Onayla" : "Vazgeç", exact: true }).click();
    await expect(bar).toBeHidden();
    await expect(page.locator("[data-canvas-host]")).toBeFocused();
    if (action === "approve") await page.keyboard.press("Control+z");
    await expect.poll(() => cells(client, edit)).toEqual(original);
    await expect(page.locator("[data-ai-activity]")).toContainText(action === "approve" ? "Onaylandı" : "Geri alındı");
  } finally { await client.close(); }
});

test("finished edit survives client DELETE for human approval and one undo", async ({ page }) => {
  const client = await setup(page);
  const pair = new URL(page.url()).searchParams.get("agent")!;
  let reader: AgentClient | undefined;
  try {
    const edit = await begin(client), original = await cells(client, edit);
    await paint(client, edit);
    success(await client.callTool("finish_edit", { context: edit.context }));
    await client.close(); // SDK terminateSession sends DELETE /mcp
    const bar = page.locator("[data-ai-bar]");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("harita-playwright");
    await expect(bar).toContainText("bağlantı kapandı");
    await expect(bar.getByRole("button", { name: "Durdur", exact: true })).toBeDisabled();
    await expect(bar.getByRole("button", { name: "Onayla", exact: true })).toBeEnabled();
    reader = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
    expect(success(await reader.getSession()).data.transaction).toMatchObject({ state: "awaitingApproval", owner: { clientSessionId: null } });
    expect(await cells(reader, edit)).not.toEqual(original);
    const row = (tool: string) => page.locator("[data-ai-entry]").filter({ has: page.locator("summary", { hasText: new RegExp(`^${tool}$`) }) }).first().locator("td").nth(4);
    await expect(row("paint_rect")).toHaveText("Uygulandı");
    await expect(row("finish_edit")).toHaveText("Onay bekliyor");
    await bar.getByRole("button", { name: "Onayla", exact: true }).click();
    await expect(bar).toBeHidden();
    await page.keyboard.press("Control+z");
    await expect.poll(() => cells(reader!, edit)).toEqual(original);
  } finally { await reader?.close(); }
});

test("pending AI work blocks manual paint, preserves camera pan, and stays visible under Tab", async ({ page }) => {
  const client = await setup(page);
  try {
    const session = success(await client.getSession());
    const readManual = async () => success(await client.callTool("read_region", { context: { worldSessionId: session.worldSessionId! }, mapId: session.data.activeMapId!, layerIds: [session.data.activeLayerId!], region: { x: 0, y: 0, width: 8, height: 8 }, format: "cells" })).data.layers;
    const beforeManual = await readManual();
    const grid = page.locator("[data-tileset-grid]").first();
    const scale = Number(await grid.getAttribute("data-tileset-scale"));
    await grid.click({ position: { x: 16 * scale, y: 16 * scale } });
    await page.keyboard.press("b");
    const point = () => page.evaluate(() => (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap.cellCenter(5, 5));
    const unlocked = await point();
    await page.mouse.click(unlocked.x, unlocked.y);
    await expect.poll(readManual).not.toEqual(beforeManual);
    await page.keyboard.press("Control+z");
    await expect.poll(readManual).toEqual(beforeManual);
    const edit = await begin(client);
    await paint(client, edit);
    const original = await cells(client, edit);
    const at = await point();
    await page.mouse.click(at.x, at.y);
    expect(await cells(client, edit)).toEqual(original);
    await page.mouse.move(at.x, at.y); await page.mouse.down({ button: "middle" }); await page.mouse.move(at.x + 50, at.y + 20, { steps: 5 }); await page.mouse.up({ button: "middle" });
    await expect.poll(async () => (await point()).x).not.toBe(at.x);
    await page.keyboard.press("Tab"); await expect(page.locator("[data-ai-bar]")).toBeVisible();
    await expect(page.locator('[data-dock-zone="right"]')).toBeHidden();
    await page.locator("[data-ai-bar]").getByRole("button", { name: "Durdur", exact: true }).click();
    await expect(page.locator("[data-ai-bar]")).toContainText("AI durduruldu");
    await page.locator("[data-ai-bar]").getByRole("button", { name: "Vazgeç", exact: true }).click();
    await expect(page.locator("[data-ai-bar]")).toBeHidden();
  } finally { await client.close(); }
});

for (const phase of ["running", "stopped", "awaitingApproval"] as const) test(`manual tags remain editable during ${phase} AI edits (#10)`, async ({ page }) => {
  const client = await setup(page);
  try {
    const grid = page.locator("[data-tileset-grid]").first(), scale = Number(await grid.getAttribute("data-tileset-scale"));
    await grid.click({ position: { x: 16 * scale, y: 16 * scale } });
    const edit = await begin(client);
    if (phase === "stopped") await page.locator("[data-ai-bar]").getByRole("button", { name: "Durdur", exact: true }).click();
    if (phase === "awaitingApproval") success(await client.callTool("finish_edit", { context: edit.context }));
    await page.locator('[data-inspector-section="ai-tags"]').getByRole("button", { name: "AI etiketleri", exact: true }).click();
    const dialog = page.locator('[data-dialog="ai-tags"]'), words = dialog.locator("#ai-tag-words");
    await expect(words).toBeEnabled(); await words.fill(`review-${phase}`);
    await dialog.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.locator("[data-ai-bar]").getByRole("button", { name: "Vazgeç", exact: true }).click();
    const tags = success(await client.callTool("get_tags", { context: { worldSessionId: edit.context.worldSessionId }, tilesetId: edit.tilesetId, status: "all" }));
    expect(tags.data.items.some(item => item.tags.includes(`review-${phase}`))).toBe(true);
  } finally { await client.close(); }
});

// The bridge is installed on the welcome screen, before a world/store exists.
// Exercise user creation/navigation rather than importing editor singletons.
test("AI follows UI-created maps and worlds reopened after pairing", async ({ page }) => {
  test.setTimeout(120_000);
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  await expect(page.locator("[data-welcome-drop]")).toBeVisible();
  let client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  try {
    expect(success(await client.getSession()).worldSessionId).toBeNull();
    await page.getByRole("button", { name: /Yeni dünya/ }).click();
    const dialog = page.locator('[data-dialog="new-project"]');
    await dialog.getByLabel("Dünya adı", { exact: true }).fill("AI dünyası");
    await dialog.getByRole("button", { name: "Oluştur", exact: true }).click();
    await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
    await dropFile(page, "[data-canvas-host]", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
    await confirmTilesetCard(page);
    await page.locator('[data-library-tab-button="project"]').click();
    await page.getByRole("button", { name: "Yeni harita", exact: true }).first().click();
    const mapDialog = page.locator('[data-dialog="new-level"]');
    await mapDialog.getByLabel("Ad", { exact: true }).fill("Bahçe");
    await mapDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
    await expect(page.getByRole("option", { name: /^Bahçe/ })).toHaveAttribute("aria-selected", "true");
    await page.locator("[data-canvas-host]").focus();
    await page.keyboard.press("Control+s");
    await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
    for (const source of ["created", "same-page", "folder", "recent"]) {
      if (source === "same-page") {
        const oldWorld = success(await client.getSession()).worldSessionId;
        await page.locator("[data-canvas-host]").focus();
        await page.keyboard.press("Control+o");
        await expect.poll(async () => success(await client.getSession()).worldSessionId).not.toBe(oldWorld);
      } else if (source !== "created") {
        await client.close();
        await page.reload();
        if (source === "recent") await page.locator("[data-recent-project]").first().click();
        else await page.getByRole("button", { name: /^Aç/ }).click();
        client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
        await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
      }
      const edit = await begin(client), original = await cells(client, edit);
      const bar = page.locator("[data-ai-bar]");
      await expect(bar).toBeVisible();
      // Wait for the automatic activity dock to settle before comparing canvas pixels.
      await expect(page.locator("[data-ai-activity]")).toBeVisible();
      await page.mouse.move(0, 0);
      const canvas = page.locator("[data-canvas-host] canvas").first();
      const empty = await canvas.screenshot();
      await paint(client, edit);
      expect(await cells(client, edit)).not.toEqual(original);
      await expect.poll(async () => pixelDiffRatio(page, empty, await canvas.screenshot())).toBeGreaterThan(0.0001);
      await expect(page.locator('[data-save-state="saved"]')).toHaveCount(0);
      success(await client.callTool("finish_edit", { context: edit.context }));
      await expect(bar).toContainText("AI değişiklikleri onay bekliyor");
      const row = page.locator("[data-ai-entry]").filter({ has: page.locator("summary", { hasText: /^paint_rect$/ }) }).first();
      await expect(row.locator("td").nth(3)).toHaveText(success(await client.getSession()).data.maps.find(map => map.id === edit.mapId)!.name);
      await expect(row.locator("td").nth(6)).toHaveText("4");
      await bar.getByRole("button", { name: "Onayla", exact: true }).click();
      await expect(bar).toBeHidden();
      await page.locator("[data-canvas-host]").focus();
      await page.keyboard.press("Control+z");
      await expect.poll(() => cells(client, edit)).toEqual(original);
      await page.keyboard.press("Control+Shift+z");
      await expect.poll(() => cells(client, edit)).not.toEqual(original);
      // The next iteration starts empty; the final edit must survive save/reopen.
      if (source !== "recent") await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+s");
      await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
    }
    const saved = success(await client.getSession());
    const mapId = saved.data.activeMapId!, layerId = saved.data.activeLayerId!;
    await client.close();
    await page.reload();
    await page.locator("[data-recent-project]").first().click();
    await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
    client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
    const reopened = success(await client.getSession());
    const region = success(await client.callTool("read_region", { context: { worldSessionId: reopened.worldSessionId! }, mapId, layerIds: [layerId], region: { x: 2, y: 2, width: 2, height: 2 }, format: "cells" }));
    const layer = region.data.layers[0];
    if (!layer || layer.kind !== "tile" || !("cells" in layer)) throw Error("Expected the reopened tile layer");
    expect(layer.cells).toHaveLength(4);
    expect(layer.cells.every(cell => cell > 0)).toBe(true);
  } finally { await client.close(); }
});

for (const phase of ["running", "awaitingApproval"] as const) test(`settings stay inspectable and application preferences writable during ${phase}`, async ({ page }) => {
  const client = await setup(page);
  try {
    const edit = await begin(client);
    await paint(client, edit);
    if (phase === "awaitingApproval") success(await client.callTool("finish_edit", { context: edit.context }));
    const pendingCells = await cells(client, edit);
    const stateBefore = success(await client.getSession());
    await page.locator("[data-menu=file]").click();
    await page.locator('[data-command="project.settings"]').click();
    const world = page.locator('[data-dialog="project-settings"]');
    await expect(world).toBeVisible();
    await expect(world.locator('p[role="status"]')).toContainText("inceleyebilirsin");
    await expect(world.locator("input").first()).toBeDisabled();
    await expect(world.getByRole("button", { name: "Kaydet", exact: true })).toBeDisabled();
    await world.getByRole("tab").nth(1).click();
    await expect(world.locator("input").first()).toBeDisabled();
    await world.getByRole("tab").nth(2).click();
    await world.getByRole("button", { name: "Uygulama ayarları", exact: true }).click();
    await expect(page.locator("[data-settings-category=language]")).toBeVisible();
    await page.locator("[data-settings-category=language]").click();
    await page.locator("#settings-locale").selectOption("en");
    await page.getByRole("button", { name: "Save and apply", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("[data-ai-bar]")).toBeVisible();

    await page.locator("[data-menu=map]").click();
    await page.locator('[data-command="map.settings"]').click();
    const map = page.locator("[data-map-settings]");
    await expect(map).toBeVisible();
    await expect(map.locator('p[role="status"]')).toContainText("inspect map settings");
    await expect(map.locator('[data-field="name"]')).toBeDisabled();
    await expect(map.locator('[data-field="width"]')).toBeDisabled();
    await expect(map.locator('[data-map-settings-apply]')).toBeDisabled();
    await map.getByRole("button", { name: "Advanced", exact: true }).click();
    await expect(map.locator('[data-field="seed"]')).toBeVisible();
    await expect(map.locator('[data-field="background"]')).toBeDisabled();
    await page.keyboard.press("Escape");
    expect(await cells(client, edit)).toEqual(pendingCells);
    const stateAfter = success(await client.getSession());
    expect(stateAfter.revision).toBe(stateBefore.revision);
    expect(stateAfter.data.transaction?.id).toBe(stateBefore.data.transaction?.id);
    await page.locator("[data-ai-bar]").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator("[data-ai-bar]")).toBeHidden();
  } finally { await client.close(); }
});
