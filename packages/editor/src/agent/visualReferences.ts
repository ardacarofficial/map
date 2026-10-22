import {
  AGENT_LIMITS, AgentError, AgentErrorCode, ExactReferenceSearch, VISUAL_LIMITS,
  type AgentCallContext, type AgentVisualReferencePort, type AgentWorldPort,
} from "@smap/agent";
import { canonicalRgba, type RgbaImage } from "@smap/core";
import { decodeWorkingSourcePng } from "../io/sourcePng";
import { sourceChunks } from "../io/sourcePngFormat";
import { imagePixels } from "./images";

interface StoredReference { pixels: RgbaImage; client: string; world: string }
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

/** fast-png has no inflation cap. Validate its compressed input with bounded,
 * backpressured native decompression before allowing it to allocate scanlines. */
async function validateInflation(png: Uint8Array, width: number, height: number, check: () => void): Promise<void> {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[png[25]!];
  const depth = png[24]!, interlace = png[28]!;
  if (!channels || ![1, 2, 4, 8].includes(depth) || (depth < 8 && png[25] !== 0 && png[25] !== 3) || png[26] || png[27] || interlace > 1) throw Error("Unsupported PNG representation");
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x!) / dx!)), h = Math.max(0, Math.ceil((height - y!) / dy!));
    if (w && h) expected += h * (1 + Math.ceil(w * channels * depth / 8));
  }
  const chunks = sourceChunks(png);
  if (chunks[0]?.type !== "IHDR" || chunks[0].data.length !== 13 || chunks.filter(c => c.type === "IHDR").length !== 1 || chunks.at(-1)?.type !== "IEND") throw Error("Invalid PNG structure");
  const parts = chunks.filter(c => c.type === "IDAT").map(c => new Uint8Array(c.data));
  const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  let inflated = 0;
  try {
    for (;;) {
      check();
      const next = await reader.read();
      if (next.done) break;
      inflated += next.value.byteLength;
      if (inflated > expected) throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, "PNG decompression exceeds its declared scanline budget");
    }
    if (inflated !== expected) throw Error("Incorrect PNG scanline length");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Explicit MCP payloads only. The handles never resolve chat uploads or local paths. */
export function createVisualReferencePort(world: AgentWorldPort, revision: () => number, now: () => number = Date.now): AgentVisualReferencePort {
  const references = new Map<string, StoredReference>();
  const clientGenerations = new Map<string, object>();
  let retainedBytes = 0;
  let pendingBytes = 0, pendingCount = 0;
  let generation = 0;
  const check = (call: AgentCallContext) => {
    call.signal.throwIfAborted();
    if (now() >= call.deadline) throw new AgentError(AgentErrorCode.TIMEOUT, "Reference image deadline expired");
  };
  const invalid = (message: string): never => { throw new AgentError(AgentErrorCode.INVALID_ARGUMENT, message); };
  const limit = (message: string): never => { throw new AgentError(AgentErrorCode.LIMIT_EXCEEDED, message); };
  const clear = () => { references.clear(); clientGenerations.clear(); retainedBytes = 0; generation++; };
  return {
    async ingestReference(args, call) {
      check(call);
      const value = args.pngBase64;
      if (value.length > AGENT_LIMITS.requestBytes - 4096) limit("Base64 PNG exceeds the 1 MiB request budget");
      if (!value.length || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) invalid("Provide a PNG as canonical base64 without a data URL prefix");
      if (references.size + pendingCount >= VISUAL_LIMITS.references) limit("Reference handle capacity reached; start a new session");
      const binary = atob(value);
      if (btoa(binary) !== value) invalid("PNG base64 has noncanonical padding");
      const png = Uint8Array.from(binary, c => c.charCodeAt(0));
      if (png.length < 33 || signature.some((v, i) => png[i] !== v) || String.fromCharCode(...png.subarray(12, 16)) !== "IHDR") invalid("Invalid PNG header");
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const width = view.getUint32(16), height = view.getUint32(20), bytes = width * height * 4;
      if (!width || !height || width > AGENT_LIMITS.imageSide || height > AGENT_LIMITS.imageSide || width * height > AGENT_LIMITS.imagePixels) limit("Reference PNG dimensions exceed the decoded image budget");
      if (retainedBytes + pendingBytes + bytes > AGENT_LIMITS.retainedBytes) limit("Reference images exceed the 64 MiB retained budget");
      pendingBytes += bytes; pendingCount++;
      try {
        let pixels: RgbaImage;
        const capturedGeneration = generation;
        const clientGeneration = clientGenerations.get(call.clientSessionId) ?? {};
        clientGenerations.set(call.clientSessionId, clientGeneration);
        try {
          await validateInflation(png, width, height, () => check(call));
          const decoded = decodeWorkingSourcePng(png);
          let visible = false;
          for (let i = 3; i < decoded.data.length; i += 4) if (decoded.data[i]) { visible = true; break; }
          if (!visible) invalid("Reference PNG must contain at least one visible pixel");
          pixels = { width, height, data: canonicalRgba(width, height, new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength)) };
        } catch (error) {
          check(call);
          if (error instanceof AgentError) throw error;
          return invalid("PNG must be a valid, supported static source image of at most 8-bit depth");
        }
        check(call);
        if (generation !== capturedGeneration || clientGenerations.get(call.clientSessionId) !== clientGeneration) throw new AgentError(AgentErrorCode.STALE_WORLD, "Reference session ended during ingestion");
        const referenceId = crypto.randomUUID();
        references.set(referenceId, { pixels, client: call.clientSessionId, world: args.context.worldSessionId });
        retainedBytes += bytes;
        return { referenceId, width, height };
      } finally {
        pendingBytes -= bytes; pendingCount--;
      }
    },
    async matchReference(args, call) {
      check(call);
      const reference = references.get(args.referenceId);
      if (!reference || reference.client !== call.clientSessionId || reference.world !== args.context.worldSessionId) throw new AgentError(AgentErrorCode.UNKNOWN_ID, "Unknown reference in this client/world session");
      const topK = args.topK ?? 8, maxScale = args.maxScale ?? 4;
      if (!Number.isInteger(topK) || topK < 1 || topK > VISUAL_LIMITS.topK || !Number.isInteger(maxScale) || maxScale < 1 || maxScale > VISUAL_LIMITS.maxScale) invalid("Invalid reference result or integer scale limit");
      if (args.tilesetIds && (!args.tilesetIds.length || args.tilesetIds.length > VISUAL_LIMITS.tilesets || new Set(args.tilesetIds).size !== args.tilesetIds.length)) invalid("Select 1–32 distinct tileset IDs");
      const all = world.tilesets();
      const selected = args.tilesetIds ? args.tilesetIds.map(id => {
        const t = all.find(t => t.id === id);
        if (!t) throw new AgentError(AgentErrorCode.UNKNOWN_ID, "Unknown tileset", { tilesetId: id });
        return t;
      }) : all;
      if (selected.length > VISUAL_LIMITS.tilesets) limit("Select at most 32 tilesets for reference matching");
      const capturedRevision = revision();
      const checkpoint = async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        check(call);
        if (references.get(args.referenceId) !== reference) throw new AgentError(AgentErrorCode.UNKNOWN_ID, "Reference session ended during matching");
        if (revision() !== capturedRevision) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Source artwork changed during reference matching");
      };
      const search = new ExactReferenceSearch(reference.pixels, { topK, maxScale, revision: capturedRevision, checkpoint });
      // Source snapshots are consumed sequentially; aggregate reference/source memory is bounded.
      for (const tileset of selected) {
        await checkpoint();
        const pixels = await imagePixels(tileset.id, call.signal);
        if (retainedBytes + pendingBytes + pixels.data.byteLength > AGENT_LIMITS.retainedBytes) limit("Reference and current atlas exceed the 64 MiB working budget");
        check(call);
        if (revision() !== capturedRevision) throw new AgentError(AgentErrorCode.SOURCE_CHANGED, "Source artwork changed during reference matching");
        await search.addSource({ tileset, pixels });
        if (search.complete) break;
      }
      await checkpoint();
      return search.result();
    },
    sessionEnded(clientSessionId) {
      clientGenerations.delete(clientSessionId);
      for (const [id, reference] of references) if (reference.client === clientSessionId) {
        retainedBytes -= reference.pixels.data.byteLength;
        references.delete(id);
      }
    },
    clear,
  };
}
