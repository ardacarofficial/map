import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { test, expect, dropFile, sampleBytes, confirmTilesetCard } from "../support/fixtures";
import { connect, type AgentClient } from "../support/agentClient";
import type { AgentToolResult, Rect, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

const success = <N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> => {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
};
function memberRevision(result: { memberRevision?: number }): number {
  expect(result.memberRevision).toEqual(expect.any(Number));
  return result.memberRevision!;
}
interface MemberEdit { client: AgentClient; id: string; revision: number }
const regions = {
  coordinator: { x: 0, y: 0, width: 6, height: 12 },
  peer: { x: 6, y: 0, width: 6, height: 6 },
  cancelled: { x: 6, y: 6, width: 6, height: 6 },
} satisfies Record<string, Rect>;

test.use({ viewport: { width: 1440, height: 900 } });
test("three agents share a live draft; member cancellation preserves peers and one approval produces one undo", async ({ page }) => {
  test.setTimeout(120_000);
  const pair = randomUUID(), token = process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol";
  await page.goto(`/?agent=${pair}`);
  await dropFile(page, "body", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await confirmTilesetCard(page);
  await expect(page.locator("[data-canvas-host] canvas").first()).toBeVisible();
  await page.waitForFunction(() => !!(window as unknown as { __smap?: { setCamera?: unknown } }).__smap?.setCamera);
  await page.evaluate(() => (window as unknown as { __smap: { setCamera(x: number, y: number, zoom: number): void } }).__smap.setCamera(16, 16, 1));
  const clients: AgentClient[] = [];
  try {
    for (const name of ["Meadow agent", "House agent", "Path agent"]) clients.push(await connect(pair, token, undefined, { name, version: "1.0" }));
    const [founder, peer, temporary] = clients as [AgentClient, AgentClient, AgentClient];
    const session = success(await founder.getSession()), worldSessionId = session.worldSessionId!;
    const mapId = session.data.activeMapId!, layerId = session.data.activeLayerId!, readContext = { worldSessionId };
    const tilesets = success(await founder.callTool("list_tilesets", { context: readContext })), tilesetId = tilesets.data.items[0]!.id;
    const claim = (region: Rect) => [{ mapId, layerIds: [layerId], region }];
    const read = async (region: Rect) => success(await founder.callTool("read_region", { context: readContext, mapId, layerIds: [layerId], region })).data;
    const preview = async (region: Rect) => {
      const result = await founder.callTool("render_preview", { context: readContext, mapId, region, layerIds: [layerId], maxSide: 512, grid: false, coordinates: false, entities: false });
      success(result);
      const image = result.content.find(block => block.type === "image");
      expect(image?.type).toBe("image");
      if (!image || image.type !== "image") throw Error("Missing rendered preview");
      return Buffer.from(image.data, "base64");
    };
    const full = { x: 0, y: 0, width: 12, height: 12 }, baseline = await read(full), baselinePreview = await preview(full);
    const cancelledBaseline = await read(regions.cancelled), cancelledPreviewBaseline = await preview(regions.cancelled);
    const meadowBaseline = await read(regions.coordinator), houseBaseline = await read(regions.peer);
    const begun = success(await founder.callTool("begin_edit", {
      context: readContext, idempotencyKey: randomUUID(), expectedRevision: tilesets.revision,
      requestLabel: "Three-agent garden", mapIds: [mapId], collaboration: { mode: "regions", claims: claim(regions.coordinator) },
    }));
    const transactionId = begun.data.transactionId;
    const coordinator: MemberEdit = { client: founder, id: begun.data.memberId!, revision: memberRevision(begun) };
    const join = async (client: AgentClient, region: Rect): Promise<MemberEdit> => {
      const current = success(await client.getSession());
      const joined = success(await client.callTool("join_edit", { context: readContext, transactionId, idempotencyKey: randomUUID(), expectedRevision: current.revision, claims: claim(region) }));
      return { client, id: joined.data.memberId, revision: memberRevision(joined) };
    };
    const house = await join(peer, regions.peer), path = await join(temporary, regions.cancelled);
    const context = (member: MemberEdit) => ({ worldSessionId, transactionId, expectedMemberRevision: member.revision, idempotencyKey: randomUUID() });
    const paint = async (member: MemberEdit, region: Rect, tileId: number) => {
      const changed = success(await member.client.callTool("paint_rect", { context: context(member), mapId, layerId, region, value: { tilesetId, tileId } }));
      member.revision = memberRevision(changed);
    };
    await Promise.all([paint(coordinator, regions.coordinator, 0), paint(house, regions.peer, 1), paint(path, regions.cancelled, 3)]);
    const activity = page.locator("[data-ai-activity]"), draft = activity.locator("[data-ai-collaboration]"), bar = page.locator("[data-ai-bar]");
    const prepareCapture = () => activity.locator('[role="region"]').evaluate(element => {
      // Capture the default overview after inspecting the expanded claim coordinates.
      element.querySelectorAll<HTMLDetailsElement>("[data-ai-collaboration] details").forEach(disclosure => { disclosure.open = false; });
      element.scrollTop = 0;
    });
    await expect(draft.locator("[data-ai-member]")).toHaveCount(3);
    await expect(draft).toContainText("Meadow agent"); await expect(draft).toContainText("House agent"); await expect(draft).toContainText("Path agent");
    await expect(bar.getByRole("button", { name: "Taslağı onayla", exact: true })).toHaveCount(1);
    await page.evaluate(async () => {
      const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
      useDockStore.getState().setSize("bottom", 300);
    });
    for (const disclosure of await draft.locator("details summary").all()) await disclosure.click();
    await expect(draft).toContainText("6, 6");
    writeFileSync(test.info().outputPath("three-agent-live-preview.png"), await preview(full));
    await prepareCapture();
    await page.screenshot({ path: test.info().outputPath("three-agent-live-draft.png") });

    const finishedFounder = success(await founder.callTool("finish_edit", { context: context(coordinator), summary: "Meadow ready" }));
    coordinator.revision = memberRevision(finishedFounder);
    await expect(draft.locator(`[data-ai-member="${coordinator.id}"]`)).toContainText("Hazır");
    await expect(draft.locator(`[data-ai-member="${house.id}"]`)).toContainText("Çalışıyor");
    await paint(house, { x: 8, y: 1, width: 3, height: 2 }, 27); // A visible roof after coordinator finish.
    const meadowBeforeCancel = await read(regions.coordinator), houseBeforeCancel = await read(regions.peer);
    const meadowPreviewBeforeCancel = await preview(regions.coordinator), housePreviewBeforeCancel = await preview(regions.peer);
    expect(meadowBeforeCancel.layers).not.toEqual(meadowBaseline.layers);
    expect(houseBeforeCancel.layers).not.toEqual(houseBaseline.layers);
    const cancelled = success(await temporary.callTool("cancel_edit", { context: context(path), reason: "Remove my path contribution" }));
    path.revision = memberRevision(cancelled);
    expect(await read(regions.cancelled)).toEqual(cancelledBaseline);
    expect((await preview(regions.cancelled)).equals(cancelledPreviewBaseline)).toBe(true);
    expect(await read(regions.coordinator)).toEqual(meadowBeforeCancel);
    expect(await read(regions.peer)).toEqual(houseBeforeCancel);
    expect((await preview(regions.coordinator)).equals(meadowPreviewBeforeCancel)).toBe(true);
    expect((await preview(regions.peer)).equals(housePreviewBeforeCancel)).toBe(true);
    await expect(draft.locator(`[data-ai-member="${path.id}"]`)).toContainText("Katkısı geri alındı");
    success(await peer.callTool("finish_edit", { context: context(house), summary: "House ready" }));
    await peer.close(); clients.splice(clients.indexOf(peer), 1);
    await expect(draft.locator(`[data-ai-member="${house.id}"]`)).toContainText("Bağlantı kesildi");
    await expect(draft.locator(`[data-ai-member="${house.id}"]`)).toContainText("Katkısı inceleme için korundu");
    await expect(bar).toContainText("AI değişiklikleri onay bekliyor");
    const kept = await read(full), keptPreview = await preview(full);
    expect(keptPreview.equals(baselinePreview)).toBe(false);
    writeFileSync(test.info().outputPath("shared-draft-kept-preview.png"), keptPreview);
    await prepareCapture();
    await page.screenshot({ path: test.info().outputPath("shared-draft-review.png") });
    await page.evaluate(async () => {
      const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
      useDockStore.getState().move("aiActivity", { zone: "right", group: 0 });
      useDockStore.getState().setSize("right", 360);
      useDockStore.getState().setSize("bottom", 68);
    });
    await expect(draft.locator(`[data-ai-member="${house.id}"]`)).toBeVisible();
    await prepareCapture();
    await page.screenshot({ path: test.info().outputPath("shared-draft-right-dock.png") });

    await bar.getByRole("button", { name: "Taslağı onayla", exact: true }).click();
    await expect(bar).toBeHidden();
    expect(await read(full)).toEqual(kept);
    expect((await preview(full)).equals(keptPreview)).toBe(true);
    const outcome = (id: string) => activity.locator(`[data-ai-entry-member="${id}"]`).filter({ has: page.locator("summary", { hasText: /^paint_rect$/ }) }).first().locator("td").nth(4);
    await expect(outcome(coordinator.id)).toHaveText("Onaylandı");
    await expect(outcome(house.id)).toHaveText("Onaylandı");
    await expect(outcome(path.id)).toHaveText("Geri alındı");
    await page.locator("[data-canvas-host]").focus(); await page.keyboard.press("Control+z");
    await expect.poll(() => read(full)).toEqual(baseline);
    expect((await preview(full)).equals(baselinePreview)).toBe(true);
  } finally { for (const client of clients) await client.close(); }
});
