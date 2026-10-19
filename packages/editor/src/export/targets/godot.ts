/** Self-contained contribution for the common export registry. No UI, writes or global state. */
import { exportedTilesets, exportGodot, GodotPreflightError, parseLevel, preflightGodot, serializeLevel, type GodotMapInput, type GodotOptions, type GodotProblem } from "@smap/core";
import type { ExportTargetInput, ExportTargetOptions, ExportTargetPlugin } from "./types";
import type { MessageKey } from "../../i18n";
import { resolveFileData } from "../../io/fileData";
import type { ExportFileSet, TilesetBytes } from "../exportFiles";

export interface GodotTargetInput {
  /** One or more maps; selections are per map, collision is independent. */
  readonly maps: readonly GodotMapInput[];
  /** Same registry callback used by unityExportFiles/tmjExportFiles; generated PNGs may encode lazily. */
  readonly bytes: TilesetBytes;
  readonly options?: GodotOptions;
}
export interface GodotTargetSnapshot {
  readonly maps: readonly GodotMapInput[];
  readonly images: ReadonlyMap<string, Uint8Array>;
  readonly options: GodotOptions;
  readonly problems: readonly GodotProblem[];
}

/** Copy documents synchronously, then finish every PNG before handing a plan to a writer. */
export async function snapshotGodot(input: GodotTargetInput): Promise<GodotTargetSnapshot> {
  const maps = input.maps.map(map => ({
    name: map.name,
    doc: parseLevel(serializeLevel(map.doc), map.doc.tilesets, map.doc.entityTypes),
    ...(map.layers ? { layers: [...map.layers] } : {}),
  }));
  const options = { ...input.options };
  const needed = new Map(maps.flatMap(map => exportedTilesets(map.doc, map.layers).map(image => [image.tileset.id, image] as const)));
  const problems: GodotProblem[] = [];
  const resolved = await Promise.all([...needed].map(async ([id, image]) => {
    try {
      const source = input.bytes(id);
      if (source === undefined) return undefined;
      const data = await resolveFileData(source);
      return [id, (data as Uint8Array).slice()] as const;
    } catch {
      problems.push({ key: "godotExport.invalidImage", params: { path: image.sourcePath } });
      return undefined;
    }
  }));
  // Promise completion order must not change the user-facing diagnostics.
  problems.sort((a, b) => String(a.params["path"]).localeCompare(String(b.params["path"]), "en"));
  return { maps, images: new Map(resolved.filter(value => value !== undefined)), options, problems };
}
function check(snapshot: GodotTargetSnapshot): readonly GodotProblem[] {
  const failed = new Set(snapshot.problems.map(p => p.params["path"]));
  return [...snapshot.problems, ...preflightGodot(snapshot.maps, id => snapshot.images.get(id), snapshot.options)
    .filter(p => p.key !== "godotExport.missingImage" || !failed.has(p.params["path"]))];
}

/** Registry hosts can capture once, show preflight, then publish this exact snapshot. */
export const godotTarget = {
  id: "godot",
  labelKey: "godotExport.label" satisfies MessageKey,
  options: [
    { id: "resourceRoot", type: "text", labelKey: "godotExport.resourceRoot" satisfies MessageKey, descriptionKey: "godotExport.resourceRootHint" satisfies MessageKey, defaultValue: "smap" },
    { id: "collision", type: "boolean", labelKey: "godotExport.collision" satisfies MessageKey, defaultValue: true },
  ],
  snapshot: snapshotGodot,
  async preflight(input: GodotTargetInput | GodotTargetSnapshot): Promise<readonly GodotProblem[]> {
    return check("images" in input ? input : await snapshotGodot(input));
  },
  async planFiles(input: GodotTargetInput | GodotTargetSnapshot): Promise<ExportFileSet> {
    const snapshot = "images" in input ? input : await snapshotGodot(input);
    const problems = check(snapshot);
    if (problems.length) throw new GodotPreflightError(problems);
    const plan = exportGodot(snapshot.maps, id => snapshot.images.get(id), snapshot.options);
    return {
      mapFile: plan.scenes[0]!,
      files: plan.files.map(file => ({ path: file.path, data: file.text ?? file.bytes })),
      missingImages: [],
      warnings: [],
    };
  },
} as const;

export default godotTarget;

function commonInput(input: ExportTargetInput, options: ExportTargetOptions): GodotTargetInput {
  return { maps: [{ doc: input.doc, name: input.levelName, ...(input.layers ? { layers: input.layers } : {}) }], bytes: input.bytes,
    options: { resourceRoot: typeof options.resourceRoot === "string" ? options.resourceRoot : "smap", collision: options.collision !== false } };
}
/** Shared single-map plugin contract; the multi-map API above remains available. */
export const godotPlugin = {
  id: godotTarget.id,
  labelKey: godotTarget.labelKey,
  options: godotTarget.options.map(option => ({ ...option, ...("descriptionKey" in option ? { hintKey: option.descriptionKey } : {}) })),
  async preflight(input, options) {
    return (await godotTarget.preflight(commonInput(input, options))).map(problem => ({ ...problem, severity: "error" as const }));
  },
  async planFiles(input, options) {
    return [...(await godotTarget.planFiles(commonInput(input, options))).files];
  },
} satisfies ExportTargetPlugin;
