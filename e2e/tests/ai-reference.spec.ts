import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, confirmTilesetCard } from "../support/fixtures";
import { connect } from "../support/agentClient";
import type { AgentToolResult, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

test.use({ viewport: { width: 1366, height: 768 } });

function success<N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
}
const COLORS = ["#245a31", "#569ac5", "#c89045", "#a55c99"];
/** A 2×2 atlas of textured 32 px tiles, and a "screenshot" of a 4×3 map built from them at 0.75× with a dark gutter. */
async function pictures(page: Page) {
  return page.evaluate(async (colors) => {
    const tile = (context: OffscreenCanvasRenderingContext2D, index: number, x: number, y: number, size: number) => {
      context.fillStyle = colors[index]!; context.fillRect(x, y, size, size);
      context.fillStyle = "#f4e2b0"; context.fillRect(x + size * 0.1, y + size * 0.15, size * (0.12 + index * 0.06), size * 0.22);
    };
    const atlas = new OffscreenCanvas(64, 64), a = atlas.getContext("2d")!;
    for (let i = 0; i < 4; i++) tile(a, i, i % 2 * 32, Math.floor(i / 2) * 32, 32);
    const shot = new OffscreenCanvas(20 + 4 * 24, 20 + 3 * 24), s = shot.getContext("2d")!;
    s.fillStyle = "#1b212a"; s.fillRect(0, 0, shot.width, shot.height);
    const layout = [[0, 0, 1, 1], [2, 2, 2, 2], [3, 0, 0, 3]];
    layout.forEach((row, y) => row.forEach((index, x) => tile(s, index, 20 + x * 24, 20 + y * 24, 24)));
    const bytes = async (canvas: OffscreenCanvas, type: string) => [...new Uint8Array(await (await canvas.convertToBlob({ type, quality: 0.95 })).arrayBuffer())];
    return { atlas: await bytes(atlas, "image/png"), shot: await bytes(shot, "image/jpeg") };
  }, COLORS);
}

test("a dropped picture becomes an agent reference that quantizes into a paint_grid proposal", async ({ page }) => {
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  const { atlas, shot } = await pictures(page);
  await dropFile(page, "body", "reference-art-32.png", atlas);
  for (const [label, value] of [["Tile genişliği", "32"], ["Tile yüksekliği", "32"], ["Kenar (margin)", "0"], ["Aralık (spacing)", "0"]] as const)
    await page.getByTestId("tileset-card").getByLabel(label, { exact: true }).fill(value);
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
  await page.keyboard.press("Control+k"); await page.locator('[id="command-view.aiActivity"]').click();
  const panel = page.locator("[data-ai-activity]");
  await expect(panel.locator("[data-ai-references]")).toContainText("Resmi buraya bırakın veya yapıştırın");
  // Dropping on the panel adds a reference and never imports a tileset.
  await dropFile(page, "[data-ai-activity]", "köy.jpg", shot, "image/jpeg");
  await expect(panel.locator("[data-ai-reference]")).toHaveCount(1);
  await expect(panel.locator("[data-ai-reference]")).toContainText("köy");
  await expect(page.getByTestId("tileset-card")).toHaveCount(0);
  await page.locator('[data-panel-tab="aiActivity"]').scrollIntoViewIfNeeded();
  await panel.screenshot({ path: test.info().outputPath("reference-panel.png") });

  const client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  try {
    const session = success(await client.getSession());
    expect(session.data.references).toEqual([expect.objectContaining({ name: "köy", width: 116, height: 92, origin: "user" })]);
    const referenceId = session.data.references[0]!.referenceId, mapId = session.data.activeMapId!;
    const tilesetId = success(await client.callTool("list_tilesets", { context: { worldSessionId: session.worldSessionId! } })).data.items[0]!.id;
    const raw = await client.callTool("reference_quantize", { referenceId, mapId, region: { x: 0, y: 0, width: 4, height: 3 }, mode: "render" });
    const quantized = success(raw);
    // The dark gutter is trimmed automatically (JPEG may blur its edge by a pixel).
    const { sourceRect } = quantized.data;
    expect(Math.abs(sourceRect.x - 20) + Math.abs(sourceRect.y - 20) + Math.abs(sourceRect.width - 96) + Math.abs(sourceRect.height - 72)).toBeLessThanOrEqual(4);
    const ground = quantized.data.grid.layers[0]!;
    const decoded = ground.rows.map(row => [...row].map(ch => (ground.legend[ch] as { tileId: number }).tileId));
    expect(decoded).toEqual([[0, 0, 1, 1], [2, 2, 2, 2], [3, 0, 0, 3]]);
    expect(Object.values(ground.legend).every(cell => (cell as { tilesetId: string }).tilesetId === tilesetId)).toBe(true);
    expect(raw.content.some(block => block.type === "image")).toBe(true);
    const view = success(await client.callTool("reference_view", { referenceId, mapId, region: { x: 0, y: 0, width: 4, height: 3 }, zoom: 2 }));
    expect(view.data.image.cellSize).toEqual({ width: 64, height: 64 });
    const compare = success(await client.callTool("render_compare", { mapId, referenceId, region: { x: 0, y: 0, width: 4, height: 3 }, mode: "diff" }));
    expect(compare.data.mismatch.cells).toBe(12);
  } finally { await client.close(); }
  await panel.locator("[data-ai-reference]").getByRole("button", { name: "Kaldır" }).click();
  await expect(panel.locator("[data-ai-reference]")).toHaveCount(0);
});
