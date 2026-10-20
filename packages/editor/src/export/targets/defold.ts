import { DefoldExportError, defoldPreflight, exportDefold, exportedTilesets, type DefoldExportOptions } from "@smap/core";
import { resolveFileData } from "../../io/fileData";
import { t } from "../../i18n";
import type { ExportTargetInput, ExportTargetOptions, ExportTargetPlugin } from "./types";

function coreOptions(input: ExportTargetInput, options: ExportTargetOptions): DefoldExportOptions {
  return {
    ...(input.levelId === undefined ? {} : { levelId: input.levelId }),
    ...(input.layers ? { layers: input.layers } : {}),
    ...(typeof options.projectSubfolder === "string" ? { projectSubfolder: options.projectSubfolder } : {}),
    collision: options.collision !== false,
  };
}

/** Imported by the common target registry; no dialog/actions dependency. */
export const defoldTarget = {
  id: "defold",
  labelKey: "defoldExport.label",
  options: [
    { id: "projectSubfolder", type: "text", labelKey: "defoldExport.projectSubfolderLabel", hintKey: "defoldExport.projectSubfolderHint", defaultValue: "exported" },
    { id: "collision", type: "boolean", labelKey: "defoldExport.collisionLabel", hintKey: "defoldExport.collisionHint", defaultValue: true },
  ],
  preflight(input, options) {
    // Deferred PNG encoders are available textures. The planner resolves them
    // and checks the actual bytes again before producing any writable files.
    const bytes = (id: string) => {
      const image = input.bytes(id);
      return typeof image === "function" ? new Uint8Array([1]) : image;
    };
    return defoldPreflight(input.doc, bytes, coreOptions(input, options)).map((problem) => ({
      severity: "error", key: `defoldExport.${problem.code}`, params: problem.params,
    }));
  },
  async planFiles(input, options) {
    const settings = coreOptions(input, options);
    const images = new Map<string, Uint8Array>();
    for (const { tileset } of exportedTilesets(input.doc, settings.layers)) {
      const source = input.bytes(tileset.id);
      if (source !== undefined) {
        const data = await resolveFileData(source);
        if (typeof data !== "string") images.set(tileset.id, data);
      }
    }
    try {
      return exportDefold(input.doc, input.levelName, (id) => images.get(id), settings).map((file) => ({
        path: file.path, data: "text" in file ? file.text : file.bytes,
      }));
    } catch (error) {
      if (error instanceof DefoldExportError) throw new Error(error.problems.map((p) => t(`defoldExport.${p.code}`, p.params)).join("\n"), { cause: error });
      throw error;
    }
  },
} satisfies ExportTargetPlugin;

export default defoldTarget;
