/**
 * "Kaydedince Unity'ye de aktar": after every save (manual or autosave) the
 * Unity export is written again. Pure scheduling logic; the browser wiring
 * (settings, folder permission, toasts) is in `exportActions.ts`.
 *
 * Saves can follow each other faster than an export finishes. Exports never
 * overlap: a save during an export queues exactly one more export, of the
 * newest state.
 */
import type { MapDocument } from "@smap/core";

import type { ProjectFileSystem } from "../io/fs";
import type { ExportFileSet, WriteResult } from "./exportFiles";
import { writeExportFiles } from "./exportFiles";

export interface SavedProject {
  /** Project name (export settings key). */
  readonly name: string;
  readonly document: MapDocument;
  readonly levelName: string;
  /** True for Ctrl+S / the save button, false for autosave. */
  readonly manual: boolean;
}

export interface AutoExportResult {
  readonly project: SavedProject;
  readonly set: ExportFileSet;
  readonly write: WriteResult;
  readonly at: Date;
}

export interface AutoExportDeps {
  /** The folder to export into, or `null` to skip (switch off, no folder, no permission). */
  target(project: SavedProject): Promise<ProjectFileSystem | null>;
  /** Files of the export (built from the document at export time). */
  files(project: SavedProject): ExportFileSet;
  onExported?(result: AutoExportResult): void;
  onError?(error: unknown, project: SavedProject): void;
  now?(): Date;
}

export class AutoExporter {
  readonly #deps: AutoExportDeps;
  #running: Promise<void> | null = null;
  #pending: SavedProject | null = null;

  constructor(deps: AutoExportDeps) {
    this.#deps = deps;
  }

  /** Call after a save finished. Resolves when this save's state has been exported (or skipped). */
  onSaved(project: SavedProject): Promise<void> {
    if (this.#running) {
      // A later save wins; a manual save keeps its "manual" (toast) flag.
      const manual = project.manual || (this.#pending?.manual ?? false);
      this.#pending = { ...project, manual };
      return this.#running;
    }
    this.#running = this.#loop(project);
    return this.#running;
  }

  /** Resolves when no export is running or queued. */
  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  async #loop(first: SavedProject): Promise<void> {
    let next: SavedProject | null = first;
    try {
      while (next) {
        const project: SavedProject = next;
        this.#pending = null;
        await this.#exportOnce(project);
        next = this.#pending;
      }
    } finally {
      this.#running = null;
    }
  }

  async #exportOnce(project: SavedProject): Promise<void> {
    try {
      const fs = await this.#deps.target(project);
      if (!fs) return;
      const set = this.#deps.files(project);
      const write = await writeExportFiles(fs, set.files);
      this.#deps.onExported?.({ project, set, write, at: this.#deps.now?.() ?? new Date() });
    } catch (error) {
      this.#deps.onError?.(error, project);
    }
  }
}
