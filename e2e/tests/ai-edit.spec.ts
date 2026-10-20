import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, sampleBytes, confirmTilesetCard } from "../support/fixtures";
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
  return success(await client.callTool("read_region", { context: { worldSessionId: edit.context.worldSessionId }, mapId: edit.mapId, layerIds: [edit.layerId], region: { x: 0, y: 0, width: 8, height: 8 } })).data.layers;
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

test("pending AI work blocks manual paint, preserves camera pan, and stays visible under Tab", async ({ page }) => {
  const client = await setup(page);
  try {
    const session = success(await client.getSession());
    const readManual = async () => success(await client.callTool("read_region", { context: { worldSessionId: session.worldSessionId! }, mapId: session.data.activeMapId!, layerIds: [session.data.activeLayerId!], region: { x: 0, y: 0, width: 8, height: 8 } })).data.layers;
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
