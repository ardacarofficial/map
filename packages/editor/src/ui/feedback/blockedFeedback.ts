/**
 * Toast for a map press that could not do anything (canvas
 * `onBlockedAction`): says why and offers the one-click way out
 * ("Katman kilitli — Kilidi aç"). The canvas shows its own short hint at
 * the pointer; the toast carries the fix.
 */
import { isEntityLayer, type MapDocument } from "@smap/core";

import type { BlockedAction } from "../../canvas";
import { setUnitProps } from "../../commands/layerActions";
import { terrainOwnerOf } from "../../commands/terrainActions";
import { t } from "../../i18n";
import { useEditorStore, type ToolId } from "../../state/editorStore";
import type { ToastAction } from "../toast/toastStore";

export interface BlockedToast {
  readonly message: string;
  readonly action: ToastAction | null;
}

/** Message and fix for a blocked press (`tool`: the tool that was used). */
export function blockedToast(doc: MapDocument, blocked: BlockedAction, tool: ToolId): BlockedToast | null {
  const layer = doc.getLayer(blocked.layerId);
  if (!layer) return null;
  const name = layer.name;
  switch (blocked.reason) {
    case "locked":
      return {
        message: t("toast.blockedLocked", { name }),
        action: { label: t("toast.unlockAction"), run: () => setUnitProps(layer.id, { locked: false }) },
      };
    case "hidden":
      return {
        message: t("toast.blockedHidden", { name }),
        action: { label: t("toast.showAction"), run: () => setUnitProps(layer.id, { visible: true }) },
      };
    case "derived": {
      const owner = terrainOwnerOf(doc, layer.id);
      return {
        message: t("toast.blockedDerived", { name: owner?.name ?? name }),
        action: owner ? { label: t("toast.selectTerrainAction"), run: () => useEditorStore.getState().setActiveLayer(owner.id) } : null,
      };
    }
    case "wrongKind":
      if (isEntityLayer(layer)) {
        return {
          message: t("toast.blockedEntity"),
          action: { label: t("toast.entityToolAction"), run: () => useEditorStore.getState().setTool("entity") },
        };
      }
      return { message: tool === "entity" ? t("toast.blockedEntityTool") : t("toast.blockedOther"), action: null };
    default:
      return { message: t("toast.blockedOther"), action: null };
  }
}
