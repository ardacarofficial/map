import { Texture } from "pixi.js";

/**
 * Destroys `texture` together with its source (and the source's own style).
 *
 * Pixi's mesh pipe draws every unbatched mesh with one shared shader whose
 * bind group keeps the last texture source / sampler it drew with, until
 * the next mesh draw replaces them. Destroying that source (an atlas page of
 * a level just closed, a tileset just swapped) then warns "[BindGroup] a
 * 'textureSource' was destroyed while still bound to a shader", however late
 * the destroy is deferred, because nothing else draws a mesh in between.
 * Those holders always rebind before their next draw, so they need no
 * notice: drop the "change" listeners first (the source's own style
 * listener included, it is destroyed with it), then destroy. The GPU
 * texture is still freed (that goes through "unload" / "destroy").
 */
export function releaseTexture(texture: Texture): void {
  const source = texture.source;
  if (!source.destroyed) {
    source.off("change");
    if ((source as unknown as { _ownsStyle?: boolean })._ownsStyle === true) source.style.off("change");
  }
  texture.destroy(true);
}

interface FilterBindings {
  setResource(resource: unknown, index: number): void;
  resources: Record<number, unknown> | null;
}

/**
 * Points the filter system's shared bind group (it keeps the last filter
 * pass's input / back texture) at the empty texture. Call before a renderer
 * resize or teardown: Pixi's texture pool then destroys its idle
 * screen-sized textures (the grid fade filter's inputs) and would warn
 * "[BindGroup] … destroyed while still bound" about the one still held. The
 * next filter pass binds its own input again. No-op if Pixi's internals
 * change shape.
 */
export function releaseFilterInputs(renderer: unknown): void {
  const group = (renderer as { filter?: { _globalFilterBindGroup?: FilterBindings } }).filter?._globalFilterBindGroup;
  const resources = group?.resources;
  if (!group || !resources || typeof group.setResource !== "function") return;
  const empty = Texture.EMPTY.source;
  if (resources[1]) group.setResource(empty, 1);
  if (resources[2]) group.setResource(empty.style, 2);
  if (resources[3]) group.setResource(empty, 3);
}
