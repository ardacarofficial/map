import { afterEach, describe, expect, it, vi } from "vitest";
import { encode } from "fast-png";
import { AgentError, AgentErrorCode, type AgentCallContext, type AgentWorldPort } from "@smap/agent";
import { encodeRgbaPng } from "@smap/core";
import { clearTilesetImages, setTilesetImage } from "../state/tilesetImages";
import { createVisualReferencePort } from "./visualReferences";

const tileset = { id: "art", name: "Art", imagePath: "tilesets/art.png", tileWidth: 2, tileHeight: 2, columns: 1, rows: 1, margin: 0, spacing: 0 };
const world = { tilesets: () => [tileset] } as unknown as AgentWorldPort;
const context = { worldSessionId: "world" };
const rgba = Uint8Array.of(10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 128, 100, 110, 120, 255);
function call(client = "client"): AgentCallContext {
  return { clientSessionId: client, clientInfo: { name: "Test", version: "1" }, bridgeEpoch: "epoch", deadline: Date.now() + 10000, signal: { aborted: false, throwIfAborted() {}, onAbort: () => () => {} } };
}
const base64 = (png = encodeRgbaPng(2, 2, rgba)) => {
  let binary = "";
  for (let i = 0; i < png.length; i += 8192) binary += String.fromCharCode(...png.subarray(i, i + 8192));
  return btoa(binary);
};
function declareSize(png: Uint8Array, width: number, height: number): Uint8Array {
  const copy = png.slice(), view = new DataView(copy.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  let crc = 0xffffffff;
  for (const b of copy.subarray(12, 29)) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  view.setUint32(29, (crc ^ 0xffffffff) >>> 0);
  return copy;
}
function install() { setTilesetImage({ tilesetId: "art", bytes: encodeRgbaPng(2, 2, rgba), bitmap: { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap }); }
afterEach(clearTilesetImages);

describe("explicit session reference images", () => {
  it("ingests explicit base64, matches immutable source bytes, and returns compact exact evidence", async () => {
    install(); const port = createVisualReferencePort(world, () => 1);
    const reference = await port.ingestReference({ context, pngBase64: base64() }, call());
    expect(reference).toMatchObject({ width: 2, height: 2 });
    const result = await port.matchReference({ context, referenceId: reference.referenceId }, call());
    expect(result).toMatchObject({ status: "matched", revision: 1, truncated: false });
    expect(result.candidates[0]).toMatchObject({ tilesetId: "art", tileId: 0, match: "exact_rgba" });
    expect(JSON.stringify(result)).not.toContain("confidence");
  });

  it("scopes references to both client and world and releases handles on session end", async () => {
    const port = createVisualReferencePort(world, () => 1), reference = await port.ingestReference({ context, pngBase64: base64() }, call());
    for (const [ctx, client] of [[context, "other"], [{ worldSessionId: "other" }, "client"]] as const) await expect(port.matchReference({ context: ctx, referenceId: reference.referenceId }, call(client))).rejects.toMatchObject({ code: AgentErrorCode.UNKNOWN_ID });
    port.sessionEnded("client");
    await expect(port.matchReference({ context, referenceId: reference.referenceId }, call())).rejects.toMatchObject({ code: AgentErrorCode.UNKNOWN_ID });
  });

  it("rejects paths/data URLs, malformed base64/PNG, oversize requests and declared dimensions", async () => {
    const port = createVisualReferencePort(world, () => 1);
    for (const pngBase64 of ["/tmp/image.png", "data:image/png;base64," + base64(), "!!!!", "YQ=="]) await expect(port.ingestReference({ context, pngBase64 }, call())).rejects.toMatchObject({ code: AgentErrorCode.INVALID_ARGUMENT });
    await expect(port.ingestReference({ context, pngBase64: "A".repeat(1024 * 1024) }, call())).rejects.toMatchObject({ code: AgentErrorCode.LIMIT_EXCEEDED });
    const png = encodeRgbaPng(2, 2, rgba); new DataView(png.buffer).setUint32(16, 2049);
    await expect(port.ingestReference({ context, pngBase64: base64(png) }, call())).rejects.toMatchObject({ code: AgentErrorCode.LIMIT_EXCEEDED });
  });

  it("enforces reference count and releases retained state on clear", async () => {
    const port = createVisualReferencePort(world, () => 1);
    for (let i = 0; i < 32; i++) await port.ingestReference({ context, pngBase64: base64() }, call());
    await expect(port.ingestReference({ context, pngBase64: base64() }, call())).rejects.toMatchObject({ code: AgentErrorCode.LIMIT_EXCEEDED });
    port.clear(); await expect(port.ingestReference({ context, pngBase64: base64() }, call())).resolves.toMatchObject({ width: 2 });
  });

  it("caps decoded retention at 64 MiB despite tiny compressed images", async () => {
    const port = createVisualReferencePort(world, () => 1);
    const pngBase64 = base64(encode({ width: 2048, height: 2048, data: new Uint8Array(2048 * 2048 * 4).fill(255), channels: 4, depth: 8 }));
    for (let i = 0; i < 4; i++) await port.ingestReference({ context, pngBase64 }, call());
    await expect(port.ingestReference({ context, pngBase64: base64() }, call())).rejects.toMatchObject({ code: AgentErrorCode.LIMIT_EXCEEDED });
    port.clear();
    await expect(port.ingestReference({ context, pngBase64: base64() }, call())).resolves.toMatchObject({ width: 2 });
  });

  it("rejects fully transparent references instead of suggesting blank tiles", async () => {
    const port = createVisualReferencePort(world, () => 1);
    await expect(port.ingestReference({ context, pngBase64: base64(encodeRgbaPng(2, 2, new Uint8Array(16))) }, call())).rejects.toMatchObject({ code: AgentErrorCode.INVALID_ARGUMENT });
  });

  it("does not invalidate another client's pending ingestion on session end", async () => {
    const port = createVisualReferencePort(world, () => 1);
    const pending = port.ingestReference({ context, pngBase64: base64() }, call("active"));
    port.sessionEnded("unrelated");
    await expect(pending).resolves.toMatchObject({ width: 2, height: 2 });
    const ending = port.ingestReference({ context, pngBase64: base64() }, call("ending"));
    port.sessionEnded("ending");
    await expect(ending).rejects.toMatchObject({ code: AgentErrorCode.STALE_WORLD });
  });

  it("rejects an IDAT decompression bomb with a small, valid-CRC IHDR before decoding", async () => {
    const port = createVisualReferencePort(world, () => 1);
    const bomb = declareSize(encodeRgbaPng(128, 128, new Uint8Array(128 * 128 * 4)), 2, 2);
    await expect(port.ingestReference({ context, pngBase64: base64(bomb) }, call())).rejects.toMatchObject({ code: AgentErrorCode.LIMIT_EXCEEDED });
  });

  it("honors deadline/cancellation and detects changes across asynchronous source preparation", async () => {
    const expired = createVisualReferencePort(world, () => 1, () => 100);
    await expect(expired.ingestReference({ context, pngBase64: base64() }, { ...call(), deadline: 100 })).rejects.toMatchObject({ code: AgentErrorCode.TIMEOUT });
    const cancelled = call(); cancelled.signal.throwIfAborted = () => { throw new AgentError(AgentErrorCode.CANCELLED, "cancelled"); };
    await expect(expired.ingestReference({ context, pngBase64: base64() }, cancelled)).rejects.toMatchObject({ code: AgentErrorCode.CANCELLED });
    install(); let revision = 1;
    const port = createVisualReferencePort(world, () => revision), reference = await port.ingestReference({ context, pngBase64: base64() }, call());
    const matching = port.matchReference({ context, referenceId: reference.referenceId }, call());
    revision++;
    await expect(matching).rejects.toMatchObject({ code: AgentErrorCode.SOURCE_CHANGED });
  });
});
