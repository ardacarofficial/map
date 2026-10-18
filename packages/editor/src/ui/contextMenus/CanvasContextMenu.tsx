import { PORTAL_TARGET_POINT, SPAWN_TYPE_ID, isEntityPoint, portalTarget, type EntityPoint, type NewEntity } from "@smap/core";
import { useEffect, useState } from "react";

import type { CanvasContextRequest } from "../../canvas";
import { openTileReplacement } from "../../commands/replaceTiles";
import { deleteEntity } from "../../commands/entityActions";
import { navigateTo } from "../../commands/levelActions";
import { runCommand } from "../../commands/registry";
import { t } from "../../i18n";
import { getLevelWorkspace } from "../../io/session";
import { useEditorStore } from "../../state/editorStore";
import { watchCanvasHandle } from "../canvas/canvasHandle";
import { revealSection } from "../layout/layoutStore";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import { SEPARATOR, type ContextEntry } from "./contextItems";
import { PointMenu } from "./RowContextMenu";

/** Shows the inspector's Özellik section (and the panels, when Tab hid them). */
export function revealProperties(): void {
  if (useUiStore.getState().panelsHidden) runCommand("view.togglePanels");
  revealSection("properties");
}

/** A copy of an entity one cell to the right (same type and fields), selected. One undo step. */
export function duplicateEntity(entityId: string): string | null {
  const state = useEditorStore.getState();
  const store = state.project?.store;
  const found = store?.document.findEntity(entityId);
  if (!store || !found || found.entity.typeId === SPAWN_TYPE_ID) return null;
  const { entity, layer } = found;
  const { tileWidth, width } = store.document.map;
  const maxX = Math.max(0, width * tileWidth - (entity.width ?? tileWidth));
  const copy: NewEntity = {
    typeId: entity.typeId,
    x: Math.min(maxX, entity.x + tileWidth),
    y: entity.y,
    fields: entity.fields,
    ...(entity.width !== undefined ? { width: entity.width } : {}),
    ...(entity.height !== undefined ? { height: entity.height } : {}),
  };
  try {
    const id = store.dispatch({ type: "addEntity", layerId: layer.id, entity: copy });
    if (id) state.setSelectedEntity(id);
    return id;
  } catch (error) {
    console.error(error);
    toast.error(t("entities.placeFailed", { detail: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

/** Right-click menu of an entity on the map (it is already selected). */
export function entityMenuItems(entityId: string): ContextEntry[] {
  const doc = useEditorStore.getState().project?.store.document;
  const found = doc?.findEntity(entityId);
  if (!found) return [];
  const { entity, layer } = found;
  const target = portalTarget(entity);
  const items: ContextEntry[] = [];
  if (target !== null) {
    const point = entity.fields[PORTAL_TARGET_POINT];
    const exists = getLevelWorkspace()?.level(target) !== undefined;
    items.push(
      {
        type: "item",
        id: "goToTarget",
        label: t("contextMenu.goToTarget"),
        icon: "portal",
        disabled: !exists,
        run: () => void navigateTo(target, isEntityPoint(point) ? (point as EntityPoint) : null),
      },
      SEPARATOR,
    );
  }
  items.push(
    {
      type: "item",
      id: "properties",
      label: t("contextMenu.properties"),
      icon: "info",
      run: () => {
        useEditorStore.getState().setSelectedEntity(entityId);
        revealProperties();
      },
    },
    {
      type: "item",
      id: "duplicate",
      label: t("contextMenu.duplicate"),
      icon: "copy",
      disabled: entity.typeId === SPAWN_TYPE_ID || layer.locked,
      run: () => void duplicateEntity(entityId),
    },
    SEPARATOR,
    { type: "item", id: "delete", label: t("contextMenu.delete"), icon: "trash", danger: true, disabled: layer.locked, run: () => deleteEntity(entityId) },
  );
  return items;
}

/** Right-click inside the selection (select tool): the clipboard and selection commands. */
export function selectionMenuItems(): ContextEntry[] {
  return [
    { type: "item", id: "cut", label: t("contextMenu.cut"), icon: "scissors", command: "edit.cut" },
    { type: "item", id: "copy", label: t("contextMenu.copy"), icon: "copy", command: "edit.copy" },
    { type: "item", id: "paste", label: t("contextMenu.paste"), icon: "clipboard", command: "edit.paste" },
    { type: "item", id: "delete", label: t("contextMenu.delete"), icon: "trash", command: "edit.delete" },
    SEPARATOR,
    { type: "item", id: "replaceTiles", label: t("replaceTiles.title"), command: "edit.replaceTiles" },
    { type: "item", id: "makeStamp", label: t("contextMenu.makeStamp"), icon: "stamp", command: "stamp.saveSelection" },
    { type: "item", id: "deselect", label: t("contextMenu.deselect"), icon: "x", command: "edit.deselect" },
  ];
}

/**
 * The map canvas' right-click menus. Right-click on the map stays "pick a
 * tile" (CLAUDE.md), with a replacement entry on a single tile. Entities
 * and the select tool's selection have their own context menus.
 */
export function CanvasContextMenu() {
  const [request, setRequest] = useState<CanvasContextRequest | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    const unwatch = watchCanvasHandle((handle) => {
      off?.();
      off = handle?.onContextRequest((r) => setRequest(r));
      if (!handle) setRequest(null);
    });
    return () => {
      unwatch();
      off?.();
    };
  }, []);

  const items = (): readonly ContextEntry[] => {
    if (!request) return [];
    if (request.kind === "tile") return [{ type: "item", id: "replaceTiles", label: t("replaceTiles.title"), run: () => openTileReplacement(request.tile, request.brush) }];
    return request.kind === "entity" ? entityMenuItems(request.entityId) : selectionMenuItems();
  };

  return <PointMenu at={request ? { x: request.x, y: request.y } : null} items={items} onClose={() => setRequest(null)} />;
}
