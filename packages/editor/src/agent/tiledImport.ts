/** import_tiled host port: reads through the transport's local reader, stages new tileset images until publish. */
import { AgentError, AgentErrorCode, type AgentTiledPort, type AgentWorldPort, type PreparedTiledImport } from "@smap/agent";
import { TiledImportError } from "@smap/core";
import { getProjectFolder, sourceIdsOnDisk } from "../io/session";
import { buildTiledContent, closeTiled, loadTiled, newTiledImages, planTiledTilesets, TiledReadError, tiledTilesetSummary, type LoadedTiled, type NewTiledImage, type TiledReader } from "../io/tiledImport";
import { allTilesetImages, getTilesetImage, removeTilesetImage, setTilesetImage } from "../state/tilesetImages";
import { t } from "../i18n";

let localReader: TiledReader | null = null;
/** The transport supplies a reader for agent-given local paths (desktop command / dev server). */
export function setLocalTiledReader(reader: TiledReader | null): void { localReader = reader; }

const IMPORT_NEXT: Record<string, string> = {
  orientation: "Only orthogonal maps can be imported.",
  compression: "Re-save the map in Tiled with CSV or Base64 (zlib/gzip) layer format.",
  noTileLayers: "The map has no tile layer to import.",
  size: "The map is larger than 4096×4096 cells.",
};

function readFailure(path: string, detail: string): never {
  const cause = /not ?found|enoent|no such/i.test(detail) ? "notFound" : /large|size/i.test(detail) ? "fileTooLarge" : /type|extension/i.test(detail) ? "unsupportedType" : "readFailed";
  throw new AgentError(cause === "fileTooLarge" ? AgentErrorCode.LIMIT_EXCEEDED : AgentErrorCode.INVALID_ARGUMENT, `Could not read ${path}`, {
    cause, nextAction: cause === "notFound" ? "No file exists at this exact path; check it segment by segment." : "Check the absolute path of the .tmx/.tmj map.",
  });
}

export function createTiledPort(world: AgentWorldPort): AgentTiledPort {
  const records = new Map<string, { prepared: PreparedTiledImport; images: NewTiledImage[]; published: boolean }>();
  const release = (images: readonly NewTiledImage[], published: boolean) => {
    for (const image of images) {
      if (published) { if (getTilesetImage(image.tileset.id)?.bitmap === image.bitmap) removeTilesetImage(image.tileset.id); }
      else image.bitmap.close();
    }
  };
  return {
    async prepare({ path, transactionId }, call) {
      if (!localReader) throw new AgentError(AgentErrorCode.EDITOR_UNAVAILABLE, "This editor cannot read local files", { nextAction: "Ask the user to use Dosya → İçe aktar → Tiled haritası…" });
      let loaded: LoadedTiled;
      try { loaded = await loadTiled(path, localReader, call.signal); }
      catch (error) {
        call.signal.throwIfAborted();
        if (error instanceof TiledReadError) readFailure(path, error.detail);
        if (error instanceof TiledImportError) throw new AgentError(AgentErrorCode.INVALID_ARGUMENT, error.message, { cause: error.code, ...(IMPORT_NEXT[error.code] ? { nextAction: IMPORT_NEXT[error.code]! } : {}) });
        throw error;
      }
      let images: NewTiledImage[] = [];
      try {
        const reserved = await sourceIdsOnDisk(getProjectFolder()?.fs ?? null);
        call.signal.throwIfAborted();
        const tilesets = world.tilesets();
        const taken = new Set<string>([...tilesets.map(ts => ts.id), ...reserved]);
        for (const image of allTilesetImages()) taken.add(image.tilesetId);
        for (const r of records.values()) for (const ts of r.prepared.tilesets) taken.add(ts.id);
        const plans = planTiledTilesets(loaded, tilesets, id => getTilesetImage(id)?.bytes, taken, t("tiledImport.group", { name: loaded.map.name }));
        const content = buildTiledContent(loaded, plans);
        images = await newTiledImages(plans);
        closeTiled(loaded, new Set(images.map(i => i.bitmap)));
        const prepared: PreparedTiledImport = {
          importId: crypto.randomUUID(), transactionId, name: loaded.map.name,
          width: loaded.map.width, height: loaded.map.height, tileWidth: loaded.map.tileWidth, tileHeight: loaded.map.tileHeight,
          tilesets: images.map(i => i.tileset), summary: tiledTilesetSummary(plans),
          layers: content.layers.map(l => ({ ...l, cells: [...l.cells] })), unsupported: content.unsupported,
          retainedBytes: images.reduce((n, i) => n + i.bitmap.width * i.bitmap.height * 4 + i.bytes.byteLength, 0),
        };
        call.signal.throwIfAborted();
        records.set(prepared.importId, { prepared, images, published: false });
        return prepared;
      } catch (error) {
        closeTiled(loaded, new Set());
        for (const image of images) if (!loaded.tilesets.some(ts => ts.sheet?.bitmap === image.bitmap)) image.bitmap.close();
        throw error;
      }
    },
    publish(prepared) {
      const record = records.get(prepared.importId);
      if (!record) throw new AgentError(AgentErrorCode.INTERNAL_ERROR, "Unknown Tiled import");
      // Register images first so the canvas finds them when the tilesets appear.
      for (const image of record.images) setTilesetImage({ tilesetId: image.tileset.id, bitmap: image.bitmap, bytes: image.bytes });
      record.published = true;
    },
    discard(prepared) {
      const record = records.get(prepared.importId);
      if (!record || record.published) return;
      records.delete(prepared.importId);
      release(record.images, false);
    },
    releaseTransaction(transactionId, outcome) {
      for (const [id, record] of records) if (record.prepared.transactionId === transactionId) {
        records.delete(id);
        // Approved images stay registered for undo/redo and save.
        if (outcome === "cancelled" || !record.published) release(record.images, record.published);
      }
    },
  };
}
