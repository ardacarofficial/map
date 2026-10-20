/** Pure Defold 1.9.8 native resource planner. No filesystem or platform APIs. */
import type { MapDocument } from "../../document";
import { portablePathProblem } from "../../fileName";
import { exportBaseName, exportedLayers, exportedTilesets, exportWarnings, layerCells, type ExportCell } from "../common";
import { exportGameJson, type GameExportOptions } from "../game";
import { defoldCollisionObjects } from "./collision";
import { defoldOrientation } from "./orientation";
import { defoldPng } from "./png";

export { defoldOrientation } from "./orientation";
export { DEFOLD_SHAPES_PER_OBJECT } from "./collision";

export type DefoldExportFile = { readonly path: string; readonly text: string } | { readonly path: string; readonly bytes: Uint8Array };
export type DefoldImageBytes = (tilesetId: string) => Uint8Array | undefined;
export interface DefoldExportOptions extends GameExportOptions {
  /** Stable map identity; encoded losslessly for case-insensitive destinations. */
  readonly levelId?: string;
  /** Folder inside the Defold project, default "exported"; the map name is appended.
   * Leading resource slash and Windows separators are accepted; OS roots and .. are rejected.
   */
  readonly projectSubfolder?: string;
}
export type DefoldProblemCode = "projectSubfolder" | "tileSize" | "layerOpacity" | "overlappingArt" | "missingTexture" | "invalidCells" | "tileIndex" | "textureLayout";
export interface DefoldProblem {
  readonly code: DefoldProblemCode;
  readonly params: Readonly<Record<string, string | number>>;
}
export class DefoldExportError extends Error {
  constructor(readonly problems: readonly DefoldProblem[]) {
    super(`Defold preflight: ${problems.map((problem) => problem.code).join(", ")}`);
    this.name = "DefoldExportError";
  }
}

function projectFolder(raw = "exported"): string | null {
  const path = raw.trim().replace(/\\/g, "/");
  // A single leading slash is a Defold resource path. UNC and drive roots are OS paths.
  if (path.startsWith("//") || /^[a-z]:/i.test(path)) return null;
  const relative = path.replace(/^\//, "").replace(/\/$/, "");
  if (!relative || relative.split("/").some((part) => part === "." || part === "..") || portablePathProblem(relative)) return null;
  return relative;
}

/** Errors block the entire package; no cells, opacity or images are silently lost. */
export function defoldPreflight(doc: MapDocument, bytes: DefoldImageBytes, options: DefoldExportOptions = {}): DefoldProblem[] {
  const problems: DefoldProblem[] = [];
  if (projectFolder(options.projectSubfolder) === null) problems.push({ code: "projectSubfolder", params: {} });
  const images = exportedTilesets(doc, options.layers);
  for (const { tileset } of images) {
    if (tileset.tileWidth !== doc.map.tileWidth || tileset.tileHeight !== doc.map.tileHeight) {
      problems.push({ code: "tileSize", params: { tileset: tileset.name, width: tileset.tileWidth, height: tileset.tileHeight, mapWidth: doc.map.tileWidth, mapHeight: doc.map.tileHeight } });
    }
    if (!bytes(tileset.id)?.length) problems.push({ code: "missingTexture", params: { tileset: tileset.name } });
  }
  for (const layer of exportedLayers(doc, options.layers)) {
    if (layer.opacity !== 1) problems.push({ code: "layerOpacity", params: { layer: layer.name } });
    const cells = layerCells(doc, layer, images);
    if (cells.some((cell) => cell.tileId >= 65535)) problems.push({ code: "tileIndex", params: { layer: layer.name } });
    // Rotated nonsquare tiles also extend outside the native cell footprint.
    const bounds = cells.map((cell) => {
      const source = images[cell.tilesetIndex]!.tileset;
      const w = cell.flags & 4 ? source.tileHeight : source.tileWidth;
      const h = cell.flags & 4 ? source.tileWidth : source.tileHeight;
      return { x: cell.x * doc.map.tileWidth, y: (cell.y + 1) * doc.map.tileHeight - h, w, h };
    });
    const oversized = bounds.filter((b) => b.w > doc.map.tileWidth || b.h > doc.map.tileHeight);
    if (oversized.some((a) => bounds.some((b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h))) {
      problems.push({ code: "overlappingArt", params: { layer: layer.name } });
    }
    if (cells.some((cell) => (cell.flags & 4) && doc.map.tileWidth !== doc.map.tileHeight)) {
      problems.push({ code: "tileSize", params: { tileset: layer.name, width: doc.map.tileHeight, height: doc.map.tileWidth, mapWidth: doc.map.tileWidth, mapHeight: doc.map.tileHeight } });
    }
  }
  for (const warning of exportWarnings(doc, options.layers)) problems.push({ code: "invalidCells", params: {
    detail: warning.code === "missingTilesets" ? warning.tilesets.join(", ") : `${warning.tileset}: ${warning.tileIds.join(", ")}`,
  } });
  return problems;
}

const quote = (text: string): string => JSON.stringify(text);
const numberName = (prefix: string, index: number): string => `${prefix}-${String(index).padStart(4, "0")}`;

function nativeCells(cells: readonly ExportCell[]): string[] {
  return cells.flatMap((cell) => {
    const flags = defoldOrientation(cell.flags);
    return ["  cell {", `    x: ${cell.x}`, `    y: ${-cell.y - 1}`, `    tile: ${cell.tileId}`,
      `    h_flip: ${flags.h_flip}`, `    v_flip: ${flags.v_flip}`, `    rotate90: ${flags.rotate90}`, "  }"];
  });
}

/** Files are relative to the chosen Defold project root. Resource references
 * begin with '/', never an OS root. Image bytes are supplied by the caller.
 */
export function exportDefold(doc: MapDocument, levelName: string, bytes: DefoldImageBytes, options: DefoldExportOptions = {}): DefoldExportFile[] {
  const problems = defoldPreflight(doc, bytes, options);
  if (problems.length) throw new DefoldExportError(problems);
  const identity = options.levelId === undefined ? "" : `--id-${[...options.levelId].map(c => c.codePointAt(0)!.toString(16)).join("-")}`;
  const base = `${projectFolder(options.projectSubfolder)!}/${exportBaseName(levelName)}${identity}`;
  const files: DefoldExportFile[] = [];
  const add = (path: string, text: string) => files.push({ path: `${base}/${path}`, text });
  const resource = (path: string) => quote(`/${base}/${path}`);
  const images = exportedTilesets(doc, options.layers);
  for (const [i, { tileset }] of images.entries()) {
    const name = numberName("tileset", i);
    let png: Uint8Array;
    try { png = defoldPng(bytes(tileset.id)!, tileset); }
    catch { throw new DefoldExportError([{ code: "textureLayout", params: { tileset: tileset.name } }]); }
    files.push({ path: `${base}/${name}.png`, bytes: png });
    add(`${name}.tilesource`, [`image: ${resource(`${name}.png`)}`, `tile_width: ${tileset.tileWidth}`, `tile_height: ${tileset.tileHeight}`,
      "tile_margin: 0", `tile_spacing: ${tileset.spacing}`, "extrude_borders: 2", ""].join("\n"));
  }

  const components: { id: string; path: string }[] = [];
  for (const layer of exportedLayers(doc, options.layers)) {
    const layerIndex = doc.layers.findIndex((item) => item.id === layer.id);
    const cells = layerCells(doc, layer, images);
    for (const [sourceIndex] of images.entries()) {
      const subset = cells.filter((cell) => cell.tilesetIndex === sourceIndex);
      if (!subset.length) continue;
      const name = `${numberName("layer", layerIndex)}-${sourceIndex}`;
      // Strict ordering within (0,1), inside the default render camera range.
      const z = (layerIndex + (sourceIndex + 1) / (images.length + 1)) / (doc.layers.length + 1);
      add(`${name}.tilemap`, [`tile_set: ${resource(`${numberName("tileset", sourceIndex)}.tilesource`)}`, "layers {", `  id: ${quote(layer.id)}`,
        `  z: ${z}`, `  is_visible: ${layer.visible ? 1 : 0}`, ...nativeCells(subset), "}", ""].join("\n"));
      components.push({ id: name, path: `${name}.tilemap` });
    }
  }
  const instances: { id: string; path: string }[] = [];
  // Bounded components per GO, so many sources/layers cannot overflow one GO.
  for (let start = 0; start < Math.max(1, components.length); start += 16) {
    const name = start === 0 ? "map" : numberName("map", start / 16);
    add(`${name}.go`, components.slice(start, start + 16).map((component) =>
      `components {\n  id: ${quote(component.id)}\n  component: ${resource(component.path)}\n}\n`).join(""));
    instances.push({ id: name, path: `${name}.go` });
  }
  if (options.collision !== false) for (const [i, text] of defoldCollisionObjects(doc).entries()) {
    const name = numberName("collision", i);
    add(`${name}.collisionobject`, text);
    add(`${name}.go`, `components {\n  id: "collision"\n  component: ${resource(`${name}.collisionobject`)}\n}\n`);
    instances.push({ id: name, path: `${name}.go` });
  }
  // Keep the established game schema (entities, portal fields, spawn, Y down),
  // remapping only its image paths to the packaged PNGs.
  const game = JSON.parse(exportGameJson(doc, options)) as { tilesets: { image: string; margin: number }[] };
  game.tilesets.forEach((tileset, i) => { tileset.image = `${numberName("tileset", i)}.png`; tileset.margin = 0; });
  add("game.json", JSON.stringify(game, null, 2) + "\n");
  add("map.collection", [`name: ${quote(exportBaseName(levelName))}`,
    ...instances.map((instance) => `instances {\n  id: ${quote(instance.id)}\n  prototype: ${resource(instance.path)}\n  position { x: 0 y: 0 z: 0 }\n  rotation { x: 0 y: 0 z: 0 w: 1 }\n}`), ""].join("\n"));
  return files;
}
