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

it("releases a retired bitmap exactly once after its last job releases it",async()=>{
 const {retainTilesetImage}=await import("./tilesetImages");
 const close=vi.fn(),first={tilesetId:"source",bytes:Uint8Array.of(1),bitmap:{close} as unknown as ImageBitmap};setTilesetImage(first);
 const releaseA=retainTilesetImage(first),releaseB=retainTilesetImage(first);
 setTilesetImage({tilesetId:"source",bytes:Uint8Array.of(2),bitmap:{close:vi.fn()} as unknown as ImageBitmap});
 expect(close).not.toHaveBeenCalled();releaseA();expect(close).not.toHaveBeenCalled();releaseB();releaseB();expect(close).toHaveBeenCalledTimes(1);clearTilesetImages();expect(close).toHaveBeenCalledTimes(1);
});
it("versions decoded premultiplied pixels independently of PNG encoding and invisible RGB",async()=>{
 const {imageContentVersion}=await import("./tilesetImages");
 const read=vi.fn(),draw=vi.fn();
 vi.stubGlobal("document",{createElement:()=>({getContext:()=>({drawImage:draw,getImageData:read})})});
 try{
  const image=(bytes:number[])=>({tilesetId:"rgba",bytes:Uint8Array.from(bytes),bitmap:{width:2,height:1,close:vi.fn()} as unknown as ImageBitmap});
  read.mockReturnValueOnce({data:Uint8ClampedArray.of(10,20,30,255,255,200,100,0)});
  const a=imageContentVersion(image([1,2,3]));
  read.mockReturnValueOnce({data:Uint8ClampedArray.of(10,20,30,255,0,0,0,0)});
  expect(imageContentVersion(image([4,5,6]))).toBe(a);
  read.mockReturnValueOnce({data:Uint8ClampedArray.of(11,20,30,255,0,0,0,0)});
  expect(imageContentVersion(image([1,2,3]))).not.toBe(a);
 }finally{vi.unstubAllGlobals();}
});

it('freezes a retained mutable sheet once at the async consumer boundary', async () => {
  const { setTilesetBitmapSnapshot, retainTilesetImage } = await import('./tilesetImages');
  const live = { close: vi.fn() } as unknown as ImageBitmap, frozen = { close: vi.fn() } as unknown as ImageBitmap;
  const image = deferredTilesetImage('edited', live, async () => Uint8Array.of(1));
  const freeze = vi.fn(() => frozen); setTilesetBitmapSnapshot(image, freeze);
  const off = retainTilesetImage(image), off2 = retainTilesetImage(image);
  expect(freeze).toHaveBeenCalledTimes(1); expect(image.bitmap).toBe(frozen); off(); off2();
});
