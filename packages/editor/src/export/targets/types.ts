import type { MapDocument } from "@smap/core";
import type { MessageKey, MessageParams } from "../../i18n";
import type { ExportFile, TilesetBytes } from "../exportFiles";

/** One map snapshot and the image registry, supplied by the export dialog. */
export interface ExportTargetInput {
  readonly doc: MapDocument;
  readonly levelName: string;
  /** Stable map identity for targets with independently published resources. */
  readonly levelId?: string;
  readonly bytes: TilesetBytes;
  readonly layers?: readonly string[];
}
export type ExportTargetOptions = Readonly<Record<string, string | number | boolean>>;
export interface ExportTargetOption {
  readonly id: string;
  readonly type: "text" | "boolean";
  readonly labelKey: MessageKey;
  readonly hintKey?: MessageKey;
  readonly defaultValue: string | boolean;
}
export interface Problem {
  readonly severity: "error" | "warning";
  readonly key: MessageKey;
  readonly params?: MessageParams;
}
/** Pure planning boundary; persistence, folder picking and writing belong to the caller. */
export interface ExportTargetPlugin {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly options: readonly ExportTargetOption[];
  preflight(input: ExportTargetInput, options: ExportTargetOptions): readonly Problem[] | Promise<readonly Problem[]>;
  planFiles(input: ExportTargetInput, options: ExportTargetOptions): Promise<readonly ExportFile[]> | readonly ExportFile[];
}
