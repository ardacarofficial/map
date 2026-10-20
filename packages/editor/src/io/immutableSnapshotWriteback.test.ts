import { expect, it } from "vitest";
import { createDocument, MapStore, rasterContentHash } from "@smap/core";
import { collectPngVariants } from "../commands/pixelWriteback";
import { capturedPixelHash } from "../state/pixelProvenance";
import { assertPngPaths, guardedPngReplace } from "./pngWriteback";
import { MemoryFileSystem } from "./memoryFs";

it("refuses PNG apply/restore targets that are retained backup raster revisions", async () => {
  const path = `tilesets/snapshots/${"a".repeat(64)}.png`, backupPath = "backups/png/test.png";
  const source = { id: "snapshot", name: "Source", imagePath: path, tileWidth: 1, tileHeight: 1, columns: 1, rows: 1, margin: 0, spacing: 0 };
  const pixels = Uint8Array.of(255, 0, 0, 255);
  const store = new MapStore(createDocument({ width: 1, height: 1, tileWidth: 1, tileHeight: 1, tilesets: [source] }));
  store.dispatch({ type: "allocateEditedTile", tileWidth: 1, tileHeight: 1, pixels, source: { tilesetId: source.id, tileId: 0, pixelHash: capturedPixelHash(rasterContentHash(1, 1, pixels), source) } });
  expect(collectPngVariants(store)[0]!.reason).toBe("snapshot");
  expect(() => assertPngPaths(path, backupPath)).toThrow();
  const fs = new MemoryFileSystem(); await fs.writeBytes(path, pixels);
  await expect(guardedPngReplace(fs, { path, backupPath, expected: pixels, replacement: Uint8Array.of(0, 255, 0, 255) })).rejects.toThrow();
  expect(await fs.readBytes(path)).toEqual(pixels);
});
