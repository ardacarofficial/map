/** Selection actions capture IDs once; later validation can only remove targets. */
import { isEntityLayer, isGridLayer, type MapDocument } from "@smap/core";
import { t } from "../i18n";
import { useEditorStore } from "../state/editorStore";
import { toast } from "../ui/toast/toastStore";
import { registerCommands } from "./registry";

export type SelectionScope = "active" | "visible";
export interface SelectionSnapshot {
  readonly layerIds: readonly string[];
  readonly skipped: readonly string[];
}

export function resolveSelectionScope(doc: MapDocument, activeId: string | null, scope: SelectionScope): SelectionSnapshot {
  const layers = doc.layers.filter(l => l.visible && (scope === "visible" || l.id === activeId));
  const eligible = layers.filter(l => !isEntityLayer(l) && (scope === "active" || !isGridLayer(l) || l.role === "collision"));
  return Object.freeze({
    layerIds: Object.freeze(eligible.filter(l => !l.locked).map(l => l.id)),
    skipped: Object.freeze(eligible.filter(l => l.locked).map(l => l.name)),
  });
}

/** Missing, newly hidden or locked layers never get replaced by another layer. */
export function survivingSelectionIds(doc: MapDocument, ids: readonly string[]): string[] {
  return ids.filter(id => {
    const l = doc.getLayer(id);
    return l && !l.locked && l.visible && !isEntityLayer(l);
  });
}

export function reportSelectionSkipped(names: readonly string[]): void {
  if (names.length) toast.info(t("selectionScope.skipped", { layers: names.join(", ") }));
}

export function captureSelectionScope(doc: MapDocument, onSkipped = reportSelectionSkipped): readonly string[] {
  const s = useEditorStore.getState();
  const snapshot = resolveSelectionScope(doc, s.activeLayerId, s.selectionScope);
  const ids = survivingSelectionIds(doc, snapshot.layerIds);
  onSkipped([...snapshot.skipped, ...snapshot.layerIds.filter(id => !ids.includes(id)).map(id => doc.getLayer(id)?.name ?? id)]);
  return Object.freeze(ids);
}

export function canUseSelectionScope(): boolean {
  const s = useEditorStore.getState();
  return !!s.project && !!s.region && !s.project.store.inTransaction &&
    resolveSelectionScope(s.project.store.document, s.activeLayerId, s.selectionScope).layerIds.length > 0;
}

export function registerSelectionScopeCommands(): void {
  registerCommands([{
    id: "selection.toggleScope", title: "selectionScope.toggle", category: "edit",
    enabled: () => useEditorStore.getState().project !== null,
    run: () => {
      const s = useEditorStore.getState();
      s.setSelectionScope(s.selectionScope === "active" ? "visible" : "active");
    },
  }]);
}
