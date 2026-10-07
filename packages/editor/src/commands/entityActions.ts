/**
 * Entity layer / entity / entity type actions (v0.6). Every change is a core
 * op, so all of them are undoable. Errors core reports (a second spawn point,
 * a position outside the map…) become toasts instead of exceptions.
 *
 * The canvas uses `placeEntity`, `moveEntity` and `selectEntity` for the
 * entity tool, so the rules live in one place.
 */
import {
  isEntityLayer,
  SPAWN_TYPE_ID,
  type EntityFieldValue,
  type EntityType,
  type MapDocument,
  type MapStore,
} from "@smap/core";

import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";

function currentStore(): MapStore | null {
  return useEditorStore.getState().project?.store ?? null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Display name of a type: built-ins are translated, user types use their own name. */
export function entityTypeName(type: Pick<EntityType, "id" | "name">): string {
  if (type.id === SPAWN_TYPE_ID) return t("entities.spawnName");
  if (type.id === "portal") return t("entities.portalName");
  return type.name.trim() || type.id;
}

/** Label of a built-in field (portal's target level / point); user fields show their name. */
export function entityFieldLabel(typeId: string, field: string): string {
  if (typeId === "portal" && field === "targetLevel") return t("entities.targetLevel");
  if (typeId === "portal" && field === "targetPoint") return t("entities.targetPoint");
  return field;
}

/** "Entity", "Entity 2"… — the first name no layer uses. */
export function uniqueEntityLayerName(doc: MapDocument): string {
  const names = new Set(doc.layers.map((l) => l.name));
  const base = t("layers.entityName");
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Adds an entity layer right above the active layer and makes it active. */
export function addEntityLayer(): string | null {
  const store = currentStore();
  if (!store) return null;
  const { activeLayerId } = useEditorStore.getState();
  const layers = store.document.layers;
  const activeIndex = layers.findIndex((l) => l.id === activeLayerId);
  const index = activeIndex >= 0 ? activeIndex + 1 : layers.length;
  const id = store.dispatch({ type: "addLayer", layer: { type: "entity", name: uniqueEntityLayerName(store.document) }, index });
  useEditorStore.getState().setActiveLayer(id);
  return id;
}

/** The active layer when it is an entity layer, else the topmost entity layer, else a new one. */
export function ensureEntityLayer(): string | null {
  const store = currentStore();
  if (!store) return null;
  const doc = store.document;
  const active = useEditorStore.getState().activeLayerId;
  const activeLayer = active ? doc.getLayer(active) : undefined;
  if (isEntityLayer(activeLayer)) return activeLayer.id;
  const top = doc.entityLayers().at(-1);
  if (top) {
    useEditorStore.getState().setActiveLayer(top.id);
    return top.id;
  }
  return addEntityLayer();
}

/** Picks the type the entity tool places and switches to the tool (on an entity layer). */
export function chooseEntityType(typeId: string): void {
  if (!ensureEntityLayer()) return;
  const editor = useEditorStore.getState();
  editor.setEntityTypeId(typeId);
  editor.setTool("entity");
  if (typeId === SPAWN_TYPE_ID) {
    const spawn = currentStore()?.document.spawn();
    if (spawn) toast.info(t("entities.spawnExists"));
  }
}

/**
 * Places an entity of `typeId` with its top-left corner on cell (`cellX`, `cellY`)
 * of entity layer `layerId` and selects it. Returns its id, or null (toast shown).
 * A second spawn point is refused: the existing one is selected instead.
 */
export function placeEntity(layerId: string, typeId: string, cellX: number, cellY: number): string | null {
  const store = currentStore();
  if (!store) return null;
  const doc = store.document;
  const layer = doc.getLayer(layerId);
  if (!isEntityLayer(layer)) return null;
  if (layer.locked) {
    toast.warning(t("entities.layerLocked"));
    return null;
  }
  if (typeId === SPAWN_TYPE_ID) {
    const spawn = doc.spawn();
    if (spawn) {
      toast.error(t("entities.spawnExists"));
      useEditorStore.getState().setSelectedEntity(spawn.id);
      return null;
    }
  }
  try {
    const id = store.dispatch({
      type: "addEntity",
      layerId,
      entity: { typeId, x: cellX * doc.map.tileWidth, y: cellY * doc.map.tileHeight },
    });
    if (id) useEditorStore.getState().setSelectedEntity(id);
    return id;
  } catch (error) {
    toast.error(t("entities.placeFailed", { detail: errorText(error) }));
    return null;
  }
}

/** Moves an entity so its top-left corner is on cell (`cellX`, `cellY`). Returns false (toast shown) on failure. */
export function moveEntityToCell(entityId: string, cellX: number, cellY: number): boolean {
  const store = currentStore();
  if (!store) return false;
  const { tileWidth, tileHeight } = store.document.map;
  try {
    store.dispatch({ type: "moveEntity", entityId, x: cellX * tileWidth, y: cellY * tileHeight });
    return true;
  } catch (error) {
    toast.error(t("entities.moveFailed", { detail: errorText(error) }));
    return false;
  }
}

/** Sets one field of an entity (one undo step). Returns false (toast shown) on failure. */
export function setEntityField(entityId: string, field: string, value: EntityFieldValue): boolean {
  const store = currentStore();
  if (!store) return false;
  try {
    store.dispatch({ type: "updateEntity", entityId, fields: { [field]: value } });
    return true;
  } catch (error) {
    toast.error(t("entities.updateFailed", { detail: errorText(error) }));
    return false;
  }
}

/** Deletes an entity (undoable) and clears the selection when it was selected. */
export function deleteEntity(entityId: string): void {
  const store = currentStore();
  if (!store?.document.findEntity(entityId)) return;
  try {
    store.dispatch({ type: "removeEntity", entityId });
  } catch (error) {
    toast.error(t("entities.updateFailed", { detail: errorText(error) }));
    return;
  }
  if (useEditorStore.getState().selectedEntityId === entityId) useEditorStore.getState().setSelectedEntity(null);
}

/** Adds or replaces a user-defined type (undoable). Returns false (toast shown) on failure. */
export function saveEntityType(type: EntityType): boolean {
  const store = currentStore();
  if (!store) return false;
  try {
    store.dispatch({ type: "defineEntityType", entityType: type });
    return true;
  } catch (error) {
    toast.error(t("entities.typeFailed", { detail: errorText(error) }));
    return false;
  }
}

/** Removes a user-defined type (undoable); its entities stay on the map. */
export function removeEntityType(typeId: string): boolean {
  const store = currentStore();
  if (!store) return false;
  try {
    store.dispatch({ type: "removeEntityType", typeId });
  } catch (error) {
    toast.error(t("entities.typeFailed", { detail: errorText(error) }));
    return false;
  }
  if (useEditorStore.getState().entityTypeId === typeId) useEditorStore.getState().setEntityTypeId(null);
  return true;
}

/** Number of entities of each type id in the level. */
export function entityCounts(doc: MapDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const layer of doc.entityLayers()) for (const e of layer.entities) counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
  return counts;
}
