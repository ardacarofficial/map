import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, confirmTilesetCard } from "../support/fixtures";
import { connect, type AgentClient } from "../support/agentClient";
import type { AgentToolResult, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

test.use({ viewport: { width: 1366, height: 768 } });

function success<N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
}

async function setup(page: Page) {
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  // Four opaque, asymmetric tiles give one exact match and require no external image encoder.
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(64, 64), context = canvas.getContext("2d")!;
    for (const [index, color] of ["#245a31", "#569ac5", "#c89045", "#a55c99"].entries()) {
      const x = index % 2 * 32, y = Math.floor(index / 2) * 32;
      context.fillStyle = color;
      context.fillRect(x, y, 32, 32);
      context.fillStyle = "#f4e2b0";
      context.fillRect(x + 3, y + 5, 4 + index, 7);
    }
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer())];
  });
  await dropFile(page, "body", "reference-art-32.png", png);
  await page.getByTestId("tileset-card").getByLabel("Tile genişliği", { exact: true }).fill("32");
  await page.getByTestId("tileset-card").getByLabel("Tile yüksekliği", { exact: true }).fill("32");
  await page.getByTestId("tileset-card").getByLabel("Kenar (margin)", { exact: true }).fill("0");
  await page.getByTestId("tileset-card").getByLabel("Aralık (spacing)", { exact: true }).fill("0");
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
  const client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  const session = success(await client.getSession());
  const readContext = { worldSessionId: session.worldSessionId! };
  const tilesets = success(await client.callTool("list_tilesets", { context: readContext }));
  expect(tilesets.data.items[0]).toMatchObject({ tileWidth: 32, tileHeight: 32, columns: 2, rows: 2 });
  return { client, readContext, png, tilesetId: tilesets.data.items[0]!.id, mapId: session.data.activeMapId!, layerId: session.data.activeLayerId! };
}

async function begin(client: AgentClient, worldSessionId: string, mapId: string) {
  const session = success(await client.getSession());
  const started = success(await client.callTool("begin_edit", {
    context: { worldSessionId }, idempotencyKey: randomUUID(), expectedRevision: session.revision,
    requestLabel: "Reference assets", mapIds: [mapId],
  }));
  return { worldSessionId, transactionId: started.data.transactionId, expectedRevision: started.revision, idempotencyKey: randomUUID() };
}

async function cells(environment: Awaited<ReturnType<typeof setup>>) {
  return success(await environment.client.callTool("read_region", {
    context: environment.readContext, mapId: environment.mapId, layerIds: [environment.layerId],
    region: { x: 0, y: 0, width: 6, height: 6 },
  })).data.layers;
}

function expectPng(result: AgentToolResult) {
  const image = result.content.find(block => block.type === "image");
  expect(image).toBeDefined();
  if (!image || image.type !== "image") throw Error("Expected PNG image content");
  expect(image.mimeType).toBe("image/png");
  expect([...Buffer.from(image.data, "base64").subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
}

test("explicit reference becomes an approved stamp and placement in one undo group", async ({ page }) => {
  const environment = await setup(page);
  const { client, readContext, tilesetId, mapId, layerId } = environment;
  try {
    const original = await cells(environment);
    const reference = success(await client.callTool("visual_ingest_reference", {
      context: readContext, pngBase64: Buffer.from(environment.png).toString("base64"),
    }));
    expect(reference.data).toMatchObject({ width: 64, height: 64 });
    const matched = success(await client.callTool("visual_match_reference", {
      context: readContext, referenceId: reference.data.referenceId, tilesetIds: [tilesetId], maxScale: 1,
    }));
    expect(matched.data).toMatchObject({ status: "matched", truncated: false });
    expect(matched.data.candidates).toHaveLength(1);
    const candidate = matched.data.candidates[0]!;
    expect(candidate).toMatchObject({ tilesetId, region: { x: 0, y: 0, width: 2, height: 2 }, flags: 0, scale: 1, match: "exact_rgba" });

    let context = await begin(client, readContext.worldSessionId, mapId);
    const created = success(await client.callTool("create_stamp", {
      context, source: { tilesetId, region: candidate.region }, name: "Reference courtyard", category: "Garden", tags: ["village"],
    }));
    expect(created.data).toMatchObject({ width: 2, height: 2 });
    const stampId = created.data.stampId;
    context = { ...context, expectedRevision: created.revision, idempotencyKey: randomUUID() };
    const libraryPreview = await client.callTool("list_stamps", { context: readContext, previewStampId: stampId });
    expect(success(libraryPreview).data.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: stampId, tags: ["village"] })]));
    expectPng(libraryPreview);
    const placed = success(await client.callTool("place_stamp", {
      context, mapId, stampId, at: { x: 2, y: 2 },
      layerMapping: [{ sourceLayerId: created.data.sourceLayerIds[0]!, targetLayerId: layerId }],
    }));
    expect(placed.data.change.changedCells).toBe(4);
    context = { ...context, expectedRevision: placed.revision, idempotencyKey: randomUUID() };
    expect(await cells(environment)).not.toEqual(original);
    const preview = await client.callTool("render_preview", { context: readContext, mapId, region: { x: 0, y: 0, width: 6, height: 6 } });
    success(preview);
    expectPng(preview);
    success(await client.callTool("finish_edit", { context, summary: "Reusable reference courtyard" }));
    const bar = page.locator("[data-ai-bar]");
    await expect(bar).toContainText("AI değişiklikleri onay bekliyor");
    await bar.getByRole("button", { name: "Onayla", exact: true }).click();
    await expect(bar).toBeHidden();
    expect(success(await client.callTool("list_stamps", { context: readContext })).data.items.map(stamp => stamp.id)).toContain(stampId);

    await page.locator("[data-canvas-host]").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(() => cells(environment)).toEqual(original);
    expect(success(await client.callTool("list_stamps", { context: readContext })).data.items).toHaveLength(0);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => cells(environment)).not.toEqual(original);
    expect(success(await client.callTool("list_stamps", { context: readContext })).data.items.map(stamp => stamp.id)).toContain(stampId);
  } finally { await client.close(); }
});

test("semantic searches find current tags and map captures disappear on human discard", async ({ page }) => {
  const environment = await setup(page);
  const { client, readContext, tilesetId, mapId, layerId } = environment;
  try {
    const original = await cells(environment);
    const catalogue = success(await client.callTool("get_tile_catalog", { context: readContext, tilesetId, tileIds: [0], image: "none" }));
    success(await client.callTool("set_tags", {
      context: { ...readContext, idempotencyKey: randomUUID() },
      entries: [{ target: { kind: "tile", tilesetId, tileId: 0 }, expectedFingerprint: catalogue.data.items[0]!.fingerprint, tags: ["Water", "river"] }],
    }));
    const water = () => client.callTool("get_tags", { context: readContext, kind: "tiles", status: "all", query: "  WATER  " });
    expect(success(await water()).data.items).toEqual(expect.arrayContaining([expect.objectContaining({ tags: ["Water", "river"], status: "current" })]));
    expect(success(await client.callTool("get_tags", { context: readContext, status: "all", query: "su" })).data.items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ target: { kind: "tile", tilesetId, tileId: 0 } })]));
    expect(success(await client.callTool("get_tags", { context: readContext, status: "all", query: "unrelated" })).data.items).toHaveLength(0);

    let context = await begin(client, readContext.worldSessionId, mapId);
    const painted = success(await client.callTool("paint_rect", {
      context, mapId, layerId, region: { x: 0, y: 0, width: 2, height: 1 }, value: { tilesetId, tileId: 0 },
    }));
    context = { ...context, expectedRevision: painted.revision, idempotencyKey: randomUUID() };
    const captured = success(await client.callTool("create_stamp", {
      context, source: { mapId, layerIds: [layerId], region: { x: 0, y: 0, width: 2, height: 1 } },
      name: "River edge", category: "Nature", tags: ["shore"],
    }));
    context = { ...context, expectedRevision: captured.revision, idempotencyKey: randomUUID() };
    const stampId = captured.data.stampId;
    const found = success(await client.callTool("list_stamps", { context: readContext, query: " SHORE " }));
    expect(found.data.items.map(stamp => stamp.id)).toEqual([stampId]);
    const annotated = success(await client.callTool("set_tags", {
      context: { ...readContext, idempotencyKey: randomUUID() },
      entries: [{ target: { kind: "stamp", stampId }, expectedFingerprint: found.data.items[0]!.fingerprint, tags: ["bank"] }],
    }));
    context = { ...context, expectedRevision: annotated.revision, idempotencyKey: randomUUID() };
    expect(success(await client.callTool("list_stamps", { context: readContext, query: "BANK" })).data.items.map(stamp => stamp.id)).toEqual([stampId]);
    expect(success(await client.callTool("list_stamps", { context: readContext, query: "unrelated" })).data.items).toHaveLength(0);
    success(await client.callTool("finish_edit", { context }));
    const bar = page.locator("[data-ai-bar]");
    await expect(bar).toContainText("AI değişiklikleri onay bekliyor");
    await bar.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await expect(bar).toBeHidden();
    expect(await cells(environment)).toEqual(original);
    expect(success(await client.callTool("list_stamps", { context: readContext })).data.items).toHaveLength(0);
    expect(success(await water()).data.items).toEqual(expect.arrayContaining([expect.objectContaining({ tags: ["Water", "river"], status: "current" })]));
  } finally { await client.close(); }
});

test("selected editor crop is explicitly shared, matched and included only as metrics in diagnostics",async({page})=>{
  const environment=await setup(page),{client,readContext,tilesetId,mapId,layerId}=environment;
  try {
    const original=await cells(environment),grid=page.locator(`[data-tileset-grid="${tilesetId}"]`);
    const scale=Number(await grid.getAttribute("data-tileset-scale")),box=(await grid.boundingBox())!;
    await page.mouse.move(box.x+16*scale,box.y+16*scale);await page.mouse.down();
    await page.mouse.move(box.x+48*scale,box.y+48*scale,{steps:5});await page.mouse.up();
    const selected=success(await client.callTool("get_editor_context",{context:readContext}));
    expect(selected.data).toMatchObject({activeMapId:mapId,activeLayerId:layerId,selection:{tilesetId,region:{x:0,y:0,width:2,height:2},tileIds:[0,1,2,3],truncated:false},viewport:{view:"level"},reference:null});
    const token=selected.data.contextToken;
    await page.locator('[data-inspector-section="ai-tags"]').getByRole("button",{name:"Seçimi referans olarak paylaş",exact:true}).click();
    let shared=success(await client.callTool("get_editor_context",{context:readContext}));
    await expect.poll(async()=>{
      shared=success(await client.callTool("get_editor_context",{context:readContext}));
      return shared.data.reference;
    }).not.toBeNull();
    expect(shared.data.contextToken).not.toBe(token);
    expect(shared.data.reference).toMatchObject({width:64,height:64});
    const reference=success(await client.callTool("visual_ingest_reference",{context:readContext,selectedReferenceToken:shared.data.reference!.selectionToken}));
    const matched=success(await client.callTool("visual_match_reference",{context:readContext,referenceId:reference.data.referenceId,tilesetIds:[tilesetId],maxScale:1}));
    expect(matched.data).toMatchObject({status:"matched",candidates:[{tilesetId,region:{x:0,y:0,width:2,height:2},match:"exact_rgba"}]});
    expect(await cells(environment)).toEqual(original);
    expect(success(await client.getSession()).data.transaction).toBeNull();
    await grid.click({position:{x:16*scale,y:16*scale}});
    expect(success(await client.callTool("get_editor_context",{context:readContext})).data.contextToken).not.toBe(shared.data.contextToken);
    await page.keyboard.press("Control+k");await page.locator('[id="command-view.aiActivity"]').click();
    const downloadPromise=page.waitForEvent("download");
    await page.locator("[data-ai-activity]").getByRole("button",{name:"Tanılamayı dışa aktar",exact:true}).click();
    const download=await downloadPromise;expect(download.suggestedFilename()).toBe("smap-ai-diagnostics.json");
    const stream=await download.createReadStream(),chunks:Buffer[]=[];
    for await(const chunk of stream)chunks.push(Buffer.from(chunk));
    const raw=Buffer.concat(chunks).toString("utf8"),diagnostics=JSON.parse(raw);
    expect(diagnostics).toMatchObject({format:"smap-ai-diagnostics",version:1});
    expect(diagnostics.rows).toEqual(expect.arrayContaining([expect.objectContaining({tool:"visual_match_reference",status:"succeeded",textBytes:expect.any(Number),resultBytes:expect.any(Number)})]));
    for(const secret of [shared.data.reference!.selectionToken,reference.data.referenceId,process.env.HARITA_MCP_TOKEN??"e2e-token-harita-protocol","pngBase64"])expect(raw).not.toContain(secret);
  } finally {await client.close();}
});
