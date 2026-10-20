/* global document, File, DataTransfer, DragEvent */
/** Manual SDK/stdio visual smoke. Start the assigned HARITA_DEV_MCP server first. */
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.AI_SMOKE_OUTPUT ?? '/tmp/harita-agent-smoke';
await mkdir(output, { recursive: true });
const artPath = resolve(root, 'samples/tilesets/overworld-32.png');
const art = await readFile(artPath), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pair = `smoke-${randomUUID()}`;
const transport = new StdioClientTransport({ cwd: root, command: process.execPath, args: ['packages/agent-cli/dist/main.js', '--url', `http://127.0.0.1:${process.env.AI_SMOKE_MCP_PORT ?? 48791}/mcp?pair=${pair}`], env: { ...process.env, HARITA_MCP_TOKEN: process.env.HARITA_MCP_TOKEN ?? 'int-smoke-local-token' }, stderr: 'pipe' });
const client = new Client({ name: 'Harita integration smoke', version: '1' });
let revision, worldSessionId, transactionId;
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const envelope = result.structuredContent;
  if (!envelope?.ok) throw Error(`${name}: ${JSON.stringify(envelope)}`);
  revision = envelope.revision;
  console.log(`${name}: ok`);
  return { ...envelope, content: result.content };
}
const context = () => ({ worldSessionId, transactionId, expectedRevision: revision, idempotencyKey: randomUUID() });
const edit = (name, args = {}) => call(name, { context: context(), ...args });
async function image(name, result) {
  const block = result.content.find(block => block.type === 'image');
  if (!block) throw Error(`${name}: missing PNG`);
  await writeFile(resolve(output, `int-${name}.png`), Buffer.from(block.data, 'base64'));
}
async function drop(name, bytes) {
  await page.evaluate(({ name, bytes }) => {
    const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    for (const type of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { name, bytes: [...bytes] });
  const card = page.getByTestId('tileset-card');
  await expect(card).toBeVisible(); await card.getByLabel("Tile genişliği", { exact: true }).fill("32"); await card.locator('button[type=submit]').click();
  await expect(page.locator('[data-testid="tileset-card"]:not([data-closed])')).toHaveCount(0);
  await expect(page.locator('[data-canvas-host] canvas').first()).toBeVisible();
}
try {
  await page.goto(`http://localhost:${process.env.AI_SMOKE_PORT ?? 5851}/?agent=${pair}`);
  await drop('overworld-32.png', art);
  await drop('smart-road-32.png', await readFile(resolve(root, 'e2e/fixtures/smart-road-32.png')));
  await client.connect(transport);
  const session = await call('get_session'); worldSessionId = session.worldSessionId;
  const mapId = session.data.activeMapId, layerId = session.data.activeLayerId;
  const tilesets = await call('list_tilesets', { context: { worldSessionId } });
  const tilesetId = tilesets.data.items.find(t => t.name.includes('overworld')).id;
  const roadId = tilesets.data.items.find(t => t.name.includes('smart-road')).id;
  await image('catalog', await call('get_tile_catalog', { context: { worldSessionId }, tilesetId, image: 'sheet', sheetRegion: { x: 0, y: 0, width: 8, height: 8 }, scale: 2 }));
  await call('begin_edit', { context: { worldSessionId }, expectedRevision: revision, idempotencyKey: randomUUID(), requestLabel: 'Smoke stamp source', mapIds: [mapId] }).then(r => { transactionId = r.data.transactionId; });
  await edit('paint_cells', { mapId, layerId, cells: [27, 27, 27, 34, 15, 34, 34, 15, 34].map((tileId, i) => ({ x: 1 + i % 3, y: 1 + Math.floor(i / 3), value: { tilesetId, tileId } })) });
  await edit('finish_edit');
  await page.locator('[data-ai-bar]').getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect(page.locator('[data-ai-bar]')).toBeHidden();
  // User fixture preparation through existing selection/stamp commands, never direct map writes.
  await page.evaluate(async () => {
    const { useEditorStore } = await import('/src/state/editorStore.ts');
    const { saveSelectionAsStamp } = await import('/src/commands/stampActions.ts');
    useEditorStore.getState().setTool('select');
    useEditorStore.getState().setRegion({ x: 1, y: 1, width: 3, height: 3 });
    if (!saveSelectionAsStamp('Smoke house')) throw Error('Could not save stamp');
    useEditorStore.getState().setRegion(null);
  });
  const stamps = await call('list_stamps', { context: { worldSessionId } });
  const stampId = stamps.data.items.find(s => s.name === 'Smoke house').id;
  const original = await call('read_region', { context: { worldSessionId }, mapId, layerIds: [layerId], region: { x: 0, y: 0, width: 24, height: 16 } });
  await call('begin_edit', { context: { worldSessionId }, expectedRevision: revision, idempotencyKey: randomUUID(), requestLabel: 'Paint, stamps and connected road', mapIds: [mapId] }).then(r => { transactionId = r.data.transactionId; });
  await edit('paint_rect', { mapId, layerId, region: { x: 0, y: 0, width: 24, height: 16 }, value: { tilesetId, tileId: 0 } });
  await edit('place_stamp', { mapId, stampId, at: { x: 4, y: 4 } });
  await edit('place_stamp', { mapId, stampId, at: { x: 13, y: 4 }, flipX: true });
  await edit('paint_cells', { mapId, layerId, cells: [0, 1, 2, 3, 4, 5, 6, 7].map((flags, i) => ({ x: 2 + i * 2, y: 13, value: { tilesetId, tileId: 22, flags } })) });
  const source = await edit('prepare_smart_source', { mapId, source: { tilesetId: roadId, region: { x: 2, y: 1, width: 3, height: 3 } } });
  await edit('draw_path', { mapId, layerId, sourceId: source.data.sourceId, kind: 'path', points: [{ x: 5, y: 8 }, { x: 5, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 8 }] });
  await image('preview', await call('render_preview', { context: { worldSessionId }, mapId, region: { x: 0, y: 0, width: 24, height: 16 }, maxSide: 1536, grid: true, coordinates: true }));
  await image('closeup', await call('render_preview', { context: { worldSessionId }, mapId, region: { x: 1, y: 10, width: 18, height: 5 }, grid: true, coordinates: true }));
  const validity = await call('validate_map', { context: { worldSessionId }, mapId });
  if (validity.data.issues.some(issue => issue.severity === 'error')) throw Error(JSON.stringify(validity.data));
  await edit('finish_edit', { summary: 'Real SDK stdio paint/stamp/path preview smoke' });
  await page.screenshot({ path: resolve(output, 'int-pending.png') });
  await page.locator('[data-ai-bar]').getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect(page.locator('[data-ai-bar]')).toBeHidden();
  await page.locator('[data-canvas-host]').focus(); await page.keyboard.press('Control+z');
  const undone = await call('read_region', { context: { worldSessionId }, mapId, layerIds: [layerId], region: { x: 0, y: 0, width: 24, height: 16 } });
  expect(undone.data.layers).toEqual(original.data.layers);
  expect(hash(await readFile(artPath))).toBe(hash(art));
  console.log(`Smoke passed; images at ${output}`);
} finally { await client.close(); await browser.close(); }
