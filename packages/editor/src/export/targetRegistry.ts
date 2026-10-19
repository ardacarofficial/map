/** Static target registry. Adapters retain the existing serializers and their bytes. */
import { exportGameJson, exportBaseName, exportedTilesets, parseLevel, serializeLevel } from "@smap/core";
import type { MessageKey } from "../i18n";
import { resolveFileData } from "../io/fileData";
import { tmjExportFiles, unityExportFiles, type ExportFileSet } from "./exportFiles";
import { outputSubfolder } from "./exportOptions";
import type { ExportSettings, ExportTarget } from "./exportSettings";
import { godotPlugin } from "./targets/godot";
import { defoldTarget } from "./targets/defold";
import type { ExportTargetInput, ExportTargetOption, ExportTargetOptions, Problem } from "./targets/types";

/** Existing top-level settings retained for compatibility with saved worlds. */
export type ExportPreference =
  | { readonly key: "autoUnity" | "unityTiles" | "unityCollision" | "copyTextures"; readonly type: "boolean"; readonly labelKey: MessageKey; readonly settingsLabelKey: MessageKey }
  | { readonly key: "unitySubfolder"; readonly type: "text"; readonly labelKey: MessageKey; readonly settingsLabelKey: MessageKey }
  | { readonly key: "pngScale"; readonly type: "scale"; readonly labelKey: MessageKey; readonly settingsLabelKey: MessageKey };

export interface RegisteredTarget {
  readonly id: ExportTarget;
  readonly labelKey: MessageKey;
  readonly descriptionKey: MessageKey;
  readonly commandKey: MessageKey;
  readonly folder: boolean;
  readonly options: readonly ExportTargetOption[];
  readonly preferences: readonly ExportPreference[];
  run(actions: Readonly<Record<ExportTarget, () => Promise<boolean>>>): Promise<boolean>;
  prepare(input: ExportTargetInput, settings: ExportSettings): Promise<TargetPlan>;
}
export const EXPORT_TARGETS: readonly RegisteredTarget[] = ([
  { id: "unity", labelKey: "export.targetUnity", descriptionKey: "exportTargets.unityDescription", commandKey: "exportTargets.unityCommand", folder: true, options: [], preferences: [
    { key: "unitySubfolder", type: "text", labelKey: "export.outputFolder", settingsLabelKey: "export.outputFolder" },
    { key: "unityTiles", type: "boolean", labelKey: "export.optTiles", settingsLabelKey: "settingsUi.unityTiles" },
    { key: "unityCollision", type: "boolean", labelKey: "export.optCollision", settingsLabelKey: "settingsUi.unityCollision" },
    { key: "copyTextures", type: "boolean", labelKey: "export.optTextures", settingsLabelKey: "settingsUi.copyTextures" },
    { key: "autoUnity", type: "boolean", labelKey: "export.autoUnity", settingsLabelKey: "settingsUi.autoUnity" },
  ] },
  { id: "tmj", labelKey: "export.targetTmj", descriptionKey: "exportTargets.tmjDescription", commandKey: "exportTargets.tmjCommand", folder: true, options: [], preferences: [] },
  { id: "png", labelKey: "export.targetPng", descriptionKey: "exportTargets.pngDescription", commandKey: "exportTargets.pngCommand", folder: false, options: [], preferences: [{ key: "pngScale", type: "scale", labelKey: "export.scale", settingsLabelKey: "settingsUi.pngScale" }] },
  { id: "json", labelKey: "export.targetJson", descriptionKey: "exportTargets.jsonDescription", commandKey: "exportTargets.jsonCommand", folder: false, options: [], preferences: [] },
  { id: "zip", labelKey: "export.targetZip", descriptionKey: "exportTargets.zipDescription", commandKey: "exportTargets.zipCommand", folder: false, options: [], preferences: [] },
  { id: "godot", labelKey: godotPlugin.labelKey, descriptionKey: "exportTargets.godotDescription", commandKey: "exportTargets.godotCommand", folder: true,
    options: godotPlugin.options, preferences: [] },
  { id: "defold", labelKey: defoldTarget.labelKey, descriptionKey: "exportTargets.defoldDescription", commandKey: "exportTargets.defoldCommand", folder: true, options: defoldTarget.options, preferences: [] },
] satisfies Omit<RegisteredTarget, "prepare" | "run">[]).map(target => ({ ...target, run: actions => actions[target.id](), prepare: (input, settings) => prepareTargetFiles(target.id, input, settings) }));
export function targetOptions(target: ExportTarget, settings: ExportSettings): ExportTargetOptions {
  return { ...Object.fromEntries(EXPORT_TARGETS.find(t => t.id === target)!.options.map(o => [o.id, o.defaultValue])), ...settings.targetOptions[target] };
}
export interface TargetPlan { readonly problems: readonly Problem[]; readonly set: ExportFileSet | null }

/** Capture the document and all PNG sources synchronously, then materialize before planning. */
export async function snapshotTarget(input: ExportTargetInput): Promise<ExportTargetInput> {
  const doc = parseLevel(serializeLevel(input.doc), structuredClone(input.doc.tilesets), structuredClone(input.doc.entityTypes));
  const pending = exportedTilesets(doc, input.layers).map(({ tileset }) => {
    const data = input.bytes(tileset.id);
    return [tileset.id, data instanceof Uint8Array ? data.slice() : data] as const;
  });
  const images = await Promise.all(pending.map(async ([id, data]) => [id, data === undefined ? undefined : (await resolveFileData(data) as Uint8Array).slice()] as const));
  const bytes = new Map(images);
  return { doc, levelName: input.levelName, bytes: id => bytes.get(id), ...(input.layers ? { layers: [...input.layers] } : {}) };
}

/** Common preflight/planning contract; PNG and Zip retain their existing raster/project delivery. */
async function prepareTargetFiles(target: ExportTarget, source: ExportTargetInput, settings: ExportSettings): Promise<TargetPlan> {
  const images = target === "tmj" || target === "godot" || target === "defold" || (target === "unity" && settings.copyTextures);
  const input = await snapshotTarget(images ? source : { ...source, bytes: () => undefined });
  const options = targetOptions(target, settings);
  if (target === "godot" || target === "defold") {
    const plugin = target === "godot" ? godotPlugin : defoldTarget;
    const problems = await plugin.preflight(input, options);
    if (problems.some(p => p.severity === "error")) return { problems, set: null };
    const files = await plugin.planFiles(input, options);
    return { problems, set: { files, mapFile: files.find(f => f.path.endsWith(target === "godot" ? ".tscn" : ".collection"))!.path, missingImages: [], warnings: [] } };
  }
  if (target === "unity") return { problems: [], set: unityExportFiles(input.doc, input.levelName, input.bytes, {
    ...(input.layers ? { layers: settings.unityTiles ? input.layers : [] } : {}), collision: settings.unityCollision,
    copyTextures: settings.copyTextures, subfolder: outputSubfolder(settings.unitySubfolder),
  }) };
  if (target === "tmj") return { problems: [], set: tmjExportFiles(input.doc, input.levelName, input.bytes, input.layers ? { layers: input.layers } : {}) };
  if (target === "json") {
    const mapFile = `${exportBaseName(input.levelName)}.json`;
    return { problems: [], set: { mapFile, files: [{ path: mapFile, data: exportGameJson(input.doc, input.layers ? { layers: input.layers } : {}) }], missingImages: [], warnings: [] } };
  }
  return { problems: [], set: null };
}

export function prepareTarget(target: ExportTarget, input: ExportTargetInput, settings: ExportSettings): Promise<TargetPlan> {
  return EXPORT_TARGETS.find(entry => entry.id === target)!.prepare(input, settings);
}
