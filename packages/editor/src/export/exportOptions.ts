/**
 * Export dialog logic without React: which layers an export writes (the
 * per-level layer checkboxes), the Unity options, the output subfolder and
 * the "Dışa aktarma kontrolü" checklist. Pure, so the after-save export and
 * the dialog agree and both are tested without a browser.
 */
import { exportBaseName, type ExportLayerSummary, type ExportWarning, type GameExportOptions } from "@smap/core";

import type { MessageKey, MessageParams } from "../i18n";
import type { ExportSettings, ExportTarget } from "./exportSettings";

/** Key of a level in `ExportSettings.excludedLayers`: its stable id, else its path. */
export function levelKey(level: { readonly levelId?: string | undefined; readonly levelPath: string }): string {
  return level.levelId ?? level.levelPath;
}

/**
 * Ids of the tile layers to export: every layer of `summaries` not in
 * `excluded` (so a layer added later is exported by default), none when
 * `tiles` is off (Unity's "Tile katmanları").
 */
export function selectedLayerIds(summaries: readonly ExportLayerSummary[], excluded: readonly string[], tiles = true): string[] {
  if (!tiles) return [];
  const skip = new Set(excluded);
  return summaries.filter((layer) => !skip.has(layer.id)).map((layer) => layer.id);
}

/** `excluded` with `layerId` switched on / off (sorted, so stored settings are stable). */
export function toggleExcluded(excluded: readonly string[], layerId: string, include: boolean): string[] {
  const next = new Set(excluded);
  if (include) next.delete(layerId);
  else next.add(layerId);
  return [...next].sort();
}

/**
 * The output subfolder inside the chosen folder: `""` (write into the folder
 * itself) or one portable folder name (slashes and characters Windows
 * forbids become `_`).
 */
export function outputSubfolder(raw: string): string {
  const trimmed = raw.trim();
  return trimmed === "" ? "" : exportBaseName(trimmed.replace(/[\\/]/g, "_"));
}

/** Game-JSON options of a Unity export for the given layer selection. */
export function unityGameOptions(settings: ExportSettings, layers: readonly string[]): GameExportOptions {
  return { layers, collision: settings.unityCollision };
}

export type CheckState = "ok" | "warn" | "error";

/** One row of the export checklist; `detail` explains a row that is not ok. */
export interface ExportCheck {
  readonly id: "textures" | "layers" | "target";
  readonly state: CheckState;
  readonly label: MessageKey;
  readonly detail?: { readonly key: MessageKey; readonly params?: MessageParams };
}

export interface CheckInput {
  readonly target: ExportTarget;
  /** Selected tile layers (after the "Tile katmanları" switch). */
  readonly selectedLayers: number;
  /** Unity: collision is written. */
  readonly collision: boolean;
  /** Unity / Tiled: a folder is remembered. */
  readonly hasFolder: boolean;
  /** Unity: the tileset PNGs are copied next to the map. */
  readonly copyTextures: boolean;
  /** Tileset images the export needs but the registry does not have. */
  readonly missingImages: readonly string[];
  /** Exporter warnings for the current selection. */
  readonly warnings: readonly ExportWarning[];
}

/**
 * The checklist on the right of the dialog. `error` rows block the export
 * (nothing to write); `warn` rows do not (missing images are skipped, a
 * missing folder is asked for when exporting).
 */
export function exportChecks(input: CheckInput): ExportCheck[] {
  const checks: ExportCheck[] = [];
  const { target } = input;
  const needsImages = target === "png" || target === "tmj" || target === "zip" || target === "godot" || target === "defold" || (target === "unity" && input.copyTextures);
  if (needsImages) {
    const missingTilesets = input.warnings.filter((w) => w.code === "missingTilesets").flatMap((w) => w.tilesets);
    const missing = [...input.missingImages, ...missingTilesets];
    checks.push(
      missing.length === 0
        ? { id: "textures", state: "ok", label: "export.checkTextures" }
        : {
            id: "textures",
            state: "warn",
            label: "export.checkTexturesMissing",
            detail: { key: "export.checkTexturesDetail", params: { paths: missing.join(", ") } },
          },
    );
  }
  if (target !== "zip") {
    const nothing = input.selectedLayers === 0 && !((target === "unity" || target === "godot" || target === "defold") && input.collision);
    const outOfRange = input.warnings.filter((w) => w.code === "tileIdsOutOfRange");
    checks.push(
      nothing
        ? { id: "layers", state: "error", label: "export.checkLayersNone", detail: { key: "export.checkLayersNoneDetail" } }
        : outOfRange.length > 0
          ? {
              id: "layers",
              state: "warn",
              label: "export.checkLayers",
              detail: {
                key: "export.warnTileOutOfRange",
                params: {
                  tileset: outOfRange.map((w) => (w.code === "tileIdsOutOfRange" ? w.tileset : "")).join(", "),
                  ids: outOfRange.flatMap((w) => (w.code === "tileIdsOutOfRange" ? w.tileIds : [])).join(", "),
                },
              },
            }
          : { id: "layers", state: "ok", label: "export.checkLayers" },
    );
  }
  if (target === "unity" || target === "tmj" || target === "godot" || target === "defold") {
    checks.push(
      input.hasFolder
        ? { id: "target", state: "ok", label: "export.checkTarget" }
        : { id: "target", state: "warn", label: "export.checkTargetMissing" },
    );
  }
  return checks;
}

/** True when no check blocks the export. */
export function canExport(checks: readonly ExportCheck[]): boolean {
  return checks.every((check) => check.state !== "error");
}
