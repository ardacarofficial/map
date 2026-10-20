/** Tight RGBA8, straight alpha. No image APIs or encoded payloads live here. */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** A detached copy. Writing it can never change the store. */
  readonly data: Uint8Array;
  readonly revision: number;
}
export interface RasterAssetInput {
  readonly assetId: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly data: Uint8Array;
}
export interface RasterAssetInfo {
  readonly tileCount: number;
  readonly assetId: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly revision: number;
}
export interface RasterAssetsView {
  assetIds(): readonly string[];
  info(assetId: string): RasterAssetInfo | undefined;
  /** Detached tile-page snapshot; buffers are shared until either side writes. */
  fork(): RasterAssets;
  getAsset(assetId: string): RasterImage | undefined;
  getTile(assetId: string, tileId: number): RasterImage | undefined;
}
export const MAX_RASTER_TILES = 65536;
export const MAX_RASTER_BYTES = 64 * 1024 * 1024;

export function assertRasterSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height * 4 > MAX_RASTER_BYTES) {
    throw new RangeError('raster dimensions exceed the RGBA8 capacity');
  }
}
export function canonicalRgba(width: number, height: number, bytes: Uint8Array): Uint8Array {
  assertRasterSize(width, height);
  if (!(bytes instanceof Uint8Array) || bytes.length !== width * height * 4) throw new RangeError('incorrect RGBA8 byte length');
  const data = new Uint8Array(bytes);
  for (let p = 0; p < data.length; p += 4) if (data[p + 3] === 0) data.fill(0, p, p + 3);
  return data;
}
interface Asset {
  info: Omit<RasterAssetInfo, 'revision'>;
  tiles: Map<number, Uint8Array>;
}

/** Inject one instance into multiple stores for world-scoped pixel data. Mutation is internal to MapStore. */
export class RasterAssets implements RasterAssetsView {
  readonly #assets = new Map<string, Asset>();
  readonly #revisions = new Map<string, number>();
  readonly #tileRevisions = new Map<string, Map<number, number>>();
  #revision = 0;
  readonly view: RasterAssetsView = Object.freeze({
    fork: () => this.fork(), assetIds: () => this.assetIds(), info: (id: string) => this.info(id),
    getAsset: (id: string) => this.getAsset(id), getTile: (id: string, tile: number) => this.getTile(id, tile),
  });
  get revision(): number { return this.#revision; }
  fork(): RasterAssets {
    const copy = new RasterAssets();
    for (const [id, asset] of this.#assets) copy.#assets.set(id, { info: asset.info, tiles: new Map(asset.tiles) });
    for (const [id, revision] of this.#revisions) copy.#revisions.set(id, revision);
    for (const [id, revisions] of this.#tileRevisions) copy.#tileRevisions.set(id, new Map(revisions));
    copy.#revision = this.#revision;
    return copy;
  }
  assetIds(): readonly string[] { return Object.freeze([...this.#assets.keys()].sort()); }
  info(assetId: string): RasterAssetInfo | undefined {
    const asset = this.#assets.get(assetId);
    return asset ? Object.freeze({ ...asset.info, revision: this.#revisions.get(assetId)! }) : undefined;
  }
  getTile(assetId: string, tileId: number): RasterImage | undefined {
    const asset = this.#assets.get(assetId);
    const bytes = asset?.tiles.get(tileId);
    return asset && bytes ? Object.freeze({ width: asset.info.tileWidth, height: asset.info.tileHeight, data: bytes.slice(), revision: this.#tileRevisions.get(assetId)!.get(tileId)! }) : undefined;
  }
  getAsset(assetId: string): RasterImage | undefined {
    const asset = this.#assets.get(assetId);
    if (!asset) return undefined;
    const { tileWidth: tw, tileHeight: th, columns, rows } = asset.info;
    const width = tw * columns, height = th * rows;
    const data = new Uint8Array(width * height * 4);
    for (const [id, tile] of asset.tiles) {
      for (let y = 0; y < th; y++) {
        const p = ((Math.floor(id / columns) * th + y) * width + (id % columns) * tw) * 4;
        data.set(tile.subarray(y * tw * 4, (y + 1) * tw * 4), p);
      }
    }
    return Object.freeze({ width, height, data, revision: this.#revisions.get(assetId)! });
  }
  /** @internal Load decoded bytes through a MapStore operation. */
  _load(input: RasterAssetInput, tileCount = input.columns * input.rows): void {
    const { assetId, tileWidth: tw, tileHeight: th, columns, rows } = input;
    if (!assetId || ![tw, th, columns, rows].every(n => Number.isSafeInteger(n) && n > 0) || columns * rows > MAX_RASTER_TILES) throw new RangeError('invalid raster grid');
    if (!Number.isSafeInteger(tileCount) || tileCount < 1 || tileCount > columns * rows) throw new RangeError("invalid raster tile count");
    const data = canonicalRgba(tw * columns, th * rows, input.data);
    const tiles = new Map<number, Uint8Array>();
    for (let id = 0; id < tileCount; id++) {
      const tile = new Uint8Array(tw * th * 4);
      for (let y = 0; y < th; y++) {
        const p = ((Math.floor(id / columns) * th + y) * tw * columns + (id % columns) * tw) * 4;
        tile.set(data.subarray(p, p + tw * 4), y * tw * 4);
      }
      tiles.set(id, tile);
    }
    this.#assets.set(assetId, { info: { tileCount, assetId, tileWidth: tw, tileHeight: th, columns, rows }, tiles });
    this.#touch(assetId);
  }
  /** @internal Slot append/replay. Missing info removes an asset created by the undone allocation. */
  _slot(info: Omit<RasterAssetInfo, 'revision'> | undefined, assetId: string, tileId: number, bytes: Uint8Array | undefined): void {
    if (!info) this.#assets.delete(assetId);
    else {
      let asset = this.#assets.get(assetId);
      if (!asset) { asset = { info, tiles: new Map() }; this.#assets.set(assetId, asset); }
      asset.info = info;
      if (bytes) asset.tiles.set(tileId, bytes.slice());
      else asset.tiles.delete(tileId);
    }
    this.#touch(assetId, tileId);
  }
  /** @internal Caller prevalidates all rects; replay never exposes these owned buffers. */
  _rect(assetId: string, tileId: number, x: number, y: number, width: number, height: number, bytes: Uint8Array): void {
    const asset = this.#assets.get(assetId)!;
    const tile = asset.tiles.get(tileId)!.slice();
    asset.tiles.set(tileId, tile);
    for (let row = 0; row < height; row++) tile.set(bytes.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * asset.info.tileWidth + x) * 4);
    this.#touch(assetId, tileId);
  }
  #touch(id: string, tileId?: number): void {
    this.#revision++;
    this.#revisions.set(id, (this.#revisions.get(id) ?? 0) + 1);
    let tiles = this.#tileRevisions.get(id);
    if (!tiles) { tiles = new Map(); this.#tileRevisions.set(id, tiles); }
    for (const tile of tileId === undefined ? this.#assets.get(id)?.tiles.keys() ?? [] : [tileId]) tiles.set(tile, (tiles.get(tile) ?? 0) + 1);
  }
}
