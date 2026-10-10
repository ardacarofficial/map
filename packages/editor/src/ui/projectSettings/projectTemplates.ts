/**
 * New-project building blocks shared by the welcome screen, the new
 * project dialog and the project settings dialog: layer templates, project
 * templates, size presets, and turning a layer list into `addLayer` ops.
 *
 * Pure (no React, no DOM): the layer names are translated when a template
 * is built, and what is stored in `project.smap` (`settings.layerTemplate`)
 * is that resolved list, so a project keeps its names whatever the UI
 * language is later.
 */
import type { LayerTemplateEntry, LayerTemplateKind, MapStore, NewLayer } from "@smap/core";

import { t } from "../../i18n";

/** What a template layer becomes: a tile layer, a collision grid or an entity layer. */
export type LayerKind = LayerTemplateKind;

/** One layer of a template (core `LayerTemplateEntry`, as saved in `settings.layerTemplate`). */
export type LayerSpec = LayerTemplateEntry;

export type LayerTemplateId = "standard" | "single" | "custom";

/** Bottom to top (index 0 is drawn first, like the document's layer list). */
export function standardLayers(): LayerSpec[] {
  return [
    { name: t("templates.layerGround"), kind: "tile" },
    { name: t("templates.layerPaths"), kind: "tile" },
    { name: t("templates.layerBuildings"), kind: "tile" },
    { name: t("templates.layerDetails"), kind: "tile" },
    { name: t("templates.layerCollision"), kind: "collision" },
  ];
}

export function singleLayer(): LayerSpec[] {
  return [{ name: t("templates.layerGround"), kind: "tile" }];
}

/** Dungeon: floor, walls, details and collision. */
export function dungeonLayers(): LayerSpec[] {
  return [
    { name: t("templates.layerGround"), kind: "tile" },
    { name: t("templates.layerWalls"), kind: "tile" },
    { name: t("templates.layerDetails"), kind: "tile" },
    { name: t("templates.layerCollision"), kind: "collision" },
  ];
}

export function layersFor(id: Exclude<LayerTemplateId, "custom">): LayerSpec[] {
  return id === "standard" ? standardLayers() : singleLayer();
}

/** Which named template a layer list equals (`"custom"` when none). */
export function templateIdOf(layers: readonly LayerSpec[]): LayerTemplateId {
  const same = (a: readonly LayerSpec[]) => a.length === layers.length && a.every((l, i) => l.name === layers[i]!.name && l.kind === layers[i]!.kind);
  if (same(standardLayers())) return "standard";
  if (same(singleLayer())) return "single";
  return "custom";
}

/**
 * The layers a project is created with: blank names are dropped (an empty
 * list falls back to one ground layer) and duplicate names get " 2", " 3"…
 * so every layer stays recognisable in the layer panel and in exports.
 */
export function cleanLayers(layers: readonly LayerSpec[]): LayerSpec[] {
  const out: LayerSpec[] = [];
  const used = new Set<string>();
  for (const layer of layers) {
    const base = layer.name.replace(/\s+/g, " ").trim();
    if (base === "") continue;
    let name = base;
    for (let n = 2; used.has(name.toLocaleLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLocaleLowerCase());
    out.push({ name, kind: layer.kind });
  }
  return out.length > 0 ? out : singleLayer();
}

/** The `addLayer` payload for a template layer. */
export function newLayerFor(spec: LayerSpec): NewLayer {
  switch (spec.kind) {
    case "collision":
      return { type: "grid", role: "collision", name: spec.name };
    case "entity":
      return { type: "entity", name: spec.name };
    default:
      return { name: spec.name };
  }
}

/**
 * Adds the template's layers to `store` (bottom to top) and returns their
 * ids. Not wrapped in a transaction: callers building a new document clear
 * the history afterwards.
 */
export function addTemplateLayers(store: MapStore, layers: readonly LayerSpec[]): string[] {
  return cleanLayers(layers).map((spec) => store.dispatch({ type: "addLayer", layer: newLayerFor(spec) }));
}

// ------------------------------------------------------------------ sizes

/** Tile size chips of the new project dialog. */
export const TILE_SIZE_CHIPS = [8, 16, 24, 32, 48, 64] as const;
export const TILE_MIN = 4;
export const TILE_MAX = 256;
export const MAP_MIN = 1;
export const MAP_MAX = 4096;

export type MapSizePresetId = "small" | "medium" | "large";

export const MAP_SIZE_PRESETS: Readonly<Record<MapSizePresetId, { readonly width: number; readonly height: number }>> = {
  small: { width: 32, height: 24 },
  medium: { width: 64, height: 48 },
  large: { width: 128, height: 96 },
};

/** The preset with exactly this size, or `"custom"`. */
export function mapPresetOf(width: number, height: number): MapSizePresetId | "custom" {
  for (const id of Object.keys(MAP_SIZE_PRESETS) as MapSizePresetId[]) {
    const p = MAP_SIZE_PRESETS[id];
    if (p.width === width && p.height === height) return id;
  }
  return "custom";
}

/** Strict integer parse within `[min, max]`; `null` for anything else. */
export function parseIntInRange(text: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** `"#rrggbb"` (lower case) or `null`. */
export function parseHexColor(text: string): string | null {
  const m = /^\s*#?([0-9a-f]{6})\s*$/i.exec(text);
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

// ------------------------------------------------------------------ project templates

export type ProjectTemplateId = "topdown" | "dungeon" | "empty";

export interface ProjectTemplate {
  readonly id: ProjectTemplateId;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly width: number;
  readonly height: number;
  /** Built on demand (names follow the UI language). */
  layers(): LayerSpec[];
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  { id: "topdown", tileWidth: 32, tileHeight: 32, width: 64, height: 48, layers: standardLayers },
  { id: "dungeon", tileWidth: 16, tileHeight: 16, width: 40, height: 30, layers: dungeonLayers },
  { id: "empty", tileWidth: 32, tileHeight: 32, width: 64, height: 48, layers: singleLayer },
];

export function projectTemplate(id: ProjectTemplateId): ProjectTemplate {
  return PROJECT_TEMPLATES.find((p) => p.id === id) ?? PROJECT_TEMPLATES[2]!;
}

/** Proportional preview box: the map's pixel size fitted into `maxW × maxH` (at least 1 px a side). */
export function fitPreview(pixelWidth: number, pixelHeight: number, maxW: number, maxH: number): { width: number; height: number } {
  if (pixelWidth <= 0 || pixelHeight <= 0) return { width: maxW, height: maxH };
  const scale = Math.min(maxW / pixelWidth, maxH / pixelHeight);
  return { width: Math.max(1, Math.round(pixelWidth * scale)), height: Math.max(1, Math.round(pixelHeight * scale)) };
}
