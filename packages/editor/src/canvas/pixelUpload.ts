/** Pixi 8.22's public GlTextureSystem.uploadExtensions hook.
 * Pixi binds the target and configures alpha before this callback. We change
 * neither bindings nor pixel-store state. A CanvasImageSource crop preserves
 * Pixi's premultiply-alpha-on-upload policy; typed-array uploads would not.
 */
import { CanvasSource, GlTextureSystem, type GLTextureUploader, type TextureSource } from 'pixi.js';
import type { PixelRect } from '@smap/core';
interface PageState { dirty?: PixelRect; crop?: HTMLCanvasElement }
const pages = new WeakMap<TextureSource, PageState>();
export const pixelUploadMetrics = { fullUploads: 0, subUploads: 0, uploadedBytes: 0 };
export function createPixelAtlasSource(resource: HTMLCanvasElement): CanvasSource {
  const source = new CanvasSource({ resource, scaleMode: 'nearest', autoGenerateMipmaps: false, antialias: false });
  source.uploadMethodId = 'smap-pixel'; pages.set(source, {}); return source;
}
export function markPixelAtlasDirty(source: TextureSource, rect: PixelRect): void {
  const state = pages.get(source); if (!state) return;
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(source.pixelWidth, Math.ceil(rect.x + rect.width)), bottom = Math.min(source.pixelHeight, Math.ceil(rect.y + rect.height));
  if (right <= x || bottom <= y) return;
  const old = state.dirty, x0 = Math.min(old?.x ?? x, x), y0 = Math.min(old?.y ?? y, y);
  state.dirty = { x: x0, y: y0, width: Math.max(old ? old.x + old.width : right, right) - x0, height: Math.max(old ? old.y + old.height : bottom, bottom) - y0 };
}
export const pixelAtlasUploader: GLTextureUploader = {
  id: 'smap-pixel',
  upload(source, texture, context, version, targetOverride, forceAllocation) {
    if (version !== 2) throw new Error('Pixel atlas requires WebGL2');
    const gl = context as WebGL2RenderingContext, target = targetOverride ?? texture.target;
    const resource = source.resource as HTMLCanvasElement;
    const state = pages.get(source);
    if (forceAllocation || texture.width !== source.pixelWidth || texture.height !== source.pixelHeight) {
      gl.texImage2D(target, 0, texture.internalFormat, source.pixelWidth, source.pixelHeight, 0, texture.format, texture.type, resource);
      texture.width = source.pixelWidth; texture.height = source.pixelHeight;
      if (state) delete state.dirty;
      pixelUploadMetrics.fullUploads++; pixelUploadMetrics.uploadedBytes += source.pixelWidth * source.pixelHeight * 4;
      return;
    }
    if (!state?.dirty) return;
    const r = state.dirty, crop = state.crop ??= document.createElement('canvas');
    if (crop.width !== r.width) crop.width = r.width; if (crop.height !== r.height) crop.height = r.height;
    const ctx = crop.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Pixel crop canvas unavailable');
    ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, r.width, r.height);
    ctx.drawImage(resource, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
    gl.texSubImage2D(target, 0, r.x, r.y, texture.format, texture.type, crop);
    delete state.dirty;
    pixelUploadMetrics.subUploads++; pixelUploadMetrics.uploadedBytes += r.width * r.height * 4;
  },
};
// Registered while MapCanvas modules load, before its WebGL renderer is created.
GlTextureSystem.uploadExtensions['smap-pixel'] = pixelAtlasUploader;
