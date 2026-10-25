import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, confirmTilesetCard } from "../support/fixtures";
import { connect } from "../support/agentClient";
import type { AgentToolResult, ToolArguments, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

test.use({ viewport: { width: 1366, height: 768 } });

function success<N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
}
/** A 4×2 atlas of 32 px tiles (grass, a two-tile cart, a crate on transparency) and a picture of a 12×8 map built
 * from it at 2× with a 7,5 px offset: cart at 3,2, crate at 8,5 and a second crate stacked on it 6 px lower. */
async function pictures(page: Page) {
  return page.evaluate(async () => {
    const atlas = new OffscreenCanvas(128, 64), a = atlas.getContext("2d")!;
    a.fillStyle = "#4f9a45"; a.fillRect(0, 0, 32, 32);
    a.fillStyle = "#3d7d37"; for (let i = 0; i < 24; i++) a.fillRect((i * 13) % 31, (i * 7) % 31, 2, 1);
    // Cart: body across tiles 2–3, wheels below.
    a.fillStyle = "#8a5a2b"; a.fillRect(68, 6, 56, 16);
    a.fillStyle = "#5c3a1a"; a.fillRect(68, 6, 56, 3); a.fillRect(68, 13, 56, 2);
    a.fillStyle = "#2b2b30"; a.beginPath(); a.arc(80, 25, 5, 0, 7); a.arc(112, 25, 5, 0, 7); a.fill();
    // Crate: tile 4 (second row), inset.
    a.fillStyle = "#5a3a1c"; a.fillRect(2, 34, 28, 28);
    a.fillStyle = "#c08a4a"; a.fillRect(5, 37, 22, 22);
    a.fillStyle = "#7a5228"; a.fillRect(5, 44, 22, 2); a.fillRect(5, 51, 22, 2); a.fillRect(15, 37, 2, 22);
    const shot = new OffscreenCanvas(7 + 12 * 64, 5 + 8 * 64), s = shot.getContext("2d")!;
    s.imageSmoothingEnabled = false;
    s.fillStyle = "#1b212a"; s.fillRect(0, 0, shot.width, shot.height);
    const put = (sx: number, sy: number, w: number, h: number, x: number, y: number) => s.drawImage(atlas, sx, sy, w, h, 7 + x * 2, 5 + y * 2, w * 2, h * 2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) put(0, 0, 32, 32, x * 32, y * 32);
    put(64, 0, 64, 32, 3 * 32, 2 * 32);
    put(0, 32, 32, 32, 8 * 32, 5 * 32);
    put(0, 32, 32, 32, 8 * 32, 4 * 32 + 6);
    const bytes = async (canvas: OffscreenCanvas) => [...new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())];
    return { atlas: await bytes(atlas), shot: await bytes(shot) };
  });
}

test("suggested stamps are created on approval and found in a reference picture, stacked crates included", async ({ page }) => {
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  const { atlas, shot } = await pictures(page);
  await dropFile(page, "body", "objects-32.png", atlas);
  for (const [label, value] of [["Tile genişliği", "32"], ["Tile yüksekliği", "32"], ["Kenar (margin)", "0"], ["Aralık (spacing)", "0"]] as const)
    await page.getByTestId("tileset-card").getByLabel(label, { exact: true }).fill(value);
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
  const client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  try {
    const session = success(await client.getSession());
    const readContext = { worldSessionId: session.worldSessionId! }, mapId = session.data.activeMapId!, layerId = session.data.activeLayerId!;
    const tilesetId = success(await client.callTool("list_tilesets", { context: readContext })).data.items[0]!.id;
    // Suggestions are read-only: the library stays empty until create_stamp.
    const suggested = await client.callTool("suggest_stamps", { tilesetId });
    expect(success(suggested).data.candidates).toEqual([{ n: 1, region: { x: 2, y: 0, width: 2, height: 1 }, tileIds: [2, 3] }]);
    expect(suggested.content.some(block => block.type === "image")).toBe(true);
    expect(success(await client.callTool("list_stamps", { context: readContext })).data.items).toEqual([]);

    const started = success(await client.callTool("begin_edit", { context: readContext, idempotencyKey: randomUUID(), expectedRevision: session.revision, requestLabel: "Objects", mapIds: [mapId] }));
    let context = { ...readContext, transactionId: started.data.transactionId, expectedRevision: started.revision, idempotencyKey: randomUUID() };
    const cart = success(await client.callTool("create_stamp", { context, source: { tilesetId, region: { x: 2, y: 0, width: 2, height: 1 } }, name: "Cart" }));
    context = { ...context, expectedRevision: cart.revision, idempotencyKey: randomUUID() };
    const crate = success(await client.callTool("create_stamp", { context, source: { tilesetId, region: { x: 0, y: 1, width: 1, height: 1 } }, name: "Crate" }));
    context = { ...context, expectedRevision: crate.revision, idempotencyKey: randomUUID() };
    const cartId = cart.created!.stampId!, crateId = crate.created!.stampId!;

    const reference = success(await client.callTool("reference_add", { imageBase64: Buffer.from(shot).toString("base64"), name: "objects" }));
    const raw = await client.callTool("reference_detect_objects", {
      referenceId: reference.data.referenceId, mapId,
      alignment: { cellPx: 64, scale: 2, offsetX: 7, offsetY: 5, cols: 12, rows: 8, confidence: 1, method: "manual" },
    });
    const detected = success(raw).data;
    expect(raw.content.some(block => block.type === "image")).toBe(true);
    expect(detected.matches.map(m => `${m.stampId === cartId ? "cart" : "crate"}@${m.x},${m.y},${m.pixelResidual.dy}`).sort()).toEqual(["cart@3,2,0", "crate@8,4,6", "crate@8,5,0"]);
    expect(detected.positionsByStamp[crateId]!.sort()).toEqual([[8, 4], [8, 5]]);

    for (const [stampId, sourceLayerId] of [[cartId, cart.created!.sourceLayerIds![0]!], [crateId, crate.created!.sourceLayerIds![0]!]] as const) {
      // positions (many copies in one call) is schema-only; the typed args name the single-copy form.
      const args = { context, mapId, stampId, positions: detected.positionsByStamp[stampId]!, layerMapping: [{ sourceLayerId, targetLayerId: layerId }] } as unknown as ToolArguments["place_stamp"];
      const placed = success(await client.callTool("place_stamp", args));
      expect(placed.changed).toBeGreaterThan(0);
      context = { ...context, expectedRevision: placed.revision, idempotencyKey: randomUUID() };
    }
    success(await client.callTool("cancel_edit", { context }));
    expect(success(await client.callTool("list_stamps", { context: readContext })).data.items).toEqual([]);
  } finally { await client.close(); }
});
