/**
 * T-06 regression: after the AI created "Zindan" and many approve/discard
 * cycles, project.smap listed levels/zindan.json while the file was gone, and
 * every save then failed (toast blamed a tileset image). Saving now rewrites a
 * loaded map whose file is missing. The review bar lists the maps a draft
 * touched (click opens one) and counts layer/entity changes, not only cells.
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, dropFile, sampleBytes, confirmTilesetCard, readOpfsText } from "../support/fixtures";
import { connect, type AgentClient } from "../support/agentClient";
import type { AgentToolResult, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

const success = <N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> => {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
};

async function save(page: Page) {
  await page.locator("[data-canvas-host]").focus();
  await page.keyboard.press("Control+s");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
}

class Draft {
  context: { worldSessionId: string; transactionId: string; expectedRevision: number; idempotencyKey: string };
  constructor(private client: AgentClient, worldSessionId: string, transactionId: string, revision: number) {
    this.context = { worldSessionId, transactionId, expectedRevision: revision, idempotencyKey: randomUUID() };
  }
  static async begin(client: AgentClient, mapIds: string[]) {
    const session = success(await client.getSession());
    const worldSessionId = session.worldSessionId!;
    const started = success(await client.callTool("begin_edit", { context: { worldSessionId }, idempotencyKey: randomUUID(), expectedRevision: session.revision, requestLabel: "Zindan", mapIds }));
    return new Draft(client, worldSessionId, started.data.transactionId, started.revision);
  }
  async call<N extends ToolName>(name: N, args: Record<string, unknown>) {
    const result = success(await this.client.callTool(name, { context: this.context, ...args } as never));
    this.context = { ...this.context, expectedRevision: result.revision, idempotencyKey: randomUUID() };
    return result;
  }
}

test("a missing AI map file is rewritten on save; the review bar lists touched maps and counts layers", async ({ page }) => {
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
  await save(page);
  const client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  const bar = page.locator("[data-ai-bar]");
  try {
    const session = success(await client.getSession());
    const mainId = session.data.activeMapId!;
    const tilesetId = success(await client.callTool("list_tilesets", { context: { worldSessionId: session.worldSessionId! } })).data.items[0]!.id;

    // The AI creates Zindan; the user approves it and the world is saved.
    const create = await Draft.begin(client, [mainId]);
    const zindan = { id: (await create.call("create_map", { name: "Zindan", width: 10, height: 8, tileWidth: 32, tileHeight: 32 })).created!.mapId! };
    const zindanLayer = success(await client.callTool("get_map_info", { context: { worldSessionId: create.context.worldSessionId }, mapId: zindan.id })).data.layers[0]!.id;
    await create.call("paint_rect", { mapId: zindan.id, layerId: zindanLayer, region: { x: 0, y: 0, width: 3, height: 3 }, value: { tilesetId, tileId: 0 } });
    await create.call("finish_edit", { summary: "Zindan" });
    await bar.getByRole("button", { name: "Onayla", exact: true }).click();
    await expect(bar).toBeHidden();
    await save(page);
    const saved = await readOpfsText(page, "levels/zindan.json");
    expect(saved).not.toBeNull();

    // A draft on both maps: the bar counts the new layer and lists both maps.
    const draft = await Draft.begin(client, [mainId, zindan.id]);
    await draft.call("paint_rect", { mapId: zindan.id, layerId: zindanLayer, region: { x: 4, y: 4, width: 2, height: 2 }, value: { tilesetId, tileId: 0 } });
    await draft.call("edit_layer", { mapId: zindan.id, action: "create", name: "Kapılar", kind: "entity" });
    await expect(bar.locator("[data-ai-changes]")).toHaveAttribute("data-ai-changes", "5");
    await expect(bar.locator("[data-ai-changes]")).toHaveAttribute("title", "4 hücre · 1 katman");
    await bar.locator("[data-ai-maps]").click();
    await expect(page.locator("[data-ai-map]")).toHaveCount(2);
    await page.locator(`[data-ai-map="${zindan.id}"]`).click();
    await expect(page.locator(`[data-doc-tab="${zindan.id}"]`)).toHaveAttribute("aria-selected", "true");
    // Navigation keeps the draft: the bar stays and the AI's changes stay visible.
    await expect(bar).toContainText("AI çalışıyor");
    await expect(bar.locator("[data-ai-changes]")).toHaveAttribute("data-ai-changes", "5");
    await bar.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await expect(bar).toBeHidden();

    // The broken state from the T-06 run: project.smap lists Zindan, its file is gone.
    await page.evaluate(async () => { await (await (await navigator.storage.getDirectory()).getDirectoryHandle("levels")).removeEntry("zindan.json"); });
    expect(await readOpfsText(page, "levels/zindan.json")).toBeNull();
    await save(page);
    await expect(page.getByText("Kaydedilemedi", { exact: false })).toHaveCount(0);
    await expect.poll(() => readOpfsText(page, "levels/zindan.json")).toBe(saved);
    const project = JSON.parse((await readOpfsText(page, "project.smap"))!) as { levels: { path: string }[] };
    expect(project.levels.map(level => level.path)).toEqual(["levels/main.json", "levels/zindan.json"]);
  } finally { await client.close(); }
});
