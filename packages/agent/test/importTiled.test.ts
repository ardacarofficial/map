import { describe, expect, it } from "vitest";
import { FLIP_D, FLIP_H, cellFlags, cellPaletteIndex, type Tileset } from "@smap/core";
import type { AgentTiledPort, PreparedTiledImport } from "../src/contracts";
import { error, harness, success } from "./helpers";

const PROPS: Tileset = { id: "props", name: "Props", imagePath: "tilesets/props.png", tileWidth: 32, tileHeight: 32, columns: 4, rows: 2, margin: 0, spacing: 0 };

/** A fake host port: one 3×2 map, ground from the existing "tiles" tileset, decor from a new "props" tileset. */
function port(overrides: Partial<PreparedTiledImport> = {}) {
  const log: string[] = [];
  const tiled: AgentTiledPort = {
    async prepare({ path, transactionId }) {
      log.push(`prepare ${path}`);
      return {
        importId: "import-1", transactionId, name: "village", width: 3, height: 2, tileWidth: 32, tileHeight: 32,
        tilesets: [PROPS],
        summary: [{ tilesetId: "tiles", name: "Tiles", reused: true }, { tilesetId: "props", name: "Props", reused: false }],
        layers: [
          { name: "Ground", visible: true, locked: false, opacity: 1, cells: [0, 1, 2, 3, 4, 5].map(i => ({ x: i % 3, y: Math.floor(i / 3), tilesetId: "tiles", tileId: i, flags: 0 })) },
          { name: "Decor", visible: false, locked: true, opacity: 0.5, cells: [{ x: 1, y: 0, tilesetId: "props", tileId: 3, flags: (FLIP_H | FLIP_D) >>> 0 }] },
        ],
        unsupported: [{ kind: "objectLayer", name: "Spawns" }],
        retainedBytes: 1024,
        ...overrides,
      };
    },
    publish: () => { log.push("publish"); },
    discard: () => { log.push("discard"); },
    releaseTransaction: (_id, outcome) => { log.push(`release ${outcome}`); },
  };
  return { tiled, log };
}

describe("import_tiled", () => {
  it("creates a provisional map with layers, flips, new tilesets and the unsupported list", async () => {
    const h = harness(), { tiled, log } = port();
    h.host.tiled = tiled;
    await h.begin();
    const out = success(await h.edit("import_tiled", { path: "/packs/village.tmx" })) as unknown as Record<string, unknown>;
    expect(out).toMatchObject({ changed: 7, created: { mapId: "map-2" }, tilesets: [{ tilesetId: "tiles", reused: true }, { tilesetId: "props", reused: false }], unsupported: [{ kind: "objectLayer", name: "Spawns" }] });
    expect((out.created as { layers: { name: string }[] }).layers.map(l => l.name)).toEqual(["Ground", "Decor"]);
    const store = h.host.stores.get("map-2")!, doc = store.document;
    expect([doc.map.width, doc.map.height, doc.map.tileWidth]).toEqual([3, 2, 32]);
    expect(doc.getTileset("props")).toBeTruthy();
    // Loaded followers carry the new world tileset too (rolled back with the draft).
    expect(h.host.stores.get("map-1")!.document.getTileset("props")).toBeTruthy();
    const [ground, decor] = doc.layers;
    expect([decor!.visible, decor!.locked, decor!.opacity]).toEqual([false, true, 0.5]);
    const cell = (decor as unknown as { getCell(x: number, y: number): number }).getCell(1, 0);
    expect(doc.palette.get(cellPaletteIndex(cell))).toEqual({ tilesetId: "props", tileId: 3 });
    expect(cellFlags(cell)).toBe((FLIP_H | FLIP_D) >>> 0);
    expect(doc.palette.get(cellPaletteIndex((ground as unknown as { getCell(x: number, y: number): number }).getCell(2, 1)))).toEqual({ tilesetId: "tiles", tileId: 5 });
    expect(log).toEqual(["prepare /packs/village.tmx", "publish"]);
  });

  it("Vazgeç removes the map, the tileset and releases the images", async () => {
    const h = harness(), { tiled, log } = port();
    h.host.tiled = tiled;
    const before = h.host.snapshot();
    await h.begin();
    success(await h.edit("import_tiled", { path: "/packs/village.tmj", name: "Köy" }));
    success(await h.edit("cancel_edit", { reason: "no" }));
    expect(h.host.stores.has("map-2")).toBe(false);
    expect(h.host.stores.get("map-1")!.document.getTileset("props")).toBeUndefined();
    expect(h.host.snapshot()).toEqual(before);
    expect(log.at(-1)).toBe("release cancelled");
  });

  it("Onayla keeps the import as one world step", async () => {
    const h = harness(), { tiled, log } = port();
    h.host.tiled = tiled;
    await h.begin();
    success(await h.edit("import_tiled", { path: "C:\\packs\\village.tmx" }));
    success(await h.edit("finish_edit"));
    await h.api.userAction("approve");
    expect(h.host.stores.get("map-2")!.document.getTileset("props")).toBeTruthy();
    expect(h.host.history.undoDepth).toBe(1);
    expect(log.at(-1)).toBe("release approved");
  });

  it("validates the path and needs a host reader", async () => {
    const h = harness();
    await h.begin();
    error(await h.edit("import_tiled", { path: "/packs/village.tmx" }), "EDITOR_UNAVAILABLE");
    h.host.tiled = port().tiled;
    error(await h.edit("import_tiled", { path: "/packs/village.png" }), "INVALID_ARGUMENT");
    error(await h.edit("import_tiled", { path: "packs/village.tmx" }), "INVALID_ARGUMENT");
  });

  it("an oversized map is discarded before anything is staged", async () => {
    const h = harness(), { tiled, log } = port({ width: 4096, height: 4096 });
    h.host.tiled = tiled;
    await h.begin();
    error(await h.edit("import_tiled", { path: "/packs/huge.tmx" }), "LIMIT_EXCEEDED");
    expect(log).toEqual(["prepare /packs/huge.tmx", "discard"]);
    expect(h.host.stores.size).toBe(1);
  });
});
