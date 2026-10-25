import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLIP_D, FLIP_H, FLIP_V, cellFlags, cellPaletteIndex, type TileLayer } from "@smap/core";
import { MemoryFileSystem } from "../io/memoryFs";
import { closeProject, getLevelWorkspace, newProject } from "../io/session";
import { useEditorStore } from "../state/editorStore";
import { getTilesetImage } from "../state/tilesetImages";
import { browserPlatform, setPlatform } from "../platform";
import { importTiledMap, useTiledImportReport } from "./tiledImportActions";

const fixtures = new URL("../../../../e2e/fixtures/tiled/", import.meta.url);
/** Reads fixture files by the absolute-looking paths the importer resolves. */
const reader = (calls: string[]) => async (path: string) => {
  calls.push(path);
  return new Uint8Array(readFileSync(new URL(path.replace(/^\/pack\//, ""), fixtures)));
};
/** PNG width/height from IHDR (no image decoding in node). */
function fakeBitmap(bytes: Uint8Array): ImageBitmap {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20), close() {} } as ImageBitmap;
}

beforeEach(async () => {
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => fakeBitmap(new Uint8Array(await blob.arrayBuffer())));
  setPlatform({ ...browserPlatform, watchProject() {} });
  await newProject({ name: "Köy", width: 8, height: 8, tileSize: 16, folder: { fs: new MemoryFileSystem(), label: "Köy", ref: "koy" } });
});
afterEach(() => { closeProject(); setPlatform(browserPlatform); vi.unstubAllGlobals(); useTiledImportReport.setState({ report: null }); });

const cellAt = (layer: TileLayer, x: number, y: number) => (layer as unknown as { getCell(x: number, y: number): number }).getCell(x, y);

describe("Dosya → İçe aktar → Tiled haritası…", () => {
  for (const file of ["village.tmx", "village.tmj"]) it(`${file} becomes a new map with tilesets, flips and the unsupported list`, async () => {
    const calls: string[] = [];
    const before = useEditorStore.getState().project!.store;
    expect(await importTiledMap(`/pack/${file}`, reader(calls))).toBe(true);
    const ext = file.endsWith("tmx") ? "tsx" : "tsj";
    expect(calls).toEqual([`/pack/${file}`, `/pack/tilesets/dungeon.${ext}`, "/pack/tilesets/dungeon-16.png", "/pack/props-16.png"]);
    const ws = getLevelWorkspace()!;
    expect(ws.levels.map(l => l.name)).toEqual(["Ana harita", "village"]);
    const store = useEditorStore.getState().project!.store, doc = store.document;
    expect(store).not.toBe(before);
    expect([doc.map.width, doc.map.height, doc.map.tileWidth]).toEqual([8, 6, 16]);
    expect(doc.layers.map(l => [l.name, l.visible, l.opacity])).toEqual([["Ground", true, 1], ["Decor", true, 0.5], ["Upper/Roof", false, 1]]);
    const dungeon = doc.tilesets.find(t => t.name === "Dungeon")!, props = doc.tilesets.find(t => t.name === "Props & Things")!;
    expect([dungeon.columns, dungeon.rows, props.columns, props.rows, props.group]).toEqual([6, 4, 4, 2, "Tiled · village"]);
    expect(getTilesetImage(props.id)?.bytes).toEqual(new Uint8Array(readFileSync(new URL("props-16.png", fixtures))));
    const ref = (layer: number, x: number, y: number) => { const c = cellAt(doc.layers[layer]!, x, y); return [doc.palette.get(cellPaletteIndex(c)), cellFlags(c) >>> 0]; };
    expect(ref(0, 0, 0)).toEqual([{ tilesetId: dungeon.id, tileId: 0 }, 0]);
    expect(ref(1, 2, 1)).toEqual([{ tilesetId: props.id, tileId: 1 }, FLIP_H >>> 0]);
    expect(ref(1, 4, 1)).toEqual([{ tilesetId: props.id, tileId: 3 }, FLIP_D]);
    expect(ref(1, 5, 1)).toEqual([{ tilesetId: props.id, tileId: 4 }, (FLIP_H | FLIP_V | FLIP_D) >>> 0]);
    expect(ref(2, 7, 5)).toEqual([{ tilesetId: props.id, tileId: 7 }, FLIP_V]);
    // A new map: no undo step of its own.
    expect(store.canUndo).toBe(false);
    expect(useTiledImportReport.getState().report?.unsupported.map(u => u.kind)).toEqual(["groupLayer", "objectLayer", "animation", "unknownTile"]);
  });

  it("a second import of the same pack reuses its tilesets; missing files are listed", async () => {
    await importTiledMap("/pack/village.tmx", reader([]));
    const count = useEditorStore.getState().project!.store.document.tilesets.length;
    const missingProps = async (path: string) => { if (path.endsWith("props-16.png")) throw new Error("not found"); return reader([])(path); };
    expect(await importTiledMap("/pack/village.tmj", missingProps)).toBe(true);
    const doc = useEditorStore.getState().project!.store.document;
    expect(doc.tilesets.length).toBe(count);
    expect(useTiledImportReport.getState().report?.unsupported).toContainEqual({ kind: "missingImage", name: "Props & Things", count: 8 });
  });

  it("an unreadable or isometric map adds nothing", async () => {
    const levels = getLevelWorkspace()!.levels.length;
    expect(await importTiledMap("/pack/missing.tmx", reader([]))).toBe(false);
    const iso = async () => new TextEncoder().encode(`<map orientation="isometric" width="1" height="1" tilewidth="16" tileheight="8"/>`);
    expect(await importTiledMap("/pack/iso.tmx", iso)).toBe(false);
    expect(getLevelWorkspace()!.levels.length).toBe(levels);
  });
});

describe("import_tiled host port", () => {
  it("stages images until publish and removes them when the draft is discarded", async () => {
    const { createTiledPort, setLocalTiledReader } = await import("../agent/tiledImport");
    const world = { tilesets: () => useEditorStore.getState().project!.store.document.tilesets } as unknown as Parameters<typeof createTiledPort>[0];
    const port = createTiledPort(world);
    const call = { signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } } as unknown as Parameters<typeof port.prepare>[1];
    await expect(port.prepare({ path: "/pack/village.tmx", transactionId: "t" }, call)).rejects.toMatchObject({ code: "EDITOR_UNAVAILABLE" });
    setLocalTiledReader(reader([]));
    try {
      await expect(port.prepare({ path: "/pack/nothing.tmx", transactionId: "t" }, call)).rejects.toMatchObject({ code: "INVALID_ARGUMENT", details: { cause: "notFound" } });
      const prepared = await port.prepare({ path: "/pack/village.tmx", transactionId: "t" }, call);
      expect([prepared.name, prepared.width, prepared.height, prepared.tilesets.length, prepared.layers.length]).toEqual(["village", 8, 6, 2, 3]);
      expect(prepared.unsupported.map(u => u.kind)).toEqual(["groupLayer", "objectLayer", "animation", "unknownTile"]);
      const ids = prepared.tilesets.map(t => t.id);
      expect(ids.every(id => !getTilesetImage(id))).toBe(true);
      port.publish(prepared);
      expect(ids.every(id => getTilesetImage(id))).toBe(true);
      port.releaseTransaction("t", "cancelled");
      expect(ids.every(id => !getTilesetImage(id))).toBe(true);
    } finally { setLocalTiledReader(null); }
  });
});
