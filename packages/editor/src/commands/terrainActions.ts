/**
 * Terrain (autotile) and collision actions used by the tileset, layers and
 * properties panels. Everything goes through core ops, so all are undoable.
 *
 * The user never writes rules: they mark a block as a terrain with a
 * standard template, then pick the terrain to paint. Picking a terrain makes
 * sure a terrain layer exists (reuses one, or creates the tile layer + its
 * terrain grid in one undo step and says so in a toast).
 */
import {
  isGridLayer,
  isTileLayer,
  terrainProblem,
  terrainTemplateInfo,
  COLLISION_PASSABLE,
  COLLISION_SOLID,
  type MapDocument,
  type MapStore,
  type Terrain,
  type TerrainTemplate,
  type Tileset,
  type TileLayer,
} from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";

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
 * 2. else the topmost such terrain layer;
 * 3. else a new pair, inserted right above the active layer.
 */
export function planTerrainLayer(doc: MapDocument, activeLayerId: string | null): TerrainLayerPlan {
  const active = activeLayerId ? doc.getLayer(activeLayerId) : undefined;
  if (active && isLinkedTerrainLayer(doc, active)) return { kind: "use", layerId: active.id };
  const layers = doc.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (isLinkedTerrainLayer(doc, layers[i])) return { kind: "use", layerId: layers[i]!.id };
  }
  const activeIndex = active ? doc.indexOfLayer(active.id) : -1;
  return { kind: "create", index: activeIndex >= 0 ? activeIndex + 1 : layers.length };
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
): Terrain | null {
  const store = currentStore();
  const tileset = store?.document.getTileset(tilesetId);
  if (!store || !tileset || store.inTransaction) return null;
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
  const depth = store.undoDepth;
  toast.withAction(t("toast.terrainRemoved", { name: terrain.name }), {
    label: t("common.undo"),
    run: () => {
      if (currentStore() !== store || store.undoDepth !== depth) return;
      store.undo();
    },
  });
}

/**
 * Makes `terrainId` the brush: finds or creates its terrain layer (see
 * {@link planTerrainLayer}), activates it, sets the grid value and the brush.
 */
export function activateTerrain(terrainId: number): void {
  const state = useEditorStore.getState();
  const store = state.project?.store;
  const terrain = store?.document.getTerrain(terrainId);
  if (!store || !terrain || store.inTransaction) return;
  const plan = planTerrainLayer(store.document, state.activeLayerId);
  let layerId: string;
  if (plan.kind === "use") {
    layerId = plan.layerId;
  } else {
    store.beginTransaction();
    try {
      const tileLayerId = store.dispatch({ type: "addLayer", layer: { name: terrain.name }, index: plan.index });
      layerId = store.dispatch({
        type: "addLayer",
        layer: {
          type: "grid",
          role: "terrain",
          targetLayerId: tileLayerId,
          name: t("terrain.layerName", { name: terrain.name }),
        },
        index: plan.index + 1,
      });
      store.commit();
    } catch (error) {
      store.rollback();
      throw error;
    }
      toast.success(t("toast.terrainLayerCreated"));
  }
  state.setActiveLayer(layerId);
  state.setGridValue(terrain.id);
  state.setStamp(null);
  state.setTool("brush");
}

/** "Collision" / "Collision 2" ... */
function uniqueCollisionName(doc: MapDocument): string {
  const names = new Set(doc.layers.map((l) => l.name));
  const base = t("layers.collisionName");
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name)) return name;
  }
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
