import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, readOpfsText, startWithTileset, test } from "../support/fixtures";
import { connect } from "../support/agentClient";
import type { AgentToolResult, ToolName, ToolSuccess } from "../../packages/agent/src/contracts";

// v2.2 "Basit Tiled içe aktarma": Dosya → İçe aktar → Tiled haritası… creates a new map in the
// current world from a TMX (external TSX + embedded tileset, flips), lists what was not imported,
// and saves the copied PNGs as world tilesets.

const fixture = (path: string) => ({ name: path.split("/").pop()!, mimeType: path.endsWith(".png") ? "image/png" : "application/xml", buffer: readFileSync(new URL(`../fixtures/tiled/${path}`, import.meta.url)) });

interface Doc { map: { width: number; height: number; tileWidth: number }; layers: { name: string; visible: boolean; opacity: number; getCell(x: number, y: number): number }[]; tilesets: { id: string; name: string }[]; palette: { get(i: number): { tilesetId: string; tileId: number } | undefined } }

test("Tiled TMX import: menu → new map with tilesets, flips and the not-imported list; saved", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await startWithTileset(page, "tilesets/dungeon-16.png");

  await page.getByRole("menuitem", { name: "Dosya", exact: true }).click();
  await page.getByRole("menuitem", { name: "İçe aktar", exact: true }).hover();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: /Tiled haritası…/ }).click();
  await (await chooser).setFiles(["village.tmx", "tilesets/dungeon.tsx", "tilesets/dungeon-16.png", "props-16.png"].map(fixture));

  const report = page.locator("[data-tiled-import-report]");
  await expect(report).toBeVisible();
  await expect(report).toContainText("Tiled haritası içe aktarıldı");
  await expect(report).toContainText("village: 3 katman, 2 tileset");
  for (const kind of ["groupLayer", "objectLayer", "animation", "unknownTile"]) await expect(report.locator(`[data-unsupported-kind='${kind}']`)).toBeVisible();
  await expect(report.locator("[data-unsupported-kind='objectLayer']")).toContainText("Spawns");
  await report.getByRole("button", { name: "Tamam", exact: true }).click();
  await expect(report).toBeHidden();

  await page.locator("[data-library-tab-button='project']").click();
  await expect(page.getByRole("listbox", { name: "Haritalar" }).getByRole("option", { name: "village" })).toHaveAttribute("aria-selected", "true");
  const facts = await page.evaluate(async () => {
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    const doc = useEditorStore.getState().project.store.document as Doc;
    const ref = (layer: number, x: number, y: number) => { const c = doc.layers[layer]!.getCell(x, y); const e = doc.palette.get(c & 0x1fffffff); return [doc.tilesets.find(t => t.id === e?.tilesetId)?.name, e?.tileId, c >>> 29]; };
    return { size: [doc.map.width, doc.map.height, doc.map.tileWidth], layers: doc.layers.map(l => [l.name, l.visible, l.opacity]), ground: ref(0, 0, 0), flipH: ref(1, 2, 1), diag: ref(1, 4, 1), all: ref(1, 5, 1), roof: ref(2, 7, 5) };
  });
  expect(facts).toEqual({
    size: [8, 6, 16],
    layers: [["Ground", true, 1], ["Decor", true, 0.5], ["Upper/Roof", false, 1]],
    // The world already had this exact dungeon sheet: it is reused, not copied again.
    ground: ["dungeon-16", 0, 0], flipH: ["Props & Things", 1, 4], diag: ["Props & Things", 3, 1], all: ["Props & Things", 4, 7], roof: ["Props & Things", 7, 2],
  });

  await page.keyboard.press("Control+s");
  await expect.poll(async () => JSON.parse((await readOpfsText(page, "project.smap")) ?? "{}").levels?.length ?? 0).toBe(2);
  expect(await readOpfsText(page, "project.smap")).toContain("props-16");
  expect(errors).toEqual([]);
});

const ok = <N extends ToolName>(result: AgentToolResult<N>): ToolSuccess<N> => {
  expect(result.structuredContent, JSON.stringify(result.structuredContent)).toMatchObject({ ok: true });
  if (!result.structuredContent.ok) throw Error(result.structuredContent.message);
  return result.structuredContent;
};

test("MCP import_tiled: absolute TMJ path becomes a draft map; Vazgeç removes it, Onayla keeps it", async ({ page }) => {
  const pair = randomUUID();
  await page.goto(`/?agent=${pair}`);
  await startWithTileset(page, "tilesets/dungeon-16.png");
  const client = await connect(pair, process.env.HARITA_MCP_TOKEN ?? "e2e-token-harita-protocol");
  const bar = page.locator("[data-ai-bar]");
  const path = fileURLToPath(new URL("../fixtures/tiled/village.tmj", import.meta.url));
  try {
    for (const decision of ["Vazgeç", "Onayla"] as const) {
      const session = ok(await client.getSession());
      const worldSessionId = session.worldSessionId!;
      const begun = ok(await client.callTool("begin_edit", { context: { worldSessionId }, idempotencyKey: randomUUID(), expectedRevision: session.revision, requestLabel: "Tiled", mapIds: [session.data.activeMapId!] }));
      const context = { worldSessionId, transactionId: begun.data.transactionId, expectedRevision: begun.revision, idempotencyKey: randomUUID() };
      const imported = ok(await client.callTool("import_tiled", { context, path })) as unknown as { created: { mapId: string; layers: { name: string }[] }; tilesets: { name: string; reused: boolean }[]; unsupported: { kind: string }[] };
      expect(imported.created.layers.map(l => l.name)).toEqual(["Ground", "Decor", "Upper/Roof"]);
      expect(imported.tilesets).toEqual([expect.objectContaining({ reused: true }), expect.objectContaining({ name: "Props & Things", reused: false })]);
      expect(imported.unsupported.map(u => u.kind)).toEqual(["groupLayer", "objectLayer", "animation", "unknownTile"]);
      await expect(bar).toBeVisible();
      await bar.getByRole("button", { name: decision, exact: true }).click();
      await expect(bar).toBeHidden();
      const maps = ok(await client.getSession()).data.maps.map(m => m.name);
      expect(maps).toEqual(decision === "Onayla" ? ["Ana harita", "village"] : ["Ana harita"]);
    }
    const missing = ok(await client.getSession());
    const begun = ok(await client.callTool("begin_edit", { context: { worldSessionId: missing.worldSessionId! }, idempotencyKey: randomUUID(), expectedRevision: missing.revision, requestLabel: "Tiled", mapIds: [missing.data.activeMapId!] }));
    const bad = await client.callTool("import_tiled", { context: { worldSessionId: missing.worldSessionId!, transactionId: begun.data.transactionId, expectedRevision: begun.revision, idempotencyKey: randomUUID() }, path: path.replace("village.tmj", "nope.tmj") });
    expect(bad.structuredContent).toMatchObject({ ok: false, code: "INVALID_ARGUMENT", details: { cause: "notFound" } });
  } finally { await client.close(); }
});
