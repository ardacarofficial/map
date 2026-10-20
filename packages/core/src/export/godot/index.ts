/** Pure, deterministic Godot 4.3+ export. No filesystem or host APIs. */
import { cellPaletteIndex } from "../../cell";
import { CHUNK_MASK, CHUNK_SHIFT } from "../../chunk";
import { deriveCollision } from "../../collision";
import type { MapDocument } from "../../document";
import { portablePathProblem } from "../../fileName";
import type { Tileset } from "../../tileset";
import { exportBaseName, exportedLayers, exportedTilesets, exportWarnings, layerCells, type ExportLayerOptions } from "../common";
import { exportGameJson } from "../game";
import { nativeOrigin, nativePng, nativeRegion } from "./native";
import { encodeGodotCells, godotCellProblem, type GodotCell } from "./cells";

export { encodeGodotCells, type GodotCell } from "./cells";

export interface GodotMapInput extends ExportLayerOptions {
  /** Stable map identity; use it when display names may repeat. */
  readonly id?: string;
  readonly doc: MapDocument;
  readonly name: string;
}
export interface GodotOptions {
  /** Project-relative parent folder; each map owns a subfolder. Default: smap. */
  readonly resourceRoot?: string;
  /** Resolved manual Collision, independent of visual selection/visibility. Default true. */
  readonly collision?: boolean;
}
export type GodotImageBytes = (tilesetId: string) => Uint8Array | undefined;
export type GodotFile = { readonly path: string; readonly text: string; readonly bytes?: never } | { readonly path: string; readonly bytes: Uint8Array; readonly text?: never };
export interface GodotPlan {
  readonly files: readonly GodotFile[];
  readonly scenes: readonly string[];
}
export type GodotProblemKey = `godotExport.${"invalidRoot" | "missingImage" | "invalidImage" | "imageTooSmall" | "nativeSizeMismatch" | "cellSizeOutOfRange" | "rectangularTranspose" | "invalidTiles" | "overflow" | "fileConflict" | "inconsistentTileset" | "differentCellSizes" | "noMaps"}`;
export interface GodotProblem {
  readonly key: GodotProblemKey;
  readonly params: Readonly<Record<string, string | number>>;
}

/** Throwing planner errors retain structured problems for callers that bypass preflight. */
export class GodotPreflightError extends Error {
  constructor(readonly problems: readonly GodotProblem[]) {
    super(problems.map(p => p.key).join(", "));
    this.name = "GodotPreflightError";
  }
}

interface Source {
  readonly tileset: Tileset;
  id: number;
  readonly fileName: string;
  readonly used: Set<number>;
}
interface MapData {
  readonly input: GodotMapInput;
  readonly base: string;
  readonly layers: { readonly id: string; readonly name: string; readonly visible: boolean; readonly opacity: number; readonly cells: (GodotCell & { readonly tilesetId: string })[] }[];
}
function folder(options: GodotOptions): string { return options.resourceRoot ?? "smap"; }
function pathIn(root: string, path: string): string { return root ? `${root}/${path}` : path; }
function quote(text: string): string { return JSON.stringify(text); }
function nodeName(text: string): string {
  return [...text].map(c => {
    const code = c.codePointAt(0)!;
    return code < 32 || code === 127 || '.:@/"%\\'.includes(c) ? `_u${code.toString(16)}_` : c;
  }).join("") || "Map";
}
function sameTileset(a: Tileset, b: Tileset): boolean {
  return a.imagePath === b.imagePath && a.tileWidth === b.tileWidth && a.tileHeight === b.tileHeight && a.columns === b.columns && a.rows === b.rows && a.margin === b.margin && a.spacing === b.spacing;
}
function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((n, i) => bytes[i] === n)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  return width && height ? { width, height } : undefined;
}

/** Gather once so validation, image names and scene records always describe the same selection. */
function prepare(maps: readonly GodotMapInput[], bytes: GodotImageBytes, options: GodotOptions) {
  const problems: GodotProblem[] = [];
  const seenProblems = new Set<string>();
  const problem = (key: GodotProblemKey, params: GodotProblem["params"] = {}) => {
    const diagnostic = { key, params };
    const signature = JSON.stringify(diagnostic);
    if (!seenProblems.has(signature)) { seenProblems.add(signature); problems.push(diagnostic); }
  };
  const root = folder(options);
  if (root && (portablePathProblem(root) || root.split("/").some(s => s === "." || s === ".."))) problem("godotExport.invalidRoot", { path: root });
  if (!maps.length) problem("godotExport.noMaps");
  const sourcesById = new Map<string, Source>();
  const imageFiles = new Map<string, { fileName: string; source: Source }>();
  const mapData: MapData[] = [];
  const taken = new Set<string>(["tileset.tres"]);
  const first = maps[0]?.doc.map;
  for (const input of [...maps].sort((a, b) => { const x = exportBaseName(a.name), y = exportBaseName(b.name); return x < y ? -1 : x > y ? 1 : 0; })) {
    const { doc } = input;
    const base = exportBaseName(input.name);
    for (const extension of [".json", ".tscn"]) {
      const name = base + extension;
      if (taken.has(name.toLowerCase())) problem("godotExport.fileConflict", { path: name });
      taken.add(name.toLowerCase());
    }
    if (first && (doc.map.tileWidth !== first.tileWidth || doc.map.tileHeight !== first.tileHeight)) problem("godotExport.differentCellSizes", { map: input.name });
    if (![doc.map.tileWidth, doc.map.tileHeight].every(n => Number.isInteger(n) && n >= 1 && n <= 16384)) problem("godotExport.cellSizeOutOfRange", { map: input.name });
    if (exportWarnings(doc, input.layers).length) problem("godotExport.invalidTiles", { map: input.name });
    const images = exportedTilesets(doc, input.layers);
    const layers = exportedLayers(doc, input.layers).map(layer => {
      // The common exporter skips unresolved palette indices; this target must explain data loss.
      let missingPalette = false;
      for (const chunk of layer.chunks()) for (let i = 0; i < chunk.data.length; i++) {
        const cell = chunk.data[i]!;
        if (!cell) continue;
        const x = (chunk.cx << CHUNK_SHIFT) + (i & CHUNK_MASK), y = (chunk.cy << CHUNK_SHIFT) + (i >> CHUNK_SHIFT);
        if (doc.inBounds(x, y) && !doc.palette.get(cellPaletteIndex(cell))) missingPalette = true;
      }
      if (missingPalette) problem("godotExport.invalidTiles", { map: input.name });
      const cells = layerCells(doc, layer, images).map(cell => {
        const image = images[cell.tilesetIndex]!;
        const t = image.tileset;
        let source = sourcesById.get(t.id);
        if (!source) {
          source = { tileset: t, id: -1, fileName: image.fileName, used: new Set() };
          sourcesById.set(t.id, source);
        } else if (!sameTileset(source.tileset, t)) problem("godotExport.inconsistentTileset", { tileset: t.name });
        source.used.add(cell.tileId);
        const imageKey = image.fileName.toLowerCase();
        const previous = imageFiles.get(imageKey);
        if (previous && previous.source.tileset.id !== t.id) problem("godotExport.fileConflict", { path: image.fileName });
        else imageFiles.set(imageKey, { fileName: image.fileName, source });
        if (portablePathProblem(image.fileName) || !/\.png$/i.test(image.fileName)) problem("godotExport.invalidImage", { path: image.sourcePath });
        if ((cell.flags & 4) && doc.map.tileWidth !== doc.map.tileHeight) problem("godotExport.rectangularTranspose", { map: input.name });
        return { x: cell.x, y: cell.y, sourceId: 0, atlasX: cell.tileId % t.columns, atlasY: Math.floor(cell.tileId / t.columns), alternative: t.tileWidth === doc.map.tileWidth && t.tileHeight === doc.map.tileHeight ? cell.flags * 4096 : cell.flags, tilesetId: t.id };
      });
      return { id: layer.id, name: layer.name, visible: layer.visible, opacity: layer.opacity, cells };
    });
    mapData.push({ input, base, layers });
  }
  const sources = [...sourcesById.values()].sort((a, b) => a.tileset.id < b.tileset.id ? -1 : a.tileset.id > b.tileset.id ? 1 : 0);
  const imageData = new Map<string, Uint8Array>();
  const paddedImages = new Map<string, Uint8Array>();
  sources.forEach((source, id) => {
    // Source objects are local planning records, never document state.
    source.id = id;
    const t = source.tileset;
    const data = bytes(t.id);
    if (!data) { problem("godotExport.missingImage", { path: t.imagePath }); return; }
    const size = pngSize(data);
    if (!size) problem("godotExport.invalidImage", { path: t.imagePath });
    else if (size.width < t.margin + t.columns * t.tileWidth + (t.columns - 1) * t.spacing || size.height < t.margin + t.rows * t.tileHeight + (t.rows - 1) * t.spacing) problem("godotExport.imageTooSmall", { path: t.imagePath });
    else if (first) {
      const region = nativeRegion(t, first.tileWidth, first.tileHeight);
      if (region.width > 16384 || region.height > 16384) problem("godotExport.cellSizeOutOfRange", { map: maps[0]!.name });
      else try {
        imageData.set(t.id, data);
        if (region.width !== t.tileWidth || region.height !== t.tileHeight) paddedImages.set(t.id, nativePng(data, t, first.tileWidth, first.tileHeight));
      }
      catch { problem("godotExport.invalidImage", { path: t.imagePath }); }
    }
  });
  for (const map of mapData) for (const layer of map.layers) for (const cell of layer.cells) {
    Object.assign(cell, { sourceId: sourcesById.get(cell.tilesetId)!.id });
    if (godotCellProblem(cell)) problem("godotExport.overflow", { map: map.input.name });
  }
  if (sources.length + (options.collision === false ? 0 : 1) > 32768) problem("godotExport.overflow", { map: maps.map(map => map.name).join(", ") });
  for (const { fileName } of imageFiles.values()) if (taken.has(fileName.toLowerCase())) problem("godotExport.fileConflict", { path: fileName });
  return { problems, maps: mapData, sources, imageFiles: [...imageFiles.values()], imageData, paddedImages };
}

function mapNamespace(map: GodotMapInput): string {
  const base = exportBaseName(map.name);
  // Lossless lowercase ASCII identity survives case-insensitive file systems
  // and portable-name substitutions. The prefix remains human-readable.
  return map.id === undefined ? base : `${base}--id-${[...map.id].map(c => c.codePointAt(0)!.toString(16)).join("-")}`;
}

/** Each map owns every dependency, regardless of batching or export order. */
function namespaces(maps: readonly GodotMapInput[], bytes: GodotImageBytes, options: GodotOptions) {
  const problems: GodotProblem[] = [];
  const names = new Set<string>();
  if (!maps.length) problems.push({ key: "godotExport.noMaps", params: {} });
  const prepared = [...maps].sort((a,b) => mapNamespace(a) < mapNamespace(b) ? -1 : mapNamespace(a) > mapNamespace(b) ? 1 : 0).map(map => {
    const name = mapNamespace(map);
    if (names.has(name.toLowerCase())) problems.push({ key: "godotExport.fileConflict", params: { path: name } });
    names.add(name.toLowerCase());
    const scoped = { ...options, resourceRoot: pathIn(folder(options), name) };
    const plan = prepare([map], bytes, scoped);
    problems.push(...plan.problems);
    return { plan, options: scoped };
  });
  return { prepared, problems };
}

/** All blocking user-facing problems; no files are returned on failure. */
export function preflightGodot(maps: readonly GodotMapInput[], bytes: GodotImageBytes, options: GodotOptions = {}): readonly GodotProblem[] {
  return namespaces(maps, bytes, options).problems;
}

/** Per-map TileSets/PNGs/scenes. Sequential plans never rewrite another map. */
export function exportGodot(maps: readonly GodotMapInput[], bytes: GodotImageBytes, options: GodotOptions = {}): GodotPlan {
  const result = namespaces(maps, bytes, options);
  if (result.problems.length) throw new GodotPreflightError(result.problems);
  const plans = result.prepared.map(item => exportMap(item.plan, item.options));
  return { files: plans.flatMap(plan => plan.files), scenes: plans.flatMap(plan => plan.scenes) };
}
function exportMap(prepared: ReturnType<typeof prepare>, options: GodotOptions): GodotPlan {
  if (prepared.problems.length) throw new GodotPreflightError(prepared.problems);
  const root = folder(options), files: GodotFile[] = [], scenes: string[] = [];
  for (const image of prepared.imageFiles) {
    const id = image.source.tileset.id;
    // The byte-identical game JSON companion still addresses the original PNG.
    files.push({ path: pathIn(root, image.fileName), bytes: prepared.imageData.get(id)!.slice() });
    const padded = prepared.paddedImages.get(id);
    if (padded) files.push({ path: pathIn(root, `godot/${image.fileName}`), bytes: padded });
  }
  const tileWidth = prepared.maps[0]!.input.doc.map.tileWidth, tileHeight = prepared.maps[0]!.input.doc.map.tileHeight;
  const collision = options.collision !== false;
  const collisionSource = prepared.sources.length;
  const ext = prepared.sources.map(source => `[ext_resource type="Texture2D" path=${quote(`res://${pathIn(root, prepared.paddedImages.has(source.tileset.id) ? `godot/${source.fileName}` : source.fileName)}`)} id="texture_${source.id}"]`);
  const sub = prepared.sources.map(source => {
    const t = source.tileset;
    const region = nativeRegion(t, tileWidth, tileHeight);
    const padded = region.width !== t.tileWidth || region.height !== t.tileHeight;
    const native = t.tileWidth !== tileWidth || t.tileHeight !== tileHeight;
    const entries = [...source.used].sort((a, b) => a - b).flatMap(id => {
      const tile = `${id % t.columns}:${Math.floor(id / t.columns)}`;
      if (!native) return [`${tile}/0 = 0`];
      return Array.from({ length: 8 }, (_, flags) => {
        const origin = nativeOrigin(t, tileWidth, tileHeight, flags);
        return `${tile}/${flags} = ${flags}\n${tile}/${flags}/flip_h = ${!!(flags & 1)}\n${tile}/${flags}/flip_v = ${!!(flags & 2)}\n${tile}/${flags}/transpose = ${!!(flags & 4)}\n${tile}/${flags}/texture_origin = Vector2i(${origin.x}, ${origin.y})`;
      });
    });
    return `[sub_resource type="TileSetAtlasSource" id="atlas_${source.id}"]\nresource_name = ${quote(t.name)}\ntexture = ExtResource("texture_${source.id}")\nmargins = Vector2i(${padded ? 0 : t.margin}, ${padded ? 0 : t.margin})\nseparation = Vector2i(${padded ? 0 : t.spacing}, ${padded ? 0 : t.spacing})\ntexture_region_size = Vector2i(${region.width}, ${region.height})\n${entries.join("\n")}`;
  });
  if (collision) {
    sub.push('[sub_resource type="Gradient" id="collision_gradient"]\ncolors = PackedColorArray(0, 0, 0, 0, 0, 0, 0, 0)');
    sub.push(`[sub_resource type="GradientTexture2D" id="collision_texture"]\ngradient = SubResource("collision_gradient")\nwidth = ${tileWidth}\nheight = ${tileHeight}`);
    sub.push(`[sub_resource type="TileSetAtlasSource" id="collision_atlas"]\ntexture = SubResource("collision_texture")\ntexture_region_size = Vector2i(${tileWidth}, ${tileHeight})\n0:0/0 = 0\n0:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(${-tileWidth / 2}, ${-tileHeight / 2}, ${tileWidth / 2}, ${-tileHeight / 2}, ${tileWidth / 2}, ${tileHeight / 2}, ${-tileWidth / 2}, ${tileHeight / 2})`);
  }
  const assignments = prepared.sources.map(source => `sources/${source.id} = SubResource("atlas_${source.id}")`);
  if (collision) assignments.push(`sources/${collisionSource} = SubResource("collision_atlas")`);
  const resource = `[resource]\ntile_size = Vector2i(${tileWidth}, ${tileHeight})\n${collision ? "physics_layer_0/collision_layer = 1\nphysics_layer_0/collision_mask = 1\n" : ""}${assignments.join("\n")}`;
  files.push({ path: pathIn(root, "tileset.tres"), text: [`[gd_resource type="TileSet" load_steps=${ext.length + sub.length + 1} format=3]`, ...ext, ...sub, resource].join("\n\n") + "\n" });
  for (const map of prepared.maps) {
    const { input } = map;
    const nodes: string[] = [];
    const names = new Set<string>();
    const uniqueName = (raw: string) => { const name = nodeName(raw); let candidate = name; for (let n = 2; names.has(candidate); n++) candidate = `${name} ${n}`; names.add(candidate); return candidate; };
    const layerNode = (name: string, visible: boolean, opacity: number, cells: readonly GodotCell[], isCollision: boolean, id?: string) => {
      nodes.push(`[node name=${quote(uniqueName(name))} type="TileMapLayer" parent="."]\nvisible = ${visible}\nmodulate = Color(1, 1, 1, ${opacity})\ntexture_filter = 1\ntile_set = ExtResource("tileset")\ncollision_enabled = ${isCollision}\ntile_map_data = PackedByteArray(${[...encodeGodotCells(cells)].join(", ")})\nmetadata/smap_layer_name = ${quote(name)}${id === undefined ? "" : `\nmetadata/smap_layer_id = ${quote(id)}`}`);
    };
    for (const layer of map.layers) layerNode(layer.name, layer.visible, layer.opacity, layer.cells, false, layer.id);
    if (collision) {
      const grid = deriveCollision(input.doc), cells: GodotCell[] = [];
      for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) if (grid.data[y * grid.width + x]) cells.push({ x, y, sourceId: collisionSource, atlasX: 0, atlasY: 0, alternative: 0 });
      layerNode("Collision", true, 1, cells, true);
    }
    const jsonOptions = { ...(input.layers ? { layers: input.layers } : {}), collision };
    files.push({ path: pathIn(root, `${map.base}.json`), text: exportGameJson(input.doc, jsonOptions) });
    const path = pathIn(root, `${map.base}.tscn`);
    scenes.push(path);
    files.push({ path, text: [`[gd_scene load_steps=2 format=3]`, `[ext_resource type="TileSet" path=${quote(`res://${pathIn(root, "tileset.tres")}`)} id="tileset"]`, `[node name=${quote(nodeName(input.name))} type="Node2D"]\nmetadata/smap_map_name = ${quote(input.name)}`, ...nodes].join("\n\n") + "\n" });
  }
  return { files, scenes };
}
