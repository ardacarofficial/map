/**
 * Terrain (autotile) and collision actions used by the tileset, layers and
 * properties panels. Everything goes through core ops, so all are undoable.
 *
 * The user never writes rules: they mark a block as a terrain with a
 * standard template and can paint right away (defining activates it). Picking
 * a terrain makes sure a terrain layer exists (reuses one, or creates the tile
 * layer + its terrain grid in one undo step) and, when that moves the user to
 * another layer, says so in a toast and flashes the layer row.
 */
import {
  isGridLayer,
  isTileLayer,
  terrainProblem,
  terrainTemplateInfo,
  uniqueLayerName,
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  type MapDocument,
  type MapStore,
  type Terrain,
  type TerrainTemplate,
  type Tileset,
  type TileLayer,
  type LayerPropsPatch,
} from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { flashLayer } from "../ui/feedback/layerFlash";
import { toast } from "../ui/toast/toastStore";
import { undoStepAction } from "./undoStepAction";

function currentStore(): MapStore | null {
  return useEditorStore.getState().project?.store ?? null;
}

// ------------------------------------------------------------------ pure

/** Smallest unused terrain id ≥ 1 above every existing one (ids are project-wide). */
export function nextTerrainId(doc: MapDocument): number {
  let max = 0;
  for (const id of doc.terrainMap().keys()) max = Math.max(max, id);
  return max + 1;
}

/** "Arazi N" with the smallest N ≥ terrain count + 1 that no terrain uses. */
export function uniqueTerrainName(doc: MapDocument): string {
  const terrains = [...doc.terrainMap().values()];
  const names = new Set(terrains.map((x) => x.name));
  for (let n = terrains.length + 1; ; n++) {
    const name = t("terrain.newName", { n });
    if (!names.has(name)) return name;
  }
}

/** All terrains of the document, tileset order then id. */
export function allTerrains(doc: MapDocument): Terrain[] {
  return doc.tilesets.flatMap((ts) => [...(ts.terrains ?? [])]);
}

/** True for a terrain grid layer whose derived tile layer exists. */
function isLinkedTerrainLayer(doc: MapDocument, layer: TileLayer | undefined): boolean {
  if (!isGridLayer(layer) || layer.role !== "terrain" || layer.targetLayerId === null) return false;
  const target = doc.getLayer(layer.targetLayerId);
  return isTileLayer(target);
}

/** What picking a terrain does to the layers. */
export type TerrainLayerPlan =
  /** Paint into this existing terrain layer. */
  | { readonly kind: "use"; readonly layerId: string }
  /** Create a tile layer and a terrain grid targeting it (one undo step). */
  | { readonly kind: "create"; readonly index: number };

/**
 * Decides where a picked terrain is painted:
 * 1. the active layer, if it is a terrain layer with an existing tile layer;
 * 2. the terrain layer owning the active layer, if that is a derived tile layer;
 * 3. else the topmost linked terrain layer;
 * 4. else a new pair, inserted right above the active layer.
 */
export function planTerrainLayer(doc: MapDocument, activeLayerId: string | null): TerrainLayerPlan {
  const active = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  if (active && isLinkedTerrainLayer(doc, active)) return { kind: "use", layerId: active.id };
  const owner = active ? terrainOwnerOf(doc, active.id) : undefined;
  if (owner) return { kind: "use", layerId: owner.id };
  const layers = doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (isLinkedTerrainLayer(doc, layers[i])) return { kind: "use", layerId: layers[i]!.id };
  }
  const activeIndex = active ? doc.indexOfLayer(active.id) : -1;
  return { kind: "create", index: activeIndex >= 0 ? activeIndex + 1 : layers.length };
}

/** The terrain layer that writes into tile layer `layerId` (its derived tiles), if any. */
export function terrainOwnerOf(doc: MapDocument, layerId: string): TileLayer | undefined {
  return doc.layers.find((l) => isGridLayer(l) && l.role === "terrain" && l.targetLayerId === layerId);
}

/** Ids of tile layers that a terrain layer writes into (derived, not for hand painting). */
function derivedLayerIds(doc: MapDocument): Set<string> {
  const ids = new Set<string>();
  for (const layer of doc.layers) {
    if (isGridLayer(layer) && layer.role === "terrain" && layer.targetLayerId !== null) ids.add(layer.targetLayerId);
  }
  return ids;
}

/**
 * Picking a tile in the tileset while a grid (terrain / collision) layer is
 * active means "paint this tile": returns the tile layer to switch to — the
 * nearest hand-painted tile layer below the active one, else the topmost.
 * `null` when the active layer already takes tiles or no such layer exists.
 * (Entity layers never take tiles either.)
 */
export function tileLayerForPick(doc: MapDocument, activeLayerId: string | null): string | null {
  const active = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  if (isTileLayer(active)) return null;
  const derived = derivedLayerIds(doc);
  const layers = doc.layers;
  const plain = (i: number) => {
    const l = layers[i]!;
    return isTileLayer(l) && !derived.has(l.id);
  };
  const from = activeLayerId && active ? doc.indexOfLayer(activeLayerId) : layers.length;
  for (let i = from - 1; i >= 0; i--) if (plain(i)) return layers[i]!.id;
  for (let i = layers.length - 1; i > from; i--) if (plain(i)) return layers[i]!.id;
  return null;
}

/**
 * The value the brush should paint on `layer`, keeping `gridValue` when it
 * is valid there: collision layers take 1 (force solid) or 2 (force
 * passable); terrain layers a defined terrain id (else the first terrain).
 */
export function validGridValue(doc: MapDocument, layer: TileLayer | undefined, gridValue: number): number {
  if (!isGridLayer(layer)) return gridValue;
  if (layer.role === "collision") {
    return gridValue === COLLISION_SOLID || gridValue === COLLISION_PASSABLE ? gridValue : COLLISION_SOLID;
  }
  const terrains = doc.terrainMap();
  if (terrains.has(gridValue) || terrains.size === 0) return gridValue;
  return Math.min(...terrains.keys());
}

/**
 * Localized reason why a `template` block at (`col`, `row`) cannot be a
 * terrain of `tileset`, or `null` when it fits.
 */
export function terrainBlockProblem(tileset: Tileset, template: TerrainTemplate, col: number, row: number): string | null {
  const info = terrainTemplateInfo(template);
  if (info.columns > tileset.columns || info.rows > tileset.rows) {
    return t("terrain.errTooSmall", {
      block: `${info.columns}×${info.rows}`,
      tileset: `${tileset.columns}×${tileset.rows}`,
    });
  }
  const probe: Terrain = { id: 1, name: "", tilesetId: tileset.id, template, origin: { col, row } };
  const problem = terrainProblem(tileset, probe);
  if (problem === null) return null;
  if (col + info.columns > tileset.columns || row + info.rows > tileset.rows) {
    return t("terrain.errDoesNotFit", { block: `${info.columns}×${info.rows}` });
  }
  return problem;
}

// ------------------------------------------------------------------ actions

/** Defines a new terrain; returns it, or null when the block is invalid. */
export function defineTerrain(
  tilesetId: string,
  template: TerrainTemplate,
  origin: { col: number; row: number },
  name: string,
  /** @internal Part of an open transaction (see {@link defineAndActivateTerrain}). */
  nested = false,
): Terrain | null {
  const store = currentStore();
  const tileset = store?.document.getTileset(tilesetId);
  if (!store || !tileset || (store.inTransaction && !nested)) return null;
  if (terrainBlockProblem(tileset, template, origin.col, origin.row) !== null) return null;
  const trimmed = name.trim() || uniqueTerrainName(store.document);
  const terrain: Terrain = { id: nextTerrainId(store.document), name: trimmed, tilesetId, template, origin };
  store.dispatch({ type: "defineTerrain", terrain });
  return store.document.getTerrain(terrain.id) ?? null;
}

export function renameTerrain(terrainId: number, name: string): void {
  const store = currentStore();
  const terrain = store?.document.getTerrain(terrainId);
  const trimmed = name.trim();
  if (!store || !terrain || trimmed.length === 0 || trimmed === terrain.name || store.inTransaction) return;
  store.dispatch({ type: "defineTerrain", terrain: { ...terrain, name: trimmed } });
}

/** Removes a terrain (undoable) and offers "Geri al" in a toast. */
export function deleteTerrain(terrainId: number): void {
  const store = currentStore();
  const terrain = store?.document.getTerrain(terrainId);
  if (!store || !terrain || store.inTransaction) return;
  store.dispatch({ type: "removeTerrain", terrainId });
  toast.withAction(t("toast.terrainRemoved", { name: terrain.name }), undoStepAction(store, undefined, () => currentStore() === store));
}

/** What {@link activateTerrain} did to the layers. */
export interface TerrainActivation {
  /** The terrain layer now active. */
  readonly layerId: string;
  /** True when the tile + terrain layer pair was created. */
  readonly created: boolean;
  /** True when the active layer changed (created, or an existing terrain layer). */
  readonly switched: boolean;
}

/**
 * How the activation is announced:
 * - "pick" (default): picked from a list / the options bar. A toast and a
 *   row flash only when the user is moved to another layer.
 * - "define": right after "Arazi tanımla"; always says the terrain is ready.
 * - "silent": no toast (tests, scripted flows).
 */
export type TerrainAnnounce = "pick" | "define" | "silent";

/**
 * Makes `terrainId` the brush: finds or creates its terrain layer (see
 * {@link planTerrainLayer}), activates it, sets the grid value and the
 * brush tool. Returns what happened, or null when nothing could be done.
 */
export function activateTerrain(terrainId: number, announce: TerrainAnnounce = "pick"): TerrainActivation | null {
  const store = currentStore();
  if (!store || store.inTransaction) return null;
  return activateIn(store, terrainId, announce);
}

/** {@link activateTerrain} without the transaction guard (a layer pair it creates joins an open transaction). */
function activateIn(store: MapStore, terrainId: number, announce: TerrainAnnounce): TerrainActivation | null {
  const state = useEditorStore.getState();
  const terrain = store.document.getTerrain(terrainId);
  if (!terrain) return null;
  const plan = planTerrainLayer(store.document, state.activeLayerId);
  let layerId: string;
  if (plan.kind === "use") {
    layerId = plan.layerId;
  } else {
    store.beginTransaction();
    try {
      const tilesName = uniqueLayerName(store.document, terrain.name);
      const tileLayerId = store.dispatch({ type: "addLayer", layer: { name: tilesName }, index: plan.index });
      layerId = store.dispatch({
        type: "addLayer",
        layer: {
          type: "grid",
          role: "terrain",
          targetLayerId: tileLayerId,
          name: uniqueLayerName(store.document, t("terrain.layerName", { name: tilesName })),
        },
        index: plan.index + 1,
      });
      store.commit();
    } catch (error) {
      store.rollback();
      throw error;
    }
  }
  const result: TerrainActivation = {
    layerId,
    created: plan.kind === "create",
    switched: state.activeLayerId !== layerId,
  };
  state.setActiveLayer(layerId);
  state.setGridValue(terrain.id);
  state.setStamp(null);
  state.setTool("brush");
  announceActivation(terrain, store.document.getLayer(layerId)?.name ?? "", result, announce);
  return result;
}

function announceActivation(terrain: Terrain, layerName: string, result: TerrainActivation, announce: TerrainAnnounce): void {
  if (announce === "silent") return;
  if (result.switched) flashLayer(result.layerId);
  if (announce === "define") {
    toast.success(t("toast.terrainReady", { name: terrain.name }));
  } else if (result.created) {
    toast.info(t("toast.terrainLayerAdded", { layer: layerName }));
  } else if (result.switched) {
    toast.info(t("toast.terrainLayerSwitched", { layer: layerName }));
  }
}

/**
 * "Arazi tanımla" → ready to paint: defines the terrain, then activates it
 * (layer pair, grid value, brush) with a "ready" toast. Null when the block
 * is invalid (nothing changes).
 */
export function defineAndActivateTerrain(
  tilesetId: string,
  template: TerrainTemplate,
  origin: { col: number; row: number },
  name: string,
): Terrain | null {
  const store = currentStore();
  if (!store || store.inTransaction) return null;
  // One user action, one undo step: the terrain and the layer pair it may create.
  store.beginTransaction();
  let terrain: Terrain | null;
  try {
    terrain = defineTerrain(tilesetId, template, origin, name, true);
    if (terrain) activateIn(store, terrain.id, "define");
  } catch (error) {
    if (store.inTransaction) store.rollback();
    throw error;
  }
  store.commit();
  return terrain;
}

// ------------------------------------------------------------------ layer groups

/**
 * Reorders the layers to `order` (layer ids, bottom first; must be a
 * permutation of the current ids) as one undo step. Used to move a terrain
 * layer together with its derived tile layer.
 */
export function applyLayerOrder(order: readonly string[]): void {
  const store = currentStore();
  if (!store || store.inTransaction) return;
  const ids = store.document.layers.map((l) => l.id);
  if (order.length !== ids.length || !ids.every((id) => order.includes(id))) return;
  if (ids.every((id, i) => order[i] === id)) return;
  store.beginTransaction();
  try {
    for (let i = 0; i < order.length; i++) {
      if (store.document.layers[i]?.id !== order[i]) store.dispatch({ type: "moveLayer", layerId: order[i]!, index: i });
    }
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
}

/** Same props on several layers (e.g. hide a terrain layer and its tiles) as one undo step. */
export function setLayersProps(layerIds: readonly string[], props: LayerPropsPatch): void {
  const store = currentStore();
  if (!store || store.inTransaction) return;
  const ids = layerIds.filter((id) => store.document.getLayer(id));
  if (ids.length === 0) return;
  store.beginTransaction();
  try {
    for (const layerId of ids) store.dispatch({ type: "setLayerProps", layerId, props });
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
}

/**
 * Removes a terrain layer together with its derived tile layer (one undo
 * step, "Geri al" in the toast). Returns false when nothing was removed
 * (unknown layer, or it would leave the map without layers).
 */
export function removeTerrainGroup(terrainLayerId: string): boolean {
  const state = useEditorStore.getState();
  const store = state.project?.store;
  const head = store?.document.getLayer(terrainLayerId);
  if (!store || !head || store.inTransaction) return false;
  const child = isGridLayer(head) && head.targetLayerId ? store.document.getLayer(head.targetLayerId) : undefined;
  const ids = child ? [head.id, child.id] : [head.id];
  if (store.document.layers.length <= ids.length) return false;
  const lowest = Math.min(...ids.map((id) => store.document.indexOfLayer(id)));
  store.beginTransaction();
  try {
    for (const layerId of ids) store.dispatch({ type: "removeLayer", layerId });
    store.commit();
  } catch (error) {
    store.rollback();
    throw error;
  }
  if (state.activeLayerId && ids.includes(state.activeLayerId)) {
    const layers = store.document.layers;
    state.setActiveLayer(layers[Math.min(lowest, layers.length - 1)]?.id ?? null);
  }
  toast.withAction(
    t("toast.layerRemoved", { name: head.name }),
    undoStepAction(
      store,
      () => {
        if (store.document.getLayer(head.id)) useEditorStore.getState().setActiveLayer(head.id);
      },
      () => currentStore() === store,
    ),
  );
  return true;
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
