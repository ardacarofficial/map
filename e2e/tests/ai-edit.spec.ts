import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { AiMcpClient, aiRuntimeAvailable } from "../fixtures/aiMcp";
import { randomUUID } from "node:crypto";

test.use({ viewport: { width: 1366, height: 768 } });
test.skip(!aiRuntimeAvailable, "Requires merged lane 2 runtime and lane 4 real dev MCP host");

async function begin(client: AiMcpClient) {
  const session = await client.call("get_session");
  const mapId = session.data.activeMapId as string;
  const layerId = session.data.activeLayerId as string;
  const started = await client.call("begin_edit", { context: { worldSessionId: session.worldSessionId }, idempotencyKey: randomUUID(), expectedRevision: session.revision, requestLabel: "Garden", mapIds: [mapId] });
  const context = { worldSessionId: session.worldSessionId, transactionId: started.data.transactionId as string, expectedRevision: started.revision, idempotencyKey: randomUUID() };
  const changed = await client.call("paint_rect", { context, mapId, layerId, region: { x: 2, y: 2, width: 2, height: 2 }, value: { collision: 1 } });
  return { context: { ...context, expectedRevision: changed.revision, idempotencyKey: randomUUID() }, mapId, layerId };
}
async function cells(client: AiMcpClient, worldSessionId: string, mapId: string, layerId: string) {
  const reply = await client.call("read_region", { context: { worldSessionId }, mapId, layerIds: [layerId], region: { x: 0, y: 0, width: 8, height: 8 } });
  return reply.data.layers;
}
async function addCollision(client: AiMcpClient) {
  const session = await client.call("get_session");
  const mapId = session.data.activeMapId as string;
  const begun = await client.call("begin_edit", { context: { worldSessionId: session.worldSessionId }, idempotencyKey: randomUUID(), expectedRevision: session.revision, requestLabel: "Fixture layer", mapIds: [mapId] });
  await client.call("edit_layer", { context: { worldSessionId: session.worldSessionId, transactionId: begun.data.transactionId, idempotencyKey: randomUUID(), expectedRevision: begun.revision }, mapId, action: "create", kind: "collision", name: "Collision" });
}
async function activateCollision(page: Page) {
  // Selection is a user action; map writes above are exclusively MCP operations.
  await page.locator('[data-layers-list]').getByText("Collision", { exact: true }).click();
}

for (const action of ["approve", "discard"] as const) test(`AI ${action} restores the original through one undo or immediate rollback`, async ({ page, request }) => {
  const client = await AiMcpClient.connect(page, request);
  try {
    await addCollision(client);
    await page.locator("[data-ai-bar]").getByRole("button", { name: "Onayla", exact: true }).click();
    await activateCollision(page);
    const session = await client.call("get_session");
    const original = await cells(client, session.worldSessionId, session.data.activeMapId as string, session.data.activeLayerId as string);
    const edit = await begin(client);
    const bar = page.locator("[data-ai-bar]");
    await expect(bar).toBeVisible(); await expect(bar).toContainText("AI UX e2e");
    expect(await cells(client, edit.context.worldSessionId, edit.mapId, edit.layerId)).not.toEqual(original);
    await client.call("finish_edit", { context: edit.context, summary: "Garden" });
    await expect(bar).toContainText("AI değişiklikleri onay bekliyor");
    await bar.getByRole("button", { name: action === "approve" ? "Onayla" : "Vazgeç", exact: true }).click();
    await expect(bar).toBeHidden();
    await expect(page.locator("[data-canvas-host]")).toBeFocused();
    if (action === "approve") await page.keyboard.press("Control+z");
    await expect.poll(() => cells(client, edit.context.worldSessionId, edit.mapId, edit.layerId)).toEqual(original);
    await expect(page.locator("[data-ai-activity]")).toContainText(action === "approve" ? "Onaylandı" : "Geri alındı");
  } finally { await client.close(); }
});

test("pending AI work blocks manual paint, preserves camera pan, and stays visible under Tab", async ({ page, request }) => {
  const client = await AiMcpClient.connect(page, request);
  try {
    await addCollision(client); await page.locator("[data-ai-bar]").getByRole("button", { name: "Onayla", exact: true }).click(); await activateCollision(page);
    const edit = await begin(client);
    const original = await cells(client, edit.context.worldSessionId, edit.mapId, edit.layerId);
    const point = () => page.evaluate(() => (window as unknown as { __smap: { cellCenter(x: number, y: number): { x: number; y: number } } }).__smap.cellCenter(5, 5));
    const at = await point();
    await page.mouse.click(at.x, at.y);
    expect(await cells(client, edit.context.worldSessionId, edit.mapId, edit.layerId)).toEqual(original);
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
