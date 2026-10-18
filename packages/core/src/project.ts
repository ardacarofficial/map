import type { Stamp } from "./stamp";
/**
 * Project-level data (v1.0–v1.2): the ordered level list with stable level
 * ids and world positions, portal helpers and world-map links.
 *
 * Level list edits are rare and not part of a level's undo history: they
 * are pure functions that return a new {@link Project} (the editor keeps
 * the current one and saves it with `serializeProject`).
 *
 * **Level ids** never change once written. Old project files (`levels:
 * [{ name, path }]`) have none; {@link normalizeProject} (and therefore
 * `parseProject`) derives one from the path ({@link levelIdFromPath}) and
 * the next save writes it, after which it is fixed even if the file is
 * renamed. Portals refer to levels by this id, never by name.
 *
 * **Retired ids**: {@link removeLevel} remembers the removed level's id in
 * `retiredLevelIds` (saved in the project file), and {@link addLevel} never
 * generates a taken or retired id. So a new level at the same path as a
 * removed one gets a fresh id (`lvl-…-2`) and the removed level's portals
 * stay `"missingLevel"` (CLAUDE.md v1.1: "Otomatik onarım yok").
 */
import { collectionsProblem, normalizeCollection, type Collection } from "./collection";
import type { MapDocument } from "./document";
import { normalizeProjectSettings, type ProjectSettings, type ProjectSettingsInput } from "./projectSettings";
import { normalizeRandomSet, randomSetsProblem, type RandomSet } from "./randomSet";
import { PORTAL_TARGET_LEVEL, PORTAL_TARGET_POINT, PORTAL_TYPE_ID, isEntityPoint, type Entity, type EntityPoint, type EntityType } from "./entity";
import { isEntityLayer } from "./layer";
import { portablePathProblem } from "./fileName";
import { relativePathProblem, type Tileset } from "./tileset";

/** Position of a level's top-left corner on the world map, in pixels (y down). */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** A level as listed in the project file. `id` and `world` may be missing in input (see module doc). */
export interface LevelRef {
  /** Stable id; generated when missing. */
  readonly id?: string;
  readonly name: string;
  /** Project-relative path, e.g. `"levels/main.json"`. */
  readonly path: string;
  /** World-map position; defaults to `{ x: 0, y: 0 }`. */
  readonly world?: WorldPoint;
}

/** A level with every field filled in. */
export interface ProjectLevel extends LevelRef {
  readonly id: string;
  readonly world: WorldPoint;
}

/** Contents of `project.smap` (input form: optional fields may be missing). */
export interface ProjectData {
  /** Archived smart recipes carried by older project roots; sidecar files are also supported. */
  readonly generatedRecipes?: readonly Stamp[];
  readonly name: string;
  /** Ordered level list. */
  readonly levels: readonly LevelRef[];
  readonly tilesets: readonly Tileset[];
  /** User-defined entity types (v0.6). Defaults to none. */
  readonly entityTypes?: readonly EntityType[];
  /**
   * Ids of removed levels, never handed out again (see module doc).
   * Defaults to none. Old files have none.
   */
  readonly retiredLevelIds?: readonly string[];
  /** Saved random sets (round 4). Defaults to none. */
  readonly randomSets?: readonly RandomSet[];
  /** Collections / palettes (round 4). Defaults to none. */
  readonly collections?: readonly Collection[];
  /** Project settings (round 4); missing fields take `DEFAULT_PROJECT_SETTINGS`. */
  readonly settings?: ProjectSettingsInput;
}

/** A project with every optional field filled in (what `parseProject` and the level functions return). */
export interface Project extends ProjectData {
  readonly levels: readonly ProjectLevel[];
  readonly entityTypes: readonly EntityType[];
  readonly retiredLevelIds: readonly string[];
  readonly randomSets: readonly RandomSet[];
  readonly collections: readonly Collection[];
  readonly settings: ProjectSettings;
}

/** Deterministic level id for a path: `"lvl-"` + 8 hex digits (FNV-1a of the path). */
export function levelIdFromPath(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `lvl-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Fills in missing level ids (derived from the path; a clash with a taken
 * or retired id gets `-2`, `-3`…), world positions, `entityTypes` and
 * `retiredLevelIds` (de-duplicated, order kept; ids of listed levels are
 * dropped from it). Idempotent.
 * @throws Error on duplicate level ids or paths, an invalid path or world
 * position, or a retired id that is not a non-empty string.
 */
export function normalizeProject(data: ProjectData): Project {
  const taken = new Set<string>();
  const retiredInput = data.retiredLevelIds ?? [];
  if (!Array.isArray(retiredInput)) throw new Error("retiredLevelIds must be an array");
  for (const id of retiredInput) {
    if (typeof id !== "string" || id.length === 0) throw new Error("retired level ids must be non-empty strings");
  }
  const paths = new Set<string>();
  for (const level of data.levels) {
    const problem = relativePathProblem(level.path);
    if (problem) throw new Error(`level "${level.name}": ${problem}`);
    if (paths.has(level.path)) throw new Error(`duplicate level path "${level.path}"`);
    paths.add(level.path);
    if (level.id === undefined) continue;
    if (typeof level.id !== "string" || level.id.length === 0) throw new Error(`level "${level.name}": id must be a non-empty string`);
    if (taken.has(level.id)) throw new Error(`duplicate level id "${level.id}"`);
    taken.add(level.id);
  }
  const setsProblem = randomSetsProblem(data.randomSets ?? []);
  if (setsProblem) throw new Error(setsProblem);
  const collectionsIssue = collectionsProblem(data.collections ?? []);
  if (collectionsIssue) throw new Error(collectionsIssue);
  const settings = normalizeProjectSettings(data.settings ?? {});
  const explicit = new Set(taken);
  const retired = [...new Set(retiredInput)].filter((id) => !explicit.has(id));
  const avoid = new Set([...taken, ...retired]);
  const levels = data.levels.map((level): ProjectLevel => {
    let id = level.id;
    if (id === undefined) {
      id = uniqueId(levelIdFromPath(level.path), avoid);
      avoid.add(id);
    }
    const world = level.world ?? { x: 0, y: 0 };
    if (!Number.isInteger(world.x) || !Number.isInteger(world.y)) {
      throw new Error(`level "${level.name}": world position must be integer pixels`);
    }
    return Object.freeze({ id, name: level.name, path: level.path, world: Object.freeze({ x: world.x, y: world.y }) });
  });
  return Object.freeze({
    ...(data.generatedRecipes?.length ? { generatedRecipes: Object.freeze([...data.generatedRecipes]) } : {}),
    name: data.name,
    levels: Object.freeze(levels),
    tilesets: data.tilesets,
    entityTypes: data.entityTypes ?? Object.freeze([]),
    retiredLevelIds: Object.freeze(retired),
    randomSets: Object.freeze((data.randomSets ?? []).map(normalizeRandomSet)),
    collections: Object.freeze((data.collections ?? []).map(normalizeCollection)),
    settings,
  });
}

/** Level by id, or `undefined`. */
export function projectLevel(project: ProjectData, id: string): ProjectLevel | undefined {
  return normalizeProject(project).levels.find((l) => l.id === id);
}

/**
 * Appends a level (or inserts it at `index`). Without an `id` one is
 * derived from the path and made unique against current **and retired**
 * ids, so re-adding a removed level's path never relinks its old portals.
 * An explicit `id` is used as given (a deliberate restore) and leaves the
 * retired list.
 * @throws Error on an invalid or duplicate path / id, or a path segment
 * that is not a portable file name (Windows device names such as
 * `levels/con.json`, forbidden characters, trailing dots/spaces).
 */
export function addLevel(project: ProjectData, level: LevelRef, index?: number): Project {
  const current = normalizeProject(project);
  const at = index ?? current.levels.length;
  if (!Number.isInteger(at) || at < 0 || at > current.levels.length) {
    throw new RangeError(`addLevel: index must be an integer in [0, ${current.levels.length}], got ${at}`);
  }
  const pathProblem = relativePathProblem(level.path) ?? portablePathProblem(level.path);
  if (pathProblem) throw new Error(`addLevel: path ${pathProblem}`);
  let id = level.id;
  if (id === undefined) {
    id = uniqueId(levelIdFromPath(level.path), new Set([...current.levels.map((l) => l.id), ...current.retiredLevelIds]));
  }
  const levels: LevelRef[] = [...current.levels];
  levels.splice(at, 0, { ...level, id });
  return normalizeProject({ ...current, levels });
}

/** Renames a level; its id stays. @throws Error on an unknown id. */
export function renameLevel(project: ProjectData, id: string, name: string): Project {
  return updateLevel(project, id, "renameLevel", (l) => ({ ...l, name }));
}

/**
 * Removes a level from the list (the level file itself is the caller's
 * business). Portals pointing at it become `"missingLevel"`; nothing is
 * repaired automatically. Its id is added to `retiredLevelIds`, so no
 * later generated id reuses it. @throws Error on an unknown id.
 */
export function removeLevel(project: ProjectData, id: string): Project {
  const current = normalizeProject(project);
  if (!current.levels.some((l) => l.id === id)) throw new Error(`removeLevel: unknown level "${id}"`);
  return normalizeProject({
    ...current,
    levels: current.levels.filter((l) => l.id !== id),
    retiredLevelIds: [...current.retiredLevelIds, id],
  });
}

/** Moves a level to `index` in the list. @throws on an unknown id or a bad index. */
export function moveLevel(project: ProjectData, id: string, index: number): Project {
  const current = normalizeProject(project);
  const from = current.levels.findIndex((l) => l.id === id);
  if (from < 0) throw new Error(`moveLevel: unknown level "${id}"`);
  const max = current.levels.length - 1;
  if (!Number.isInteger(index) || index < 0 || index > max) throw new RangeError(`moveLevel: index must be an integer in [0, ${max}], got ${index}`);
  const levels = [...current.levels];
  const [level] = levels.splice(from, 1);
  levels.splice(index, 0, level!);
  return normalizeProject({ ...current, levels });
}

/**
 * Sets a level's world position (pixels). With `snap`, both coordinates are
 * rounded to the nearest multiple of it (e.g. the tile size); otherwise to
 * whole pixels. @throws Error on an unknown id or a non-positive snap.
 */
export function setLevelWorldPosition(
  project: ProjectData,
  id: string,
  position: WorldPoint,
  options: { readonly snap?: number } = {},
): Project {
  const snap = options.snap;
  if (snap !== undefined && !(Number.isFinite(snap) && snap > 0)) throw new RangeError(`setLevelWorldPosition: snap must be positive, got ${snap}`);
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new RangeError("setLevelWorldPosition: position must be finite");
  const round = (v: number) => (snap ? Math.round(Math.round(v / snap) * snap) : Math.round(v)) + 0;
  return updateLevel(project, id, "setLevelWorldPosition", (l) => ({ ...l, world: { x: round(position.x), y: round(position.y) } }));
}

// ------------------------------------------------------------------ portals (v1.1)

/** `"ok"`: target level exists; `"missingLevel"`: it was removed (shown red, never repaired); `"unset"`: no target chosen yet. */
export type PortalStatus = "ok" | "missingLevel" | "unset";

/** Target level id of a portal entity, or `null` (not a portal / not set). */
export function portalTarget(entity: Entity): string | null {
  if (entity.typeId !== PORTAL_TYPE_ID) return null;
  const v = entity.fields[PORTAL_TARGET_LEVEL];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Target point of a portal entity (pixels in the target level), or `null`. */
export function portalTargetPoint(entity: Entity): EntityPoint | null {
  const v = entity.fields[PORTAL_TARGET_POINT];
  return isEntityPoint(v) ? v : null;
}

/** Status of a portal's link (non-portal entities are always `"ok"`). */
export function portalStatus(project: ProjectData, entity: Entity): PortalStatus {
  if (entity.typeId !== PORTAL_TYPE_ID) return "ok";
  const target = portalTarget(entity);
  if (target === null) return "unset";
  return projectLevel(project, target) ? "ok" : "missingLevel";
}

/** Label drawn on a portal: `"→ Zindan"`, or `"→ ?"` when the target is unset or missing. */
export function portalLabel(project: ProjectData, entity: Entity): string {
  const target = portalTarget(entity);
  const level = target === null ? undefined : projectLevel(project, target);
  return `→ ${level ? level.name : "?"}`;
}

// ------------------------------------------------------------------ world map (v1.2)

/** One portal connection between two levels, for drawing a line on the world map. */
export interface WorldLink {
  readonly fromLevelId: string;
  readonly fromEntityId: string;
  readonly toLevelId: string;
  /** Target point in the target level (pixels), or `null`. */
  readonly toPoint: EntityPoint | null;
}

/**
 * Portal links between levels of the project. `levels` maps level id →
 * loaded document (levels not loaded are skipped). Portals whose target is
 * unset or missing are left out. Order: project level order, then layer
 * order (bottom to top), then entity order.
 */
export function worldLinks(project: ProjectData, levels: ReadonlyMap<string, MapDocument>): WorldLink[] {
  const normalized = normalizeProject(project);
  const ids = new Set(normalized.levels.map((l) => l.id));
  const out: WorldLink[] = [];
  for (const level of normalized.levels) {
    const doc = levels.get(level.id);
    if (!doc) continue;
    for (const layer of doc.layers) {
      if (!isEntityLayer(layer)) continue;
      for (const entity of layer.entities) {
        const target = portalTarget(entity);
        if (target === null || !ids.has(target)) continue;
        out.push({ fromLevelId: level.id, fromEntityId: entity.id, toLevelId: target, toPoint: portalTargetPoint(entity) });
      }
    }
  }
  return out;
}

function updateLevel(project: ProjectData, id: string, what: string, change: (level: ProjectLevel) => LevelRef): Project {
  const current = normalizeProject(project);
  const index = current.levels.findIndex((l) => l.id === id);
  if (index < 0) throw new Error(`${what}: unknown level "${id}"`);
  return normalizeProject({ ...current, levels: current.levels.map((l, i) => (i === index ? change(l) : l)) });
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}
