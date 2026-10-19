import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlTexture, GlRenderingContext } from 'pixi.js';
import { createPixelAtlasSource, markPixelAtlasDirty, pixelAtlasUploader } from './pixelUpload';

afterEach(() => vi.unstubAllGlobals());
describe('Pixi pixel atlas upload hook', () => {
  it('allocates/replays the retained page, then uploads the dirty subrectangle without changing GL bindings or pixel-store state', () => {
    const ctx = { drawImage: vi.fn(), clearRect: vi.fn(), imageSmoothingEnabled: false };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    const canvas = { width: 2048, height: 64 } as HTMLCanvasElement;
    const source = createPixelAtlasSource(canvas);
    const tex = { width: 0, height: 0, target: 3553, internalFormat: 6408, format: 6408, type: 5121 } as GlTexture;
    const image = vi.fn(), sub = vi.fn(), gl = { texImage2D: image, texSubImage2D: sub } as unknown as GlRenderingContext;
    pixelAtlasUploader.upload(source, tex, gl, 2);
    expect(image).toHaveBeenCalledTimes(1); expect(tex.width).toBe(2048);
    markPixelAtlasDirty(source, { x: 13, y: 7, width: 1, height: 1 });
    pixelAtlasUploader.upload(source, tex, gl, 2);
    expect(image).toHaveBeenCalledTimes(1); expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0]!.slice(0, 6)).toEqual([3553, 0, 13, 7, 6408, 5121]);
    expect(sub.mock.calls[0]![6]).toMatchObject({ width: 1, height: 1 });
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 13, 7, 1, 1, 0, 0, 1, 1);
    tex.width = 0; tex.height = 0; pixelAtlasUploader.upload(source, tex, gl, 2);
    expect(image).toHaveBeenCalledTimes(2); // context loss / recreation
  });
  it('clips/unions dirty regions and leaves clean initialized pages alone', () => {
    const ctx = { drawImage: vi.fn(), clearRect: vi.fn(), imageSmoothingEnabled: false };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    const source = createPixelAtlasSource({ width: 64, height: 64 } as HTMLCanvasElement);
    const tex = { width: 64, height: 64, target: 3553, internalFormat: 6408, format: 6408, type: 5121 } as GlTexture;
    const sub = vi.fn(), gl = { texImage2D: vi.fn(), texSubImage2D: sub } as unknown as GlRenderingContext;
    pixelAtlasUploader.upload(source, tex, gl, 2); expect(sub).not.toHaveBeenCalled();
    markPixelAtlasDirty(source, { x: -1, y: -1, width: 4, height: 4 }); markPixelAtlasDirty(source, { x: 2, y: 2, width: 3, height: 3 });
    pixelAtlasUploader.upload(source, tex, gl, 2); expect(sub.mock.calls[0]![6]).toMatchObject({ width: 5, height: 5 });
  });
});
