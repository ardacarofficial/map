/**
 * Tile layers of one MapStore as Pixi display objects.
 *
 * - Per (layer, chunk) one Container with one Mesh per atlas page it uses
 *   (normally exactly one): a 32×32 chunk is a single draw call.
 * - A chunk is rebuilt only when a store change event lists it as dirty, or
 *   when a tileset image it uses (re)arrives. A dirty key whose chunk no
 *   longer exists destroys the view.
 * - Meshes are built lazily: a dirty (or never built) chunk is built by
 *   {@link MapScene.flush} only once it is inside the visible range of a
 *   visible layer. Opening a 1024×1024 map therefore builds the ~12–50
 *   chunks on screen, not all 4096; a fill over the whole map rebuilds only
 *   what is seen, the rest when it scrolls into view.
 * - Chunks outside the view are hidden (cheap manual culling).
 * - Grid and entity layers get an empty view: they are not tiles.
 */
import {
  CHUNK_SIZE,
  isTileLayer,
  parseChunkKey,
  type ChunkKey,
  type MapStore,
  type StoreChangeEvent,
  type TileLayer,
} from "@smap/core";
import { Container, Graphics, Mesh, MeshGeometry, type Texture } from "pixi.js";

import { buildChunkQuads, type QuadSource } from "./chunkGeometry";
import { CANVAS_COLORS } from "./colors";
import { TilesetAtlas } from "./tilesetAtlas";

interface ChunkView {
  readonly cx: number;
  readonly cy: number;
  readonly container: Container;
  /** Tileset ids referenced by the chunk's cells (drawn or still missing an image). */
  tilesets: Set<string>;
}

interface LayerView {
  /** The layer instance the view was built from (undo of a removal may bring back a new instance). */
  readonly layer: TileLayer;
  readonly container: Container;
  readonly chunks: Map<ChunkKey, ChunkView>;
}

export type ImageLookup = (tilesetId: string) => CanvasImageSource | undefined;

export class MapScene {
  /** World-space root: map background + layers. Add it to the camera container. */
  readonly root = new Container();
  readonly store: MapStore;
  readonly #layers = new Container();
  readonly #background = new Graphics();
  readonly #views = new Map<string, LayerView>();
  readonly #atlases = new Map<string, { atlas: TilesetAtlas; groupBase: number }>();
  /** Texture per quad group (global atlas page id). */
  readonly #groupTextures = new Map<number, Texture>();
  #nextGroup = 0;
  /** Palette index → quad source; `null` = resolved as not drawable. Cleared when atlases change. */
  #resolved: (QuadSource | null)[] = [];
  /** Chunks whose mesh is missing or out of date, per layer (built when visible). */
  readonly #dirty = new Map<string, Set<ChunkKey>>();
  /** Visible chunk range from the last {@link updateVisibility} (inclusive), or null before the first. */
  #range: { cx0: number; cy0: number; cx1: number; cy1: number } | null = null;
  readonly #images: ImageLookup;
  readonly #unsubscribe: () => void;
  readonly #onChange: () => void;

  constructor(store: MapStore, images: ImageLookup, onChange: () => void) {
    this.store = store;
    this.#images = images;
    this.#onChange = onChange;
    this.root.addChild(this.#background, this.#layers);
    this.#drawBackground();
    for (const ts of store.document.tilesets) this.#ensureAtlas(ts.id);
    this.#syncLayers();
    this.#unsubscribe = store.subscribe((e) => this.#handle(e));
  }

  /** Builds (or rebuilds) the atlas of `tilesetId` from its image and marks dependent chunks dirty. */
  imageChanged(tilesetId: string): void {
    if (!this.store.document.getTileset(tilesetId)) return;
    this.#buildAtlas(tilesetId);
    this.#onChange();
  }

  /** Atlas of a tileset, if its image is loaded. */
  atlas(tilesetId: string): TilesetAtlas | undefined {
    return this.#atlases.get(tilesetId)?.atlas;
  }

  /** Increases whenever an atlas is (re)built; previews built from atlas textures compare it. */
  get atlasVersion(): number {
    return this.#nextGroup;
  }

  /** Where a tile is drawn from, if its tileset image is loaded. */
  quadSource(tilesetId: string, tileId: number): QuadSource | undefined {
    const a = this.#atlases.get(tilesetId);
    const uv = a?.atlas.uv(tileId);
    return a && uv ? { group: a.groupBase + uv.page, u0: uv.u0, v0: uv.v0, u1: uv.u1, v1: uv.v1 } : undefined;
  }

  /** Texture of a quad group (atlas page) from {@link quadSource}. */
  groupTexture(group: number): Texture | undefined {
    return this.#groupTextures.get(group);
  }

  /**
   * Shows / hides the tile layer meshes (the background stays). The canvas
   * hides them while it draws the map from the thumbnail (far-zoom LOD).
   */
  setTilesVisible(visible: boolean): void {
    this.#layers.visible = visible;
  }

  /** True when there are chunks waiting to be rebuilt. */
  get hasDirty(): boolean {
    return this.#dirty.size > 0;
  }

  /**
   * Rebuilds the dirty chunks inside the visible range of visible layers
   * (and drops views of chunks that no longer exist). Call once per frame
   * after {@link updateVisibility}, before rendering. Others stay dirty
   * until they are scrolled into view; nothing is built while the tile
   * layers are hidden (far-zoom LOD).
   */
  flush(): void {
    if (this.#dirty.size === 0 || !this.#layers.visible) return;
    const range = this.#range;
    if (!range) return;
    const doc = this.store.document;
    for (const [layerId, keys] of this.#dirty) {
      const layer = doc.getLayer(layerId);
      const view = this.#views.get(layerId);
      if (!layer || !view || !isTileLayer(layer)) {
        // Grid layers are not drawn here (see #rebuildChunk).
        this.#dirty.delete(layerId);
        continue;
      }
      const shown = layer.visible && layer.opacity > 0;
      for (const key of keys) {
        const chunk = layer.getChunkByKey(key);
        if (chunk && !(shown && chunk.cx >= range.cx0 && chunk.cx <= range.cx1 && chunk.cy >= range.cy0 && chunk.cy <= range.cy1)) continue;
        this.#rebuildChunk(layer, view, key);
        keys.delete(key);
      }
      if (keys.size === 0) this.#dirty.delete(layerId);
    }
  }

  /** Syncs layer visibility/opacity and hides chunks outside the visible cell range. */
  updateVisibility(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.floor(x0 / CHUNK_SIZE);
    const cy0 = Math.floor(y0 / CHUNK_SIZE);
    const cx1 = Math.floor((x1 - 1) / CHUNK_SIZE);
    const cy1 = Math.floor((y1 - 1) / CHUNK_SIZE);
    this.#range = { cx0, cy0, cx1, cy1 };
    for (const layer of this.store.document.layers) {
      const view = this.#views.get(layer.id);
      if (!view) continue;
      view.container.visible = layer.visible && layer.opacity > 0;
      view.container.alpha = layer.opacity;
      if (!view.container.visible) continue;
      for (const c of view.chunks.values()) {
        c.container.visible = c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1;
      }
    }
  }

  destroy(): void {
    this.#unsubscribe();
    for (const view of this.#views.values()) for (const c of view.chunks.values()) destroyChunkView(c);
    this.root.destroy({ children: true });
    for (const { atlas } of this.#atlases.values()) atlas.destroy();
    this.#atlases.clear();
    this.#groupTextures.clear();
    this.#views.clear();
    this.#dirty.clear();
  }

  // ------------------------------------------------------------------ internals

  #handle(e: StoreChangeEvent): void {
    let changed = false;
    for (const { layerId, chunks } of e.cells) {
      let set = this.#dirty.get(layerId);
      if (!set) this.#dirty.set(layerId, (set = new Set()));
      for (const k of chunks) set.add(k);
      changed = true;
    }
    if (e.structure.includes("tilesets")) {
      for (const ts of this.store.document.tilesets) this.#ensureAtlas(ts.id);
      changed = true;
    }
    if (e.structure.includes("layers")) {
      this.#syncLayers();
      changed = true;
    }
    if (e.structure.includes("map")) {
      // Resize: bounds changed, cells outside were dropped. Rare → rebuild everything.
      this.#drawBackground();
      for (const view of this.#views.values()) this.#rebuildLayer(view);
    }
    // "palette": append-only, existing indices keep their meaning → nothing to rebuild.
    // Layer visibility/opacity are read every frame, so any structural change just re-renders.
    if (changed || e.structure.length > 0) this.#onChange();
  }

  #drawBackground(): void {
    const { width, height, tileWidth, tileHeight } = this.store.document.map;
    this.#background.clear().rect(0, 0, width * tileWidth, height * tileHeight).fill(CANVAS_COLORS.mapBackground);
  }

  #inRange(layer: TileLayer, key: ChunkKey): boolean {
    const r = this.#range;
    if (!r || !this.#layers.visible || !layer.visible || layer.opacity <= 0) return false;
    const { cx, cy } = parseChunkKey(key);
    return cx >= r.cx0 && cx <= r.cx1 && cy >= r.cy0 && cy <= r.cy1;
  }

  #markDirty(layerId: string, key: ChunkKey): void {
    let set = this.#dirty.get(layerId);
    if (!set) this.#dirty.set(layerId, (set = new Set()));
    set.add(key);
  }

  #rebuildLayer(view: LayerView): void {
    for (const c of view.chunks.values()) destroyChunkView(c);
    view.chunks.clear();
    this.#markAll(view.layer);
  }

  /** Marks every chunk of `layer` as needing a mesh (built when it becomes visible). */
  #markAll(layer: TileLayer): void {
    const keys = new Set<ChunkKey>();
    for (const chunk of layer.chunks()) keys.add(chunk.key);
    if (keys.size > 0) this.#dirty.set(layer.id, keys);
    else this.#dirty.delete(layer.id);
  }

  #ensureAtlas(tilesetId: string): void {
    if (!this.#atlases.has(tilesetId) && this.#images(tilesetId)) this.#buildAtlas(tilesetId);
  }

  #buildAtlas(tilesetId: string): void {
    const tileset = this.store.document.getTileset(tilesetId);
    const image = this.#images(tilesetId);
    if (!tileset || !image) return;
    let atlas: TilesetAtlas;
    try {
      atlas = new TilesetAtlas(tileset, image);
    } catch (error) {
      console.error(`[canvas] atlas for tileset "${tilesetId}" failed`, error);
      return;
    }
    const old = this.#atlases.get(tilesetId);
    const groupBase = this.#nextGroup;
    this.#nextGroup += atlas.pages.length;
    atlas.pages.forEach((tex, i) => this.#groupTextures.set(groupBase + i, tex));
    this.#atlases.set(tilesetId, { atlas, groupBase });
    this.#resolved = [];
    // Rebuild now (not lazily) so the old atlas can be released immediately.
    const doc = this.store.document;
    for (const layer of doc.layers) {
      const view = this.#views.get(layer.id);
      if (!view) continue;
      // Snapshot: #rebuildChunk re-inserts keys, which a live Map iteration would visit again.
      const keys = [...view.chunks].filter(([, c]) => c.tilesets.has(tilesetId)).map(([key]) => key);
      for (const key of keys) {
        if (this.#inRange(layer, key)) this.#rebuildChunk(layer, view, key);
        else {
          // Off screen: drop the mesh now (the old atlas goes away), rebuild when seen.
          destroyChunkView(view.chunks.get(key)!);
          view.chunks.delete(key);
          this.#markDirty(layer.id, key);
        }
      }
    }
    if (old) {
      for (let i = 0; i < old.atlas.pages.length; i++) this.#groupTextures.delete(old.groupBase + i);
      old.atlas.destroy();
    }
  }

  #syncLayers(): void {
    const doc = this.store.document;
    const alive = new Set(doc.layers);
    for (const [id, view] of this.#views) {
      if (alive.has(view.layer)) continue;
      for (const c of view.chunks.values()) destroyChunkView(c);
      view.container.destroy({ children: true });
      this.#views.delete(id);
      this.#dirty.delete(id);
    }
    doc.layers.forEach((layer, index) => {
      let view = this.#views.get(layer.id);
      if (!view) {
        view = { layer, container: new Container(), chunks: new Map() };
        this.#views.set(layer.id, view);
        this.#markAll(layer);
      }
      this.#layers.addChildAt(view.container, Math.min(index, this.#layers.children.length));
    });
  }

  #resolve(paletteIndex: number, used: Set<string>): QuadSource | undefined {
    const entry = this.store.document.palette.get(paletteIndex);
    if (!entry) return undefined;
    used.add(entry.tilesetId);
    const cached = this.#resolved[paletteIndex];
    if (cached !== undefined) return cached ?? undefined;
    const a = this.#atlases.get(entry.tilesetId);
    const uv = a?.atlas.uv(entry.tileId);
    const src = a && uv ? { group: a.groupBase + uv.page, u0: uv.u0, v0: uv.v0, u1: uv.u1, v1: uv.v1 } : null;
    this.#resolved[paletteIndex] = src;
    return src ?? undefined;
  }

  #rebuildChunk(layer: TileLayer, view: LayerView, key: ChunkKey): void {
    const old = view.chunks.get(key);
    if (old) {
      destroyChunkView(old);
      view.chunks.delete(key);
    }
    // Only plain tile layers are drawn here. Grid layers hold values (their look comes from
    // the derived tile layer and gridOverlays.ts); entity layers hold no cells.
    const chunk = isTileLayer(layer) ? layer.getChunkByKey(key) : undefined;
    if (!chunk) return;
    const { tileWidth, tileHeight } = this.store.document.map;
    const used = new Set<string>();
    const batches = buildChunkQuads(chunk.data, tileWidth, tileHeight, (i) => this.#resolve(i, used));
    const { cx, cy } = parseChunkKey(key);
    const container = new Container({ x: cx * CHUNK_SIZE * tileWidth, y: cy * CHUNK_SIZE * tileHeight });
    for (const b of batches) {
      const texture = this.#groupTextures.get(b.group);
      if (!texture) continue;
      const geometry = new MeshGeometry({ positions: b.positions, uvs: b.uvs, indices: b.indices });
      container.addChild(new Mesh({ geometry, texture, roundPixels: false }));
    }
    view.container.addChild(container);
    view.chunks.set(key, { cx, cy, container, tilesets: used });
  }
}

/** Destroys a chunk's meshes including their geometry (Mesh.destroy keeps the geometry's GPU buffers). */
function destroyChunkView(c: ChunkView): void {
  for (const child of [...c.container.children]) {
    if (child instanceof Mesh) {
      const geometry = child.geometry;
      child.destroy();
      geometry.destroy();
    }
  }
  c.container.destroy({ children: true });
}
