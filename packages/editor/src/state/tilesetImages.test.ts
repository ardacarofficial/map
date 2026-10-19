import { expect, it, vi } from "vitest";
import { clearTilesetImages, deferredTilesetImage, setTilesetImage, tilesetImageBytes, tilesetPngSource } from "./tilesetImages";
import { pngHash } from "./pngHash";

it("keeps generated pixels ready without encoding and shares one PNG between concurrent consumers", async () => {
  const bytes = Uint8Array.of(1, 2, 3), encode = vi.fn(async () => bytes);
  const bitmap = { close() {} } as ImageBitmap;
  const image = deferredTilesetImage("generated", bitmap, encode);
  expect(image.bitmap).toBe(bitmap); expect(image.bytes).toBeUndefined(); expect(encode).not.toHaveBeenCalled();
  expect(await Promise.all([tilesetImageBytes(image), tilesetImageBytes(image)])).toEqual([bytes, bytes]);
  expect(await tilesetImageBytes(image)).toBe(bytes); expect(image.bytes).toBe(bytes); expect(encode).toHaveBeenCalledTimes(1);
});

it("keeps deferred pixels usable after an encoding failure and retries when saving again", async () => {
  const encode = vi.fn<() => Promise<Uint8Array>>().mockRejectedValueOnce(new Error("PNG encoding failed")).mockResolvedValueOnce(Uint8Array.of(4));
  const image = deferredTilesetImage("generated", { close() {} } as ImageBitmap, encode);
  await expect(tilesetImageBytes(image)).rejects.toThrow("PNG encoding failed"); expect(image.bytes).toBeUndefined();
  expect(await tilesetImageBytes(image)).toEqual(Uint8Array.of(4)); expect(encode).toHaveBeenCalledTimes(2);
});

it("a deferred file supplier captures the image revision across replacement", async () => {
  const oldBytes = Uint8Array.of(1), newBytes = Uint8Array.of(2);
  const oldEncode = vi.fn(async () => oldBytes), newEncode = vi.fn(async () => newBytes);
  const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
  try {
    setTilesetImage(deferredTilesetImage("bank", bitmap(), oldEncode));
    const oldSource = tilesetPngSource("bank");
    setTilesetImage(deferredTilesetImage("bank", bitmap(), newEncode));
    expect(oldEncode).not.toHaveBeenCalled(); expect(newEncode).not.toHaveBeenCalled();
    expect(typeof oldSource).toBe("function");
    if (typeof oldSource !== "function") throw new Error("expected deferred supplier");
    expect(await oldSource()).toBe(oldBytes);
    const newSource = tilesetPngSource("bank");
    if (typeof newSource !== "function") throw new Error("expected deferred supplier");
    expect(await newSource()).toBe(newBytes);
    expect(tilesetPngSource("missing")).toBeUndefined();
  } finally { clearTilesetImages(); }
});

it("hashes an immutable PNG buffer once and invalidates by revision identity", async () => {
  const digest = vi.spyOn(crypto.subtle, "digest");
  try {
    const bytes = new TextEncoder().encode("abc");
    const [a, b] = await Promise.all([pngHash(bytes), pngHash(bytes)]);
    expect(a).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); expect(b).toBe(a);
    expect(await pngHash(bytes)).toBe(a); expect(digest).toHaveBeenCalledTimes(1);
    expect(await pngHash(new Uint8Array(bytes))).toBe(a); expect(digest).toHaveBeenCalledTimes(2);
  } finally { digest.mockRestore(); }
});
