/**
 * Terrain (autotile) and collision actions used by the tileset, layers,
 * Denetçi and tool options. Everything that changes the project goes
 * through core ops, so all are undoable.
 *
 * Terrain is a BRUSH on ordinary tile layers (CLAUDE.md › Autotile, Oct
 * 2026): the data are tags on tileset tiles (`Tileset.terrainSets`). The
 * user marks a block (a rough rectangle; the program finds the template and
 * its origin), names the terrain and paints right away on the active tile
 * layer. Choosing a terrain never switches or creates layers.
 */
import {
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  getTerrainSet,
  isGridLayer,
  isTileLayer,
  terrainTemplateInfo,
  uniqueLayerName,
  type MapDocument,
  type MapStore,
  type TerrainSet,
  type TerrainTemplate,
  type TileLayer,
} from "@smap/core";

import { t } from "../i18n";
import { useEditorStore, type ToolId } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";
import {
  draftResult,
  nextTerrainColor,
  resolveTerrain,
  toggleTag,
  uniqueName,
  withoutTerrain,
  type TagZone,
  type TerrainRef,
} from "../ui/terrain/terrainModel";
import { undoStepAction } from "./undoStepAction";

function currentStore(): MapStore | null {
  return useEditorStore.getState().project?.store ?? null;
}

function markDirty(): void {
  const s = useEditorStore.getState();
  if (!s.dirty) s.setDirty(true);
}

/** Tools the terrain brush works with; others switch to the brush when a terrain is chosen. */
const TERRAIN_TOOLS: readonly ToolId[] = ["brush", "eraser", "fill", "rect"];

// ------------------------------------------------------------------ choose (paint)

/**
 * Makes `ref` the brush: the terrain brush goes on (Autotile), the brush
 * size becomes the terrain size (3 the first time) and a tool that cannot
 * paint terrain switches to the brush. The active layer stays as it is;
 * when it is not a tile layer a toast says where terrain is painted.
 * Returns false when the terrain does not exist.
 */
export function chooseTerrain(ref: TerrainRef, options: { quiet?: boolean } = {}): boolean {
  const state = useEditorStore.getState();
  const store = state.project?.store;
  if (!store || !resolveTerrain(store.document, ref)) return false;
  state.setTerrain({ tilesetId: ref.tilesetId, setId: ref.setId, terrainId: ref.terrainId });
  if (!TERRAIN_TOOLS.includes(state.tool)) state.setTool("brush");
  const layer = state.activeLayerId ? store.document.getLayer(state.activeLayerId) : undefined;
  if (!options.quiet && !isTileLayer(layer)) toast.info(t("terrain.needsTileLayer"));
  return true;
}

/** Autotile toggle of the tool options: terrain brush on (the last chosen terrain) / off. */
export function setAutotile(on: boolean): void {
  const s = useEditorStore.getState();
  if (on && (!s.terrain || !resolveTerrain(s.project?.store.document, s.terrain))) return;
  s.setTerrainActive(on);
  if (on && !TERRAIN_TOOLS.includes(s.tool)) s.setTool("brush");
}

/** The chosen terrain while it still exists (else null). */
export function currentTerrain(): TerrainRef | null {
  const s = useEditorStore.getState();
  return resolveTerrain(s.project?.store.document, s.terrain) ? s.terrain : null;
}

/** True when the terrain brush paints on the active layer right now (on, valid terrain, tile layer). */
export function terrainBrushActive(doc: MapDocument | undefined, state = useEditorStore.getState()): boolean {
  if (!state.terrainActive || !doc || !resolveTerrain(doc, state.terrain)) return false;
  const layer = state.activeLayerId ? doc.getLayer(state.activeLayerId) : undefined;
  return isTileLayer(layer);
}

// ------------------------------------------------------------------ define

/** What "Tanımla" creates. */
export interface TerrainDefinition {
  readonly tilesetId: string;
  readonly template: TerrainTemplate;
  readonly origin: { readonly col: number; readonly row: number };
  /** Add to this set (same kind as the template), or null for a new set. */
  readonly setId: string | null;
  /** Name of a new set (ignored when adding to an existing one; defaults to the terrain name). */
  readonly setName?: string;
  readonly name: string;
  readonly color: string;
  /** Terrain of the set the block's empty side shows (corner sets), 0 = nothing. */
  readonly background: number;
}

/**
 * Tags the block as a (new) terrain and chooses it for the brush — ONE undo
 * step (`setTerrainSet`). Returns the new terrain, or null when nothing was
 * done (no project, the block does not fit, wrong set kind).
 */
export function defineTerrain(def: TerrainDefinition): TerrainRef | null {
  const store = currentStore();
  const tileset = store?.document.getTileset(def.tilesetId);
  if (!store || !tileset || store.inTransaction) return null;
  const existing = def.setId ? getTerrainSet(tileset, def.setId) : undefined;
  const name = def.name.trim() || t("terrain.newName", { n: (existing?.terrains.length ?? 0) + 1 });
  const setName = (def.setName ?? "").trim() || uniqueName(name, (tileset.terrainSets ?? []).map((s) => s.name));
  const result = draftResult(tileset, { ...def, name }, setName);
  if (!result) return null;
  try {
    store.dispatch({ type: "setTerrainSet", tilesetId: tileset.id, set: result.set });
  } catch (error) {
    console.warn("[terrain] define failed", error);
    return null;
  }
  markDirty();
  const ref = { tilesetId: tileset.id, setId: result.set.id, terrainId: result.terrainId };
  chooseTerrain(ref, { quiet: true });
  toast.success(t("terrain.ready", { name }));
  return ref;
}

/** Defaults for a new terrain of `setId` (or a new set): a free name and a colour no terrain of the tileset uses yet. */
export function terrainDefaults(tilesetId: string, _setId: string | null): { name: string; color: string } {
  const doc = currentStore()?.document;
  const tileset = doc?.getTileset(tilesetId);
  const all = (tileset?.terrainSets ?? []).flatMap((s) => s.terrains);
  const names = all.map((x) => x.name);
  const n = names.length + 1;
  return { name: uniqueName(t("terrain.newName", { n }), names), color: nextTerrainColor({ id: "", name: "", kind: "blob", terrains: all, tiles: [] }) };
}

/** Problem of a template block at `origin` in `tileset`, localized, or null when it fits. */
export function blockProblem(tileset: { columns: number; rows: number }, template: TerrainTemplate, origin: { col: number; row: number }): string | null {
  const info = terrainTemplateInfo(template);
  if (info.columns > tileset.columns || info.rows > tileset.rows) {
    return t("terrain.errTooSmall", { block: `${info.columns}×${info.rows}`, tileset: `${tileset.columns}×${tileset.rows}` });
  }
  if (origin.col < 0 || origin.row < 0 || origin.col + info.columns > tileset.columns || origin.row + info.rows > tileset.rows) {
    return t("terrain.errDoesNotFit", { block: `${info.columns}×${info.rows}` });
  }
  return null;
}

// ------------------------------------------------------------------ edit

/** Replaces set `set` of `tilesetId` (one undo step). False when nothing changed or it is invalid. */
function putSet(tilesetId: string, set: TerrainSet): boolean {
  const store = currentStore();
  if (!store || store.inTransaction || !store.document.getTileset(tilesetId)) return false;
  const before = store.peekUndo()?.id;
  try {
    store.dispatch({ type: "setTerrainSet", tilesetId, set });
  } catch (error) {
    console.warn("[terrain] edit failed", error);
    return false;
  }
  const changed = store.peekUndo()?.id !== before;
  if (changed) markDirty();
  return changed;
}

function setOf(ref: { tilesetId: string; setId: string }): TerrainSet | undefined {
  return getTerrainSet(currentStore()?.document.getTileset(ref.tilesetId), ref.setId);
}

export function renameTerrainSet(ref: { tilesetId: string; setId: string }, name: string): void {
  const set = setOf(ref);
  const trimmed = name.trim();
  if (!set || trimmed.length === 0 || trimmed === set.name) return;
  putSet(ref.tilesetId, { ...set, name: trimmed });
}

export function renameTerrain(ref: TerrainRef, name: string): void {
  const set = setOf(ref);
  const trimmed = name.trim();
  if (!set || trimmed.length === 0) return;
  putSet(ref.tilesetId, { ...set, terrains: set.terrains.map((x) => (x.id === ref.terrainId ? { ...x, name: trimmed } : x)) });
}

export function setTerrainColor(ref: TerrainRef, color: string): void {
  const set = setOf(ref);
  if (!set || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
  putSet(ref.tilesetId, { ...set, terrains: set.terrains.map((x) => (x.id === ref.terrainId ? { ...x, color: color.toLowerCase() } : x)) });
}

/** What the eraser leaves behind (0 = empty cells). */
export function setTerrainBackground(ref: { tilesetId: string; setId: string }, background: number): void {
  const set = setOf(ref);
  if (!set) return;
  const { background: _old, ...rest } = set;
  putSet(ref.tilesetId, background ? { ...rest, background } : rest);
}

/** "Düzelt": one tagging click on tile `tileId` (see `toggleTag`). One undo step. */
export function toggleTerrainTag(ref: TerrainRef, tileId: number, zone: TagZone): void {
  const set = setOf(ref);
  if (!set) return;
  putSet(ref.tilesetId, toggleTag(set, tileId, zone, ref.terrainId));
}

/** Removes a whole terrain set (undoable) with "Geri al" in the toast. Tiles already painted stay. */
export function removeTerrainSet(ref: { tilesetId: string; setId: string }): void {
  const store = currentStore();
  const set = setOf(ref);
  if (!store || !set || store.inTransaction) return;
  store.dispatch({ type: "removeTerrainSet", tilesetId: ref.tilesetId, setId: ref.setId });
  markDirty();
  const s = useEditorStore.getState();
  if (s.terrain && s.terrain.tilesetId === ref.tilesetId && s.terrain.setId === ref.setId) s.setTerrain(null);
  toast.withAction(t("terrain.removed", { name: set.name }), undoStepAction(store, undefined, () => currentStore() === store));
}

/** Removes one terrain of a set (the set itself when it was the last one). Undoable, with "Geri al". */
export function removeTerrain(ref: TerrainRef): void {
  const store = currentStore();
  const set = setOf(ref);
  const terrain = set?.terrains.find((x) => x.id === ref.terrainId);
  if (!store || !set || !terrain || store.inTransaction) return;
  if (set.terrains.length <= 1) {
    removeTerrainSet(ref);
    return;
  }
  if (!putSet(ref.tilesetId, withoutTerrain(set, ref.terrainId))) return;
  const s = useEditorStore.getState();
  if (s.terrain && s.terrain.tilesetId === ref.tilesetId && s.terrain.setId === ref.setId && s.terrain.terrainId === ref.terrainId) s.setTerrain(null);
  toast.withAction(t("terrain.removed", { name: terrain.name }), undoStepAction(store, undefined, () => currentStore() === store));
}

// ------------------------------------------------------------------ collision

/**
 * Picking a tile in the tileset while a grid (collision) or entity layer is
 * active means "paint this tile": returns the tile layer to switch to — the
 * nearest tile layer below the active one, else the topmost. `null` when the
 * active layer already takes tiles or no tile layer exists.
 */
export function tileLayerForPick(doc: MapDocument, activeLayerId: string | null): string | null {
  const active = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  if (isTileLayer(active)) return null;
  const layers = doc.layers;
  const plain = (i: number) => isTileLayer(layers[i]);
  const from = activeLayerId && active ? doc.indexOfLayer(activeLayerId) : layers.length;
  for (let i = from - 1; i >= 0; i--) if (plain(i)) return layers[i]!.id;
  for (let i = layers.length - 1; i > from; i--) if (plain(i)) return layers[i]!.id;
  return null;
}

/**
 * The value the brush should paint on `layer`, keeping `gridValue` when it
 * is valid there: collision layers take 1 (force solid) or 2 (force passable).
 */
export function validGridValue(_doc: MapDocument, layer: TileLayer | undefined, gridValue: number): number {
  if (!isGridLayer(layer)) return gridValue;
  return gridValue === COLLISION_SOLID || gridValue === COLLISION_PASSABLE ? gridValue : COLLISION_SOLID;
}

/** "Collision" / "Collision 2" ... */
function uniqueCollisionName(doc: MapDocument): string {
  return uniqueLayerName(doc, t("layers.collisionName"));
}

/** Adds a collision (exceptions) layer right above the active one and makes it active. */
export function addCollisionLayer(): string | null {
  const state = useEditorStore.getState();
  const store = state.project?.store;
  if (!store || store.inTransaction) return null;
  const layers = store.document.layers;
  const activeIndex = layers.findIndex((l) => l.id === state.activeLayerId);
  const index = activeIndex >= 0 ? activeIndex + 1 : layers.length;
  const id = store.dispatch({
    type: "addLayer",
    layer: { type: "grid", role: "collision", name: uniqueCollisionName(store.document) },
    index,
  });
  state.setActiveLayer(id);
  state.setGridValue(COLLISION_SOLID);
  if (state.tool !== "brush" && state.tool !== "rect" && state.tool !== "fill" && state.tool !== "eraser") state.setTool("brush");
  return id;
}

/** Marks tiles solid / not solid (one undo step). */
export function setTilesSolid(tilesetId: string, tileIds: readonly number[], solid: boolean): void {
  const store = currentStore();
  if (!store?.document.getTileset(tilesetId) || store.inTransaction || tileIds.length === 0) return;
  store.dispatch({ type: "setTileSolid", tilesetId, tileIds, solid });
}
