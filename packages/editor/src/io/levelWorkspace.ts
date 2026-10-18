import type { GeneratedRecipe } from "./smartStampRecipes";
/**
 * The levels of the open project (v1.0) and what is loaded of them.
 *
 * Only the active level has to be in memory. A level stays cached (its
 * `MapStore`, and with it its undo history) while it has unsaved changes,
 * is not on disk yet, or has undo / redo steps; a clean level without
 * history is dropped when another level is opened and read from its file
 * again next time. Saving writes every dirty level plus `project.smap`.
 *
 * **Project data** (tilesets with their solid flags and terrains, entity
 * types) lives in every level's `MapDocument`. The active level's copy is
 * the current one (`project.smap` is written from it). A cached level picks
 * it up when it becomes active again: appended tilesets are added in place
 * (not an undo step); any other difference rebuilds the level's store from
 * its own text, which keeps every edit but starts its undo history fresh.
 *
 * **Paths** are chosen once, when a level is added or duplicated, and stay
 * stable: renaming a level changes its name only (its id never changes
 * either). Removed levels lose their file on the next save, after
 * `project.smap` no longer lists them.
 *
 * Pure (no React, no stores, no toasts) so it runs in tests with an
 * in-memory folder; `session.ts` wires it to the app.
 */
import {
  addLevel,
  createDocument,
  isEntityLayer,
  isValidTileId,
  MapStore,
  moveLevel,
  parseLevel,
  portalTarget,
  removeLevel,
  renameLevel,
  safeFileName,
  serializeLevel,
  setLevelWorldPosition,
  type MapDocument,
  type NewLayer,
  type ProjectLevel,
  type ProjectSettings,
  type Stamp,
  type WorldPoint,
} from "@smap/core";

import { compareDisk } from "./externalChange";
import { FileNotFoundError, type ProjectFileSystem } from "./fs";
import { saveProjectLevels } from "./projectIo";

/** Folder that holds level files. */
export const LEVELS_DIR = "levels";

/** A level that is in memory. */
export interface LevelEntry {
  readonly id: string;
  store: MapStore;
  /** Unsaved changes (a level that is not on disk yet is always dirty). */
  dirty: boolean;
  /** The level file as last read or written; `null` = not on disk yet. */
  knownText: string | null;
}

export interface NewLevelOptions {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  /** Name of the empty tile layer a new level starts with. */
  layerName: string;
  /** Round 4: the project's layer template (bottom to top); replaces the single `layerName` layer when non-empty. */
  layers?: readonly NewLayer[];
}

/** A level written by {@link LevelWorkspace.save}. */
export interface SavedLevel {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly text: string;
  readonly store: MapStore;
}

export interface SaveLevelsInput {
  tilesetBytes(tilesetId: string): Uint8Array | undefined;
  stamps?: readonly Stamp[];
  generatedRecipes?: readonly GeneratedRecipe[];
  keepStampFiles?: Iterable<string>;
  /** Round 4: project settings for `project.smap`. */
  settings?: ProjectSettings;
}

/** How many portals (in other levels) point at a level. */
export interface PortalReferences {
  count: number;
  /** Names of the levels that hold them, in project order. */
  levels: string[];
  /** Levels whose file could not be read (not counted). */
  unreadable: number;
}

export interface WorkspaceInit {
  name: string;
  levels: readonly ProjectLevel[];
  retiredLevelIds?: readonly string[];
  /** The opened level. */
  active: { id: string; store: MapStore; knownText: string | null; dirty?: boolean };
}

const FOLD: Record<string, string> = { ı: "i", İ: "i", ş: "s", Ş: "s", ç: "c", Ç: "c", ğ: "g", Ğ: "g", ö: "o", Ö: "o", ü: "u", Ü: "u" };

/** File stem for a level name: "Zindan 2" → "zindan-2", "Çöl" → "col" (portable, never empty). */
export function levelFileStem(name: string): string {
  const folded = [...name].map((ch) => FOLD[ch] ?? ch).join("").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return safeFileName(slug, "level");
}

/** Palette entries of a level that cannot be drawn (shown as missing tiles, skipped by exporters). */
export interface PaletteProblems {
  /** Tileset ids the palette uses that are not in the project. */
  missingTilesets: string[];
  /** Entries whose tile id is outside its tileset (the image shrank). */
  outOfRange: number;
}

/** What `parseLevel`'s palette warnings report, as data the UI can translate. */
export function paletteProblems(doc: MapDocument): PaletteProblems {
  const missing = new Set<string>();
  let outOfRange = 0;
  for (const entry of doc.palette.entries()) {
    const tileset = doc.getTileset(entry.tilesetId);
    if (!tileset) missing.add(entry.tilesetId);
    else if (!isValidTileId(tileset, entry.tileId)) outOfRange++;
  }
  return { missingTilesets: [...missing].sort(), outOfRange };
}

/** True when two project-data values are the same (plain frozen data). */
function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function portalsIn(doc: MapDocument, targetId: string): number {
  let n = 0;
  for (const layer of doc.layers) {
    if (!isEntityLayer(layer)) continue;
    for (const entity of layer.entities) if (portalTarget(entity) === targetId) n++;
  }
  return n;
}

export class LevelWorkspace {
  name: string;
  #levels: readonly ProjectLevel[];
  #retired: readonly string[];
  readonly #entries = new Map<string, LevelEntry>();
  #activeId: string;
  /** Files of removed levels, deleted on the next save. */
  readonly #removedFiles = new Set<string>();
  /** Levels that stay in memory for the session (see {@link pin}). */
  readonly #pinned = new Set<string>();

  constructor(init: WorkspaceInit) {
    if (!init.levels.some((l) => l.id === init.active.id)) throw new Error(`LevelWorkspace: unknown level "${init.active.id}"`);
    this.name = init.name;
    this.#levels = init.levels;
    this.#retired = init.retiredLevelIds ?? [];
    this.#activeId = init.active.id;
    this.#entries.set(init.active.id, {
      id: init.active.id,
      store: init.active.store,
      knownText: init.active.knownText,
      dirty: init.active.dirty ?? false,
    });
  }

  /** Ordered level list. */
  get levels(): readonly ProjectLevel[] {
    return this.#levels;
  }

  get retiredLevelIds(): readonly string[] {
    return this.#retired;
  }

  get activeId(): string {
    return this.#activeId;
  }

  get active(): LevelEntry {
    return this.#entries.get(this.#activeId)!;
  }

  get activeLevel(): ProjectLevel {
    return this.level(this.#activeId)!;
  }

  level(id: string): ProjectLevel | undefined {
    return this.#levels.find((l) => l.id === id);
  }

  /** The cached entry of a level, or `undefined` when it is only on disk. */
  entry(id: string): LevelEntry | undefined {
    return this.#entries.get(id);
  }

  /** Ids of levels kept in memory. */
  cachedIds(): string[] {
    return [...this.#entries.keys()];
  }

  /** Ids of levels with unsaved changes, in project order. */
  dirtyIds(): string[] {
    return this.#levels.filter((l) => this.#entries.get(l.id)?.dirty).map((l) => l.id);
  }

  isDirty(id: string): boolean {
    return this.#entries.get(id)?.dirty ?? false;
  }

  /** Files that the next save deletes (removed levels). */
  get removedFiles(): readonly string[] {
    return [...this.#removedFiles];
  }

  /** True when something must be written: a dirty level or a removed level's file. */
  get hasUnsavedLevels(): boolean {
    return this.dirtyIds().length > 0 || this.#removedFiles.size > 0;
  }

  markDirty(id: string = this.#activeId): void {
    const entry = this.#entries.get(id);
    if (entry) entry.dirty = true;
  }

  /** Replaces the active level's store (a backup was opened). The level becomes dirty. */
  replaceActiveStore(store: MapStore): void {
    const entry = this.active;
    entry.store = store;
    entry.dirty = true;
  }

  /**
   * Makes `id` the active level: from the cache, or read from `fs`. The
   * previous level stays cached when it is dirty, not on disk or has
   * history; otherwise it is dropped (its file is identical).
   * @throws on an unknown id, a level that is neither cached nor readable.
   */
  async activate(id: string, fs: ProjectFileSystem | null): Promise<LevelEntry> {
    const level = this.level(id);
    if (!level) throw new Error(`activate: unknown level "${id}"`);
    if (id === this.#activeId) return this.active;
    const source = this.active.store.document;
    let entry = this.#entries.get(id);
    if (entry) {
      entry.store = withProjectData(entry.store, source);
    } else {
      if (!fs) throw new FileNotFoundError(level.path);
      const text = await fs.readText(level.path);
      // The active level may have changed project data while we read.
      entry = { id, store: new MapStore(this.#parse(text)), dirty: false, knownText: text };
      if (!this.level(id)) throw new Error(`activate: level "${id}" was removed`);
      this.#entries.set(id, entry);
    }
    const previous = this.active;
    this.#activeId = id;
    if (this.#droppable(previous)) this.#entries.delete(previous.id);
    return entry;
  }

  /** A level file's text parsed with the active level's project data (tilesets, entity types). */
  #parse(text: string): MapDocument {
    const current = this.active.store.document;
    return parseLevel(text, current.tilesets, current.entityTypes, projectDataOf(current));
  }

  /**
   * v1.2: a level's document for display (world map thumbnails, portal
   * links): the cached store's document when the level is in memory (unsaved
   * edits included), otherwise parsed from its file. Reading a level this way
   * neither caches nor activates it. Callers must not mutate the result.
   * @throws on an unknown id, a level that is neither cached nor readable.
   */
  async documentOf(id: string, fs: ProjectFileSystem | null): Promise<MapDocument> {
    const cached = this.#entries.get(id);
    if (cached) return cached.store.document;
    const level = this.level(id);
    if (!level) throw new Error(`documentOf: unknown level "${id}"`);
    if (!fs) throw new FileNotFoundError(level.path);
    const text = await fs.readText(level.path);
    // It may have been edited (opened) while we read.
    return this.#entries.get(id)?.store.document ?? this.#parse(text);
  }

  /**
   * Keeps a level in memory for the rest of the session, even when it is
   * clean and has no history (a project-wide tileset grid edit must be able
   * to follow undo / redo in every level, see `tilesetRegrid.ts`).
   */
  pin(id: string): void {
    if (this.level(id)) this.#pinned.add(id);
  }

  /**
   * A level's store without activating it: the cached one, or read from
   * `fs` and cached (clean, parsed with the active level's project data).
   * @throws on an unknown id, a level that is neither cached nor readable.
   */
  async load(id: string, fs: ProjectFileSystem | null): Promise<LevelEntry> {
    const cached = this.#entries.get(id);
    if (cached) return cached;
    const level = this.level(id);
    if (!level) throw new Error(`load: unknown level "${id}"`);
    if (!fs) throw new FileNotFoundError(level.path);
    const text = await fs.readText(level.path);
    const again = this.#entries.get(id);
    if (again) return again;
    if (!this.level(id)) throw new Error(`load: level "${id}" was removed`);
    const entry: LevelEntry = { id, store: new MapStore(this.#parse(text)), dirty: false, knownText: text };
    this.#entries.set(id, entry);
    return entry;
  }

  #droppable(entry: LevelEntry): boolean {
    return !this.#pinned.has(entry.id) && !entry.dirty && entry.knownText !== null && !entry.store.canUndo && !entry.store.canRedo && !entry.store.inTransaction;
  }

  /** Appends a new empty level (one tile layer, project tilesets and types). Not active yet. */
  add(options: NewLevelOptions, diskFiles: readonly string[] = []): ProjectLevel {
    const source = this.active.store.document;
    const document = createDocument({
      width: options.width,
      height: options.height,
      tileWidth: options.tileSize,
      tileHeight: options.tileSize,
      tilesets: source.tilesets,
      entityTypes: source.entityTypes,
      ...projectDataOf(source),
    });
    const store = new MapStore(document);
    const layers = options.layers && options.layers.length > 0 ? options.layers : [{ name: options.layerName }];
    for (const layer of layers) store.dispatch({ type: "addLayer", layer });
    store.clearHistory();
    return this.#insert(options.name, store, this.#levels.length, diskFiles);
  }

  /**
   * Copies a level (its current state, unsaved edits included) under a new
   * id and file, right after the original. Portals inside keep their targets.
   */
  async duplicate(id: string, name: string, fs: ProjectFileSystem | null, diskFiles: readonly string[] = []): Promise<ProjectLevel> {
    const level = this.level(id);
    if (!level) throw new Error(`duplicate: unknown level "${id}"`);
    const cached = this.#entries.get(id);
    let text: string;
    if (cached) text = serializeLevel(cached.store.document);
    else if (fs) text = await fs.readText(level.path);
    else throw new FileNotFoundError(level.path);
    const source = this.active.store.document;
    const store = new MapStore(parseLevel(text, source.tilesets, source.entityTypes, projectDataOf(source)));
    const index = this.#levels.findIndex((l) => l.id === id);
    if (index < 0) throw new Error(`duplicate: level "${id}" was removed`);
    return this.#insert(name, store, index + 1, diskFiles);
  }

  #insert(name: string, store: MapStore, index: number, diskFiles: readonly string[]): ProjectLevel {
    const path = this.#freePath(name, diskFiles);
    const world = this.#freeWorldSpot(store.document);
    const project = addLevel(this.#data(), { name, path, world }, index);
    this.#apply(project);
    const level = project.levels.find((l) => l.path === path)!;
    this.#entries.set(level.id, { id: level.id, store, dirty: true, knownText: null });
    return level;
  }

  /**
   * v1.2: where a new level appears on the world map: right of the levels
   * (by their known size; levels only on disk count as big as the new one),
   * level with the active one, on the new level's tile grid. Not an overlap
   * check (CLAUDE.md v1.2), only a sensible start so levels do not pile up.
   */
  #freeWorldSpot(doc: MapDocument): WorldPoint {
    const tile = doc.map.tileWidth;
    const width = (id: string) => {
      const map = this.#entries.get(id)?.store.document.map;
      return map ? map.width * map.tileWidth : doc.map.width * tile;
    };
    let right = -Infinity;
    for (const level of this.#levels) right = Math.max(right, level.world.x + width(level.id));
    if (!Number.isFinite(right)) return { x: 0, y: 0 };
    const gap = 2 * tile;
    return { x: Math.ceil((right + gap) / tile) * tile, y: Math.round(this.activeLevel.world.y / tile) * tile };
  }

  /** `levels/<stem>.json`, unique (case-insensitively) among levels, removed files and `diskFiles` (names in `levels/`). */
  #freePath(name: string, diskFiles: readonly string[]): string {
    const taken = new Set<string>([
      ...this.#levels.map((l) => l.path.toLowerCase()),
      ...[...this.#removedFiles].map((p) => p.toLowerCase()),
      ...diskFiles.map((f) => `${LEVELS_DIR}/${f}`.toLowerCase()),
    ]);
    const stem = levelFileStem(name);
    for (let n = 1; ; n++) {
      const path = `${LEVELS_DIR}/${n === 1 ? stem : `${stem}-${n}`}.json`;
      if (!taken.has(path.toLowerCase())) return path;
    }
  }

  /** Renames a level. Its id and file path stay. */
  rename(id: string, name: string): void {
    this.#apply(renameLevel(this.#data(), id, name));
  }

  /**
   * Removes a level from the project (not undoable). Its file is deleted on
   * the next save; portals pointing at it turn `"missingLevel"`.
   * @throws for the active level (open another first) or the last level.
   */
  remove(id: string): void {
    const level = this.level(id);
    if (!level) throw new Error(`remove: unknown level "${id}"`);
    if (id === this.#activeId) throw new Error("remove: the active level cannot be removed");
    if (this.#levels.length <= 1) throw new Error("remove: a project keeps at least one level");
    const entry = this.#entries.get(id);
    this.#apply(removeLevel(this.#data(), id));
    this.#entries.delete(id);
    this.#pinned.delete(id);
    if (!entry || entry.knownText !== null) this.#removedFiles.add(level.path);
  }

  /** Moves a level to `index` in the list. */
  move(id: string, index: number): void {
    this.#apply(moveLevel(this.#data(), id, index));
  }

  /**
   * v1.2: moves a level on the world map (`position` already snapped by the
   * caller; whole px). Returns false when it is already there.
   */
  setWorldPosition(id: string, position: WorldPoint): boolean {
    const level = this.level(id);
    if (!level) throw new Error(`setWorldPosition: unknown level "${id}"`);
    if (level.world.x === Math.round(position.x) && level.world.y === Math.round(position.y)) return false;
    this.#apply(setLevelWorldPosition(this.#data(), id, position));
    return true;
  }

  #data() {
    return { name: this.name, levels: this.#levels, retiredLevelIds: this.#retired, tilesets: [] };
  }

  #apply(project: { levels: readonly ProjectLevel[]; retiredLevelIds: readonly string[] }): void {
    this.#levels = project.levels;
    this.#retired = project.retiredLevelIds;
  }

  /** Portals in the other levels that point at `id` (unloaded levels are read from `fs`). */
  async portalsTo(id: string, fs: ProjectFileSystem | null): Promise<PortalReferences> {
    const out: PortalReferences = { count: 0, levels: [], unreadable: 0 };
    for (const level of this.#levels) {
      if (level.id === id) continue;
      let doc = this.#entries.get(level.id)?.store.document;
      if (!doc) {
        if (!fs) continue;
        try {
          doc = parseLevel(await fs.readText(level.path));
        } catch {
          out.unreadable++;
          continue;
        }
      }
      const n = portalsIn(doc, id);
      if (n > 0) {
        out.count += n;
        out.levels.push(level.name);
      }
    }
    return out;
  }

  /** Levels a save would write: the active one, every dirty one and every one not on disk yet. */
  #toWrite(): LevelEntry[] {
    const active = this.active;
    return this.#levels
      .map((l) => this.#entries.get(l.id))
      .filter((e): e is LevelEntry => !!e && (e === active || e.dirty || e.knownText === null));
  }

  /**
   * The first level a save would overwrite although its file changed on
   * disk since we last read or wrote it, or `null`.
   */
  async findDiskConflict(fs: ProjectFileSystem): Promise<{ path: string; diskText: string } | null> {
    for (const entry of this.#toWrite()) {
      if (entry.knownText === null) continue;
      const path = this.level(entry.id)?.path;
      if (!path) continue;
      const diskText = await readOrNull(fs, path);
      if (diskText !== null && compareDisk(diskText, entry.knownText) === "changed") return { path, diskText };
    }
    return null;
  }

  /** The active level's file changed on disk since we last read or wrote it: its text, else `null`. */
  async activeDiskChange(fs: ProjectFileSystem): Promise<{ path: string; diskText: string } | null> {
    const entry = this.active;
    const path = this.activeLevel.path;
    const diskText = await readOrNull(fs, path);
    return diskText !== null && compareDisk(diskText, entry.knownText) === "changed" ? { path, diskText } : null;
  }

  /** "Benimkini koru": the disk text of `path` counts as known (the next save overwrites it). */
  acceptDiskText(path: string, text: string): void {
    const level = this.#levels.find((l) => l.path === path);
    const entry = level && this.#entries.get(level.id);
    if (entry) entry.knownText = text;
  }

  /**
   * Writes tileset images, stamps, the active level, every other dirty
   * level and `project.smap` (in that order), then deletes removed levels'
   * files. A level edited while the files were written stays dirty.
   */
  async save(fs: ProjectFileSystem, input: SaveLevelsInput): Promise<SavedLevel[]> {
    const active = this.active;
    const activeLevel = this.activeLevel;
    const entries = this.#toWrite();
    const revisions = new Map(entries.map((e) => [e, e.store.revision]));
    const paths = new Map(entries.map((e) => [e, this.level(e.id)!.path]));
    const removed = [...this.#removedFiles];
    const texts = await saveProjectLevels(fs, {
      name: this.name,
      document: active.store.document,
      levelPath: activeLevel.path,
      levels: this.#levels,
      retiredLevelIds: this.#retired,
      otherLevels: entries.filter((e) => e !== active).map((e) => ({ path: paths.get(e)!, document: e.store.document })),
      removeFiles: removed,
      tilesetBytes: input.tilesetBytes,
      ...(input.stamps ? { stamps: input.stamps } : {}),
      ...(input.generatedRecipes ? { generatedRecipes: input.generatedRecipes } : {}),
      ...(input.keepStampFiles ? { keepStampFiles: input.keepStampFiles } : {}),
      ...(input.settings ? { settings: input.settings } : {}),
    });
    for (const path of removed) this.#removedFiles.delete(path);
    const saved: SavedLevel[] = [];
    for (const entry of entries) {
      const path = paths.get(entry)!;
      const text = texts.get(path);
      if (text === undefined) continue;
      entry.knownText = text;
      if (entry.store.revision === revisions.get(entry) && this.#entries.get(entry.id) === entry) entry.dirty = false;
      saved.push({ id: entry.id, name: this.level(entry.id)?.name ?? entry.id, path, text, store: entry.store });
    }
    return saved;
  }
}

/** `store` with the project data of `source` (see module doc). */
export function withProjectData(store: MapStore, source: MapDocument): MapStore {
  const doc = store.document;
  if (doc === source) return store;
  if (same(doc.entityTypes, source.entityTypes) && same(doc.randomSets, source.randomSets) && same(doc.collections, source.collections)) {
    const have = doc.tilesets;
    const want = source.tilesets;
    if (have.length <= want.length && have.every((ts, i) => same(ts, want[i]))) {
      for (const tileset of want.slice(have.length)) store.dispatch({ type: "addTileset", tileset, undoable: false });
      return store;
    }
  }
  return new MapStore(parseLevel(serializeLevel(doc), source.tilesets, source.entityTypes, projectDataOf(source)));
}

/** Round 4 project data a level document carries besides tilesets / entity types (random sets, collections). */
export function projectDataOf(doc: MapDocument): { randomSets: MapDocument["randomSets"]; collections: MapDocument["collections"] } {
  return { randomSets: doc.randomSets, collections: doc.collections };
}

async function readOrNull(fs: ProjectFileSystem, path: string): Promise<string | null> {
  try {
    return await fs.readText(path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return null;
    throw error;
  }
}
